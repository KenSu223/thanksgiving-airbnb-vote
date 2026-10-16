// Each trip's restaurant shortlist lives in the store (worker/store)
// under food:<trip>:v1 — the same key it had in KV; the store imports
// the legacy KV value on first read. Writes go through updateFood so
// concurrent votes/adds can't overwrite each other.
import { DEFAULT_TRIP, TRIPS } from '../config/trips.js';
import { readDoc, transact } from '../lib/store.js';

export const foodKey = trip => 'food:' + (TRIPS[trip] ? trip : DEFAULT_TRIP) + ':v1';

const normalize = food => {
  if (!food || typeof food !== 'object') food = {};
  if (!Array.isArray(food.places)) food.places = [];
  return food;
};

export async function getFood(env, trip) {
  const { doc } = await readDoc(env, foodKey(trip));
  return normalize(doc);
}

// fn(food) mutates the freshest document and returns the handler's
// result; the commit is version-checked (see lib/store.js).
export async function updateFood(env, trip, fn) {
  return transact(env, foodKey(trip), async doc => {
    const food = normalize(doc);
    const result = await fn(food);
    food.updatedAt = Date.now();
    return { doc: food, result };
  });
}

// Remove one person's restaurant votes from every trip (thorough user
// deletion, users/retire.js). Returns votes removed.
export async function scrubUserFromFood(env, user) {
  const key = user.name.toLowerCase();
  let removed = 0;
  for (const trip of Object.keys(TRIPS)) {
    await updateFood(env, trip, food => {
      for (const p of food.places) {
        const before = (p.votes || []).length;
        p.votes = (p.votes || []).filter(v => !(!!user.token && v.token === user.token) && String(v.name || '').toLowerCase() !== key);
        removed += before - p.votes.length;
      }
    });
  }
  return removed;
}
