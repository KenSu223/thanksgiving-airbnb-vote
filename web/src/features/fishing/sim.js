// 小小钓鱼: the whole game as a simulation stepped 60 times a second. Like
// 躲技能 (dodge/sim.js) it's seeded and only uses + - * / and sqrt (with our own
// sine for the swing and the swimming), so the same seed and inputs always
// play out the same way: the browser plays it, and the server replays the
// inputs for the score (verify.js); a best run can be watched again.
//
// A little boat on the water, an American Shorthair with a rod; the hook
// swings under the water at the end of the line. Cast it and the hook goes
// straight down its line until it catches something (or leaves the water),
// then reels back, slower the heavier the catch; reeling back empty it can
// still hook something on the way. The fish swim across at their own depths
// and speeds (quicker every level), so it's about timing the swing and the
// fish together; pearls, chests and junk lie on the seabed.
//
// What makes it hard (all from level 2 on; level 1 is plain fishing):
//   sharks bite   a fish being reeled past a shark's mouth is eaten: gone
//   water mines   hook one and it blows up everything around it
//   jellyfish     sting: the reel stops for a moment
//   shy fish      when a cast stops, the small fish near the line dart away
//   the reel      big things are really slow, so each one is a choice
//   the target    every level asks for new coins on top of what you came in
//                 with, so a good level doesn't make the next one easier
//
// A run is levels of 60 seconds with a coin target each; reach it and you get
// the shop, then the next level; fall short and the run is over. The score is
// the coins at the end (what you spend in the shop is gone, and has to be
// earned again for the next target). Every kind you've ever caught goes in
// your 图鉴 (kept by the server).
//
// Inputs are events [tick, type, a], applied at the start of that tick:
//   [t, 0]     cast (while the line swings)
//   [t, 1]     cut the line: let go of what's on it (while reeling something in)
//   [t, 2, i]  buy shop offer i (in the shop)
//   [t, 3]     next: finish the level early once the target is reached, or leave the shop
//   [t, 4]     end the run here (the coins so far count)
// Anything that doesn't fit the moment is ignored. Ticks keep going in the shop
// too, so a run's ticks are never more than the real time it took.
export const HZ = 60;
export const W = 360, H = 480;
export const PIVOT = { x: 180, y: 80 };     // the rod tip, where the line comes from
export const WATER = 112;                   // the surface
export const SEABED = H - 34;               // where the sand starts
export const LEVEL_TICKS = 60 * HZ;
export const MAX_TICKS = 45 * 60 * HZ;      // a run stops after 45 minutes
// The hook swings under the water: with this much line out, even at the ends
// of the swing (±54°, one full swing in 2.5 s) it's below the surface.
export const ROPE0 = 74;
export const SWING = { max: 0.95, period: 150 };
export const CAST = 4.6, PULL = 7.6, HOOK_R = 5;
export const STRONG = 1.6;                  // 大力水: reeling in this much faster
export const BITE = 17;                     // how far a shark's mouth reaches
// A shark that has a hooked fish in front of it (this far ahead, this far above or below) charges at it.
export const LUNGE = { far: 110, tall: 46, speed: 2.4 };
export const BLAST = 58;                    // a mine takes everything this near with it
export const STING = 80, DAZE = 45;         // ticks the reel stops: stung by a jellyfish, after a blast
export const SPOOK = { near: 30, ticks: 50, speed: 2.5 }; // shy fish this near the line dart away
// Bump whenever a change makes the same seed and inputs play out differently:
// runs started under another version can't be checked or replayed.
// 2: the hook swings under the water, and catches on the way back too
// 3: traps (puffers, turtles) and heavier prizes
// 4: sharks bite, mines, stings, shy fish, 宝石蟹, a much slower reel, a target of its own for every level
export const SIM_VERSION = 4;

