// 掼蛋 saving (worker/guandan/game.js + the shared hall, worker/games/hall.js):
// a table survives a restart, a match left alone with bots is parked and comes
// back, 结束比赛, 豆子 saved every hand, the 过 A bonus, and who's watching.
// Run: node --test worker/guandan/save.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { GuandanHall } from './hall.js';
import { GuandanGame, GD } from './game.js';

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
const sitAndStart = (hall, room, key, name) => {
  const t = hall.tables[room - 1];
  t.sit(key, name, hall.board.get(key));
  t.start(key);
  return t;
};
// A game on its own, with clocks that never fire.
const game = (saved = []) => new GuandanGame({ now: () => 1000, rand: Math.random, schedule: () => 1, cancel: () => {}, save: s => saved.push({ ...s }) });

test('snapshot → restore gives back the same table, and resume restarts its clock', () => {
  const a = game();
  a.sit('ken', 'Ken', null);
  a.start('ken');
  const b = game();
  assert.ok(b.restore(a.snapshot()));
  const same = v => ({ ...v, now: 0, deadline: 0 }); // the clock isn't part of the table
  assert.deepEqual(same(b.view('ken')), same(a.view('ken')));
  assert.equal(b.deadline, 0, 'no clock until resume');
  b.resume();
  if (b.phase === 'playing') assert.ok(b.deadline > 0, 'a turn clock is running again');
  assert.equal(b.restore({ v: 999 }), false, 'a snapshot from another version is refused');
});

test('a restart carries the hand on: same cards, same turn, the player still seated', async () => {
  const s = storage();
  const h1 = new GuandanHall({ storage: s }, {});
  await h1.load();
  const t1 = sitAndStart(h1, 1, 'ken', 'Ken');
  h1.broadcast();
  assert.ok(s.m.get('t:1'), 'the table was written');
  const before = t1.view('ken');
  stop(h1);
  const h2 = new GuandanHall({ storage: s }, {}); // the deploy
  await h2.load();
  const t2 = h2.tables[0];
  assert.equal(t2.seatOf('ken'), before.you);
  assert.deepEqual(t2.view('ken').seats[before.you].cards, before.seats[before.you].cards);
  assert.equal(t2.phase, before.phase);
  assert.equal(t2.turn, before.turn);
  assert.equal(t2.seats[before.you].connected, true, 'counts as here until the reconnect time is up');
  // nobody came back: they count as gone — alone with bots, so the match is parked under them
  h2.dropGhosts();
  assert.equal(t2.humans().length, 0);
  assert.ok(s.m.get('m:ken'), 'parked');
  stop(h2);
});

test('alone with bots: standing up mid-hand parks the match; sitting down alone again resumes it', async () => {
  const s = storage({ 'p:ken': { name: 'Ken', points: 1200, refills: 0, games: 3, wins: 2 } });
  const h = new GuandanHall({ storage: s }, {});
  await h.load();
  const t = sitAndStart(h, 1, 'ken', 'Ken');
  t.levels = [9, 4]; t.banker = 0; // a match well under way
  const i = t.seatOf('ken'), cards = t.seats[i].cards.slice(), turn = t.turn, phase = t.phase;
  assert.equal(t.leave('ken'), '这局存好了，下次一个人坐下点「开始」就接着打');
  assert.equal(t.humans().length, 0, 'the table is free again');
  assert.equal(t.phase, 'waiting');
  // back at another table, alone: the table says a match is waiting; 开始 brings it back
  const u = h.tables[2];
  u.sit('ken', 'Ken', h.board.get('ken'));
  assert.equal(u.phase, 'waiting', 'sitting down alone doesn’t bring it back yet');
  const pk = u.view('ken').parked;
  assert.deepEqual([pk.us, pk.them, pk.inHand], [i % 2 ? 4 : 9, i % 2 ? 9 : 4, true]);
  assert.equal(u.view('ken').canEnd, true);
  assert.equal(u.start('ken'), null);
  assert.equal(u.seatOf('ken'), i);
  assert.deepEqual(u.seats[i].cards, cards);
  assert.deepEqual([u.levels, u.banker, u.turn, u.phase], [[9, 4], 0, turn, phase]);
  assert.equal(u.view('ken').resumed, true);
  assert.equal(u.seats[i].points, 1200, 'the saved record wins');
  assert.equal(s.m.get('m:ken'), undefined, 'used up');
  stop(h);
});

