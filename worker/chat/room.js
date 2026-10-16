// The chat room: one Durable Object (WebSocket /api/chat) for the whole group,
// keeping the latest 100 messages. Sockets use the hibernation API — an open
// page costs nothing while nobody is talking (the object sleeps; a message
// wakes it) — so every signed-in page can stay connected for live unread badges.
//
// In:  { type: 'hello', name, token }   prove who you are (needed to read and to send)
//      { type: 'send', text }           a message (≤ 500 characters)
// Out: { type: 'history', msgs, you }   on hello: the last 100
//      { type: 'msg', msg }             each new message, to everyone signed in
//      { type: 'error', error }
// A message: { id, by, byKey, text, at, mentions: [userKey], all? }. Mentions
// are found here, not trusted from the page: every member whose name appears as
// "@name" in the text (longest names first, so "@PM Test" isn't also "@PM").
// "@all" or "@所有人" calls everyone: mentions is then every member but the
// sender, and all: true. Anyone can use it (everyone has the same rights).
// Who has read what is kept on each device (the page), not here.
import { getUsers, sameName, cleanName } from '../users/users.js';
import { j } from '../lib/http.js';

export const KEEP = 100, MAX_TEXT = 500;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// "@all" / "@所有人", but not "@allen" (a letter or digit right after it).
const ALL = /@(?:all(?![a-z0-9_])|所有人)/i;
// Members mentioned in a text: "@name" (case-insensitive), longest names win;
// "@all" means every member. → { keys, all }
export function findMentions(text, users) {
  let rest = String(text).toLowerCase();
  const out = [];
  for (const u of [...users].sort((a, b) => b.name.length - a.name.length)) {
    const tag = '@' + u.name.toLowerCase();
    if (!rest.includes(tag)) continue;
    out.push(u.name.toLowerCase());
    rest = rest.split(tag).join(' '); // so a shorter name inside it doesn't match again
  }
  // checked on what's left, so a member called "Allie" written as "@Allie" isn't "@all"
  if (ALL.test(rest)) return { keys: users.map(u => u.name.toLowerCase()), all: true };
  return { keys: out, all: false };
}

export class ChatRoom {
  constructor(state, env) {
    this.state = state; this.env = env;
    this.msgs = null;
  }
  async load() {
    if (!this.msgs) this.msgs = (await this.state.storage.get('msgs')) || [];
    return this.msgs;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/scrub-user') return this.scrubUser(request);
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    this.state.acceptWebSocket(server);
    server.serializeAttachment(null);
    return new Response(null, { status: 101, webSocket: client });
  }

  send(ws, m) { try { ws.send(JSON.stringify(m)); } catch (e) { /* gone */ } }

  async webSocketMessage(ws, data) {
    let m;
    try { m = JSON.parse(data); } catch (e) { return; }
    if (m.type === 'hello') {
      const users = await getUsers(this.env);
      const user = users.find(u => sameName(u.name, cleanName(m.name)));
      if (!user || !m.token || user.token !== m.token) { ws.serializeAttachment(null); return this.send(ws, { type: 'error', error: '先登录再聊天' }); }
      ws.serializeAttachment({ key: user.name.toLowerCase(), name: user.name });
      return this.send(ws, { type: 'history', msgs: await this.load(), you: user.name.toLowerCase() });
    }
    if (m.type !== 'send') return;
    const who = ws.deserializeAttachment();
    if (!who) return this.send(ws, { type: 'error', error: '先登录再聊天' });
    const text = String(m.text || '').replace(/\r\n/g, '\n').trim().slice(0, MAX_TEXT);
    if (!text) return this.send(ws, { type: 'error', error: '写点什么再发' });
    const users = await getUsers(this.env);
    const found = findMentions(text, users);
    const msg = { id: uid(), by: who.name, byKey: who.key, text, at: Date.now(), mentions: found.keys.filter(k => k !== who.key), ...(found.all ? { all: true } : {}) };
    const msgs = await this.load();
    msgs.push(msg);
    if (msgs.length > KEEP) msgs.splice(0, msgs.length - KEEP);
    await this.state.storage.put('msgs', msgs);
    for (const s of this.state.getWebSockets()) if (s.deserializeAttachment()) this.send(s, { type: 'msg', msg });
  }
  async webSocketClose(ws) { try { ws.close(1000, 'bye'); } catch (e) { /* already closed */ } }
  async webSocketError() { /* the close handler tidies up */ }

  // Internal only: a retired account (users/retire.js) — their messages go, and
  // mentions of them. The public worker routes only /api/chat here, never /scrub-user.
  async scrubUser(request) {
    const body = await request.json().catch(() => null) || {};
    const key = cleanName(body.target).toLowerCase();
    if (!key) return j({ ok: true, removed: 0 });
    const msgs = await this.load();
    const before = msgs.length;
    this.msgs = msgs.filter(x => x.byKey !== key).map(x => ({ ...x, mentions: (x.mentions || []).filter(k => k !== key) }));
    await this.state.storage.put('msgs', this.msgs);
    for (const s of this.state.getWebSockets()) {
      if (s.deserializeAttachment()?.key === key) s.serializeAttachment(null);
      else if (s.deserializeAttachment()) this.send(s, { type: 'history', msgs: this.msgs, you: s.deserializeAttachment().key });
    }
    return j({ ok: true, removed: before - this.msgs.length });
  }
}
