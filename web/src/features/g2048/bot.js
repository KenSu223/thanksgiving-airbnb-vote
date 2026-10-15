// PM 专属外挂：2048 的自动玩（授权和躲技能那边一样，见 worker/g2048/board.js 的 grants）。
//
// 思路是 expectimax 前瞻：自己这一步往四个方向各推演一遍，每走一步
// 服务器会在随机空格出新砖（九成 2、一成 4），所以推演里把「出砖」
// 当机会节点，按概率把空格的期望算平均；叶子的好坏主要用一块
// 「蛇形权重」盘面量——最大的砖钉在左上角、数值沿蛇形递减——再加
// 空格数和可合成对子的奖励。空格多时分支大只看 2 层，盘面挤了看
// 3 层，实测每步只要几毫秒、一局能走到 1024 上下（运气好到 2048）。
//
// 推演用的是下面这个不记 steps 的快速 slide（logic.js 的 move 要给
// 页面动画记每块砖的去向，推演里几十万次调用，记不起）；规则和
// logic.move 一模一样：每块砖一步只合一次。
//
// 外挂发出的就是游戏本来的 move 消息（多带一个 bot 标记），服务器
// 把这局记成外挂局，排行榜上这条纪录带 🤖，不会冒充手打成绩。
import { DIRS, canMove, empties, maxTile } from './logic.js';

// 每个方向的四条线（从墙边往里），和 logic.js 的 LINES 一样
const LINES = {
  left: [0, 1, 2, 3].map(r => [0, 1, 2, 3].map(c => r * 4 + c)),
  right: [0, 1, 2, 3].map(r => [3, 2, 1, 0].map(c => r * 4 + c)),
  up: [0, 1, 2, 3].map(c => [0, 1, 2, 3].map(r => r * 4 + c)),
  down: [0, 1, 2, 3].map(c => [3, 2, 1, 0].map(r => r * 4 + c)),
};

// 只算结果的 slide：{ grid, gained, moved }，不记 steps
function slide(grid, dir) {
  const out = new Array(16).fill(0);
  let gained = 0, moved = false;
  for (const line of LINES[dir]) {
    let at = 0, open = false;
    for (const from of line) {
      const v = grid[from];
      if (!v) continue;
      if (open && out[line[at - 1]] === v) {
        out[line[at - 1]] = v * 2; gained += v * 2; open = false; moved = true;
      } else {
        out[line[at]] = v; open = true;
        if (from !== line[at]) moved = true;
        at++;
      }
    }
  }
  return { grid: out, gained, moved };
}

// 蛇形权重（2 的幂次）：左上角最大，沿第一行递减、第二行反着回来……
const W = [
  15, 14, 13, 12,
  8, 9, 10, 11,
  7, 6, 5, 4,
  0, 1, 2, 3,
].map(n => 4 ** n);

// 盘面有多好：砖按权重摆得越顺越好；空格留得住才合得下去；
// 相邻的同值对子是下一步的合成机会，按砖面值给一点奖励。
export function evaluate(grid) {
  let s = 0, pairs = 0, empty = 0;
  for (let i = 0; i < 16; i++) {
    const v = grid[i];
    if (!v) { empty++; continue; }
    s += v * W[i];
    if (i % 4 < 3 && grid[i + 1] === v) pairs += v;
    if (i < 12 && grid[i + 4] === v) pairs += v;
  }
  return s + empty * 4096 + pairs * 32;
}

// 机会节点：服务器在随机空格出砖（2 占九成、4 占一成），取期望。
// 出砖就地改在盘面上、算完改回去（推演不改真实盘面，嵌套调用也是
// 先改后还原），省下每个节点两次拷贝。
function chance(grid, depth) {
  const free = empties(grid);
  if (!free.length) return search(grid, depth - 1);
  let sum = 0;
  for (const at of free) {
    grid[at] = 2; const v2 = search(grid, depth - 1);
    grid[at] = 4; const v4 = search(grid, depth - 1);
    grid[at] = 0;
    sum += 0.9 * v2 + 0.1 * v4;
  }
  return sum / free.length;
}

// 自己走一步的节点：depth 是还剩几步自己的步
function search(grid, depth) {
  if (depth <= 0 || !canMove(grid)) return evaluate(grid);
  let best = -Infinity;
  for (const dir of DIRS) {
    const r = slide(grid, dir);
    if (r.moved) best = Math.max(best, chance(r.grid, depth));
  }
  return best;
}

// 给一盘面挑方向：返回 'left' / 'up' / …，没地方走返回 null。
// depth 不传就按空格多少自己定（多看 2 层、挤了看 3 层）。
export function plan2048(grid, depth) {
  if (!canMove(grid)) return null;
  const d = depth ?? (empties(grid).length <= 6 ? 3 : 2);
  let best = -Infinity, pick = null;
  for (const dir of DIRS) {
    const r = slide(grid, dir);
    if (!r.moved) continue;
    // 这步合出来的分也算一点，免得推演深度外的合成看不见
    const v = chance(r.grid, d) + r.gained * maxTile(grid);
    if (v > best) { best = v; pick = dir; }
  }
  return pick;
}
