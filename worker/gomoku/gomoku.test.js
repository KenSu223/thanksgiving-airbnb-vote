// 五子棋: the rules, the bot, one table, and a table carried across a deploy.
// Run: node --test worker/gomoku/gomoku.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { SIZE, CELLS, CENTER, emptyBoard, winLine, replay } from './rules.js';
import { pickMove } from './bot.js';
import { GomokuGame, GOMOKU, BOT_NAME } from './game.js';
import { GomokuHall } from './hall.js';

const P = (r, c) => r * SIZE + c;
const board = (black, white = []) => {
  const s = emptyBoard();
  for (const [r, c] of black) s[P(r, c)] = 1;
  for (const [r, c] of white) s[P(r, c)] = 2;
  return s;
};
// a seeded random (mulberry32), so bot games repeat
const seeded = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

// A table on a fake clock: timers only fire when the test says so.
function table(extra = {}) {
  const clock = { t: 1000 }, timers = new Set(), log = { records: [], paused: new Map() };
  const g = new GomokuGame({
    now: () => clock.t, rand: seeded(7),
    schedule: (fn, ms) => { const tm = { fn, at: clock.t + ms }; timers.add(tm); return tm; },
    cancel: tm => timers.delete(tm),
    record: (s, outcome) => log.records.push([s.key, outcome]),
    pause: (key, game) => log.paused.set(key, game),
    unpause: key => log.paused.delete(key),
    ...extra,
  });
  // run the next timer (the bot's move, or a move clock running out)
  const tick = () => {
    const tm = [...timers].sort((a, b) => a.at - b.at)[0];
    if (!tm) return false;
    timers.delete(tm); clock.t = Math.max(clock.t, tm.at); tm.fn();
    return true;
  };
  return { g, clock, timers, log, tick };
}

// ---------- rules ----------
test('five in a row wins across, down and on both diagonals, in the middle and at the edges', () => {
  const lines = {
    across: [[7, 3], [7, 4], [7, 5], [7, 6], [7, 7]],
    down: [[2, 9], [3, 9], [4, 9], [5, 9], [6, 9]],
    diagonal: [[4, 4], [5, 5], [6, 6], [7, 7], [8, 8]],
    'anti-diagonal': [[3, 11], [4, 10], [5, 9], [6, 8], [7, 7]],
    'top edge': [[0, 10], [0, 11], [0, 12], [0, 13], [0, 14]],
    'left edge': [[10, 0], [11, 0], [12, 0], [13, 0], [14, 0]],
    'corner diagonal': [[10, 10], [11, 11], [12, 12], [13, 13], [14, 14]],
    'corner anti-diagonal': [[0, 4], [1, 3], [2, 2], [3, 1], [4, 0]],
  };
  for (const [name, cells] of Object.entries(lines)) {
    const s = board(cells);
    for (const [r, c] of cells) assert.deepEqual(winLine(s, P(r, c)), cells.map(([a, b]) => P(a, b)).sort((x, y) => x - y), name);
  }
});

test('six or more in a row also wins (no 禁手), and the whole run is the line', () => {
  const six = [[5, 2], [5, 3], [5, 4], [5, 5], [5, 6], [5, 7]];
  assert.equal(winLine(board(six), P(5, 4)).length, 6);
  const s = board([[2, 2], [3, 3], [4, 4], [6, 6], [7, 7], [8, 8]]); // 6 on a diagonal once (5,5) fills
  s[P(5, 5)] = 1;
  assert.equal(winLine(s, P(5, 5)).length, 7);
});

test('four, a broken five, the other colour, and a line across the edge are not five', () => {
  assert.equal(winLine(board([[7, 3], [7, 4], [7, 5], [7, 6]]), P(7, 6)), null);
  assert.equal(winLine(board([[7, 3], [7, 4], [7, 5], [7, 6], [7, 8]]), P(7, 8)), null);
  assert.equal(winLine(board([[7, 3], [7, 4], [7, 5], [7, 6]], [[7, 7]]), P(7, 7)), null);
  assert.equal(winLine(board([[7, 3], [7, 4], [7, 5], [7, 6]], [[7, 7]]), P(7, 6)), null);
  // the end of one row and the start of the next are not a line
  assert.equal(winLine(board([[3, 12], [3, 13], [3, 14], [4, 0], [4, 1]]), P(3, 14)), null);
  assert.equal(winLine(emptyBoard(), P(0, 0)), null);
});

