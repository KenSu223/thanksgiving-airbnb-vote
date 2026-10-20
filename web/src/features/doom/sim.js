// 末日小队: the whole game as a simulation stepped 60 times a second — a
// small take on the "number gate" zombie shooters (向末日开炮 and the like),
// with everything drawn and written here. Like 躲技能 (dodge/sim.js) it's
// seeded and only uses + - * / and sqrt, so the same seed and inputs always
// play out the same way: the browser plays it, and the server replays the
// inputs for the score (verify.js); a best run can be watched again.
//
// A squad runs up a road firing on its own; you only steer it left and right.
// Gates come down the road in pairs — walk through one: +N soldiers, ×2, −N
// (shoot a red gate enough and it turns good), or faster fire. Zombies come in
// waves and walk at the squad; one that reaches it bites soldiers off. After
// each wave you pick one of three upgrades for the rest of the run. Every 5th
// wave has a boss. The run ends when no one is left; the score is the zombies
// killed (bigger ones count more).
//
// Inputs are events [tick, type, a], applied at the start of that tick:
//   [t, 0, x]  steer toward x (0..W)
//   [t, 1, i]  take upgrade i (0..2) of the three offered
//   [t, 2]     end the run here (the score so far counts)
// Anything that doesn't fit the moment is ignored. Ticks keep going while the
// upgrades are offered, so a run's ticks are never more than the time it took.
export const HZ = 60;
export const W = 360, H = 600;
export const ROAD = [24, 336];               // the road's edges
export const SQUAD_Y = H - 84;               // where the squad runs
export const MAX_TICKS = 30 * 60 * HZ;       // a run stops after 30 minutes
export const MAX_SQUAD = 99;
export const START = { count: 5, interval: 12, dmg: 1 };
export const BULLET = { speed: 11, r: 2 };
export const STEER = 5;                      // px a tick toward where you point
export const ROAD_SPEED = 1.5;               // gates come down this fast
export const SIM_VERSION = 1;

// The zombies: hp is the wave-1 value (it grows 30% a wave), bite = soldiers
// it takes if it reaches the squad (more every 5 waves), steer = how hard it turns toward the squad.
export const ZOMBIES = {
  walker: { label: '丧尸', r: 10, hp: 3, speed: 0.9, bite: 1, steer: 0.25, points: 1 },
  runner: { label: '跑尸', r: 8, hp: 1.6, speed: 1.9, bite: 1, steer: 0.5, points: 2 },
  tank: { label: '胖子', r: 17, hp: 15, speed: 0.55, bite: 6, steer: 0.12, points: 6 },
  boss: { label: '尸王', r: 34, hp: 140, speed: 0.4, bite: 999, steer: 0.35, points: 40 },
};

// The three-pick upgrades (each can be offered while it's below its max)
export const PERKS = [
  { key: 'rate', emoji: '🔥', label: '射速 +20%', tip: '开火更快', max: 8 },
  { key: 'dmg', emoji: '💥', label: '伤害 +25%', tip: '每发子弹更痛', max: 10 },
  { key: 'men', emoji: '🪖', label: '援军 +6', tip: '马上多 6 个人', max: 99 },
  { key: 'pierce', emoji: '🎯', label: '穿透 +1', tip: '子弹多穿过一只', max: 3 },
  { key: 'spread', emoji: '🔱', label: '散射 +2', tip: '每轮多两发斜着打的', max: 3 },
  { key: 'crit', emoji: '⚡', label: '暴击 +15%', tip: '有机会打出双倍', max: 4 },
  { key: 'mortar', emoji: '💣', label: '迫击炮', tip: '每隔几秒炸最近的一群', max: 4 },
  { key: 'shield', emoji: '🛡️', label: '护盾 +3', tip: '挡住 3 次被咬', max: 99 },
];
const PERK = Object.fromEntries(PERKS.map(p => [p.key, p]));

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
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
// how much tougher zombies are on wave k: 1.3^(k-1), by multiplying (no Math.pow)
export function toughness(k) { let g = 1; for (let i = 1; i < k; i++) g *= 1.3; return g; }
// how wide the squad is (soldiers stand in a loose block)
export const spanOf = count => (count <= 0 ? 0 : Math.min(150, 14 + 7 * Math.sqrt(count)));

