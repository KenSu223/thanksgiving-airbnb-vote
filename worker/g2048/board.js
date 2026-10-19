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
// Messages in:  { type: 'hello', name, token }  { type: 'move', dir, n }  { type: 'new' }  { type: 'keep' }
//   n is how many moves the page thinks the game has had; a move from a stale
//   tab (another tab moved first) is refused and that tab gets the real board.
// Messages out: { type: 'state', you, game, best, board?, spawn?, error? }
import { getUsers, sameName, cleanName } from '../users/users.js';
import { j } from '../lib/http.js';
import { topFor } from '../lib/board.js';
import { DIRS, GOAL, move, spawn, fresh, canMove, maxTile } from '../../web/src/features/g2048/logic.js';

const FLUSH_MS = 2000;
const rand = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;

// Records put right by hand, each exactly once ([flag, key, biggest tile]): the
// flag keeps what was there before, and a later record of the same person is
// never touched. The best goes back to that tile; the best score only to what
// can still be told apart (her saved game, if that one is hers), since only the
// maxima are kept. A saved game with a bigger tile than that isn't theirs, so
// it's dropped too (otherwise its next move would put the record straight back).
// 2026-10-19: aster's 4096 (58,248 分) was a friend playing on her account; her own biggest was 128.
const FIX_ONCE = [['fixed:aster:2026-10-19', 'aster', 128]];

export class Board2048 {
  constructor(state, env) {
    this.state = state; this.env = env;
    this.sockets = new Map(); // socket -> { key, name } once hello is proven, else null
    this.games = new Map();   // key -> { grid, score, moves, over, won, keep, startedAt, updatedAt }
    this.best = new Map();    // key -> { name, tile, score, games, at }
    this.dirty = new Set(); this.flushing = null; this.boardTimer = null;
    this.loaded = null;
  }
  load() {
    return this.loaded ||= this.state.storage.list({ prefix: 'p:' })
      .then(async m => {
        for (const [k, v] of m) this.best.set(k.slice(2), v);
        // what the removed autopilot left behind: its grant list, its sessions and their alarm
        await this.state.storage.delete(['grants', 'bots']);
        await this.state.storage.deleteAlarm();
        for (const [flag, key, tile] of FIX_ONCE) {
          if (await this.state.storage.get(flag)) continue;
          const was = this.best.get(key) || null, game = (await this.state.storage.get('g:' + key)) || null;
          const theirs = game && maxTile(game.grid) <= tile;
          if (was) {
            const rec = { ...was, tile: Math.min(was.tile, tile), score: theirs ? Math.min(was.score, game.score) : 0, at: Date.now() };
            this.best.set(key, rec);
            await this.state.storage.put('p:' + key, rec);
          }
          if (game && !theirs) await this.state.storage.delete('g:' + key);
          await this.state.storage.put(flag, { at: Date.now(), was, game });
        }
      });
  }
  // An autopilot alarm set before it was removed may still fire once: nothing to do.
  async alarm() {}

  async fetch(request) {
    if (request.method === 'POST' && new URL(request.url).pathname === '/scrub-user') return this.scrubUser(request);
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    await this.load();
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    this.sockets.set(server, null);
    server.addEventListener('message', e => this.onMessage(server, e.data));
    server.addEventListener('close', () => this.onClose(server));
    server.addEventListener('error', () => this.onClose(server));
    this.send(server, { board: true });
    return new Response(null, { status: 101, webSocket: client });
  }

