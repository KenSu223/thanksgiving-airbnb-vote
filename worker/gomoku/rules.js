// 五子棋 rules: a 15×15 board, 黑 moves first, five or more in a row (across,
// down or either diagonal) wins, no 禁手; a full board is a draw.
// The board is a flat array of SIZE*SIZE cells: 0 empty, 1 黑, 2 白; a point is
// its index (row * SIZE + col).
export const SIZE = 15;
export const CELLS = SIZE * SIZE;
export const CENTER = (SIZE * SIZE - 1) / 2;
export const BLACK = 1, WHITE = 2;
// across, down, and the two diagonals
export const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

export const inBoard = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;
export const isPoint = at => Number.isInteger(at) && at >= 0 && at < CELLS;
export const emptyBoard = () => new Array(CELLS).fill(0);

// The longest run of the stone at `at` (five or more), as its points in board
// order; null when that stone doesn't make five.
export function winLine(stones, at) {
  const color = stones[at];
  if (!color) return null;
  const r0 = Math.floor(at / SIZE), c0 = at % SIZE;
  let best = null;
  for (const [dr, dc] of DIRS) {
    const line = [at];
    for (const s of [1, -1]) {
      for (let r = r0 + dr * s, c = c0 + dc * s; inBoard(r, c) && stones[r * SIZE + c] === color; r += dr * s, c += dc * s) line.push(r * SIZE + c);
    }
    if (line.length >= 5 && (!best || line.length > best.length)) best = line;
  }
  return best && best.sort((a, b) => a - b);
}

// The board after these moves (黑 on the even ones), or null when a move is off
// the board or on a stone — a saved game that doesn't replay is thrown away.
export function replay(moves) {
  if (!Array.isArray(moves) || moves.length > CELLS) return null;
  const stones = emptyBoard();
  for (let i = 0; i < moves.length; i++) {
    if (!isPoint(moves[i]) || stones[moves[i]]) return null;
    stones[moves[i]] = i % 2 ? WHITE : BLACK;
  }
  return stones;
}
