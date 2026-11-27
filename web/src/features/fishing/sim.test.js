import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, step, quota, quick, tipOf, valueOf, mouthOf, makeLevel, KINDS, KIND_KEYS, STOCK, HZ, LEVEL_TICKS, MAX_TICKS, PULL, ROPE0, SWING, W, H, WATER, SEABED, PIVOT,
  BLAST, STING, DAZE, SPOOK, LUNGE } from './sim.js';
import { badEvents, replay } from './verify.js';

// What a cast right now would hook, found by trying it on a copy of the game
// (tests only: the fish move, so a straight line isn't enough). Going out, and
// unless `outOnly`, coming back empty too.
const busy = (h, outOnly) => h.state === 'out' || (!outOnly && h.state === 'back' && !h.item);
function castNow(g, outOnly = false) {
  const c = { ...g, rand: () => 0, happened: [], items: g.items.map(it => ({ ...it })), hook: { ...g.hook }, boost: { ...g.boost }, caught: { ...g.caught } };
  step(c, [[c.tick, 0]]);
  while (busy(c.hook, outOnly) && c.phase === 'play' && !c.over) step(c, []);
  return c.hook.item;
}
// A test player (tests only): casts when the cast would hook something worth
// having, cuts junk loose while it has scissors, buys scissors it can spare,
// and goes on. When a whole swing goes by with nothing good in reach, it
// takes whatever it can get.
function player({ minValue = 40 } = {}) {
  let waited = 0;
  return g => {
    if (g.phase === 'shop') {
      const i = g.shop.findIndex(o => o.key === 'scissors' && !o.bought && o.price <= 40);
      return i >= 0 ? [[g.tick, 2, i]] : [[g.tick, 3]];
    }
    if (g.money >= g.target && g.hook.state === 'swing' && g.items.every(it => valueOf(g, it) < 100)) return [[g.tick, 3]];
    if (g.hook.state === 'swing') {
      waited++;
      if (g.tick % 2) return [];
      const it = castNow(g);
      if (it && (valueOf(g, it) >= minValue || it.kind === 'chest' || waited > SWING.period)) { waited = 0; return [[g.tick, 0]]; }
    }
    if (g.hook.state === 'back' && KINDS[g.hook.item?.kind]?.group === 'junk' && g.scissors > 0) return [[g.tick, 1]];
    return [];
  };
}
// Play a run the way the page does, recording every input.
function play(seed, pick, { max = MAX_TICKS, until = () => false } = {}) {
  const g = newGame(seed), events = [];
  while (!g.over && g.tick < max && !until(g)) { const ev = pick(g); events.push(...ev); step(g, ev); }
  return { g, events };
}
const toShop = seed => play(seed, player(), { until: g => g.phase === 'shop' });
// A game with just these things in the water (tests only), the line hanging straight down.
function scene(items, hook = {}) {
  const g = newGame(1);
  g.items = items.map((it, i) => ({ id: 100 + i, r: KINDS[it.kind].r, y0: it.y, ph: 0, ...it }));
  Object.assign(g.hook, hook);
  return g;
}
const count = (items, k) => items.filter(it => it.kind === k).length;
const stock = (kind, level) => { const c = STOCK.find(([k]) => k === kind)[1]; return c[Math.min(level, c.length) - 1]; };

test('each level asks for 400 more new coins than the one before: 400, 800, 1200, 1600, 2000', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(quota), [400, 800, 1200, 1600, 2000]);
  assert.equal(newGame(9).target, 400);
});

