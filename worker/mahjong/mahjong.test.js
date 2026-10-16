// 听牌 hints (MahjongGame.tingFor / view().ting): which tiles win, for how many
// 番, and how many of each the player can't see yet. Run: node --test worker/mahjong/mahjong.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { MahjongGame } from './game.js';

const hooks = () => ({ now: () => 1000, rand: () => 0.3, schedule: () => 1, cancel: () => {}, save: () => {} });
// A hand in play: Ken in seat 0 holding `hand`, the bots holding nothing that matters.
function table(hand, { lack = 'p', melds = [] } = {}) {
  const g = new MahjongGame(hooks());
  g.sit('ken', 'Ken');
  g.start('ken');
  Object.assign(g, { phase: 'playing', stage: 'act', turn: 0, claims: null });
  g.seats.forEach((s, i) => Object.assign(s, { hand: i ? ['m1', 'm1', 'm1', 'm2'] : hand, melds: i ? [] : melds, river: [], won: null, lack, swap: null, drawn: null, tingKey: null }));
  return g;
}
const READY = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 's1', 's1', 's5', 's6']; // waits 4条 / 7条

test('13 in hand and ready: what wins, how many 番, how many left', () => {
  const g = table(READY);
  assert.deepEqual(g.tingFor(0), { now: [{ kind: 's4', fan: 0, left: 4 }, { kind: 's7', fan: 0, left: 4 }] });
});

test('清一色 shows its 番', () => {
  const g = table(['s1', 's1', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's8', 's9', 's9']);
  const now = g.tingFor(0).now;
  // 7条 too: 1条 pair, 123 456 789 789
  assert.deepEqual(now.map(w => [w.kind, w.fan]), [['s7', 2], ['s8', 2], ['s9', 2]]);
});

test('left: tiles in rivers, others’ open melds and winners’ hands are seen; another player’s 暗杠 is not', () => {
  const g = table(READY);
  g.seats[1].river = ['s4'];
  g.seats[2].melds = [{ kind: 's7', type: 'pong', from: 1 }];
  g.seats[3].melds = [{ kind: 's4', type: 'kong', concealed: true }];
  let now = g.tingFor(0).now;
  assert.deepEqual(now.map(w => [w.kind, w.left]), [['s4', 3], ['s7', 1]]);
  g.seats[3].won = { order: 1, tile: 's7', self: true, from: -1, fan: 0 };
  now = g.tingFor(0).now;
  assert.equal(now.find(w => w.kind === 's7').left, 0, 'the last 7条 was someone’s winning tile');
});

test('on your turn: each tile you could throw to be ready, with what it waits on', () => {
  const g = table([...READY, 'p9']);
  const t = g.tingFor(0);
  assert.deepEqual(Object.keys(t.ifDiscard), ['p9']);
  assert.deepEqual(t.ifDiscard.p9.map(w => w.kind), ['s4', 's7']);
});

test('not ready, or still holding the 缺 suit: no hint', () => {
  assert.equal(table(['m1', 'm2', 'm4', 'm5', 'm7', 'm8', 's1', 's3', 's5', 's7', 's9', 's9', 'm9']).tingFor(0), null);
  assert.equal(table([...READY.slice(0, 12), 'p5']).tingFor(0), null);
});

test('the hint goes only to that player, and not after they have won', () => {
  const g = table(READY);
  assert.deepEqual(g.view('ken').ting, g.tingFor(0));
  assert.equal(g.view('someone-watching').ting, null);
  g.seats[0].won = { order: 1, tile: 's4', self: true, from: -1, fan: 0 };
  assert.equal(g.view('ken').ting, null);
});
