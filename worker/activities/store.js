// Where the activity candidates and their votes are stored: one
// document for the whole group (activities span all three bases of
// the trip), kept in the store (worker/store) under its old KV key;
// the store imports the legacy KV value on first read. Writes go
// through updateActivities so concurrent votes/adds can't overwrite
// each other.
import { SEED } from './seed.js';
import { readDoc, transact } from '../lib/store.js';

const ACTIVITIES_KEY = 'activities:v1';
// Changes whenever the seed list changes, so a deploy with new/edited
// cards refreshes their text on next read without touching anyone's votes.
// The v2 prefix marks the seed gaining place/lat/lng pins.
const SEED_STAMP = 'v2|' + SEED.map(s => s.id).join(',');

const isFresh = doc => !!(doc && doc.seedStamp === SEED_STAMP && Array.isArray(doc.items));

// Bring a stored document up to the current seed, keeping votes.
// First run (or the seed changed): rebuild from the seed, keeping the
// votes of any card that was already there. Seed cards someone deleted
// stay deleted (removedIds tombstones), and cards members added
// themselves (ids not in the seed) are carried over untouched.
function normalizeActivities(doc) {
  if (isFresh(doc)) {
    if (!Array.isArray(doc.removedIds)) doc.removedIds = [];
    return doc;
  }
  const prevItems = (doc && doc.items) || [];
  const prev = new Map(prevItems.map(a => [a.id, a]));
  const removedIds = (doc && doc.removedIds) || [];
  const removed = new Set(removedIds);
  const items = SEED.filter(s => !removed.has(s.id))
    .map(s => ({ ...s, votes: (prev.get(s.id) || {}).votes || [] }));
  for (const a of prevItems) if (!SEED.some(s => s.id === a.id)) items.push(a);
  return { seedStamp: SEED_STAMP, items, removedIds, updatedAt: Date.now() };
}

export async function getActivities(env) {
  const { doc } = await readDoc(env, ACTIVITIES_KEY);
  if (isFresh(doc)) return normalizeActivities(doc);
  // Persist the seed merge once, through the versioned write path.
  return transact(env, ACTIVITIES_KEY, async current => {
    const normalized = normalizeActivities(current);
    return isFresh(current) ? { result: normalized } : { doc: normalized, result: normalized };
  });
}

// fn(doc) mutates the freshest (seed-merged) document and returns the
// handler's result; the commit is version-checked (see lib/store.js).
export async function updateActivities(env, fn) {
  return transact(env, ACTIVITIES_KEY, async current => {
    const doc = normalizeActivities(current);
    const result = await fn(doc);
    doc.updatedAt = Date.now();
    return { doc, result };
  });
}

// True for ids that came from the seed (vs. cards members added).
export const isSeedId = id => SEED.some(s => s.id === id);

// Remove one person's activity votes (thorough user deletion,
// users/retire.js). Cards they added stay — the group may have voted on
// them; only their own votes go. Returns votes removed.
export async function scrubUserFromActivities(env, user) {
  const key = user.name.toLowerCase();
  let removed = 0;
  await updateActivities(env, doc => {
    for (const a of doc.items) {
      const before = (a.votes || []).length;
      a.votes = (a.votes || []).filter(v => !(!!user.token && v.token === user.token) && String(v.name || '').toLowerCase() !== key);
      removed += before - a.votes.length;
    }
  });
  return removed;
}
