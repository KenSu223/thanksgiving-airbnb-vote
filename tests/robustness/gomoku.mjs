// 五子棋 (worker/gomoku/hall.js): three tables of two over real WebSockets.
// Covers: sitting needs the login; two people play a game to five; illegal
// moves refused (a stone already there, out of turn, off the board, after the
// end); a spectator sees every move but can't move, and shows up on the 👀
// list; a dropped player gets the seat back; 再来一局 swaps colours; 认输 and
// standing up mid-game (also 认输); a game against the bot with 悔棋; a game
// against the bot paused on standing up and picked up on sitting down alone;
// the wins board (top 3 + your own place); a retired account leaves no record
// or paused game; junk messages ignored.
// Standalone use: TEST_BASE=http://localhost:8791 node tests/robustness/gomoku.mjs
if (typeof WebSocket === 'undefined') {
  console.log('FAIL this suite needs the global WebSocket client (Node 22+)');
  console.log('GOMOKU: 0 passed, 1 failed');
  process.exit(1);
}
const B = process.env.TEST_BASE || 'http://localhost:8791';
const WS = B.replace(/^http/, 'ws') + '/api/gomoku';
const J = async (m, p, o) => {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: o === undefined ? undefined : JSON.stringify(o) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* ignore */ }
  return j;
};
let pass = 0, fail = 0;
const ck = (name, cond, extra) => { if (cond) { pass++; console.log('OK  ', name); } else { fail++; console.log('FAIL', name, extra ?? ''); } };
const crash = e => { console.log('FAIL suite crashed:', e?.message || e); console.log(`GOMOKU: ${pass} passed, ${fail + 1} failed`); process.exit(1); };
process.on('uncaughtException', crash);
process.on('unhandledRejection', crash);
setTimeout(() => crash(new Error('the suite took over 3 minutes')), 180000).unref();
const tag = Date.now().toString(36);
const login = async (n, exact = false) => (await J('POST', '/api/login', { name: exact ? n : n + tag, token: 'dev-gm-' + n + tag })).user;
const P = (r, c) => r * 15 + c;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function open(room = 1) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS + '?room=' + room), msgs = [];
    ws.onmessage = e => { try { const m = JSON.parse(e.data); if (m.type === 'state') msgs.push(m); } catch { /* ignore */ } };
    ws.onerror = () => reject(new Error('ws error'));
    setTimeout(() => reject(new Error('ws did not open')), 8000);
    ws.onopen = () => resolve({
      ws, msgs,
      send: m => ws.send(typeof m === 'string' ? m : JSON.stringify(m)),
      last: () => msgs[msgs.length - 1],
      // the next message (after this call) that matches
      async next(pred, what, ms = 5000) {
        const from = msgs.length, t0 = Date.now();
        while (Date.now() - t0 < ms) {
          const hit = msgs.slice(from).find(pred);
          if (hit) return hit;
          await sleep(20);
        }
        throw new Error('timed out waiting for ' + what);
      },
      // the latest message matches now, or the next one that does
      async until(pred, what, ms = 5000) {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) {
          const m = msgs[msgs.length - 1];
          if (m && pred(m)) return m;
          await sleep(20);
        }
        throw new Error('timed out waiting for ' + what);
      },
      close: () => new Promise(r => { ws.onclose = r; ws.close(); setTimeout(r, 1000); }),
    });
  });
}
const rowOf = (m, name) => [...(m.board || []), m.boardMe].find(r => r && r.name === name);
const sitAs = (c, u, room, seat) => c.send({ type: 'sit', room, name: u.name, token: u.token, ...(seat == null ? {} : { seat }) });

const plain = await fetch(B + '/api/gomoku');
ck('a plain GET gets 426 (it is a WebSocket endpoint)', plain.status === 426, plain.status);
// the scrub path is internal: from outside a POST only ever reaches /api/gomoku, which wants a WebSocket
const scrubDoor = await fetch(B + '/api/gomoku', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target: 'anyone' }) });
ck('no public scrub door', scrubDoor.status === 426, scrubDoor.status);

