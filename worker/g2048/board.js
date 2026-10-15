// 2048: one Durable Object (WebSocket /api/2048) for everyone. The server owns
// every board: the page sends a direction, the server slides the tiles
// (web/src/features/g2048/logic.js) and drops in the new tile itself, so a board
// can't be made up. Each person has one game in progress; leaving, refreshing or
// switching devices picks it up where it was.
//
// Games are kept in memory and written to this object's storage a couple of
// seconds after they change (g:<name>), right away when someone's last tab
// closes or the game ends — so a deploy loses at most a couple of seconds of
// moves, and a long game isn't a storage write per move. Each person's best
// (biggest tile, then best score) is p:<name>; the board ranks by tile, then score.
//
// Messages in:  { type: 'hello', name, token }  { type: 'move', dir, n, bot? }  { type: 'new' }  { type: 'keep' }
//   n is how many moves the page thinks the game has had; a move from a stale
//   tab (another tab moved first) is refused and that tab gets the real board.
//   A move made by the autopilot (web/src/features/g2048/bot.js) carries
//   bot: true: the game is then a bot game for good, and a best set in it
//   is marked 🤖 on the board — same honesty rule as the Dodge autopilot,
//   whose runs the server replay flags. Who may use the autopilot is a
//   grant, exactly like Dodge's (worker/dodge/board.js):
//   GET  /api/2048/grants?name&token               -> { canBot, isAdmin, grants }
//   POST /api/2048/grants { name, token, target, on }  (PM only)
// Messages out: { type: 'state', you, game, best, board?, spawn?, error? }
import { getUsers, sameName, cleanName, USER_ADMIN } from '../users/users.js';
import { j } from '../lib/http.js';
import { DIRS, GOAL, move, spawn, fresh, canMove, maxTile } from '../../web/src/features/g2048/logic.js';

const FLUSH_MS = 2000;
const rand = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;

export class Board2048 {
  constructor(state, env) {
    this.state = state; this.env = env;
    this.sockets = new Map(); // socket -> { key, name } once hello is proven, else null
    this.games = new Map();   // key -> { grid, score, moves, over, won, keep, bot, startedAt, updatedAt }
    this.best = new Map();    // key -> { name, tile, score, games, at, bot }
    this.grants = new Set();  // lower-cased names PM has allowed the autopilot
    this.dirty = new Set(); this.flushing = null; this.boardTimer = null;
    this.loaded = null;
  }
  load() {
    return this.loaded ||= Promise.all([
      this.state.storage.list({ prefix: 'p:' }),
      this.state.storage.get('grants'),
    ]).then(([m, g]) => {
      for (const [k, v] of m) this.best.set(k.slice(2), v);
      if (Array.isArray(g)) for (const k of g) this.grants.add(k);
    });
  }

  async fetch(request) {
    if (request.method === 'GET' && new URL(request.url).pathname.endsWith('/grants')) {
      await this.load();
      const q = new URL(request.url).searchParams;
      return this.grantsView(await this.caller(q.get('name'), q.get('token')));
    }
    if (request.method === 'POST' && new URL(request.url).pathname.endsWith('/grants')) {
      await this.load();
      const body = await request.json().catch(() => null) || {};
      return this.setGrant(body);
    }
    if (request.method === 'POST' && new URL(request.url).pathname.endsWith('/scrub-user')) return this.scrubUser(request);
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    await this.load();
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    this.sockets.set(server, null);
    server.addEventListener('message', e => this.onMessage(server, e.data));
    server.addEventListener('close', () => this.onClose(server));
    server.addEventListener('error', () => this.onClose(server));
    this.send(server, { board: this.top() });
    return new Response(null, { status: 101, webSocket: client });
  }

  // Internal, called by POST /api/users/delete through the binding (never
  // publicly routed); the caller still has to prove it is PM.
  async scrubUser(request) {
    const body = await request.json().catch(() => null) || {};
    const users = await getUsers(this.env);
    const by = users.find(u => sameName(u.name, cleanName(body.byName)));
    if (!by || !body.byToken || by.token !== body.byToken || !sameName(by.name, USER_ADMIN)) {
      return j({ ok: false, error: '只有 PM 能清游戏记录' }, 403);
    }
    await this.load();
    const key = cleanName(body.target).toLowerCase();
    if (!key) return j({ ok: true, removed: 0 });
    const removed = this.best.delete(key) ? 1 : 0;
    this.games.delete(key); this.dirty.delete(key);
    if (this.grants.delete(key)) await this.state.storage.put('grants', [...this.grants]);
    await this.state.storage.delete(['p:' + key, 'g:' + key]);
    for (const [ws, who] of this.sockets) if (who?.key === key) this.sockets.set(ws, null);
    this.broadcastBoard();
    return j({ ok: true, removed });
  }

