// 末日小队 leaderboard: one Durable Object (/api/doom/*), each person's best
// run (the kill score), all time. Same checking as 躲技能 (dodge/board.js): the
// game runs in the browser, but the score is the server's own. Starting a run
// hands out a signed ticket with the seed, the page records every input, and
// when the run ends the server replays those inputs
// (web/src/features/doom/verify.js) and takes the score from there. Nothing
// about a run is held in memory between requests (the ticket carries it,
// signed). Bests and their replays live in this object's storage (p:<name>,
// r:<name>), never in KV.
//   POST /api/doom/start { name, token }                  -> { seed, ticket }
//   POST /api/doom/score { name, token, ticket, events }  -> { score, kills, wave, end, best, newBest, rank, board, boardMe }
//   GET  /api/doom/board?name=&token=                     -> { board, boardMe }  (the top 3; your own place if signed in)
//   GET  /api/doom/replay?name=                           -> { name, seed, v, events, score, kills, wave, end } (top 3 only)
//   POST /scrub-user { target }  (internal only: a retired account, users/retire.js)
import { getUsers, sameName, cleanName } from '../users/users.js';
import { j } from '../lib/http.js';
import { TOP, topFor } from '../lib/board.js';
import { HZ, SIM_VERSION } from '../../web/src/features/doom/sim.js';
import { badEvents, replay } from '../../web/src/features/doom/verify.js';

const TICKET_DAYS = 7; // a run saved on the device can still be sent this long after it started
// Only the top 3 are on the board (lib/board.js), and their replays are public,
// for everyone to check; the rest stay private.
const OPEN_REPLAYS = TOP;

const enc = new TextEncoder(), dec = new TextDecoder();
const b64u = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const unb64u = s => Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));

export class DoomBoard {
  constructor(state, env) {
    this.state = state; this.env = env;
    this.best = new Map(); // key -> { name, score, kills, wave, runs, at }
    this.loaded = null; this.key = null;
  }
  load() {
    return this.loaded ||= this.state.storage.list({ prefix: 'p:' }).then(async m => {
      for (const [k, v] of m) this.best.set(k.slice(2), v);
      // the key that signs tickets: made once, kept in this object's storage
      let secret = await this.state.storage.get('secret');
      if (!secret) { secret = crypto.getRandomValues(new Uint8Array(32)); await this.state.storage.put('secret', secret); }
      this.key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    });
  }
  // [key, record], best first: the higher score, then the further wave, then whoever got there first
  ranked() {
    return [...this.best].sort(([, a], [, b]) => b.score - a.score || b.wave - a.wave || a.at - b.at);
  }
  // The top 3 and the viewer's own place, as rows. How many runs someone has
  // played stays private (still counted in p:<name>).
  boardFor(key) {
    return topFor(this.ranked().map(([k, r], i) => [k, { name: r.name, score: r.score, wave: r.wave, kills: r.kills, at: r.at, replay: i < OPEN_REPLAYS }]), key);
  }

  async fetch(request) {
    await this.load();
    const url = new URL(request.url), path = url.pathname;
    if (request.method === 'GET' && path === '/api/doom/board') {
      const user = await this.caller(url.searchParams.get('name'), url.searchParams.get('token'));
      return j({ ok: true, ...this.boardFor(user?.name.toLowerCase()) });
    }
    if (request.method === 'GET' && path === '/api/doom/replay') return this.replayOf(url.searchParams.get('name'));
    // always read the body (answering without it trips the runtime), and only use it if it's an object
    const parsed = request.method === 'POST' ? await request.json().catch(() => null) : null;
    const body = parsed && typeof parsed === 'object' ? parsed : {};
    if (request.method === 'POST' && path === '/api/doom/start') return this.start(body);
    if (request.method === 'POST' && path === '/api/doom/score') return this.score(body);
    if (request.method === 'POST' && path === '/scrub-user') return this.scrubUser(body);
    return j({ ok: false, error: '这个版本旧了，刷新一下页面' }, 404);
  }

