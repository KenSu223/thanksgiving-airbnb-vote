// 提示 for 掼蛋: a list of plays, one per press (game.js steps through it and
// starts over when the table changes).
// - beatOptions: everything in the hand that beats the table — not just what
//   the bot (bot.js) would play: it lets a partner's play stand and holds
//   bombs back, which is no answer to "can I beat this?".
// - leadOptions: your own lead, the hand's groups from the cheapest.
// Both start from groupsOf, the hand split the way a player holds it. Plain
// plays that only use whole groups come first, then ones that split a pair or
// triple, then ones that spend a 配, then ones that break a 顺子 / 三连对 /
// 钢板, then ones that break a bomb; smaller first within each, and a play
// with 配 never before the same play without it (nor at all when it saves
// nothing). Then the bombs: the ones that break no other bomb first, small to
// big, 天王炸 last. The pair in 三带二 is the cheapest spare pair: a small one
// first, then one split off a small triple, then A / 级牌 / 王, a 配 only when
// nothing else will do (333 44 AA: 33344, not 333AA); when that means
// splitting something or a big pair, the other choice follows on the next
// press. Every option is checked with legalPlay.
import { ACE, SUITS, rankOf, suitOf, isWild, isBomb, power, legalPlay, value, rankValue } from './cards.js';
import { split } from './bot.js';

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const real = r => (r === 1 ? ACE : r); // rank 1 in a run is the A
function subsets(list, k) { // every k cards out of `list` (one rank: at most 8 cards)
  if (!k) return [[]];
  return list.flatMap((c, i) => subsets(list.slice(i + 1), k - 1).map(s => [c, ...s]));
}

// The hand as groups: { type, cards }. 天王炸 (or the jokers as pairs /
// singles), bombs, 同花顺, 钢板, 三连对, 顺子 (5 in a row using at least three
// lone cards), then triples, pairs and singles, and the 配 on their own.
// Runs use the natural places (the A can be low), like the bot's planHand.
export function groupsOf(hand, level) {
  const { byRank, wilds, sj, bj } = split(hand, level);
  const left = new Map([...byRank].map(([r, l]) => [r, l.slice()]));
  const count = r => left.get(real(r))?.length || 0;
  const take = (r, n) => left.get(real(r)).splice(0, n);
  const out = [];
  const add = (type, cards) => out.push({ type, cards });
  if (sj.length === 2 && bj.length === 2) add('jokers', sj.concat(bj));
  else for (const j of [sj, bj]) if (j.length) add(j.length === 2 ? 'pair' : 'single', j.slice());
  for (const [r] of left) if (count(r) >= 4) add('bomb', take(r, count(r)));
  for (const s of SUITS) for (let top = 5; top <= ACE; top++) {
    const run = range(top - 4, top).map(r => left.get(real(r))?.find(c => suitOf(c) === s));
    if (!run.every(Boolean)) continue;
    for (const c of run) { const l = left.get(rankOf(c)); l.splice(l.indexOf(c), 1); }
    add('sflush', run);
  }
  for (let top = 2; top <= ACE; top++) if (count(top - 1) === 3 && count(top) === 3) add('plate', [...take(top - 1, 3), ...take(top, 3)]);
  for (let top = 3; top <= ACE; top++) if ([top - 2, top - 1, top].every(r => count(r) === 2)) add('tube', [top - 2, top - 1, top].flatMap(r => take(r, 2)));
  for (let again = true; again;) {
    again = false;
    for (let top = 5; top <= ACE; top++) {
      const rs = range(top - 4, top);
      if (rs.every(r => count(r) >= 1) && rs.filter(r => count(r) === 1).length >= 3) { add('straight', rs.flatMap(r => take(r, 1))); again = true; break; }
    }
  }
  for (const r of [...left.keys()].sort((a, b) => rankValue(a, level) - rankValue(b, level))) {
    const n = count(r);
    if (n) add(n === 3 ? 'triple' : n === 2 ? 'pair' : 'single', take(r, n));
  }
  if (wilds.length) add('wild', wilds.slice());
  return out;
}