test('replay rebuilds a board and refuses broken move lists', () => {
  assert.deepEqual(replay([P(7, 7), P(7, 8)]).filter(Boolean), [1, 2]);
  assert.equal(replay([P(7, 7), P(7, 7)]), null);
  assert.equal(replay([CELLS]), null);
  assert.equal(replay([1.5]), null);
  assert.equal(replay('nope'), null);
});

// A full board with no five anywhere: runs of two in every direction.
const drawColor = (r, c) => (((c >> 1) + r) & 1 ? 2 : 1);
function drawMoves() {
  const black = [], white = [];
  for (let at = 0; at < CELLS; at++) (drawColor(Math.floor(at / SIZE), at % SIZE) === 1 ? black : white).push(at);
  const out = [];
  for (let i = 0; i < black.length; i++) { out.push(black[i]); if (white[i] != null) out.push(white[i]); }
  return out;
}

test('a full board with no five is 和棋, and both people get a draw on their record', () => {
  const moves = drawMoves();
  assert.equal(moves.length, CELLS);
  const { g, log } = table();
  g.sit('a', 'A', { seat: 0 }); g.sit('b', 'B');
  g.start('a');
  for (const at of moves) assert.equal(g.move(g.turn() === 0 ? 'a' : 'b', at), null);
  assert.equal(g.phase, 'over');
  assert.equal(g.result.winner, -1);
  assert.equal(g.result.how, 'draw');
  assert.deepEqual(log.records, [['a', 'draw'], ['b', 'draw']]);
});

// ---------- the bot ----------
test('the bot opens in the centre and answers next to a lone stone', () => {
  assert.equal(pickMove(emptyBoard(), 1), CENTER);
  const at = pickMove(board([[7, 7]]), 2, seeded(1));
  assert.ok(Math.max(Math.abs(Math.floor(at / SIZE) - 7), Math.abs(at % SIZE - 7)) <= 1, 'next to the stone');
});

test('the bot makes five when it can — even with its own five to block elsewhere', () => {
  // its own four (blocked on one side) and the opponent's four: it wins instead of blocking
  const s = board([[3, 3], [3, 4], [3, 5], [3, 6]], [[9, 2], [9, 3], [9, 4], [9, 5], [3, 2]]);
  assert.equal(pickMove(s, 1, seeded(2)), P(3, 7));
  // a broken four X X _ X X: the gap
  assert.equal(pickMove(board([[6, 6], [7, 7], [9, 9], [10, 10]], [[0, 0], [0, 1], [0, 3], [14, 14]]), 1, seeded(3)), P(8, 8));
});

test('the bot blocks a four, an open four (one end at least), and an open three', () => {
  // opponent (黑) four, open at one end only
  const four = board([[5, 5], [6, 5], [7, 5], [8, 5]], [[4, 5], [7, 8]]);
  assert.equal(pickMove(four, 2, seeded(4)), P(9, 5));
  // opponent open four: two ends to finish — the bot blocks one of them
  const open4 = board([[7, 4], [7, 5], [7, 6], [7, 7]], [[6, 6], [8, 8], [9, 9]]);
  assert.ok([P(7, 3), P(7, 8)].includes(pickMove(open4, 2, seeded(5))));
  // opponent open three on a diagonal: the bot closes one end so it can't become an open four
  const open3 = board([[5, 5], [6, 6], [7, 7]], [[7, 9], [9, 7]]);
  const block = pickMove(open3, 2, seeded(6));
  assert.ok([P(4, 4), P(8, 8), P(3, 3), P(9, 9)].includes(block), 'blocked at ' + [Math.floor(block / SIZE), block % SIZE]);
  // a split three  X _ X X  is a threat too: the gap or an end
  const split = board([[7, 3], [7, 5], [7, 6]], [[8, 8], [6, 9]]);
  assert.ok([P(7, 2), P(7, 4), P(7, 7)].includes(pickMove(split, 2, seeded(8))));
});