const [A, Bo, W] = [await login('GmAnn'), await login('GmBo'), await login('GmWatch')];
ck('test users created', !!(A?.token && Bo?.token && W?.token));
const aKey = A.name.toLowerCase(), bKey = Bo.name.toLowerCase();

// ---------- watching needs nothing; junk is ignored ----------
const s = await open(1);
const s0 = await s.until(m => m.table, 'first state');
ck('a spectator gets the table, the lobby and the board on connect', s0.room === 1 && s0.you === null && s0.lobby?.length === 3 && Array.isArray(s0.board) && Array.isArray(s0.table.moves), JSON.stringify(s0).slice(0, 200));
for (const junk of ['not json', '5', 'null', '[]', '"move"', '{}', '{"type":5}', '{"type":"bogus","at":1}', '{"type":"__proto__"}', '{"type":"toString"}', '{"type":"constructor"}', 'x'.repeat(5000)]) s.send(junk);
s.send({ type: 'watch', room: 1 });
await s.next(m => m.room === 1, 'watch reply');
ck('junk messages are ignored (no error, socket still open)', s.ws.readyState === 1 && !s.msgs.some(m => m.error), JSON.stringify(s.msgs.filter(m => m.error)));
s.send({ type: 'sit', room: 1, name: 'Nobody' + tag, token: 'nope' });
const noUser = await s.next(m => m.error, 'unknown user refused');
ck('sitting needs a login (unknown name)', noUser.error === '先登录再坐下' && noUser.you === null, JSON.stringify(noUser).slice(0, 120));
s.send({ type: 'sit', room: 1, name: A.name, token: 'wrong-token' });
const badTok = await s.next(m => m.error, 'bad token refused');
ck('sitting needs a login (wrong token)', badTok.error === '先登录再坐下', JSON.stringify(badTok).slice(0, 120));

// ---------- two people ----------
const a = await open(1), b = await open(1);
sitAs(a, A, 1, 0);
const aSat = await a.next(m => m.you === aKey, 'A seated');
ck('A sits at 黑; alone, so the bot takes 白', aSat.seatedAt === 1 && aSat.table.seats[0].name === A.name && aSat.table.seats[1]?.bot === true && aSat.table.phase === 'waiting', JSON.stringify(aSat.table.seats));
sitAs(b, Bo, 1, 0);
const taken = await b.next(m => m.error, 'seat taken');
ck("B can't take A's seat", taken.error === '这个座位有人了' && taken.you === null, JSON.stringify(taken).slice(0, 120));
sitAs(b, Bo, 1);
const bSat = await b.next(m => m.you === bKey, 'B seated');
ck("B takes the bot's place (白)", bSat.table.seats[1].name === Bo.name && bSat.table.vsBot === false, JSON.stringify(bSat.table.seats));
const sLobby = await s.until(m => m.lobby[0].people.length === 2, 'spectator lobby');
ck('the lobby shows both players', sLobby.lobby[0].people.includes(A.name) && sLobby.lobby[0].people.includes(Bo.name) && sLobby.lobby[0].bots === 0, JSON.stringify(sLobby.lobby[0]));
const w = await open(1);
w.send({ type: 'identify', name: W.name, token: W.token });
const seen = await a.until(m => m.watch?.names?.includes(W.name), 'watcher named');
ck('players see 👀: how many watch, and the signed-in names', seen.watch.n >= 2 && !seen.watch.names.includes(A.name), JSON.stringify(seen.watch));
s.send({ type: 'move', at: P(7, 7) });
const sMove = await s.next(m => m.error, 'spectator move');
ck("a spectator can't move", sMove.error === '先坐下', JSON.stringify(sMove).slice(0, 100));
w.send({ type: 'start' });
const wStart = await w.next(m => m.error, 'watcher start');
ck("a signed-in watcher can't start or move either", wStart.error === '先坐下');
w.send({ type: 'react', value: '👍', target: aKey });
const react = await a.until(m => (m.reactions || []).some(r => r.v === '👍' && r.to === aKey && r.byName === W.name), 'reaction on A');
ck('a watcher drops a reaction on a player', !!react);

