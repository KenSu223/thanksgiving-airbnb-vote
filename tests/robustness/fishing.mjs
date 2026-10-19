// 小小钓鱼 (worker/fishing/board.js): the score is the server's replay of a
// ticketed run. Covers starting a run (logged in only), a short run that lands
// something, scored by the server's own replay (the coins the page claims
// don't matter), the 图鉴 (what you landed goes in it, only you see which),
// ending a run straight away, a ticket that's someone else's, tampered or bad
// inputs refused, a run longer than the time since its ticket refused, the
// board (top 3 + your own place) and the public replay that plays back the same.
// Standalone use: TEST_BASE=http://localhost:8791 node tests/robustness/fishing.mjs
import { newGame, step, HZ } from '../../web/src/features/fishing/sim.js';
import { replay } from '../../web/src/features/fishing/verify.js';

const B = process.env.TEST_BASE || 'http://localhost:8791';
const J = async (m, p, o) => {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: o === undefined ? undefined : JSON.stringify(o) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* ignore */ }
  return { status: r.status, ...j };
};
let pass = 0, fail = 0;
const ck = (name, cond, extra) => { if (cond) { pass++; console.log('OK  ', name); } else { fail++; console.log('FAIL', name, extra ?? ''); } };
const tag = Date.now().toString(36);
const login = async n => (await J('POST', '/api/login', { name: n + tag, token: 'dev-fish-' + n + tag })).user;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// A short real run for this seed: cast once at a tick where it lands
// something worth coins by `by`, then end the run right after it's in.
function shortRun(seed, by) {
  for (let f = 0; f < 150; f++) {
    const g = newGame(seed);
    while (g.tick < f) step(g, []);
    step(g, [[f, 0]]);
    while (g.tick < by && !g.money && !(g.hook.state === 'swing' && g.tick > f + 1)) step(g, []);
    if (g.money > 0) return { events: [[f, 0], [g.tick, 4]], money: g.money, ticks: g.tick, caught: { ...g.caught } };
  }
  return null;
}

const anon = await J('POST', '/api/fish/start', { name: 'Nobody' + tag, token: 'x' });
ck('starting a run needs a login', anon.status === 401 && anon.ok === false, JSON.stringify(anon));

const [a, b] = await Promise.all([login('FishA'), login('FishB')]);
ck('fishing players created', a?.token && b?.token);

// ---- a run that ends at once: $0, still a run ----
const t0 = await J('POST', '/api/fish/start', { name: a.name, token: a.token });
ck('start gives a seed and a signed ticket', t0.ok === true && Number.isInteger(t0.seed) && /^[\w-]+\.[\w-]+$/.test(t0.ticket), JSON.stringify(t0));
const quick = await J('POST', '/api/fish/score', { name: a.name, token: a.token, ticket: t0.ticket, events: [[0, 4]], money: 999999 });
ck('ending straight away scores $0 (the claimed money is ignored)', quick.ok === true && quick.money === 0 && quick.end === 'quit' && quick.cleared === 0, JSON.stringify(quick).slice(0, 200));

// ---- a short real run: the server's replay gives the money ----
const t1 = await J('POST', '/api/fish/start', { name: a.name, token: a.token });
const run = shortRun(t1.seed, 6 * HZ);
ck('found a short run that winds something in', !!run, String(t1.seed));
await sleep(Math.ceil((run?.ticks || 0) * 1000 / HZ) - 1000); // a run can't be longer than its ticket's age + 2 s
const sc = await J('POST', '/api/fish/score', { name: a.name, token: a.token, ticket: t1.ticket, events: run.events, money: 1 });
ck('the score is the server replay', sc.ok === true && sc.money === run.money && sc.money > 0, JSON.stringify({ sc: { ...sc, board: undefined }, run }));
ck('a better run is a new best, ranked', sc.newBest === true && sc.best === run.money && sc.rank >= 1, JSON.stringify(sc).slice(0, 200));
ck('the board has it', [...sc.board, sc.boardMe].some(r => r && r.name === a.name && r.money === run.money), JSON.stringify(sc.board));
const landed = Object.keys(run.caught);
ck('what it landed is the catch, and new in the 图鉴', JSON.stringify(sc.caught) === JSON.stringify(run.caught) && JSON.stringify(sc.newKinds) === JSON.stringify(landed) && landed.every(k => sc.kinds.includes(k)), JSON.stringify({ caught: sc.caught, newKinds: sc.newKinds, kinds: sc.kinds }));
ck('the board row shows how many kinds', [...sc.board, sc.boardMe].find(r => r && r.name === a.name)?.kinds === landed.length);

