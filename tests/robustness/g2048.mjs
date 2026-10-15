// 2048 (worker/g2048/board.js): the server owns the board. Covers logging in
// over the WebSocket, moves applied and a new tile spawned by the server, a
// stale move from another tab refused, picking the same game up from a second
// tab and after every tab closed (it's saved then), a new game, the board
// ranking by biggest tile, and a bad login refused. Plus the autopilot:
// PM's grants (who may flip it on) and the 🤖 marking of bot games.
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
ck('the board shows my biggest tile', (back.board || []).some(r => r.name === u.name && r.tile === Math.max(maxOf(g), hi.best.tile)), JSON.stringify(back.board).slice(0, 300));

c.send({ type: 'new' });
const nw = await c.next(m => m.game && m.game.moves === 0, 'new game');
ck('a new game starts over and counts as a game', tiles(nw.game) === 2 && nw.game.score === 0 && nw.best.games === 2, JSON.stringify(nw).slice(0, 200));
ck('the best tile survives a new game', nw.best.tile >= maxOf(g), JSON.stringify(nw.best));

const d = await open();
d.send({ type: 'hello', name: u.name, token: 'not-the-token' });
const refused = await d.next(m => m.error, 'bad login');
ck('a wrong token is refused', /登录/.test(refused.error) && !refused.game);
await c.close(); await d.close();

// ---------- Autopilot grants (same shape as Dodge's) ----------
// PM always may use the bot; anyone else only once PM grants them, and
// only PM can grant or see the list.
const J = async (m, p, o) => {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: o === undefined ? undefined : JSON.stringify(o) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* ignore */ }
  return j;
};
const grantsOf = x => J('GET', '/api/2048/grants?' + new URLSearchParams({ name: x.name, token: x.token }));
const pmLogin = await J('POST', '/api/login', { name: 'PM', token: 'pm-2048-' + tag });
const pm = { name: pmLogin.user?.name, token: pmLogin.user?.token };
const pal = await login('BotPal');
ck('grant test users created', !!(pm.token && pal.token));
const pmView = await grantsOf(pm);
ck('PM is admin and can always use the bot', pmView.isAdmin === true && pmView.canBot === true, JSON.stringify(pmView));
const palView = await grantsOf(pal);
ck('ungranted account: no bot, no admin, no list', palView.canBot === false && palView.isAdmin === false && (palView.grants || []).length === 0, JSON.stringify(palView));
const selfGrant = await J('POST', '/api/2048/grants', { name: pal.name, token: pal.token, target: pal.name, on: true });
ck('granting by a non-admin rejected', selfGrant.ok === false, JSON.stringify(selfGrant));
const granted = await J('POST', '/api/2048/grants', { name: pm.name, token: pm.token, target: pal.name, on: true });
ck('PM grants the pal', granted.ok === true && granted.grants.some(n => n.toLowerCase() === pal.name.toLowerCase()), JSON.stringify(granted));
ck('pal can now use the bot', (await grantsOf(pal)).canBot === true);
const revoked = await J('POST', '/api/2048/grants', { name: pm.name, token: pm.token, target: pal.name, on: false });
ck('PM revokes the pal', revoked.ok === true && !revoked.grants.some(n => n.toLowerCase() === pal.name.toLowerCase()), JSON.stringify(revoked));
ck('pal loses the bot', (await grantsOf(pal)).canBot === false);
const anonG = await J('GET', '/api/2048/grants');
ck('anonymous grant check is harmless', anonG.ok === true && anonG.canBot === false && anonG.isAdmin === false, JSON.stringify(anonG));

