// Car seats and luggage (worker/cars): first come, first served — two
// people tapping the same seat get exactly one winner, nobody ever holds
// two seats (even in a storm of everyone grabbing seats at once), nobody acts
// for anyone else — Aster included (everyone has the same rights) — anyone
// can name a car, and luggage counts are capped to the presets. Car models: the
// catalog's layouts are sound, it starts as three X5s, anyone (signed in) can
// change a car's model — people in seats the new model lacks are moved or asked
// to pick again, never put in the driver's seat — add a car (up to 8) or take
// one away (one always stays), and each of those is logged with who did it.
// Standalone use: TEST_BASE=http://localhost:8791 node tests/robustness/cars.mjs
const B = process.env.TEST_BASE || 'http://localhost:8791';
const post = async (p, o) => (await fetch(B + p, { method: 'POST', body: JSON.stringify(o) })).json();
const get = async p => (await fetch(B + p)).json();
let pass = 0, fail = 0;
const ck = (n, c, x) => { if (c) pass++; else fail++; console.log(c ? 'OK  ' : 'FAIL', n, c ? '' : JSON.stringify(x ?? '').slice(0, 300)); };
const u = {};
// test accounts get a Car prefix so other suites' users don't collide; Aster keeps her real name (she used to be the admin)
const N = n => (n === 'Aster' ? n : 'Car' + n);
for (const n of ['Aster', 'Ken', 'Peter', 'Nan', 'Cindy', 'Shandra']) u[n] = (await post('/api/login', { name: N(n) })).user;
const as = n => ({ name: u[n].name, token: u[n].token });
const seatOf = (d, who) => { for (const c of d.cars) for (const [s, w] of Object.entries(c.seats)) if (w === who) return c.id + ':' + s; return null; };

let r = await post('/api/cars/seat', { car: 'a', seat: 'driver' });
ck('needs login', r.ok === false && /登录/.test(r.error), r);
r = await post('/api/cars/seat', { ...as('Ken'), car: 'a', seat: 'driver' });
ck('Ken takes car a driver', r.ok && seatOf(r, N('Ken')) === 'a:driver', r);
// race: Peter and Nan tap the same seat together
const [p1, p2] = await Promise.all([post('/api/cars/seat', { ...as('Peter'), car: 'b', seat: 'front' }), post('/api/cars/seat', { ...as('Nan'), car: 'b', seat: 'front' })]);
ck('same-seat race: exactly one winner', [p1, p2].filter(x => x.ok).length === 1 && [p1, p2].some(x => /晚了一步/.test(x.error || '')), [p1, p2]);
const winner = p1.ok ? 'Peter' : 'Nan';
r = await get('/api/cars');
ck('winner sits there', r.cars.find(c => c.id === 'b').seats.front === N(winner), r.cars);
r = await post('/api/cars/seat', { ...as('Cindy'), car: 'a', seat: 'driver' });
ck('taken seat refused', !r.ok && /Ken/.test(r.error), r);
r = await post('/api/cars/seat', { ...as('Ken'), car: 'c', seat: 'rearMiddle' });
ck('Ken moves: one seat per person', seatOf(r, N('Ken')) === 'c:rearMiddle' && !r.cars.find(c => c.id === 'a').seats.driver, r.cars);
r = await post('/api/cars/seat', { ...as('Ken'), seat: null });
ck('Ken gives up seat', !seatOf(r, N('Ken')), r.cars);
r = await post('/api/cars/seat', { ...as('Ken'), car: 'a', seat: 'front', who: N('Cindy') });
ck('nobody can seat someone else', !r.ok, r);
r = await post('/api/cars/seat', { ...as('Aster'), car: 'a', seat: 'front', who: N('Cindy') });
ck('Aster cannot seat someone else either', !r.ok && !seatOf(await get('/api/cars'), N('Cindy')), r);
await post('/api/cars/seat', { ...as('Cindy'), car: 'a', seat: 'front' });
const clear = await fetch(B + '/api/cars/clear', { method: 'POST', body: JSON.stringify({ ...as('Aster'), car: 'a', seat: 'front' }) }).then(x => x.text());
ck('nobody can clear another person seat any more', !/"ok":true/.test(clear) && seatOf(await get('/api/cars'), N('Cindy')) === 'a:front', clear.slice(0, 120));
r = await post('/api/cars/bags', { ...as('Nan'), bags: { large: 2, backpack: 1, skis: 99, bogus: 3 } });
ck('bags saved, capped, unknown dropped', r.ok && JSON.stringify(r.bags[N('Nan')]) === JSON.stringify({ backpack: 1, large: 2, skis: 6 }), r.bags);
r = await post('/api/cars/bags', { ...as('Nan'), bags: {} });
ck('bags cleared', r.ok && !r.bags[N('Nan')], r.bags);
r = await post('/api/cars/label', { ...as('Ken'), car: 'b', label: 'Sixt · 黑色' });
ck('anyone names a car', r.ok && r.cars[1].label === 'Sixt · 黑色', r.cars);
r = await post('/api/cars/label', { car: 'c', label: 'nope' });
ck('naming a car needs a login', !r.ok, r);
r = await post('/api/cars/seat', { ...as('Ken'), car: 'z', seat: 'driver' });
ck('bad car refused', !r.ok, r);
// fill the 15 seats in parallel with 6 people each racing for random seats: no one ends up in two seats
const all = ['Aster', 'Ken', 'Peter', 'Nan', 'Cindy', 'Shandra'];
await Promise.all(all.flatMap(n => ['a', 'b', 'c'].map(c => post('/api/cars/seat', { ...as(n), car: c, seat: 'rearLeft' }))));
r = await get('/api/cars');
const occ = r.cars.flatMap(c => Object.values(c.seats).filter(Boolean));
ck('storm: nobody holds two seats', occ.length === new Set(occ).size, r.cars);

