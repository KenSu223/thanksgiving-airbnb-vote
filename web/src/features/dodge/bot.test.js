import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, step, HZ } from './sim.js';
import { planBot } from './bot.js';

// Drive whole runs with nothing but the bot's decisions, fed in as the
// game's own input events. It doesn't need to be immortal — outlasting
// the whole friend group is the bar, and that's a minute-plus in a
// game whose waves keep scaling.
function runWithBot(seed, maxTicks) {
  const g = newGame(seed);
  while (!g.over && g.tick < maxTicks) {
    const c = planBot(g);
    const ev = [];
    if (c.flash !== undefined) ev.push([g.tick, 2, c.flash]);
    else if (c.move) ev.push([g.tick, 0, c.move[0], c.move[1]]);
    step(g, ev);
  }
  return g.tick;
}

test('the bot survives at least a minute on several seeds', () => {
  for (const seed of [7, 42, 1234]) {
    const ticks = runWithBot(seed, 36000);
    assert.ok(ticks >= 60 * HZ, `seed ${seed}: died at ${(ticks / HZ).toFixed(1)}s (${ticks} ticks)`);
  }
});
