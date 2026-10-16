// Presence (worker/presence/presence.js): who has the app open, and when
// everyone else last did. Covers the roster starting offline/never-seen,
// a hello with a bad token not putting anyone online, hello putting you
// online (visible over plain GET too), two people online at once, and
// leaving flipping you offline with a fresh lastSeen.
// Standalone use: TEST_BASE=http://localhost:8791 node tests/robustness/presence.mjs
const B = process.env.TEST_BASE || 'http://localhost:8791';
const WS = B.replace(/^http/, 'ws') + '/api/presence';
let pass = 0, fail = 0;
const ck = (name, cond, extra) => { if (cond) { pass++; console.log('OK  ', name); } else { fail++; console.log('FAIL', name, extra ?? ''); } };
const tag = Date.now().toString(36);
const login = async n => (await (await fetch(B + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: n + tag, token: 'dev-presence-' + n + tag }) })).json()).user;
const roster = async () => (await (await fetch(B + '/api/presence')).json()).users || [];
const entry = (users, name) => users.find(u => u.name === name);

function open() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS), msgs = [];
    ws.onmessage = e => { try { const m = JSON.parse(e.data); if (m.type === 'roster' || m.type === 'error') msgs.push(m); } catch { /* ignore */ } };
    ws.onerror = reject;
    ws.onopen = () => resolve({
      ws, msgs,
      send: m => ws.send(JSON.stringify(m)),
      async next(pred, what, ms = 6000) {
        const from = msgs.length, t0 = Date.now();
        while (Date.now() - t0 < ms) {
          const hit = msgs.slice(from).find(pred);
          if (hit) return hit;
          await new Promise(r => setTimeout(r, 20));
        }
        throw new Error('timed out waiting for ' + what);
      },
      close: () => new Promise(r => { ws.onclose = r; ws.close(); setTimeout(r, 1000); }),
    });
  });
}

const a = await login('PresA');
const b = await login('PresB');
ck('presence test users created', !!(a?.token && b?.token));

const before = await roster();
ck('everyone starts offline and never seen', entry(before, a.name)?.online === false && entry(before, a.name)?.lastSeen === null && entry(before, b.name)?.online === false, JSON.stringify(entry(before, a.name)));

const c1 = await open();
const first = await c1.next(m => m.type === 'roster', 'roster on connect');
ck('a fresh socket gets the roster right away', Array.isArray(first.users), JSON.stringify(first).slice(0, 120));

c1.send({ type: 'hello', name: a.name, token: 'not-the-token' });
const refused = await c1.next(m => m.type === 'error', 'bad hello refused');
ck('a hello with a bad token is refused', !!refused.error, JSON.stringify(refused));
ck('...and does not put anyone online', entry(await roster(), a.name)?.online === false);

c1.send({ type: 'hello', name: a.name, token: a.token });
const aOn = await c1.next(m => m.type === 'roster' && entry(m.users, a.name)?.online === true, 'A online broadcast');
ck('hello puts you online (broadcast roster)', entry(aOn.users, a.name)?.online === true, JSON.stringify(entry(aOn.users, a.name)));
const viaGet = await roster();
ck('...and GET /api/presence agrees, with a fresh lastSeen', entry(viaGet, a.name)?.online === true && Math.abs(Date.now() - (entry(viaGet, a.name)?.lastSeen || 0)) < 15000, JSON.stringify(entry(viaGet, a.name)));

const c2 = await open();
c2.send({ type: 'hello', name: b.name, token: b.token });
const both = await c2.next(m => m.type === 'roster' && entry(m.users, a.name)?.online === true && entry(m.users, b.name)?.online === true, 'both online');
ck('two people can be online at once', !!both);
ck('online people sort ahead of offline ones', (await roster()).findIndex(u => u.online) <= (await roster()).findIndex(u => !u.online) || !(await roster()).some(u => !u.online));

c2.send({ type: 'ping' });
await new Promise(r => setTimeout(r, 300));
ck('a ping keeps you online and does not break anything', entry(await roster(), b.name)?.online === true);

const t0 = Date.now();
await c1.close();
const afterA = await roster();
ck('closing flips you offline with lastSeen ≈ the moment you left', entry(afterA, a.name)?.online === false && (entry(afterA, a.name)?.lastSeen || 0) >= t0 - 5000 && (entry(afterA, a.name)?.lastSeen || Infinity) <= Date.now(), JSON.stringify(entry(afterA, a.name)));
ck('the other person is still online', entry(afterA, b.name)?.online === true);
await c2.close();

console.log(`\nPRESENCE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
