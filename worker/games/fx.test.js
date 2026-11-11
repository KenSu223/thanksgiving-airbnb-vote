// The tables' event feed for sounds and callouts (games/fx.js): numbered, short, public only.
// Run: node --test worker/games/fx.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { note, FX_KEEP } from './fx.js';
import { MahjongGame } from '../mahjong/game.js';
import { DdzGame } from '../ddz/game.js';
import { GuandanGame } from '../guandan/game.js';

const hooks = () => ({ now: () => 1000, rand: () => 0.3, schedule: () => 1, cancel: () => {}, save: () => {} });
const kinds = g => g.fx.map(e => e.k);

test('note: numbered from 1, only the last few kept', () => {
  const g = {};
  for (let i = 0; i < FX_KEEP + 5; i++) note(g, { k: 'x', i });
  assert.equal(g.fx.length, FX_KEEP);
  assert.deepEqual(g.fx.map(e => e.n), Array.from({ length: FX_KEEP }, (_, i) => i + 6));
  assert.equal(g.fx.at(-1).i, FX_KEEP + 4);
});

test('川麻: deal, 换三张, discards with the tile, 碰; a 暗杠 never names its tile; everyone gets the same list', () => {
  const g = new MahjongGame(hooks());
  g.sit('ken', 'Ken'); g.sit('nan', 'Nan');
  g.start('ken');
  assert.deepEqual(kinds(g), ['deal']);
  // the two bots have picked; Ken and Nan pass three tiles of one suit each, then everyone picks a suit to give up
  for (const k of ['ken', 'nan']) {
    const hand = g.seats[g.seatOf(k)].hand, suit = ['m', 's', 'p'].find(s => hand.filter(x => x[0] === s).length >= 3);
    assert.equal(g.swap(k, hand.filter(x => x[0] === suit).slice(0, 3)), null);
  }
  assert.deepEqual(kinds(g), ['deal', 'swap']);
  assert.ok([1, 2, 3].includes(g.fx[1].dir));
  // a hand in play, set up by hand: seat 0 throws 5万, seat 1 holds two and takes it
  Object.assign(g, { phase: 'playing', stage: 'act', turn: 0, claims: null, wall: g.wall.length ? g.wall : ['m9'] });
  g.seats.forEach((s, i) => Object.assign(s, { hand: i === 0 ? ['m5', 's1', 's1', 's1', 's1'] : i === 1 ? ['m5', 'm5', 'm7', 'm8'] : ['p1', 'p2', 'p3', 'p9'], melds: [], river: [], won: null, lack: i === 1 ? 's' : 'p', swap: null, drawn: null, passHu: false, afterPong: false }));
  g.doDiscard(0, 'm5');
  assert.deepEqual(g.fx.at(-1), { n: g.fxN, k: 'discard', seat: 0, tile: 'm5' });
  assert.equal(g.claim('nan', 'pong'), null);
  assert.deepEqual(g.fx.at(-1), { n: g.fxN, k: 'pong', seat: 1, tile: 'm5' });
  // seat 0 again, with four 1条 in hand: a 暗杠 is announced, the tile is not
  Object.assign(g, { stage: 'act', turn: 0 });
  g.doKong(0, 's1');
  const kong = g.fx.find(e => e.k === 'kong');
  assert.deepEqual({ seat: kong.seat, how: kong.how, tile: kong.tile }, { seat: 0, how: '暗杠', tile: undefined });
  assert.deepEqual(g.view('ken').fx, g.view('nan').fx);
  assert.deepEqual(g.view('nobody').fx, g.fx);
});

test('川麻: a win and the end of the hand are announced', () => {
  const g = new MahjongGame(hooks());
  g.sit('ken', 'Ken');
  g.start('ken');
  Object.assign(g, { phase: 'playing', stage: 'act', turn: 0, claims: null });
  g.seats.forEach((s, i) => Object.assign(s, { hand: i ? ['m1', 'm1', 'm1', 'm2'] : ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 's1', 's1', 's5', 's6', 's7'], melds: [], river: [], won: null, lack: 'p', swap: null, drawn: 's7' }));
  assert.equal(g.selfHu('ken'), null);
  const hu = g.fx.find(e => e.k === 'hu');
  assert.deepEqual({ seat: hu.seat, self: hu.self, tile: hu.tile }, { seat: 0, self: true, tile: 's7' });
  g.endHand();
  assert.deepEqual(g.fx.at(-1), { n: g.fxN, k: 'end', wins: 1 });
});

test('斗地主: deal, each bid, the landlord, plays with their shape and how many are left, passes, the end', () => {
  const g = new DdzGame(hooks());
  g.sit('ken', 'Ken');
  g.start('ken');
  assert.deepEqual(kinds(g), ['deal']);
  // Ken calls on his turn (bots before him have answered already); nobody grabs
  while (g.phase === 'bidding') { if (g.turn === g.seatOf('ken')) g.bidAction('ken', g.bid.stage === 'call'); else g.botMove(g.turn); }
  assert.ok(g.fx.some(e => e.k === 'bid' && /地主|不叫|不抢/.test(e.say)));
  const lord = g.fx.find(e => e.k === 'lord');
  assert.equal(lord.seat, g.landlord);
  // the landlord leads a single: the smallest card
  const i = g.landlord, hand = g.seats[i].cards, card = hand[hand.length - 1];
  assert.equal(g.doPlay(i, [card]), null);
  const p = g.fx.at(-1);
  assert.deepEqual({ k: p.k, seat: p.seat, type: p.type, count: p.count, left: p.left }, { k: 'play', seat: i, type: 'single', count: 1, left: 19 });
  // the next seat passes
  assert.equal(g.doPass(g.turn), null);
  assert.equal(g.fx.at(-1).k, 'pass');
  // play it out with the bots
  for (let n = 0; n < 400 && g.phase === 'playing'; n++) g.botMove(g.turn);
  assert.equal(g.phase, 'result');
  const end = g.fx.at(-1);
  assert.deepEqual({ k: end.k, landlord: end.landlord, landlordWin: end.landlordWin }, { k: 'end', landlord: g.landlord, landlordWin: g.result.landlordWin });
  assert.ok(g.view('ken').fx.length <= FX_KEEP);
});

test('掼蛋: deal, plays, whoever goes out and in which place, the end', () => {
  const g = new GuandanGame(hooks());
  g.sit('ken', 'Ken');
  g.start('ken');
  assert.deepEqual(kinds(g), ['deal']);
  const seen = [];
  for (let n = 0; n < 2000 && g.phase === 'playing'; n++) { g.botMove(g.turn); for (const e of g.fx) if (!seen.some(x => x.n === e.n)) seen.push(e); }
  assert.equal(g.phase, 'result');
  assert.ok(seen.some(e => e.k === 'play' && e.type && e.count >= 1));
  assert.deepEqual(seen.filter(e => e.k === 'out').map(e => e.place).slice(0, 2), [1, 2]);
  assert.deepEqual(seen.filter(e => e.k === 'out').map(e => e.seat), g.result.order.slice(0, seen.filter(e => e.k === 'out').length));
  assert.equal(seen.at(-1).k, 'end');
});

test('the numbering carries over a save and restore, so a page never replays old events', () => {
  const g = new DdzGame(hooks());
  g.sit('ken', 'Ken');
  g.start('ken');
  const before = g.fxN;
  const again = new DdzGame(hooks());
  assert.equal(again.restore(g.snapshot()), true);
  assert.equal(again.fxN, before);
  note(again, { k: 'pass', seat: 0 });
  assert.equal(again.fx.at(-1).n, before + 1);
});
