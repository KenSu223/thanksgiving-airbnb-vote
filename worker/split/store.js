// Where the group's ledger is stored: the store (worker/store) under
// its old KV key; the store imports the legacy KV value on first read.
// Writes go through updateSplit so concurrent expenses can't overwrite
// each other.
import { TRIPS } from '../config/trips.js';
import { getState } from '../listings/state.js';
import { addUsers, canonName } from '../users/users.js';
import { readDoc, transact } from '../lib/store.js';

// One ledger for the whole group (not per trip); members are the global user list.
const SPLIT_KEY = 'split:v1';

// The pre-splitwise world kept expenses and members per trip. Merging
// them into one ledger only ever runs when no ledger exists yet.
async function buildMergedLedger(env) {
  const expenses = [], names = [];
  for (const key of Object.keys(TRIPS)) {
    const state = await getState(env, TRIPS[key]);
    expenses.push(...state.expenses);
    names.push(...state.members);
  }
  expenses.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const users = await addUsers(env, names.concat(...expenses.map(e => [e.paidBy, ...e.splitAmong])));
  for (const e of expenses) {
    e.paidBy = canonName(users, e.paidBy);
    e.splitAmong = [...new Set(e.splitAmong.map(n => canonName(users, n)))];
  }
  return { expenses, updatedAt: Date.now() };
}

export async function getSplit(env) {
  const { doc } = await readDoc(env, SPLIT_KEY);
  if (doc) return doc;
  // First run: build the merged ledger and persist it once, through
  // the versioned write path (a racing twin returns the winner's doc).
  return transact(env, SPLIT_KEY, async current => {
    if (current) return { result: current };
    const split = await buildMergedLedger(env);
    return { doc: split, result: split };
  });
}

// fn(split) mutates the freshest ledger and returns the handler's
// result; the commit is version-checked (see lib/store.js).
export async function updateSplit(env, fn) {
  return transact(env, SPLIT_KEY, async current => {
    const split = current || await buildMergedLedger(env);
    const result = await fn(split);
    split.updatedAt = Date.now();
    return { doc: split, result };
  });
}

// Remove one person from the ledger entirely (thorough user deletion,
// users/retire.js): expenses they paid are deleted, and they are taken
// out of everyone else's split lists (an expense left with nobody to
// split it is deleted too). Balances are computed from the expenses on
// read, so nothing else needs fixing. Returns expenses deleted.
export async function scrubUserFromSplit(env, user) {
  const key = user.name.toLowerCase();
  let removed = 0;
  await updateSplit(env, split => {
    const before = split.expenses.length;
    split.expenses = split.expenses.filter(e => {
      if (String(e.paidBy || '').toLowerCase() === key) return false;
      e.splitAmong = (e.splitAmong || []).filter(n => String(n).toLowerCase() !== key);
      return e.splitAmong.length > 0;
    });
    removed = before - split.expenses.length;
  });
  return removed;
}
