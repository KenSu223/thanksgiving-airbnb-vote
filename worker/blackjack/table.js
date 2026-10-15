import { BlackjackGame } from './game.js';
import { cleanName, getUsers, sameName, USER_ADMIN } from '../users/users.js';
import { noteReaction, freshReactions } from '../games/reactions.js';
import { j } from '../lib/http.js';

// The Durable Object: WebSockets in, game state out. Every client gets the
// whole table after each change. Saved chips live in this object's storage
// under p:<name>.
export class BlackjackTable {
  constructor(state, env) {
    this.state = state; this.env = env;
    this.sockets = new Map(); // socket -> seat key, or null while just watching
    this.ident = new Map(); // socket -> { key, name } once identity is proven (sit or identify) — reactions sign with it
    this.reactions = []; // [{ v, at, by, byName, to }] — addressed emoji/taunt popups, see games/reactions.js
    this.board = new Map();   // saved chips by key
    this.loaded = null; this.sweeper = null;
    this.game = new BlackjackGame({
      now: () => Date.now(),
      rand: () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296,
      schedule: (fn, ms) => setTimeout(() => { fn(); this.broadcast(); }, ms),
      cancel: t => clearTimeout(t),
      save: s => this.save(s),
    });
  }
  load() {
    return this.loaded ||= this.state.storage.list({ prefix: 'p:' })
      .then(m => { for (const [k, v] of m) this.board.set(k.slice(2), v); });
  }
  save(s) {
    const rec = { name: s.name, chips: s.chips, refills: s.refills, updatedAt: Date.now() };
    this.board.set(s.key, rec);
    this.state.storage.put('p:' + s.key, rec);
  }
  // Internal scrub, same contract as TableHall.scrubUser: called by
  // POST /api/users/delete through the binding (never publicly
  // routed), PM-proven, removes the deleted person's saved chips.
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
    if ([...this.sockets.values()].includes(key)) this.game.leave(key);
    const removed = this.board.delete(key) ? 1 : 0;
    await this.state.storage.delete('p:' + key);
    this.broadcast();
    return j({ ok: true, removed });
  }
  async fetch(request) {
    if (request.method === 'POST' && new URL(request.url).pathname.endsWith('/scrub-user')) return this.scrubUser(request);
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    await this.load();
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    this.sockets.set(server, null);
    server.addEventListener('message', e => this.onMessage(server, e.data));
    server.addEventListener('close', () => this.onClose(server));
    server.addEventListener('error', () => this.onClose(server));
    if (!this.sweeper) this.sweeper = setInterval(() => this.sweep(), 60000);
    this.send(server);
    return new Response(null, { status: 101, webSocket: client });
  }
  async onMessage(ws, data) {
    let m;
    try { m = JSON.parse(data); } catch (e) { return; }
    let key = this.sockets.get(ws), err = null;
    if (m.type === 'identify') {
      // Watching is anonymous, but reactions carry a name — prove who
      // you are (same name+token check as sitting) without taking a seat.
      const users = await getUsers(this.env);
      const user = users.find(u => sameName(u.name, cleanName(m.name)));
      if (!this.sockets.has(ws)) return; // closed while we looked the user up
      if (user && user.token === m.token) this.ident.set(ws, { key: user.name.toLowerCase(), name: user.name });
    } else if (m.type === 'react') {
      // Anyone signed in can react — no seat needed — but the target
      // has to be seated here, and the reaction lands on the target,
      // signed with the sender's name.
      const as = this.ident.get(ws);
      if (!as) err = '先登录再发表情';
      else {
        const to = String(m.target || '').toLowerCase();
        if (!to || !this.game.seats.some(s => s.key === to)) err = '把表情拖到一个在座的人身上';
        else noteReaction(this.reactions, { by: as.key, byName: as.name, to, value: m.value }, Date.now());
      }
    } else if (m.type === 'sit') {
      // Only the logged-in user (name + their token from the user list) can sit as themselves.
      const users = await getUsers(this.env);
      const user = users.find(u => sameName(u.name, cleanName(m.name)));
      if (!this.sockets.has(ws)) return; // closed while we looked the user up
      if (!user || user.token !== m.token) err = '先登录再坐下';
      else {
        const k = user.name.toLowerCase();
        if (key && key !== k) this.game.leave(key); // switched to another user in this tab
        for (const [other, ok] of this.sockets) if (ok === k && other !== ws) this.sockets.set(other, null); // a newer tab takes the seat
        err = this.game.sit(k, user.name, this.board.get(k));
        this.sockets.set(ws, err ? null : k);
        if (!err) this.ident.set(ws, { key: k, name: user.name }); // sitting proves identity too (for reactions)
      }
    } else if (!key) err = '先坐下';
    else if (m.type === 'bet') err = this.game.bet(key, m.amount);
    else if (m.type === 'hit' || m.type === 'stand' || m.type === 'double') err = this.game.act(key, m.type);
    else if (m.type === 'leave') { this.game.leave(key); this.sockets.set(ws, null); }
    if (err) this.send(ws, { error: err });
    this.broadcast(err ? ws : null);
  }
  onClose(ws) {
    if (!this.sockets.has(ws)) return;
    // Answer the client's close so the connection actually ends; without this
    // the browser's socket hangs half-closed (and keeps this object busy).
    try { ws.close(1000, 'bye'); } catch (e) { /* already closed */ }
    const key = this.sockets.get(ws);
    this.sockets.delete(ws);
    this.ident.delete(ws);
    if (key && ![...this.sockets.values()].includes(key)) this.game.disconnect(key);
    if (!this.sockets.size) { clearInterval(this.sweeper); this.sweeper = null; }
    this.broadcast();
  }
  sweep() {
    const idle = this.game.sweepIdle();
    if (!idle.length) return;
    for (const [ws, k] of this.sockets) {
      if (idle.includes(k)) { this.sockets.set(ws, null); this.send(ws, { notice: '太久没下注，帮你站起来了，筹码已保存' }); }
    }
    this.broadcast();
  }
  leaderboard() {
    const rows = new Map(this.board);
    for (const s of this.game.seats) rows.set(s.key, { name: s.name, chips: s.chips, refills: s.refills, seated: true });
    return [...rows.values()].sort((a, b) => b.chips - a.chips).slice(0, 30);
  }
  send(ws, extra) {
    try { ws.send(JSON.stringify({ type: 'state', table: this.game.view(), you: this.sockets.get(ws), reactions: freshReactions(this.reactions, Date.now()), board: this.leaderboard(), ...extra })); }
    catch (e) { /* socket already gone; its close handler cleans up */ }
  }
  broadcast(skip) { for (const ws of this.sockets.keys()) if (ws !== skip) this.send(ws); }
}
