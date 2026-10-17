// Concurrency storms: fire many writes at the same document in parallel
// and require that EVERY one survives. This is the regression test for the
// lost-update races — with single-KV read-modify-write these storms lost
// most writes (12 votes sent, 3 landed); the Durable-Object store must
// land them all. All entities are freshly tagged per run, so nothing can
// dedupe against earlier runs.
//
// Runs against a local `wrangler dev` instance (started by run.mjs).
// Standalone use: TEST_BASE=http://localhost:8791 node tests/robustness/storms.mjs
const B = process.env.TEST_BASE || 'http://localhost:8791';
const J = async (method, path, obj) => {
  const r = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json' }, body: obj === undefined ? undefined : JSON.stringify(obj) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* ignore */ }
  return { status: r.status, json: j };
};

let fail = 0;
function storm(name, expected, got) {
  const ok = got === expected;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: expected ${expected}, got ${got}`);
  if (!ok) fail++;
}

const tag = Date.now().toString(36) + Math.floor(Math.random() * 1e4);
const users = [];
for (let i = 0; i < 20; i++) {
  const name = `Storm${tag}_${i}`;
  const u = await J('POST', '/api/login', { name });
  users.push({ name, token: u.json.user.token });
}

// --- listing votes: 12 people vote the same listing at once
const man = await J('POST', '/api/add-manual', { trip: 'nov26', token: users[0].token, name: users[0].name, title: `Storm House ${tag}`, url: 'https://www.airbnb.com/rooms/9' + Math.floor(Math.random() * 1e8) });
const lid = man.json?.listing?.id;
await Promise.all(users.slice(0, 12).map(u => J('POST', '/api/vote', { trip: 'nov26', id: lid, token: u.token, name: u.name })));
const st1 = await J('GET', '/api/state?trip=nov26');
storm('listing votes (12 parallel)', 12, st1.json.listings.find(x => x.id === lid)?.votes?.length ?? -1);

// --- unvote still works after the storm (name: null removes the vote)
await J('POST', '/api/vote', { trip: 'nov26', id: lid, token: users[0].token, name: null });
const st1b = await J('GET', '/api/state?trip=nov26');
storm('unvote after storm', 11, st1b.json.listings.find(x => x.id === lid)?.votes?.length ?? -1);

// --- listing adds: 10 different houses at once
const roomBase = Math.floor(Math.random() * 1e7);
await Promise.all(Array.from({ length: 10 }, (_, i) => J('POST', '/api/add-manual', { trip: 'nov26', token: users[1].token, name: users[1].name, title: `Storm Add ${tag} ${i}`, url: 'https://www.airbnb.com/rooms/6' + (roomBase + i) })));
const st2 = await J('GET', '/api/state?trip=nov26');
storm('listing adds (10 parallel)', 10, st2.json.listings.filter(l => l.title.startsWith(`Storm Add ${tag}`)).length);

// --- expenses: 20 different people each add one at once
const before = (await J('GET', '/api/split')).json.expenses.length;
await Promise.all(users.map(u => J('POST', '/api/expense', { trip: 'nov26', paidBy: u.name, description: `storm-exp ${tag}`, amountUSD: 10, splitAmong: [u.name] })));
const after = (await J('GET', '/api/split')).json.expenses.length;
storm('expenses (20 parallel)', 20, after - before);

// --- activity votes: 12 people vote the same seeded card at once
const acts = await J('GET', '/api/activities');
const card = acts.json.activities.find(a => a.id === 'red-rocks');
const beforeVotes = card.votes.length;
await Promise.all(users.slice(0, 12).map(u => J('POST', '/api/activity-vote', { id: 'red-rocks', token: u.token, name: u.name })));
const acts2 = await J('GET', '/api/activities');
storm('activity votes (12 parallel)', 12, acts2.json.activities.find(a => a.id === 'red-rocks').votes.length - beforeVotes);

// --- food votes: 12 people vote the same new place at once
const food = await J('POST', '/api/food/add', { trip: 'nov26', url: `https://www.google.com/maps/place/Storm+Eats+${tag}/@39.75,-104.99,17z`, addedBy: users[0].name });
const pid = food.json?.place?.id;
await Promise.all(users.slice(0, 12).map(u => J('POST', '/api/food/vote', { trip: 'nov26', id: pid, token: u.token, name: u.name })));
const fl = await J('GET', '/api/food?trip=nov26');
storm('food votes (12 parallel)', 12, fl.json.places.find(p => p.id === pid)?.votes?.length ?? -1);

// --- flight saves: 8 people save their arrival at once (one shared doc)
await Promise.all(users.slice(0, 8).map(u => J('POST', '/api/flights', { name: u.name, token: u.token, for: u.name, arrival: { flight: 'UA100', date: '2026-11-25', from: 'SFO', to: 'DEN', dep: '08:00', arr: '11:30' }, departure: null, noFlight: false })));
const fl2 = await J('GET', '/api/flights');
storm('flight saves (8 parallel)', 8, fl2.json.people.filter(p => users.slice(0, 8).some(u => u.name === p.name) && p.arrival).length);

// --- angel prefs: 8 people submit their answers at once (one shared doc)
await Promise.all(users.slice(0, 8).map(u => J('POST', '/api/angel/prefs', { name: u.name, token: u.token, answers: { nogo: `storm ${tag}`, travel: '耳机', rich: '旅行', shop: '咖啡店', snack: '黑巧' } })));
const angel = await J('GET', '/api/angel');
const submitted = angel.json.people.filter(p => p.submitted && users.slice(0, 8).some(u => u.name === p.name)).length;
storm('angel prefs (8 parallel)', 8, submitted);

console.log(fail ? `STORMS: ${fail} FAILED` : 'STORMS: all passed');
process.exit(fail ? 1 : 0);
