// node --test web/src/features/g2048/bot.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { fresh, spawn, move, canMove, maxTile } from './logic.js';
import { plan2048, evaluate } from './bot.js';

const g = rows => rows.flat();
const DEAD = g([[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]]);

test('a dead board has no move to give', () => {
  assert.equal(plan2048(DEAD), null);
});

test('the pick is always a move that actually slides something', () => {
  const grid = g([[2, 2, 0, 0], [0, 4, 0, 0], [0, 0, 0, 0], [2, 0, 0, 8]]);
  const dir = plan2048(grid);
  assert.ok(dir && move(grid, dir).moved, 'picked ' + dir);
});

test('planning does not touch the board it was given', () => {
  const grid = g([[2, 2, 4, 0], [16, 0, 4, 0], [2, 0, 0, 0], [0, 0, 8, 8]]);
  const before = grid.slice();
  plan2048(grid);
  assert.deepEqual(grid, before);
});

test('an orderly board scores above the same tiles shuffled', () => {
  const neat = g([[1024, 512, 256, 128], [2, 4, 8, 64], [0, 0, 0, 32], [0, 0, 0, 16]]);
  const messy = g([[16, 0, 0, 32], [0, 0, 0, 2], [64, 8, 4, 128], [1024, 512, 256, 0]]);
  assert.ok(evaluate(neat) > evaluate(messy));
});

// Whole games driven by nothing but the bot's picks, with the spawns a
// seeded server would deal. It doesn't need to reach 2048 every time —
// outplaying the friend group is the bar. Depth 2 keeps the test at a
// couple of seconds; the page uses the default (deeper when crowded).
function runWithBot(seed, maxMoves) {
  let s = seed;
  const rand = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  let grid = fresh(rand), score = 0, moves = 0;
  while (canMove(grid) && moves < maxMoves) {
    const dir = plan2048(grid, 2);
    assert.ok(dir, 'bot gave up on a live board');
    const r = move(grid, dir);
    assert.ok(r.moved, 'bot picked a non-move: ' + dir);
    score += r.gained; grid = spawn(r.grid, rand).grid; moves++;
  }
  return { grid, score, moves };
}

test('the bot reaches at least 1024 on several seeds', () => {
  for (const seed of [7, 42]) {
    const { grid, score } = runWithBot(seed, 4000);
    assert.ok(maxTile(grid) >= 1024, `seed ${seed}: only reached ${maxTile(grid)} (score ${score})`);
  }
});