  // Internal only: a retired account's records (users/retire.js) through the
  // binding — the public worker routes only /api/2048 here, never /scrub-user.
  async scrubUser(request) {
    const body = await request.json().catch(() => null) || {};
    await this.load();
    const key = cleanName(body.target).toLowerCase();
    if (!key) return j({ ok: true, removed: 0 });
    const removed = this.best.delete(key) ? 1 : 0;
    this.games.delete(key); this.dirty.delete(key);
    await this.state.storage.delete(['p:' + key, 'g:' + key]);
    for (const [ws, who] of this.sockets) if (who?.key === key) this.sockets.set(ws, null);
    this.broadcastBoard();
    return j({ ok: true, removed });
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
      return this.send(ws, { game, best: this.bestOf(key), board: true });
    }
    const who = this.sockets.get(ws);
    if (!who) return this.send(ws, { error: '先登录再玩' });
    const game = this.games.get(who.key);
    if (!game) return this.send(ws, { error: '先登录再玩' });
    if (m.type === 'new') {
      const g = this.newGame(who.key, who.name);
      this.flush(who.key);
      return this.sendTo(who.key, { game: g, best: this.bestOf(who.key), board: true });
    }
    if (m.type === 'keep') { game.keep = true; this.touch(who.key); return this.sendTo(who.key, { game }); }
    if (m.type !== 'move') return;
    if (!DIRS.includes(m.dir)) return this.send(ws, { error: '不认识的方向', game });
    if (m.n !== game.moves) return this.send(ws, { game, stale: true }); // another tab moved first: here's the real board
    if (game.over) return this.send(ws, { game });
    const r = move(game.grid, m.dir);
    if (!r.moved) return this.send(ws, { game, still: true });
    const s = spawn(r.grid, rand);
    game.grid = s.grid; game.score += r.gained; game.moves++; game.updatedAt = Date.now();
    if (maxTile(game.grid) >= GOAL) game.won = true;
    if (!canMove(game.grid)) game.over = true;
    const improved = this.noteBest(who.key, who.name, game);
    this.touch(who.key);
    if (game.over) this.flush(who.key);
    this.sendTo(who.key, { game, best: this.bestOf(who.key), spawn: { at: s.at, v: s.v }, dir: m.dir });
    if (improved === 'tile' || (improved && game.over)) this.broadcastBoard();
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
    const g = { grid: fresh(rand), score: 0, moves: 0, over: false, won: false, keep: false, startedAt: now, updatedAt: now };
    this.games.set(key, g);
    const b = this.best.get(key) || { name, tile: 0, score: 0, games: 0, at: now };
    this.best.set(key, { ...b, name, games: b.games + 1, tile: Math.max(b.tile, maxTile(g.grid)) });
    this.dirty.add(key);
    return g;
  }
  // Biggest tile and best score so far: 'tile' / 'score' when one got better, else false.
  noteBest(key, name, game) {
    const b = this.best.get(key) || { name, tile: 0, score: 0, games: 1, at: Date.now() };
    const tile = maxTile(game.grid);
    if (tile <= b.tile && game.score <= b.score) return false;
    this.best.set(key, { ...b, name, tile: Math.max(b.tile, tile), score: Math.max(b.score, game.score), at: tile > b.tile ? Date.now() : b.at });
    return tile > b.tile ? 'tile' : 'score';
  }
  bestOf(key) { const b = this.best.get(key); return b ? { tile: b.tile, score: b.score, games: b.games } : null; }
  // Everyone, best first: [key, row]. Only the top 3 go out, plus each viewer's own place (lib/board.js).
  ranking() {
    return [...this.best].sort(([, a], [, b]) => b.tile - a.tile || b.score - a.score || a.at - b.at)
      .map(([k, b]) => [k, { name: b.name, tile: b.tile, score: b.score, games: b.games }]);
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

  // extra.board: true = this viewer's board (the top 3 and their own place)
  send(ws, extra) {
    const who = this.sockets.get(ws);
    if (extra.board) extra = { ...extra, ...topFor(this.ranking(), who?.key) };
    try { ws.send(JSON.stringify({ type: 'state', you: who?.key || null, ...extra })); }
    catch (e) { /* socket already gone; its close handler cleans up */ }
  }
  // Every tab of this person (the game moved in one of them)
  sendTo(key, extra) { for (const [ws, who] of this.sockets) if (who?.key === key) this.send(ws, extra); }
  // The board changed: everyone watching gets it (the mover already has their own state)
  broadcastBoard() {
    clearTimeout(this.boardTimer); this.boardTimer = null;
    for (const ws of this.sockets.keys()) this.send(ws, { board: true });
  }
  boardSoon() { if (!this.boardTimer) this.boardTimer = setTimeout(() => this.broadcastBoard(), 5000); }
}
