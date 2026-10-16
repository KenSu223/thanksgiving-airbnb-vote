// Accounts (worker/users/retire.js): PM — and only PM, proven by token —
// can delete an account in the app again (POST /api/users/delete), and a
// retired name (RETIRED, plus the RETIRE var this suite's server sets:
// "Retiree") comes off the member list the next time anyone loads it.
// Both doors run the same removal, with everything recorded under it:
// votes, flights, split entries, Secret Angel prefs and draw seat, car seat
// and luggage, to-do assignments, and the game records (the dodge board).
// Also: Secret Angel has no admin any more — any member draws and leaves
// people out, and it's logged who did.
//
// Standalone use: run the server with --var RETIRE:Retiree, then
//   TEST_BASE=http://localhost:8791 node tests/robustness/users.mjs
const B = process.env.TEST_BASE || 'http://localhost:8791';
const J = async (m, p, o) => {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: o === undefined ? undefined : JSON.stringify(o) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* ignore */ }
  return j;
};
let pass = 0, fail = 0;
const ck = (name, cond, extra) => { if (cond) { pass++; console.log('OK  ', name); } else { fail++; console.log('FAIL', name, extra ?? ''); } };
const tag = Date.now().toString(36);
const VICTIM = 'Retiree';
const isVictim = n => String(n || '').toLowerCase() === VICTIM.toLowerCase();
const login = async n => (await J('POST', '/api/login', { name: n, token: 'dev-' + n + '-' + tag })).user;

const pm = await login('PM');
const ast = await login('Aster');
ck('PM and Aster log in like anyone', !!pm?.token && !!ast?.token);

// ---- only PM can delete an account ----
// A throwaway test account carries the whole check: it joins with a split
// expense (so the scrub has something to bite on), a non-PM delete is
// refused and changes nothing, PM can't delete PM, an unknown name fails,
// and PM's real delete takes the account and its expense off for good.
const testee = await login('DeleteMe');
ck('test account created', !!testee?.token);
const tex = await J('POST', '/api/expense', { paidBy: 'DeleteMe', amountUSD: 12, splitAmong: ['DeleteMe', 'PM'], description: 'delete-me test expense' });
ck('test account expense recorded', tex.ok === true, JSON.stringify(tex));
const delByAst = await J('POST', '/api/users/delete', { name: 'DeleteMe', token: ast.token });
ck('a non-PM delete is refused', delByAst?.ok !== true, JSON.stringify(delByAst).slice(0, 120));
ck('and the test account is still on the list', (await J('GET', '/api/users')).users.some(u => u.name === 'DeleteMe'));
const delSelf = await J('POST', '/api/users/delete', { name: 'PM', token: pm.token });
ck('PM cannot delete PM', delSelf?.ok !== true, JSON.stringify(delSelf).slice(0, 120));
const delGhost = await J('POST', '/api/users/delete', { name: 'NoSuchPerson', token: pm.token });
ck('deleting an unknown name fails', delGhost?.ok !== true, JSON.stringify(delGhost).slice(0, 120));
const delOk = await J('POST', '/api/users/delete', { name: 'DeleteMe', token: pm.token });
ck('PM deletes the test account', delOk?.ok === true && !delOk.users.some(u => u.name === 'DeleteMe'), JSON.stringify(delOk).slice(0, 120));
ck('and it stays off the list', !(await J('GET', '/api/users')).users.some(u => u.name === 'DeleteMe'));
const splitDel = await J('GET', '/api/split');
ck("the deleted account's expense is scrubbed too",
  splitDel.expenses.every(e => e.paidBy !== 'DeleteMe' && !(e.splitAmong || []).includes('DeleteMe')) && !('DeleteMe' in (splitDel.balances || {})),
  JSON.stringify(splitDel.balances));

