// node --test web/src/features/g2048/logic.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { move, canMove, spawn, fresh, maxTile } from './logic.js';

const g = rows => rows.flat();

test('slides and merges once per tile', () => {
  const r = move(g([[2, 2, 4, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), 'left');
  assert.deepEqual(r.grid.slice(0, 4), [4, 4, 0, 0]);
  assert.equal(r.gained, 4);
  assert.equal(r.moved, true);
});
test('2 2 2 2 -> 4 4, and the far pair merges toward the wall first', () => {
  assert.deepEqual(move(g([[2, 2, 2, 2], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), 'left').grid.slice(0, 4), [4, 4, 0, 0]);
  assert.deepEqual(move(g([[2, 2, 2, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), 'right').grid.slice(0, 4), [0, 0, 2, 4]);
});
test('up and down work on columns', () => {
  const r = move(g([[2, 0, 0, 0], [2, 0, 0, 0], [4, 0, 0, 0], [4, 0, 0, 0]]), 'up');
  assert.deepEqual([r.grid[0], r.grid[4], r.grid[8], r.grid[12]], [4, 8, 0, 0]);
  assert.equal(r.gained, 12);
  const d = move(g([[2, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), 'down');
  assert.equal(d.grid[12], 2);
});
test('a move that changes nothing is not a move', () => {
  const r = move(g([[2, 4, 8, 16], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), 'left');
  assert.equal(r.moved, false);
});
test('steps say where each tile went and which ones merged', () => {
  const r = move(g([[0, 2, 0, 2], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), 'left');
  assert.deepEqual(r.steps, [{ from: 1, to: 0, merge: false }, { from: 3, to: 0, merge: true }]);
});
test('game over only when full and nothing touches its twin', () => {
  assert.equal(canMove(g([[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]])), false);
  assert.equal(canMove(g([[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 4]])), true);
  assert.equal(canMove(g([[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 0]])), true);
});
test('spawn fills an empty cell with a 2 or a 4; a new game has two tiles', () => {
  let i = 0; const seq = [0.5, 0.95];
  const s = spawn(new Array(16).fill(0), () => seq[i++ % 2]);
  assert.equal(s.v, 4); assert.equal(s.grid[s.at], 4);
  const f = fresh(Math.random);
  assert.equal(f.filter(Boolean).length, 2);
  assert.ok(maxTile(f) <= 4);
});
