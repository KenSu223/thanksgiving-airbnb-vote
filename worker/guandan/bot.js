// 掼蛋 bots: what to lead, what to follow with, and the 进贡 / 还贡 cards.
// Simple, but plays real shapes: it breaks the hand into bombs, 钢板, 三连对,
// 顺子, 三带二, pairs and singles, leads the cheapest group, follows with the
// cheapest cards that beat the table without breaking a bomb, lets its
// partner's play stand, and bombs when an opponent is close to going out.
// People's 提示 is in hints.js.
import { ACE, SJ, BJ, rankOf, suitOf, isWild, isBomb, power, legalPlay, value, sortHand, SUITS } from './cards.js';

// The hand by natural rank, with the 配 and the jokers apart.
export function split(hand, level) {
  const byRank = new Map(), wilds = [], sj = [], bj = [];
  for (const c of hand) {
    if (isWild(c, level)) wilds.push(c);
    else if (rankOf(c) === SJ) sj.push(c);
    else if (rankOf(c) === BJ) bj.push(c);
    else { const r = rankOf(c); if (!byRank.has(r)) byRank.set(r, []); byRank.get(r).push(c); }
  }
  return { byRank, wilds, sj, bj };
}
const real = r => (r === 1 ? ACE : r); // rank 1 in a run is the A

// ---- candidate plays of one shape (cards only; legalPlay reads them) ----
function* sets(g, size, maxWild) { // size cards of one rank, wild cards topping up
  for (const [, list] of g.byRank) {
    for (let w = 0; w <= Math.min(maxWild, g.wilds.length); w++) {
      if (size - w < 1 || list.length < size - w) continue;
      yield list.slice(0, size - w).concat(g.wilds.slice(0, w));
    }
  }
}
function* runs(g, len, each, tops, maxWild, suit) { // len ranks in a row, `each` of every rank
  for (const top of tops) {
    const cards = []; let w = 0;
    for (let r = top - len + 1; r <= top && w <= maxWild; r++) {
      const list = (g.byRank.get(real(r)) || []).filter(c => !suit || suitOf(c) === suit);
      const take = list.slice(0, each);
      cards.push(...take); w += each - take.length;
    }
    if (w <= Math.min(maxWild, g.wilds.length)) yield cards.concat(g.wilds.slice(0, w));
  }
}
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
function* shapes(g, type, maxWild) {
  if (type === 'single') {
    for (const [, list] of g.byRank) yield [list[0]];
    if (g.sj.length) yield [g.sj[0]];
    if (g.bj.length) yield [g.bj[0]];
    if (g.wilds.length) yield [g.wilds[0]];
  } else if (type === 'pair') {
    yield* sets(g, 2, maxWild);
    if (g.sj.length === 2) yield g.sj.slice();
    if (g.bj.length === 2) yield g.bj.slice();
    if (g.wilds.length === 2 && maxWild >= 2) yield g.wilds.slice();
  } else if (type === 'triple') {
    yield* sets(g, 3, maxWild);
  } else if (type === 'full') {
    for (const t of sets(g, 3, maxWild)) {
      const tr = rankOf(t.find(c => !isWild(c, g.level)) || t[0]);
      const usedW = t.filter(c => g.wilds.includes(c)).length;
      for (const [r, list] of g.byRank) if (r !== tr && list.length >= 2) { yield t.concat(list.slice(0, 2)); break; }
      if (g.sj.length === 2) yield t.concat(g.sj);
      if (g.bj.length === 2) yield t.concat(g.bj);
      if (usedW === 0 && maxWild >= 1) for (const [r, list] of g.byRank) if (r !== tr && list.length === 1 && g.wilds.length) { yield t.concat(list[0], g.wilds[0]); break; }
    }
  } else if (type === 'straight') yield* runs(g, 5, 1, range(5, ACE), maxWild);
  else if (type === 'tube') yield* runs(g, 3, 2, range(3, ACE), maxWild);
  else if (type === 'plate') yield* runs(g, 2, 3, range(2, ACE), maxWild);
}
function* bombs(g) {
  for (const [, list] of g.byRank) {
    for (let w = 0; w <= g.wilds.length; w++) for (let n = Math.max(4, w + 1); n <= list.length + w; n++) {
      if (n - w <= list.length) yield list.slice(0, n - w).concat(g.wilds.slice(0, w));
    }
  }
  for (const s of SUITS) yield* runs(g, 5, 1, range(5, ACE), g.wilds.length, s);
  if (g.sj.length === 2 && g.bj.length === 2) yield g.sj.concat(g.bj);
}

// How much a play costs the rest of the hand: breaking a bomb, spending wild
// cards or splitting a bigger set all count against it.
function cost(cards, g, level) {
  let c = 0;
  const used = new Map();
  for (const x of cards) {
    if (isWild(x, level)) { c += 25; continue; }
    const r = rankOf(x); used.set(r, (used.get(r) || 0) + 1);
  }
  for (const [r, n] of used) {
    const have = g.byRank.get(r)?.length || (r === SJ ? g.sj.length : r === BJ ? g.bj.length : 0);
    if (have >= 4 && n < have) c += 40; // breaking a bomb
    else if (have > n) c += 3 * (have - n);
  }
  return c;
}

