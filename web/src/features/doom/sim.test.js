import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, step, toughness, spanOf, PERKS, ZOMBIES, SQUAD_Y, ROAD, MAX_TICKS, MAX_SQUAD, START } from './sim.js';
import { badEvents, replay } from './verify.js';

// A test player (tests only): takes the better gate of each pair, otherwise
// stands under the zombie nearest the squad; takes upgrades in a fixed order.
const ORDER = ['dmg', 'rate', 'men', 'pierce', 'spread', 'mortar', 'crit', 'shield'];
function player(every = 8) {
  return g => {
    if (g.phase === 'pick') return [[g.tick, 1, g.offers.map(k => ORDER.indexOf(k)).reduce((bi, p, i, a) => (p < a[bi] ? i : bi), 0)]];
    if (g.tick % every) return [];
    const sq = g.squad;
    const row = g.gates.filter(r => !r.passed && r.y > SQUAD_Y - 320 && r.y < SQUAD_Y).sort((a, b) => b.y - a.y)[0];
    let x = 180;
    if (row) {
      const worth = gt => (gt.kind === 'add' ? gt.v : gt.kind === 'mul' ? sq.count * (gt.v - 1) : sq.count * gt.v / 200);
      const best = row.gates.reduce((a, b) => (worth(b) > worth(a) ? b : a));
      x = (best.x0 + best.x1) / 2;
    } else {
      const near = g.zombies.filter(z => z.y > 0).sort((a, b) => b.y - a.y)[0];
      if (near) x = near.x;
    }
    return [[g.tick, 0, Math.round(Math.max(ROAD[0] + 16, Math.min(ROAD[1] - 16, x)))]];
  };
}
function play(seed, pick, { until = () => false } = {}) {
  const g = newGame(seed), events = [];
  while (!g.over && !until(g)) { const ev = pick(g); events.push(...ev); step(g, ev); }
  return { g, events };
}

test('a run starts on wave 1 with five soldiers and a pair of gates coming', () => {
  const g = newGame(7);
  assert.equal(g.wave, 1);
  assert.equal(g.squad.count, START.count);
  assert.equal(g.gates.length, 1);
  assert.equal(g.gates[0].gates.length, 2);
  assert.ok(g.queue.length >= 8);
});

test('zombies get tougher every wave; a boss every 5th', () => {
  assert.ok(toughness(10) > toughness(5) && toughness(5) > toughness(1) && toughness(1) === 1);
  const g = newGame(3);
  const kinds = [];
  for (let w = 1; w <= 10 && !g.over; w++) {
    kinds.push(g.queue.some(q => q.kind === 'boss'));
    g.squad.count = MAX_SQUAD; g.stats.dmg = 50; // (so it lives through them)
    while (!g.over && g.phase === 'play') step(g, []);
    if (g.phase === 'pick') step(g, [[g.tick, 1, 0]]);
  }
  assert.deepEqual(kinds.slice(0, 10).map((b, i) => [i + 1, b]).filter(([, b]) => b).map(([w]) => w), [5, 10]);
});

test('the same seed and inputs play out the same way, and the replay agrees', () => {
  for (const seed of [1, 42, 4294967295]) {
    const a = play(seed, player(), { until: g => g.wave > 6 }), b = play(seed, player(), { until: g => g.wave > 6 });
    assert.deepEqual(a.events, b.events);
    assert.equal(a.g.score, b.g.score);
    const events = [...a.events, [a.g.tick, 2]];
    step(a.g, [[a.g.tick, 2]]);
    assert.deepEqual(replay(seed, events), { score: a.g.score, kills: a.g.kills, wave: a.g.wave, end: a.g.end, ticks: a.g.tick });
  }
});

test('a careful player gets well into the run; standing still does not', () => {
  const waves = [];
  for (let seed = 1; seed <= 10; seed++) waves.push(play(seed * 7919, player()).g.wave);
  const sorted = [...waves].sort((a, b) => a - b);
  assert.ok(sorted[5] >= 10, 'careful player waves ' + waves);
  const idle = [];
  for (let seed = 1; seed <= 10; seed++) idle.push(play(seed * 7919, g => (g.phase === 'pick' ? [[g.tick, 1, 0]] : [])).g.wave);
  assert.ok(Math.max(...idle) < Math.min(...waves) + 6 && idle.reduce((a, b) => a + b) < waves.reduce((a, b) => a + b), 'idle ' + idle + ' vs ' + waves);
});