  // A retired account (users/retire.js): drop their board record and saved
  // replay. Internal only — the public worker routes /api/doom/* here, never
  // /scrub-user, so a request on this path came from inside.
  async scrubUser({ target }) {
    const key = cleanName(target).toLowerCase();
    if (!key) return j({ ok: true, removed: 0 });
    const removed = this.best.delete(key) ? 1 : 0;
    await this.state.storage.delete(['p:' + key, 'r:' + key]);
    return j({ ok: true, removed });
  }

  // The account behind a name + token, or null.
  async caller(name, token) {
    const users = await getUsers(this.env);
    const user = users.find(u => sameName(u.name, cleanName(name)));
    return user && token && user.token === token ? user : null;
  }

  // A ticket is "<payload>.<signature>": who, which seed, when, which game version.
  async start({ name, token }) {
    const user = await this.caller(name, token);
    if (!user) return j({ ok: false, error: '先登录再玩' }, 401);
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    const payload = b64u(enc.encode(JSON.stringify({ k: user.name.toLowerCase(), s: seed, t: Date.now(), v: SIM_VERSION })));
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', this.key, enc.encode(payload)));
    return j({ ok: true, seed, ticket: payload + '.' + b64u(sig) });
  }
  async openTicket(ticket) {
    try {
      const [payload, sig] = String(ticket).split('.');
      if (!(await crypto.subtle.verify('HMAC', this.key, unb64u(sig), enc.encode(payload)))) return null;
      return JSON.parse(dec.decode(unb64u(payload)));
    } catch (e) { return null; }
  }

  async score({ name, token, ticket, events }) {
    if (!ticket) return j({ ok: false, error: '这个版本旧了，刷新一下页面' }, 400);
    const user = await this.caller(name, token);
    if (!user) return j({ ok: false, error: '先登录再玩' }, 401);
    const key = user.name.toLowerCase(), run = await this.openTicket(ticket);
    if (!run || run.k !== key || Date.now() - run.t > TICKET_DAYS * 86400000) return j({ ok: false, error: '这局对不上，没记上' }, 400);
    if (run.v !== SIM_VERSION) return j({ ok: false, error: '游戏更新过了，这局核对不了，没记上' }, 409);
    if (badEvents(events)) return j({ ok: false, error: '这局的记录不对，没记上' }, 400);
    // the server's own replay is the score
    const r = replay(run.s, events);
    if (r.ticks * 1000 / HZ > Date.now() - run.t + 2000) return j({ ok: false, error: '这局比实际过去的时间还长，没记上' }, 400);
    const prev = this.best.get(key), now = Date.now();
    const newBest = !prev || r.score > prev.score || (r.score === prev.score && r.wave > prev.wave);
    const rec = newBest
      ? { name: user.name, score: r.score, kills: r.kills, wave: r.wave, runs: (prev?.runs || 0) + 1, at: now }
      : { ...prev, name: user.name, runs: prev.runs + 1 };
    this.best.set(key, rec);
    await this.state.storage.put('p:' + key, rec);
    if (newBest) await this.state.storage.put('r:' + key, { name: user.name, seed: run.s, v: run.v, events, score: r.score, kills: r.kills, wave: r.wave, end: r.end, at: now });
    return j({ ok: true, score: r.score, kills: r.kills, wave: r.wave, end: r.end, best: rec.score, newBest, rank: this.ranked().findIndex(([k]) => k === key) + 1, ...this.boardFor(key) });
  }

  // A best run, to watch again: same seed, same inputs, same game. Top 3 only.
  async replayOf(name) {
    const key = cleanName(String(name || '')).toLowerCase();
    const rank = this.ranked().findIndex(([k]) => k === key);
    if (rank < 0) return j({ ok: false, error: '这条纪录没有回放' }, 404);
    if (rank >= OPEN_REPLAYS) return j({ ok: false, error: '只公开前三名的回放' }, 403);
    const rec = await this.state.storage.get('r:' + key);
    return rec ? j({ ok: true, ...rec }) : j({ ok: false, error: '这条纪录没有回放' }, 404);
  }
}
