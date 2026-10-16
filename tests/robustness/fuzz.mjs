// Robustness fuzz battery: throw malformed, edge-case and wrong-method
// requests at every API endpoint and require the worker to answer with a
// structured result — never a 5xx, HTML error page or unparseable body.
//
// Runs against a local `wrangler dev` instance (started by run.mjs).
// Standalone use: TEST_BASE=http://localhost:8791 node tests/robustness/fuzz.mjs
const B = process.env.TEST_BASE || 'http://localhost:8791';

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) pass++;
  else { fail++; failures.push(name + (extra ? ' — ' + extra : '')); }
}

// A request is well-handled when the status is < 500 and the body (when
// present) is JSON. Wrong-method requests may 404 with an empty body.
async function req(method, path, rawBody, headers = {}) {
  // A 503 saying "worker restarted mid-request" is the local dev server
  // reloading (it rebuilds once at startup), not the app answering —
  // production never emits it. Retry those; everything else is judged
  // as-is.
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(B + path, { method, headers, body: rawBody });
      const text = await r.text();
      if (r.status === 503 && text.includes('restarted mid-request') && attempt < 3) {
        await new Promise(s => setTimeout(s, 1500));
        continue;
      }
      let json = null, jsonOk = true;
      try { json = JSON.parse(text); } catch { jsonOk = false; }
      return { status: r.status, json, jsonOk, text };
    } catch (e) {
      return { status: 0, json: null, jsonOk: false, text: String(e) };
    }
  }
}
const J = (method, path, obj) => req(method, path, obj === undefined ? undefined : JSON.stringify(obj), { 'Content-Type': 'application/json' });
const healthy = r => r.status > 0 && r.status < 500 && (r.text === '' || r.jsonOk);
const isErr = r => r.json && r.json.ok === false && typeof r.json.error === 'string';

// --- setup: one real user and one real listing to abuse politely
const login = await J('POST', '/api/login', { name: 'FuzzAlice' });
check('login works', login.json?.ok && login.json.user?.token, JSON.stringify(login.json));
const token = login.json.user.token;
const seeds = await J('GET', '/api/state?trip=nov26');
const seedListing = seeds.json.listings[0];
check('seed listing exists', !!seedListing?.id);

// Duplicate names: the same account must come back for case variants,
// extra inner whitespace and padded spellings — never a second account.
const dupTag = Date.now().toString(36);
const d1 = await J('POST', '/api/login', { name: `Case ${dupTag}`, token: 'dup-dev-1' });
const d2 = await J('POST', '/api/login', { name: `case ${dupTag}`, token: 'dup-dev-2' });
check('case-variant join returns the same account', d1.json?.user?.token === d2.json?.user?.token && d2.json?.user?.name === `Case ${dupTag}`, JSON.stringify(d2.json));
const s1 = await J('POST', '/api/login', { name: `Space  ${dupTag}`, token: 'dup-dev-3' });
const s2 = await J('POST', '/api/login', { name: ` Space ${dupTag} `, token: 'dup-dev-4' });
check('whitespace-variant join returns the same account', s1.json?.user?.token === s2.json?.user?.token && s1.json?.user?.name === `Space ${dupTag}`, JSON.stringify(s1.json));
const [c1, c2] = await Promise.all([
  J('POST', '/api/login', { name: `Race ${dupTag}`, token: 'dup-dev-5' }),
  J('POST', '/api/login', { name: `Race ${dupTag}`, token: 'dup-dev-6' }),
]);
const listAfter = await J('GET', '/api/users');
const raceCount = (listAfter.json?.users || []).filter(u => u.name.toLowerCase() === `race ${dupTag}`).length;
check('simultaneous same-name joins create one account', raceCount === 1 && c1.json?.user?.token === c2.json?.user?.token, `count=${raceCount}`);

// --- read endpoints with junk input
for (const [name, p] of [
  ['state bogus trip', '/api/state?trip=BOGUS'],
  ['state no trip', '/api/state'],
  ['food bogus trip', '/api/food?trip=BOGUS'],
  ['users', '/api/users'],
  ['activities', '/api/activities'],
  ['split', '/api/split'],
  ['flights', '/api/flights'],
  ['airports', '/api/airports'],
  ['weather', '/api/weather'],
  ['angel no name', '/api/angel'],
  ['angel bogus name', '/api/angel?name=NobodyHere123'],
  ['unknown route', '/api/definitely-not-a-route'],
]) {
  const r = await J('GET', p);
  check(`GET ${name}: no 5xx, JSON`, healthy(r), `status=${r.status} body=${r.text.slice(0, 80)}`);
}