test('walking through a gate does what it says', () => {
  for (const [kind, v, before, after] of [['add', 5, 5, 10], ['add', -3, 5, 2], ['mul', 2, 6, 12]]) {
    const g = newGame(11);
    g.squad.count = before; g.squad.x = g.squad.tx = 100;
    g.gates = [{ y: SQUAD_Y - 1, passed: false, gates: [{ x0: ROAD[0], x1: 180, kind, v }, { x0: 180, x1: ROAD[1], kind: 'add', v: 99 }] }];
    step(g, []);
    assert.equal(g.squad.count, after, kind + v);
  }
  const g = newGame(11);
  g.gates = [{ y: SQUAD_Y - 1, passed: false, gates: [{ x0: ROAD[0], x1: 180, kind: 'rate', v: 15 }, { x0: 180, x1: ROAD[1], kind: 'add', v: 1 }] }];
  g.squad.x = g.squad.tx = 100;
  step(g, []);
  assert.equal(g.stats.rate, 1.15);
});

test('shooting a red gate counts it up until it turns good', () => {
  const g = newGame(5);
  // one zombie far up the road keeps the wave going (an empty wave would end at once)
  g.zombies = [{ id: 1, kind: 'walker', x: 300, y: -500, r: 10, hp: 1e9, max: 1e9, speed: 0.1 }]; g.queue = [];
  g.gates = [{ y: 200, passed: false, gates: [{ x0: ROAD[0], x1: 180, kind: 'add', v: -4, shoot: true }, { x0: 180, x1: ROAD[1], kind: 'add', v: 3 }] }];
  g.squad.x = g.squad.tx = 100;
  for (let t = 0; t < 200 && g.gates[0].gates[0].v <= 0; t++) { g.gates[0].y = 200; step(g, []); }
  assert.ok(g.gates[0].gates[0].v > 0 && !g.gates[0].gates[0].shoot, JSON.stringify(g.gates[0].gates[0]));
});

test('a zombie that reaches the squad bites soldiers off; a shield stops it; a boss takes everyone', () => {
  const at = kind => ({ id: 1, kind, x: 180, y: SQUAD_Y - ZOMBIES[kind].r - 7, r: ZOMBIES[kind].r, hp: 1e9, max: 1e9, speed: 1 });
  let g = newGame(9); g.squad.x = g.squad.tx = 180; g.squad.count = 20; g.zombies = [at('walker')];
  step(g, []);
  assert.equal(g.squad.count, 19);
  g = newGame(9); g.squad.x = g.squad.tx = 180; g.squad.count = 20; g.squad.shield = 1; g.zombies = [at('tank')];
  step(g, []);
  assert.equal(g.squad.count, 20); assert.equal(g.squad.shield, 0);
  g = newGame(9); g.squad.x = g.squad.tx = 180; g.squad.count = 50; g.squad.shield = 5; g.zombies = [at('boss')];
  step(g, []);
  assert.ok(g.over && g.end === 'dead');
});

test('after a wave: three different upgrades to pick from; picking one starts the next wave', () => {
  const { g } = play(21, player(), { until: g => g.phase === 'pick' });
  assert.equal(g.phase, 'pick');
  assert.equal(new Set(g.offers).size, 3);
  assert.ok(g.offers.every(k => PERKS.some(p => p.key === k)));
  const key = g.offers[1], wave = g.wave;
  step(g, [[g.tick, 1, 1]]);
  assert.equal(g.picks[key], 1);
  assert.equal(g.wave, wave + 1);
  assert.equal(g.phase, 'play');
});

test('more soldiers shoot harder, but not in step (square root)', () => {
  assert.ok(spanOf(100) > spanOf(4) && spanOf(0) === 0);
  const shot = count => { const g = newGame(2); g.squad.count = count; g.squad.cd = 0; step(g, []); return g.bullets.reduce((t, b) => t + (b.crit ? b.dmg / 2 : b.dmg), 0); };
  const a = shot(4), b = shot(64);
  assert.ok(Math.abs(b / a - 4) < 1e-9, a + ' ' + b);
});

test('recorded inputs are checked for shape', () => {
  assert.equal(badEvents([[0, 0, 100], [5, 1, 2], [9, 2]]), null);
  assert.equal(badEvents('x'), 'events');
  assert.equal(badEvents([[3, 0, 10], [2, 0, 10]]), 'tick');
  assert.equal(badEvents([[0, 0, 999]]), 'move');
  assert.equal(badEvents([[0, 0, 10.5]]), 'move');
  assert.equal(badEvents([[0, 1, 3]]), 'pick');
  assert.equal(badEvents([[0, 2, 1]]), 'event');
  assert.equal(badEvents([[0, 7]]), 'type');
  assert.equal(badEvents([[MAX_TICKS + 1, 2]]), 'tick');
});

test('a replay stopped at the upgrade pick runs to the end of the clock', () => {
  const { events } = play(4, player(), { until: g => g.phase === 'pick' });
  const r = replay(4, events);
  assert.equal(r.end, 'time');
  assert.equal(r.ticks, MAX_TICKS);
});