// ---- car models (web/src/features/cars/models.js): the catalog, then changing / adding / removing cars ----
const M = await import('../../web/src/features/cars/models.js');
ck('catalog: every layout has distinct, named seats; every model has a class and a trunk', M.MODELS.every(m => m.liters > 0 && M.CLASSES.some(c => c.id === m.cls)
  && [m.rows, m.alt].filter(Boolean).every(rows => { const ids = M.seatIds(rows); return new Set(ids).size === ids.length && ids.length === M.seatCount(rows) && ids.every(id => M.seatName(id, rows) !== id); })));
ck('catalog: the old X5 seats keep their ids', JSON.stringify(M.seatIds([2, 3])) === JSON.stringify(['driver', 'front', 'rearLeft', 'rearMiddle', 'rearRight']));
ck('catalog: other-model seat counts lay out right', [2, 3, 4, 5, 6, 7, 8, 12, 15].every(n => M.seatCount(M.rowsForSeats(n)) === n));
r = await get('/api/cars');
ck('it starts as three X5s, five seats each', r.cars.length === 3 && r.cars.every(c => c.model === 'x5' && JSON.stringify(c.rows) === '[2,3]' && Object.keys(c.seats).length === 5), r.cars);
for (const n of all) await post('/api/cars/seat', { ...as(n), seat: null });
await post('/api/cars/seat', { ...as('Ken'), car: 'c', seat: 'rearMiddle' });
r = await post('/api/cars/model', { car: 'c', model: 'tahoe', v: 1 });
ck('changing a model needs a login', !r.ok && /登录/.test(r.error), r);
r = await post('/api/cars/model', { ...as('Peter'), car: 'c', model: 'nope' });
ck('an unknown model is refused', !r.ok, r);
r = await post('/api/cars/model', { ...as('Peter'), car: 'c', model: 'tahoe', v: 1 });
const tahoe = r.cars?.find(c => c.id === 'c');
ck('anyone changes a car: a Tahoe with 7 seats (2+2+3)', r.ok && tahoe.model === 'tahoe' && tahoe.v === 1 && JSON.stringify(tahoe.rows) === '[2,2,3]' && Object.keys(tahoe.seats).length === 7, tahoe);
ck('someone in a seat the new model lacks moves to a back seat', seatOf(r, N('Ken')) === 'c:rearLeft' && r.moved?.length === 1 && /Ken/.test(r.moved[0]), [seatOf(r, N('Ken')), r.moved]);
ck('the change is logged with who did it', r.log?.[0]?.by === N('Peter') && /Tahoe/.test(r.log[0].what) && /挪了座/.test(r.log[0].what), r.log?.[0]);
r = await post('/api/cars/model', { ...as('Peter'), car: 'c', model: 'tahoe', v: 1 });
ck('the same model again is refused', !r.ok && /已经/.test(r.error), r);
r = await post('/api/cars/seat', { ...as('Nan'), car: 'c', seat: 'r3-2' });
ck('third-row seats can be taken', r.ok && seatOf(r, N('Nan')) === 'c:r3-2', r.error);
r = await post('/api/cars/seat', { ...as('Cindy'), car: 'c', seat: 'rearMiddle' });
ck('a seat the model does not have is refused', !r.ok, r);
// fill the third row, then shrink to a Camry: back seats first, then the front passenger seat, never the driver's
for (const [n, s] of [['Aster', 'rearRight'], ['Cindy', 'r3-1'], ['Shandra', 'r3-3']]) await post('/api/cars/seat', { ...as(n), car: 'c', seat: s });
r = await post('/api/cars/model', { ...as('Nan'), car: 'c', model: 'camry' });
const camry = r.cars?.find(c => c.id === 'c');
ck('shrinking: two of the third row move (back middle, then front), one picks again, driver seat left alone',
  r.ok && r.moved?.length === 2 && r.unseated?.length === 1 && !camry.seats.driver && camry.seats.rearMiddle && camry.seats.front && Object.values(camry.seats).filter(Boolean).length === 4, [r.moved, r.unseated, camry?.seats]);
