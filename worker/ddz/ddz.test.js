import test from 'node:test';
import assert from 'node:assert/strict';
import { deck, legalPlay, readPlay, shuffle, takeFrom, value } from './cards.js';
import { beatOptions, leadOptions } from './hints.js';
import { choosePlay } from './bot.js';
import { DdzGame } from './game.js';

const P = cards => readPlay(cards)[0]; // the play these cards make
const ranks = cards => cards.map(value).sort((a, b) => a - b);

test('提示 lists every way to beat the table, cheapest first, all legal', () => {
  const hand = ['7♠', '7♥', '9♣', '2♦', 'sj', 'bj', 'K♠', 'K♥', 'K♣', 'K♦'];
  const opts = beatOptions(hand, P(['5♠']));
  assert.deepEqual(opts.map(ranks), [[9], [15], [7], [13], [16], [17], [13, 13, 13, 13], [16, 17]]);
  for (const o of opts) { assert.ok(legalPlay(o, P(['5♠'])), o.join()); assert.ok(takeFrom(hand, o)); }
});

test('when only a split bomb or the bomb beats it, 提示 still finds it (the bot would pass)', () => {
  const hand = ['3♠', '4♠', '6♥', 'K♠', 'K♥', 'K♣', 'K♦'];
  const prev = P(['Q♠', 'Q♥']);
  assert.equal(choosePlay(hand, prev, { oppMin: 17 }), null, 'the bot holds back');
  assert.deepEqual(beatOptions(hand, prev).map(ranks), [[13, 13], [13, 13, 13, 13]]);
});

test("a farmer whose teammate led can still be shown a beat", () => {
  const hand = ['8♠', '8♥', 'J♣', 'A♦'];
  const prev = P(['6♣', '6♦']);
  assert.equal(choosePlay(hand, prev, { teammateLed: true, oppMin: 10 }), null);
  assert.deepEqual(beatOptions(hand, prev).map(ranks), [[8, 8]]);
});

test('runs, triples with kickers, planes and four-with-two', () => {
  assert.deepEqual(beatOptions(['4♠', '5♠', '6♥', '7♣', '8♦', '9♠', 'K♥'], P(['3♠', '4♥', '5♣', '6♦', '7♠'])).map(ranks),
    [[4, 5, 6, 7, 8], [5, 6, 7, 8, 9]]);
  assert.deepEqual(beatOptions(['5♠', '5♥', '5♣', '6♦', '9♠', '9♥', '9♣', '9♦'], P(['3♠', '3♥', '3♣', '4♦'])).map(ranks),
    [[5, 5, 5, 6], [6, 9, 9, 9], [9, 9, 9, 9]]);
  const plane = beatOptions(['6♠', '6♥', '6♣', '7♠', '7♥', '7♣', '3♦', 'J♠', 'Q♠'], P(['4♠', '4♥', '4♣', '5♠', '5♥', '5♣', '8♦', '9♦']));
  assert.deepEqual(plane.map(ranks), [[3, 6, 6, 6, 7, 7, 7, 11]]);
  const four2 = beatOptions(['J♠', 'J♥', 'J♣', 'J♦', '3♠', '4♥'], P(['8♠', '8♥', '8♣', '8♦', '5♠', '6♥']));
  assert.deepEqual(four2.map(ranks), [[3, 4, 11, 11, 11, 11], [11, 11, 11, 11]]);
});

test('nothing beats it: no options; a bomb on the table only falls to a bigger bomb or the rocket', () => {
  assert.deepEqual(beatOptions(['3♠', '4♥', '9♣', 'K♦'], P(['A♠', 'A♥'])), []);
  assert.deepEqual(beatOptions(['5♠', '5♥', '5♣', '5♦', 'Q♠', 'Q♥', 'Q♣', 'Q♦', 'sj', 'bj'], P(['9♠', '9♥', '9♣', '9♦'])).map(ranks),
    [[12, 12, 12, 12], [16, 17]]);
  assert.deepEqual(beatOptions(['2♠', '2♥', '2♣', '2♦'], P(['sj', 'bj'])), []);
});