// value: coins when it's in the boat; w: how much it slows the reel.
// Swimmers keep to a depth band [top, bottom] and cross at speed [lo, hi]
// px a tick, bobbing up and down by `bob`; walkers go back and forth on the
// seabed in fits and starts; the rest stay where they are (a mine hangs in its
// band). prey: a shark eats it off the hook; shy: darts away from a cast.
export const KINDS = {
  minnow: { group: 'fish', label: '小黄鱼', r: 8, value: 20, w: 0.4, swim: [1.1, 1.6], band: [150, 260], bob: 2, prey: true, shy: true, note: '浅水里游得快，胆子小' },
  clown: { group: 'fish', label: '小丑鱼', r: 9, value: 40, w: 0.6, swim: [0.9, 1.3], band: [155, 300], bob: 2, prey: true, shy: true, note: '橙白条纹，一吓就跑' },
  angel: { group: 'fish', label: '神仙鱼', r: 12, value: 70, w: 1.2, swim: [0.7, 1.0], band: [170, 330], bob: 3, prey: true, shy: true, note: '扁扁高高的' },
  puffer: { group: 'fish', label: '河豚', r: 13, value: -80, w: 1.5, swim: [0.5, 0.8], band: [170, 360], bob: 5, prey: true, note: '扎手！钓上来扣 80' },
  octopus: { group: 'fish', label: '章鱼', r: 15, value: 300, w: 7, swim: [0.3, 0.5], band: [280, 410], bob: 8, prey: true, note: '很值钱，可是又沉又慢，鲨鱼最爱抢' },
  turtle: { group: 'fish', label: '海龟', r: 20, value: 0, w: 12, swim: [0.25, 0.4], band: [200, 380], bob: 3, note: '慢得要命，钓上来还得放生，一分不给' },
  shark: { group: 'fish', label: '鲨鱼', r: 24, value: 50, w: 10, swim: [0.8, 1.1], band: [230, 400], bob: 2, note: '看见钩上的鱼就冲过来一口吃掉；自己又沉又不值钱' },
  dragon: { group: 'fish', label: '龙鱼', r: 14, value: 800, w: 2, swim: [1.6, 2.0], band: [370, 425], bob: 2, prey: true, shy: true, note: '最深处，很少见，游得飞快' },
  jelly: { group: 'fish', label: '水母', r: 11, value: 5, w: 0.15, swim: [0.15, 0.3], band: [150, 380], bob: 12, prey: true, note: '蜇人！钩到会麻一会儿收不动线' },
  pearl: { group: 'bed', label: '珍珠贝', r: 9, value: 600, w: 1.2, note: '躺在海底，小又轻' },
  crab: { group: 'bed', label: '宝石蟹', r: 13, value: 450, w: 1.5, walk: [0.9, 1.3], note: '举着宝石在海底横着跑，走走停停' },
  chest: { group: 'bed', label: '宝箱', r: 13, value: 0, w: 1.5, note: '打开看看：金币、剪刀或者大力水' },
  boot: { group: 'junk', label: '旧靴子', r: 11, value: 3, w: 4, note: '谁丢的…' },
  can: { group: 'junk', label: '易拉罐', r: 7, value: 1, w: 1, note: '捡起来也算环保' },
  rock: { group: 'junk', label: '礁石', r: 18, value: 10, w: 10, note: '又重又不值钱，挡路' },
  mine: { group: 'junk', label: '水雷', r: 11, value: 0, w: 0, band: [300, 392], note: '钩到就炸，周围的东西全没了' },
};
export const KIND_KEYS = Object.keys(KINDS);

// The shop between levels. Each shop offers some of these at prices of its own;
// all but the scissors last for the next level only.
export const GOODS = [
  { key: 'scissors', emoji: '✂️', label: '剪刀', tip: '钓到不想要的，剪断线放走，钩子空着快快回来', odds: 0.85, price: [15, 90], per: 6 },
  { key: 'strong', emoji: '💪', label: '大力水', tip: '下一关收线快一半多，鲨鱼更难抢到', odds: 0.5, price: [80, 300], per: 25 },
  { key: 'bait', emoji: '🪱', label: '香饵', tip: '下一关多来两条大鱼', odds: 0.5, price: [40, 200], per: 15 },
  { key: 'clover', emoji: '🍀', label: '幸运草', tip: '下一关宝箱里的东西更好', odds: 0.5, price: [20, 140], per: 12 },
  { key: 'recycle', emoji: '♻️', label: '回收袋', tip: '下一关垃圾（靴子、罐子、礁石）值三倍', odds: 0.45, price: [5, 60], per: 4 },
];