const occ2 = r.cars.flatMap(c => Object.values(c.seats).filter(Boolean));
ck('nobody holds two seats after a model change', occ2.length === new Set(occ2).size, r.cars);
r = await post('/api/cars/model', { ...as('Peter'), car: 'b', model: 'custom', custom: { name: '', seats: 8 } });
ck('other model needs a name', !r.ok, r);
r = await post('/api/cars/model', { ...as('Peter'), car: 'b', model: 'custom', custom: { name: 'Toyota Sequoia', seats: 30, trunk: 'L' } });
ck('other model: the seat count is checked', !r.ok && /座位数/.test(r.error), r);
r = await post('/api/cars/model', { ...as('Peter'), car: 'b', model: 'custom', custom: { name: 'Toyota Sequoia', seats: 8, trunk: 'L' } });
const seq = r.cars?.find(c => c.id === 'b');
ck('other model: its name, 8 seats laid out 2+3+3, its trunk size', r.ok && seq.custom?.name === 'Toyota Sequoia' && JSON.stringify(seq.rows) === '[2,3,3]' && seq.custom.trunk === 'L', seq);
r = await post('/api/cars/add', { model: 'suburban' });
ck('adding a car needs a login', !r.ok, r);
r = await post('/api/cars/add', { ...as('Shandra'), model: 'suburban' });
ck('anyone adds a car: a Suburban with 8 seats', r.ok && r.cars.length === 4 && r.cars[3].model === 'suburban' && Object.keys(r.cars[3].seats).length === 8 && r.added === r.cars[3].id, r.cars?.[3]);
const added = r.added;
await post('/api/cars/seat', { ...as('Shandra'), car: added, seat: 'r3-3' });
for (let i = 0; i < 6; i++) r = await post('/api/cars/add', { ...as('Ken'), model: 'camry' });
ck('at most 8 cars', r.ok === false && /最多/.test(r.error) && r.cars.length === 8, [r.error, r.cars?.length]);
r = await post('/api/cars/remove', { ...as('Cindy'), car: added });
ck('anyone removes a car; its riders pick again', r.ok && !r.cars.some(c => c.id === added) && r.unseated?.includes(N('Shandra')) && !seatOf(r, N('Shandra')), r.unseated);
ck('the removal is logged with who did it', /去掉了/.test(r.log?.[0]?.what) && r.log[0].by === N('Cindy'), r.log?.[0]);
for (const c of r.cars.slice(1)) r = await post('/api/cars/remove', { ...as('Ken'), car: c.id });
ck('down to one car', r.ok && r.cars.length === 1, r.cars?.length);
r = await post('/api/cars/remove', { ...as('Ken'), car: r.cars[0].id });
ck('the last car stays', !r.ok && /至少/.test(r.error), r);
console.log(`CARS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