test('the bot takes its own open four over blocking an open three', () => {
  const s = board([[2, 2], [2, 3], [2, 4]], [[10, 4], [10, 5], [10, 6], [0, 14]]); // 白 to move: its three vs 黑's three
  assert.ok([P(10, 3), P(10, 7)].includes(pickMove(s, 2, seeded(9))));
});

test('the bot answers fast and plays a whole game against itself without a bad move', () => {
  const stones = emptyBoard(), rand = seeded(11);
  let worst = 0, winner = 0;
  for (let n = 0; n < CELLS && !winner; n++) {
    const color = n % 2 ? 2 : 1, t0 = performance.now();
    const at = pickMove(stones, color, rand);
    worst = Math.max(worst, performance.now() - t0);
    assert.ok(at >= 0 && at < CELLS && !stones[at], 'a legal move');
    stones[at] = color;
    if (winLine(stones, at)) winner = color;
  }
  assert.ok(worst < 250, 'slowest move ' + worst.toFixed(1) + ' ms');
});

test('the bot beats a player who drops stones at random near the action', () => {
  for (let seed = 1; seed <= 5; seed++) {
    const stones = emptyBoard(), rand = seeded(seed);
    let winner = 0;
    for (let n = 0; n < CELLS && !winner; n++) {
      const color = n % 2 ? 2 : 1;
      let at;
      if (color === 1) at = pickMove(stones, 1, rand);
      else { // a random empty point next to a stone
        const near = [];
        for (let p = 0; p < CELLS; p++) if (!stones[p] && [-1, 0, 1].some(dr => [-1, 0, 1].some(dc => stones[p + dr * SIZE + dc] && Math.abs((p % SIZE) - ((p + dc) % SIZE)) <= 1))) near.push(p);
        at = near[Math.floor(rand() * near.length)];
      }
      stones[at] = color;
      if (winLine(stones, at)) winner = color;
    }
    assert.equal(winner, 1, 'seed ' + seed);
  }
});

// ---------- one table ----------
test('two people: seats pick the colours, 黑 first, illegal moves refused, five wins, 再来一局 swaps', () => {
  const { g, log } = table();
  assert.equal(g.sit('a', 'A', { seat: 1 }), null); // A takes 白
  assert.equal(g.seats[0].name, BOT_NAME, 'alone: the bot sits in the other seat');
  assert.equal(g.sit('b', 'B', { seat: 1 }), '这个座位有人了');
  assert.equal(g.sit('b', 'B'), null); // B takes the bot's place
  assert.equal(g.vsBot(), false);
  assert.equal(g.sit('c', 'C'), '这桌满了，可以观战');
  assert.equal(g.move('b', P(7, 7)), '还没开始');
  assert.equal(g.start('c'), '先坐下');
  assert.equal(g.start('a'), null);
  assert.equal(g.move('a', P(7, 7)), '还没轮到你'); // B is 黑
  for (const bad of [-1, CELLS, 3.5, '7', null, undefined]) assert.equal(g.move('b', bad), '要下在棋盘上');
  const black = [[7, 3], [7, 4], [7, 5], [7, 6], [7, 7]], white = [[9, 3], [9, 4], [9, 5], [9, 6]];
  for (let i = 0; i < 5; i++) {
    assert.equal(g.move('b', P(...black[i])), null);
    if (i === 0) assert.equal(g.move('a', P(7, 3)), '这里已经有子了');
    if (i < 4) assert.equal(g.move('a', P(...white[i])), null);
  }
  assert.equal(g.phase, 'over');
  assert.equal(g.result.winner, 0);
  assert.deepEqual(g.result.line, black.map(([r, c]) => P(r, c)));
  assert.deepEqual(log.records, [['b', 'win'], ['a', 'loss']]);
  assert.equal(g.move('a', P(0, 0)), '这局已经结束了');
  assert.equal(g.undo('a'), '和人下不能悔棋');
  assert.equal(g.start('a'), null); // 再来一局: A is 黑 now
  assert.equal(g.seats[0].key, 'a');
  assert.equal(g.moves.length, 0);
  assert.equal(g.move('a', CENTER), null);
});

