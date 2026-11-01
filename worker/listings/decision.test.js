// The group's pick after voting closes (worker/listings/decision.js).
// Run: node --test worker/listings/decision.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { voteView } from './decision.js';

const trip = { checkIn: '2026-11-26', checkOut: '2026-11-29', people: 14, voteEndsAt: '2026-10-31T07:00:00Z' };
const live = available => ({ checkIn: trip.checkIn, checkOut: trip.checkOut, available, total: available ? 3000 : null });
const listing = (id, votes, available = true) => ({ id, votes: Array.from({ length: votes }, (_, i) => ({ name: 'v' + i })), live: live(available) });

test('the most-voted available listing is the pick', () => {
  const v = voteView({ listings: [listing('a', 9), listing('b', 4)] }, trip);
  assert.equal(v.chosenId, 'a');
  assert.equal(v.booking, null);
});

test('a booked listing stays the pick after Airbnb shows it as taken', () => {
  const booking = { listingId: 'a', by: 'ken', status: 'booked', at: 1 };
  const v = voteView({ listings: [listing('a', 9, false), listing('b', 4)], booking }, trip);
  assert.equal(v.chosenId, 'a');
  assert.deepEqual(v.booking, booking);
  assert.deepEqual(v.ranking, ['b'], 'the runners-up still leave out what is taken');
});

test('a claim holds the pick too, until it is let go', () => {
  const booking = { listingId: 'a', by: 'ken', status: 'claimed', at: 1 };
  assert.equal(voteView({ listings: [listing('a', 9, false), listing('b', 4)], booking }, trip).chosenId, 'a');
  assert.equal(voteView({ listings: [listing('a', 9, false), listing('b', 4)], booking: null }, trip).chosenId, 'b');
});

test('changing the pick by hand still wins over a booking', () => {
  const state = { listings: [listing('a', 9), listing('b', 4)], booking: { listingId: 'a', by: 'ken', status: 'booked', at: 1 }, decision: { listingId: 'b', by: 'amy', at: 2 } };
  const v = voteView(state, trip);
  assert.equal(v.chosenId, 'b');
  assert.equal(v.booking, null);
});

test('while voting is open there is no pick', () => {
  assert.equal(voteView({ listings: [listing('a', 9)] }, { ...trip, voteEndsAt: null }).chosenId, null);
});