// ---- refusals ----
const again = await J('POST', '/api/fish/start', { name: a.name, token: a.token });
const theirs = await J('POST', '/api/fish/score', { name: b.name, token: b.token, ticket: again.ticket, events: [[0, 4]] });
ck("someone else's ticket is refused", theirs.status === 400 && theirs.ok === false, JSON.stringify(theirs));
const [payload, sig] = again.ticket.split('.');
const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), s: 12345 })).toString('base64url') + '.' + sig;
const tampered = await J('POST', '/api/fish/score', { name: a.name, token: a.token, ticket: forged, events: [[0, 4]] });
ck('a ticket with a changed seed is refused', tampered.status === 400 && tampered.ok === false, JSON.stringify(tampered));
const bad = await J('POST', '/api/fish/score', { name: a.name, token: a.token, ticket: again.ticket, events: [[5, 0], [3, 0]] });
ck('inputs out of order are refused', bad.status === 400 && /记录不对/.test(bad.error), JSON.stringify(bad));
const odd = await J('POST', '/api/fish/score', { name: a.name, token: a.token, ticket: again.ticket, events: [[0, 2, 99]] });
ck('a buy that is not a shop slot is refused', odd.status === 400 && /记录不对/.test(odd.error), JSON.stringify(odd));
const long = await J('POST', '/api/fish/score', { name: a.name, token: a.token, ticket: again.ticket, events: [[60 * HZ * 3, 4]] });
ck('a run longer than the time since its ticket is refused', long.status === 400 && /实际过去的时间/.test(long.error), JSON.stringify(long));
const noTicket = await J('POST', '/api/fish/score', { name: a.name, token: a.token, events: [[0, 4]] });
ck('no ticket: asked to refresh', noTicket.status === 400 && /刷新/.test(noTicket.error), JSON.stringify(noTicket));
const wrongTok = await J('POST', '/api/fish/score', { name: a.name, token: 'nope', ticket: again.ticket, events: [[0, 4]] });
ck('a wrong token is refused', wrongTok.status === 401, JSON.stringify(wrongTok));

// ---- a worse run doesn't replace the best ----
const t2 = await J('POST', '/api/fish/start', { name: a.name, token: a.token });
const worse = await J('POST', '/api/fish/score', { name: a.name, token: a.token, ticket: t2.ticket, events: [[0, 4]] });
ck('a worse run keeps the best', worse.ok === true && worse.newBest === false && worse.best === run.money, JSON.stringify(worse).slice(0, 200));
ck('and the 图鉴 keeps what was caught before', worse.newKinds.length === 0 && landed.every(k => worse.kinds.includes(k)), JSON.stringify(worse.kinds));

// ---- the board, and the public replay ----
const board = await J('GET', `/api/fish/board?name=${encodeURIComponent(a.name)}&token=${a.token}`);
ck('board: at most 3 rows, each with money and how far', board.ok === true && board.board.length <= 3 && board.board.every(r => Number.isInteger(r.money) && Number.isInteger(r.cleared)), JSON.stringify(board));
const mine = board.board.findIndex(r => r.name === a.name);
ck('your own place: in the top 3 or as boardMe', mine >= 0 ? board.boardMe === null : board.boardMe?.name === a.name && board.boardMe.rank > 3, JSON.stringify(board));
ck('no runs count is shown', [...board.board, board.boardMe].every(r => !r || r.runs === undefined));
const bBoard = await J('GET', `/api/fish/board?name=${encodeURIComponent(b.name)}&token=${b.token}`);
ck('someone with no runs gets no row of their own', bBoard.boardMe === null && bBoard.board.every(r => r.name !== b.name), JSON.stringify(bBoard));
ck('your 图鉴 comes with your board; nobody else sees which kinds', landed.every(k => board.kinds.includes(k)) && bBoard.kinds.length === 0 && (await J('GET', '/api/fish/board')).kinds.length === 0, JSON.stringify({ mine: board.kinds, theirs: bBoard.kinds }));
if (mine >= 0) {
  const rep = await J('GET', '/api/fish/replay?name=' + encodeURIComponent(a.name));
  ck('a top-3 replay is public', rep.ok === true && rep.seed === t1.seed && JSON.stringify(rep.events) === JSON.stringify(run.events), JSON.stringify(rep).slice(0, 200));
  ck('and plays back to the same money', replay(rep.seed, rep.events).money === run.money);
} else {
  const rep = await J('GET', '/api/fish/replay?name=' + encodeURIComponent(a.name));
  ck('a replay below the top 3 stays private', rep.status === 403, JSON.stringify(rep));
}
const ghost = await J('GET', '/api/fish/replay?name=Nobody' + tag);
ck('no replay for someone with no runs', ghost.status === 404, JSON.stringify(ghost));
const door = await J('POST', '/api/fish/scrub-user', { target: a.name });
ck('the fishing board has no public scrub door', door.ok !== true, JSON.stringify(door));

console.log(`\nfishing: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