// ---- give the retiree a footprint everywhere (no GET /api/users until it's all in) ----
const vic = await login(VICTIM);
ck('retiree created', !!vic?.token);
const st0 = await J('GET', '/api/state?trip=nov26');
const lid = st0.listings[0].id;
await J('POST', '/api/vote', { trip: 'nov26', id: lid, token: vic.token, name: VICTIM });
ck('retiree listing vote recorded', (await J('GET', '/api/state?trip=nov26')).listings.find(l => l.id === lid).votes.some(v => isVictim(v.name)));
await J('POST', '/api/activity-vote', { id: 'red-rocks', token: vic.token, name: VICTIM });
ck('retiree activity vote recorded', (await J('GET', '/api/activities')).activities.find(a => a.id === 'red-rocks').votes.some(v => isVictim(v.name)));
const fl = await J('POST', '/api/flights', { name: VICTIM, token: vic.token, arrival: { flight: 'UA100', date: '2026-11-25', from: 'SFO', to: 'DEN', dep: '08:00', arr: '11:30' } });
ck('retiree flight saved', fl.ok === true, JSON.stringify(fl));
const ex = await J('POST', '/api/expense', { paidBy: VICTIM, amountUSD: 30, splitAmong: [VICTIM, 'PM'], description: 'retiree test expense' });
ck('retiree expense recorded', ex.ok === true, JSON.stringify(ex));
const seat = await J('POST', '/api/cars/seat', { name: VICTIM, token: vic.token, car: 'c', seat: 'rearRight' });
ck('retiree took a car seat', seat.ok === true, JSON.stringify(seat).slice(0, 160));
const todo = await J('POST', '/api/todos', { name: 'Aster', token: ast.token, title: 'retiree test task', assignees: [VICTIM] });
const todoId = todo.items?.find(t => t.title === 'retiree test task')?.id;
ck('retiree assigned a task', !!todoId && todo.items.find(t => t.id === todoId).assignees.includes(VICTIM), JSON.stringify(todo).slice(0, 160));
const cm = await J('POST', '/api/todos/comment', { name: VICTIM, token: vic.token, id: todoId, text: 'retiree comment' });
const cmId = cm.items?.find(t => t.id === todoId)?.comments?.[0]?.id;
await J('POST', '/api/todos/comment', { name: 'Aster', token: ast.token, id: todoId, text: 'aster reply', replyTo: cmId });
ck('retiree commented (and Aster replied)', !!cmId);
// a dodge score is the server's replay of a ticketed run (a run with no input lasts
// under 3 s and can't be longer than the time since its ticket + 2 s: wait a second)
const tk = await J('POST', '/api/dodge/start', { name: VICTIM, token: vic.token });
await new Promise(r => setTimeout(r, 1000));
const sc = await J('POST', '/api/dodge/score', { name: VICTIM, token: vic.token, ticket: tk.ticket, events: [] });
ck('retiree dodge score recorded', sc.ok === true, JSON.stringify(sc).slice(0, 160));
const scrubDoor = await J('POST', '/api/dodge/scrub-user', { target: VICTIM });
ck('the dodge board has no public scrub door', !scrubDoor || scrubDoor.ok !== true, JSON.stringify(scrubDoor));
ck('retiree still on the dodge board', (await J('GET', '/api/dodge/board')).board.some(r => isVictim(r.name)));

// ---- Secret Angel: no admin; a plain member draws, with the retiree in the circle ----
await J('POST', '/api/angel/prefs', { name: VICTIM, token: vic.token, picks: { gear: 'love' } });
await J('POST', '/api/angel/prefs', { name: 'PM', token: pm.token, picks: { gear: 'love' } });
await J('POST', '/api/angel/prefs', { name: 'Aster', token: ast.token, picks: { food: 'love' } });
const anon = await J('POST', '/api/angel/draw', {});
ck('drawing needs a login', anon.ok === false, JSON.stringify(anon));
const draw = await J('POST', '/api/angel/draw', { name: 'PM', token: pm.token });
ck('any member can draw (PM here, no admin needed)', draw.ok === true && draw.drawn === true && draw.drawnBy === 'PM', JSON.stringify(draw).slice(0, 200));
ck('the draw is logged with who did it', (draw.log || []).some(l => l.by === 'PM' && /抽了签/.test(l.what)), JSON.stringify(draw.log));
ck('nobody is marked admin', !('isAdmin' in draw) && draw.people.every(p => !('isAdmin' in p)), JSON.stringify(draw.people).slice(0, 160));
const transfer = await J('POST', '/api/angel/admin', { name: 'PM', token: pm.token, target: 'Aster' });
ck('there is no admin to hand over', !transfer || transfer.ok !== true, JSON.stringify(transfer).slice(0, 120));