export function newGame(seed) {
  const g = {
    seed: seed >>> 0, rand: rng(seed), tick: 0, phase: 'play', over: false, end: null,
    wave: 0, score: 0, kills: 0, offers: null, picks: {},
    squad: { x: 180, tx: 180, count: START.count, shield: 0, cd: 0 },
    stats: { rate: 1, dmg: 1, pierce: 0, spread: 0, crit: 0, mortar: 0 }, mortarCd: 0,
    zombies: [], bullets: [], gates: [], queue: [], nextId: 1, waveTick: 0, happened: [],
  };
  startWave(g);
  return g;
}

// ---- a wave: who comes, when and where; a pair of gates first ----
function startWave(g) {
  g.wave++;
  const k = g.wave, R = g.rand, tough = toughness(k);
  const boss = k % 5 === 0;
  const n = Math.min(60, 6 + 2 * k);
  const span = Math.min(25, 9 + k * 0.5) * HZ;
  const queue = [];
  for (let i = 0; i < n; i++) {
    const r = R();
    const kind = k >= 4 && r < Math.min(0.2, 0.04 * (k - 3)) ? 'tank' : k >= 3 && r < 0.45 ? 'runner' : 'walker';
    queue.push({ at: Math.floor((i / n) * span + R() * 40), kind });
  }
  if (boss) queue.push({ at: Math.floor(span * 0.6), kind: 'boss' });
  queue.sort((a, b) => a.at - b.at);
  g.queue = queue.map(q => ({ ...q, tough }));
  g.waveTick = 0;
  g.phase = 'play';
  g.offers = null;
  addGates(g, -40);
  if (k >= 3) g.pendingGateAt = Math.floor(span * 0.5); else g.pendingGateAt = null;
}

// A pair of gates across the road. Mostly one good and one bad, sometimes both
// good; the bad one can be shot until it turns good. Bigger numbers later on.
function addGates(g, y) {
  const R = g.rand, k = g.wave, mid = (ROAD[0] + ROAD[1]) / 2;
  const good = () => {
    const r = R();
    if (k >= 2 && r < 0.1) return { kind: 'mul', v: 2 };
    if (r < 0.22) return { kind: 'rate', v: 5 + 5 * Math.floor(R() * 3) };
    return { kind: 'add', v: 1 + Math.floor(R() * (3 + k / 3)) };
  };
  const bad = () => ({ kind: 'add', v: -(3 + Math.floor(R() * (3 + k))), shoot: true });
  const pair = R() < 0.25 ? [good(), good()] : R() < 0.5 ? [good(), bad()] : [bad(), good()];
  g.gates.push({ y, passed: false, gates: [{ x0: ROAD[0], x1: mid, ...pair[0] }, { x0: mid, x1: ROAD[1], ...pair[1] }] });
}

function offerPerks(g) {
  const R = g.rand, open = PERKS.filter(p => (g.picks[p.key] || 0) < p.max), offers = [];
  while (offers.length < 3 && open.length) offers.push(open.splice(Math.floor(R() * open.length), 1)[0].key);
  g.offers = offers;
  g.phase = 'pick';
  g.happened.push({ type: 'wave', wave: g.wave });
}
function takePerk(g, key) {
  const s = g.stats;
  g.picks[key] = (g.picks[key] || 0) + 1;
  // bonuses add up (not multiply), so the zombies' 30% a wave wins in the end
  if (key === 'rate') s.rate += 0.2;
  else if (key === 'dmg') s.dmg += 0.25;
  else if (key === 'men') g.squad.count = Math.min(MAX_SQUAD, g.squad.count + 6);
  else if (key === 'pierce') s.pierce++;
  else if (key === 'spread') s.spread++;
  else if (key === 'crit') s.crit += 0.15;
  else if (key === 'mortar') s.mortar++;
  else if (key === 'shield') g.squad.shield += 3;
  g.happened.push({ type: 'perk', key });
}