test('a level starts with the line swinging and things in the water, nothing on top of anything', () => {
  for (let seed = 1; seed < 200; seed++) {
    const g = newGame(seed * 7919);
    assert.equal(g.hook.state, 'swing');
    assert.ok(g.items.length >= 15, 'items: ' + g.items.length);
    for (const it of g.items) assert.ok(it.x - it.r >= 0 && it.x + it.r <= W && it.y - it.r >= WATER && it.y + it.r <= H, JSON.stringify(it));
    for (const a of g.items) for (const b of g.items) if (a !== b) assert.ok((a.x - b.x) ** 2 + (a.y - b.y) ** 2 > (a.r + b.r) ** 2);
    const worth = g.items.reduce((s, it) => s + valueOf(g, it), 0);
    assert.ok(worth >= quota(1) * 2, 'level 1 is worth ' + worth);
    // level 1 is plain fishing: nothing that bites, stings, blows up, costs coins or wastes time
    assert.ok(!g.items.some(it => ['puffer', 'turtle', 'shark', 'mine', 'jelly'].includes(it.kind)), 'dangers on level 1');
    // the fish swim and the crabs walk, the rest of the seabed doesn't move
    for (const it of g.items) assert.equal(!!it.vx, !!(KINDS[it.kind].swim || KINDS[it.kind].walk), it.kind);
  }
});

test('later levels: sharks from 2, mines and jellyfish from 3, 龙鱼 from 4, 宝石蟹 from 5; more dangers every level', () => {
  const danger = items => items.filter(it => ['shark', 'mine', 'jelly', 'puffer', 'turtle'].includes(it.kind)).length;
  for (let seed = 1; seed < 30; seed++) {
    const at = L => makeLevel(seed, L).items;
    assert.equal(count(at(1), 'shark') + count(at(2), 'mine') + count(at(2), 'jelly') + count(at(3), 'dragon') + count(at(4), 'crab'), 0);
    assert.ok(count(at(2), 'shark') >= 1 && count(at(3), 'mine') >= 1 && count(at(3), 'jelly') >= 1 && count(at(4), 'dragon') >= 1 && count(at(5), 'crab') >= 1, 'seed ' + seed);
    assert.ok(danger(at(2)) >= 2 && danger(at(4)) > danger(at(2)) && danger(at(7)) > danger(at(4)), seed + ': ' + [2, 4, 7].map(L => danger(at(L))));
    // mines hang still in their own band; crabs are on the seabed
    for (const it of at(8)) {
      if (it.kind === 'mine') assert.ok(!it.vx && it.y >= KINDS.mine.band[0] && it.y <= KINDS.mine.band[1]);
      if (it.kind === 'crab') assert.ok(it.vx && it.y > SEABED - it.r);
    }
  }
  assert.equal(stock('shark', 30), 4); // the last number in the table goes on
});

test('the fish are quicker every level, up to half again', () => {
  assert.equal(quick(1), 1);
  assert.ok(quick(3) > quick(2) && quick(10) > quick(6) && quick(10) <= 1.55 && quick(40) === quick(10));
  for (let seed = 1; seed < 20; seed++) for (const L of [1, 6]) {
    for (const it of makeLevel(seed, L).items) {
      const k = KINDS[it.kind], v = Math.abs(it.vx || 0);
      if (k.swim) assert.ok(v >= k.swim[0] * quick(L) - 1e-9 && v <= k.swim[1] * quick(L) + 1e-9, it.kind + ' ' + v);
      if (k.walk) assert.ok(v >= k.walk[0] && v <= k.walk[1]);
    }
  }
});

test('香饵 brings two more big fish', () => {
  for (let seed = 1; seed < 30; seed++) {
    const plain = makeLevel(seed, 2).items, baited = makeLevel(seed, 2, { bait: true }).items;
    assert.deepEqual(baited.slice(0, plain.length).map(it => it.kind), plain.map(it => it.kind));
    const extra = baited.slice(plain.length);
    assert.ok(extra.length >= 1 && extra.every(it => it.kind === 'octopus'), JSON.stringify(extra.map(it => it.kind))); // (龙鱼 too from level 4)
  }
});

test('fish swim across, come back in on the other side, and bob within their depth', () => {
  const g = newGame(11);
  const fish = g.items.filter(it => KINDS[it.kind].swim).map(it => ({ it, x: it.x }));
  for (let t = 0; t < 1200; t++) {
    step(g, []);
    for (const { it } of fish) {
      assert.ok(it.x >= -it.r - 13 && it.x <= W + it.r + 13, it.kind + ' at ' + it.x);
      assert.ok(Math.abs(it.y - it.y0) <= KINDS[it.kind].bob + 1e-9);
    }
  }
  assert.ok(fish.every(({ it, x }) => it.x !== x));
  const seabed = g.items.filter(it => !it.vx);
  assert.ok(seabed.every(it => newGame(11).items.find(o => o.id === it.id).x === it.x));
});

