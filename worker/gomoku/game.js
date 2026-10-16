// One 五子棋 table: two seats, seat 0 plays 黑 (moves first) and seat 1 白, a
// person or the bot (🤖) in each. Kept apart from sockets and storage so it can
// be tested on its own. hooks: { now, rand, schedule(fn, ms), cancel(t),
// record(seat, 'win' | 'loss' | 'draw'), pause(key, game), unpause(key) }.
//
// Sitting down alone puts the bot in the other seat; a second person takes the
// bot's place until a game starts. You pick your colour by the seat you take;
// 再来一局 swaps the colours. Anyone seated starts a game (no 房主).
// Against the bot: 悔棋 takes back your last move and the bot's reply, and
// standing up (or dropping off) pauses the game — it's kept under your name
// (pause) and comes back the next time you sit down at a free table alone.
// Against a person: standing up mid-game is 认输. A dropped person keeps the
// seat; their clock runs and the bot plays a timed-out move for them, and two
// in a row put them on 托管 (the bot plays for them until they take it back).
//
// snapshot() / restore() carry the whole table across a deploy: the stones,
// whose turn it is (from the moves), the seats; the move clock starts fresh.
import { CELLS, BLACK, WHITE, isPoint, winLine, replay, emptyBoard } from './rules.js';
import { pickMove } from './bot.js';

// undos: 悔棋 per game against the bot (bot games count on the board, so they're not free)
export const GOMOKU = { turnMs: 60000, botMs: 700, idleMs: 10 * 60 * 1000, awayMs: 2 * 60 * 1000, undos: 3 };
export const BOT_NAME = '🤖 小五';
const colorOf = seat => (seat === 0 ? BLACK : WHITE);

export class GomokuGame {
  constructor(hooks) {
    this.h = hooks;
    this.seats = [null, null];
    this.v = 0; // bumped on every change: the hall saves the table when it moves
    this.round = 0;
    this.timer = null; this.deadline = 0;
    this.reset();
    this.phase = 'waiting'; // waiting -> playing -> over -> (再来一局) playing …
  }
  reset() {
    this.moves = []; this.stones = emptyBoard(); this.result = null;
    this.resumed = false; this.undos = 0; this.startedAt = 0;
  }
  bump() { this.v++; }
  humans() { return this.seats.filter(s => s && !s.bot); }
  seatOf(key) { return key ? this.seats.findIndex(s => s && !s.bot && s.key === key) : -1; }
  has(key) { return this.seatOf(key) >= 0; }
  vsBot() { return this.seats.some(s => s && s.bot); }
  turn() { return this.phase === 'playing' ? this.moves.length % 2 : -1; }
  person(key, name) { return { key, name, bot: false, connected: true, awayAt: 0, timeouts: 0, auto: false, activeAt: this.h.now() }; }
  bot() { return { key: 'bot', name: BOT_NAME, bot: true, connected: true }; }
  // one person alone at the table: the bot sits in the other seat
  fillBot() {
    if (this.humans().length === 1) this.seats = this.seats.map(s => s || this.bot());
    else if (!this.humans().length) this.clear();
  }
  setTimer(ms, fn) {
    this.clearTimer();
    this.deadline = this.h.now() + ms;
    this.timer = this.h.schedule(() => { this.timer = null; this.deadline = 0; fn(); }, ms);
  }
  clearTimer() { if (this.timer) this.h.cancel(this.timer); this.timer = null; this.deadline = 0; }
  touch(i) { const s = this.seats[i]; s.timeouts = 0; s.activeAt = this.h.now(); }

