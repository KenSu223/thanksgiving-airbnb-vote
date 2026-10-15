// 2048 的规则：服务器（worker/g2048/board.js）用它走每一步、出每一块新砖；
// 页面用它先把砖滑过去（不用等服务器），服务器的新砖到了再补上。
// 盘面是 16 个数（0 是空格），按行排：第 r 行第 c 列是 r * 4 + c。
export const SIZE = 4, GOAL = 2048;
export const DIRS = ['up', 'down', 'left', 'right'];

// 每个方向的四条线：每条线从墙边往里数的四个格子
const LINES = {
  left: [0, 1, 2, 3].map(r => [0, 1, 2, 3].map(c => r * SIZE + c)),
  right: [0, 1, 2, 3].map(r => [3, 2, 1, 0].map(c => r * SIZE + c)),
  up: [0, 1, 2, 3].map(c => [0, 1, 2, 3].map(r => r * SIZE + c)),
  down: [0, 1, 2, 3].map(c => [3, 2, 1, 0].map(r => r * SIZE + c)),
};

// 往 dir 滑一步（不出新砖）：{ grid, gained（这步合出来的分）, moved, steps: [{ from, to, merge }] }
// 每块砖一条 step；merge 是撞进已经停在 to 的那块、合成一块。一块砖一步只合一次（2 2 4 → 4 4，不是 8）。
export function move(grid, dir) {
  const out = new Array(SIZE * SIZE).fill(0), steps = [];
  let gained = 0, moved = false;
  for (const line of LINES[dir]) {
    let at = 0, open = false; // open：line[at - 1] 那块还能被合
    for (const from of line) {
      const v = grid[from];
      if (!v) continue;
      if (open && out[line[at - 1]] === v) {
        out[line[at - 1]] = v * 2; gained += v * 2; open = false;
        steps.push({ from, to: line[at - 1], merge: true }); moved = true;
      } else {
        out[line[at]] = v; open = true;
        steps.push({ from, to: line[at], merge: false });
        if (from !== line[at]) moved = true;
        at++;
      }
    }
  }
  return { grid: out, gained, moved, steps };
}

export const empties = grid => grid.flatMap((v, i) => (v ? [] : [i]));
export const maxTile = grid => Math.max(0, ...grid);
// 还能不能动：有空格，或者相邻有一样的
export function canMove(grid) {
  if (grid.some(v => !v)) return true;
  for (let i = 0; i < SIZE * SIZE; i++) {
    if (i % SIZE < SIZE - 1 && grid[i] === grid[i + 1]) return true;
    if (i < SIZE * (SIZE - 1) && grid[i] === grid[i + SIZE]) return true;
  }
  return false;
}
// 在一个随机空格出一块新砖：九成是 2，一成是 4。rand() 给 [0, 1)
export function spawn(grid, rand) {
  const free = empties(grid);
  if (!free.length) return { grid, at: -1, v: 0 };
  const at = free[Math.floor(rand() * free.length)], v = rand() < 0.9 ? 2 : 4;
  const next = grid.slice(); next[at] = v;
  return { grid: next, at, v };
}
// 新开一局：两块砖
export function fresh(rand) {
  return spawn(spawn(new Array(SIZE * SIZE).fill(0), rand).grid, rand).grid;
}
