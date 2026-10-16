// Game leaderboards show only the top 3 to everyone; the rest stay private, so
// nobody's weaker scores are on show. Each person also gets their own place
// (only they see it) when they're below the top 3.
export const TOP = 3;

// ranked: [[key, row], …] best first; key: the viewer (or null).
// → { board: the top 3 rows, boardMe: { ...their row, rank } or null }
export function topFor(ranked, key) {
  const board = ranked.slice(0, TOP).map(([, r]) => r);
  const i = key ? ranked.findIndex(([k]) => k === key) : -1;
  return { board, boardMe: i >= TOP ? { ...ranked[i][1], rank: i + 1 } : null };
}
