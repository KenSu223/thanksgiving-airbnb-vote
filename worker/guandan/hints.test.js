// 掼蛋 提示 (hints.js): what each press of 提示 suggests, leading and beating.
// Run: node --test worker/guandan/hints.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { deck, shuffle, legalPlay, takeFrom, isBomb, isWild, rankOf, rankName, value } from './cards.js';
import { beatOptions, leadOptions } from './hints.js';
import { beaters, choosePlay } from './bot.js';
import { GuandanGame } from './game.js';

// '3♠ 3♠ 配 sj' -> ['3♠1', '3♠2', <the level's ♥>, 'sj1']: the same card again is the other deck
function H(s, level = 2) {
  const seen = new Set();
  return s.split(' ').map(t => {
    const face = t === '配' ? (level > 10 ? rankName(level) : String(level)) + '♥' : t;
    let id = face + 1;
    if (seen.has(id)) id = face + 2;
    seen.add(id);
    return id;
  });
}
// cards as text, small to big, the 配 last: '3 3 3 4 4', '7 配'
const show = (cards, level = 2) => cards.slice()
  .sort((a, b) => isWild(a, level) - isWild(b, level) || value(a, level) - value(b, level) || rankOf(a) - rankOf(b))
  .map(c => (isWild(c, level) ? '配' : rankName(rankOf(c)))).join(' ');
const beat = (hand, prev, level = 2) => beatOptions(H(hand, level), legalPlay(H(prev, level), null, level), level).map(c => show(c, level));
const lead = (hand, level = 2, ctx) => leadOptions(H(hand, level), level, ctx).map(c => show(c, level));

test('三带二 takes the smallest spare pair: 33344, not 333AA', () => {
  assert.deepEqual(beat('3♠ 3♣ 3♦ 4♠ 4♣ A♠ A♦ 9♠', '2♠ 2♣ 2♦ 5♠ 5♣', 10), ['3 3 3 4 4']);
  // level 2: the spare 99 before the 级牌 pair 22, and before anything with the 配
  const opts = beat('6♠ 6♣ 6♦ 9♠ 9♣ 2♠ 2♣ 配 K♠', '3♠ 3♣ 3♦ 5♠ 5♣');
  assert.equal(opts[0], '6 6 6 9 9');
  // no small pair: the 级牌 pair before a single with the 配
  assert.equal(beat('6♠ 6♣ 6♦ 9♠ 2♠ 2♣ 配', '3♠ 3♣ 3♦ 5♠ 5♣')[0], '6 6 6 2 2');
  // only the 配 will do: 9 + 配
  assert.equal(beat('6♠ 6♣ 6♦ 9♠ 配', '3♠ 3♣ 3♦ 5♠ 5♣')[0], '6 6 6 9 配');
});

test('the pair for 三带二 never breaks a bomb; a 顺子 only on the next press', () => {
  assert.deepEqual(beat('6♠ 6♣ 6♦ 4♠ 4♣ 4♦ 4♥ 9♠ 9♣ K♠ K♣', '3♠ 3♣ 3♦ 5♠ 5♣', 10),
    ['6 6 6 9 9', '4 4 4 9 9', '4 4 4 4']);
  // 3 4 5 6 7 + 5 + 888 + AA: 888AA keeps the 顺子 (55 would break it), 88855 comes next
  assert.deepEqual(beat('8♠ 8♣ 8♦ 3♠ 4♣ 5♦ 5♠ 6♠ 7♥ A♠ A♣', '3♣ 3♦ 3♥ 2♠ 2♣', 10), ['8 8 8 A A', '5 5 8 8 8']);
});

test('配 plays come after the plain ones (and only when they save something); bombs last', () => {
  // the 9 9, then J J split off the triple, then 5 + 配 and 2 + 配 (the 级牌 pair), then the bomb
  assert.deepEqual(beat('5♠ 9♣ 9♦ J♣ J♦ J♥ 配 2♠', '4♠ 4♣'), ['9 9', 'J J', '5 配', '2 配', 'J J J 配']);
  // a natural 级牌 single, so the 配 isn't offered as one
  assert.ok(!beat('3♠ 2♠ 配 K♦', '7♣').includes('配'));
});

test('a single comes from a lone card, not out of the 同花顺; the 同花顺 is the first bomb', () => {
  const opts = beat('3♠ 3♣ 4♠ 5♠ 6♠ 7♠ 8♦ K♠ K♣ A♠ 配', '7♣');
  assert.deepEqual(opts.slice(0, 5), ['8', 'A', 'K', '配', '3 4 5 6 7']);
});

