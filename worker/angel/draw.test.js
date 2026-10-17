// Secret Angel's draw (worker/angel/draw.js): one random circle, Secret Santa
// style. Run: node --test worker/angel/draw.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { drawCycle, removeFromCycle, MIN_DRAW } from './draw.js';

const people = n => Array.from({ length: n }, (_, i) => 'p' + i);
// Everyone gives once and gets once, never to themselves, nobody swaps, and it is one circle.
function checkCircle(pairs, keys) {
  assert.deepEqual(Object.keys(pairs).sort(), keys.slice().sort(), 'everyone in the draw gives a gift');
  assert.deepEqual(Object.values(pairs).sort(), keys.slice().sort(), 'everyone gets exactly one (nobody gets two)');
  for (const [a, b] of Object.entries(pairs)) {
    assert.notEqual(a, b, 'nobody draws themselves');
    assert.notEqual(pairs[b], a, 'nobody simply swaps (a → b and b → a)');
  }
  const seen = new Set();
  for (let k = keys[0]; !seen.has(k); k = pairs[k]) seen.add(k);
  assert.equal(seen.size, keys.length, 'one circle through everyone: a → b → c → … → a');
}

test('every draw is one circle through everyone, for 3 to 15 people', () => {
  for (let n = MIN_DRAW; n <= 15; n++) {
    for (let t = 0; t < 300; t++) checkCircle(drawCycle(people(n), Math.random), people(n));
  }
});

test('fewer than three people: no draw (two could only swap)', () => {
  assert.equal(MIN_DRAW, 3);
  assert.equal(drawCycle([], Math.random), null);
  assert.equal(drawCycle(['a'], Math.random), null);
  assert.equal(drawCycle(['a', 'b'], Math.random), null);
});

test('completely random: with 4 people each of the 6 possible circles comes up about equally often', () => {
  const counts = new Map(), N = 60000;
  for (let t = 0; t < N; t++) {
    const p = drawCycle(people(4), Math.random);
    const key = ['p0', p.p0, p[p.p0], p[p[p.p0]]].join('>'); // the circle, read from p0
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  assert.equal(counts.size, 6, 'all (4 − 1)! = 6 circles show up');
  for (const [circle, c] of counts) assert.ok(Math.abs(c - N / 6) < N / 6 * 0.06, circle + ' came up ' + c + ' times');
});

test('who gives to whom is random too: each person is equally likely to get any other', () => {
  const got = new Map(), N = 50000;
  for (let t = 0; t < N; t++) { const to = drawCycle(people(5), Math.random).p0; got.set(to, (got.get(to) || 0) + 1); }
  assert.deepEqual([...got.keys()].sort(), ['p1', 'p2', 'p3', 'p4']);
  for (const [k, c] of got) assert.ok(Math.abs(c - N / 4) < N / 4 * 0.05, 'p0 → ' + k + ' ' + c + ' times');
});

test('taking someone out keeps one circle: whoever gave to them gives to their person', () => {
  for (let t = 0; t < 200; t++) {
    const keys = people(6), pairs = drawCycle(keys, Math.random);
    const out = keys[t % 6], from = keys.find(k => pairs[k] === out), to = pairs[out];
    const after = removeFromCycle(pairs, out);
    checkCircle(after, keys.filter(k => k !== out));
    assert.equal(after[from], to);
    for (const k of keys) if (k !== out && k !== from) assert.equal(after[k], pairs[k], 'nobody else changes');
    assert.ok(out in pairs, 'the original is untouched');
  }
});

test('taking someone out of a circle of three leaves two: the draw has to go', () => {
  const pairs = drawCycle(['a', 'b', 'c'], Math.random);
  assert.equal(removeFromCycle(pairs, 'b'), null);
  assert.equal(removeFromCycle(pairs, 'zed'), pairs, 'someone not in the draw changes nothing');
});