test('the same seed and inputs play out the same way, and the replay agrees', () => {
  for (const seed of [1, 42, 123456789, 4294967295]) {
    const opts = { until: g => g.level > 3 };
    const a = play(seed, player(), opts), b = play(seed, player(), opts);
    assert.equal(a.g.money, b.g.money);
    assert.deepEqual(a.events, b.events);
    const events = [...a.events, [a.g.tick, 4]]; // and end it there
    step(a.g, [[a.g.tick, 4]]);
    const r = replay(seed, events);
    assert.deepEqual(r, { money: a.g.money, level: a.g.level, cleared: a.g.cleared, end: a.g.end, ticks: a.g.tick, caught: a.g.caught });
  }
});

test('bites, blasts, stings and bolting fish play out the same way every time', () => {
  // Two games side by side on the same seed and the same taps (in rhythm, no aiming), both waved
  // through to the deeper levels, compared tick by tick: everything in the water, the hook, the coins.
  const seen = {};
  const state = g => JSON.stringify([g.tick, g.phase, g.level, g.money, g.target, g.left, g.scissors, g.hook, g.items, g.caught, g.happened]);
  for (let seed = 1; seed <= 6; seed++) {
    const a = newGame(seed * 31337), b = newGame(seed * 31337);
    while (!a.over && a.level < 7) {
      const ev = a.phase === 'shop' ? [[a.tick, 3]] : a.hook.state === 'swing' && a.tick % 37 === 0 ? [[a.tick, 0]] : a.hook.state === 'back' && a.tick % 211 === 0 ? [[a.tick, 1]] : [];
      for (const g of [a, b]) { if (g.phase === 'play') g.money = Math.max(g.money, g.target); step(g, ev); }
      for (const h of a.happened) seen[h.type] = (seen[h.type] || 0) + 1;
      assert.equal(state(a), state(b));
    }
  }
  for (const type of ['bite', 'boom', 'spook', 'hook', 'land', 'miss']) assert.ok(seen[type] > 0, 'never saw a ' + type + ': ' + JSON.stringify(seen));
});

test('level 1 is welcoming, level 3 is beyond tapping in rhythm, and even knowing what each cast will catch has an end', () => {
  // someone who just taps in rhythm, never aiming (tests only)
  const tapper = g => (g.phase === 'shop' ? [[g.tick, 3]] : g.hook.state === 'swing' && g.tick % 37 === 0 ? [[g.tick, 0]] : []);
  const N = 30, far = { tapper: [], knowing: [] };
  for (let seed = 1; seed <= N; seed++) {
    far.tapper.push(play(seed * 104729, tapper, { until: g => g.level > 4 }).g.cleared);
    far.knowing.push(play(seed * 104729, player(), { until: g => g.level > 12 }).g.cleared);
  }
  const passed = (who, level) => far[who].filter(c => c >= level).length;
  assert.ok(passed('tapper', 1) >= N * 0.8, 'tapping: level 1 passed ' + passed('tapper', 1) + '/' + N);
  assert.ok(passed('tapper', 3) <= N * 0.2, 'tapping: level 3 passed ' + passed('tapper', 3) + '/' + N);
  // the test player above casts on the exact tick that hooks something good (no person can): it goes further, not for ever
  assert.ok(passed('knowing', 1) >= N * 0.9, 'level 1 passed ' + passed('knowing', 1) + '/' + N);
  assert.ok(passed('knowing', 2) >= N * 0.7, 'level 2 passed ' + passed('knowing', 2) + '/' + N);
  assert.ok(passed('knowing', 12) <= N * 0.1, 'level 12 passed ' + passed('knowing', 12) + '/' + N);
});

test('doing nothing: the level runs out and the run is over with nothing', () => {
  const { g, events } = play(7, () => []);
  assert.equal(events.length, 0);
  assert.equal(g.end, 'fail');
  assert.equal(g.money, 0);
  assert.equal(g.tick, LEVEL_TICKS);
});

