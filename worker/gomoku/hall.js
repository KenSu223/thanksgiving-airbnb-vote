// The 五子棋 room: one Durable Object (WebSocket /api/gomoku) holding three
// tables of two (game.js). It speaks the same messages as the card halls
// (games/hall.js) — watch, identify, sit, leave, react — so the page uses the
// same useTable hook, but it is its own object because a 五子棋 table is saved
// as it goes: after every change the table goes into this object's storage
// (t:<room>), so a deploy or a restart picks every game up where it was (the
// stones, whose turn, the seats; the move clock starts fresh). A game against
// the bot that someone stands up from is kept under their name (g:<name>) until
// they next sit down alone; everyone's wins and games are p:<name>, written
// when a game ends. Only the top 3 go out, plus each viewer's own place.
//
// Watching needs nothing; sitting needs the login (name + token from the user
// list), like the card tables. Every state message also says who is watching
// the table (👀: how many, and the names of those signed in).
//
// Messages in:  watch { room }, identify { name, token }, sit { room, name, token, seat? },
//   leave, start, move { at }, undo, resign, fresh, auto { on }, react { value, target }.
//   Anything else is ignored.
// Messages out: { type: 'state', room, seatedAt, you, table, lobby, watch, reactions, board, boardMe, error?, notice? }
import { getUsers, sameName, cleanName } from '../users/users.js';
import { noteReaction, freshReactions } from '../games/reactions.js';
import { j } from '../lib/http.js';
import { topFor } from '../lib/board.js';
import { GomokuGame } from './game.js';

export const ROOMS = 3;
const rand = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
// most wins, then the better win rate, then more games, then whoever got there first
const byWins = ([, a], [, b]) => b.wins - a.wins || b.wins / Math.max(1, b.games) - a.wins / Math.max(1, a.games) || b.games - a.games || a.at - b.at;
// what a seated player can send: message type -> (table, key, message) -> error text or nothing
const ACTIONS = {
  start: (t, key) => t.start(key),
  move: (t, key, m) => t.move(key, m.at),
  undo: (t, key) => t.undo(key),
  resign: (t, key) => t.resign(key),
  fresh: (t, key) => t.fresh(key),
  auto: (t, key, m) => t.setAuto(key, m.on),
};

export class GomokuHall {
  constructor(state, env) {
    this.state = state; this.env = env;
    this.sockets = new Map(); // socket -> { key (seated here), as (signed in: { key, name }), room (being watched) }
    this.reactions = new Map(); // room -> recent reactions (games/reactions.js)
    this.records = new Map(); // key -> { name, wins, games, draws, at }
    this.saved = new Map(); // key -> a paused game against the bot
    this.savedV = new Array(ROOMS).fill(-1); // each table's version as last written
    this.loaded = null; this.sweeper = null;
    this.tables = Array.from({ length: ROOMS }, () => new GomokuGame({
      now: () => Date.now(),
      rand,
      schedule: (fn, ms) => setTimeout(() => { fn(); this.changed(); }, ms),
      cancel: t => clearTimeout(t),
      record: (s, outcome) => this.record(s, outcome),
      pause: (key, game) => { this.saved.set(key, game); this.state.storage.put('g:' + key, game); },
      unpause: key => { if (this.saved.delete(key)) this.state.storage.delete('g:' + key); },
    }));
  }
  load() {
    return this.loaded ||= Promise.all([
      this.state.storage.list({ prefix: 'p:' }), this.state.storage.list({ prefix: 'g:' }), this.state.storage.list({ prefix: 't:' }),
    ]).then(([p, g, t]) => {
      for (const [k, v] of p) this.records.set(k.slice(2), v);
      for (const [k, v] of g) this.saved.set(k.slice(2), v);
      this.tables.forEach((table, i) => { if (table.restore(t.get('t:' + (i + 1)))) this.savedV[i] = table.v; });
    });
  }
  record(s, outcome) {
    const r = this.records.get(s.key) || { name: s.name, wins: 0, games: 0, draws: 0, at: 0 };
    const rec = { name: s.name, wins: r.wins + (outcome === 'win' ? 1 : 0), games: r.games + 1, draws: (r.draws || 0) + (outcome === 'draw' ? 1 : 0), at: Date.now() };
    this.records.set(s.key, rec);
    this.state.storage.put('p:' + s.key, rec);
  }
  // Something moved: write every table that changed, then tell everyone.
  changed(skip) {
    this.tables.forEach((t, i) => {
      if (t.v === this.savedV[i]) return;
      this.savedV[i] = t.v;
      this.state.storage.put('t:' + (i + 1), t.snapshot());
    });
    this.broadcast(skip);
  }

