// Each trip's listings live in the store (worker/store) under the
// trip's own key — the same key they had in KV; the store imports the
// legacy KV value on first read. All writes go through updateState so
// concurrent votes/adds/removes can't overwrite each other.
import { uid } from '../lib/http.js';
import { readDoc, transact } from '../lib/store.js';
import { TRIPS } from '../config/trips.js';

// In-place migrations for states saved by older versions.
function normalizeState(state) {
  if (!Array.isArray(state.listings)) state.listings = [];
  if (!Array.isArray(state.members)) state.members = [];
  if (!Array.isArray(state.expenses)) state.expenses = [];
  // Seed listings used to carry hand-typed 4-night prices for old dates.
  // Drop them so only live Airbnb prices are shown. Prices typed into the
  // manual-add form have priceNights and are kept.
  for (const l of state.listings) if (l.priceUSD != null && l.priceNights == null) delete l.priceUSD;
  return state;
}

function seedState(trip) {
  return { listings: trip.seed.map(s => ({ id: uid(), ...s, addedBy: 'Ken', createdAt: Date.now(), votes: [] })), members: [], expenses: [], updatedAt: Date.now() };
}

export async function getState(env, trip) {
  const { doc } = await readDoc(env, trip.kvKey);
  if (doc) return normalizeState(doc);
  // First run ever for this trip: persist the seeded state through the
  // same versioned write path as everything else (exactly once, even
  // if two first-reads race).
  return updateState(env, trip, state => state);
}

// Read the current state, let fn mutate it, and commit — re-reading and
// re-running fn if someone else committed meanwhile. fn returns the
// handler's result (often built from the mutated state). Slow work
// (scraping, geocoding) must happen before calling this, never inside fn.
export async function updateState(env, trip, fn) {
  return transact(env, trip.kvKey, async doc => {
    const state = doc ? normalizeState(doc) : seedState(trip);
    const result = await fn(state);
    state.updatedAt = Date.now();
    return { doc: state, result };
  });
}

// Remove one person's footprint from every trip (used by the thorough
// user deletion in users/retire.js): their listing votes, their name in
// the members lists, and their part in the legacy per-trip expenses.
// Votes match on the account's token, or on the name for votes cast
// before the device adopted the account. Returns votes removed.
export async function scrubUserFromTrips(env, user) {
  const key = user.name.toLowerCase();
  const isUsers = v => (!!user.token && v.token === user.token) || String(v.name || '').toLowerCase() === key;
  let removed = 0;
  for (const trip of Object.values(TRIPS)) {
    await updateState(env, trip, state => {
      for (const l of state.listings) {
        const before = (l.votes || []).length;
        l.votes = (l.votes || []).filter(v => !isUsers(v));
        removed += before - l.votes.length;
      }
      state.members = state.members.filter(m => String(m).toLowerCase() !== key);
      state.expenses = state.expenses.filter(e => {
        if (String(e.paidBy || '').toLowerCase() === key) return false;
        e.splitAmong = (e.splitAmong || []).filter(n => String(n).toLowerCase() !== key);
        return e.splitAmong.length > 0;
      });
    });
  }
  return removed;
}
