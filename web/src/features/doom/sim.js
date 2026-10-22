// 末日小队: the whole game as a simulation stepped 60 times a second — a
// small take on the "number gate" zombie shooters (向末日开炮 and the like),
// with everything drawn and written here. Like 躲技能 (dodge/sim.js) it's
// seeded and only uses + - * / and sqrt, so the same seed and inputs always
// play out the same way: the browser plays it, and the server replays the
// inputs for the score (verify.js); a best run can be watched again.
//
// A squad runs up a road firing on its own; you only steer it left and right.
// Gates come down the road in pairs — walk through one: +N soldiers, ×2 (only
// while the squad is small), −N (shoot a red gate enough and it turns good),
// or faster fire. The run is in 关 (levels): four 小关 (waves of zombies that
// walk at the squad and bite soldiers off when they reach it), then the 大关:
// a 尸王 that walks down to the line in exactly 20 seconds and wipes the squad
// if it gets there — a DPS check. After each 小关 you pick a small upgrade (one
// of three); after each 大关, a big one: a new weapon (霰弹枪 / 火箭筒 / 激光枪 /
// 狙击枪) or a big boost. The run ends when no one is left; the score is the
// zombies killed (bigger ones count more, a 尸王 50 × the level).
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
export const START = { count: 5 };
export const STEER = 5;                      // px a tick toward where you point
export const ROAD_SPEED = 1.5;               // gates come down this fast
export const STAGES = 5;                     // a level: four 小关, then the 大关 (the 尸王)
export const BOSS_SECONDS = 20;              // the 尸王 reaches the line this long after it shows up
export const SIM_VERSION = 2;                // 2: levels, the 尸王 DPS check, small and big upgrades, weapons

export const levelOf = wave => Math.ceil(wave / STAGES);
export const stageOf = wave => ((wave - 1) % STAGES) + 1; // STAGES = the 大关
export const isBossWave = wave => stageOf(wave) === STAGES;

// The zombies: hp is the first-wave value (it grows every wave, toughness()),
// bite = soldiers it takes if it reaches the squad (× the level), steer = how
// hard it turns toward the squad. The 尸王's hp is bossHp(level).
export const ZOMBIES = {
  walker: { label: '丧尸', r: 10, hp: 4, speed: 0.9, bite: 1, steer: 0.25, points: 1 },
  runner: { label: '跑尸', r: 8, hp: 2.2, speed: 1.9, bite: 1, steer: 0.5, points: 2 },
  tank: { label: '胖子', r: 17, hp: 20, speed: 0.55, bite: 5, steer: 0.12, points: 6 },
  boss: { label: '尸王', r: 34, hp: 0, speed: 0, bite: 0, steer: 0, points: 0 },
};

// The weapons (a big upgrade switches to one). Firepower per second is the
// squad's (3 × √soldiers × damage bonus) × mult; how it's delivered differs.
export const WEAPONS = {
  rifle: { label: '步枪', emoji: '🔫', interval: 12, speed: 11, mult: 1, note: '起手的枪，一排一起打' },
  shotgun: { label: '霰弹枪', emoji: '🪭', interval: 22, speed: 10, mult: 1.25, pellets: 6, range: 260, note: '一次打出一扇，近处很狠，远了打不到' },
  rocket: { label: '火箭筒', emoji: '🚀', interval: 34, speed: 8, mult: 0.8, splash: 44, note: '打中就炸一片，专治成群的' },
  laser: { label: '激光枪', emoji: '🔆', interval: 6, speed: 16, mult: 0.55, pierce: 8, note: '一路穿过去，一条线上的都打到' },
  sniper: { label: '狙击枪', emoji: '🎯', interval: 40, speed: 20, mult: 1.6, crit: 0.25, note: '一枪一个，打尸王最好用' },
};