// What taking `cards` out of the hand does to its groups: 0 nothing (whole
// groups only; the 配 don't count here), 1 splits a pair or triple, 2 breaks
// a 顺子 / 三连对 / 钢板, 3 breaks a bomb, 同花顺 or 天王炸.
const BOMBS = new Set(['bomb', 'sflush', 'jokers']);
function damage(groups, cards) {
  let worst = 0;
  for (const gr of groups) {
    if (gr.type === 'wild') continue;
    const n = gr.cards.filter(c => cards.includes(c)).length;
    if (n && n < gr.cards.length) worst = Math.max(worst, BOMBS.has(gr.type) ? 3 : gr.type === 'pair' || gr.type === 'triple' ? 1 : 2);
  }
  return worst;
}
// The k cards of `list` (one rank or suit) that do the least damage.
const least = (groups, list, k) => subsets(list, k).reduce((a, b) => (damage(groups, b) < damage(groups, a) ? b : a));

export function beatOptions(hand, prev, level) {
  if (!prev) return [];
  const groups = groupsOf(hand, level), { byRank, wilds, sj, bj } = split(hand, level);
  const pick = (list, k) => least(groups, list, k);
  const out = [], seen = new Set();
  const add = (cards, kick = 0, floor = 0) => {
    const key = cards.map(c => (isWild(c, level) ? '配' : c.slice(0, -1))).sort().join(); // the two decks look the same
    if (seen.has(key)) return;
    seen.add(key);
    const play = legalPlay(cards, prev, level);
    if (play) out.push({ cards, play, kick, floor, d: damage(groups, cards), w: cards.filter(c => isWild(c, level)).length });
  };
  // `size` cards of one rank, with 0–2 配 topping up
  const sets = size => [...byRank.values()].flatMap(list => range(0, Math.min(2, wilds.length, size - 1))
    .filter(w => list.length >= size - w).map(w => pick(list, size - w).concat(wilds.slice(0, w))));
  // Pairs for 三带二 next to `triple`, cheapest first: { cards, v, d, cost },
  // cost 0 a spare pair under A, 1 split off a triple, 2 A / 级牌 / 王, 3 out
  // of a 顺子 / 三连对 / 钢板, 4 a card and a 配, 5 out of a bomb.
  const pairsFor = triple => {
    const tr = rankOf(triple.find(c => !isWild(c, level)));
    const free = wilds.filter(c => !triple.includes(c));
    const opts = [];
    const push = (cards, v, wild) => {
      const d = damage(groups, cards);
      opts.push({ cards, v, d, wild, cost: d === 3 ? 5 : wild ? 4 : d === 2 ? 3 : v >= ACE ? 2 : d });
    };
    for (const [r, list] of byRank) {
      if (r === tr) continue;
      if (list.length >= 2) push(pick(list, 2), rankValue(r, level), false);
      if (free.length) push(pick(list, 1).concat(free[0]), rankValue(r, level), true);
    }
    for (const j of [sj, bj]) if (j.length === 2) push(j.slice(), rankOf(j[0]), false);
    return opts.sort((a, b) => a.cost - b.cost || a.v - b.v);
  };
  // The cheapest pair; when that splits something or is A / 级牌 / 王, the next
  // press shows the other way too (a spare pair, or a small one). A big pair
  // ranks with splitting a pair.
  const fulls = triple => {
    const ps = pairsFor(triple);
    for (const p of [ps[0], ps.find(x => !x.d && !x.wild), ps.find(x => x.v < ACE && x.d < 3 && !x.wild)]) {
      if (p) add(triple.concat(p.cards), p.cost, p.v >= ACE && !p.wild ? 1 : 0);
    }
  };
  // `len` ranks in a row, `each` of every rank: the cards that hurt least and
  // 配 for the gaps; a second try also puts 配 in place of cards that would
  // break a bomb or another run
  const runs = (len, each, tops) => {
    for (const top of tops) for (const save of [false, true]) {
      const cards = [];
      let w = 0;
      for (let r = top - len + 1; r <= top; r++) {
        const list = byRank.get(real(r)) || [];
        const c = pick(list, Math.min(each, list.length));
        if (save && c.length && damage(groups, c) >= 2 && w + each <= wilds.length) w += each;
        else { cards.push(...c); w += each - c.length; }
      }
      if (w <= wilds.length) add(cards.concat(wilds.slice(0, w)));
    }
  };
  if (!isBomb(prev)) {
    const t = prev.type;
    if (t === 'single') { for (const c of sets(1)) add(c); for (const j of [sj, bj, wilds]) if (j.length) add([j[0]]); }
    if (t === 'pair') { for (const c of sets(2)) add(c); for (const j of [sj, bj, wilds]) if (j.length === 2) add(j.slice()); }
    if (t === 'triple') for (const c of sets(3)) add(c);
    if (t === 'full') for (const c of sets(3)) fulls(c);
    if (t === 'straight') runs(5, 1, range(5, ACE));
    if (t === 'tube') runs(3, 2, range(3, ACE));
    if (t === 'plate') runs(2, 3, range(2, ACE));
  }
  // bombs: 4+ of a rank (配 joining in), 同花顺, 天王炸
  for (const list of byRank.values()) for (let w = 0; w <= wilds.length; w++) {
    for (let n = Math.max(4, w + 1); n <= list.length + w; n++) add(pick(list, n - w).concat(wilds.slice(0, w)));
  }
  for (const s of SUITS) for (let top = 5; top <= ACE; top++) {
    const cards = [];
    let w = 0;
    for (let r = top - 4; r <= top; r++) {
      const list = (byRank.get(real(r)) || []).filter(c => suitOf(c) === s);
      if (list.length) cards.push(pick(list, 1)[0]); else w++;
    }
    if (w <= wilds.length) add(cards.concat(wilds.slice(0, w)));
  }
  if (sj.length === 2 && bj.length === 2) add(sj.concat(bj));

  // A 配 play is kept only when it breaks less than the same play without 配,
  // and still goes after it.
  const sig = o => `${o.play.type}:${o.play.main}:${o.play.n || ''}`;
  const plain = new Map(); // same play without 配: the least damage
  for (const o of out) if (!o.w) plain.set(sig(o), Math.min(plain.get(sig(o)) ?? 9, o.d));
  const keep = out.filter(o => !o.w || !(plain.get(sig(o)) <= o.d));
  const TIER = [[0, 1, 3, 4], [2, 2, 3, 4]]; // [no 配 / 配][damage]
  for (const o of keep) o.t = Math.max(TIER[o.w ? 1 : 0][o.d], o.floor, plain.has(sig(o)) ? TIER[0][plain.get(sig(o))] : 0);
  const plays = keep.filter(o => !isBomb(o.play))
    .sort((a, b) => a.t - b.t || a.play.main - b.play.main || a.w - b.w || a.kick - b.kick);
  const bombs = keep.filter(o => isBomb(o.play)).sort((a, b) => (a.play.type === 'jokers') - (b.play.type === 'jokers')
    || (a.d === 3) - (b.d === 3) || power(a.play) - power(b.play) || a.w - b.w || a.d - b.d);
  return plays.concat(bombs).map(o => o.cards);
}

