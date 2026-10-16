// Saving a table game (掼蛋, 斗地主, 川麻, 21 点): the game object as plain
// data — everything but its hooks and the running timer — and back again. The
// rooms write it to storage on every change and read it back when they start,
// so a deploy carries the hand on; each game's resume() restarts its clock.
// A snapshot from another version is refused (the room then starts clean, and
// 豆子 / chips are still there: they're saved after every hand).
export const SNAPSHOT_V = 1;

export function snapshotOf(game) {
  const { h, timer, deadline, ...rest } = game;
  return JSON.parse(JSON.stringify({ ...rest, v: SNAPSHOT_V }));
}
export function restoreInto(game, snap) {
  if (!snap || snap.v !== SNAPSHOT_V) return false;
  const { v, ...rest } = snap;
  Object.assign(game, rest);
  game.timer = null; game.deadline = 0;
  return true;
}
// Someone alone with bots leaves (stands up, closes the page, goes idle) with a
// hand going: their 豆子 are saved and the whole table is parked under them
// (hooks.park); the table is freed.
export function parkOut(game, seat) {
  game.h.save(seat);
  game.h.park(seat.key, snapshotOf(game));
  game.clear();
}
// They press 开始 alone at a table later: the parked table comes back — their
// seat as it was, their record as saved since (they may have played elsewhere),
// the clock running again. false if nothing usable was parked.
const RECORD_FIELDS = ['name', 'points', 'refills', 'games', 'wins', 'aces'];
export function unparkInto(game, key) {
  const me = game.seats[game.seatOf(key)];
  const snap = game.h.unpark?.(key);
  if (!snap?.seats?.some(x => x && !x.bot && x.key === key) || !restoreInto(game, snap)) return false;
  const s = game.seats.find(x => x && !x.bot && x.key === key);
  for (const f of RECORD_FIELDS) if (me[f] !== undefined) s[f] = me[f];
  Object.assign(s, { connected: true, leaving: false, auto: false, timeouts: 0, activeAt: game.h.now() });
  game.resumedRound = game.round;
  game.resume();
  return true;
}
