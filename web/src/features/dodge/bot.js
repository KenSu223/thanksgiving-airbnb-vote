// PM 专属外挂：鲁班躲技能的自动走位。
//
// 思路是前瞻规划（每一 tick 重算）：场上所有技能都是先预警再触发、
// 弹道在出手那刻就锁定了，所以每个技能未来 0.7 秒的危险区都能精确
// 算出来。机器人每 tick 把"原地 + 16 个方向 × 3 档距离"的候选落点
// 逐个往前推演（按英雄自己的移速走过去，逐步查碰撞），挑活得最久、
// 余量最大的那个走；走位实在活不下去且闪现好了，就朝推演过最安全
// 的方向闪现。发出的全是游戏本来的输入事件（点地移动 / 闪现），
// 不碰模拟状态 — 成绩就是真存活时长。
//
// 新技能在推演窗口外生成也没关系：它们至少有 ~15 tick 预警，且锁定的
// 是生成那刻的位置，下一 tick 就会进入威胁模型。
import { W, H, HERO, DIR, headOf } from './sim.js';

const MARGIN = 10;   // 每个命中半径外加的安全垫（吸收推演与真实扫掠判定的一 tick 误差）
const HORIZON = 60;  // 前瞻 tick 数（1 秒）— 短了看不见正在合拢的包围圈
const FLASH_MIN = 24; // 闪现落点至少要能活这么久才值得交

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// 点到线段的距离
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
  const ex = ax + dx * t - px, ey = ay + dy * t - py;
  return Math.sqrt(ex * ex + ey * ey);
}

// 线段到线段的距离（相交 = 0）。模拟的扫掠判定看的是相对运动 —
// 英雄这一 tick 的位移线段和弹头这一 tick 的位移线段 — 只拿英雄
// 的落点去量弹道会漏掉"斜穿弹头鼻子"那种擦碰，必须同口径。
function segSegDist(ax, ay, bx, by, cx, cy, dx, dy) {
  const r = [bx - ax, by - ay], s = [dx - cx, dy - cy];
  const denom = r[0] * s[1] - r[1] * s[0];
  if (denom !== 0) {
    const t = ((cx - ax) * s[1] - (cy - ay) * s[0]) / denom;
    const u = ((cx - ax) * r[1] - (cy - ay) * r[0]) / denom;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;
  }
  return Math.min(
    segDist(ax, ay, cx, cy, dx, dy), segDist(bx, by, cx, cy, dx, dy),
    segDist(cx, cy, ax, ay, bx, by), segDist(dx, dy, ax, ay, bx, by));
}

// 移动类技能的弹头在未来每个 tick 末的位置：heads[0] 是现在，
// heads[τ] 镜像 updateSkills 的推进（预警期不动、扇子到头折返、
// 到达射程尽头那一 tick 后消失 → 之后留 null）。
function projectHeads(g, s) {
  const heads = new Array(HORIZON + 1).fill(null);
  heads[0] = headOf(s);
  let d = s.d, back = s.back;
  for (let tau = 1; tau <= HORIZON; tau++) {
    if (g.tick + tau - s.t0 < s.warn) { heads[tau] = heads[tau - 1]; continue; }
    d = clamp(d + (back ? -s.speed : s.speed), 0, s.len);
    if (s.kind === 'fan' && !back && d >= s.len) back = true;
    heads[tau] = [s.x0 + s.dx * d, s.y0 + s.dy * d];
    if (s.kind === 'fan' ? (back && d <= 0) : d >= s.len) break;
  }
  return heads;
}

function threatOf(g, s) {
  if (s.kind === 'ice') return { kind: 'ice', s };
  if (s.kind === 'beam') return { kind: 'beam', s, bx: s.x0 + s.dx * s.len, by: s.y0 + s.dy * s.len };
  return { kind: 'shot', s, heads: projectHeads(g, s) };
}