test('the hook catches what the cast was going to catch, and reels it in for its value', () => {
  let tried = 0;
  for (let seed = 1; seed < 40; seed++) {
    const g = newGame(seed);
    let it = null;
    while (!(it = castNow(g))) step(g, []);
    step(g, [[g.tick, 0]]);
    assert.ok(g.hook.state === 'out' || g.hook.item); // (it may hook something right away: the hook is in the water)
    while (busy(g.hook)) step(g, []);
    assert.equal(g.hook.item.id, it.id);
    const item = g.hook.item, kind = item.kind, before = g.money, want = kind === 'chest' ? null : valueOf(g, item), len = g.hook.len;
    let ticks = 0;
    while (g.hook.state === 'back') { step(g, []); ticks++; }
    if (want !== null) assert.equal(g.money - before, want);
    // heavier comes in slower: PULL / (1 + weight) a tick
    const speed = PULL / (1 + (item.w ?? KINDS[kind].w));
    assert.equal(ticks, Math.ceil((len - ROPE0) / speed - 1e-9), kind);
    if (kind === 'octopus') assert.ok(ticks > 2 * HZ, kind + ' in ' + ticks + ' ticks');
    // and it's in the catch, marked as the first of its kind, landed where it was
    assert.equal(g.caught[kind], 1);
    assert.ok(g.happened.some(h => h.type === 'land' && h.kind === kind && h.first && h.y > WATER));
    tried++;
  }
  assert.ok(tried > 30);
});

test('the big things are slow: an octopus from the deep takes over 3 seconds, a shark and a turtle longer still', () => {
  const reel = kind => {
    const g = scene([{ kind, x: PIVOT.x, y: 380 }]);
    step(g, [[0, 0]]);
    while (g.hook.state === 'out') step(g, []);
    let ticks = 0;
    while (g.hook.state === 'back') { step(g, []); ticks++; }
    return ticks / HZ;
  };
  assert.ok(reel('minnow') < 1, 'minnow ' + reel('minnow'));
  assert.ok(reel('octopus') > 3 && reel('octopus') < 7, 'octopus ' + reel('octopus'));
  assert.ok(reel('turtle') > reel('shark') && reel('shark') > reel('octopus'));
});

test('the hook swings under the water, all the way across', () => {
  const g = newGame(3);
  for (let t = 0; t < SWING.period; t++) {
    step(g, []);
    const [, y] = tipOf(g.hook);
    assert.ok(y > WATER + 8, 'hook at ' + y);
  }
});

test('coming back empty, the hook still catches what it runs into', () => {
  let found = 0;
  for (let seed = 1; seed < 60 && found < 5; seed++) {
    const g = newGame(seed);
    for (let k = 0; k < 600 && found < 5; k++) {
      // a cast that misses on the way out but hooks something on the way back
      if (g.hook.state === 'swing' && !castNow(g, true) && castNow(g)) {
        const want = castNow(g);
        step(g, [[g.tick, 0]]);
        while (g.hook.state === 'out') step(g, []);
        assert.equal(g.hook.item, null);                 // came back empty…
        while (g.hook.state === 'back' && !g.hook.item) step(g, []);
        assert.equal(g.hook.item?.id, want.id);          // …and caught it on the way
        const before = g.money;
        while (g.hook.state === 'back') step(g, []);
        if (want.kind !== 'chest') assert.equal(g.money - before, valueOf(g, want));
        found++;
        break;
      }
      step(g, []);
    }
  }
  assert.ok(found >= 3, 'found ' + found);
});

test('casting again while the line is out does nothing; a cast that hooks nothing comes back empty', () => {
  for (let seed = 1; seed < 200; seed++) {
    const g = newGame(seed);
    let k = 0;
    while (castNow(g) && k++ < 400) step(g, []);
    if (castNow(g)) continue;
    step(g, [[g.tick, 0]]);
    const len = g.hook.len;
    step(g, [[g.tick, 0]]);
    assert.ok(g.hook.len > len);
    while (g.hook.state !== 'swing') step(g, []);
    assert.equal(g.money, 0);
    assert.equal(g.hook.len, ROPE0);
    return;
  }
  assert.fail('never found a miss');
});