// Everything in the hand that beats `prev` (without a bomb if possible).
export function beaters(hand, prev, level, maxWild = 2) {
  const g = split(hand, level); g.level = level;
  const out = [], seen = new Set();
  const add = cards => {
    const key = cards.slice().sort().join();
    if (seen.has(key)) return;
    seen.add(key);
    const p = legalPlay(cards, prev, level);
    if (p) out.push({ cards, play: p, cost: (isBomb(p) ? 1000 + power(p) : p.main) + cost(cards, g, level) });
  };
  if (!isBomb(prev)) for (const cards of shapes(g, prev.type, maxWild)) add(cards);
  for (const cards of bombs(g)) add(cards);
  return out.sort((a, b) => a.cost - b.cost);
}

// Break a hand into groups to lead from: bombs first, then 钢板, 三连对, 顺子,
// 三带二 / 三张, pairs and singles.
export function planHand(hand, level) {
  const g = split(hand, level);
  const left = new Map([...g.byRank].map(([r, l]) => [r, l.slice()]));
  const groups = [];
  const take = (r, n) => left.get(real(r)).splice(0, n);
  const count = r => left.get(real(r))?.length || 0;
  if (g.sj.length === 2 && g.bj.length === 2) groups.push(g.sj.concat(g.bj));
  else { if (g.sj.length === 2) groups.push(g.sj.slice()); else if (g.sj.length) groups.push([g.sj[0]]);
    if (g.bj.length === 2) groups.push(g.bj.slice()); else if (g.bj.length) groups.push([g.bj[0]]); }
  for (const [r] of left) if (count(r) >= 4) groups.push(take(r, count(r)));
  for (let top = 2; top <= ACE; top++) if (count(top - 1) === 3 && count(top) === 3) groups.push([...take(top - 1, 3), ...take(top, 3)]);
  for (let top = 3; top <= ACE; top++) if ([top - 2, top - 1, top].every(r => count(r) === 2)) groups.push([...take(top - 2, 2), ...take(top - 1, 2), ...take(top, 2)]);
  for (let again = true; again;) {
    again = false;
    for (let top = 5; top <= ACE; top++) {
      const rs = range(top - 4, top);
      if (rs.every(r => count(r) >= 1) && rs.filter(r => count(r) === 1).length >= 3) { groups.push(rs.flatMap(r => take(r, 1))); again = true; break; }
    }
  }
  const byCount = n => [...left].filter(([, l]) => l.length === n).map(([r]) => r).sort((a, b) => rankValueOf(a, level) - rankValueOf(b, level));
  const pairs = byCount(2);
  for (const r of byCount(3)) groups.push(pairs.length ? [...take(r, 3), ...take(pairs.shift(), 2)] : take(r, 3));
  for (const r of pairs) groups.push(take(r, 2));
  for (const r of byCount(1)) groups.push(take(r, 1));
  if (g.wilds.length === 2) groups.push(g.wilds.slice()); else if (g.wilds.length) groups.push([g.wilds[0]]);
  return groups.map(cards => ({ cards, play: legalPlay(cards, null, level) })).filter(x => x.play);
}
const rankValueOf = (r, level) => (r === level ? 15 : r);

function lead(hand, level, ctx) {
  const plan = planHand(hand, level);
  const plain = plan.filter(x => !isBomb(x.play));
  if (!plain.length) return plan.sort((a, b) => power(a.play) - power(b.play))[0]?.cards || [sortHand(hand, level).at(-1)];
  // an opponent about to go out: don't hand them a single / pair to finish on
  let pool = plain;
  if (ctx.oppMin === 1) pool = plain.filter(x => x.play.type !== 'single');
  if (ctx.oppMin === 2) pool = plain.filter(x => x.play.type !== 'pair');
  if (!pool.length) return plain.sort((a, b) => b.play.main - a.play.main)[0].cards;
  // cheapest first; longer shapes get to go a little earlier
  const score = x => x.play.main - (x.cards.length >= 5 ? 6 : x.cards.length >= 3 ? 3 : 0);
  return pool.sort((a, b) => score(a) - score(b))[0].cards;
}

// ctx: { partnerOwns (the trick is the partner's), oppMin (fewest cards an opponent holds), mine (my card count) }
export function choosePlay(hand, prev, level, ctx) {
  if (legalPlay(hand, prev, level)) return hand; // the whole hand goes out at once
  if (!prev) return lead(hand, level, ctx);
  if (ctx.partnerOwns) return null;
  const close = ctx.oppMin <= 6 || hand.length <= 6;
  const opts = beaters(hand, prev, level, ctx.oppMin <= 8 || hand.length <= 8 ? 2 : 0);
  const plain = opts.find(x => !isBomb(x.play));
  // don't throw a joker / level card at a small lead early on
  if (plain && !(plain.play.main >= 15 && prev.main < 11 && ctx.oppMin > 10)) return plain.cards;
  const bomb = opts.find(x => isBomb(x.play));
  if (bomb && (close || isBomb(prev))) return bomb.cards;
  return null;
}
// 进贡: the biggest card that isn't a wild heart. 还贡: something 10 or lower,
// preferably a lone card.
export function tributeCard(hand, level) {
  return hand.filter(c => !isWild(c, level)).reduce((a, b) => (value(b, level) > value(a, level) ? b : a));
}
export const canReturn = (c, level) => rankOf(c) <= 10 && !isWild(c, level);
export function returnCard(hand, level) {
  const ok = hand.filter(c => canReturn(c, level));
  const pool = ok.length ? ok : hand.filter(c => !isWild(c, level));
  const lone = c => hand.filter(x => rankOf(x) === rankOf(c)).length === 1;
  return pool.sort((a, b) => (lone(b) - lone(a)) || value(a, level) - value(b, level))[0];
}
