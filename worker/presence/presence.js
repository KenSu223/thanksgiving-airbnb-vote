// Presence: one Durable Object (WebSocket /api/presence) that knows who
// has the app open right now — and, for everyone else, when they last
// did. The app holds one of these sockets whenever it's in front of
// someone (web/src/session/PresenceContext.jsx); the games already work
// the same way — a hidden or closed app drops its socket, so "online"
// here honestly means "the app is open on their screen somewhere".
//
// Messages in:  { type: 'hello', name, token, game? }  { type: 'ping', game? }
//               { type: 'activity', game }
//   hello is proven against the user list (a name alone doesn't put you
//   online — anyone with the link can read the roster, like /api/users,
//   but faking someone else's presence takes their token). ping every
//   ~25 s just refreshes lastSeen, so if this object is evicted without
//   a close event the time is still about right. game is the Gameroom
//   game the person is in right now (a key from GAME_KEYS below, sent
//   with hello/ping and on its own whenever it changes) — the games-tab
//   roster shows it as 「在玩 X」; anything not on the list becomes null.
// Messages out: { type: 'roster', users: [{ name, online, lastSeen, game }] }
//   Sent on connect and broadcast whenever someone comes or goes.
//   lastSeen is null for people who have never opened the app since
//   this shipped. GET /api/presence returns the same roster as JSON.
//
// lastSeen lives in this object's storage as one small object ('seen'),
// written on every arrival/departure, and at most every 30 s per person
// on pings — the roster itself is rebuilt from the user list each time,
// so a deleted account vanishes from it on its own.
import { getUsers, sameName, cleanName } from '../users/users.js';
import { j } from '../lib/http.js';

const SEEN_WRITE_MS = 30000;
// The Gameroom's game keys (web/src/features/games/GamesView.jsx GAMES) —
// the only values a roster entry's game can take.
const GAME_KEYS = new Set(['bj', 'ddz', 'gd', 'mj', 'dodge', '2048', 'uc', 'av', 'ww']);
const cleanGame = g => (GAME_KEYS.has(g) ? g : null);

export class PresenceDO {
  constructor(state, env) {
    this.state = state; this.env = env;
    this.sockets = new Map(); // socket -> { key, name } once hello is proven, else null
    this.seen = new Map();    // key -> last-seen ms
    this.written = new Map(); // key -> last-seen ms as last persisted (ping throttle)
    this.loaded = null;
  }
  load() {
    return this.loaded ||= this.state.storage.get('seen').then(s => {
      if (s && typeof s === 'object') for (const [k, v] of Object.entries(s)) { this.seen.set(k, v); this.written.set(k, v); }
    });
  }

  onlineKeys() { const s = new Set(); for (const who of this.sockets.values()) if (who) s.add(who.key); return s; }
  // key -> the game one of their sockets is in (first found), if any
  gamesByKey() { const m = new Map(); for (const who of this.sockets.values()) if (who && who.game && !m.has(who.key)) m.set(who.key, who.game); return m; }
  async roster() {
    const users = await getUsers(this.env);
    const online = this.onlineKeys();
    const games = this.gamesByKey();
    return users
      .map(u => ({ name: u.name, online: online.has(u.name.toLowerCase()), lastSeen: this.seen.get(u.name.toLowerCase()) || null, game: games.get(u.name.toLowerCase()) || null }))
      .sort((a, b) => (b.online - a.online) || ((b.lastSeen || 0) - (a.lastSeen || 0)) || a.name.localeCompare(b.name, 'zh-CN'));
  }
  send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch (e) { /* socket already gone; its close handler cleans up */ } }
  async broadcast() { const users = await this.roster(); for (const ws of this.sockets.keys()) this.send(ws, { type: 'roster', users }); }

  // Refresh lastSeen; persist right away on arrivals/departures,
  // throttled on pings.
  stamp(key, force) {
    const now = Date.now();
    this.seen.set(key, now);
    if (force || now - (this.written.get(key) || 0) >= SEEN_WRITE_MS) {
      this.written.set(key, now);
      this.state.storage.put('seen', Object.fromEntries(this.seen));
    }
  }

  async fetch(request) {
    await this.load();
    // An upgrade request is a GET too — it has to be checked first,
    // or the handshake gets the JSON roster and dies.
    if (request.headers.get('Upgrade') !== 'websocket') {
      if (request.method === 'GET') return j({ ok: true, users: await this.roster() });
      return new Response('Expected a WebSocket', { status: 426 });
    }
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    this.sockets.set(server, null);
    server.addEventListener('message', e => this.onMessage(server, e.data));
    server.addEventListener('close', () => this.onClose(server));
    server.addEventListener('error', () => this.onClose(server));
    this.send(server, { type: 'roster', users: await this.roster() });
    return new Response(null, { status: 101, webSocket: client });
  }

  async onMessage(ws, data) {
    let m;
    try { m = JSON.parse(data); } catch (e) { return; }
    if (!this.sockets.has(ws)) return;
    if (m.type === 'hello') {
      const users = await getUsers(this.env);
      const user = users.find(u => sameName(u.name, cleanName(m.name)));
      if (!this.sockets.has(ws)) return; // closed while we looked the user up
      if (!user || !m.token || user.token !== m.token) return this.send(ws, { type: 'error', error: '先登录' });
      const who = { key: user.name.toLowerCase(), name: user.name, game: cleanGame(m.game) };
      const wasOnline = this.onlineKeys().has(who.key);
      this.sockets.set(ws, who);
      this.stamp(who.key, true);
      if (wasOnline) this.send(ws, { type: 'roster', users: await this.roster() });
      else await this.broadcast();
      return;
    }
    const who = this.sockets.get(ws);
    if (!who) return;
    if (m.type === 'ping') {
      this.stamp(who.key, false);
      // A ping can carry the current game too, so a missed activity
      // message heals itself within one ping interval.
      if ('game' in m && cleanGame(m.game) !== who.game) { who.game = cleanGame(m.game); await this.broadcast(); }
    }
    if (m.type === 'activity') {
      const g = cleanGame(m.game);
      if (g !== who.game) { who.game = g; await this.broadcast(); }
    }
  }

  async onClose(ws) {
    const who = this.sockets.get(ws);
    if (!this.sockets.has(ws)) return;
    try { ws.close(1000, 'bye'); } catch (e) { /* already closed */ }
    this.sockets.delete(ws);
    if (who && !this.onlineKeys().has(who.key)) {
      this.stamp(who.key, true); // the moment they left is the lastSeen
      await this.broadcast();
    }
  }
}