test('scissors cut loose what is on the line, and need one', () => {
  for (let seed = 1; seed < 30; seed++) {
    const g = newGame(seed);
    while (!castNow(g)) step(g, []);
    step(g, [[g.tick, 0]]);
    while (busy(g.hook)) step(g, []);
    const money = g.money, cutKind = g.hook.item.kind;
    step(g, [[g.tick, 1]]);
    assert.equal(g.hook.item, null);
    assert.equal(g.scissors, 0);
    assert.ok(g.happened.some(h => h.type === 'cut' && h.kind === cutKind));
    // what was cut loose is gone; the empty hook may still catch something on the way back
    while (g.hook.state === 'back') step(g, []);
    assert.ok(g.money === money || g.happened.some(h => h.type === 'land' && h.kind !== cutKind) || Object.keys(g.caught).length === 1);
    // none left: nothing happens
    while (!castNow(g)) step(g, []);
    step(g, [[g.tick, 0]]);
    while (busy(g.hook)) step(g, []);
    step(g, [[g.tick, 1]]);
    assert.ok(g.hook.item);
    return;
  }
});

test('a shark eats a fish that is reeled past its mouth: the catch is gone and the line comes back slack', () => {
  // an octopus on the line, just under a shark's mouth; a can lying further up the line
  const g = scene([{ kind: 'shark', x: PIVOT.x - 30, y: 300, vx: 0.9 }, { kind: 'can', x: PIVOT.x, y: 200 }],
    { state: 'back', len: 240, item: { id: 7, kind: 'octopus', r: 15, x: PIVOT.x, y: PIVOT.y + 250.5 } });
  let bite = null;
  for (let t = 0; t < 200 && !bite; t++) { step(g, []); bite = g.happened.find(h => h.type === 'bite'); }
  assert.ok(bite && bite.kind === 'octopus', 'never bitten');
  assert.equal(g.hook.item, null);
  assert.equal(g.hook.state, 'back');
  // the slack line catches nothing on its way up, pays nothing, and the octopus isn't in the catch
  while (g.hook.state === 'back') step(g, []);
  assert.equal(g.money, 0);
  assert.deepEqual(g.caught, {});
  assert.equal(count(g.items, 'can'), 1);
  assert.equal(count(g.items, 'shark'), 1);
});

test('a shark leaves pearls, chests and junk alone, and can not reach what passes behind its tail', () => {
  for (const kind of ['pearl', 'chest', 'boot', 'turtle']) {
    const g = scene([{ kind: 'shark', x: PIVOT.x - 30, y: 300, vx: 0.9 }], { state: 'back', len: 240, item: { id: 7, kind, r: KINDS[kind].r, x: PIVOT.x, y: PIVOT.y + 250 } });
    while (g.hook.state === 'back') { step(g, []); assert.ok(!g.happened.some(h => h.type === 'bite'), kind); }
    assert.equal(g.caught[kind], 1);
  }
  // swimming away from the line: the fish goes up behind it
  const g = scene([{ kind: 'shark', x: PIVOT.x - 40, y: 300, vx: -0.9 }], { state: 'back', len: 240, item: { id: 7, kind: 'angel', r: 12, x: PIVOT.x, y: PIVOT.y + 250 } });
  while (g.hook.state === 'back') { step(g, []); assert.ok(!g.happened.some(h => h.type === 'bite')); }
  assert.equal(g.money, KINDS.angel.value);
  const [mx] = mouthOf(g.items[0]);
  assert.ok(mx < g.items[0].x); // its mouth is at the front
});

test('a shark charges at a hooked fish in front of it, not at one behind it or at an empty hook', () => {
  const moved = (vx, hook) => {
    const g = scene([{ kind: 'shark', x: 80, y: 300, vx }], hook);
    const x = g.items[0].x;
    step(g, []);
    return Math.abs(g.items[0].x - x);
  };
  const octo = x => ({ state: 'back', len: 200, item: { id: 7, kind: 'octopus', r: 15, x, y: 300 } });
  assert.ok(Math.abs(moved(0.9, octo(150)) - 0.9 * LUNGE.speed) < 1e-9);   // ahead of it: charges
  assert.ok(Math.abs(moved(-0.9, octo(150)) - 0.9) < 1e-9);                // behind it: swims on
  assert.ok(Math.abs(moved(0.9, octo(80 + LUNGE.far + 60)) - 0.9) < 1e-9); // too far ahead
  assert.ok(Math.abs(moved(0.9, {}) - 0.9) < 1e-9);                        // nothing on the hook
  assert.ok(Math.abs(moved(0.9, { state: 'back', len: 200, item: { id: 7, kind: 'chest', r: 13, x: 150, y: 300 } }) - 0.9) < 1e-9); // not a fish
});