// Your own lead: the whole hand if it goes out in one play, then the hand's
// groups from the smallest (a longer play first when they start at the same
// card); the 配 after those, bombs last, small to big. Each triple takes the
// smallest spare pair under A along (三带二). An opponent down to one card:
// singles go after the other plain plays, biggest first; down to two, the
// same for pairs.
const RUN = { straight: 5, tube: 3, plate: 2 };
export function leadOptions(hand, level, { oppMin = 27 } = {}) {
  const groups = groupsOf(hand, level);
  const pairs = groups.filter(gr => gr.type === 'pair' && value(gr.cards[0], level) < ACE), used = new Set(), carry = new Map();
  for (const gr of groups) {
    if (gr.type !== 'triple') continue;
    const p = pairs.find(x => !used.has(x));
    if (p) { used.add(p); carry.set(gr, p.cards); }
  }
  const late = o => (oppMin === 1 && o.play.type === 'single') || (oppMin === 2 && o.play.type === 'pair');
  const opts = groups.filter(gr => !used.has(gr)).map(gr => {
    const cards = gr.cards.concat(carry.get(gr) || []), play = legalPlay(cards, null, level);
    return play && { cards, play, last: isBomb(play) ? 2 : gr.type === 'wild' ? 1 : 0, low: play.main - (RUN[play.type] || 1) + 1 };
  }).filter(Boolean);
  opts.sort((a, b) => a.last - b.last || (a.last === 2 && power(a.play) - power(b.play))
    || late(a) - late(b) || (late(a) ? b.low - a.low : a.low - b.low) || b.cards.length - a.cards.length);
  const list = opts.map(o => o.cards);
  if (legalPlay(hand, null, level) && list.length > 1) list.unshift(hand.slice());
  return list;
}
