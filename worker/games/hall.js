// A game hall: one Durable Object holding a few tables of one table game
// (斗地主, 掼蛋, 川麻). Clients connect over a WebSocket, pick a table to watch,
// and sit down with their login (name + token from the user list). Each viewer
// gets their own view of the table after every change. Points (豆子) are saved
// in this object's storage under p:<name> when a player stands up or
// disconnects, never per hand, so a game never touches the KV write budget.
// Every game has its own hall, so its leaderboard is its own; only its top 3
// go out, plus each viewer's own place (lib/board.js).
//
// A game class needs: sit(key, name, saved), leave(key), disconnect(key),
// has(key), humans(), waitlist, seats, phase, sweepIdle(), view(key). The
// subclass passes `actions`: message type -> (table, key, message) returning an
// error string, { reply } (sent back to that socket only), or nothing.
// sit() also gets the sit message, so a game can let you pick a seat number.
//
// Party games (谁是卧底 / 阿瓦隆 / 狼人杀) pass `rejoin`: a phone going to sleep or a
// page reload must not cost anyone their seat mid-game, so a socket that proves
// who it is (identify) goes straight back to that person's seat, and several
// tabs of one person can all hold it. `boardSort` orders their leaderboard (by wins).
import { getUsers, sameName, cleanName } from '../users/users.js';
import { noteReaction, freshReactions } from './reactions.js';
import { j } from '../lib/http.js';
import { topFor } from '../lib/board.js';

const rand = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;

export class TableHall {
  constructor(state, env, { Game, rooms, actions, idleNotice, rejoin = false, boardSort = null }) {
    this.state = state; this.env = env;
    this.rooms = rooms; this.actions = actions; this.idleNotice = idleNotice;
    this.rejoin = rejoin; this.boardSort = boardSort;
    this.sockets = new Map(); // socket -> { key (seated/queued player, or null), room (1..rooms being watched) }
    this.reactions = new Map(); // room -> [{ v, at, by, byName, to }] — addressed emoji/taunt popups, see reactions.js
    this.board = new Map();   // saved points by player key
    this.loaded = null; this.sweeper = null;
    // Party games run their clocks this many times faster when PARTY_SPEED is set — only
    // the robustness suite sets it (a 狼人杀 night is ~40 s of deliberate waiting otherwise).
    const speed = rejoin ? Math.max(1, Number(env?.PARTY_SPEED) || 1) : 1;
    this.tables = Array.from({ length: rooms }, () => new Game({
      now: () => Date.now(),
      rand,
      schedule: (fn, ms) => setTimeout(() => { fn(); this.broadcast(); }, ms / speed),
      cancel: t => clearTimeout(t),
      save: s => this.save(s),
    }));
  }
  load() {
    return this.loaded ||= this.state.storage.list({ prefix: 'p:' })
      .then(m => { for (const [k, v] of m) this.board.set(k.slice(2), v); });
  }
  save(s) {
    const rec = { name: s.name, points: s.points, refills: s.refills, games: s.games, wins: s.wins, updatedAt: Date.now() };
    this.board.set(s.key, rec);
    this.state.storage.put('p:' + s.key, rec);
  }
  // Internal only: a retired account's records (users/retire.js) through the
  // object binding. The public worker routes only /api/<game> here, never
  // /scrub-user, so a request on this path came from inside.
  // Removes the person's saved points (their 豆子榜 row).
  async scrubUser(request) {
    const body = await request.json().catch(() => null) || {};
    await this.load();
    const key = cleanName(body.target).toLowerCase();
    if (!key) return j({ ok: true, removed: 0 });
    const t = this.tableOf(key);
    if (t?.forget) t.forget(key); // party games: drop the seat without ever saving it again
    else t?.leave(key); // a seated ghost leaves first; the save that lands is deleted next
    const removed = this.board.delete(key) ? 1 : 0;
    await this.state.storage.delete('p:' + key);
    this.broadcast();
    return j({ ok: true, removed });
  }
  tableOf(key) { return key ? this.tables.find(t => t.has(key)) : null; }
  clampRoom(r, fallback = 1) { return Math.min(this.rooms, Math.max(1, Number(r) || fallback)); }