// The new coins each level asks for: 400 for the first, 800 for the second,
// 1200, 1600, … The target is that many more than the coins held when the
// level before was passed, so a rich level doesn't carry over, and what the
// shop costs has to be caught again.
export const quota = level => 400 * level;

// ---- deterministic sine ----
const PI = 3.141592653589793;
export function dsin(x) { // any x; Taylor series on [-π/2, π/2] after reducing
  while (x > PI) x -= 2 * PI;
  while (x < -PI) x += 2 * PI;
  if (x > PI / 2) x = PI - x; else if (x < -PI / 2) x = -PI - x;
  const x2 = x * x;
  return x * (1 - x2 / 6 * (1 - x2 / 20 * (1 - x2 / 42 * (1 - x2 / 72 * (1 - x2 / 110 * (1 - x2 / 156))))));
}
export const dcos = x => dsin(x + PI / 2);

// ---- seeded random (mulberry32) ----
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const mix = (seed, level, salt) => (seed ^ Math.imul(level + 1, 0x9E3779B1) ^ salt) >>> 0;

// How much quicker the fish are on this level: 6% a level, up to half again.
export const quick = level => 1 + Math.min(level - 1, 9) * 0.06;

// How many of each kind a level has, by level (the last number goes on for
// every level after), in the order they're put in the water.
export const STOCK = [
  ['crab', [0, 0, 0, 0, 1, 1, 1, 2]],
  ['rock', [1, 1, 2, 2, 3, 3, 4]],
  ['pearl', [0, 0, 1, 1, 1, 2]],
  ['chest', [2, 1, 2]],
  ['boot', [1, 1, 2]],
  ['can', [1, 1, 1, 2]],
  ['mine', [0, 0, 1, 1, 2, 2, 2, 3]],
  ['shark', [0, 1, 2, 2, 3, 3, 3, 4]],
  ['turtle', [0, 0, 1, 2, 2, 2, 3]],
  ['octopus', [1, 2, 2, 2, 2, 2, 3]],
  ['puffer', [0, 1, 1, 2, 2, 3, 3, 4]],
  ['angel', [4, 3, 3, 2]],
  ['clown', [4, 3, 3, 3, 2]],
  ['minnow', [5, 4, 4, 3, 3, 2]],
  ['dragon', [0, 0, 0, 1, 1, 1, 1, 2]],
  ['jelly', [0, 0, 2, 3, 3, 3, 4]],
];

// ---- a level's water ----
// The seabed first (the crabs, so they get a place among the rocks; big rocks
// before the small things), then the mines that hang just above it, then the
// fish, each somewhere in its depth band, not on top of anything at the
// start. Level 1 is plain fishing; from level 2 on there's more of what bites,
// stings, blows up and wastes time every level, and the prizes that pay for
// the bigger targets sit among it. The numbers in STOCK and quota() were set
// by measuring (see ARCHITECTURE.md): a careful player's haul is about 1.3×
// what levels 2–4 ask for, about even on levels 5–6, and short after that.
export function makeLevel(seed, level, boost = {}) {
  const rand = rng(mix(seed, level, 0x51ED)), items = [], fast = quick(level);
  const free = (x, y, r) => items.every(o => { const dx = o.x - x, dy = o.y - y, m = o.r + r + 4; return dx * dx + dy * dy > m * m; });
  const put = (kind, n) => {
    const k = KINDS[kind], r = k.r;
    for (let i = 0; i < n; i++) {
      for (let tries = 0; tries < 60; tries++) {
        const x = r + 6 + rand() * (W - 2 * r - 12);
        const [y0, y1] = k.band || [SEABED - r * 0.3, H - 6 - r];
        const y = y0 + rand() * (y1 - y0);
        if (!free(x, y, r)) continue;
        const it = { id: items.length, kind, x, y, r };
        const pace = k.swim || k.walk;
        if (pace) {
          const speed = (pace[0] + rand() * (pace[1] - pace[0])) * (k.swim ? fast : 1);
          Object.assign(it, { vx: rand() < 0.5 ? -speed : speed, y0: y, ph: rand() * 2 * PI });
        }
        if (kind === 'chest') it.w = 2 + rand() * 4;
        items.push(it);
        break;
      }
    }
  };
  for (const [kind, counts] of STOCK) put(kind, counts[Math.min(level, counts.length) - 1]);
  if (boost.bait) for (let i = 0; i < 2; i++) put(level >= 4 && rand() < 0.4 ? 'dragon' : 'octopus', 1);
  return { items, rand };
}

