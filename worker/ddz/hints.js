// 提示 for 斗地主: a list of plays, one per press (game.js steps through it
// and starts over when the table changes).
// - beatOptions: every play in the hand that beats the cards on the table.
//   This is about what you CAN play — the bot (bot.js) decides what it WOULD
//   play, and sometimes passes on purpose (a teammate led, no bombs this
//   early, no 2 on a small single), which is no answer to "can I beat this?".
// - leadOptions: your own lead, the hand's groups from the cheapest.
// Both start from groupsOf, the hand split the way a player holds it. Plays
// that only use whole groups come first, then ones that split a pair or
// triple, then ones that break a straight / pair run / plane, then ones that
// break a bomb or the rocket (四带二 counts as that); smaller first within
// each; then bombs from small to big, then the rocket. Kickers (带的牌) are
// the cheapest spare cards: a lone small card (or pair) first, then one split
// off a small pair or triple, an A / 2 / joker only after those, and out of a
// straight or a bomb only when nothing else is left (333 44 22: 33344). When
// that means splitting something or a big card, the other choice follows on
// the next press (444 777 22 against 三带二: 44477, then 44422).
// Every option is checked with legalPlay, the same rule a real play goes through.
import { ACE, legalPlay, readPlay, value } from './cards.js';

const span = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
function byRank(hand) {
  const m = new Map();
  for (const c of hand) { const v = value(c); if (!m.has(v)) m.set(v, []); m.get(v).push(c); }
  return m;
}
function subsets(list, k) { // every k cards out of `list` (one rank: at most 4 cards)
  if (!k) return [[]];
  return list.flatMap((c, i) => subsets(list.slice(i + 1), k - 1).map(s => [c, ...s]));
}

// What a rank count leaves once the straights are out: pair runs, triples,
// pairs and singles, scored [plays, lone cards]. Each triple (and each
// triple of a plane, `wings`) carries a single or a pair along.
function restScore(cnt, wings) {
  let runs = 0, t = 0, p = 0, s = 0;
  for (const n of cnt.values()) { if (n === 3) t++; else if (n === 2) p++; else if (n === 1) s++; }
  for (let v = 3; v <= ACE;) {
    let e = v;
    while (e <= ACE && cnt.get(e) === 2) e++;
    if (e - v >= 3) { runs++; p -= e - v; }
    v = Math.max(e, v + 1);
  }
  return [runs + t + p + s - Math.min(t + wings, s + p), Math.max(0, s - t - wings)];
}

// The straights worth pulling out: every set of them is tried (each one has
// to use up at least two lone cards) and the one leaving the fewest plays
// wins, then the fewest lone cards (34567 + 88 over 345678 + 8).
function pickStraights(cnt, wings) {
  let best = { score: restScore(cnt, wings), runs: [] };
  const walk = (cnt, runs, from) => {
    for (let lo = from; lo <= ACE - 4; lo++) {
      for (let hi = lo; hi <= ACE && cnt.get(hi) > 0; hi++) {
        if (hi - lo < 4) continue;
        if (span(lo, hi).filter(v => cnt.get(v) === 1).length < 2) continue;
        const next = new Map(cnt);
        for (const v of span(lo, hi)) next.set(v, next.get(v) - 1);
        const rs = runs.concat([[lo, hi]]);
        const [plays, lone] = restScore(next, wings);
        const score = [plays + rs.length, lone];
        if ((score[0] - best.score[0] || score[1] - best.score[1]) < 0) best = { score, runs: rs };
        walk(next, rs, lo);
      }
    }
  };
  walk(cnt, [], 3);
  return best.runs;
}