test('the move clock: a timed-out move is played by the bot, two in a row is 托管, moving yourself ends it', () => {
  const { g, tick, clock } = table();
  g.sit('a', 'A', { seat: 0 }); g.sit('b', 'B');
  g.start('a');
  assert.equal(g.deadline, clock.t + GOMOKU.turnMs);
  tick(); // A's 60 s run out
  assert.equal(g.moves.length, 1);
  assert.equal(g.seats[0].timeouts, 1);
  g.move('b', P(0, 0));
  tick(); // again: 托管
  assert.equal(g.seats[0].auto, true);
  g.move('b', P(0, 1));
  assert.equal(g.deadline, clock.t + GOMOKU.botMs, '托管 answers quickly');
  assert.equal(g.setAuto('a', false), null);
  assert.equal(g.deadline, clock.t + GOMOKU.turnMs);
  g.setAuto('a', true);
  assert.equal(g.move('a', P(14, 14)), null);
  assert.equal(g.seats[0].auto, false);
});

test('against the bot: it answers, 悔棋 takes back your move and its reply, 认输 counts', () => {
  const { g, tick, log } = table();
  g.sit('a', 'A'); // 黑 by default
  g.start('a');
  assert.equal(g.undo('a'), '还没有可以悔的棋');
  g.move('a', CENTER);
  assert.equal(g.undo('a'), null, 'the bot is still thinking: just your move goes');
  assert.equal(g.moves.length, 0);
  g.move('a', CENTER);
  tick(); // the bot answers
  assert.equal(g.moves.length, 2);
  g.move('a', P(0, 0));
  tick();
  assert.equal(g.undo('a'), null);
  assert.deepEqual(g.moves.length, 2);
  assert.equal(g.turn(), 0);
  assert.equal(g.undos, 2);
  assert.equal(g.resign('a'), null);
  assert.equal(g.result.winner, 1);
  assert.deepEqual(log.records, [['a', 'loss']]);
});

test('standing up from the bot pauses the game under your name; sitting alone again resumes it', () => {
  const { g, tick, log } = table();
  g.sit('a', 'A', { seat: 1 }); // 白: the bot opens
  g.start('a');
  tick();
  g.move('a', P(6, 6));
  tick();
  const moves = g.moves.slice();
  assert.equal(g.leave('a'), 'paused');
  assert.equal(g.seats.filter(Boolean).length, 0, 'the table is free again');
  assert.deepEqual(log.paused.get('a').moves, moves);
  assert.equal(log.records.length, 0, 'a pause is not a game');
  // someone else sits: a new table of their own
  const other = table();
  other.g.sit('b', 'B');
  assert.equal(other.g.moves.length, 0);
  // A sits down alone (any seat): back to the same game, same colour, a fresh clock
  assert.equal(g.sit('a', 'A', { seat: 0 }, log.paused.get('a')), null);
  assert.equal(log.paused.has('a'), false);
  assert.equal(g.phase, 'playing');
  assert.equal(g.resumed, true);
  assert.equal(g.seats[1].key, 'a');
  assert.deepEqual(g.moves, moves);
  assert.equal(g.turn(), 1);
  // 重新开一局 after A has put stones down: that game counts as A's 认输, then a new one
  assert.equal(g.fresh('a'), null);
  assert.equal(g.moves.length, 0);
  assert.equal(g.resumed, false);
  assert.deepEqual(log.records, [['a', 'loss']]);
  assert.equal(g.phase, 'playing');
  // straight away again, before any stone of A's: nothing to count
  assert.equal(g.fresh('a'), null);
  assert.deepEqual(log.records, [['a', 'loss']]);
});