test('random hands: whenever the bot can beat it, so can 提示; every option is legal', () => {
  let a = 7;
  const rand = () => ((a = (a * 1103515245 + 12345) >>> 0) / 4294967296);
  for (let round = 0; round < 400; round++) {
    const d = shuffle(deck(), rand);
    const hand = d.slice(0, 17), other = d.slice(17, 34);
    const lead = choosePlay(other, null, {});
    const prev = legalPlay(lead, null);
    const opts = beatOptions(hand, prev);
    const bot = choosePlay(hand, prev, { oppMin: 1 }); // the bot at its most willing
    if (bot) assert.ok(opts.length, `bot beats ${lead.join(' ')} with ${bot.join(' ')}, 提示 found nothing`);
    for (const o of opts) { assert.ok(legalPlay(o, prev), o.join(' ') + ' vs ' + lead.join(' ')); assert.ok(takeFrom(hand, o)); }
  }
});

test('3带2 takes the small spare pair (33344, not 33322); splitting or a 2 only when it has to', () => {
  assert.deepEqual(leadOptions(['3♠', '3♥', '3♣', '4♠', '4♥', '2♠', '2♥']).map(ranks), [[3, 3, 3, 4, 4], [15, 15]]);
  const prev = P(['3♦', '3♥', '3♣', '5♠', '5♥']);
  assert.deepEqual(beatOptions(['6♠', '6♥', '6♣', '4♠', '4♥', '2♠', '2♥', '9♦'], prev).map(ranks), [[4, 4, 6, 6, 6]]);
  // no spare small pair: a pair split off the other triple first, the 22 on the next press
  assert.deepEqual(beatOptions(['4♠', '4♥', '4♣', '7♠', '7♥', '7♣', '2♠', '2♥', '9♦'], prev).map(ranks),
    [[4, 4, 4, 7, 7], [4, 4, 4, 15, 15], [4, 4, 7, 7, 7], [7, 7, 7, 15, 15]]);
});

test('kickers keep straights and bombs whole, and are a 2 or a joker only when nothing smaller will do', () => {
  const t1 = P(['4♠', '4♥', '4♣', '5♠']);
  // 888 + 9 10 J Q K + 2: the 2, not the 9 off the straight (that one comes after)
  assert.deepEqual(beatOptions(['8♠', '8♥', '8♣', '9♠', '10♠', 'J♥', 'Q♣', 'K♦', '2♠'], t1).map(ranks), [[8, 8, 8, 15], [8, 8, 8, 9]]);
  // 777 + 3333 + K: the K, not a 3 out of the bomb
  assert.deepEqual(beatOptions(['7♠', '7♥', '7♣', '3♠', '3♥', '3♣', '3♦', 'K♦'], t1).map(ranks)[0], [7, 7, 7, 13]);
  // 555 + 8 + 2 + 小王: the 8; with only big cards left, the 2 before the joker
  assert.deepEqual(beatOptions(['5♠', '5♥', '5♣', '8♦', '2♠', 'sj'], t1).map(ranks)[0], [5, 5, 5, 8]);
  assert.deepEqual(beatOptions(['5♠', '5♥', '5♣', 'sj', '2♠'], t1).map(ranks), [[5, 5, 5, 15]]);
  // 3 4 5 5 6 7 888 22 against 三带二: 88822 keeps 34567 (55 would break it), then 55888
  assert.deepEqual(beatOptions(['3♠', '4♠', '5♠', '5♥', '6♠', '7♠', '8♠', '8♥', '8♣', '2♠', '2♥'], P(['3♥', '3♣', '3♦', '6♥', '6♣'])).map(ranks),
    [[8, 8, 8, 15, 15], [5, 5, 8, 8, 8]]);
});

test('beating a single or a pair keeps runs whole: the end of a long straight, a pair outside the 连对', () => {
  assert.deepEqual(beatOptions(['3♠', '4♠', '5♠', '6♠', '7♠', '8♠', '9♠', 'J♥', 'Q♥', 'Q♣', '2♦'], P(['5♥'])).map(ranks),
    [[9], [11], [15], [12], [6], [7], [8]]);
  assert.deepEqual(beatOptions(['4♠', '4♥', '5♠', '5♥', '6♠', '6♥', '9♠', '9♥', 'J♦'], P(['3♠', '3♥'])).map(ranks),
    [[9, 9], [4, 4], [5, 5], [6, 6]]);
});