function makeShop(g) {
  const rand = rng(mix(g.seed, g.level, 0x5409));
  const offers = [];
  for (const good of GOODS) {
    const roll = rand(), price = good.price[0] + Math.floor(rand() * (good.price[1] - good.price[0])) + good.per * g.level;
    if (roll < good.odds) offers.push({ key: good.key, price, bought: false });
  }
  if (!offers.length) offers.push({ key: 'scissors', price: GOODS[0].price[0] + GOODS[0].per * g.level, bought: false });
  return offers;
}

// target: the coins this level needs; from: the coins it started with (the
// bar on screen); nextTarget: in the shop, what the next level will need.
export function newGame(seed) {
  const g = { seed: seed >>> 0, tick: 0, phase: 'play', over: false, end: null, level: 0, money: 0, scissors: 1, cleared: 0,
    caught: {}, next: {}, boost: {}, items: [], hook: null, shop: null, left: 0, target: 0, from: 0, nextTarget: quota(1), rand: null, happened: [] };
  startLevel(g, 1);
  return g;
}
function startLevel(g, level) {
  const boost = g.next;
  const { items, rand } = makeLevel(g.seed, level, boost);
  Object.assign(g, { phase: 'play', level, target: g.nextTarget, from: g.money, left: LEVEL_TICKS, items, rand, shop: null, boost, next: {},
    hook: { state: 'swing', phase: 0, a: 0, len: ROPE0, item: null, stun: 0, bare: false } });
}
function finish(g, end) { g.over = true; g.phase = 'over'; g.end = end; g.hook.item = null; }
function endLevel(g) {
  const h = g.hook;
  if (h.item) { g.happened.push({ type: 'lost', kind: h.item.kind }); h.item = null; }
  h.state = 'swing'; h.len = ROPE0; h.stun = 0; h.bare = false;
  if (g.money >= g.target) {
    g.cleared = g.level; g.phase = 'shop'; g.shop = makeShop(g); g.nextTarget = g.money + quota(g.level + 1);
    g.happened.push({ type: 'pass' });
  } else finish(g, 'fail');
}

// where the hook is, for the line as it is now
export function tipOf(h) {
  return [PIVOT.x + dsin(h.a) * h.len, PIVOT.y + dcos(h.a) * h.len];
}
export function valueOf(g, it) {
  const k = KINDS[it.kind];
  return k.group === 'junk' && g.boost.recycle ? k.value * 3 : k.value;
}
function pullSpeed(g, it) {
  const w = it.w ?? KINDS[it.kind].w;
  return PULL * (g.boost.strong ? STRONG : 1) / (1 + w);
}
// where a shark's mouth is: at the front, the way it's swimming
export function mouthOf(shark) {
  return [shark.x + (shark.vx < 0 ? -1 : 1) * shark.r * 0.95, shark.y + shark.r * 0.1];
}
// In the boat: what it's worth. A chest is a surprise, drawn from the level's
// own random numbers (so it's the same in a replay).
function landIt(g, it) {
  let v = valueOf(g, it), what = null;
  if (it.kind === 'chest') {
    const r = g.rand();
    if (r < 0.1) { g.scissors++; v = 0; what = 'scissors'; }
    else if (r < 0.18 && !g.boost.strong) { g.boost = { ...g.boost, strong: true }; v = 0; what = 'strong'; }
    else v = g.boost.clover ? 150 + Math.floor(g.rand() * 450) : 30 + Math.floor(g.rand() * (220 + 20 * g.level));
  }
  // a puffer costs coins, never below none
  if (g.money + v < 0) v = -g.money;
  g.money += v;
  const first = !g.caught[it.kind];
  g.caught[it.kind] = (g.caught[it.kind] || 0) + 1;
  g.happened.push({ type: 'land', kind: it.kind, v, what, first, x: it.x, y: it.y });
}