// Small upgrades (after a 小关) and big ones (after a 大关); each while below its max.
export const PERKS = [
  { key: 'rate', size: 'small', emoji: '🔥', label: '射速 +10%', tip: '开火快一点', max: 12 },
  { key: 'dmg', size: 'small', emoji: '💥', label: '伤害 +12%', tip: '每发痛一点', max: 15 },
  { key: 'men', size: 'small', emoji: '🪖', label: '援军 +4', tip: '马上多 4 个人', max: 99 },
  { key: 'crit', size: 'small', emoji: '⚡', label: '暴击 +8%', tip: '有机会打出双倍', max: 5 },
  { key: 'shield', size: 'small', emoji: '🛡️', label: '护盾 +2', tip: '挡住 2 次被咬（尸王挡不住）', max: 99 },
  ...Object.entries(WEAPONS).filter(([k]) => k !== 'rifle').map(([k, w]) => ({ key: 'w:' + k, size: 'big', emoji: w.emoji, label: '换' + w.label, tip: w.note, max: 1, weapon: k })),
  { key: 'wup', size: 'big', emoji: '⬆️', label: '武器强化 +40%', tip: '手上这把伤害大涨', max: 6 },
  { key: 'mortar', size: 'big', emoji: '💣', label: '迫击炮', tip: '每隔几秒炸最近的一群', max: 3 },
  { key: 'spread', size: 'big', emoji: '🔱', label: '散射 +2', tip: '每轮多两发斜着打的', max: 3 },
  { key: 'pierce', size: 'big', emoji: '🏹', label: '穿透 +1', tip: '子弹多穿过一只', max: 3 },
];
export const PERK = Object.fromEntries(PERKS.map(p => [p.key, p]));

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
const powi = (b, n) => { let g = 1; for (let i = 0; i < n; i++) g *= b; return g; }; // (no Math.pow)
// how much tougher zombies are on wave k (all waves counted)
export const GROWTH = 1.2;
export const toughness = k => powi(GROWTH, k - 1);
// the 尸王's hp on level L: the DPS check is this over BOSS_SECONDS
export const BOSS_HP = 600, BOSS_GROWTH = 2.15;
export const bossHp = L => BOSS_HP * powi(BOSS_GROWTH, L - 1);
// how wide the squad is (soldiers stand in a loose block)
export const spanOf = count => (count <= 0 ? 0 : Math.min(150, 14 + 7 * Math.sqrt(count)));
// the squad's firepower a second, before how the weapon delivers it
export const firepower = g => 3 * Math.sqrt(g.squad.count) * g.stats.dmg * (1 + 0.4 * g.stats.wup) * 5 * g.stats.rate * WEAPONS[g.stats.weapon].mult;

export function newGame(seed) {
  const g = {
    seed: seed >>> 0, rand: rng(seed), tick: 0, phase: 'play', over: false, end: null,
    wave: 0, score: 0, kills: 0, dealt: 0, offers: null, picks: {},
    squad: { x: 180, tx: 180, count: START.count, shield: 0, cd: 0 },
    stats: { rate: 1, dmg: 1, crit: 0, pierce: 0, spread: 0, mortar: 0, wup: 0, weapon: 'rifle' }, mortarCd: 0,
    zombies: [], bullets: [], gates: [], queue: [], nextId: 1, waveTick: 0, pendingGateAt: null, happened: [],
  };
  startWave(g);
  return g;
}

