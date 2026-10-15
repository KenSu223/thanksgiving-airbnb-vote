// Table reactions: anyone signed in at the table (seated or just
// watching) picks an emoji or a preset taunt line （给阿姨倒一杯卡布奇诺
// and friends) and drops it ON another player — it pops next to the
// TARGET's seat, captioned with the sender's name, for everyone at the
// table. Shared by the TableHall games and Blackjack.
// Only values on these lists are accepted — clients can't inject
// arbitrary text. A reaction lives 4 seconds; one per sender per 300ms.
// Keep the lists in sync with web/src/features/games/Reactions.jsx.
export const REACTION_EMOJIS = ['😏', '🤣', '😂', '🙄', '🥱', '😴', '😤', '🐢', '💩', '🤡', '👎', '👍', '🔥', '💣', '⏰', '😱', '😭', '🤑', '🐶', '👻'];
export const REACTION_PHRASES = [
  '给阿姨倒一杯卡布奇诺 ☕',
  '快点吧，我等到花儿都谢了',
  '就这？就这？',
  '你这牌打得也太好了吧',
  '我要报警了',
  '感谢老板，老板大气',
  '这把我稳了',
  '不服来战',
  '溜了溜了',
  '再来一把！',
];
const ALL = new Set([...REACTION_EMOJIS, ...REACTION_PHRASES]);
export const REACTION_TTL_MS = 4000;
const MIN_GAP_MS = 300;
const MAX_KEPT = 40;

// Record a reaction in list ([{ v, at, by, byName, to }]); false when
// the value is not allowed or the sender is tapping too fast. Several
// reactions can sit on the same target at once, from different senders.
export function noteReaction(list, { by, byName, to, value }, now) {
  if (!ALL.has(value) || !by || !to) return false;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].by === by) { if (now - list[i].at < MIN_GAP_MS) return false; break; }
  }
  list.push({ v: value, at: now, by, byName, to });
  if (list.length > MAX_KEPT) list.splice(0, list.length - MAX_KEPT);
  return true;
}

// The still-fresh reactions, pruning stale entries in place. The
// timestamp travels with each reaction so clients can tell a NEW one
// from the one already on screen and replay the pop animation for it.
export function freshReactions(list, now) {
  for (let i = list.length - 1; i >= 0; i--) if (now - list[i].at > REACTION_TTL_MS) list.splice(i, 1);
  return list.slice();
}