  // Internal only: a retired account's records (users/retire.js) through the
  // binding — the public worker routes only /api/gomoku here, never /scrub-user.
  // Takes them off any table (nothing saved for anyone), drops their paused
  // game and their row on the board.
  async scrubUser(request) {
    const body = await request.json().catch(() => null) || {};
    await this.load();
    const key = cleanName(body.target).toLowerCase();
    if (!key) return j({ ok: true, removed: 0 });
    for (const t of this.tables) t.forget(key);
    for (const o of this.sockets.values()) {
      if (o.key === key) o.key = null;
      if (o.as?.key === key) o.as = null;
    }
    const removed = (this.records.delete(key) ? 1 : 0) + (this.saved.delete(key) ? 1 : 0);
    await this.state.storage.delete(['p:' + key, 'g:' + key]);
    this.changed();
    return j({ ok: true, removed });
  }
  tableOf(key) { return key ? this.tables.find(t => t.has(key)) : null; }
  clampRoom(r, fallback = 1) { return Math.min(ROOMS, Math.max(1, Math.floor(Number(r)) || fallback)); }
  async user(m) {
    const users = await getUsers(this.env);
    const user = users.find(u => sameName(u.name, cleanName(m.name)));
    return user && m.token && user.token === m.token ? { key: user.name.toLowerCase(), name: user.name } : null;
  }

  async fetch(request) {
    if (request.method === 'POST' && new URL(request.url).pathname === '/scrub-user') return this.scrubUser(request);
    if (request.headers.get('Upgrade') !== 'websocket') {
      await request.text().catch(() => ''); // read what was sent first: an unread body upsets the connection
      return new Response('Expected a WebSocket', { status: 426 });
    }
    await this.load();
    const room = this.clampRoom(new URL(request.url).searchParams.get('room'));
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    this.sockets.set(server, { key: null, as: null, room });
    server.addEventListener('message', e => this.onMessage(server, e.data));
    server.addEventListener('close', () => this.onClose(server));
    server.addEventListener('error', () => this.onClose(server));
    if (!this.sweeper) this.sweeper = setInterval(() => this.sweep(), 60000);
    this.broadcast(); // a new watcher: everyone's 👀 count goes up
    return new Response(null, { status: 101, webSocket: client });
  }

  async onMessage(ws, data) {
    if (typeof data !== 'string' || data.length > 4000) return;
    let m;
    try { m = JSON.parse(data); } catch (e) { return; }
    if (!m || typeof m !== 'object' || typeof m.type !== 'string') return;
    const info = this.sockets.get(ws);
    if (!info) return;
    let err = null, notice = null;
    if (m.type === 'watch') {
      info.room = this.clampRoom(m.room, info.room);
    } else if (m.type === 'identify') {
      // Watching is anonymous; signing in puts your name on the 👀 list, lets you
      // react, and puts you back in your seat if you have one (a reload, a phone waking up).
      const user = await this.user(m);
      if (!this.sockets.has(ws)) return; // closed while we looked the user up
      if (!user) return;
      info.as = user;
      const t = this.tableOf(user.key);
      if (t && t.rejoin(user.key)) { info.key = user.key; info.room = this.tables.indexOf(t) + 1; }
    } else if (m.type === 'react') {
      // Anyone signed in at the table can react, seated or not; the target is
      // someone seated at the table being watched (the bot too).
      const to = String(m.target || '').toLowerCase();
      const bare = s => String(s || '').replace(/^🤖\s*/, '').toLowerCase();
      const seat = this.tables[info.room - 1].seats.find(s => s && to && (s.key === to || bare(s.name) === bare(to)));
      if (!info.as) err = '先登录再发表情';
      else if (!seat) err = '把表情拖到一个在座的人身上';
      else {
        let list = this.reactions.get(info.room);
        if (!list) this.reactions.set(info.room, list = []);
        noteReaction(list, { by: info.as.key, byName: info.as.name, to, value: m.value }, Date.now());
      }
    } else if (m.type === 'sit') {
      const user = await this.user(m);
      if (!this.sockets.has(ws)) return;
      if (!user) err = '先登录再坐下';
      else {
        const room = this.clampRoom(m.room, info.room);
        const here = this.tables[room - 1], elsewhere = this.tableOf(user.key);
        const away = elsewhere && elsewhere !== here ? this.tables.indexOf(elsewhere) + 1 : 0;
        if (away && elsewhere.phase === 'playing' && !elsewhere.vsBot()) err = '你在桌 ' + away + ' 下着呢，先下完或者认输';
        else {
          const before = info.key;
          // one seat per person: the new seat first (a full table leaves you where you were), then off the old one
          err = here.sit(user.key, user.name, { seat: m.seat }, this.saved.get(user.key));
          if (!err && away && elsewhere.leave(user.key) === 'paused') notice = '桌 ' + away + ' 那局存好了，下次一个人坐下接着下';
          info.room = room;
          info.as = user;
          info.key = this.tableOf(user.key) ? user.key : null;
          // this tab was someone else (they switched user): that person's seat loses a tab
          if (before && before !== user.key && ![...this.sockets.values()].some(o => o.key === before)) this.tableOf(before)?.disconnect(before);
        }
      }
    } else if (m.type === 'leave') {
      const t = this.tableOf(info.key);
      if (t && t.leave(info.key) === 'paused') notice = '这局存好了，下次一个人坐下就接着下';
      for (const o of this.sockets.values()) if (o.key === info.key && !this.tableOf(o.key)) o.key = null;
      info.key = null;
    } else if (Object.hasOwn(ACTIONS, m.type)) { // (not '__proto__', 'toString' …)
      const t = this.tableOf(info.key);
      err = t ? ACTIONS[m.type](t, info.key, m) : '先坐下';
    } else return; // not a message this room knows: ignore it
    if (err || notice) this.send(ws, err ? { error: err } : { notice });
    this.changed(err || notice ? ws : null);
  }