  // ---- seats ----
  // seat: 0 黑 / 1 白, or none (take the free one). saved: this person's paused game against the bot.
  sit(key, name, { seat } = {}, saved = null) {
    const want = seat === 0 || seat === 1 ? seat : -1;
    const mine = this.seatOf(key);
    if (mine >= 0) { // already here: back online, or moving to the other seat
      Object.assign(this.seats[mine], { connected: true, awayAt: 0, name });
      this.touch(mine);
      if (want >= 0 && want !== mine) {
        if (this.phase === 'playing') return '下着棋不能换座位';
        if (this.seats[want] && !this.seats[want].bot) return '这个座位有人了';
        this.seats[want] = this.seats[mine]; this.seats[mine] = this.bot();
      }
      this.bump();
      return null;
    }
    const people = this.humans();
    if (people.length >= 2) return '这桌满了，可以观战';
    if (this.phase === 'playing') return '这桌正在下，可以观战';
    if (!people.length) {
      if (saved && this.resume(key, name, saved)) return null;
      this.clear();
      this.seats[want >= 0 ? want : 0] = this.person(key, name);
      this.fillBot();
      this.bump();
      return null;
    }
    // the second person takes the bot's seat; a new pair starts from a clean board
    const free = want >= 0 ? want : this.seats.findIndex(s => !s || s.bot);
    if (this.seats[free] && !this.seats[free].bot) return '这个座位有人了';
    this.seats[free] = this.person(key, name);
    this.clearTimer(); this.reset(); this.phase = 'waiting';
    this.bump();
    return null;
  }
  // Pick a paused game against the bot back up: same colour, same stones, a fresh clock.
  resume(key, name, saved) {
    const stones = replay(saved.moves);
    this.h.unpause(key); // it's on the table now (or it was broken)
    if (!stones || (saved.color !== 0 && saved.color !== 1) || saved.moves.length >= CELLS || saved.moves.length <= saved.color) return false;
    this.clear();
    this.seats[saved.color] = this.person(key, name);
    this.seats[1 - saved.color] = this.bot();
    this.moves = saved.moves.slice(); this.stones = stones;
    this.undos = saved.undos || 0; this.startedAt = saved.startedAt || this.h.now();
    this.resumed = true; this.round++;
    this.phase = 'playing';
    this.bump();
    this.setTurn();
    return true;
  }
  // A person back on this socket (reload, a phone waking up) — the seat was kept.
  rejoin(key) {
    const i = this.seatOf(key);
    if (i < 0) return false;
    Object.assign(this.seats[i], { connected: true, awayAt: 0 });
    this.bump();
    return true;
  }