// ---- a wave: who comes, when and where; a pair of gates first ----
function startWave(g) {
  g.wave++;
  const k = g.wave, L = levelOf(k), s = stageOf(k), R = g.rand, tough = toughness(k);
  const queue = [];
  if (s === STAGES) {
    // the 大关: the 尸王 (straight down the middle, can't be dodged) and a few to keep you busy
    queue.push({ at: 60, kind: 'boss' });
    const n = 4 + 2 * L;
    for (let i = 0; i < n; i++) queue.push({ at: 120 + Math.floor((i / n) * 9 * HZ + R() * 30), kind: R() < 0.5 ? 'runner' : 'walker' });
    g.pendingGateAt = null;
  } else {
    const n = Math.min(60, 8 + 2 * s + 5 * (L - 1));
    const span = Math.min(24, 10 + s + 2 * (L - 1)) * HZ;
    const tanks = L >= 2 || s === 4 ? Math.min(0.25, 0.06 + 0.03 * L) : 0, runners = s >= 3 || L >= 2 ? Math.min(0.5, 0.25 + 0.05 * L) : 0;
    for (let i = 0; i < n; i++) {
      const r = R();
      queue.push({ at: Math.floor((i / n) * span + R() * 40), kind: r < tanks ? 'tank' : r < tanks + runners ? 'runner' : 'walker' });
    }
    g.pendingGateAt = s >= 2 ? Math.floor(span * 0.5) : null;
  }
  queue.sort((a, b) => a.at - b.at);
  g.queue = queue.map(q => ({ ...q, tough, level: L }));
  g.waveTick = 0;
  g.phase = 'play';
  g.offers = null;
  addGates(g, -40);
}

// A pair of gates across the road: mostly one good and one bad, sometimes both
// good; the bad one can be shot until it turns good. ×2 only while the squad is
// small (a big squad gets +5 instead). Bigger numbers each level.
function addGates(g, y) {
  const R = g.rand, L = levelOf(g.wave), mid = (ROAD[0] + ROAD[1]) / 2;
  const good = () => {
    const r = R();
    if (r < 0.1) return g.squad.count <= 20 ? { kind: 'mul', v: 2 } : { kind: 'add', v: 5 };
    if (r < 0.25) return { kind: 'rate', v: 5 + 5 * Math.floor(R() * 2) };
    return { kind: 'add', v: 1 + Math.floor(R() * (2 + L)) };
  };
  const bad = () => ({ kind: 'add', v: -(2 + Math.floor(R() * (3 + 2 * L))), shoot: true });
  const pair = R() < 0.15 ? [good(), good()] : R() < 0.5 ? [good(), bad()] : [bad(), good()];
  g.gates.push({ y, passed: false, gates: [{ x0: ROAD[0], x1: mid, ...pair[0] }, { x0: mid, x1: ROAD[1], ...pair[1] }] });
}