test('悔棋 against the bot: 3 per game', () => {
  const { g, tick } = table();
  g.sit('a', 'A');
  g.start('a');
  const spots = [CENTER, P(0, 0), P(14, 14), P(0, 14), P(14, 0)];
  for (let k = 0; k < 3; k++) {
    g.move('a', spots[k]); tick();
    assert.equal(g.undo('a'), null);
  }
  g.move('a', spots[3]); tick();
  assert.equal(g.undo('a'), '每局只能悔 3 次');
  assert.equal(g.undos, 3);
  g.start('a'); // still playing: refused, the count stays with this game
  g.resign('a'); g.start('a'); // 再来一局 swaps colours: the bot opens this time
  tick();
  g.move('a', g.stones[CENTER] ? P(0, 0) : CENTER); tick();
  assert.equal(g.undo('a'), null, 'a new game: 3 again');
});

test('standing up before your first stone keeps nothing (an old empty one is dropped too)', () => {
  const { g, tick, log } = table();
  g.sit('a', 'A', { seat: 1 }); g.start('a');
  tick(); // only the bot's opening is on the board
  assert.equal(g.leave('a'), null);
  assert.equal(log.paused.size, 0);
  assert.equal(g.seats.filter(Boolean).length, 0);
  log.paused.set('a', { color: 1, moves: [CENTER] });
  g.sit('a', 'A', {}, log.paused.get('a'));
  assert.equal(log.paused.size, 0);
  assert.equal(g.phase, 'waiting');
});

test('a paused game waits while you play a person, and a broken one is dropped', () => {
  const { g, log } = table();
  g.sit('b', 'B');
  const saved = { color: 0, moves: [CENTER], undos: 0, startedAt: 1 };
  assert.equal(g.sit('a', 'A', {}, saved), null);
  assert.equal(g.vsBot(), false, 'not alone: A plays B');
  assert.equal(g.moves.length, 0);
  const t2 = table();
  t2.log.paused.set('a', { color: 0, moves: [1, 1] });
  t2.g.sit('a', 'A', {}, t2.log.paused.get('a'));
  assert.equal(t2.log.paused.has('a'), false);
  assert.equal(t2.g.phase, 'waiting');
  assert.equal(log.paused.size, 0);
});

test('standing up mid-game against a person is 认输; the one left gets the bot', () => {
  const { g, log } = table();
  g.sit('a', 'A'); g.sit('b', 'B');
  g.start('b');
  g.move('a', CENTER);
  assert.equal(g.leave('b'), null);
  assert.equal(g.phase, 'over');
  assert.equal(g.result.how, 'left');
  assert.equal(g.result.by, 'B');
  assert.deepEqual(log.records, [['a', 'win'], ['b', 'loss']]);
  assert.equal(g.seats[1].bot, true);
});

test('a dropped person keeps the seat against a person; against the bot the game is paused', () => {
  const { g, log } = table();
  g.sit('a', 'A'); g.sit('b', 'B');
  g.start('a');
  g.disconnect('b');
  assert.equal(g.seats[1].connected, false);
  assert.equal(g.phase, 'playing');
  assert.equal(g.rejoin('b'), true);
  assert.equal(g.seats[1].connected, true);
  const solo = table();
  solo.g.sit('c', 'C'); solo.g.start('c'); solo.g.move('c', CENTER);
  solo.g.disconnect('c');
  assert.deepEqual(solo.log.paused.get('c').moves, [CENTER]);
  assert.equal(log.paused.size, 0);
});

test('snapshot → restore: the same stones, seats and turn, everyone away, the clock fresh', () => {
  const a = table();
  a.g.sit('a', 'A'); a.g.sit('b', 'B');
  a.g.start('a');
  for (const at of [P(7, 7), P(8, 8), P(7, 8)]) a.g.move(a.g.turn() === 0 ? 'a' : 'b', at);
  const snap = JSON.parse(JSON.stringify(a.g.snapshot())); // through storage it's plain data
  const b = table();
  b.clock.t = 50000;
  assert.equal(b.g.restore(snap), true);
  assert.deepEqual(b.g.moves, a.g.moves);
  assert.deepEqual(b.g.stones, a.g.stones);
  assert.equal(b.g.turn(), 1);
  assert.equal(b.g.phase, 'playing');
  assert.deepEqual(b.g.seats.map(s => s.key), ['a', 'b']);
  assert.ok(b.g.seats.every(s => !s.connected));
  assert.equal(b.g.deadline, 50000 + GOMOKU.turnMs);
  assert.equal(b.g.sit('b', 'B'), null); // the page reconnects and sits again
  assert.equal(b.g.seats[1].connected, true);
  assert.equal(b.g.move('b', P(9, 9)), null);
  assert.equal(b.g.restore(null), false);
  assert.equal(b.g.restore({ seats: [], moves: [1, 1], phase: 'playing' }), false);
});