// 英雄在未来第 tau tick 从 (px, py) 走到 (x, y) 的余量：离最近的
// 危险有多远（已减命中半径）。≤ MARGIN 视为会被打中。移动类技能
// 按模拟口径比两条位移线段的距离；冰圈/光束是静态判定，只看落点。
function clearanceAt(threats, tick, px, py, x, y, tau) {
  let best = Infinity;
  for (const t of threats) {
    const s = t.s, age = tick + tau - s.t0;
    if (t.kind === 'shot') {
      if (age < s.warn) continue;
      const a = t.heads[tau - 1], b = t.heads[tau];
      if (!a || !b) continue;
      const c = segSegDist(px, py, x, y, a[0], a[1], b[0], b[1]) - (s.r + HERO.r);
      if (c < best) best = c;
    } else {
      if (age < s.warn || age >= s.warn + s.live) continue;
      const c = t.kind === 'ice'
        ? Math.hypot(x - s.x, y - s.y) - (s.r + HERO.r * 0.5)
        : segDist(x, y, s.x0, s.y0, t.bx, t.by) - (s.r + HERO.r);
      if (c < best) best = c;
    }
    if (best <= MARGIN) break; // 已经注定挨打，精确余量没意义，省时间
  }
  return best;
}

// 离最近一堵墙的距离（截到 220）：开阔地带才有地方继续躲
const wallRoom = (x, y) => Math.min(x, W - x, y, H - y, 220);

// 从 (sx, sy) 以英雄移速走向 (tx, ty) 并逐步查碰撞：
// { survive: 第一个会挨打的 tick（走完窗口都没事 = horizon+1）, clear: 全程最小余量 }
function evalWalk(g, threats, sx, sy, tx, ty, horizon = HORIZON) {
  let x = sx, y = sy, clear = Infinity;
  // 威胁的弹头投影只算到 HORIZON — 窗口外改用最后一个已知弹头位
  // 置的静态判定（对复评足够了：要看的是落点在窗口外会不会立刻变陷阱）
  for (let tau = 1; tau <= horizon; tau++) {
    const px = x, py = y;
    const dx = tx - x, dy = ty - y, d = Math.hypot(dx, dy);
    if (d > 0) { const s = Math.min(HERO.speed, d); x += dx / d * s; y += dy / d * s; }
    const c = clearanceAt(threats, g.tick, px, py, x, y, Math.min(tau, HORIZON));
    if (c < clear) clear = c;
    if (c <= MARGIN) return { survive: tau, clear };
  }
  return { survive: horizon + 1, clear };
}

// 匀速直线走 (vx, vy) 并逐步查碰撞（贴墙时和模拟一样沿墙滑）。
// 躲横扫的大鸟/火球墙靠的是顺着弹道跑、贴着间隙穿 — 固定落点的
// 直线走位表达不了，所以候选路径里要有这一族。
function evalVelocity(g, threats, sx, sy, vx, vy, horizon = HORIZON) {
  let x = sx, y = sy, clear = Infinity;
  for (let tau = 1; tau <= horizon; tau++) {
    const px = x, py = y;
    x = clamp(x + vx, HERO.r, W - HERO.r);
    y = clamp(y + vy, HERO.r, H - HERO.r);
    const c = clearanceAt(threats, g.tick, px, py, x, y, Math.min(tau, HORIZON));
    if (c < clear) clear = c;
    if (c <= MARGIN) return { survive: tau, clear };
  }
  return { survive: horizon + 1, clear };
}