function apply(g, e) {
  const [, type, a] = e, h = g.hook;
  if (type === 4) { finish(g, 'quit'); return; }
  if (g.phase === 'play') {
    if (type === 0 && h.state === 'swing') { h.state = 'out'; g.happened.push({ type: 'cast' }); }
    else if (type === 1 && h.state === 'back' && h.item && g.scissors > 0) {
      g.scissors--;
      g.happened.push({ type: 'cut', kind: h.item.kind, x: h.item.x, y: h.item.y });
      h.item = null; h.stun = 0;
    } else if (type === 3 && g.money >= g.target) endLevel(g);
  } else if (g.phase === 'shop') {
    const o = g.shop[a];
    if (type === 2 && o && !o.bought && g.money >= o.price) {
      o.bought = true; g.money -= o.price;
      if (o.key === 'scissors') g.scissors++; else g.next = { ...g.next, [o.key]: true };
      g.happened.push({ type: 'buy', key: o.key });
    } else if (type === 3) { startLevel(g, g.level + 1); g.happened.push({ type: 'level' }); }
  }
}

// The first thing the hook runs into moving along its line from `from` to `to`
// (out or back), checked along the whole stretch, so nothing is skipped.
function firstHit(g, from, to) {
  const h = g.hook, s = dsin(h.a), c = dcos(h.a), out = to > from;
  const lo = out ? from : to, hi = out ? to : from;
  let hit = null, best = out ? Infinity : -Infinity;
  for (const it of g.items) {
    const px = it.x - PIVOT.x, py = it.y - PIVOT.y, m = it.r + HOOK_R;
    const mid = px * s + py * c, ox = px - s * mid, oy = py - c * mid, off2 = ox * ox + oy * oy;
    if (off2 > m * m) continue;
    const enter = mid - Math.sqrt(m * m - off2), leave = mid + Math.sqrt(m * m - off2);
    if (leave < lo || enter > hi) continue;
    // where along the way it's touched first: going out the nearest, coming back the farthest
    const at = out ? Math.max(enter, lo) : Math.min(leave, hi);
    if (out ? at < best : at > best) { best = at; hit = it; }
  }
  return hit;
}
// A cast has stopped (it caught something, or ran out of water): the shy fish
// near the line bolt away from it, to whichever side they're on.
function spook(g) {
  const h = g.hook, s = dsin(h.a), c = dcos(h.a);
  let n = 0;
  for (const it of g.items) {
    if (!KINDS[it.kind].shy) continue;
    const px = it.x - PIVOT.x, py = it.y - PIVOT.y, mid = px * s + py * c;
    if (mid < 0 || mid > h.len + SPOOK.near) continue;
    const ox = px - s * mid, oy = py - c * mid, m = SPOOK.near + it.r;
    if (ox * ox + oy * oy > m * m) continue;
    const speed = it.vx < 0 ? -it.vx : it.vx;
    it.vx = ox < 0 ? -speed : speed;
    it.dart = SPOOK.ticks;
    n++;
  }
  if (n) g.happened.push({ type: 'spook', n });
}
// A mine goes off: everything within the blast is gone (other mines go off in
// turn), nothing is paid, and the reel is dazed for a moment.
function explode(g, mine) {
  const h = g.hook, fuse = [mine];
  g.items = g.items.filter(o => o !== mine);
  while (fuse.length) {
    const m = fuse.pop(), gone = [];
    g.items = g.items.filter(o => {
      const dx = o.x - m.x, dy = o.y - m.y, d = BLAST + o.r;
      if (dx * dx + dy * dy > d * d) return true;
      gone.push({ kind: o.kind, x: o.x, y: o.y, r: o.r });
      if (o.kind === 'mine') fuse.push(o);
      return false;
    });
    g.happened.push({ type: 'boom', x: m.x, y: m.y, gone });
  }
  const first = !g.caught.mine;
  g.caught.mine = (g.caught.mine || 0) + 1;
  if (first) g.happened.push({ type: 'first', kind: 'mine' });
  h.item = null; h.state = 'back'; h.stun = DAZE; h.bare = true;
}
function hookIt(g, it) {
  const h = g.hook;
  spook(g);
  if (it.kind === 'mine') { explode(g, it); return; }
  g.items = g.items.filter(o => o !== it);
  h.item = it; h.state = 'back';
  if (it.kind === 'jelly') h.stun = STING;
  g.happened.push({ type: 'hook', kind: it.kind });
}