  // The account behind a name + token, or null (same check as Dodge's).
  async caller(name, token) {
    const users = await getUsers(this.env);
    const user = users.find(u => sameName(u.name, cleanName(name)));
    return user && token && user.token === token ? user : null;
  }

  // Who may flip the autopilot on: PM always (he's the admin who hands
  // it out), plus anyone he has granted. Only PM sees the grant list.
  async grantsView(me) {
    const users = await getUsers(this.env);
    const isAdmin = !!me && sameName(me.name, USER_ADMIN);
    const nameOf = k => { const u = users.find(x => x.name.toLowerCase() === k); return u ? u.name : k; };
    return j({
      ok: true,
      isAdmin,
      canBot: isAdmin || (!!me && this.grants.has(me.name.toLowerCase())),
      grants: isAdmin ? [...this.grants].map(nameOf).sort((a, b) => a.localeCompare(b, 'zh-CN')) : [],
    });
  }

  async setGrant({ name, token, target, on }) {
    const me = await this.caller(name, token);
    if (!me || !sameName(me.name, USER_ADMIN)) return j({ ok: false, error: '只有 PM 能授权外挂' }, 403);
    const users = await getUsers(this.env);
    const t = users.find(u => sameName(u.name, cleanName(target)));
    if (!t) return j({ ok: false, error: '没有这个人' }, 404);
    const key = t.name.toLowerCase();
    if (on) this.grants.add(key); else this.grants.delete(key);
    await this.state.storage.put('grants', [...this.grants]);
    return this.grantsView(me);
  }

  async onMessage(ws, data) {
    let m;
    try { m = JSON.parse(data); } catch (e) { return; }
    if (!this.sockets.has(ws)) return;
    if (m.type === 'hello') {
      const users = await getUsers(this.env);
      const user = users.find(u => sameName(u.name, cleanName(m.name)));
      if (!this.sockets.has(ws)) return; // closed while we looked the user up
      if (!user || !m.token || user.token !== m.token) return this.send(ws, { error: '先登录再玩' });
      const key = user.name.toLowerCase();
      this.sockets.set(ws, { key, name: user.name });
      const game = await this.gameOf(key, user.name);
      if (!this.sockets.has(ws)) return;
      return this.send(ws, { game, best: this.bestOf(key), board: this.top() });
    }
    const who = this.sockets.get(ws);
    if (!who) return this.send(ws, { error: '先登录再玩' });
    const game = this.games.get(who.key);
    if (!game) return this.send(ws, { error: '先登录再玩' });
    if (m.type === 'new') {
      const g = this.newGame(who.key, who.name);
      this.flush(who.key);
      return this.sendTo(who.key, { game: g, best: this.bestOf(who.key), board: this.top() });
    }
    if (m.type === 'keep') { game.keep = true; this.touch(who.key); return this.sendTo(who.key, { game }); }
    if (m.type !== 'move') return;
    if (!DIRS.includes(m.dir)) return this.send(ws, { error: '不认识的方向', game });
    if (m.n !== game.moves) return this.send(ws, { game, stale: true }); // another tab moved first: here's the real board
    if (game.over) return this.send(ws, { game });
    const r = move(game.grid, m.dir);
    if (!r.moved) return this.send(ws, { game, still: true });
    if (m.bot) game.bot = true; // 一个外挂步子，这局就是外挂局了
    const s = spawn(r.grid, rand);
    game.grid = s.grid; game.score += r.gained; game.moves++; game.updatedAt = Date.now();
    if (maxTile(game.grid) >= GOAL) game.won = true;
    if (!canMove(game.grid)) game.over = true;
    const improved = this.noteBest(who.key, who.name, game);
    // 这局刚变成外挂局、而排行榜上那条纪录正是这局打的（from 对得上）：
    // 就算这一步没刷新纪录，纪录也从这一刻起是外挂的了
    let marked = false;
    if (game.bot) {
      const b = this.best.get(who.key);
      if (b && b.from === game.startedAt && !b.bot) { this.best.set(who.key, { ...b, bot: true }); marked = true; }
    }
    this.touch(who.key);
    if (game.over) this.flush(who.key);
    this.sendTo(who.key, { game, best: this.bestOf(who.key), spawn: { at: s.at, v: s.v }, dir: m.dir });
    if (improved === 'tile' || (improved && game.over) || marked) this.broadcastBoard();
    else if (improved) this.boardSoon(); // a better score: the board catches up within a few seconds
  }

