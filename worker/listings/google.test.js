// Parser tests for the Google Hotels pull (listings/google.js) against
// a synthetic page fragment shaped like the real one. Run:
//   node --test worker/listings/google.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { googleEntityFrom, parseGoogleOffers, parseGoogleInfo, parseGoogleRating } from './google.js';

const TRIP = { checkIn: '2026-11-25', checkOut: '2026-11-26' };
// One offer record, shaped like Google's blob: provider, id, click URL,
// then the price block ["$nightly","$total", nightly, total, n, t].
const offer = (name, id, n, t) => `["${name}",${id},"/travel/lodging/clk?pc\\u003dXYZ",[null],null,0,`
  + `[null,null,null,null,["$${n}","$${t}",${n}.5,${t}.5,${n},${t}],["$${n}","$${t}",${n}.5,${t}.5,${n},${t}]]]`;
const PAGE = '<title>Hilton Garden Inn Denver Downtown - Google hotels</title>'
  + '<img src="https://lh3.googleusercontent.com/p/AF1QipTestPhotoOne">'
  + '<img src="https://lh3.googleusercontent.com/p/AF1QipTestPhotoOne">'
  + '<img src="https://lh3.googleusercontent.com/p/AF1QipTestPhotoTwo">'
  + offer('Traveluro', 1073209370, 89, 103)
  + offer('Booking.com', 1234567890, 93, 107)
  + offer('Traveluro', 1073209370, 95, 110) // a worse duplicate of the same provider
  + '["2026-11-25","2026-11-26",1,42,2,null,0]';

test('entity id comes out of a share link', () => {
  assert.equal(
    googleEntityFrom('https://www.google.com/travel/hotels/entity/ChcI_p23-Jvop9JsGgsvZy8xdGh3X3ljehAB/prices?q=Denver+hotels&ts=CAE'),
    'ChcI_p23-Jvop9JsGgsvZy8xdGh3X3ljehAB');
  assert.equal(googleEntityFrom('https://www.booking.com/hotel/us/x.html'), null);
});

test('offers: cheapest provider wins, duplicates keep the min', () => {
  const o = parseGoogleOffers(PAGE, TRIP);
  assert.equal(o.provider, 'Traveluro');
  assert.equal(o.nightly, 89);
  assert.equal(o.total, 103);
  assert.equal(o.offers, 2);
});

test('offers: a page dated for other dates is refused', () => {
  assert.equal(parseGoogleOffers(PAGE, { checkIn: '2026-12-24', checkOut: '2026-12-25' }), null);
  assert.equal(parseGoogleOffers('<html>no data</html>', TRIP), null);
});

test('info: title and deduped photos', () => {
  const info = parseGoogleInfo(PAGE);
  assert.equal(info.title, 'Hilton Garden Inn Denver Downtown');
  assert.deepEqual(info.photos, [
    'https://lh3.googleusercontent.com/p/AF1QipTestPhotoOne',
    'https://lh3.googleusercontent.com/p/AF1QipTestPhotoTwo',
  ]);
});

test('rating: parsed from the search card label, scaled to /10', () => {
  const html = 'aria-label="4.3 out of 5 stars from 1,942 reviews, Hilton Garden Inn Denver Downtown"';
  assert.deepEqual(parseGoogleRating(html, 'Hilton Garden Inn Denver Downtown'), { rating: 8.6, reviews: 1942 });
  assert.equal(parseGoogleRating(html, 'Some Other Hotel'), null);
});