test('a mine blows up what is around it (other mines too) and pays nothing; the reel is dazed for a moment', () => {
  const g = scene([
    { kind: 'mine', x: PIVOT.x, y: 320 },
    { kind: 'octopus', x: PIVOT.x + 40, y: 330 },                 // in the blast
    { kind: 'mine', x: PIVOT.x - 50, y: 340 },                    // in the blast: goes off too
    { kind: 'pearl', x: PIVOT.x - 50 - BLAST, y: 340 },           // only the second mine reaches it
    { kind: 'chest', x: PIVOT.x + BLAST + 13 + 30, y: 320 },      // out of reach of both
    { kind: 'minnow', x: 20, y: 160, vx: 1.2 },
  ]);
  step(g, [[0, 0]]);
  const booms = [];
  while (g.hook.state === 'out') { step(g, []); booms.push(...g.happened.filter(h => h.type === 'boom')); }
  assert.equal(booms.length, 2);
  assert.deepEqual(booms.flatMap(b => b.gone.map(o => o.kind)).sort(), ['mine', 'octopus', 'pearl']);
  assert.deepEqual(g.items.map(it => it.kind).sort(), ['chest', 'minnow']);
  assert.equal(g.hook.item, null);
  assert.equal(g.hook.stun, DAZE);
  const len = g.hook.len;
  for (let t = 0; t < DAZE; t++) { step(g, []); assert.equal(g.hook.len, len); }
  while (g.hook.state === 'back') step(g, []);
  assert.equal(g.money, 0);
  assert.deepEqual(g.caught, { mine: 1 }); // in the 图鉴 as set off, once for the cast
});

test('a jellyfish stings: the reel stops for a while; cutting it loose frees the line', () => {
  const hooked = () => {
    const g = scene([{ kind: 'jelly', x: PIVOT.x, y: 250, vx: 0.2 }]);
    step(g, [[0, 0]]);
    while (g.hook.state === 'out') step(g, []);
    assert.equal(g.hook.item.kind, 'jelly');
    return g;
  };
  const g = hooked(), len = g.hook.len;
  for (let t = 0; t < STING; t++) { step(g, []); assert.equal(g.hook.len, len); }
  step(g, []);
  assert.ok(g.hook.len < len);
  const c = hooked(), at = c.hook.len;
  step(c, [[c.tick, 1]]);
  assert.equal(c.hook.item, null);
  assert.ok(c.hook.len < at);
});

test('shy fish near the line dart away when a cast stops; the others stay calm', () => {
  // a cast straight down that hooks nothing. Beside the line when it stops: a minnow drifting off to the
  // right, a clown that has swum up to it from the left, a puffer (not shy); and a minnow far away
  const g = scene([{ kind: 'minnow', x: PIVOT.x + 20, y: 200, vx: 0.1 }, { kind: 'clown', x: PIVOT.x - 100, y: 220, vx: 1.0 },
    { kind: 'puffer', x: PIVOT.x + 25, y: 260, vx: 0.05 }, { kind: 'minnow', x: 30, y: 240, vx: 0.2 }]);
  step(g, [[0, 0]]);
  while (g.hook.state === 'out') step(g, []);
  const [minnow, clown, puffer, far] = g.items;
  assert.equal(g.items.length, 4);
  assert.ok(g.happened.some(h => h.type === 'miss'));
  assert.deepEqual(g.happened.find(h => h.type === 'spook'), { type: 'spook', n: 2 });
  assert.equal(minnow.dart, SPOOK.ticks);
  assert.equal(minnow.vx, 0.1);                 // on the right of the line: off to the right
  assert.equal(clown.dart, SPOOK.ticks);
  assert.equal(clown.vx, -1.0);                 // on the left: it turns round
  assert.ok(!puffer.dart && puffer.vx === 0.05 && !far.dart);
  const x = clown.x;
  step(g, []);
  assert.ok(Math.abs(x - clown.x - 1.0 * SPOOK.speed) < 1e-9);
  for (let t = 1; t < SPOOK.ticks; t++) step(g, []);
  assert.equal(clown.dart, 0);
  const x2 = clown.x;
  step(g, []);
  assert.ok(Math.abs(x2 - clown.x - 1.0) < 1e-9); // calm again
});