  onClose(ws) {
    const who = this.sockets.get(ws);
    if (!this.sockets.has(ws)) return;
    try { ws.close(1000, 'bye'); } catch (e) { /* already closed */ }
    this.sockets.delete(ws);
    if (who && ![...this.sockets.values()].some(o => o?.key === who.key)) {
      this.flush(who.key);
      this.games.delete(who.key); // back from storage next time; keeps memory to the people playing
    }
  }

  // The game in progress (from memory, else storage, else a new one).
  async gameOf(key, name) {
    if (this.games.has(key)) return this.games.get(key);
    const saved = await this.state.storage.get('g:' + key);
    if (this.games.has(key)) return this.games.get(key); // another tab got here first
    if (saved) { this.games.set(key, saved); return saved; }
    const g = this.newGame(key, name);
    this.flush(key);
    return g;
  }
  newGame(key, name) {
    const now = Date.now();
    const g = { grid: fresh(rand), score: 0, moves: 0, over: false, won: false, keep: false, bot: false, startedAt: now, updatedAt: now };
    this.games.set(key, g);
    const b = this.best.get(key) || { name, tile: 0, score: 0, games: 0, at: now, from: now, bot: false };
    this.best.set(key, { ...b, name, games: b.games + 1, tile: Math.max(b.tile, maxTile(g.grid)) });
    this.dirty.add(key);
    return g;
  }
  // Biggest tile and best score so far: 'tile' / 'score' when one got better, else false.
  // The bot mark follows the record: when a game takes the record over
  // (a bigger tile, or the same tile with a better score) its bot flag
  // becomes the record's; a bot game that only lifts the score under an
  // existing tile still leaves its mark, since that score is displayed.
  // `from` is the startedAt of the game that set the tile on record, so
  // the move handler can mark a record the moment its own game turns
  // bot; records from before the autopilot have no `from` and are
  // never marked after the fact.
  noteBest(key, name, game) {
    const b = this.best.get(key) || { name, tile: 0, score: 0, games: 1, at: Date.now() };
    const tile = maxTile(game.grid);
    if (tile <= b.tile && game.score <= b.score) return false;
    const holder = tile > b.tile || (tile === b.tile && game.score > b.score);
    const bot = holder ? !!game.bot : (!!b.bot || !!game.bot);
    this.best.set(key, { ...b, name, tile: Math.max(b.tile, tile), score: Math.max(b.score, game.score), at: tile > b.tile ? Date.now() : b.at, bot, from: holder ? game.startedAt : b.from });
    return tile > b.tile ? 'tile' : 'score';
  }
  bestOf(key) { const b = this.best.get(key); return b ? { tile: b.tile, score: b.score, games: b.games, bot: !!b.bot } : null; }
  top() {
    return [...this.best.values()].sort((a, b) => b.tile - a.tile || b.score - a.score || a.at - b.at).slice(0, 50)
      .map(b => ({ name: b.name, tile: b.tile, score: b.score, games: b.games, bot: !!b.bot }));
  }

  // Writes: a couple of seconds after a change, or right away (flush).
  touch(key) {
    this.dirty.add(key);
    if (!this.flushing) this.flushing = setTimeout(() => { this.flushing = null; this.flushAll(); }, FLUSH_MS);
  }
  flushAll() { for (const key of [...this.dirty]) this.flush(key); }
  flush(key) {
    if (!this.dirty.delete(key)) return;
    const g = this.games.get(key), b = this.best.get(key), put = {};
    if (g) put['g:' + key] = g;
    if (b) put['p:' + key] = b;
    if (Object.keys(put).length) this.state.storage.put(put);
  }

  send(ws, extra) {
    const who = this.sockets.get(ws);
    try { ws.send(JSON.stringify({ type: 'state', you: who?.key || null, ...extra })); }
    catch (e) { /* socket already gone; its close handler cleans up */ }
  }
  // Every tab of this person (the game moved in one of them)
  sendTo(key, extra) { for (const [ws, who] of this.sockets) if (who?.key === key) this.send(ws, extra); }
  // The board changed: everyone watching gets it (the mover already has their own state)
  broadcastBoard() {
    clearTimeout(this.boardTimer); this.boardTimer = null;
    const board = this.top();
    for (const ws of this.sockets.keys()) this.send(ws, { board });
  }
  boardSoon() { if (!this.boardTimer) this.boardTimer = setTimeout(() => this.broadcastBoard(), 5000); }
}
