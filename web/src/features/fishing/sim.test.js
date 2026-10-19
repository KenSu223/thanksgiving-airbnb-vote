import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, step, target, tipOf, valueOf, makeLevel, KINDS, KIND_KEYS, HZ, LEVEL_TICKS, MAX_TICKS, PULL, ROPE0, SWING, W, H, WATER } from './sim.js';
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
      const i = g.shop.findIndex(o => o.key === 'scissors' && !o.bought && g.money - o.price >= g.target);
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

test('targets: 650, 1195, 2010, 3095, 4450', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(target), [650, 1195, 2010, 3095, 4450]);
});

test('a level starts with the line swinging and things in the water, nothing on top of anything', () => {
  for (let seed = 1; seed < 200; seed++) {
    const g = newGame(seed * 7919);
    assert.equal(g.hook.state, 'swing');
    assert.ok(g.items.length >= 15, 'items: ' + g.items.length);
    for (const it of g.items) assert.ok(it.x - it.r >= 0 && it.x + it.r <= W && it.y - it.r >= WATER && it.y + it.r <= H, JSON.stringify(it));
    for (const a of g.items) for (const b of g.items) if (a !== b) assert.ok((a.x - b.x) ** 2 + (a.y - b.y) ** 2 > (a.r + b.r) ** 2);
    const worth = g.items.reduce((s, it) => s + valueOf(g, it), 0);
    assert.ok(worth >= target(1) * 1.5, 'level 1 is worth ' + worth);
    // the fish swim, the seabed doesn't
    for (const it of g.items) assert.equal(!!it.vx, !!KINDS[it.kind].swim, it.kind);
  }
});

test('later levels have more of the big and the precious; 龙鱼 from level 3', () => {
  const count = (items, k) => items.filter(it => it.kind === k).length;
  for (let seed = 1; seed < 30; seed++) {
    const l1 = makeLevel(seed, 1).items, l6 = makeLevel(seed, 6).items;
    assert.equal(count(l1, 'dragon'), 0);
    assert.ok(count(makeLevel(seed, 3).items, 'dragon') >= 1);
    const big = items => items.filter(it => ['shark', 'turtle', 'dragon', 'pearl'].includes(it.kind)).length;
    assert.ok(big(l6) > big(l1), seed + ': ' + big(l1) + ' -> ' + big(l6));
  }
});

test('香饵 brings two more big fish', () => {
  for (let seed = 1; seed < 30; seed++) {
    const plain = makeLevel(seed, 2).items, baited = makeLevel(seed, 2, { bait: true }).items;
    assert.deepEqual(baited.slice(0, plain.length).map(it => it.kind), plain.map(it => it.kind));
    const extra = baited.slice(plain.length);
    assert.ok(extra.length >= 1 && extra.every(it => ['turtle', 'shark', 'octopus', 'puffer'].includes(it.kind)), JSON.stringify(extra.map(it => it.kind)));
  }
});

test('fish swim across, come back in on the other side, and bob within their depth', () => {
  const g = newGame(11);
  const fish = g.items.filter(it => it.vx).map(it => ({ it, x: it.x }));
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

test('a careful player gets through the first levels on most seeds', () => {
  let passed1 = 0, passed3 = 0;
  const N = 30;
  for (let seed = 1; seed <= N; seed++) {
    const { g } = play(seed * 104729, player(), { until: g => g.level > 3 });
    if (g.cleared >= 1) passed1++;
    if (g.cleared >= 3) passed3++;
  }
  assert.ok(passed1 >= N * 0.9, 'level 1 passed ' + passed1 + '/' + N);
  assert.ok(passed3 >= N * 0.4, 'level 3 passed ' + passed3 + '/' + N);
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
    if (kind === 'shark') assert.ok(ticks > 2 * HZ, kind + ' in ' + ticks + ' ticks');
    // and it's in the catch, marked as the first of its kind, landed where it was
    assert.equal(g.caught[kind], 1);
    assert.ok(g.happened.some(h => h.type === 'land' && h.kind === kind && h.first && h.y > WATER));
    tried++;
  }
  assert.ok(tried > 30);
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

test('the shop: buying spends coins, the next level starts with the boost, the target counts all the coins', () => {
  for (let seed = 1; seed < 50; seed++) {
    const { g } = toShop(seed);
    if (g.phase !== 'shop') continue;
    const offer = g.shop.findIndex(o => o.price <= g.money);
    if (offer < 0) continue;
    const o = g.shop[offer], money = g.money, sc = g.scissors;
    step(g, [[g.tick, 2, offer]]);
    assert.equal(g.money, money - o.price);
    assert.equal(g.shop[offer].bought, true);
    if (o.key === 'scissors') assert.equal(g.scissors, sc + 1); else assert.equal(g.next[o.key], true);
    step(g, [[g.tick, 2, offer]]); // can't buy twice
    assert.equal(g.money, money - o.price);
    step(g, [[g.tick, 3]]);
    assert.equal(g.phase, 'play');
    assert.equal(g.level, 2);
    assert.equal(g.target, target(2));
    if (o.key !== 'scissors') assert.equal(g.boost[o.key], true);
    return;
  }
  assert.fail('no shop reached');
});

test('回收袋: junk is worth three times as much', () => {
  const g = newGame(1), boot = { kind: 'boot' }, fish = { kind: 'shark' };
  assert.equal(valueOf(g, boot), 3);
  g.boost = { recycle: true };
  assert.equal(valueOf(g, boot), 9);
  assert.equal(valueOf(g, fish), 500);
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
  assert.equal(KIND_KEYS.length, 14);
  for (const k of Object.values(KINDS)) assert.ok(k.r > 0 && k.w >= 0 && k.label && k.note && ['fish', 'bed', 'junk'].includes(k.group));
});
