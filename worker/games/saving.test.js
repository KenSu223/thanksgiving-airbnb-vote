// Saving 斗地主, 川麻 and 21 点 (games/saving.js, the shared hall in games/hall.js,
// blackjack/table.js): a table survives a restart, a hand left alone with bots
// is parked and comes back on 开始, 不打这把了 throws it away, and 豆子 / chips
// are saved after every hand. (掼蛋 has its own: guandan/save.test.js.)
// Run: node --test worker/games/saving.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { DdzHall } from '../ddz/hall.js';
import { DdzGame } from '../ddz/game.js';
import { MahjongHall } from '../mahjong/hall.js';
import { MahjongGame } from '../mahjong/game.js';
import { BlackjackTable } from '../blackjack/table.js';
import { BlackjackGame } from '../blackjack/game.js';

// A Durable Object's storage, in memory (shared between "deploys" of the same object).
function storage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    m,
    list: async ({ prefix }) => new Map([...m].filter(([k]) => k.startsWith(prefix))),
    get: async k => m.get(k),
    put: async (k, v) => { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) m.set(a, b); else m.set(k, v); },
    delete: async k => { for (const x of [].concat(k)) m.delete(x); },
  };
}
const stop = hall => { hall.tables.forEach(t => t.clearTimer()); clearTimeout(hall.ghostTimer); clearInterval(hall.sweeper); };
// A game on its own with a clock we turn by hand: run() fires the timers in
// order until `until()` holds.
function manual(Game, saved = []) {
  const q = [];
  const g = new Game({
    now: () => 1000, rand: Math.random, save: s => saved.push({ ...s }),
    schedule: fn => { const t = { fn }; q.push(t); return t; },
    cancel: t => { const i = q.indexOf(t); if (i >= 0) q.splice(i, 1); },
  });
  g.run = (until, max = 5000) => { for (let n = 0; n < max && !until(); n++) { const t = q.shift(); if (!t) break; t.fn(); } };
  return g;
}
const same = v => ({ ...v, now: 0, deadline: 0 }); // the clock isn't part of the table

for (const [label, Hall, Game] of [['斗地主', DdzHall, DdzGame], ['川麻', MahjongHall, MahjongGame]]) {
  test(`${label}: snapshot → restore gives back the same table, and resume restarts its clock`, () => {
    const a = manual(Game);
    a.sit('ken', 'Ken', null);
    a.start('ken');
    const b = manual(Game);
    assert.ok(b.restore(a.snapshot()));
    assert.deepEqual(same(b.view('ken')), same(a.view('ken')));
    assert.equal(b.deadline, 0, 'no clock until resume');
    b.resume();
    assert.ok(b.deadline > 0, 'the clock is running again');
    assert.equal(b.restore({ v: 999 }), false, 'a snapshot from another version is refused');
  });

  test(`${label}: a restart carries the hand on; nobody comes back → parked under them`, async () => {
    const s = storage();
    const h1 = new Hall({ storage: s }, {});
    await h1.load();
    const t1 = h1.tables[0];
    t1.sit('ken', 'Ken', null);
    t1.start('ken');
    h1.broadcast();
    assert.ok(s.m.get('t:1'), 'the table was written');
    const before = t1.view('ken');
    stop(h1);
    const h2 = new Hall({ storage: s }, {}); // the deploy
    await h2.load();
    const t2 = h2.tables[0];
    assert.equal(t2.seatOf('ken'), before.you);
    assert.deepEqual(same(t2.view('ken')), same(before));
    assert.ok(t2.deadline > 0, 'its clock is running');
    assert.equal(t2.seats[before.you].connected, true, 'counts as here until the reconnect time is up');
    h2.dropGhosts();
    assert.equal(t2.humans().length, 0);
    assert.ok(s.m.get('m:ken'), 'parked');
    assert.ok(s.m.get('p:ken'), '豆子 saved');
    stop(h2);
  });

  test(`${label}: alone with bots, standing up mid-hand parks it; 开始 alone elsewhere brings it back`, async () => {
    const s = storage({ 'p:ken': { name: 'Ken', points: 1300, refills: 1, games: 4, wins: 3 } });
    const h = new Hall({ storage: s }, {});
    await h.load();
    const t = h.tables[0];
    t.sit('ken', 'Ken', h.board.get('ken'));
    t.start('ken');
    const i = t.seatOf('ken'), mine = t.view('ken').seats[i], phase = t.phase, turn = t.turn;
    assert.equal(t.leave('ken'), '这把存好了，下次一个人坐下点「开始」就接着打');
    assert.equal(t.humans().length, 0, 'the table is free again');
    assert.equal(t.phase, 'waiting');
    h.board.set('ken', { ...h.board.get('ken'), points: 1250 }); // played somewhere in between
    const u = h.tables[2];
    u.sit('ken', 'Ken', h.board.get('ken'));
    assert.equal(u.phase, 'waiting', 'sitting down doesn’t bring it back yet');
    assert.deepEqual(u.view('ken').parked, { inHand: true, round: 1 });
    assert.equal(u.start('ken'), null);
    assert.equal(u.seatOf('ken'), i);
    assert.deepEqual([u.phase, u.turn], [phase, turn]);
    assert.deepEqual(u.view('ken').seats[i][label === '斗地主' ? 'cards' : 'hand'], mine[label === '斗地主' ? 'cards' : 'hand']);
    assert.equal(u.view('ken').resumed, true);
    assert.equal(u.seats[i].points, 1250, 'the record saved since wins');
    assert.ok(u.deadline > 0, 'its clock is running');
    assert.equal(s.m.get('m:ken'), undefined, 'used up');
    assert.equal(u.view('ken').parked, null);
    stop(h);
  });

  test(`${label}: with a friend the parked hand waits; 不打这把了 alone throws it away`, async () => {
    const h = new Hall({ storage: storage() }, {});
    await h.load();
    const t = h.tables[0];
    t.sit('ken', 'Ken', null);
    t.start('ken');
    t.leave('ken');
    const u = h.tables[1];
    u.sit('ken', 'Ken', h.board.get('ken')); u.sit('nan', 'Nan', null);
    assert.equal(u.view('ken').parked, null, 'not offered with someone else at the table');
    u.start('nan');
    assert.equal(u.round, 1, 'a fresh hand');
    assert.equal(u.view('ken').resumed, false);
    assert.ok(h.parked.has('ken'), 'still parked for later');
    // with nan there, leaving plays the hand out (托管) instead of parking it
    assert.equal(u.leave('ken'), undefined);
    assert.equal(u.seats[u.seatOf('ken')].leaving, true);
    u.clear();
    const v = h.tables[2];
    v.sit('ken', 'Ken', h.board.get('ken'));
    assert.equal(v.endMatch('ken'), null);
    assert.equal(h.parked.has('ken'), false, 'thrown away');
    assert.equal(v.endMatch('ken'), '没有存着的牌局');
    assert.equal(v.start('ken'), null);
    assert.equal(v.round, 1, '开始 deals a fresh hand');
    stop(h);
  });

  test(`${label}: 豆子 are saved at the end of every hand`, () => {
    const saved = [];
    const g = manual(Game, saved);
    g.sit('ken', 'Ken', null);
    g.start('ken');
    g.setAuto('ken', true);
    g.run(() => g.phase === 'result');
    assert.equal(g.phase, 'result');
    const rec = saved.filter(s => s.key === 'ken');
    assert.equal(rec.length, 1, 'saved once, at the end of the hand');
    assert.equal(rec[0].points, g.seats[g.seatOf('ken')].points);
    assert.equal(rec[0].games, 1);
  });
}