for (const junk of ['{"type":"__proto__"}', '{"type":"toString"}', '{"type":"hasOwnProperty"}']) a.send(junk); // seated: still nothing
a.send({ type: 'start' });
const started = await b.until(m => m.table.phase === 'playing', 'game started');
ck('anyone seated starts: 黑 (A) to move, a 60 s clock', started.table.turn === 0 && started.table.deadline - started.table.now > 55000, JSON.stringify({ turn: started.table.turn, d: started.table.deadline - started.table.now }));
ck('junk from a seated player is ignored too', !a.msgs.some(m => m.error) && a.ws.readyState === 1, JSON.stringify(a.msgs.filter(m => m.error).map(m => m.error)));
b.send({ type: 'move', at: P(7, 7) });
ck('out of turn is refused', (await b.next(m => m.error, 'out of turn')).error === '还没轮到你');
for (const bad of [225, -1, 'x', 3.5, null]) {
  a.send({ type: 'move', at: bad });
  const r = await a.next(m => m.error, 'off board ' + bad);
  ck('off the board is refused: ' + JSON.stringify(bad), r.error === '要下在棋盘上', r.error);
}
const black = [P(7, 3), P(7, 4), P(7, 5), P(7, 6), P(7, 7)], white = [P(9, 3), P(9, 4), P(9, 5), P(9, 6)];
for (let i = 0; i < 5; i++) {
  a.send({ type: 'move', at: black[i] });
  await b.until(m => m.table.moves.length === 2 * i + 1, 'black move ' + i);
  if (i === 0) {
    b.send({ type: 'move', at: black[0] });
    ck('a stone already there is refused', (await b.next(m => m.error, 'occupied')).error === '这里已经有子了');
  }
  if (i === 1) { // B drops off mid-game: the seat is kept; back with identify (a reload)
    await b.close();
    const away = await a.until(m => m.table.seats[1] && !m.table.seats[1].connected, 'B away');
    ck('a dropped player keeps the seat (shown away)', away.table.seats[1].name === Bo.name && away.table.phase === 'playing');
    const b2 = await open(1);
    b2.send({ type: 'identify', name: Bo.name, token: Bo.token });
    const back = await b2.until(m => m.you === bKey, 'B back');
    ck('and gets it back on identify', back.seatedAt === 1 && back.table.seats[1].connected && back.table.you === 1, JSON.stringify(back.table.seats));
    Object.assign(b, b2);
  }
  if (i < 4) { b.send({ type: 'move', at: white[i] }); await a.until(m => m.table.moves.length === 2 * i + 2, 'white move ' + i); }
}
const over = await a.until(m => m.table.phase === 'over', 'game over');
ck('five in a row wins: 黑 (A), the line comes with the result', over.table.result.winner === 0 && over.table.result.how === 'five' && JSON.stringify(over.table.result.line) === JSON.stringify(black), JSON.stringify(over.table.result));
const sOver = await s.until(m => m.table.phase === 'over', 'spectator sees the end');
ck('the spectator saw every move and the end', JSON.stringify(sOver.table.moves) === JSON.stringify([black[0], white[0], black[1], white[1], black[2], white[2], black[3], white[3], black[4]]) && s.msgs.some(m => m.table.moves.length === 3));
a.send({ type: 'move', at: P(0, 0) });
ck('a move after the end is refused', (await a.next(m => m.error, 'after end')).error === '这局已经结束了');
b.send({ type: 'undo' });
ck('no 悔棋 against a person', (await b.next(m => m.error, 'undo vs person')).error === '和人下不能悔棋');
const rec = await a.until(m => rowOf(m, A.name), 'A on the board');
ck('the board counts it: A 1 win / 1 game', rowOf(rec, A.name).wins === 1 && rowOf(rec, A.name).games === 1, JSON.stringify(rowOf(rec, A.name)));

