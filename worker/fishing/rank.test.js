import test from 'node:test';
import assert from 'node:assert/strict';
import { isOld, byRank, takesOver, nextRecord } from './rank.js';
import { topFor } from '../lib/board.js';

// The 小小钓鱼 board across game versions (rank.js): bests from the current
// version first, the older ones after; a current-version run takes over an
// older best even with fewer coins, and the older best is kept, not destroyed.
const V = 4;
const rec = (name, money, cleared, at, v) => ({ name, money, level: cleared + 1, cleared, runs: 3, at, kinds: ['minnow'], ...(v === undefined ? {} : { v }) });
const ranked = recs => recs.map(r => [r.name.toLowerCase(), r]).sort(byRank(V));

test('a best with no version on it, or another version, is old', () => {
  assert.equal(isOld(rec('a', 100, 1, 1), V), true);       // stored before versions were kept
  assert.equal(isOld(rec('a', 100, 1, 1, 3), V), true);
  assert.equal(isOld(rec('a', 100, 1, 1, V), V), false);
});

test('this version first, then older ones; within each: coins, then levels, then who was first', () => {
  const order = ranked([
    rec('OldRich', 16413, 9, 10),           // made on the easier game
    rec('OldRicher', 20000, 12, 30, 3),
    rec('NewSmall', 900, 1, 50, V),
    rec('NewBig', 5200, 4, 60, V),
    rec('NewTieFar', 2000, 3, 80, V),
    rec('NewTieNear', 2000, 2, 70, V),
    rec('NewTieLate', 2000, 2, 90, V),
  ]).map(([, r]) => r.name);
  assert.deepEqual(order, ['NewBig', 'NewTieFar', 'NewTieNear', 'NewTieLate', 'NewSmall', 'OldRicher', 'OldRich']);
});

test('the board stays the top 3 plus your own place; old rows are only on it when fewer than 3 have played this version', () => {
  const rows = recs => ranked(recs).map(([k, r]) => [k, { name: r.name, money: r.money, ...(isOld(r, V) ? { old: true } : {}) }]);
  const mixed = rows([rec('Nan', 16413, 9, 1), rec('Gu', 7510, 6, 2, 3), rec('Ann', 1200, 2, 3, V)]);
  assert.deepEqual(topFor(mixed, 'gu'), { board: [{ name: 'Ann', money: 1200 }, { name: 'Nan', money: 16413, old: true }, { name: 'Gu', money: 7510, old: true }], boardMe: null });
  const full = rows([rec('Nan', 16413, 9, 1), rec('A', 300, 0, 2, V), rec('B', 500, 1, 3, V), rec('C', 400, 1, 4, V)]);
  const forNan = topFor(full, 'nan');
  assert.deepEqual(forNan.board.map(r => r.name), ['B', 'C', 'A']);
  assert.deepEqual(forNan.boardMe, { name: 'Nan', money: 16413, old: true, rank: 4 }); // still there, below, with its tag
});

test('a run on this version takes over an older best even with fewer coins, and the older best is kept in the record', () => {
  const prev = { ...rec('Nan', 16413, 9, 1000), kinds: ['minnow', 'shark'] };
  const run = { money: 1850, level: 3, cleared: 2 };
  assert.equal(takesOver(prev, run, V), true);
  const next = nextRecord(prev, run, { name: 'Nan', now: 2000, version: V, kinds: ['minnow', 'shark', 'mine'] });
  assert.deepEqual(next, { name: 'Nan', money: 1850, level: 3, cleared: 2, v: V, runs: 4, at: 2000, kinds: ['minnow', 'shark', 'mine'],
    old: { money: 16413, level: 10, cleared: 9, at: 1000, v: 0 } });
  // from then on it's an ordinary best: only a better run replaces it, and the old one stays put
  assert.equal(takesOver(next, { money: 1800, level: 3, cleared: 2 }, V), false);
  const same = nextRecord(next, { money: 1800, level: 3, cleared: 2 }, { name: 'Nan', now: 3000, version: V, kinds: next.kinds });
  assert.deepEqual(same, { ...next, runs: 5 });
  const better = nextRecord(same, { money: 2600, level: 4, cleared: 3 }, { name: 'Nan', now: 4000, version: V, kinds: next.kinds });
  assert.equal(better.money, 2600);
  assert.equal(better.at, 4000);
  assert.deepEqual(better.old, { money: 16413, level: 10, cleared: 9, at: 1000, v: 0 });
});

test('a run that earned nothing does not take over an older best (but counts as a run, and its catch as caught)', () => {
  const prev = rec('Gu', 7510, 6, 1000, 3);
  assert.equal(takesOver(prev, { money: 0, level: 1, cleared: 0 }, V), false);
  const next = nextRecord(prev, { money: 0, level: 1, cleared: 0 }, { name: 'Gu', now: 2000, version: V, kinds: ['minnow', 'can'] });
  assert.deepEqual(next, { ...prev, runs: 4, kinds: ['minnow', 'can'] });
  assert.equal(isOld(next, V), true);
});

test('first run ever, and bests within one version', () => {
  assert.equal(takesOver(undefined, { money: 0, level: 1, cleared: 0 }, V), true);
  assert.deepEqual(nextRecord(undefined, { money: 0, level: 1, cleared: 0 }, { name: 'New', now: 5, version: V, kinds: [] }),
    { name: 'New', money: 0, level: 1, cleared: 0, v: V, runs: 1, at: 5, kinds: [] });
  const prev = rec('A', 1000, 2, 1, V);
  assert.equal(takesOver(prev, { money: 999, cleared: 5 }, V), false);
  assert.equal(takesOver(prev, { money: 1000, cleared: 2 }, V), false);
  assert.equal(takesOver(prev, { money: 1000, cleared: 3 }, V), true);
  assert.equal(takesOver(prev, { money: 1001, cleared: 0 }, V), true);
});