// ---- load the member list: the retiree is retired, everywhere ----
const users = await J('GET', '/api/users');
ck('retiree gone from the member list', !users.users.some(u => isVictim(u.name)));
const pmt = await login('PM Test');
ck('PM Test logs in (would be on the list)', !!pmt?.token);
ck('PM Test is retired on the next list load', !(await J('GET', '/api/users')).users.some(u => u.name === 'PM Test'));

const stEnd = await J('GET', '/api/state?trip=nov26');
ck('no listing votes by retiree remain', stEnd.listings.every(l => (l.votes || []).every(v => !isVictim(v.name) && v.token !== vic.token)));
const actEnd = await J('GET', '/api/activities');
ck('no activity votes by retiree remain', actEnd.activities.every(a => (a.votes || []).every(v => !isVictim(v.name) && v.token !== vic.token)));
const splitEnd = await J('GET', '/api/split');
ck('no split trace of retiree remains',
  splitEnd.expenses.every(e => !isVictim(e.paidBy) && !(e.splitAmong || []).some(isVictim)) && !(VICTIM in (splitEnd.balances || {})),
  JSON.stringify(splitEnd.balances));
const carsEnd = await J('GET', '/api/cars');
ck('retiree car seat freed', carsEnd.cars.every(c => Object.values(c.seats).every(w => !isVictim(w))), JSON.stringify(carsEnd.cars).slice(0, 200));
const todosEnd = await J('GET', '/api/todos');
ck('retiree off the task (the task stays)', !!todosEnd.items.find(t => t.id === todoId) && !todosEnd.items.find(t => t.id === todoId).assignees.includes(VICTIM));
const cms = todosEnd.items.find(t => t.id === todoId).comments;
ck("retiree's comment gone, Aster's reply kept under a marker", cms.every(c => c.by !== VICTIM && c.text !== 'retiree comment' && c.replyToName !== VICTIM) && cms.some(c => c.text === 'aster reply') && cms.some(c => c.deleted), JSON.stringify(cms));
const angelPm = await J('GET', `/api/angel?name=PM&token=${pm.token}`);
ck('angel draw survives with the retiree spliced out', angelPm.drawn === true && angelPm.master?.name === 'Aster', JSON.stringify(angelPm.master));
const angelAst = await J('GET', `/api/angel?name=Aster&token=${ast.token}`);
ck('aster now gives to PM', angelAst.master?.name === 'PM', JSON.stringify(angelAst.master));
const boardEnd = await J('GET', '/api/dodge/board');
ck('no dodge record of retiree remains', boardEnd.board.every(r => !isVictim(r.name)), JSON.stringify(boardEnd.board).slice(0, 200));
const repEnd = await J('GET', '/api/dodge/replay?name=' + encodeURIComponent(VICTIM));
ck('no dodge replay of retiree remains', repEnd.ok === false, JSON.stringify(repEnd).slice(0, 200));

// ---- leaving someone out of Secret Angel: any member, logged ----
const out = await J('POST', '/api/angel/exclude', { name: 'Aster', token: ast.token, target: 'PM', excluded: true });
ck('any member can leave someone out, logged', out.ok === true && out.people.find(p => p.name === 'PM')?.excluded === true && (out.log || []).some(l => l.by === 'Aster' && /排除/.test(l.what)), JSON.stringify(out.log));
const back = await J('POST', '/api/angel/exclude', { name: 'PM', token: pm.token, target: 'PM', excluded: false });
ck('and bring them back', back.ok === true && back.people.find(p => p.name === 'PM')?.excluded === false);

// ---- 住宿: once voting has closed (nov25), any member can change the pick — no admin ----
const plain = await login('Plain' + tag);
const dec = await J('POST', '/api/decision', { trip: 'nov25', name: plain.name, token: plain.token, listingId: null });
ck('after voting closed, any member can change the 住宿 pick (no admin)', dec.ok === true, JSON.stringify(dec).slice(0, 160));
const decAnon = await J('POST', '/api/decision', { trip: 'nov25', listingId: null });
ck('changing the pick needs a login', decAnon.ok === false, JSON.stringify(decAnon));

console.log(`USERS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