// The hand as groups: { type, cards }, types rocket, bomb, plane, straight,
// pairs (连对), triple, pair, single. Straights, pair runs and planes stop at A.
export function groupsOf(hand) {
  const left = byRank(hand);
  const n = v => left.get(v)?.length || 0;
  const take = (v, k) => left.get(v).splice(0, k);
  const out = [];
  const add = (type, cards) => out.push({ type, cards });
  if (n(16) && n(17)) add('rocket', [...take(16, 1), ...take(17, 1)]);
  for (let v = 3; v <= 15; v++) if (n(v) === 4) add('bomb', take(v, 4));
  let wings = 0;
  for (let v = 3; v < ACE; v++) { // planes: triples in a row
    let e = v;
    while (n(v) === 3 && e < ACE && n(e + 1) === 3) e++;
    if (e > v) { add('plane', span(v, e).flatMap(r => take(r, 3))); wings += e - v + 1; v = e; }
  }
  const cnt = new Map([...left].map(([v, cs]) => [v, cs.length]));
  for (const [lo, hi] of pickStraights(cnt, wings)) add('straight', span(lo, hi).map(v => take(v, 1)[0]));
  for (let v = 3; v <= ACE;) { // pair runs: three or more pairs in a row
    let e = v;
    while (e <= ACE && n(e) === 2) e++;
    if (e - v >= 3) add('pairs', span(v, e - 1).flatMap(r => take(r, 2)));
    v = Math.max(e, v + 1);
  }
  for (const v of [...left.keys()].sort((a, b) => a - b)) {
    const k = n(v);
    if (k) add(k === 3 ? 'triple' : k === 2 ? 'pair' : 'single', take(v, k));
  }
  return out;
}

// What taking `cards` out of the hand does to its groups: 0 nothing (whole
// groups only, or the end of a run that is still a run), 1 splits a pair or
// triple, 2 breaks a straight / pair run / plane, 3 breaks a bomb or the rocket.
function damage(groups, cards) {
  let worst = 0;
  for (const gr of groups) {
    const rest = gr.cards.filter(c => !cards.includes(c));
    if (!rest.length || rest.length === gr.cards.length) continue;
    worst = Math.max(worst, gr.type === 'bomb' || gr.type === 'rocket' ? 3
      : gr.type === 'pair' || gr.type === 'triple' ? 1
      : readPlay(rest).some(p => p.type === gr.type) ? 0 : 2);
  }
  return worst;
}
// The k cards of `list` (one rank) that do the least damage.
const least = (groups, list, k) => subsets(list, k).reduce((a, b) => (damage(groups, b) < damage(groups, a) ? b : a));

// What a kicker costs: 0 a spare card under A, 1 split off a pair or triple
// under A, 2 an A / 2 / joker, 3 out of a straight / pair run / plane, 4 out
// of a bomb or the rocket.
const kickCost = (d, v) => (d >= 2 ? d + 1 : v >= ACE ? 2 : d);
// The cheapest `k` kickers of `per` cards each (1: singles, 2: pairs) from
// ranks not in `skip`, each one passing `ok`: { cards, cost, big } (big: an
// A / 2 / joker among them), or null if the hand hasn't enough.
function kickers(groups, g, per, k, skip, ok) {
  const units = [];
  for (const [v, list] of g) {
    if (skip.includes(v) || list.length < per) continue;
    const cards = least(groups, list, per), d = damage(groups, cards);
    units.push({ v, d, cards, cost: kickCost(d, v) });
    // two single kickers can be a whole spare pair, after the lone cards
    if (per === 1 && k > 1 && list.length >= 2 && v < ACE) {
      const two = least(groups, list, 2);
      if (!damage(groups, two)) units.push({ v, d: 0, cards: two, cost: 0.5 });
    }
  }
  units.sort((a, b) => a.cost - b.cost || a.v - b.v);
  const cards = [], used = new Set();
  let cost = 0, big = false;
  for (const u of units) {
    if (!ok(u) || used.has(u.v) || cards.length + u.cards.length > k * per) continue;
    cards.push(...u.cards); used.add(u.v); cost += u.cost; big ||= u.v >= ACE;
  }
  return cards.length === k * per ? { cards, cost, big } : null;
}