test('bombs: small to big, a whole bomb before splitting a bigger one, 天王炸 last', () => {
  assert.deepEqual(beat('7♠ 7♣ 7♦ 7♥ 9♠ 9♣ 9♦ 9♥ 9♠ sj sj bj bj', '5♠ 5♣ 5♦ 5♥'),
    ['7 7 7 7', '9 9 9 9 9', '9 9 9 9', '小王 小王 大王 大王']);
  assert.deepEqual(beat('3♠ 4♦ 9♣', 'K♠ K♣'), []);
});

test('leading: the smallest group first; a triple takes a small spare pair, never AA or the 级牌 pair', () => {
  assert.deepEqual(lead('3♠ 3♣ 3♦ 5♠ 5♣ 7♠ 8♣ 9♦ 10♦ J♦ A♦ bj'), ['3 3 3 5 5', '7 8 9 10 J', 'A', '大王']);
  assert.deepEqual(lead('3♠ 3♣ 3♦ A♠ A♦ 9♠ 7♣', 10), ['3 3 3', '7', '9', 'A A']);
  assert.deepEqual(lead('3♠ 3♣ 3♦ 5♠ 5♣ 9♠ 8♦', 5), ['3 3 3', '8', '9', '5 5']);
  // the 配 after the plain plays, bombs after that
  assert.deepEqual(lead('6♠ 6♣ 6♦ 6♥ 配 4♠ Q♣'), ['4', 'Q', '配', '6 6 6 6']);
  // an opponent down to one card: singles last, the biggest first
  assert.deepEqual(lead('3♠ 9♥ 7♠ 7♣', 2, { oppMin: 1 }), ['7 7', '9', '3']);
  // the whole hand when it goes out in one play
  assert.deepEqual(lead('3♠ 3♣ 3♦ 5♠ 5♣'), ['3 3 3 5 5']);
});

test('random hands: every option is legal, plain plays before bombs, and 提示 finds a beat whenever the bot could', () => {
  let a = 5;
  const rand = () => ((a = (a * 1103515245 + 12345) >>> 0) / 4294967296);
  for (let round = 0; round < 300; round++) {
    const level = 2 + (round % 13);
    const d = shuffle(deck(), rand), hand = d.slice(0, 27);
    const leads = leadOptions(hand, level);
    for (const o of leads) { assert.ok(legalPlay(o, null, level)); assert.ok(takeFrom(hand, o)); }
    const parts = leads.slice(legalPlay(hand, null, level) && leads.length > 1 ? 1 : 0).flat();
    assert.equal(parts.length, hand.length);
    const prev = legalPlay(choosePlay(d.slice(27, 54), null, level, { oppMin: 27 }), null, level);
    const opts = beatOptions(hand, prev, level);
    for (const o of opts) { assert.ok(legalPlay(o, prev, level), o.join(' ')); assert.ok(takeFrom(hand, o)); }
    const bomb = opts.map(o => isBomb(legalPlay(o, prev, level)));
    assert.ok(bomb.every((b, k) => b || !bomb.slice(0, k).some(Boolean)), 'a bomb before a plain play');
    if (beaters(hand, prev, level).length) assert.ok(opts.length, 'the bot could beat it');
  }
});

test('提示 steps to the next option on each press, and starts over when the table changes', () => {
  let a = 3;
  const g = new GuandanGame({ now: () => 1000, rand: () => ((a = (a * 1103515245 + 12345) >>> 0) / 4294967296),
    schedule: fn => ({ fn }), cancel: () => {}, save: () => {} });
  g.sit('a', 'A');
  g.start('a');
  const i = g.seatOf('a');
  Object.assign(g, { phase: 'playing', turn: i, trick: null });
  g.seats[i].cards = H('3♠ 3♣ 3♦ 4♠ 4♣ 9♠ K♦', g.level);
  const press = () => show(g.hint('a'), g.level);
  assert.deepEqual([press(), press(), press(), press()], ['3 3 3 4 4', '9', 'K', '3 3 3 4 4']);
  const by = (i + 1) % 4;
  g.trick = { play: legalPlay(['5♠1'], null, g.level), cards: ['5♠1'], by };
  assert.deepEqual([press(), press(), press()], ['9', 'K', '9']);
  g.trick = { play: legalPlay(['A♠1'], null, g.level), cards: ['A♠1'], by };
  assert.deepEqual(g.hint('a'), [], 'nothing beats it');
});