  // ---- a game ----
  // 开始 (waiting), or 再来一局 (over: the two seats swap, so the colours do).
  start(key) {
    const i = this.seatOf(key);
    if (i < 0) return '先坐下';
    this.touch(i);
    if (this.phase === 'playing') return '已经在下了';
    if (this.phase === 'over') this.seats.reverse();
    this.begin();
    return null;
  }
  begin() {
    this.clearTimer(); this.reset();
    this.fillBot();
    for (const s of this.humans()) { s.timeouts = 0; s.auto = false; }
    this.startedAt = this.h.now();
    this.round++;
    this.phase = 'playing';
    this.bump();
    this.setTurn();
  }
  // The bot (or 托管) answers after a short pause; a person gets the move clock.
  setTurn() {
    const i = this.turn(), s = this.seats[i];
    if (s.bot || s.auto) return this.setTimer(GOMOKU.botMs, () => this.botMove());
    this.setTimer(GOMOKU.turnMs, () => this.timeout(i));
  }
  // Time's up. Against the bot nobody waits for a dropped person: the game is
  // paused for them. Otherwise the bot plays this move; two in a row is 托管.
  timeout(i) {
    const s = this.seats[i];
    if (this.vsBot() && !s.connected) return this.pause(i);
    s.timeouts++;
    if (s.timeouts >= 2) s.auto = true;
    this.botMove();
  }
  botMove() {
    if (this.phase !== 'playing') return;
    this.place(pickMove(this.stones, colorOf(this.turn()), this.h.rand));
  }
  move(key, at) {
    const i = this.seatOf(key);
    if (i < 0) return '先坐下';
    if (this.phase !== 'playing') return this.phase === 'over' ? '这局已经结束了' : '还没开始';
    if (this.turn() !== i) return '还没轮到你';
    if (!isPoint(at)) return '要下在棋盘上';
    if (this.stones[at]) return '这里已经有子了';
    const s = this.seats[i];
    this.touch(i);
    s.auto = false; // moving yourself ends 托管
    this.resumed = false;
    this.place(at);
    return null;
  }
  place(at) {
    if (!isPoint(at) || this.stones[at]) return;
    const i = this.turn();
    this.stones[at] = colorOf(i);
    this.moves.push(at);
    this.bump();
    const line = winLine(this.stones, at);
    if (line) return this.end(i, 'five', line);
    if (this.moves.length >= CELLS) return this.end(-1, 'draw');
    this.setTurn();
  }
  // 悔棋, against the bot only: your last move goes, and the bot's reply after it.
  undo(key) {
    const i = this.seatOf(key);
    if (i < 0) return '先坐下';
    if (!this.vsBot()) return '和人下不能悔棋';
    if (this.phase !== 'playing') return '这局已经结束了';
    if (this.undos >= GOMOKU.undos) return '每局只能悔 ' + GOMOKU.undos + ' 次';
    const back = this.turn() === i ? 2 : 1; // the bot already answered / it's still thinking
    if (this.moves.length < back) return '还没有可以悔的棋';
    for (let k = 0; k < back; k++) this.stones[this.moves.pop()] = 0;
    this.touch(i);
    this.undos++; this.resumed = false;
    this.bump();
    this.setTurn();
    return null;
  }
  // 认输 (also what standing up mid-game against a person is)
  resign(key, how = 'resign') {
    const i = this.seatOf(key);
    if (i < 0) return '先坐下';
    if (this.phase !== 'playing') return '这局已经结束了';
    this.end(1 - i, how, null, this.seats[i].name);
    return null;
  }
  // Against the bot: start a new game, same colours. Once you've put a stone down
  // the game in play counts as 认输 — otherwise a losing game could just be dropped.
  fresh(key) {
    const i = this.seatOf(key);
    if (i < 0) return '先坐下';
    if (!this.vsBot()) return '和人下不能重来';
    this.touch(i);
    if (this.phase === 'playing' && this.moves.some((_, k) => k % 2 === i)) this.end(1 - i, 'resign', null, this.seats[i].name);
    this.begin();
    return null;
  }
  setAuto(key, on) {
    const i = this.seatOf(key);
    if (i < 0) return '先坐下';
    const s = this.seats[i];
    s.auto = !!on; s.timeouts = 0;
    this.bump();
    if (this.phase === 'playing' && this.turn() === i) this.setTurn();
    return null;
  }
  // winner: the seat (0 / 1), or -1 for 和棋; how: five / draw / resign / left; by: who gave up
  end(winner, how, line = null, by = null) {
    this.clearTimer();
    this.phase = 'over';
    this.resumed = false;
    this.result = { winner, how, line, by, names: this.seats.map(s => s?.name || '') };
    this.seats.forEach((s, k) => { if (s && !s.bot) this.h.record(s, winner < 0 ? 'draw' : winner === k ? 'win' : 'loss'); });
    this.bump();
  }