test('leading: the smallest group first (triples carry the smallest spare card), runs kept whole, bombs last', () => {
  assert.deepEqual(leadOptions(['3♠', '5♠', '5♥', '5♣', 'K♠', 'K♥', '2♦']).map(ranks), [[3, 5, 5, 5], [13, 13], [15]]);
  // the bot would lead 3–J and leave 4 5 6 behind
  assert.deepEqual(leadOptions(['3♠', '4♠', '4♥', '5♠', '5♥', '6♠', '6♥', '7♠', '8♠', '9♠', '10♠', 'J♠']).map(ranks),
    [[3], [4, 4, 5, 5, 6, 6], [7, 8, 9, 10, 11]]);
  assert.deepEqual(leadOptions(['3♠', '3♥', '3♣', '3♦', '5♠', '8♥', '9♣', 'sj', 'bj']).map(ranks), [[5], [8], [9], [3, 3, 3, 3], [16, 17]]);
  // the whole hand when it goes out in one play
  assert.deepEqual(leadOptions(['3♠', '3♥', '3♣', '3♦', '5♠', '8♥']).map(ranks)[0], [3, 3, 3, 3, 5, 8]);
  // an opponent down to one card: singles last, the biggest first
  assert.deepEqual(leadOptions(['3♠', '9♥', '7♠', '7♥'], { oppMin: 1 }).map(ranks), [[7, 7], [9], [3]]);
});

test('random hands: every lead option is legal and together they are the whole hand', () => {
  let a = 11;
  const rand = () => ((a = (a * 1103515245 + 12345) >>> 0) / 4294967296);
  for (let round = 0; round < 300; round++) {
    const hand = shuffle(deck(), rand).slice(0, 20);
    const opts = leadOptions(hand);
    for (const o of opts) { assert.ok(legalPlay(o, null), o.join(' ')); assert.ok(takeFrom(hand, o)); }
    const parts = opts.slice(legalPlay(hand, null) && opts.length > 1 ? 1 : 0).flat();
    assert.equal(parts.length, hand.length);
    assert.ok(takeFrom(hand, parts));
  }
});

// A table of three people with hand-driven timers.
function table() {
  let a = 3;
  const g = new DdzGame({ now: () => 1000, rand: () => ((a = (a * 1103515245 + 12345) >>> 0) / 4294967296),
    schedule: fn => ({ fn }), cancel: () => {}, save: () => {} });
  for (const k of ['a', 'b', 'c']) g.sit(k, k.toUpperCase());
  g.start('a');
  return { g, timeUp: () => g.timer.fn() };
}

test('time up while bidding is 不叫 (or 不抢) — nobody is made landlord without saying so', () => {
  const { g, timeUp } = table();
  assert.equal(g.phase, 'bidding');
  const first = g.turn;
  timeUp();
  assert.equal(g.said[first], '不叫');
  assert.notEqual(g.turn, first);
  // another table: the first one calls, the next one runs out of time in the grab round
  const t2 = table();
  t2.g.bidAction(t2.g.seats[t2.g.turn].key, true);
  const grabber = t2.g.turn;
  t2.timeUp();
  assert.equal(t2.g.said[grabber], '不抢');
  assert.equal(t2.g.phase, 'bidding');
});

test('three 不叫: shuffled and dealt again, and the page is told', () => {
  const { g, timeUp } = table();
  const round = g.round, hand = g.seats[0].cards.join();
  timeUp(); timeUp(); timeUp();
  assert.equal(g.phase, 'bidding');
  assert.equal(g.round, round + 1);
  assert.notEqual(g.seats[0].cards.join(), hand);
  assert.deepEqual(g.said, [null, null, null]);
  assert.equal(g.view('a').redealtAt, 1000);
});

test('提示 steps to the next option on each press, and starts over when the table changes', () => {
  const { g } = table();
  const i = g.seatOf('a');
  Object.assign(g, { phase: 'playing', landlord: i, turn: i, trick: null });
  g.seats[i].cards = ['3♠', '3♥', '3♣', '4♠', '4♥', '2♠', '2♥'];
  const press = () => ranks(g.hint('a'));
  assert.deepEqual([press(), press(), press()], [[3, 3, 3, 4, 4], [15, 15], [3, 3, 3, 4, 4]]);
  g.trick = { play: P(['3♦', '3♣']), cards: ['3♦', '3♣'], by: (i + 1) % 3 };
  assert.deepEqual([press(), press(), press()], [[4, 4], [15, 15], [4, 4]]);
  g.trick = { play: P(['K♦', 'K♣']), cards: ['K♦', 'K♣'], by: (i + 2) % 3 };
  assert.deepEqual(press(), [15, 15]);
  g.trick = { play: P(['A♦']), cards: ['A♦'], by: (i + 1) % 3 };
  assert.deepEqual(press(), [15]);
  g.trick = { play: P(['2♦']), cards: ['2♦'], by: (i + 1) % 3 };
  assert.deepEqual(g.hint('a'), [], 'nothing beats it');
});