test('a 宝石蟹 scuttles along the seabed in fits and starts and turns round at the edges and at what lies in its way', () => {
  const y = SEABED + 4;
  const g = scene([{ kind: 'crab', x: 100, y, vx: 1.2 }, { kind: 'rock', x: 200, y }, { kind: 'chest', x: 40, y }]);
  const crab = g.items[0];
  let stopped = 0, turned = 0, lo = Infinity, hi = -Infinity, dir = 1;
  g.left = 10 * LEVEL_TICKS;
  for (let t = 0; t < 3000; t++) {
    const x = crab.x;
    step(g, []);
    if (crab.x === x) stopped++;
    if ((crab.vx > 0 ? 1 : -1) !== dir) { turned++; dir = -dir; }
    lo = Math.min(lo, crab.x); hi = Math.max(hi, crab.x);
    assert.equal(crab.y, y);
    for (const o of g.items) if (o !== crab) assert.ok(Math.abs(o.x - crab.x) >= o.r + crab.r - 1e-9, 'walked into the ' + o.kind);
  }
  assert.ok(stopped > 500 && stopped < 2500, 'stopped for ' + stopped);
  assert.ok(turned >= 4, 'turned ' + turned);
  assert.ok(lo < 70 && hi > 160, lo + ' … ' + hi);
  // with nothing in the way it goes from edge to edge and never leaves the field
  const open = scene([{ kind: 'crab', x: 100, y, vx: -1.2 }]);
  open.left = 10 * LEVEL_TICKS;
  for (let t = 0; t < 3000; t++) { step(open, []); assert.ok(open.items[0].x >= 13 && open.items[0].x <= W - 13); }
});

test('the shop: buying spends coins, the next level starts with the boost, and what was spent has to be caught again', () => {
  for (let seed = 1; seed < 50; seed++) {
    const { g } = toShop(seed);
    if (g.phase !== 'shop') continue;
    const offer = g.shop.findIndex(o => o.price <= g.money);
    if (offer < 0) continue;
    const o = g.shop[offer], money = g.money, sc = g.scissors;
    assert.equal(g.nextTarget, money + quota(2));
    step(g, [[g.tick, 2, offer]]);
    assert.equal(g.money, money - o.price);
    assert.equal(g.shop[offer].bought, true);
    if (o.key === 'scissors') assert.equal(g.scissors, sc + 1); else assert.equal(g.next[o.key], true);
    step(g, [[g.tick, 2, offer]]); // can't buy twice
    assert.equal(g.money, money - o.price);
    step(g, [[g.tick, 3]]);
    assert.equal(g.phase, 'play');
    assert.equal(g.level, 2);
    assert.equal(g.target, money + quota(2));           // the target was set when level 1 was passed
    assert.equal(g.target - g.money, quota(2) + o.price);
    assert.equal(g.from, money - o.price);
    if (o.key !== 'scissors') assert.equal(g.boost[o.key], true);
    return;
  }
  assert.fail('no shop reached');
});

test('a rich level does not carry over: the next target is always that many coins more', () => {
  const g = newGame(5);
  g.money = 5000; // (as if earned)
  step(g, [[g.tick, 3]]);
  assert.equal(g.phase, 'shop');
  assert.equal(g.nextTarget, 5000 + quota(2));
  step(g, [[g.tick, 3]]);
  assert.equal(g.target, 5800);
  step(g, [[g.tick, 3]]); // not there yet: nothing happens
  assert.equal(g.phase, 'play');
  // and falling short ends the run
  while (!g.over) step(g, []);
  assert.equal(g.end, 'fail');
  assert.equal(g.money, 5000);
  assert.equal(g.cleared, 1);
});