  // ---- leaving ----
  // Stand up. Against the bot mid-game: paused under your name ('paused').
  // Against a person mid-game: 认输. Otherwise the seat just frees up.
  leave(key) {
    const i = this.seatOf(key);
    if (i < 0) return null;
    if (this.phase === 'playing') {
      if (this.vsBot()) return this.pause(i);
      this.resign(key, 'left');
    }
    this.seats[i] = null;
    this.fillBot();
    this.bump();
    return null;
  }
  // Kept under the person's name until they sit down alone again (resume) —
  // once they've put a stone down; before that there's nothing to keep.
  pause(i) {
    const s = this.seats[i], kept = this.moves.some((_, k) => k % 2 === i);
    if (kept) this.h.pause(s.key, { color: i, moves: this.moves.slice(), undos: this.undos, startedAt: this.startedAt, savedAt: this.h.now() });
    this.clear();
    this.bump();
    return kept ? 'paused' : null;
  }
  // The last tab closed. Against the bot that's a pause; against a person the
  // seat is kept (the clock runs, see timeout); between games the seat frees up.
  disconnect(key) {
    const i = this.seatOf(key);
    if (i < 0) return;
    if (this.phase === 'playing' && !this.vsBot()) {
      Object.assign(this.seats[i], { connected: false, awayAt: this.h.now() });
      this.bump();
      return;
    }
    this.leave(key);
  }
  // A retired account: off the table with nothing saved for anyone (users/retire.js).
  forget(key) {
    const i = this.seatOf(key);
    if (i < 0) return;
    this.clearTimer();
    this.seats[i] = null;
    if (this.phase === 'playing') { this.reset(); this.phase = 'waiting'; }
    this.fillBot();
    this.bump();
  }
  clear() { this.clearTimer(); this.reset(); this.seats = [null, null]; this.phase = 'waiting'; }
  // Between games: stand up people who haven't done anything for a while, and
  // seats whose person never came back (after a deploy). Returns their keys.
  sweepIdle() {
    if (this.phase === 'playing') return [];
    const now = this.h.now();
    const gone = this.humans().filter(s => s.activeAt < now - GOMOKU.idleMs || (!s.connected && s.awayAt < now - GOMOKU.awayMs)).map(s => s.key);
    gone.forEach(k => this.leave(k));
    return gone;
  }

  // What one viewer sees (there's nothing secret in 五子棋: it's the same for everyone but `me`).
  view(key) {
    const me = this.seatOf(key);
    return {
      phase: this.phase, round: this.round, moves: this.moves, turn: this.turn(),
      deadline: this.deadline, now: this.h.now(), vsBot: this.vsBot(), resumed: this.resumed, undos: this.undos,
      result: this.result,
      seats: this.seats.map((s, k) => s && { name: s.name, bot: s.bot, me: k === me, connected: s.connected, auto: !!s.auto }),
      you: me,
    };
  }

  // ---- across deploys ----
  snapshot() {
    return {
      seats: this.seats.map(s => s && (s.bot ? { bot: true } : { key: s.key, name: s.name, timeouts: s.timeouts, auto: !!s.auto })),
      moves: this.moves.slice(), phase: this.phase, result: this.result, round: this.round,
      resumed: this.resumed, undos: this.undos, startedAt: this.startedAt,
    };
  }
  // Nobody's socket survived the deploy: everyone is away until they come back
  // (their page reconnects and sits again on its own). The clock starts fresh.
  restore(snap) {
    const stones = snap && replay(snap.moves);
    if (!stones || !Array.isArray(snap.seats) || !['waiting', 'playing', 'over'].includes(snap.phase)) return false;
    const now = this.h.now();
    this.clear();
    this.seats = [0, 1].map(k => {
      const s = snap.seats[k];
      if (!s) return null;
      if (s.bot) return this.bot();
      return { ...this.person(s.key, s.name), connected: false, awayAt: now, timeouts: s.timeouts || 0, auto: !!s.auto };
    });
    this.moves = snap.moves.slice(); this.stones = stones;
    this.phase = snap.phase; this.result = snap.result || null; this.round = snap.round || 0;
    this.resumed = !!snap.resumed; this.undos = snap.undos || 0; this.startedAt = snap.startedAt || 0;
    if (!this.humans().length) { this.clear(); return true; }
    if (this.phase === 'playing' && this.seats.every(Boolean)) this.setTurn();
    else if (this.phase === 'playing') { this.reset(); this.phase = 'waiting'; this.fillBot(); }
    return true;
  }
}