// 再来一局 swaps the colours; 认输
b.send({ type: 'start' });
const again = await a.until(m => m.table.phase === 'playing' && m.table.moves.length === 0, 'rematch');
ck('再来一局 swaps colours: B is 黑 now', again.table.seats[0].name === Bo.name && again.table.seats[1].name === A.name && again.table.you === 1, JSON.stringify(again.table.seats));
b.send({ type: 'move', at: P(7, 7) });
await a.until(m => m.table.moves.length === 1, 'B opens');
a.send({ type: 'resign' });
const resigned = await b.until(m => m.table.phase === 'over', 'resigned');
ck('认输: the other side wins', resigned.table.result.how === 'resign' && resigned.table.result.winner === 0 && resigned.table.result.by === A.name, JSON.stringify(resigned.table.result));
// standing up mid-game against a person is 认输 too
a.send({ type: 'start' });
await b.until(m => m.table.phase === 'playing', 'third game');
b.send({ type: 'leave' });
const left = await a.until(m => m.table.phase === 'over', 'B left');
ck('standing up mid-game is 认输; the one left gets the bot', left.table.result.how === 'left' && left.table.result.by === Bo.name && left.table.seats[left.table.you === 0 ? 1 : 0]?.bot === true, JSON.stringify(left.table));
const bGone = await b.until(m => m.you === null, 'B stood');
ck('and B is standing', bGone.seatedAt === 0);
a.send({ type: 'leave' });
const empty = await s.until(m => m.lobby[0].people.length === 0, 'table 1 empty');
ck('everyone up: table 1 is free', empty.lobby[0].phase === 'waiting' && empty.table.seats.every(x => !x), JSON.stringify(empty.lobby[0]));

// ---------- against the bot: 悔棋, pausing, picking it up again ----------
const C = await login('GmCy');
const cKey = C.name.toLowerCase();
const c = await open(2);
sitAs(c, C, 2);
await c.until(m => m.you === cKey, 'C seated');
c.send({ type: 'start' });
const cs = await c.until(m => m.table.phase === 'playing', 'C playing');
ck('alone against the bot, 黑 by default', cs.table.vsBot && cs.table.you === 0 && cs.table.turn === 0);
c.send({ type: 'undo' });
ck('nothing to take back yet', (await c.next(m => m.error, 'nothing to undo')).error === '还没有可以悔的棋');
c.send({ type: 'move', at: P(7, 7) });
const reply = await c.until(m => m.table.moves.length === 2, 'bot reply', 4000);
const botAt = reply.table.moves[1];
ck('the bot answers within a couple of seconds, next to the stone', Math.abs(Math.floor(botAt / 15) - 7) <= 2 && Math.abs((botAt % 15) - 7) <= 2, botAt);
const mine = [P(6, 6), P(8, 8), P(6, 8), P(8, 6)].find(p => !reply.table.moves.includes(p));
c.send({ type: 'move', at: mine });
await c.until(m => m.table.moves.length === 4, 'second bot reply');
c.send({ type: 'undo' });
const undone = await c.next(m => m.table.moves.length === 2, 'undo');
ck('悔棋 takes back your move and the bot\'s reply', JSON.stringify(undone.table.moves) === JSON.stringify(reply.table.moves) && undone.table.turn === 0 && undone.table.undos === 1);
c.send({ type: 'leave' });
const paused = await c.next(m => m.notice || m.you === null, 'paused');
ck('standing up from the bot keeps the game', /存好了/.test(paused.notice || '') && paused.you === null, JSON.stringify(paused).slice(0, 160));
const lob = await s.until(m => m.lobby[1].people.length === 0, 'table 2 free');
ck('and the table is free for someone else', lob.lobby[1].phase === 'waiting');
c.send({ type: 'watch', room: 3 });
sitAs(c, C, 3, 1);
const resumed = await c.until(m => m.you === cKey && m.table.phase === 'playing', 'resumed');
ck('sitting down alone again picks the game up (same colour, same stones, 接着上次那局)', resumed.seatedAt === 3 && resumed.table.resumed === true && resumed.table.you === 0
  && JSON.stringify(resumed.table.moves) === JSON.stringify(reply.table.moves) && resumed.table.turn === 0 && resumed.table.deadline - resumed.table.now > 55000, JSON.stringify(resumed.table).slice(0, 200));
