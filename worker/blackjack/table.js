import { BJ, BlackjackGame } from './game.js';
import { cleanName, getUsers, sameName } from '../users/users.js';
import { noteReaction, freshReactions } from '../games/reactions.js';
import { j } from '../lib/http.js';
import { topFor } from '../lib/board.js';

// The Durable Object: WebSockets in, game state out. Every client gets the
// whole table after each change. Saved chips live in this object's storage
// under p:<name> (written after every hand). The table itself is written to
// t:1 whenever it changes and read back when the object starts, so a deploy
// carries the hand on; people who were seated get RECONNECT_MS to come back
// (the page sits again by itself) before they count as gone.
const RECONNECT_MS = 90 * 1000;
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
    return this.loaded ||= (async () => {
      for (const [k, v] of await this.state.storage.list({ prefix: 'p:' })) this.board.set(k.slice(2), v);
      const json = await this.state.storage.get('t:1');
      if (!json) return;
      this.written = json;
      if (!this.game.restore(JSON.parse(json))) return;
      for (const s of this.game.seats) s.connected = true; // until RECONNECT_MS says otherwise
      this.game.resume();
      if (this.game.seats.length) this.ghostTimer = setTimeout(() => this.dropGhosts(), RECONNECT_MS);
    })();
  }
  // After a restart: whoever hasn't come back counts as gone (as when a page closes).
  dropGhosts() {
    const here = new Set([...this.sockets.values()].filter(Boolean));
    for (const s of [...this.game.seats]) if (!here.has(s.key)) this.game.disconnect(s.key);
    this.broadcast();
  }
  // Write the table when it changed since it was last written.
  persist() {
    const json = JSON.stringify(this.game.snapshot());
    if (json === this.written) return;
    this.written = json;
    this.state.storage.put('t:1', json);
  }
  save(s) {
    const rec = { name: s.name, chips: s.chips, refills: s.refills, updatedAt: Date.now() };
    this.board.set(s.key, rec);
    this.state.storage.put('p:' + s.key, rec);
  }
  // Internal scrub, same contract as TableHall.scrubUser: a retired
  // account's saved chips (users/retire.js), through the binding only —
  // the public worker never routes /scrub-user here.
  async scrubUser(request) {
    const body = await request.json().catch(() => null) || {};
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
    if (request.method === 'POST' && new URL(request.url).pathname === '/scrub-user') return this.scrubUser(request);
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
  // Ranked by what you've actually won: chips now minus everything you were
  // handed (1000 to start + 1000 per 补给). It goes negative, so going broke and
  // getting refilled over and over doesn't climb the board.
  // Everyone, best first: [key, row]. Only the top 3 go out, plus each viewer's own place (lib/board.js).
  ranking() {
    const rows = new Map(this.board);
    for (const s of this.game.seats) rows.set(s.key, { name: s.name, chips: s.chips, refills: s.refills, seated: true });
    return [...rows].map(([k, r]) => [k, { ...r, net: r.chips - BJ.startChips * (1 + (r.refills || 0)) }])
      .sort(([, a], [, b]) => b.net - a.net || b.chips - a.chips);
  }
  send(ws, extra) {
    try { ws.send(JSON.stringify({ type: 'state', table: this.game.view(), you: this.sockets.get(ws), reactions: freshReactions(this.reactions, Date.now()), ...topFor(this.ranking(), this.ident.get(ws)?.key || this.sockets.get(ws)), ...extra })); }
    catch (e) { /* socket already gone; its close handler cleans up */ }
  }
  // Every change ends here, so it's also where the table gets written.
  broadcast(skip) {
    this.persist();
    for (const ws of this.sockets.keys()) if (ws !== skip) this.send(ws);
  }
}