// --- malformed bodies on every POST endpoint
const postPaths = ['/api/login', '/api/vote', '/api/add', '/api/add-manual', '/api/remove', '/api/member',
  '/api/food/add', '/api/food/vote', '/api/food/remove', '/api/food/photos', '/api/activity-add', '/api/activity-vote',
  '/api/activity-remove', '/api/activity-place', '/api/activity-image', '/api/expense', '/api/expense-update',
  '/api/expense-remove', '/api/flights', '/api/flights/pickup', '/api/angel/prefs',
  '/api/angel/exclude', '/api/angel/draw', '/api/decision', '/api/booking',
  '/api/zones', '/api/area', '/api/prices', '/api/enrich'];
for (const p of postPaths) {
  for (const [label, raw, ct] of [
    ['non-JSON body', 'this is not json{{{', { 'Content-Type': 'application/json' }],
    ['empty body', '', { 'Content-Type': 'application/json' }],
    ['JSON null', 'null', { 'Content-Type': 'application/json' }],
    ['JSON array', '[]', { 'Content-Type': 'application/json' }],
    ['JSON number', '5', { 'Content-Type': 'application/json' }],
    ['huge body', 'x'.repeat(300 * 1024), { 'Content-Type': 'application/json' }],
    ['no content-type', JSON.stringify({}), {}],
  ]) {
    const r = await req('POST', p, raw, ct);
    check(`POST ${p} ${label}: no 5xx`, healthy(r), `status=${r.status} body=${r.text.slice(0, 80)}`);
  }
}

// --- wrong methods: must be a clean 404/405, not a crash
for (const [m, p] of [['DELETE', '/api/vote'], ['PUT', '/api/login'], ['PATCH', '/api/state'], ['DELETE', '/api/split'], ['PUT', '/api/activities']]) {
  const r = await J(m, p, {});
  check(`${m} ${p}: no 5xx`, healthy(r), `status=${r.status}`);
}

// --- field-level abuse on a real listing vote
const V = obj => J('POST', '/api/vote', obj);
check('vote without token', isErr(await V({ trip: 'nov26', id: seedListing.id, name: 'FuzzAlice' })));
check('vote bogus listing', isErr(await V({ trip: 'nov26', id: 'nope123', token, name: 'FuzzAlice' })));
check('vote oversized token handled', healthy(await V({ trip: 'nov26', id: seedListing.id, token: 'x'.repeat(5000), name: 'FuzzAlice' })));
check('vote html in name handled', healthy(await V({ trip: 'nov26', id: seedListing.id, token, name: '<script>alert(1)</script>' })));
check('vote numeric name handled', healthy(await V({ trip: 'nov26', id: seedListing.id, token, name: 12345 })));
// An unknown trip id silently falls back to the default trip (long-standing
// behavior) — the requirement here is only that it answers cleanly.
check('vote bogus trip handled', healthy(await V({ trip: 'BOGUS', id: seedListing.id, token, name: 'FuzzAlice' })));

// --- expense amount validation (amounts are cents server-side)
const E = obj => J('POST', '/api/expense', { trip: 'nov26', paidBy: 'FuzzAlice', splitAmong: ['FuzzAlice'], ...obj });
for (const [label, amount, want] of [
  ['zero', 0, 'err'], ['negative', -5, 'err'], ['non-numeric', 'abc', 'err'], ['sub-cent', 0.001, 'err'],
  ['numeric string ok', '15.00', 'ok'], ['rounds to a cent ok', 0.005, 'ok'], ['plain ok', 12.34, 'ok'],
]) {
  const r = await E({ description: 'amt:' + label, amountUSD: amount });
  check(`expense amount ${label}`, want === 'err' ? isErr(r) : r.json?.ok === true, JSON.stringify(r.json).slice(0, 100));
}
const exList = await J('GET', '/api/split');
for (const e of exList.json.expenses.filter(x => String(x.description).startsWith('amt:'))) {
  await J('POST', '/api/expense-remove', { id: e.id, trip: 'nov26' });
}

// --- protected endpoints reject strangers
check('angel prefs without login', isErr(await J('POST', '/api/angel/prefs', { name: 'NotARealPerson999', wishes: 'x' })));
check('angel draw without a login', isErr(await J('POST', '/api/angel/draw', { name: 'NotARealPerson999' })));
check('decision close without chooser', (await J('POST', '/api/decision', { trip: 'nov26', name: '', action: 'close' })).json?.ok === false);
check('decision unknown action', (await J('POST', '/api/decision', { trip: 'nov26', name: 'FuzzAlice', action: 'explode' })).json?.ok === false);

console.log(`FUZZ: ${pass} passed, ${fail} failed`);
for (const f of failures) console.log('FAIL:', f);
process.exit(fail ? 1 : 0);
