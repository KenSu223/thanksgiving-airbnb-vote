// 鲁班七号躲技能 leaderboard: one Durable Object (/api/dodge/*), each person's
// best survival time, all time. The game runs in the browser, but the score
// is the server's own: starting a run hands out a signed ticket with the seed,
// the page records every input, and when the run ends the server replays
// those inputs (web/src/features/dodge/verify.js) and takes how long the hero
// lasted there. Nothing about a run is held in memory between requests (the
// ticket carries it, signed), so the object can sleep any time without
// losing a run. Bests and their replays live in this object's storage
// (p:<name>, r:<name>), never in KV.
//   POST /api/dodge/start { name, token }                  -> { seed, ticket }
//   POST /api/dodge/score { name, token, ticket, events }  -> { ticks, by, best, newBest, rank, board, bot, react }
//   GET  /api/dodge/board                                  -> { board }
//   GET  /api/dodge/replay?name=                           -> { name, seed, v, events, ticks, by, stats, bot } (top 3 only)
//   POST /scrub-user { target }  (internal only: a retired account, users/retire.js)
// Times are in ticks: 60 a second.
import { getUsers, sameName, cleanName } from '../users/users.js';
import { j } from '../lib/http.js';
import { HZ, SIM_VERSION } from '../../web/src/features/dodge/sim.js';
import { badEvents, replay } from '../../web/src/features/dodge/verify.js';

const TICKET_DAYS = 7; // a run saved on the device can still be sent this long after it started
// Only the top 3's replays are public, for everyone to check; the rest stay
// private (still saved, so they show once that person climbs into the top 3).
const OPEN_REPLAYS = 3;

// Records taken off the board by hand, each exactly once ([flag, key]): the
// flag is kept, so a later record of the same person is never touched.
// 2026-10-14: PM's 86.2 s was an autopilot run; removed on request.
const REMOVE_ONCE = [['removed:pm:2026-10-14', 'pm']];

const enc = new TextEncoder(), dec = new TextDecoder();
const b64u = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const unb64u = s => Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));

export class DodgeBoard {
  constructor(state, env) {
    this.state = state; this.env = env;
    this.best = new Map(); // key -> { name, ticks, runs, at, replay?, bot?, react? }
    this.loaded = null; this.key = null;
  }
  load() {
    return this.loaded ||= this.state.storage.list({ prefix: 'p:' }).then(async m => {
        for (const [k, v] of m) this.best.set(k.slice(2), v);
        await this.state.storage.delete('grants'); // the old autopilot's grant list (the autopilot is gone)
        for (const [flag, key] of REMOVE_ONCE) {
          if (await this.state.storage.get(flag)) continue;
          const was = this.best.get(key) || null;
          this.best.delete(key);
          await this.state.storage.delete('p:' + key);
          await this.state.storage.put(flag, { at: Date.now(), was });
        }
        // the key that signs tickets: made once, kept in this object's storage
        let secret = await this.state.storage.get('secret');
        if (!secret) { secret = crypto.getRandomValues(new Uint8Array(32)); await this.state.storage.put('secret', secret); }
        this.key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    });
  }
  // [key, record], best first
  ranked() {
    return [...this.best].sort(([, a], [, b]) => b.ticks - a.ticks || a.at - b.at);
  }
  top() {
    return this.ranked().slice(0, 50)
      .map(([, r], i) => ({ name: r.name, ticks: r.ticks, runs: r.runs, at: r.at, replay: i < OPEN_REPLAYS && !!r.replay, bot: !!r.bot, react: r.react ?? null }));
  }

  async fetch(request) {
    await this.load();
    const url = new URL(request.url), path = url.pathname;
    if (request.method === 'GET' && path === '/api/dodge/board') return j({ ok: true, board: this.top() });
    if (request.method === 'GET' && path === '/api/dodge/replay') return this.replayOf(url.searchParams.get('name'));
    // always read the body (answering without it trips the runtime), and only use it if it's an object
    const parsed = request.method === 'POST' ? await request.json().catch(() => null) : null;
    const body = parsed && typeof parsed === 'object' ? parsed : {};
    if (request.method === 'POST' && path === '/api/dodge/start') return this.start(body);
    if (request.method === 'POST' && path === '/api/dodge/score') return this.score(body);
    if (request.method === 'POST' && path === '/scrub-user') return this.scrubUser(body);
    return j({ ok: false, error: '这个版本旧了，刷新一下页面' }, 404);
  }

  // A retired account (users/retire.js): drop their board record and saved
  // replay. Internal only — the public worker routes /api/dodge/* here, never
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
    if (!ticket) return j({ ok: false, error: '这个版本旧了，刷新一下页面' }, 400); // a page from before tickets
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
    const newBest = !prev || r.ticks > prev.ticks;
    const rec = newBest
      ? { name: user.name, ticks: r.ticks, runs: (prev?.runs || 0) + 1, at: now, replay: true, bot: r.bot, react: r.stats.medianMs }
      : { ...prev, name: user.name, runs: prev.runs + 1 };
    this.best.set(key, rec);
    await this.state.storage.put('p:' + key, rec);
    if (newBest) await this.state.storage.put('r:' + key, { name: user.name, seed: run.s, v: run.v, events, ticks: r.ticks, by: r.by, stats: r.stats, bot: r.bot, at: now });
    const board = this.top();
    return j({ ok: true, ticks: r.ticks, by: r.by, best: rec.ticks, newBest, rank: board.findIndex(x => x.name === user.name) + 1, board, bot: r.bot, react: r.stats.medianMs });
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