// 一 tick 的决策：{ move: [x, y] } 或 { flash: k } 或 {}（原地安全）。
export function planBot(g) {
  if (g.over || !g.skills.length) return {};
  const h = g.hero;
  const threats = g.skills.map(s => threatOf(g, s));
  const cands = [[h.x, h.y]];
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2, co = Math.cos(a), si = Math.sin(a);
    for (const r of [90, 180, 270]) {
      cands.push([clamp(h.x + co * r, HERO.r, W - HERO.r), clamp(h.y + si * r, HERO.r, H - HERO.r)]);
    }
  }
  // 打分：先比活得久，再比"余量 + 开阔度"。只比余量会贴着墙找缝 —
  // 技能全是冲着当前位置锁定的，贴墙又没退路，几波下来就被围死在
  // 墙角（实测三颗种子全死在墙边）。开阔度把机器人往场中间留。
  const score = r => Math.min(r.clear, 300) + wallRoom(r.x, r.y) * 0.5;
  let best = null;
  const top = []; // 前几名候选（带可重演的路径描述），给第二轮深看用
  const consider = (r, x, y, dist, redo) => {
    const cand = { ...r, x, y, dist, redo };
    if (!best || cand.survive > best.survive
      || (cand.survive === best.survive && (score(cand) > score(best) + 4 || (Math.abs(score(cand) - score(best)) <= 4 && dist < best.dist)))) {
      best = cand;
    }
    top.push(cand);
    top.sort((a, b) => (b.survive - a.survive) || (score(b) - score(a)));
    if (top.length > 5) top.length = 5;
  };
  for (const [cx, cy] of cands) {
    consider(evalWalk(g, threats, h.x, h.y, cx, cy), cx, cy, Math.hypot(cx - h.x, cy - h.y),
      horizon => evalWalk(g, threats, h.x, h.y, cx, cy, horizon));
  }
  // 匀速方向族：胜出时朝那个方向发一个 220 外的落点当移动目标
  //（每 tick 重规划，实际轨迹就是持续匀速）
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2, co = Math.cos(a), si = Math.sin(a);
    const tx = clamp(h.x + co * 220, HERO.r, W - HERO.r), ty = clamp(h.y + si * 220, HERO.r, H - HERO.r);
    consider(evalVelocity(g, threats, h.x, h.y, co * HERO.speed, si * HERO.speed), tx, ty, 220,
      horizon => evalVelocity(g, threats, h.x, h.y, co * HERO.speed, si * HERO.speed, horizon));
  }
  // 第二轮深看：60 tick 窗口里活满的候选彼此只差"余量+开阔"，但新一
  // 波技能是冲着你站的位置锁定的 — 窗口内最安全的地方，窗口外可能
  // 正是陷阱。把前几名按 96 tick 重演一遍：只有深窗里比当前赢家多
  // 活 6 tick 以上的候选才能翻盘（差不多就维持第一轮选择，不横跳）。
  if (best.survive > HORIZON) {
    const pool = top.includes(best) ? top : [...top, best];
    for (const cand of pool) cand.deep = cand.redo(HORIZON + 36).survive;
    const champ = pool.reduce((a, b) => (b.deep > a.deep ? b : a), best);
    if (champ !== best && champ.deep > best.deep + 12) best = champ;
  }
  // 走位快活不下去了才交闪现：落点不光当下安全，还要接着能走 —
  // 对每个方向推演"落在那儿再往最有活路的方向走"能活多久。
  if (best.survive <= 20 && h.cd === 0) {
    let fb = null;
    for (let k = 0; k < 32; k++) {
      const lx = clamp(h.x + DIR[k * 2][0] * HERO.flash, HERO.r, W - HERO.r);
      const ly = clamp(h.y + DIR[k * 2][1] * HERO.flash, HERO.r, H - HERO.r);
      let r = evalWalk(g, threats, lx, ly, lx, ly);
      for (let j = 0; j < 8; j++) {
        const a = (j / 8) * Math.PI * 2;
        const w = evalWalk(g, threats, lx, ly, clamp(lx + Math.cos(a) * 150, HERO.r, W - HERO.r), clamp(ly + Math.sin(a) * 150, HERO.r, H - HERO.r));
        if (w.survive > r.survive || (w.survive === r.survive && w.clear > r.clear)) r = w;
      }
      if (!fb || r.survive > fb.survive || (r.survive === fb.survive && r.clear > fb.clear)) fb = { ...r, k: k * 2 };
    }
    if (fb && fb.survive >= FLASH_MIN && fb.survive > best.survive + 4) return { flash: fb.k };
  }
  if (best.dist < 1) {
    // 原地最安全；但如果身上还挂着之前的点击目标，先把他停下来
    return h.mode ? { move: [Math.round(h.x), Math.round(h.y)] } : {};
  }
  return { move: [Math.round(best.x), Math.round(best.y)] };
}