  onClose(ws) {
    const info = this.sockets.get(ws);
    if (!info) return;
    this.sockets.delete(ws);
    if (info.key && ![...this.sockets.values()].some(o => o.key === info.key)) this.tableOf(info.key)?.disconnect(info.key);
    if (!this.sockets.size) { clearInterval(this.sweeper); this.sweeper = null; }
    this.changed();
  }

  sweep() {
    const gone = this.tables.flatMap(t => t.sweepIdle());
    if (!gone.length) return;
    for (const [ws, o] of this.sockets) {
      if (gone.includes(o.key) && !this.tableOf(o.key)) { o.key = null; this.send(ws, { notice: '太久没动，帮你站起来了' }); }
    }
    this.changed();
  }

  // Who's watching a table: everyone looking at it but not playing at it
  // (people not signed in count, but only the signed-in have names).
  watchers(room) {
    const t = this.tables[room - 1], names = new Map();
    let anon = 0;
    for (const o of this.sockets.values()) {
      if (o.room !== room) continue;
      const k = o.key || o.as?.key;
      if (k && t.has(k)) continue;
      if (o.as) names.set(o.as.key, o.as.name); else anon++;
    }
    return { n: names.size + anon, names: [...names.values()] };
  }
  lobby() {
    return this.tables.map((t, i) => ({
      room: i + 1, phase: t.phase,
      people: t.humans().map(s => s.name),
      bots: t.seats.filter(s => s && s.bot).length,
      watching: this.watchers(i + 1).n,
    }));
  }
  ranking() {
    return [...this.records].sort(byWins).map(([k, r]) => [k, { name: r.name, wins: r.wins, games: r.games, draws: r.draws || 0 }]);
  }
  send(ws, extra = {}, shared = null) {
    const info = this.sockets.get(ws);
    if (!info) return;
    const s = shared || { lobby: this.lobby(), ranking: this.ranking(), watch: {} };
    const watch = s.watch[info.room] ||= this.watchers(info.room);
    const seatedAt = this.tables.findIndex(t => t.has(info.key)) + 1;
    try {
      ws.send(JSON.stringify({ type: 'state', room: info.room, seatedAt, you: info.key,
        table: this.tables[info.room - 1].view(info.key), lobby: s.lobby, watch,
        reactions: freshReactions(this.reactions.get(info.room) || [], Date.now()),
        ...topFor(s.ranking, info.as?.key || info.key), ...extra }));
    } catch (e) { /* socket already gone; its close handler cleans up */ }
  }
  broadcast(skip) {
    const shared = { lobby: this.lobby(), ranking: this.ranking(), watch: {} };
    for (const ws of this.sockets.keys()) if (ws !== skip) this.send(ws, {}, shared);
  }
}
