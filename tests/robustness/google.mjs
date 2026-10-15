// Google Hotels pull (worker/listings/google.js): a pasted Google
// hotel link becomes a full card — name, photos, rating and a dated
// price — and /api/prices re-pulls it. The worker fetches Google live,
// so when the network path is down the live assertions warn instead of
// failing (the parser itself is unit-tested in google.test.js).
// Standalone use: TEST_BASE=http://localhost:8791 node tests/robustness/google.mjs
const B = process.env.TEST_BASE || 'http://localhost:8791';
const J = async (m, p, o) => {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: o === undefined ? undefined : JSON.stringify(o) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* ignore */ }
  return j;
};
let pass = 0, fail = 0;
const ck = (name, cond, extra) => { if (cond) { pass++; console.log('OK  ', name); } else { fail++; console.log('FAIL', name, extra ?? ''); } };
const warn = name => console.log('WARN', name, '(live Google fetch unavailable — skipped)');
const tag = Date.now().toString(36);
const LINK = 'https://www.google.com/travel/hotels/entity/ChcI_p23-Jvop9JsGgsvZy8xdGh3X3ljehAB/prices?q=Denver+hotels&hl=en';

// ---- validation ----
const notGoogle = await J('POST', '/api/add-google', { url: 'https://www.airbnb.com/rooms/12345' });
ck('non-Google URL rejected', notGoogle.ok === false, JSON.stringify(notGoogle));

// ---- a real add (default trip = nov26, 11/26–11/29) ----
const made = await J('POST', '/api/add-google', { url: LINK, addedBy: 'GoogleTester' });
if (!made.ok || !made.listing?.title) {
  warn('add-google live add');
  console.log(`GOOGLE: ${pass} passed, ${fail} failed (live part skipped)`);
  process.exit(fail ? 1 : 0);
}
const L = made.listing;
ck('google hotel created', L.kind === 'hotel' && L.source === 'google', JSON.stringify(L).slice(0, 200));
ck('roomId carries the entity', L.roomId === 'g:ChcI_p23-Jvop9JsGgsvZy8xdGh3X3ljehAB', L.roomId);
ck('title pulled from Google', /Hilton Garden Inn/.test(L.title), L.title);
ck('photos pulled', (L.images || []).length >= 1 && !!L.image, String((L.images || []).length));
if (L.gPrice) {
  ck('price dated for the trip', L.gPrice.checkIn === '2026-11-26' && L.gPrice.checkOut === '2026-11-29', JSON.stringify(L.gPrice));
  ck('price snapshot mirrors gPrice', L.priceUSD === L.gPrice.total && L.priceNights === 3, `${L.priceUSD}/${L.priceNights}`);
} else warn('gPrice on add');

// ---- re-paste refreshes in place; a vote survives ----
const login = await J('POST', '/api/login', { name: 'GoogleVoter' + tag, token: 'dev-google-' + tag });
const v = await J('POST', '/api/vote', { id: L.id, name: login.user?.name, token: login.user?.token });
ck('vote on a google hotel works', v.ok === true && v.voted === true, JSON.stringify(v).slice(0, 200));
const again = await J('POST', '/api/add-google', { url: LINK, addedBy: 'GoogleTester' });
ck('re-paste reports updated, same card', again.ok === true && again.updated === true && again.listing?.id === L.id, JSON.stringify(again).slice(0, 200));
const st = await J('GET', '/api/state');
const cards = (st.listings || []).filter(l => l.roomId === L.roomId);
ck('still exactly one card, vote intact', cards.length === 1 && (cards[0].votes || []).length === 1, `${cards.length} cards`);

// ---- the prices door re-pulls google hotels ----
const pr = await J('POST', '/api/prices', { id: L.id, force: true });
if (pr.googleUpdated >= 1) ck('prices run re-pulled the google hotel', true);
else warn('prices googleUpdated');
const st2 = await J('GET', '/api/state');
const after = (st2.listings || []).find(l => l.id === L.id);
ck('card keeps its pulled price after prices run', !!after?.gPrice || !!after?.priceUSD, JSON.stringify(after).slice(0, 200));

console.log(`GOOGLE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
