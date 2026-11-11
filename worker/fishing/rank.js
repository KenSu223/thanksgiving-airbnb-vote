// How 小小钓鱼's bests are ordered and replaced, as plain functions (board.js
// keeps the storage; rank.test.js checks these).
//
// The game has been made harder more than once (sim.js SIM_VERSION), and a
// best from an easier version would sit on top for ever. So every best
// remembers the version it was made on (`v`; records from before that was
// stored have none, which counts as old):
//   - bests from the current version come first, then the older ones; within
//     each, more coins, then further, then whoever got there first;
//   - a run on the current version that earned something takes the place of an
//     older-version best even with fewer coins, and the older best is kept in
//     the record (`old`), never thrown away;
//   - rows from an older version are flagged (`old: true`) so the page can say so.

// Is this best from another version of the game than `version`?
export const isOld = (rec, version) => (rec?.v || 0) !== version;

// Sort order for [key, record] pairs, best first.
export const byRank = version => ([, a], [, b]) =>
  (isOld(a, version) ? 1 : 0) - (isOld(b, version) ? 1 : 0) || b.money - a.money || b.cleared - a.cleared || a.at - b.at;

// Does this run (the server's replay of it) become the person's best?
export function takesOver(prev, run, version) {
  if (!prev) return true;
  if (isOld(prev, version)) return run.money > 0;
  return run.money > prev.money || (run.money === prev.money && run.cleared > prev.cleared);
}

// The record to store after a run: a new best (carrying the older-version best
// along in `old`), or the same best with one more run. `kinds` is the 图鉴
// after this run.
export function nextRecord(prev, run, { name, now, version, kinds }) {
  const runs = (prev?.runs || 0) + 1;
  if (!takesOver(prev, run, version)) return { ...prev, name, runs, kinds };
  const rec = { name, money: run.money, level: run.level, cleared: run.cleared, v: version, runs, at: now, kinds };
  const old = prev && isOld(prev, version)
    ? { money: prev.money, level: prev.level, cleared: prev.cleared, at: prev.at, v: prev.v || 0 }
    : prev?.old;
  return old ? { ...rec, old } : rec;
}
