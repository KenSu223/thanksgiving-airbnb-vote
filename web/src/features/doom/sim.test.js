import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, step, toughness, spanOf, bossHp, firepower, PERKS, PERK, ZOMBIES, WEAPONS, SQUAD_Y, ROAD, MAX_TICKS, MAX_SQUAD, START, STAGES, BOSS_SECONDS, HZ, levelOf, stageOf, isBossWave } from './sim.js';
import { badEvents, replay } from './verify.js';

// A test player (tests only): takes the better gate of each pair, otherwise
// stands under the nearest zombie (under the 尸王 when there is one); takes
// upgrades in a fixed order.
const SMALL = ['dmg', 'rate', 'men', 'crit', 'shield'];
const BIG = ['w:sniper', 'wup', 'w:rocket', 'w:laser', 'mortar', 'pierce', 'spread', 'w:shotgun'];
function player(every = 8) {
  return g => {
    if (g.phase === 'pick') { const o = g.offerSize === 'big' ? BIG : SMALL; return [[g.tick, 1, g.offers.map(k => (o.indexOf(k) + 1) || 99).reduce((bi, p, i, a) => (p < a[bi] ? i : bi), 0)]]; }
    if (g.tick % every) return [];
    const sq = g.squad;
    const row = g.gates.filter(r => !r.passed && r.y > SQUAD_Y - 320 && r.y < SQUAD_Y).sort((a, b) => b.y - a.y)[0];
    let x = 180;
    if (row) {
      const worth = gt => (gt.kind === 'add' ? gt.v : gt.kind === 'mul' ? sq.count * (gt.v - 1) : sq.count * gt.v / 200);
      const best = row.gates.reduce((a, b) => (worth(b) > worth(a) ? b : a));
      x = (best.x0 + best.x1) / 2;
    } else {
      const near = g.zombies.find(z => z.kind === 'boss') || g.zombies.filter(z => z.y > 0).sort((a, b) => b.y - a.y)[0];
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
// skip ahead: a squad that can't lose, to look at later waves
const godMode = g => { g.squad.count = MAX_SQUAD; g.stats.dmg = 1e6; };
const clearWave = g => { godMode(g); while (!g.over && g.phase === 'play') step(g, []); };

test('a run starts on level 1, 小关 1, with five soldiers and a pair of gates coming', () => {
  const g = newGame(7);
  assert.equal(g.wave, 1); assert.equal(levelOf(1), 1); assert.equal(stageOf(1), 1);
  assert.equal(g.squad.count, START.count);
  assert.equal(g.gates.length, 1);
  assert.equal(g.gates[0].gates.length, 2);
  assert.ok(g.queue.length >= 8 && !g.queue.some(q => q.kind === 'boss'));
});

test('levels: four 小关 then the 大关 (the 尸王), each tougher', () => {
  assert.deepEqual([1, 4, 5, 6, 10].map(levelOf), [1, 1, 1, 2, 2]);
  assert.deepEqual([1, 4, 5, 6, 10].map(stageOf), [1, 4, 5, 1, 5]);
  assert.ok(isBossWave(5) && isBossWave(10) && !isBossWave(4) && STAGES === 5);
  assert.ok(toughness(10) > toughness(5) && toughness(1) === 1);
  assert.ok(bossHp(3) > 2 * bossHp(2) && bossHp(2) > 2 * bossHp(1));
  const g = newGame(3), bosses = [];
  for (let w = 1; w <= 10 && !g.over; w++) {
    bosses.push(g.queue.filter(q => q.kind === 'boss').length);
    clearWave(g);
    if (g.phase === 'pick') step(g, [[g.tick, 1, 0]]);
  }
  assert.deepEqual(bosses, [0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
});

test('the 尸王 is a DPS check: it reaches the line in exactly 20 s and wipes the squad wherever it stands', () => {
  const g = newGame(5);
  for (let w = 1; w < 5; w++) { clearWave(g); step(g, [[g.tick, 1, 0]]); }
  assert.equal(stageOf(g.wave), STAGES);
  g.squad.count = 50; g.stats.dmg = 1e-9; g.stats.mortar = 0; // can't hurt it
  const edge = ROAD[0] + 16;                                    // as far from the middle as can be
  let shown = null;
  while (!g.over) { step(g, [[g.tick, 0, edge]]); if (shown === null && g.zombies.some(z => z.kind === 'boss')) shown = g.tick; }
  assert.equal(g.end, 'dead');
  assert.ok(Math.abs((g.tick - shown) - BOSS_SECONDS * HZ) <= 2, 'reached the line after ' + (g.tick - shown) + ' ticks');
});

test('beating the 尸王 gives a big pick with a weapon in it; a 小关 gives a small one', () => {
  const g = newGame(8);
  clearWave(g);
  assert.equal(g.offerSize, 'small');
  assert.ok(g.offers.every(k => PERK[k].size === 'small'));
  step(g, [[g.tick, 1, 0]]);
  for (let w = 2; w < 5; w++) { clearWave(g); step(g, [[g.tick, 1, 0]]); }
  clearWave(g);
  assert.equal(g.offerSize, 'big');
  assert.equal(new Set(g.offers).size, 3);
  assert.ok(g.offers.every(k => PERK[k].size === 'big') && g.offers.some(k => PERK[k].weapon), JSON.stringify(g.offers));
  const w = g.offers.findIndex(k => PERK[k].weapon), weapon = PERK[g.offers[w]].weapon;
  step(g, [[g.tick, 1, w]]);
  assert.equal(g.stats.weapon, weapon);
  assert.equal(levelOf(g.wave), 2);
});

test('every weapon carries its firepower; the sniper hits one target hardest, rockets and lasers hit crowds', () => {
  const dealt = (weapon, crowd) => {
    const g = newGame(2); g.stats.weapon = weapon; g.squad.count = 25; g.queue = []; g.gates = [];
    g.zombies = Array.from({ length: crowd ? 9 : 1 }, (_, i) => ({ id: i + 1, kind: 'walker', x: 180 + (crowd ? (i % 3 - 1) * 16 : 0), y: 300 + (crowd ? Math.floor(i / 3) * 16 : 0), r: 10, hp: 1e9, max: 1e9, speed: 0 }));
    for (let t = 0; t < 600; t++) step(g, []);
    return g.dealt;
  };
  const one = Object.fromEntries(Object.keys(WEAPONS).map(w => [w, dealt(w, false)]));
  const many = Object.fromEntries(Object.keys(WEAPONS).map(w => [w, dealt(w, true)]));
  assert.ok(one.sniper > one.rifle && one.sniper > one.rocket && one.sniper > one.laser, JSON.stringify(one));
  assert.ok(many.rocket > 2 * one.rocket && many.laser > 2 * one.laser, JSON.stringify({ one, many }));
});

test('the same seed and inputs play out the same way, and the replay agrees', () => {
  for (const seed of [1, 42, 4294967295]) {
    const a = play(seed, player(), { until: g => g.wave > 7 }), b = play(seed, player(), { until: g => g.wave > 7 });
    assert.deepEqual(a.events, b.events);
    assert.equal(a.g.score, b.g.score);
    const events = [...a.events, [a.g.tick, 2]];
    step(a.g, [[a.g.tick, 2]]);
    assert.deepEqual(replay(seed, events), { score: a.g.score, kills: a.g.kills, wave: a.g.wave, end: a.g.end, ticks: a.g.tick });
  }
});

test('a careful player gets past the first 尸王 and further; standing still does not', () => {
  const levels = [], idle = [];
  for (let seed = 1; seed <= 10; seed++) {
    levels.push(levelOf(play(seed * 7919, player()).g.wave));
    idle.push(levelOf(play(seed * 7919, g => (g.phase === 'pick' ? [[g.tick, 1, 0]] : [])).g.wave));
  }
  assert.ok(Math.min(...levels) >= 2, 'careful player levels ' + levels);
  assert.ok(idle.reduce((a, b) => a + b) < levels.reduce((a, b) => a + b), 'idle ' + idle + ' vs ' + levels);
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
  g.gates = [{ y: SQUAD_Y - 1, passed: false, gates: [{ x0: ROAD[0], x1: 180, kind: 'rate', v: 10 }, { x0: 180, x1: ROAD[1], kind: 'add', v: 1 }] }];
  g.squad.x = g.squad.tx = 100;
  step(g, []);
  assert.equal(g.stats.rate, 1.1);
});

test('×2 gates only come while the squad is small', () => {
  let seen = 0;
  for (let seed = 1; seed < 40; seed++) {
    const g = newGame(seed), rows = new Set(g.gates);
    for (let w = 1; w <= 6 && !g.over; w++) {
      godMode(g);
      while (!g.over && g.phase === 'play') {
        step(g, []);
        for (const row of g.gates) if (!rows.has(row)) { rows.add(row); seen++; assert.ok(row.gates.every(gt => gt.kind !== 'mul'), JSON.stringify(row)); }
      }
      if (g.phase === 'pick') step(g, [[g.tick, 1, 0]]);
    }
  }
  assert.ok(seen > 100);
});

test('shooting a red gate counts it up until it turns good', () => {
  const g = newGame(5);
  g.zombies = [{ id: 1, kind: 'walker', x: 300, y: -500, r: 10, hp: 1e9, max: 1e9, speed: 0.1 }]; g.queue = [];
  g.gates = [{ y: 200, passed: false, gates: [{ x0: ROAD[0], x1: 180, kind: 'add', v: -4, shoot: true }, { x0: 180, x1: ROAD[1], kind: 'add', v: 3 }] }];
  g.squad.x = g.squad.tx = 100;
  for (let t = 0; t < 200 && g.gates[0].gates[0].v <= 0; t++) { g.gates[0].y = 200; step(g, []); }
  assert.ok(g.gates[0].gates[0].v > 0 && !g.gates[0].gates[0].shoot, JSON.stringify(g.gates[0].gates[0]));
});

test('a zombie that reaches the squad bites soldiers off (more each level); a shield stops it', () => {
  const at = kind => ({ id: 1, kind, x: 180, y: SQUAD_Y - ZOMBIES[kind].r - 7, r: ZOMBIES[kind].r, hp: 1e9, max: 1e9, speed: 1 });
  let g = newGame(9); g.squad.x = g.squad.tx = 180; g.squad.count = 20; g.zombies = [at('walker')];
  step(g, []);
  assert.equal(g.squad.count, 19);
  g = newGame(9); g.wave = 6; g.squad.x = g.squad.tx = 180; g.squad.count = 20; g.zombies = [at('tank')];
  step(g, []);
  assert.equal(g.squad.count, 20 - ZOMBIES.tank.bite * 2); // level 2: twice the bite
  g = newGame(9); g.squad.x = g.squad.tx = 180; g.squad.count = 20; g.squad.shield = 1; g.zombies = [at('tank')];
  step(g, []);
  assert.equal(g.squad.count, 20); assert.equal(g.squad.shield, 0);
});

test('more soldiers shoot harder, but not in step (square root)', () => {
  assert.ok(spanOf(100) > spanOf(4) && spanOf(0) === 0);
  const shot = count => { const g = newGame(2); g.squad.count = count; g.squad.cd = 0; step(g, []); return g.bullets.reduce((t, b) => t + (b.crit ? b.dmg / 2 : b.dmg), 0); };
  const a = shot(4), b = shot(64);
  assert.ok(Math.abs(b / a - 4) < 1e-9, a + ' ' + b);
  const g = newGame(2); g.squad.count = 64;
  assert.ok(Math.abs(firepower(g) - 3 * 8 * 5) < 1e-9);
});

test('the upgrade lists: small ones, and big ones with four weapons', () => {
  const small = PERKS.filter(p => p.size === 'small'), big = PERKS.filter(p => p.size === 'big');
  assert.ok(small.length >= 5 && big.length >= 6 && big.filter(p => p.weapon).length === 4);
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
