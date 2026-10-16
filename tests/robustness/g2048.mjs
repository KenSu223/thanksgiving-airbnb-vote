// 2048 (worker/g2048/board.js): the server owns the board. Covers logging in
// over the WebSocket, moves applied and a new tile spawned by the server, a
// stale move from another tab refused, picking the same game up from a second
// tab and after every tab closed (it's saved then), a new game, the board
// ranking by biggest tile, and a bad login refused.
// Standalone use: TEST_BASE=http://localhost:8791 node tests/robustness/g2048.mjs
const B = process.env.TEST_BASE || 'http://localhost:8791';
const WS = B.replace(/^http/, 'ws') + '/api/2048';
let pass = 0, fail = 0;
const ck = (name, cond, extra) => { if (cond) { pass++; console.log('OK  ', name); } else { fail++; console.log('FAIL', name, extra ?? ''); } };
const tag = Date.now().toString(36);
const login = async n => (await (await fetch(B + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: n + tag, token: 'dev-2048-' + n + tag }) })).json()).user;

function open() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS), msgs = [];
    ws.onmessage = e => { try { const m = JSON.parse(e.data); if (m.type === 'state') msgs.push(m); } catch { /* ignore */ } };
    ws.onerror = reject;
    ws.onopen = () => resolve({
      ws, msgs,
      send: m => ws.send(JSON.stringify(m)),
      async next(pred, what, ms = 4000) {
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
const tiles = g => g.grid.filter(Boolean).length;
const maxOf = g => Math.max(...g.grid);

const u = await login('Two');
const a = await open();
const first = await a.next(m => m.board, 'the board on connect');
ck('board sent on connect, before logging in', Array.isArray(first.board));
a.send({ type: 'move', dir: 'left', n: 0 });
const anon = await a.next(m => m.error, 'refusal');
ck('a move before logging in is refused', /登录/.test(anon.error), JSON.stringify(anon));

a.send({ type: 'hello', name: u.name, token: u.token });
const hi = await a.next(m => m.game, 'game');
ck('logging in gives a new game with two tiles', hi.game.moves === 0 && tiles(hi.game) === 2 && hi.game.score === 0, JSON.stringify(hi.game));
ck('best record started (1 game)', hi.best?.games === 1, JSON.stringify(hi.best));

// play until a dozen moves have gone through (try directions until one moves)
let g = hi.game, moved = 0, merges = 0;
for (let i = 0; i < 60 && moved < 12; i++) {
  const dir = ['left', 'up', 'right', 'down'][i % 4];
  a.send({ type: 'move', dir, n: g.moves });
  const r = await a.next(m => m.game, 'move reply');
  if (r.spawn) {
    ck(`move ${moved + 1} (${dir}): one new tile, counted`, r.game.moves === g.moves + 1 && r.game.grid[r.spawn.at] === r.spawn.v && [2, 4].includes(r.spawn.v) && r.game.score >= g.score, JSON.stringify(r).slice(0, 200));
    if (r.game.score > g.score) merges++;
    moved++;
  } else ck(`a ${dir} that changes nothing isn't a move`, r.still === true && r.game.moves === g.moves, JSON.stringify(r).slice(0, 200));
  g = r.game;
}
ck('a dozen moves went through', moved === 12, moved);

a.send({ type: 'move', dir: 'left', n: g.moves - 1 });
const stale = await a.next(m => m.game, 'stale reply');
ck('a stale move (another tab moved first) is refused with the real board', stale.stale === true && stale.game.moves === g.moves, JSON.stringify(stale).slice(0, 200));
a.send({ type: 'move', dir: 'sideways', n: g.moves });
const bad = await a.next(m => m.error, 'bad dir');
ck('an unknown direction is refused', /方向/.test(bad.error));

// a second tab picks up the same game, and sees moves made in the first
const b = await open();
b.send({ type: 'hello', name: u.name, token: u.token });
const hb = await b.next(m => m.game, 'second tab game');
ck('a second tab gets the same game', JSON.stringify(hb.game.grid) === JSON.stringify(g.grid) && hb.game.moves === g.moves && hb.game.score === g.score);
let dir2 = null;
for (const d of ['left', 'up', 'right', 'down']) {
  a.send({ type: 'move', dir: d, n: g.moves });
  const r = await a.next(m => m.game, 'move');
  g = r.game;
  if (r.spawn) { dir2 = d; break; }
}
const isIt = m => m.game && m.game.moves === g.moves;
const seen = b.msgs.find(isIt) || await b.next(isIt, 'the other tab sees it').catch(() => null); // may have landed already
ck('the other tab sees the move', !!seen && seen.dir === dir2 && JSON.stringify(seen.game.grid) === JSON.stringify(g.grid));

// every tab closes; the game is saved and comes back
await a.close(); await b.close();
await new Promise(r => setTimeout(r, 300));
const c = await open();
c.send({ type: 'hello', name: u.name, token: u.token });
const back = await c.next(m => m.game, 'game after reconnect');
ck('after every tab closed, logging in again resumes the same game', JSON.stringify(back.game.grid) === JSON.stringify(g.grid) && back.game.moves === g.moves && back.game.score === g.score, JSON.stringify(back.game));
ck('the board (or my own place below it) shows my biggest tile', [...(back.board || []), back.boardMe].some(r => r && r.name === u.name && r.tile === Math.max(maxOf(g), hi.best.tile)), JSON.stringify([back.board, back.boardMe]).slice(0, 300));
ck('the board is the top 3 only', (back.board || []).length <= 3);

c.send({ type: 'new' });
const nw = await c.next(m => m.game && m.game.moves === 0, 'new game');
ck('a new game starts over and counts as a game', tiles(nw.game) === 2 && nw.game.score === 0 && nw.best.games === 2, JSON.stringify(nw).slice(0, 200));
ck('the best tile survives a new game', nw.best.tile >= maxOf(g), JSON.stringify(nw.best));

const d = await open();
d.send({ type: 'hello', name: u.name, token: 'not-the-token' });
const refused = await d.next(m => m.error, 'bad login');
ck('a wrong token is refused', /登录/.test(refused.error) && !refused.game);
await c.close(); await d.close();

console.log(`\n2048: ${pass} passed, ${fail} failed (${merges} moves scored)`);
process.exit(fail ? 1 : 0);
