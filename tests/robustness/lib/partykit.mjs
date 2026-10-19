// Helpers for the party-game suites: log people in, open a socket per person on a
// game's hall, and wait for the state you expect.
export const B = process.env.TEST_BASE || 'http://localhost:8791';
const WS = B.replace(/^http/, 'ws');
let pass = 0, fail = 0;
export const ck = (name, cond, extra) => { if (cond) { pass++; console.log('OK  ', name); } else { fail++; console.log('FAIL', name, extra ?? ''); } };
export const done = label => { console.log(`\n${label}: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); };
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const login = async name => (await (await fetch(B + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, token: 'dev-party-' + name }) })).json()).user;

// One person's connection: .st is the latest state; .send(m); .until(pred) waits for a state matching pred.
export function client(path, room = 1) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS + path + '?room=' + room);
    const c = { ws, st: null, errors: [], states: 0 };
    ws.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.type !== 'state') return;
      c.st = m; c.states++;
      if (m.error) c.errors.push(m.error);
    };
    ws.onerror = reject;
    ws.onopen = () => resolve(Object.assign(c, {
      send: m => ws.send(JSON.stringify(m)),
      t: () => c.st?.table,
      async until(pred, what, ms = 5000) {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) {
          if (c.st && pred(c.st.table, c.st)) return c.st.table;
          await sleep(20);
        }
        throw new Error('timed out waiting for ' + what + ' (phase ' + c.st?.table?.phase + ')');
      },
      close: () => new Promise(r => { ws.onclose = r; ws.close(); setTimeout(r, 800); }),
    }));
  });
}
// n people seated in seats 0..n-1 of a table; returns their clients (with .user)
export async function table(path, names, room = 1) {
  const cs = [];
  for (const [i, n] of names.entries()) {
    const u = await login(n);
    const c = await client(path, room);
    c.user = u;
    c.send({ type: 'sit', room, name: u.name, token: u.token, seat: i });
    await c.until(t => t.you === i, n + ' seated');
    cs.push(c);
  }
  return cs;
}
// everyone waits for the same condition
export const all = (cs, pred, what, ms) => Promise.all(cs.map(c => c.until(pred, what, ms)));
// the current speaker's client says 说完了 until the speaking phase ends
export async function talkThrough(cs, phases = ['speak', 'pk']) {
  for (let g = 0; g < 40; g++) {
    const t = cs[0].t();
    if (!phases.includes(t.phase) || t.speaker < 0) return;
    const sp = t.speaker, before = cs[0].st.table.say.at(-1)?.id;
    cs[sp].send({ type: 'done' });
    await cs[0].until(x => x.speaker !== sp || x.say.at(-1)?.id !== before || !phases.includes(x.phase), 'next speaker');
  }
}