c.send({ type: 'fresh' });
const fresh = await c.until(m => m.table.moves.length === 0 && !m.table.resumed, 'fresh');
ck('重新开一局 starts over (the game you had played in counts as 认输)', fresh.table.phase === 'playing' && fresh.table.vsBot);
c.send({ type: 'resign' });
await c.until(m => m.table.phase === 'over', 'C resigned');
c.send({ type: 'leave' });
await c.until(m => m.you === null, 'C up');

// ---------- the board: top 3 for everyone, your own place for you ----------
const [D, E] = [await login('GmDee'), await login('GmEd')];
const d = await open(1), e = await open(1);
sitAs(d, D, 1, 0); await d.until(m => m.you === D.name.toLowerCase(), 'D seated');
sitAs(e, E, 1, 1); await e.until(m => m.you === E.name.toLowerCase(), 'E seated');
d.send({ type: 'start' });
await e.until(m => m.table.phase === 'playing', 'D vs E');
e.send({ type: 'resign' });
await d.until(m => m.table.phase === 'over', 'E resigned');
d.send({ type: 'leave' }); e.send({ type: 'leave' });
c.send({ type: 'watch', room: 1 });
const cb = await c.until(m => m.boardMe, 'C own place');
ck('only the top 3 go out', cb.board.length === 3 && cb.board.every((r, i) => i === 0 || r.wins <= cb.board[i - 1].wins), JSON.stringify(cb.board));
ck('C (0 wins) gets their own place below them', cb.boardMe.name === C.name && cb.boardMe.rank >= 4 && cb.boardMe.wins === 0 && cb.boardMe.games === 2, JSON.stringify(cb.boardMe)); // 重新开一局 (认输) + 认输
ck('a spectator not signed in has no own place', s.last().boardMe === null);
ck('nobody\'s board has a row past the top 3', [a, s, w, c].every(x => x.last().board.length <= 3));

// ---------- a retired account (RETIRE=Retiree on the test server) leaves nothing ----------
const R = await login('Retiree', true);
const r = await open(3);
sitAs(r, R, 3);
await r.until(m => m.you === 'retiree', 'retiree seated');
r.send({ type: 'start' });
await r.until(m => m.table.phase === 'playing', 'retiree playing');
r.send({ type: 'resign' }); // a record …
await r.until(m => m.table.phase === 'over', 'retiree resigned');
r.send({ type: 'start' });
await r.until(m => m.table.phase === 'playing' && m.table.moves.length < 2, 'retiree again');
await sleep(1200); // (if the bot opened, it has)
const rFree = [P(7, 7), P(6, 6)].find(p => !r.last().table.moves.includes(p));
r.send({ type: 'move', at: rFree });
await r.until(m => m.table.moves.includes(rFree), 'retiree moved');
r.send({ type: 'leave' }); // … and a paused game
await r.until(m => m.you === null, 'retiree up');
ck('the retiree has a record', !!rowOf(r.last(), 'Retiree'), JSON.stringify(r.last().boardMe));
await J('GET', '/api/users'); // the member list load retires them
const R2 = await login('Retiree', true);
const r2 = await open(2);
sitAs(r2, R2, 2);
const fresh2 = await r2.until(m => m.you === 'retiree', 'new retiree seated');
ck('a new account of that name starts clean: no paused game, no record', fresh2.table.phase === 'waiting' && fresh2.table.moves.length === 0 && !rowOf(fresh2, 'Retiree'), JSON.stringify({ t: fresh2.table.phase, me: fresh2.boardMe }));
r2.send({ type: 'leave' });
await r2.until(m => m.you === null, 'new retiree up');
await J('GET', '/api/users'); // and off the list again

for (const x of [s, a, b, w, c, d, e, r, r2]) await x.close();
console.log(`GOMOKU: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