test('川麻: someone who has 胡\'d and leaves isn’t parked (托管 plays the rest, as before)', async () => {
  const h = new MahjongHall({ storage: storage() }, {});
  await h.load();
  const t = h.tables[0];
  t.sit('ken', 'Ken', null);
  t.start('ken');
  t.seats[t.seatOf('ken')].won = { order: 1, tile: 'm1', self: true, from: -1, fan: 0 };
  assert.equal(t.leave('ken'), undefined);
  assert.equal(h.parked.has('ken'), false);
  assert.equal(t.seats[t.seatOf('ken')].leaving, true);
  stop(h);
});

// 21 点: the deck is stacked so Ken has 8+7 against the dealer's 10+9.
const stack = g => { g.shoe = Array(80).fill('5♠').concat(['9♣', '7♦', '10♥', '8♠']); };

test('21 点: snapshot → restore, and resume restarts whichever clock was running', () => {
  const a = manual(BlackjackGame);
  a.sit('ken', 'Ken', null); a.sit('nan', 'Nan', null);
  a.bet('ken', 50);
  assert.equal(a.phase, 'betting');
  let b = manual(BlackjackGame);
  assert.ok(b.restore(a.snapshot()));
  assert.deepEqual(same(b.view()), same(a.view()));
  b.resume();
  assert.ok(b.deadline > 0, 'the betting clock');
  stack(a);
  a.bet('nan', 20);
  assert.deepEqual([a.phase, a.turnKey], ['playing', 'ken']);
  b = manual(BlackjackGame);
  b.restore(a.snapshot());
  b.resume();
  assert.equal(b.turnKey, 'ken');
  assert.ok(b.deadline > 0, 'ken’s turn clock');
  assert.equal(b.restore({ v: 999 }), false);
});

test('21 点: chips are saved after every hand', () => {
  const saved = [];
  const g = manual(BlackjackGame, saved);
  g.sit('ken', 'Ken', null);
  stack(g);
  g.bet('ken', 100);
  g.act('ken', 'stand');
  assert.equal(g.phase, 'result');
  assert.deepEqual(saved.map(s => [s.key, s.chips]), [['ken', 900]]);
});

test('21 点: a restart carries the hand on; nobody comes back → it plays out and the chips are saved', async () => {
  const s = storage();
  const t1 = new BlackjackTable({ storage: s }, {});
  await t1.load();
  t1.game.sit('ken', 'Ken', null);
  stack(t1.game);
  t1.game.bet('ken', 100);
  t1.broadcast();
  assert.ok(s.m.get('t:1'), 'the table was written');
  t1.game.clearTimer();
  const t2 = new BlackjackTable({ storage: s }, {}); // the deploy
  await t2.load();
  const ken = t2.game.seat('ken');
  assert.deepEqual([ken.cards, ken.bet, ken.connected, t2.game.turnKey], [['8♠', '7♦'], 100, true, 'ken']);
  assert.ok(t2.game.deadline > 0, 'ken’s turn clock is running again');
  assert.ok(t2.ghostTimer, 'waits for people to come back');
  clearTimeout(t2.ghostTimer);
  t2.dropGhosts();
  assert.equal(t2.game.seats.length, 0);
  assert.equal(s.m.get('p:ken').chips, 900, 'the hand played out as a stand: 15 loses to 19');
  assert.deepEqual(JSON.parse(s.m.get('t:1')).seats, [], 'the empty table was written');
  t2.game.clearTimer();
  // a table saved by another version is ignored: a fresh table
  const t3 = new BlackjackTable({ storage: storage({ 't:1': JSON.stringify({ v: 999, seats: [{ key: 'x' }] }) }) }, {});
  await t3.load();
  assert.deepEqual([t3.game.seats.length, t3.ghostTimer], [0, undefined]);
});