test('traps: a puffer costs coins (never below none), a turtle pays nothing and is slow; more of them every level', () => {
  assert.ok(KINDS.puffer.value < 0 && KINDS.turtle.value === 0 && KINDS.turtle.w > KINDS.shark.w && KINDS.shark.value < KINDS.octopus.value);
  for (let seed = 1; seed < 20; seed++) {
    const traps = L => { const items = makeLevel(seed, L).items; return count(items, 'puffer') + count(items, 'turtle'); };
    assert.ok(traps(2) >= 1 && traps(6) > traps(2), seed + ': ' + traps(2) + ' -> ' + traps(6));
  }
  // land a puffer with some coins
  const g = scene([{ kind: 'puffer', x: PIVOT.x, y: 220, vx: 0.1 }]);
  g.money = 700;
  step(g, [[0, 0]]);
  while (g.hook.state !== 'swing') step(g, []);
  assert.equal(g.money, 700 + KINDS.puffer.value);
  assert.ok(g.happened.some(h => h.type === 'land' && h.kind === 'puffer' && h.v === KINDS.puffer.value));
});

test('a puffer never takes the coins below none', () => {
  const g = newGame(1);
  const puffer = { id: 999, kind: 'puffer', x: 0, y: 200, r: 13 };
  g.hook = { ...g.hook, state: 'back', item: puffer, len: 0 };
  step(g, []);
  assert.equal(g.money, 0);
  assert.ok(g.happened.some(h => h.type === 'land' && h.kind === 'puffer' && h.v === 0));
});

test('回收袋: junk is worth three times as much', () => {
  const g = newGame(1), boot = { kind: 'boot' }, fish = { kind: 'shark' };
  assert.equal(valueOf(g, boot), 3);
  g.boost = { recycle: true };
  assert.equal(valueOf(g, boot), 9);
  assert.equal(valueOf(g, fish), KINDS.shark.value);
});

test('finishing a level early needs the target; ending the run keeps the coins', () => {
  const g = newGame(5);
  step(g, [[0, 3]]);
  assert.equal(g.phase, 'play'); // not there yet
  g.money = 700; // (as if earned)
  step(g, [[g.tick, 3]]);
  assert.equal(g.phase, 'shop');
  assert.equal(g.cleared, 1);
  step(g, [[g.tick, 4]]);
  assert.ok(g.over);
  assert.equal(g.end, 'quit');
  assert.equal(g.money, 700);
});

test('recorded inputs are checked for shape', () => {
  assert.equal(badEvents([[0, 0], [3, 1], [3, 2, 4], [9, 3], [10, 4]]), null);
  assert.equal(badEvents('nope'), 'events');
  assert.equal(badEvents([[5, 0], [4, 0]]), 'tick');
  assert.equal(badEvents([[0, 2, 5]]), 'buy');
  assert.equal(badEvents([[0, 2]]), 'buy');
  assert.equal(badEvents([[0, 0, 1]]), 'event');
  assert.equal(badEvents([[0, 9]]), 'type');
  assert.equal(badEvents([[0.5, 0]]), 'tick');
  assert.equal(badEvents([[MAX_TICKS + 1, 0]]), 'tick');
  assert.equal(badEvents([7]), 'event');
});

test('a replay stopped in the shop runs to the end of the clock (nothing more happens there)', () => {
  let seed = 1, run = toShop(seed);
  while (run.g.phase !== 'shop') run = toShop(++seed);
  const r = replay(seed, run.events);
  assert.equal(r.end, 'time');
  assert.equal(r.ticks, MAX_TICKS);
  assert.equal(r.money, run.g.money);
});

test('every kind has a name, a size and a weight', () => {
  assert.equal(KIND_KEYS.length, 16);
  for (const k of Object.values(KINDS)) assert.ok(k.r > 0 && k.w >= 0 && k.label && k.note && ['fish', 'bed', 'junk'].includes(k.group));
  assert.deepEqual(STOCK.map(([k]) => k).sort(), [...KIND_KEYS].sort()); // every kind is in the water on some level
});