test('a parked match: sitting down with a friend plays a fresh match; 结束比赛 alone throws the parked one away', async () => {
  const s = storage();
  const h = new GuandanHall({ storage: s }, {});
  await h.load();
  const t = sitAndStart(h, 1, 'ken', 'Ken');
  t.levels = [7, 5]; t.banker = 1;
  t.leave('ken');
  const u = h.tables[1];
  u.sit('ken', 'Ken', h.board.get('ken')); u.sit('nan', 'Nan', null);
  assert.equal(u.view('ken').parked, null, 'not offered with someone else at the table');
  u.start('nan');
  assert.deepEqual(u.levels, [2, 2], 'a fresh match');
  assert.ok(h.parked.has('ken'), 'still parked for later');
  stop(h);
  const v = h.tables[2];
  u.clear();
  v.sit('ken', 'Ken', h.board.get('ken'));
  assert.equal(v.endMatch('ken'), null);
  assert.equal(h.parked.has('ken'), false, 'thrown away');
  assert.equal(v.view('ken').endedBy, 'Ken');
  stop(h);
});

test('not parked with other people at the table (a bot plays your hand out, as before)', async () => {
  const h = new GuandanHall({ storage: storage() }, {});
  await h.load();
  const t = h.tables[0];
  t.sit('ken', 'Ken', null); t.sit('nan', 'Nan', null);
  t.start('ken');
  assert.equal(t.leave('ken'), undefined);
  const s = t.seats.find(x => x && x.key === 'ken');
  assert.ok(s.leaving && s.auto);
  assert.equal(h.parked.size, 0);
  stop(h);
});

test('结束比赛: alone, any time; with others, only between hands', () => {
  const g = game();
  g.sit('ken', 'Ken', null);
  g.start('ken');
  g.levels = [10, 3]; g.banker = 0;
  assert.equal(g.view('ken').canEnd, true);
  assert.equal(g.endMatch('ken'), null);
  assert.deepEqual([g.levels, g.banker, g.phase, g.view('ken').endedBy], [[2, 2], -1, 'waiting', 'Ken']);
  assert.equal(g.endMatch('ken'), '还没开始呢');
  const m = game();
  m.sit('ken', 'Ken', null); m.sit('nan', 'Nan', null);
  m.start('ken');
  assert.equal(m.view('ken').canEnd, false);
  assert.equal(m.endMatch('nan'), '这一手打完才能结束比赛');
});

test('every hand saves 豆子; 过 A pays 60 plus the bonus to each winner, and counts it', () => {
  const saved = [];
  const g = game(saved);
  g.sit('ken', 'Ken', null);
  g.start('ken');
  const i = g.seatOf('ken'), us = i % 2;
  // Ken's team at its own A, Ken out first, partner second: the match
  Object.assign(g, { phase: 'playing', levels: us ? [2, 14] : [14, 2], banker: us, order: [i, (i + 2) % 4], turn: (i + 1) % 4 });
  g.endHand();
  const s = g.seats[i];
  assert.equal(g.result.matchWon, true);
  assert.equal(g.result.bonus, GD.aceBonus);
  assert.equal(s.points, GD.startPoints + GD.matchBonus + GD.aceBonus);
  assert.equal(s.aces, 1);
  assert.ok(saved.some(x => x.key === 'ken' && x.points === s.points), 'saved right after the hand');
});

test('who is watching a table', async () => {
  const h = new GuandanHall({ storage: storage() }, {});
  await h.load();
  h.tables[0].sit('ken', 'Ken', null);
  const ws = () => ({ send() {} });
  h.sockets.set(ws(), { key: 'ken', room: 1, as: { key: 'ken', name: 'Ken' } }); // seated: not a watcher
  h.sockets.set(ws(), { key: null, room: 1, as: { key: 'nan', name: 'Nan' } });
  h.sockets.set(ws(), { key: null, room: 1 });                                   // not signed in
  h.sockets.set(ws(), { key: null, room: 2, as: { key: 'pm', name: 'PM' } });
  assert.deepEqual(h.watchers(1), { count: 2, names: ['Nan'] });
  assert.equal(h.lobby()[1].watching, 1);
  stop(h);
});
