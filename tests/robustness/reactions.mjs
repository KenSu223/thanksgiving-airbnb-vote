// Addressed table reactions (worker/games/reactions.js): anyone signed
// in — seated or just watching — can drop an emoji/taunt ON a seated
// player; it lands on the target, signed with the sender's name.
// Covers the hall games (Dou Dizhu WS) and Blackjack: identify without
// sitting, seated senders, and the refusals (no identity, bad value,
// target not seated). Uses the global WebSocket client (Node 22+ —
// that's why CI pins Node 22 in check.yml/deploy.yml).
// Standalone use: TEST_BASE=http://localhost:8791 node tests/robustness/reactions.mjs
if (typeof WebSocket === 'undefined') {
  console.log('FAIL this suite needs the global WebSocket client (Node 22+)');
  console.log('REACTIONS: 0 passed, 1 failed');
  process.exit(1);
}
const B = process.env.TEST_BASE || 'http://localhost:8791';
const WS = B.replace(/^http/, 'ws');
const J = async (m, p, o) => {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: o === undefined ? undefined : JSON.stringify(o) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* ignore */ }
  return j;
};
let pass = 0, fail = 0;
const ck = (name, cond, extra) => { if (cond) { pass++; console.log('OK  ', name); } else { fail++; console.log('FAIL', name, extra ?? ''); } };
// A crashed wait shouldn't die as a bare stack: report it as a failure.
const crash = e => { console.log('FAIL suite crashed:', e?.message || e); console.log(`REACTIONS: ${pass} passed, ${fail + 1} failed`); process.exit(1); };
process.on('uncaughtException', crash);
process.on('unhandledRejection', crash);
const tag = Date.now().toString(36);
const mkUser = async n => {
  const r = await J('POST', '/api/login', { name: n + tag, token: 'dev-react-' + n + tag });
  return r.user;
};

// A tiny WS client that buffers every state message.
function connect(path) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS + path);
    const states = [];
    ws.onmessage = e => { try { const m = JSON.parse(e.data); if (m.type === 'state') states.push(m); } catch { /* ignore */ } };
    ws.onopen = () => resolve({
      ws, states,
      send: m => ws.send(JSON.stringify(m)),
      latest: () => states[states.length - 1],
      async waitFor(pred, what, ms = 4000) {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) {
          const hit = states.find(pred);
          if (hit) return hit;
          await new Promise(s => setTimeout(s, 60));
        }
        throw new Error('timeout waiting for ' + what);
      },
      close: () => { try { ws.close(); } catch { /* ignore */ } },
    });
    ws.onerror = () => reject(new Error('ws error ' + path));
  });
}
const reactsOf = st => (st && Array.isArray(st.reactions)) ? st.reactions : [];

const A = await mkUser('ReactSeatA'), Buser = await mkUser('ReactWatchB'), C = await mkUser('ReactAnonC');
ck('test users created', !!(A?.token && Buser?.token && C?.token));
const aKey = A.name.toLowerCase(), bKey = Buser.name.toLowerCase();

// ---------- Dou Dizhu hall ----------
const a = await connect('/api/ddz?room=1');
a.send({ type: 'sit', room: 1, name: A.name, token: A.token });
await a.waitFor(s => s.you === aKey, 'A seated');
ck('A seated at ddz', true);

const b = await connect('/api/ddz?room=1');
b.send({ type: 'identify', name: Buser.name, token: Buser.token });
await new Promise(s => setTimeout(s, 250));
b.send({ type: 'react', value: '😏', target: aKey });
const seenByA = await a.waitFor(s => reactsOf(s).some(r => r.v === '😏' && r.to === aKey), 'reaction lands on A').catch(() => null);
ck('spectator reaction lands on the target, signed', !!seenByA
  && reactsOf(seenByA).find(r => r.v === '😏').by === bKey
  && reactsOf(seenByA).find(r => r.v === '😏').byName === Buser.name, JSON.stringify(seenByA?.reactions));

const c = await connect('/api/ddz?room=1');
c.send({ type: 'react', value: '🤣', target: aKey });
const cErr = await c.waitFor(s => s.error, 'anon refused').catch(() => null);
ck('unidentified sender refused', cErr?.error === '先登录再发表情', JSON.stringify(cErr?.error));

b.send({ type: 'react', value: '🖕', target: aKey });
b.send({ type: 'react', value: '💣', target: 'ghost' + tag });
const bErr = await b.waitFor(s => s.error === '把表情拖到一个在座的人身上', 'unseated target refused').catch(() => null);
ck('target not seated refused', !!bErr, JSON.stringify(bErr?.error));
await new Promise(s => setTimeout(s, 500));
ck('off-list value never landed', !reactsOf(b.latest()).some(r => r.v === '🖕' || r.v === '🤣'), JSON.stringify(b.latest()?.reactions));

a.send({ type: 'react', value: '💣', target: aKey });
const selfHit = await b.waitFor(s => reactsOf(s).some(r => r.v === '💣' && r.by === aKey && r.to === aKey), 'seated self-reaction').catch(() => null);
ck('seated player reacts without identify', !!selfHit, JSON.stringify(b.latest()?.reactions));
a.close(); b.close(); c.close();

// ---------- Blackjack ----------
const D = await mkUser('ReactSeatD'), E = await mkUser('ReactWatchE');
const dKey = D.name.toLowerCase();
const d = await connect('/api/bj');
d.send({ type: 'sit', name: D.name, token: D.token });
await d.waitFor(s => s.you === dKey, 'D seated');
const e = await connect('/api/bj');
e.send({ type: 'identify', name: E.name, token: E.token });
await new Promise(s => setTimeout(s, 250));
e.send({ type: 'react', value: '🔥', target: dKey });
const bjHit = await d.waitFor(s => reactsOf(s).some(r => r.v === '🔥' && r.to === dKey && r.byName === E.name), 'bj reaction').catch(() => null);
ck('blackjack: spectator reaction lands signed', !!bjHit, JSON.stringify(d.latest()?.reactions));
d.close(); e.close();

console.log(`REACTIONS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
