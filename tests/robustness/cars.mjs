// Car seats and luggage (worker/cars): first come, first served — two
// people tapping the same seat get exactly one winner, nobody ever holds
// two seats (even in a storm of everyone grabbing seats at once), nobody acts
// for anyone else — Aster included (everyone has the same rights) — anyone
// can name a car, and luggage counts are capped to the presets.
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
console.log(`CARS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