test('after a deploy, a game against the bot whose person never comes back is paused for them', () => {
  const a = table();
  a.g.sit('a', 'A'); a.g.start('a'); a.g.move('a', CENTER); a.tick();
  const b = table();
  b.g.restore(JSON.parse(JSON.stringify(a.g.snapshot())));
  b.tick(); // A's fresh clock runs out with A still away
  assert.deepEqual(b.log.paused.get('a').moves, a.g.moves);
  assert.equal(b.g.seats.filter(Boolean).length, 0);
});

// A Durable Object's storage, in memory (shared between "deploys" of the same object), storing copies.
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
function storage() {
  const m = new Map();
  return {
    m,
    list: async ({ prefix }) => new Map([...m].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, clone(v)])),
    get: async k => clone(m.get(k)),
    put: async (k, v) => { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) m.set(a, clone(b)); else m.set(k, clone(v)); },
    delete: async k => { for (const x of [].concat(k)) m.delete(x); },
  };
}
const stop = hall => hall.tables.forEach(t => t.clearTimer());

test('the room saves every table as it moves and a fresh object (a deploy) picks them all up', async () => {
  const s = storage();
  const a = new GomokuHall({ storage: s }, {});
  await a.load();
  const [t1, t2] = a.tables;
  t1.sit('a', 'A'); t1.sit('b', 'B'); t1.start('a');
  t1.move('a', CENTER); t1.move('b', P(6, 6)); t1.move('a', P(7, 8));
  t2.sit('c', 'C', { seat: 1 }); t2.start('c'); t2.place(CENTER); t2.move('c', P(8, 8));
  a.changed();
  stop(a);
  assert.ok(s.m.has('t:1') && s.m.has('t:2'));
  t1.move('b', P(6, 7)); // one more move, saved straight away too
  a.changed();
  stop(a);
  const b = new GomokuHall({ storage: s }, {});
  await b.load();
  assert.deepEqual(b.tables[0].moves, [CENTER, P(6, 6), P(7, 8), P(6, 7)]);
  assert.equal(b.tables[0].turn(), 0);
  assert.deepEqual(b.tables[1].moves, [CENTER, P(8, 8)]);
  assert.equal(b.tables[1].seats[0].bot, true);
  assert.equal(b.tables[1].seats[1].key, 'c');
  assert.equal(b.tables[2].phase, 'waiting');
  stop(b);
});

test('the room keeps records and paused games, and a retired account leaves nothing behind', async () => {
  const s = storage();
  const h = new GomokuHall({ storage: s }, {});
  await h.load();
  const t = h.tables[0];
  t.sit('a', 'A'); t.start('a'); t.resign('a'); // a loss against the bot
  t.fresh('a'); t.move('a', CENTER); t.leave('a'); // and a paused game (same colour: 重新开一局, not 再来一局)
  h.changed();
  stop(h);
  assert.deepEqual(s.m.get('p:a'), { ...s.m.get('p:a'), name: 'A', wins: 0, games: 1 });
  assert.deepEqual(s.m.get('g:a').moves, [CENTER]);
  const again = new GomokuHall({ storage: s }, {});
  await again.load();
  assert.equal(again.saved.get('a').moves.length, 1);
  again.tables[1].sit('a', 'A', {}, again.saved.get('a'));
  assert.equal(again.tables[1].resumed, true);
  stop(again);
  const res = await again.scrubUser(new Request('https://internal/scrub-user', { method: 'POST', body: JSON.stringify({ target: 'A' }) }));
  assert.equal((await res.json()).ok, true);
  assert.equal(again.tables[1].has('a'), false);
  assert.equal(s.m.has('p:a') || s.m.has('g:a'), false);
  assert.deepEqual(again.ranking(), []);
});