function finish(g, end) { g.over = true; g.phase = 'over'; g.end = end; }

function apply(g, e) {
  const [, type, a] = e;
  if (type === 2) { finish(g, 'quit'); return; }
  if (type === 0 && g.phase === 'play' && Number.isFinite(a)) g.squad.tx = clamp(a, ROAD[0] + 16, ROAD[1] - 16);
  else if (type === 1 && g.phase === 'pick' && g.offers && g.offers[a]) {
    takePerk(g, g.offers[a]);
    startWave(g);
  }
}

// the squad's volley: one bullet per stream (up to 8 across the block, each
// carrying its share of the squad's firepower), plus the spread shots. The
// firepower grows with the square root of the squad: more soldiers help, but a
// huge squad doesn't make the waves trivial.
function volley(g) {
  const sq = g.squad, s = g.stats, R = g.rand;
  const streams = Math.min(sq.count, 8), span = spanOf(sq.count);
  const total = START.dmg * s.dmg * 3 * Math.sqrt(sq.count);
  const per = total / streams;
  const shot = (x, vx, dmg) => {
    const crit = s.crit > 0 && R() < s.crit;
    g.bullets.push({ x, y: SQUAD_Y - 16, vx, dmg: crit ? dmg * 2 : dmg, crit, pierce: s.pierce });
  };
  for (let i = 0; i < streams; i++) shot(sq.x + (streams > 1 ? (i / (streams - 1) - 0.5) * span * 0.8 : 0), 0, per);
  for (let k = 1; k <= s.spread; k++) { shot(sq.x, -1.2 * k, per * 0.5); shot(sq.x, 1.2 * k, per * 0.5); }
  g.happened.push({ type: 'shot' });
}

function kill(g, z) {
  g.score += ZOMBIES[z.kind].points;
  g.kills++;
  g.happened.push({ type: 'kill', kind: z.kind, x: z.x, y: z.y });
}

