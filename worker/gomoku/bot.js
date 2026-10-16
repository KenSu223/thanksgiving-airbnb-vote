// The 五子棋 bot (🤖, and 托管 / a timed-out turn for a person): one move of
// look-ahead with pattern scoring, no search tree. For every empty point near
// the stones it asks "what would a stone here make, for me and for them?" —
// line by line: five, open four, four, open three, three, open two, two — and
// plays, in this order: its own five; a block of their five; its own open four
// (or two fours); its own four + open three; a block of their open three (their
// open four next); its own double open three; a block of their four-three /
// double-three point; else the best mix of attack and defence. It answers in a
// few milliseconds and sees no forced sequences (连续冲四) coming, so a person
// who builds a fork two moves ahead beats it.
import { SIZE, CELLS, CENTER, DIRS, inBoard } from './rules.js';

// What one line makes (the 9 points centred on the stone, the stone counted as ours)
const FIVE = 7, LIVE4 = 6, FOUR = 5, LIVE3 = 4, THREE = 3, LIVE2 = 2, TWO = 1;

// L: 9 points, 0 empty / 1 ours / 2 theirs or off the board. How many different
// empty points finish five in a window of 5 through the centre; -1 when it is five.
function fours(L) {
  let a = -1, n = 0;
  for (let s = 0; s <= 4; s++) {
    let own = 0, gap = -1, open = true;
    for (let k = s; k < s + 5; k++) {
      if (L[k] === 2) { open = false; break; }
      if (L[k] === 1) own++; else gap = k;
    }
    if (!open) continue;
    if (own === 5) return -1;
    if (own === 4 && gap !== a) { if (n === 0) a = gap; n++; if (n >= 2) return 2; }
  }
  return n;
}
// The line's shape: two points to finish = open four, one = four; a three is
// a line one more stone turns into a four (open three: into an open four), a
// two is one more stone from a three. depth: how many stones to look ahead.
function rank(L, depth) {
  const f = fours(L);
  if (f < 0) return FIVE;
  if (f >= 2) return LIVE4;
  if (f === 1) return FOUR;
  if (!depth) return 0;
  let best = 0;
  for (let k = 0; k < 9 && best < LIVE3; k++) {
    if (L[k] !== 0) continue;
    L[k] = 1;
    best = Math.max(best, rank(L, depth - 1) - 2);
    L[k] = 0;
  }
  return best;
}
// The same 9-point line comes up again and again: remember each one (3^9 of them).
const memo = new Int8Array(19683).fill(-1);
const L = new Array(9);

// What a `color` stone at `at` makes: how many of its four lines are of each shape.
export function shapes(stones, at, color) {
  const counts = [0, 0, 0, 0, 0, 0, 0, 0];
  const r0 = Math.floor(at / SIZE), c0 = at % SIZE;
  for (const [dr, dc] of DIRS) {
    let code = 0;
    for (let k = -4, m = 1; k <= 4; k++, m *= 3) {
      const r = r0 + dr * k, c = c0 + dc * k;
      const v = k === 0 ? 1 : !inBoard(r, c) ? 2 : stones[r * SIZE + c] === color ? 1 : stones[r * SIZE + c] ? 2 : 0;
      L[k + 4] = v; code += v * m;
    }
    if (memo[code] < 0) memo[code] = rank(L, 2);
    counts[memo[code]]++;
  }
  return counts;
}
// The four lines together: a tier (5 five, 4 a four that can't be stopped — open
// four or two fours, 3 four + open three, 2 two open threes, 0 less) and a score.
export function judge(c) {
  if (c[FIVE]) return { tier: 5, score: 1e6 };
  if (c[LIVE4] || c[FOUR] >= 2) return { tier: 4, score: 1e5 };
  if (c[FOUR] && c[LIVE3]) return { tier: 3, score: 3e4 };
  if (c[LIVE3] >= 2) return { tier: 2, score: 1e4 };
  return { tier: 0, score: c[FOUR] * 900 + c[LIVE3] * 1000 + c[THREE] * 150 + c[LIVE2] * 120 + c[TWO] * 20 };
}

// Empty points within two of a stone (where anything happens), with how many
// stones touch each one.
function candidates(stones) {
  const out = [];
  for (let at = 0; at < CELLS; at++) {
    if (stones[at]) continue;
    const r0 = Math.floor(at / SIZE), c0 = at % SIZE;
    let near = 0, touch = 0;
    for (let r = r0 - 2; r <= r0 + 2; r++) {
      for (let c = c0 - 2; c <= c0 + 2; c++) {
        if (!inBoard(r, c) || !stones[r * SIZE + c]) continue;
        near++;
        if (Math.abs(r - r0) <= 1 && Math.abs(c - c0) <= 1) touch++;
      }
    }
    if (near) out.push({ at, touch });
  }
  return out;
}

// The bot's move for `color` (1 黑 / 2 白); -1 when the board is full.
export function pickMove(stones, color, rand = Math.random) {
  const opp = color === 1 ? 2 : 1;
  if (!stones.some(Boolean)) return CENTER;
  const cands = candidates(stones);
  if (!cands.length) return stones.findIndex(v => !v);
  const rows = cands.map(({ at, touch }) => {
    const r = Math.floor(at / SIZE), c = at % SIZE;
    return { at, touch, a: judge(shapes(stones, at, color)), d: judge(shapes(stones, at, opp)),
      mid: 7 - Math.max(Math.abs(r - 7), Math.abs(c - 7)), jitter: rand() };
  });
  const best = (list, value) => list.reduce((b, x) => (value(x) > value(b) ? x : b)).at;
  const both = x => x.a.score + x.d.score + x.mid + x.jitter;
  // the forcing moves first: win, don't lose, then the strongest threat or block
  for (const want of [x => x.a.tier === 5, x => x.d.tier === 5, x => x.a.tier === 4, x => x.a.tier === 3,
    x => x.d.tier === 4, x => x.a.tier === 2, x => x.d.tier >= 2]) {
    const hit = rows.filter(want);
    if (hit.length) return best(hit, both);
  }
  // nothing forcing: attack a little over defence, stay close to the stones and
  // the centre; any of the moves about as good as the best will do, so games
  // differ (more choice in the opening)
  const value = x => x.a.score * 1.1 + x.d.score + x.touch * 10 + x.mid;
  const top = Math.max(...rows.map(value)), margin = stones.filter(Boolean).length < 8 ? 8 : 3;
  const pool = rows.filter(x => value(x) >= top - margin);
  return pool[Math.floor(rand() * pool.length)].at;
}
