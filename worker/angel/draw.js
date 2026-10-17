// Secret Angel pairing, Secret Santa style: everyone in the draw gives exactly
// one gift and gets exactly one. Everyone is shuffled into one random circle
// (Fisher–Yates, so every circle is equally likely) and gives to the next
// person: a → b → c → … → a. One circle means nobody draws themselves, nobody
// gets two angels, and nobody simply swaps with someone (a → b and b → a) — as
// long as there are at least MIN_DRAW people: with two, swapping is the only
// way, so a draw needs three. rand() returns [0, 1).
export const MIN_DRAW = 3;

export function drawCycle(keys, rand) {
  if (keys.length < MIN_DRAW) return null;
  const order = keys.slice();
  for (let i = order.length - 1; i > 0; i--) {
    const k = Math.floor(rand() * (i + 1));
    [order[i], order[k]] = [order[k], order[i]];
  }
  const pairs = {};
  order.forEach((angel, i) => { pairs[angel] = order[(i + 1) % order.length]; });
  return pairs; // angel key -> the person they give a gift to
}

// Take one person out of a drawn circle (left out, or their account retired)
// without reshuffling anyone else: whoever was giving to them now gives to the
// person they were giving to (… → x → them → y → … becomes … → x → y → …), so
// it stays one circle. With fewer than MIN_DRAW left there's no circle without a
// swap: null (the draw has to go; someone reshuffles once more people join).
// pairs is not modified; a person who isn't in it gets the same pairs back.
export function removeFromCycle(pairs, key) {
  if (!(key in pairs)) return pairs;
  const next = { ...pairs };
  const to = next[key];
  const from = Object.keys(next).find(k => next[k] === key);
  delete next[key];
  if (Object.keys(next).length < MIN_DRAW) return null;
  if (from) next[from] = to;
  return next;
}