// ---------- Bot games are marked, human games are not ----------
// A fresh player's record comes from their first game, so one bot move
// in it marks the game and the board row; a human move in a fresh game
// marks neither.
const bm = await login('BotMark');
const e = await open();
e.send({ type: 'hello', name: bm.name, token: bm.token });
let eg = (await e.next(m => m.game, 'bot-mark game')).game;
let botState = null;
for (const dir of ['left', 'up', 'right', 'down']) {
  e.send({ type: 'move', dir, n: eg.moves, bot: true });
  const r = await e.next(m => m.game, 'bot move reply');
  eg = r.game;
  if (r.spawn) { botState = r; break; }
}
ck('a bot move marks the game as a bot game', !!botState && botState.game.bot === true, JSON.stringify(botState?.game));
ck('the best record out of a bot game is marked', botState.best?.bot === true, JSON.stringify(botState.best));
const look = await open();
const lookState = await look.next(m => m.board, 'board on connect');
ck('the board row is marked 🤖 (bot)', (lookState.board || []).some(r => r.name === bm.name && r.bot === true), JSON.stringify(lookState.board).slice(0, 300));
await look.close(); await e.close();
const hm = await login('HandMark');
const h2 = await open();
h2.send({ type: 'hello', name: hm.name, token: hm.token });
let hg = (await h2.next(m => m.game, 'hand game')).game;
let handState = null;
for (const dir of ['left', 'up', 'right', 'down']) {
  h2.send({ type: 'move', dir, n: hg.moves });
  const r = await h2.next(m => m.game, 'hand move reply');
  hg = r.game;
  if (r.spawn) { handState = r; break; }
}
ck('a human move leaves the game and the record unmarked', !!handState && !handState.game.bot && handState.best?.bot !== true, JSON.stringify(handState?.game) + JSON.stringify(handState?.best));
await h2.close();

// ---------- The server-side autopilot ----------
// An account without a grant is refused; PM (always allowed) turns it on
// and the game advances with no moves sent from here at all — the
// object's own alarm is playing. A manual move takes the wheel back:
// the bot turns off and the game stops advancing on its own.
const nb = await login('NoBot');
const n1 = await open();
n1.send({ type: 'hello', name: nb.name, token: nb.token });
let ng = (await n1.next(m => m.game, 'ungranted game')).game;
n1.send({ type: 'bot', on: true });
const nRefused = await n1.next(m => m.error, 'ungranted bot refused');
ck('bot-on without a grant is refused', !!nRefused.error && nRefused.botOn !== true, JSON.stringify(nRefused).slice(0, 160));
await new Promise(r => setTimeout(r, 1600));
n1.send({ type: 'keep' }); // any reply carries the current totals
const nAfter = await n1.next(m => m.game, 'ungranted game after a wait');
ck('an ungranted game does not advance on its own', nAfter.game.moves === ng.moves, `moves ${ng.moves} -> ${nAfter.game.moves}`);
await n1.close();

const p1 = await open();
p1.send({ type: 'hello', name: pm.name, token: pm.token });
let pg = (await p1.next(m => m.game, 'PM game')).game;
p1.send({ type: 'bot', on: true });
const pOn = await p1.next(m => m.botOn === true, 'PM bot on');
ck('bot-on is acknowledged in state (botOn)', pOn.botOn === true, JSON.stringify(pOn).slice(0, 160));
const pGrown = await p1.next(m => m.game && m.game.moves >= pg.moves + 3, 'server bot moves on its own', 20000);
ck('the server bot advances the game with no client moves', pGrown.game.moves >= pg.moves + 3, `moves ${pg.moves} -> ${pGrown.game.moves}`);
ck('a server-bot game is a bot game', pGrown.game.bot === true, JSON.stringify(pGrown.game));
const pBest = pGrown.best || (await p1.next(m => m.best, 'PM best after bot')).best;
ck('the record from a server-bot game is marked', pBest?.bot === true, JSON.stringify(pBest));
const before = pGrown.game.moves;
p1.send({ type: 'move', dir: 'left', n: before });
const pBack = await p1.next(m => m.game && m.botOn === false, 'manual move turns the bot off');
ck('a manual move turns the server bot off', pBack.botOn === false, JSON.stringify(pBack).slice(0, 160));
// 步数以抢回方向盘那一刻服务器的盘面为准（排队里的外挂 state 可能还
// 在路上，pGrown 那个数早就过时了）；从这一刻起一步都不许再自己走
await new Promise(r => setTimeout(r, 1600));
p1.send({ type: 'keep' });
const pAfter = await p1.next(m => m.game, 'PM game after taking the wheel');
ck('after the takeover the game stays put', pAfter.game.moves === pBack.game.moves, `moves ${pBack.game.moves} -> ${pAfter.game.moves}`);
p1.send({ type: 'bot', on: false });
await p1.close();

console.log(`\n2048: ${pass} passed, ${fail} failed (${merges} moves scored)`);
process.exit(fail ? 1 : 0);