// One tick: this tick's inputs, then everything moves.
export function step(g, events) {
  g.happened = [];
  if (g.over) return;
  for (const e of events) { if (!g.over) apply(g, e); }
  if (g.over) return;
  g.tick++;
  if (g.tick >= MAX_TICKS) { finish(g, 'time'); return; }
  if (g.phase !== 'play') return;
  const sq = g.squad, s = g.stats;
  g.waveTick++;

  // the squad steers
  const d = sq.tx - sq.x;
  sq.x += d > STEER ? STEER : d < -STEER ? -STEER : d;

  // zombies come in on their ticks
  while (g.queue.length && g.queue[0].at <= g.waveTick) {
    const q = g.queue.shift(), Z = ZOMBIES[q.kind];
    const r = Z.r, x = q.kind === 'boss' ? (ROAD[0] + ROAD[1]) / 2 : ROAD[0] + r + g.rand() * (ROAD[1] - ROAD[0] - 2 * r);
    const hp = Z.hp * q.tough;
    g.zombies.push({ id: g.nextId++, kind: q.kind, x, y: -r - 10, r, hp, max: hp, speed: Z.speed * (1 + 0.015 * (g.wave - 1)) }); // a little faster every wave
    if (q.kind === 'boss') g.happened.push({ type: 'boss' });
  }
  if (g.pendingGateAt !== null && g.waveTick >= g.pendingGateAt) { addGates(g, -40); g.pendingGateAt = null; }

  // fire
  sq.cd -= 1;
  if (sq.cd <= 0 && sq.count > 0) { sq.cd += Math.max(3, START.interval / s.rate); volley(g); } // (at most 20 volleys a second)
  if (s.mortar) {
    g.mortarCd -= 1;
    if (g.mortarCd <= 0) {
      g.mortarCd = Math.floor(240 / (1 + 0.5 * (s.mortar - 1)));
      // the zombie nearest the squad gets a shell; everything close by is hit
      let target = null;
      for (const z of g.zombies) if (z.y > 0 && (!target || z.y > target.y)) target = z;
      if (target) {
        const dmg = 4 * s.dmg * Math.sqrt(sq.count + 4) * (1 + 0.5 * (s.mortar - 1));
        for (const z of g.zombies) {
          const dx = z.x - target.x, dy = z.y - target.y, m = 40 + z.r;
          if (dx * dx + dy * dy <= m * m) z.hp -= dmg;
        }
        g.happened.push({ type: 'mortar', x: target.x, y: target.y });
      }
    }
  }

  // bullets fly; a hit takes hp (and goes on through as many as it pierces)
  const out = [];
  for (const b of g.bullets) {
    const y0 = b.y;
    b.y -= BULLET.speed; b.x += b.vx;
    let alive = b.y > -20 && b.x > -10 && b.x < W + 10;
    // gates: a shootable (bad) gate counts each hit up by one, and stops the bullet
    for (const row of g.gates) {
      if (!alive || row.passed || row.y < b.y - 12 || row.y > y0 + 12) continue;
      for (const gt of row.gates) {
        if (gt.shoot && b.x >= gt.x0 && b.x <= gt.x1) {
          gt.v += 1;
          if (gt.v > 0) gt.shoot = false; // it's good now
          alive = false;
          break;
        }
      }
    }
    if (alive) {
      for (const z of g.zombies) {
        if (z.hp <= 0 || z.hit === b) continue;
        const dx = b.x - z.x;
        if (dx > z.r + BULLET.r || dx < -z.r - BULLET.r) continue;
        if (z.y + z.r < b.y || z.y - z.r > y0) continue; // swept: anywhere along this tick's path
        z.hp -= b.dmg; z.hit = b;
        g.happened.push({ type: 'hit', x: b.x, y: z.y + z.r * 0.5, crit: b.crit });
        if (b.pierce-- <= 0) { alive = false; break; }
      }
    }
    if (alive) out.push(b);
  }
  g.bullets = out;

  // zombies walk at the squad; the dead fall; a zombie that reaches the squad bites
  const live = [];
  const half = spanOf(sq.count) / 2;
  for (const z of g.zombies) {
    if (z.hp <= 0) { kill(g, z); continue; }
    const Z = ZOMBIES[z.kind];
    z.y += z.speed;
    if (z.y > 140) { const dx = sq.x - z.x; z.x += dx > Z.steer ? Z.steer : dx < -Z.steer ? -Z.steer : dx; }
    if (z.y + z.r >= SQUAD_Y - 8 && z.y - z.r <= SQUAD_Y + 8 && z.x + z.r >= sq.x - half && z.x - z.r <= sq.x + half) {
      if (sq.shield > 0 && z.kind !== 'boss') sq.shield--;
      else sq.count = Math.max(0, sq.count - Z.bite * (1 + Math.floor((g.wave - 1) / 5)));
      g.happened.push({ type: 'bite', kind: z.kind, x: z.x, y: z.y });
      continue;
    }
    if (z.y - z.r > H) continue; // walked past
    live.push(z);
  }
  g.zombies = live;

  // gates come down the road; walking through one does what it says
  for (const row of g.gates) {
    row.y += ROAD_SPEED;
    if (!row.passed && row.y >= SQUAD_Y) {
      row.passed = true;
      const gt = row.gates.find(x => sq.x >= x.x0 && sq.x <= x.x1) || row.gates[0];
      const before = sq.count;
      if (gt.kind === 'add') sq.count = clamp(sq.count + gt.v, 0, MAX_SQUAD);
      else if (gt.kind === 'mul') sq.count = Math.min(MAX_SQUAD, sq.count * gt.v);
      else if (gt.kind === 'rate') s.rate += gt.v / 100;
      g.happened.push({ type: 'gate', kind: gt.kind, v: gt.v, gain: sq.count - before });
    }
  }
  g.gates = g.gates.filter(row => row.y < H + 40);

  if (sq.count <= 0) { finish(g, 'dead'); return; }
  // the wave is over when everyone has come and gone: pick an upgrade
  if (!g.queue.length && !g.zombies.length) { g.bullets = []; offerPerks(g); }
}
