// To-dos (worker/todos): adding and validation, assigning (whoever added it
// only — Aster too, everyone has the same rights), picking up a task yourself and dropping it, ticking done, edit /
// delete permissions, and a storm of people picking up the same task at
// once — every one of them must end up on it.
// Standalone use: TEST_BASE=http://localhost:8791 node tests/robustness/todos.mjs
const B = process.env.TEST_BASE || 'http://localhost:8791';
const post = async (p, o) => (await fetch(B + p, { method: 'POST', body: JSON.stringify(o) })).json();
const get = async p => (await fetch(B + p)).json();
let pass = 0, fail = 0;
const ck = (n, c, x) => { if (c) pass++; else fail++; console.log(c ? 'OK  ' : 'FAIL', n, c ? '' : JSON.stringify(x ?? '').slice(0, 300)); };
// test accounts get a Todo prefix so other suites' users don't collide; Aster keeps her real name (she used to be the admin)
const N = n => (n === 'Aster' ? n : 'Todo' + n);
const u = {};
for (const n of ['Aster', 'Ken', 'Peter', 'Nan', 'Cindy', 'Shandra', 'Gu', 'Song']) u[n] = (await post('/api/login', { name: N(n) })).user;
const as = n => ({ name: u[n].name, token: u[n].token });
const find = (r, id) => (r.items || []).find(t => t.id === id);

let r = await post('/api/todos', { title: 'nope' });
ck('needs login', r.ok === false, r);
r = await post('/api/todos', { ...as('Ken'), title: '   ' });
ck('empty title refused', r.ok === false, r);
r = await post('/api/todos', { ...as('Ken'), title: '买 Costco 早餐', phase: 'during', due: '2026-11-26', note: '鸡蛋、牛奶', assignees: [N('Nan'), 'NoSuchPerson', N('Nan')] });
const t1 = r.items && r.items[0];
ck('Ken adds a task, unknown/duplicate assignees dropped', r.ok && t1.title === '买 Costco 早餐' && t1.phase === 'during' && t1.due === '2026-11-26' && JSON.stringify(t1.assignees) === JSON.stringify([N('Nan')]) && t1.by === N('Ken'), t1);
r = await post('/api/todos', { ...as('Ken'), title: 'x', due: 'tomorrow' });
ck('bad date refused', r.ok === false, r);
r = await post('/api/todos/claim', { ...as('Peter'), id: t1.id, claim: true });
ck('Peter picks it up', r.ok && find(r, t1.id).assignees.includes(N('Peter')), find(r, t1.id));
r = await post('/api/todos/claim', { ...as('Nan'), id: t1.id, claim: false });
ck('Nan drops out', r.ok && !find(r, t1.id).assignees.includes(N('Nan')), find(r, t1.id));
r = await post('/api/todos/assign', { ...as('Peter'), id: t1.id, assignees: [N('Cindy')] });
ck('non-owner cannot assign', r.ok === false, r);
r = await post('/api/todos/assign', { ...as('Ken'), id: t1.id, assignees: [N('Cindy'), N('Peter')] });
ck('owner assigns', r.ok && find(r, t1.id).assignees.length === 2, find(r, t1.id));
r = await post('/api/todos/assign', { ...as('Aster'), id: t1.id, assignees: [N('Shandra')] });
ck('Aster cannot assign a task she did not add', r.ok === false, r);
r = await post('/api/todos/edit', { ...as('Aster'), id: t1.id, title: 'mine now' });
ck('Aster cannot edit a task she did not add', r.ok === false, r);
r = await post('/api/todos/edit', { ...as('Peter'), id: t1.id, title: 'hijack' });
ck('non-owner cannot edit', r.ok === false, r);
r = await post('/api/todos/edit', { ...as('Ken'), id: t1.id, title: '买 Costco 早餐 + 咖啡', due: '' });
ck('owner edits (title, clears due), keeps phase', r.ok && find(r, t1.id).title.endsWith('咖啡') && find(r, t1.id).due === '' && find(r, t1.id).phase === 'during', find(r, t1.id));
r = await post('/api/todos/done', { ...as('Shandra'), id: t1.id, done: true });
ck('done, with who', r.ok && find(r, t1.id).done && find(r, t1.id).doneBy === N('Shandra'), find(r, t1.id));
r = await post('/api/todos/done', { ...as('Gu'), id: t1.id, done: false });
ck('reopened', r.ok && !find(r, t1.id).done && !find(r, t1.id).doneBy, find(r, t1.id));
// storm: everyone picks up a fresh task at the same moment
r = await post('/api/todos', { ...as('Song'), title: '洗碗', phase: 'during' });
const t2 = r.items[0];
const crowd = ['Ken', 'Peter', 'Nan', 'Cindy', 'Shandra', 'Gu', 'Song'];
await Promise.all(crowd.map(n => post('/api/todos/claim', { ...as(n), id: t2.id, claim: true })));
r = await get('/api/todos');
ck('claim storm: all 7 on it', find(r, t2.id).assignees.length === 7, find(r, t2.id).assignees);
r = await post('/api/todos/delete', { ...as('Ken'), id: t2.id });
ck('non-owner cannot delete', r.ok === false && !!find(r, t2.id), r.error);
r = await post('/api/todos/delete', { ...as('Song'), id: t2.id });
ck('owner deletes', r.ok && !find(r, t2.id), r.error);
r = await post('/api/todos/claim', { ...as('Ken'), id: 'gone', claim: true });
ck('missing task', r.ok === false, r);
console.log(`TODOS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