  async fetch(request) {
    if (request.method === 'POST' && new URL(request.url).pathname === '/scrub-user') return this.scrubUser(request);
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    await this.load();
    const room = this.clampRoom(new URL(request.url).searchParams.get('room'));
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    this.sockets.set(server, { key: null, room });
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
    const info = this.sockets.get(ws);
    if (!info) return;
    let err = null, extra = null;
    if (m.type === 'watch') {
      info.room = this.clampRoom(m.room);
    } else if (m.type === 'identify') {
      // Watching is anonymous, but reactions carry a name — prove who
      // you are (same name+token check as sitting) without taking a seat.
      const users = await getUsers(this.env);
      const user = users.find(u => sameName(u.name, cleanName(m.name)));
      if (!this.sockets.has(ws)) return; // closed while we looked the user up
      if (user && user.token === m.token) {
        const key = user.name.toLowerCase();
        info.as = { key, name: user.name };
        const t = this.rejoin && this.tableOf(key);
        if (t) { // back to your seat (sit() just marks you connected again)
          t.sit(key, user.name, this.board.get(key), {});
          info.key = key; info.room = this.tables.indexOf(t) + 1;
        }
      }
    } else if (m.type === 'react') {
      // Anyone signed in at the table can react — no seat needed — but
      // the target has to be seated in the room being watched, and the
      // reaction lands on the target, signed with the sender's name.
      if (!info.as) err = '先登录再发表情';
      else {
        const to = String(m.target || '').toLowerCase();
        const table = this.tables[info.room - 1];
        // Clients address a seat by its display name (that's all the
        // view exposes). Humans' keys happen to equal that, but bots
        // sit under keys like 'bot0' while their display names are
        // '🤖 小黑' — and has()/seatOf() deliberately skip bots, so a
        // name-or-key lookup against has() could never land on a bot.
        // Resolve against the seat list directly; bots are people too.
        const bare = s => String(s || '').replace(/^🤖\s*/, '').toLowerCase();
        const seat = table?.seats?.find(s => s && (s.key === to || bare(s.name) === bare(to)));
        if (!to || !seat) err = '把表情拖到一个在座的人身上';
        else {
          let list = this.reactions.get(info.room);
          if (!list) { list = []; this.reactions.set(info.room, list); }
          noteReaction(list, { by: info.as.key, byName: info.as.name, to, value: m.value }, Date.now());
        }
      }
    } else if (m.type === 'sit') {
      const users = await getUsers(this.env);
      const user = users.find(u => sameName(u.name, cleanName(m.name)));
      if (!this.sockets.has(ws)) return; // closed while we looked the user up
      if (!user || user.token !== m.token) err = '先登录再坐下';
      else {
        const key = user.name.toLowerCase();
        const room = this.clampRoom(m.room, info.room);
        const here = this.tables[room - 1], elsewhere = this.tableOf(key);
        if (elsewhere && elsewhere !== here) elsewhere.leave(key); // one seat per person
        if (info.key && info.key !== key) this.tableOf(info.key)?.leave(info.key); // switched user in this tab
        if (!this.rejoin) for (const [other, o] of this.sockets) if (other !== ws && o.key === key) o.key = null; // a newer tab takes the seat
        err = here.sit(key, user.name, this.board.get(key), m);
        info.room = room;
        info.key = err && !here.has(key) ? null : key; // a refused sit / seat change leaves you where you were
        if (!err) info.as = { key, name: user.name }; // sitting proves identity too (for reactions)
      }
    } else if (!info.key) {
      err = '先坐下';
    } else {
      const t = this.tableOf(info.key), act = this.actions[m.type];
      if (!t) err = '先坐下';
      else if (m.type === 'leave') { t.leave(info.key); info.key = null; }
      else if (act) {
        const r = act(t, info.key, m);
        if (typeof r === 'string') err = r;
        else if (r && r.reply) extra = r.reply;
      }
    }
    if (err || extra) this.send(ws, err ? { error: err } : extra);
    this.broadcast(err || extra ? ws : null);
  }

  onClose(ws) {
    const info = this.sockets.get(ws);
    if (!info) return;
    this.sockets.delete(ws);
    if (info.key && ![...this.sockets.values()].some(o => o.key === info.key)) this.tableOf(info.key)?.disconnect(info.key);
    if (!this.sockets.size) { clearInterval(this.sweeper); this.sweeper = null; }
    this.broadcast();
  }

  sweep() {
    const idle = this.tables.flatMap(t => t.sweepIdle());
    if (!idle.length) return;
    for (const [ws, o] of this.sockets) {
      if (idle.includes(o.key) && !this.tableOf(o.key)) { o.key = null; this.send(ws, { notice: this.idleNotice }); }
    }
    this.broadcast();
  }

  lobby() {
    return this.tables.map((t, i) => ({
      room: i + 1, phase: t.phase,
      people: t.seats.filter(s => s && !s.bot).map(s => s.name).concat(t.waitlist.map(w => w.name)),
      bots: t.seats.filter(s => s && s.bot).length,
    }));
  }
  // Everyone, best first: [key, row]
  ranking() {
    const rows = new Map(this.board);
    for (const t of this.tables) for (const s of t.humans().concat(t.waitlist)) rows.set(s.key, { name: s.name, points: s.points, refills: s.refills, games: s.games, wins: s.wins, seated: true });
    const sort = this.boardSort || ((a, b) => b.points - a.points);
    return [...rows].sort(([, a], [, b]) => sort(a, b));
  }
  send(ws, extra) {
    const info = this.sockets.get(ws);
    if (!info) return;
    const seatedAt = this.tables.findIndex(t => t.has(info.key)) + 1;
    try {
      ws.send(JSON.stringify({ type: 'state', room: info.room, seatedAt, you: info.key,
        reactions: freshReactions(this.reactions.get(info.room) || [], Date.now()),
        table: this.tables[info.room - 1].view(info.key), lobby: this.lobby(), ...topFor(this.ranking(), info.as?.key || info.key), ...extra }));
    } catch (e) { /* socket already gone; its close handler cleans up */ }
  }
  broadcast(skip) { for (const ws of this.sockets.keys()) if (ws !== skip) this.send(ws); }
}
