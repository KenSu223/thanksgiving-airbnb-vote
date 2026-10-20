// 末日小队 (worker/doom/board.js): the score is the server's replay of a
// ticketed run. Covers starting a run (logged in only), a short run that kills
// something, scored by the server's own replay (the score the page claims
// doesn't matter), ending a run straight away, a ticket that's someone else's,
// tampered or bad inputs refused, a run longer than the time since its ticket
// refused, the board (top 3 + your own place) and the public replay that plays
// back the same.
// Standalone use: TEST_BASE=http://localhost:8791 node tests/robustness/doom.mjs
import { newGame, step, HZ } from '../../web/src/features/doom/sim.js';
import { replay } from '../../web/src/features/doom/verify.js';

const B = process.env.TEST_BASE || 'http://localhost:8791';
const J = async (m, p, o) => {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: o === undefined ? undefined : JSON.stringify(o) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* ignore */ }
  return { status: r.status, ...j };
};
let pass = 0, fail = 0;
const ck = (name, cond, extra) => { if (cond) { pass++; console.log('OK  ', name); } else { fail++; console.log('FAIL', name, extra ?? ''); } };
const tag = Date.now().toString(36);
const login = async n => (await J('POST', '/api/login', { name: n + tag, token: 'dev-doom-' + n + tag })).user;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// A short real run for this seed: steer once to the middle, let the squad shoot
// until it has killed something, then end the run there.
function shortRun(seed) {
  const g = newGame(seed), events = [[0, 0, 180]];
  step(g, [[0, 0, 180]]);
  while (!g.over && g.score === 0 && g.tick < 20 * HZ) step(g, []);
  events.push([g.tick, 2]);
  return { events, score: g.score, ticks: g.tick };
}

const anon = await J('POST', '/api/doom/start', { name: 'Nobody' + tag, token: 'x' });
ck('starting a run needs a login', anon.status === 401 && anon.ok === false, JSON.stringify(anon));

const [a, b] = await Promise.all([login('DoomA'), login('DoomB')]);
ck('players created', a?.token && b?.token);

const t0 = await J('POST', '/api/doom/start', { name: a.name, token: a.token });
ck('start gives a seed and a signed ticket', t0.ok === true && Number.isInteger(t0.seed) && /^[\w-]+\.[\w-]+$/.test(t0.ticket), JSON.stringify(t0));
const quick = await J('POST', '/api/doom/score', { name: a.name, token: a.token, ticket: t0.ticket, events: [[0, 2]], score: 999999 });
ck('ending straight away scores 0 (the claimed score is ignored)', quick.ok === true && quick.score === 0 && quick.end === 'quit' && quick.wave === 1, JSON.stringify(quick).slice(0, 200));

const t1 = await J('POST', '/api/doom/start', { name: a.name, token: a.token });
const run = shortRun(t1.seed);
ck('found a short run that kills something', run.score > 0, JSON.stringify(run).slice(0, 120));
await sleep(Math.ceil(run.ticks * 1000 / HZ) - 1000); // a run can't be longer than its ticket's age + 2 s
const sc = await J('POST', '/api/doom/score', { name: a.name, token: a.token, ticket: t1.ticket, events: run.events, score: 1 });
ck('the score is the server replay', sc.ok === true && sc.score === run.score && sc.score > 0, JSON.stringify({ ...sc, board: undefined }).slice(0, 200));
ck('a better run is a new best, ranked', sc.newBest === true && sc.best === run.score && sc.rank >= 1, JSON.stringify(sc).slice(0, 200));
ck('the board has it, with the wave', [...sc.board, sc.boardMe].some(r => r && r.name === a.name && r.score === run.score && r.wave === 1), JSON.stringify(sc.board));

const again = await J('POST', '/api/doom/start', { name: a.name, token: a.token });
const theirs = await J('POST', '/api/doom/score', { name: b.name, token: b.token, ticket: again.ticket, events: [[0, 2]] });
ck("someone else's ticket is refused", theirs.status === 400 && theirs.ok === false, JSON.stringify(theirs));
const [payload, sig] = again.ticket.split('.');
const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), s: 12345 })).toString('base64url') + '.' + sig;
const tampered = await J('POST', '/api/doom/score', { name: a.name, token: a.token, ticket: forged, events: [[0, 2]] });
ck('a ticket with a changed seed is refused', tampered.status === 400 && tampered.ok === false, JSON.stringify(tampered));
const bad = await J('POST', '/api/doom/score', { name: a.name, token: a.token, ticket: again.ticket, events: [[5, 0, 100], [3, 0, 100]] });
ck('inputs out of order are refused', bad.status === 400 && /记录不对/.test(bad.error), JSON.stringify(bad));
const odd = await J('POST', '/api/doom/score', { name: a.name, token: a.token, ticket: again.ticket, events: [[0, 0, 9999]] });
ck('steering off the road is refused', odd.status === 400 && /记录不对/.test(odd.error), JSON.stringify(odd));
const long = await J('POST', '/api/doom/score', { name: a.name, token: a.token, ticket: again.ticket, events: [[60 * HZ * 3, 2]] });
ck('a run longer than the time since its ticket is refused', long.status === 400 && /实际过去的时间/.test(long.error), JSON.stringify(long));
const wrongTok = await J('POST', '/api/doom/score', { name: a.name, token: 'nope', ticket: again.ticket, events: [[0, 2]] });
ck('a wrong token is refused', wrongTok.status === 401, JSON.stringify(wrongTok));

const t2 = await J('POST', '/api/doom/start', { name: a.name, token: a.token });
const worse = await J('POST', '/api/doom/score', { name: a.name, token: a.token, ticket: t2.ticket, events: [[0, 2]] });
ck('a worse run keeps the best', worse.ok === true && worse.newBest === false && worse.best === run.score, JSON.stringify(worse).slice(0, 200));

const board = await J('GET', `/api/doom/board?name=${encodeURIComponent(a.name)}&token=${a.token}`);
ck('board: at most 3 rows, each with score and wave', board.ok === true && board.board.length <= 3 && board.board.every(r => Number.isInteger(r.score) && Number.isInteger(r.wave)), JSON.stringify(board));
ck('no runs count is shown', [...board.board, board.boardMe].every(r => !r || r.runs === undefined));
const mine = board.board.findIndex(r => r.name === a.name);
const rep = await J('GET', '/api/doom/replay?name=' + encodeURIComponent(a.name));
if (mine >= 0) {
  ck('a top-3 replay is public', rep.ok === true && rep.seed === t1.seed && JSON.stringify(rep.events) === JSON.stringify(run.events), JSON.stringify(rep).slice(0, 200));
  ck('and plays back to the same score', replay(rep.seed, rep.events).score === run.score);
} else ck('a replay below the top 3 stays private', rep.status === 403, JSON.stringify(rep));
ck('no replay for someone with no runs', (await J('GET', '/api/doom/replay?name=Nobody' + tag)).status === 404);
ck('the board has no public scrub door', (await J('POST', '/api/doom/scrub-user', { target: a.name })).ok !== true);

console.log(`\ndoom: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