export function beatOptions(hand, prev) {
  if (!prev || prev.type === 'rocket') return [];
  const groups = groupsOf(hand), g = byRank(hand);
  const ranks = [...g.keys()].sort((a, b) => a - b);
  const size = v => g.get(v)?.length || 0;
  const pick = (v, k) => least(groups, g.get(v), k);
  const out = [], seen = new Set();
  const push = (cards, floor = 0, kick = 0) => {
    const key = cards.map(value).sort((a, b) => a - b).join(',');
    if (seen.has(key)) return;
    const p = legalPlay(cards, prev);
    if (!p) return;
    seen.add(key);
    out.push({ cards, tier: Math.max(floor, damage(groups, cards)), main: p.main, kick });
  };
  // The cheapest kickers; when those split something or take an A / 2 /
  // joker, the next press shows the other way too (only spare cards, or only
  // small ones). A big kicker ranks with splitting a pair.
  const withKickers = (main, per, k, skip, floor) => {
    for (const ok of [() => true, u => !u.d, u => u.v < ACE && u.d < 3]) {
      const w = kickers(groups, g, per, k, skip, ok);
      if (w) push(main.concat(w.cards), Math.max(floor, w.big ? 1 : 0), w.cost);
    }
  };
  // runs of `len` consecutive ranks (up to A) holding `per` each, topping above `main`
  const runs = (per, len) => {
    const found = [];
    for (let top = Math.max(prev.main + 1, 3 + len - 1); top <= ACE; top++) {
      const vs = span(top - len + 1, top);
      if (vs.every(v => size(v) >= per)) found.push({ vs, cards: vs.flatMap(v => pick(v, per)) });
    }
    return found;
  };
  const { type, main, n } = prev;
  if (type === 'single' || type === 'pair' || type === 'triple') {
    const k = type === 'single' ? 1 : type === 'pair' ? 2 : 3;
    for (const v of ranks) if (v > main && size(v) >= k) push(pick(v, k));
  }
  if (type === 'triple1' || type === 'triple2') {
    for (const v of ranks) if (v > main && size(v) >= 3) withKickers(pick(v, 3), type === 'triple1' ? 1 : 2, 1, [v], 0);
  }
  if (type === 'straight') for (const r of runs(1, n)) push(r.cards);
  if (type === 'pairs') for (const r of runs(2, n / 2)) push(r.cards);
  if (type === 'plane') for (const r of runs(3, n / 3)) push(r.cards);
  if (type === 'plane1' || type === 'plane2') {
    const k = n / (type === 'plane1' ? 4 : 5);
    for (const r of runs(3, k)) withKickers(r.cards, type === 'plane1' ? 1 : 2, k, r.vs, 0);
  }
  if (type === 'four2' || type === 'four22') { // spends a bomb as a plain play
    for (const v of ranks) if (v > main && size(v) === 4) withKickers(g.get(v).slice(), type === 'four2' ? 1 : 2, 2, [v], 3);
  }
  out.sort((a, b) => a.tier - b.tier || a.main - b.main || a.kick - b.kick);
  // then bombs, small to big (legalPlay drops the ones a bomb on the table already beats), then the rocket
  const bombs = ranks.filter(v => size(v) === 4 && legalPlay(g.get(v), prev)).map(v => g.get(v).slice());
  if (g.has(16) && g.has(17)) bombs.push([g.get(16)[0], g.get(17)[0]]);
  return out.map(o => o.cards).concat(bombs);
}

// Your own lead: the whole hand if it goes out in one play, then the hand's
// groups from the smallest (a longer play first when they start at the same
// card), bombs and the rocket last. Triples and planes take the smallest
// spare singles under A along (or pairs, when there aren't enough singles).
// An opponent down to one card: singles go after everything else, biggest
// first; down to two, the same for pairs.
export function leadOptions(hand, { oppMin = 20 } = {}) {
  const groups = groupsOf(hand);
  const spare = type => groups.filter(gr => gr.type === type && value(gr.cards[0]) < ACE);
  const singles = spare('single'), pairs = spare('pair'), used = new Set(), carry = new Map();
  for (const gr of groups) {
    if (gr.type !== 'plane' && gr.type !== 'triple') continue;
    const k = gr.cards.length / 3;
    const free = list => list.filter(x => !used.has(x));
    const pool = free(singles).length >= k ? free(singles) : free(pairs).length >= k ? free(pairs) : [];
    const w = pool.slice(0, k);
    if (w.length === k) { w.forEach(x => used.add(x)); carry.set(gr, w.flatMap(x => x.cards)); }
  }
  const late = o => (oppMin === 1 && o.type === 'single') || (oppMin === 2 && o.type === 'pair');
  const opts = groups.filter(gr => !used.has(gr)).map(gr => ({
    type: gr.type, cards: gr.cards.concat(carry.get(gr) || []), low: Math.min(...gr.cards.map(value)),
    last: gr.type === 'rocket' ? 2 : gr.type === 'bomb' ? 1 : 0,
  }));
  opts.sort((a, b) => a.last - b.last || late(a) - late(b) || (late(a) ? b.low - a.low : a.low - b.low) || b.cards.length - a.cards.length);
  const list = opts.map(o => o.cards);
  if (legalPlay(hand, null) && list.length > 1) list.unshift(hand.slice());
  return list.filter(c => legalPlay(c, null));
}
