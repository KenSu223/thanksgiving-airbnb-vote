// Leaderboard rules:
// - Every game board shows only the top 3 (worker/lib/board.js); someone below
//   that gets their own place (rank and record), and nobody else's.
// - 躲技能 (worker/dodge/board.js): only the top 3's replays are public, and
//   GET /api/dodge/replay refuses anyone below that (their replay stays saved,
//   just not served).
// - 21 点 (worker/blackjack/table.js): ranked by net = chips − 1000 × (1 +
//   refills), which can go negative, so refilling over and over doesn't climb.
// Runs after users.mjs (whose victim's replay has to be in the top 3 when it looks).
// Standalone use: TEST_BASE=http://localhost:8791 node tests/robustness/leaderboards.mjs
const B = process.env.TEST_BASE || 'http://localhost:8791';
const WS = B.replace(/^http/, 'ws');
const J = async (m, p, o) => {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: o === undefined ? undefined : JSON.stringify(o) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* ignore */ }
  return { status: r.status, ...j };
};
let pass = 0, fail = 0;
const ck = (name, cond, extra) => { if (cond) { pass++; console.log('OK  ', name); } else { fail++; console.log('FAIL', name, extra ?? ''); } };
const tag = Date.now().toString(36);
const login = async n => (await J('POST', '/api/login', { name: n + tag, token: 'dev-lb-' + n + tag })).user;

// ---- 躲技能: four ticketed runs with no input (each under 3 s; a run can't be
// longer than the time since its ticket + 2 s, so wait a second before sending) ----
const players = await Promise.all(['LbA', 'LbB', 'LbC', 'LbD'].map(login));
ck('dodge players created', players.every(u => u?.token), JSON.stringify(players));
await Promise.all(players.map(async u => {
  const tk = await J('POST', '/api/dodge/start', { name: u.name, token: u.token });
  await new Promise(r => setTimeout(r, 1000));
  const sc = await J('POST', '/api/dodge/score', { name: u.name, token: u.token, ticket: tk.ticket, events: [] });
  ck('dodge score recorded for ' + u.name, sc.ok === true, JSON.stringify(sc).slice(0, 200));
}));
const { board, boardMe } = await J('GET', '/api/dodge/board');
ck('the board is the top 3 only', board.length === 3, board.length);
ck('nobody signed in: no place of your own', boardMe === null, JSON.stringify(boardMe));
ck('how many runs someone played is not on the board', board.every(r => !('runs' in r)), JSON.stringify(board[0]));
for (const [i, r] of board.entries()) {
  const rep = await J('GET', '/api/dodge/replay?name=' + encodeURIComponent(r.name));
  if (r.replay) ck(`#${i + 1} ${r.name}: replay served`, rep.ok === true && Array.isArray(rep.events), JSON.stringify(rep).slice(0, 200));
}
// each player: on the board, or their own place below it (with a rank, and no ▶)
const places = await Promise.all(players.map(u => J('GET', `/api/dodge/board?name=${encodeURIComponent(u.name)}&token=${u.token}`)));
ck('each player finds themself: on the board or in their own place', players.every((u, i) => places[i].board.some(r => r.name === u.name) || places[i].boardMe?.name === u.name), JSON.stringify(places.map(p => p.boardMe)));
ck('everyone gets the same top 3', places.every(p => JSON.stringify(p.board) === JSON.stringify(board)));
const below = places.map(p => p.boardMe).filter(Boolean);
ck('someone is below the top 3, with their rank (so the refusal is exercised)', below.length >= 1 && below.every(m => m.rank >= 4 && m.replay === false), JSON.stringify(below));
for (const m of below) {
  const rep = await J('GET', '/api/dodge/replay?name=' + encodeURIComponent(m.name));
  ck(`#${m.rank} ${m.name}: replay refused`, rep.ok === false && rep.status === 403 && /前三名/.test(rep.error || ''), JSON.stringify(rep).slice(0, 200));
}
const wrongTok = await J('GET', `/api/dodge/board?name=${encodeURIComponent(below[0]?.name)}&token=nope`);
ck('a wrong token gets no place', wrongTok.boardMe === null, JSON.stringify(wrongTok.boardMe));
const ghost = await J('GET', '/api/dodge/replay?name=Nobody' + tag);
ck('no record: 404', ghost.ok === false && ghost.status === 404, JSON.stringify(ghost));

// ---- 21 点: sit, and the board carries net = chips − 1000 × (1 + refills), sorted by it ----
const bj = await login('LbBj');
const states = [];
const ws = new WebSocket(WS + '/api/bj');
ws.onmessage = e => { try { const m = JSON.parse(e.data); if (m.type === 'state') states.push(m); } catch { /* ignore */ } };
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.send(JSON.stringify({ type: 'sit', name: bj.name, token: bj.token }));
let st = null;
for (let t0 = Date.now(); Date.now() - t0 < 4000 && !st; await new Promise(r => setTimeout(r, 50))) {
  st = states.findLast(s => s.you === bj.name.toLowerCase());
}
ck('blackjack: seated', !!st, JSON.stringify(states.at(-1) || {}).slice(0, 200));
const rows = st?.board || [];
const mine = rows.find(r => r.name === bj.name) || st?.boardMe;
ck('blackjack: the board is the top 3 only', rows.length <= 3, rows.length);
ck('blackjack: a fresh player is at net 0', mine && mine.net === 0 && mine.chips === 1000, JSON.stringify(mine));
ck('blackjack: every row has net = chips − 1000 × (1 + refills)', rows.length > 0 && rows.every(r => r.net === r.chips - 1000 * (1 + (r.refills || 0))), JSON.stringify(rows).slice(0, 300));
ck('blackjack: sorted by net', rows.every((r, i) => i === 0 || rows[i - 1].net >= r.net), JSON.stringify(rows.map(r => r.net)));
ws.send(JSON.stringify({ type: 'leave' }));
await new Promise(r => setTimeout(r, 200));
ws.close();

console.log(`\nLEADERBOARDS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