// After a 小关: three small upgrades. After a 大关: three big ones, at least one a weapon.
function offerPerks(g) {
  const R = g.rand, big = isBossWave(g.wave), s = g.stats;
  const open = PERKS.filter(p => p.size === (big ? 'big' : 'small') && (g.picks[p.key] || 0) < p.max && p.weapon !== s.weapon);
  const offers = [];
  if (big) {
    const weapons = open.filter(p => p.weapon);
    if (weapons.length) { const w = weapons[Math.floor(R() * weapons.length)]; offers.push(w.key); open.splice(open.indexOf(w), 1); }
  }
  while (offers.length < 3 && open.length) offers.push(open.splice(Math.floor(R() * open.length), 1)[0].key);
  g.offers = offers;
  g.offerSize = big ? 'big' : 'small';
  g.phase = 'pick';
  g.happened.push({ type: 'wave', wave: g.wave, big });
}
function takePerk(g, key) {
  const s = g.stats, p = PERK[key];
  g.picks[key] = (g.picks[key] || 0) + 1;
  // bonuses add up (not multiply), so the zombies' growth wins in the end
  if (p.weapon) s.weapon = p.weapon;
  else if (key === 'rate') s.rate += 0.1;
  else if (key === 'dmg') s.dmg += 0.12;
  else if (key === 'men') g.squad.count = Math.min(MAX_SQUAD, g.squad.count + 4);
  else if (key === 'crit') s.crit += 0.08;
  else if (key === 'shield') g.squad.shield += 2;
  else if (key === 'wup') s.wup++;
  else if (key === 'mortar') s.mortar++;
  else if (key === 'spread') s.spread++;
  else if (key === 'pierce') s.pierce++;
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

// The squad's volley, by weapon. Every weapon carries the same firepower a
// second (× its mult): fewer, bigger shots for the slow ones.
function volley(g) {
  const sq = g.squad, s = g.stats, R = g.rand, Wp = WEAPONS[s.weapon];
  const span = spanOf(sq.count);
  const total = 3 * Math.sqrt(sq.count) * s.dmg * (1 + 0.4 * s.wup) * (Wp.interval / 12) * Wp.mult;
  const shot = (x, vx, dmg, extra) => {
    const crit = R() < s.crit + (Wp.crit || 0);
    g.bullets.push({ x, y: SQUAD_Y - 16, vx, speed: Wp.speed, dmg: crit ? dmg * 2 : dmg, crit, pierce: s.pierce + (Wp.pierce || 0), kind: s.weapon, ...extra });
  };
  if (s.weapon === 'shotgun') {
    const n = Wp.pellets + 2 * s.spread, ttl = Math.floor(Wp.range / Wp.speed);
    for (let i = 0; i < n; i++) shot(sq.x, (i / (n - 1) - 0.5) * (5 + s.spread), total / n, { ttl });
  } else if (s.weapon === 'rocket') {
    const n = 2 + s.spread;
    for (let i = 0; i < n; i++) shot(sq.x + (n > 1 ? (i / (n - 1) - 0.5) * span * 0.6 : 0), (i / Math.max(1, n - 1) - 0.5) * s.spread * 0.8, total / n, { splash: Wp.splash, pierce: 0 });
  } else if (s.weapon === 'sniper') {
    shot(sq.x, 0, total);
    for (let k = 1; k <= s.spread; k++) { shot(sq.x, -1.2 * k, total * 0.25); shot(sq.x, 1.2 * k, total * 0.25); }
  } else {
    const streams = Math.min(sq.count, s.weapon === 'laser' ? 4 : 8);
    for (let i = 0; i < streams; i++) shot(sq.x + (streams > 1 ? (i / (streams - 1) - 0.5) * span * 0.8 : 0), 0, total / streams);
    for (let k = 1; k <= s.spread; k++) { shot(sq.x, -1.2 * k, total / streams * 0.5); shot(sq.x, 1.2 * k, total / streams * 0.5); }
  }
  g.happened.push({ type: 'shot', weapon: s.weapon });
}

function hurt(g, z, dmg) {
  if (z.hp <= 0) return;
  g.dealt += dmg < z.hp ? dmg : z.hp;
  z.hp -= dmg;
}
function kill(g, z) {
  g.score += z.kind === 'boss' ? 50 * levelOf(g.wave) : ZOMBIES[z.kind].points;
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
  const sq = g.squad, s = g.stats, L = levelOf(g.wave);
  g.waveTick++;

  // the squad steers
  const d = sq.tx - sq.x;
  sq.x += d > STEER ? STEER : d < -STEER ? -STEER : d;

  // zombies come in on their ticks; the 尸王 walks to the line in exactly BOSS_SECONDS
  while (g.queue.length && g.queue[0].at <= g.waveTick) {
    const q = g.queue.shift(), Z = ZOMBIES[q.kind];
    const boss = q.kind === 'boss';
    const r = Z.r, x = boss ? (ROAD[0] + ROAD[1]) / 2 : ROAD[0] + r + g.rand() * (ROAD[1] - ROAD[0] - 2 * r);
    const hp = boss ? bossHp(q.level) : Z.hp * q.tough;
    const speed = boss ? (SQUAD_Y + 2) / (BOSS_SECONDS * HZ) : Z.speed * (1 + 0.02 * (g.wave - 1));
    g.zombies.push({ id: g.nextId++, kind: q.kind, x, y: -r - 10, r, hp, max: hp, speed });
    if (boss) { g.boss = { id: g.nextId - 1, max: hp, at: g.tick }; g.happened.push({ type: 'boss' }); }
  }
  if (g.pendingGateAt !== null && g.waveTick >= g.pendingGateAt) { addGates(g, -40); g.pendingGateAt = null; }

  // fire
  sq.cd -= 1;
  if (sq.cd <= 0 && sq.count > 0) { sq.cd += Math.max(3, WEAPONS[s.weapon].interval / s.rate); volley(g); } // (at most 20 volleys a second)
  if (s.mortar) {
    g.mortarCd -= 1;
    if (g.mortarCd <= 0) {
      g.mortarCd = Math.floor(240 / (1 + 0.5 * (s.mortar - 1)));
      // the zombie nearest the squad gets a shell; everything close by is hit
      let target = null;
      for (const z of g.zombies) if (z.y > 0 && (!target || z.y > target.y)) target = z;
      if (target) {
        const dmg = 4 * s.dmg * (1 + 0.4 * s.wup) * Math.sqrt(sq.count + 4) * (1 + 0.5 * (s.mortar - 1));
        for (const z of g.zombies) {
          const dx = z.x - target.x, dy = z.y - target.y, m = 40 + z.r;
          if (dx * dx + dy * dy <= m * m) hurt(g, z, dmg);
        }
        g.happened.push({ type: 'mortar', x: target.x, y: target.y });
      }
    }
  }

  // bullets fly; a hit takes hp (and goes on through as many as it pierces;
  // a rocket goes off and hits everything around it)
  const out = [];
  for (const b of g.bullets) {
    const y0 = b.y;
    b.y -= b.speed; b.x += b.vx;
    let alive = b.y > -20 && b.x > -10 && b.x < W + 10 && (b.ttl === undefined || b.ttl-- > 0);
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
        if (dx > z.r + 2 || dx < -z.r - 2) continue;
        if (z.y + z.r < b.y || z.y - z.r > y0) continue; // swept: anywhere along this tick's path
        if (b.splash) {
          for (const o of g.zombies) {
            const ex = o.x - b.x, ey = o.y - z.y, m = b.splash + o.r;
            if (ex * ex + ey * ey <= m * m) hurt(g, o, b.dmg);
          }
          g.happened.push({ type: 'boom', x: b.x, y: z.y, small: true });
          alive = false; break;
        }
        hurt(g, z, b.dmg); z.hit = b;
        g.happened.push({ type: 'hit', x: b.x, y: z.y + z.r * 0.5, crit: b.crit });
        if (b.pierce-- <= 0) { alive = false; break; }
      }
    }
    if (alive) out.push(b);
  }
  g.bullets = out;

  // zombies walk at the squad; the dead fall; a zombie that reaches the squad
  // bites (× the level); the 尸王 reaching the line wipes the squad, wherever it is
  const live = [];
  const half = spanOf(sq.count) / 2;
  for (const z of g.zombies) {
    if (z.hp <= 0) { kill(g, z); if (z.kind === 'boss') g.boss = null; continue; }
    const Z = ZOMBIES[z.kind];
    z.y += z.speed;
    if (z.kind === 'boss') {
      if (z.y + z.r >= SQUAD_Y - 8) { sq.count = 0; sq.shield = 0; g.happened.push({ type: 'bite', kind: 'boss', x: z.x, y: z.y }); continue; }
      live.push(z); continue;
    }
    if (z.y > 140) { const dx = sq.x - z.x; z.x += dx > Z.steer ? Z.steer : dx < -Z.steer ? -Z.steer : dx; }
    if (z.y + z.r >= SQUAD_Y - 8 && z.y - z.r <= SQUAD_Y + 8 && z.x + z.r >= sq.x - half && z.x - z.r <= sq.x + half) {
      if (sq.shield > 0) sq.shield--;
      else sq.count = Math.max(0, sq.count - Z.bite * L);
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
  if (!g.queue.length && !g.zombies.length) { g.bullets = []; g.boss = null; offerPerks(g); }
}