// One tick: this tick's inputs, then everything moves.
export function step(g, events) {
  g.happened = [];
  if (g.over) return;
  for (const e of events) { if (!g.over) apply(g, e); }
  if (g.over) return;
  g.tick++;
  if (g.phase === 'play') {
    const h = g.hook, prey = h.state === 'back' && h.item && KINDS[h.item.kind].prey ? h.item : null;
    for (const it of g.items) {
      if (!it.vx) continue;
      if (KINDS[it.kind].walk) {
        // a crab scuttles along the seabed in fits and starts, and turns round
        // at the edges and at whatever lies in its way
        if (dsin(it.ph + g.tick * 0.045) > -0.25) {
          const x = it.x + it.vx;
          const blocked = x < it.r + 6 || x > W - it.r - 6 || g.items.some(o => {
            if (o === it || o.vx) return false;
            const dx = o.x - x, dy = o.y - it.y, m = o.r + it.r;
            return dx * dx + dy * dy < m * m;
          });
          if (blocked) it.vx = -it.vx; else it.x = x;
        }
        continue;
      }
      // the fish swim across (out one side, back in the other) and bob up and down
      if (it.dart > 0) { it.x += it.vx * SPOOK.speed; it.dart--; }
      else if (it.kind === 'shark') {
        // a shark charges at a hooked fish in front of it
        const ahead = prey ? (prey.x - it.x) * (it.vx < 0 ? -1 : 1) : -1, dy = prey ? prey.y - it.y : 0;
        it.rush = ahead > 0 && ahead < LUNGE.far && dy < LUNGE.tall && dy > -LUNGE.tall;
        it.x += it.rush ? it.vx * LUNGE.speed : it.vx;
      } else it.x += it.vx;
      const edge = it.r + 12;
      if (it.x > W + edge) it.x = -edge; else if (it.x < -edge) it.x = W + edge;
      it.y = it.y0 + KINDS[it.kind].bob * dsin(it.ph + g.tick * 0.05);
    }
    if (h.state === 'swing') {
      h.phase = (h.phase + 1) % SWING.period;
      h.a = SWING.max * dsin(2 * PI * h.phase / SWING.period);
    } else if (h.state === 'out') {
      const from = h.len;
      h.len += CAST;
      const hit = firstHit(g, from, h.len);
      const [tx, ty] = tipOf(h);
      if (hit) hookIt(g, hit);
      else if (tx < 0 || tx > W || ty > H) { h.state = 'back'; spook(g); g.happened.push({ type: 'miss' }); }
    } else if (h.stun > 0) {
      h.stun--; // stung or dazed: the reel doesn't turn
    } else if (h.state === 'back') {
      const from = h.len;
      h.len -= h.item ? pullSpeed(g, h.item) : PULL;
      // coming back empty (a miss, or cut loose), the hook still catches what it runs into
      if (!h.item && !h.bare) { const hit = firstHit(g, from, Math.max(h.len, ROPE0)); if (hit) hookIt(g, hit); }
      if (h.len <= ROPE0) {
        h.len = ROPE0; h.state = 'swing'; h.bare = false;
        if (h.item) { landIt(g, h.item); h.item = null; }
      } else if (h.item) {
        // the catch hangs just under the hook
        const d = h.len + h.item.r * 0.7;
        h.item.x = PIVOT.x + dsin(h.a) * d; h.item.y = PIVOT.y + dcos(h.a) * d;
      }
    }
    // a shark takes a fish off the hook as it passes its mouth; the line comes back slack
    if (h.state === 'back' && h.item && KINDS[h.item.kind].prey) {
      const reach = BITE + h.item.r * 0.5;
      for (const sh of g.items) {
        if (sh.kind !== 'shark') continue;
        const [mx, my] = mouthOf(sh), dx = h.item.x - mx, dy = h.item.y - my;
        if (dx * dx + dy * dy > reach * reach) continue;
        g.happened.push({ type: 'bite', kind: h.item.kind, x: h.item.x, y: h.item.y, by: sh.id });
        h.item = null; h.stun = 0; h.bare = true;
        break;
      }
    }
    g.left--;
    // out of time, or nothing left to catch: the level's over
    if (g.left <= 0 || (!g.items.length && h.state === 'swing')) endLevel(g);
  }
  if (!g.over && g.tick >= MAX_TICKS) finish(g, 'time');
}
