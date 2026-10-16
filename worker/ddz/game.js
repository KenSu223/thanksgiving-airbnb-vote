// One 斗地主 table: three seats (people or bots), 叫地主 / 抢地主 bidding,
// play and scoring. Saved like 掼蛋 (games/saving.js): the room writes the
// table on every change, so a deploy carries the hand on; 豆子 are saved after
// every hand; someone alone with bots who leaves mid-hand has the table parked
// under them, and it comes back when they next press 开始 alone (or 不打这把了
// throws it away). Kept apart from sockets and storage so it can be tested on
// its own. hooks: { now, rand, schedule(fn, ms), cancel(t), save(seat),
// park?(key, snapshot), unpark?(key), peek?(key) }.
import { deck, isBombish, legalPlay, shuffle, sortHand, takeFrom } from './cards.js';
import { choosePlay, wantsCall, wantsGrab } from './bot.js';
import { beatOptions, leadOptions } from './hints.js';
import { snapshotOf, restoreInto, parkOut, unparkInto } from '../games/saving.js';

export const DDZ = { base: 10, startPoints: 1000, bidMs: 15000, turnMs: 30000, botMs: 900, idleMs: 10 * 60 * 1000 };
const BOT_NAMES = ['🤖 小白', '🤖 阿黄', '🤖 小黑'];
const next = i => (i + 1) % 3;

export class DdzGame {
  constructor(hooks) {
    this.h = hooks;
    this.seats = [null, null, null];
    this.waitlist = []; // people who sat down mid-hand; they replace bots at the next deal
    this.phase = 'waiting'; // waiting -> bidding -> playing -> result -> (再来一局) bidding …
    this.first = 0; // who bids first; rotates every hand
    this.round = 0;
    this.turn = -1; this.deadline = 0; this.timer = null;
    this.reset();
  }
  reset() {
    this.landlord = -1; this.bottom = []; this.multiplier = 1; this.bombs = 0;
    this.bid = null; this.trick = null; this.said = [null, null, null]; this.result = null;
  }
  humans() { return this.seats.filter(s => s && !s.bot); }
  seatOf(key) { return this.seats.findIndex(s => s && !s.bot && s.key === key); }
  has(key) { return this.seatOf(key) >= 0 || this.waitlist.some(w => w.key === key); }
  inHand() { return this.phase === 'bidding' || this.phase === 'playing'; }
  setTimer(ms, fn) {
    this.clearTimer();
    this.deadline = this.h.now() + ms;
    this.timer = this.h.schedule(() => { this.timer = null; this.deadline = 0; fn(); }, ms);
  }
  clearTimer() { if (this.timer) this.h.cancel(this.timer); this.timer = null; this.deadline = 0; }

  // ---- seats ----
  sit(key, name, saved) {
    const i = this.seatOf(key);
    if (i >= 0) { Object.assign(this.seats[i], { connected: true, leaving: false, auto: false }); return null; }
    if (this.waitlist.some(w => w.key === key)) return null;
    if (this.humans().length + this.waitlist.length >= 3) return '这桌已经有 3 个人了';
    const p = { key, name, bot: false, connected: true, leaving: false, auto: false, cards: [], played: 0, timeouts: 0, activeAt: this.h.now(),
      points: saved ? saved.points : DDZ.startPoints, refills: saved?.refills || 0, games: saved?.games || 0, wins: saved?.wins || 0 };
    if (p.points <= 0) { p.points = DDZ.startPoints; p.refills++; }
    const free = this.inHand() ? -1 : this.seats.findIndex(s => !s || s.bot);
    if (free >= 0) this.seats[free] = p; else this.waitlist.push(p);
    return null;
  }
  bot(i) { return { key: 'bot' + i, name: BOT_NAMES[i], bot: true, connected: true, cards: [], played: 0 }; }

  // Anyone at the table (or queued for it) deals: the first hand, and the next
  // one after each result. Nothing deals on its own.
  start(key) {
    if (!this.has(key)) return '先坐下';
    const i = this.seatOf(key);
    if (i >= 0) this.touch(i);
    if (this.phase === 'waiting' && this.solo(key) && unparkInto(this, key)) return null; // the hand they left alone with bots
    if (this.phase === 'waiting') this.deal();
    else if (this.phase === 'result') this.nextHand();
    return null;
  }

  deal() {
    this.clearTimer();
    this.resumedRound = null;
    for (const w of this.waitlist.splice(0)) { const i = this.seats.findIndex(s => !s || s.bot); if (i >= 0) this.seats[i] = w; }
    this.seats = this.seats.map((s, i) => s || this.bot(i));
    this.reset();
    this.round++;
    const d = shuffle(deck(), this.h.rand);
    this.seats.forEach((s, i) => { s.cards = sortHand(d.slice(i * 17, i * 17 + 17)); s.played = 0; });
    this.bottom = sortHand(d.slice(51));
    this.phase = 'bidding';
    const order = [this.first, next(this.first), next(next(this.first))];
    this.bid = { stage: 'call', order, pos: 0, caller: -1, last: -1, queue: [] };
    this.setTurn(this.first);
  }

  // Bots (and people on 托管) move after a short pause; people get a countdown.
  // Time's up while bidding counts as 不叫 / 不抢 — nobody is made landlord
  // without saying so; time's up while playing, 托管 plays that turn for them.
  setTurn(i) {
    this.turn = i;
    const s = this.seats[i];
    if (s.bot || s.auto || !s.connected) return this.setTimer(DDZ.botMs, () => this.botMove(i));
    this.setTimer(this.phase === 'bidding' ? DDZ.bidMs : DDZ.turnMs, () => {
      s.timeouts++;
      if (s.timeouts >= 2) s.auto = true; // two missed turns in a row: 托管
      if (this.phase === 'bidding') return this.doBid(i, false);
      this.botMove(i);
    });
  }

  // ---- bidding: 叫地主, then each later player may 抢地主 (x2), then the caller may 抢 back (x2) ----
  bidAction(key, yes) {
    const i = this.seatOf(key);
    if (this.phase !== 'bidding' || i !== this.turn) return '还没轮到你';
    this.touch(i);
    this.doBid(i, !!yes);
    return null;
  }
  doBid(i, yes) {
    const b = this.bid;
    this.said[i] = b.stage === 'call' ? (yes ? '叫地主' : '不叫') : (yes ? '抢地主' : '不抢');
    if (b.stage === 'call') {
      if (!yes) {
        b.pos++;
        if (b.pos === 3) { // nobody called: shuffle and deal again (redealtAt lets the page say so)
          this.first = next(this.first);
          this.redealtAt = this.h.now();
          return this.deal();
        }
        return this.setTurn(b.order[b.pos]);
      }
      b.caller = b.last = i;
      b.queue = b.order.slice(b.pos + 1);
      b.stage = 'grab';
    } else {
      if (yes) { b.last = i; this.multiplier *= 2; }
      if (b.stage === 'final') return this.becomeLandlord(b.last);
    }
    if (b.queue.length) return this.setTurn(b.queue.shift());
    if (b.last !== b.caller) { b.stage = 'final'; return this.setTurn(b.caller); }
    return this.becomeLandlord(b.last);
  }
  becomeLandlord(i) {
    this.landlord = i;
    this.seats[i].cards = sortHand(this.seats[i].cards.concat(this.bottom));
    this.phase = 'playing';
    this.trick = null;
    this.said = [null, null, null];
    this.setTurn(i);
  }

  // ---- play ----
  toBeat(i) { return this.trick && this.trick.by !== i ? this.trick.play : null; }
  play(key, cards) {
    const i = this.seatOf(key);
    if (this.phase !== 'playing' || i !== this.turn) return '还没轮到你';
    this.touch(i);
    return this.doPlay(i, Array.isArray(cards) ? cards.map(String) : []);
  }
  pass(key) {
    const i = this.seatOf(key);
    if (this.phase !== 'playing' || i !== this.turn) return '还没轮到你';
    this.touch(i);
    return this.doPass(i);
  }
  doPlay(i, cards) {
    const s = this.seats[i];
    const left = takeFrom(s.cards, cards);
    if (!cards.length || !left) return '手里没有这些牌';
    const prev = this.toBeat(i);
    const play = legalPlay(cards, prev);
    if (!play) return prev ? '管不上，或者牌型不对' : '这不是一手能出的牌';
    s.cards = left; s.played++;
    if (isBombish(play)) this.bombs++;
    this.trick = { play, cards: sortHand(cards), by: i };
    this.said[i] = { cards: this.trick.cards };
    if (!left.length) { this.endHand(i); return null; }
    this.advance(i);
    return null;
  }
  doPass(i) {
    if (!this.toBeat(i)) return '该你出牌了，不能不出';
    this.said[i] = '不出';
    this.advance(i);
    return null;
  }
  advance(i) {
    const n = next(i);
    // Both others passed: the trick is n's, and n leads anything.
    if (this.trick && this.trick.by === n) { this.trick = null; this.said = this.said.map((x, k) => (k === n ? x : null)); }
    this.setTurn(n);
  }
  touch(i) { const s = this.seats[i]; s.timeouts = 0; s.activeAt = this.h.now(); }

  // What a bot (or 托管, or a timeout) does on seat i's turn.
  botMove(i) {
    if (this.phase === 'bidding') {
      const hand = this.seats[i].cards;
      return this.doBid(i, this.bid.stage === 'call' ? wantsCall(hand) : wantsGrab(hand));
    }
    if (this.phase !== 'playing') return;
    const cards = this.suggest(i);
    if (cards && !this.doPlay(i, cards)) return;
    if (this.toBeat(i)) return this.doPass(i);
    this.doPlay(i, [this.seats[i].cards[this.seats[i].cards.length - 1]]); // fallback lead: the smallest card
  }
  // the fewest cards an opponent of seat i holds
  oppMin(i) {
    const opp = [0, 1, 2].filter(k => k !== i && (i === this.landlord || k === this.landlord));
    return Math.min(...opp.map(k => this.seats[k].cards.length));
  }
  suggest(i) {
    const teammateLed = !!(this.trick && this.trick.by !== i && i !== this.landlord && this.trick.by !== this.landlord);
    return choosePlay(this.seats[i].cards, this.toBeat(i), { teammateLed, oppMin: this.oppMin(i) });
  }
  // 提示 (hints.js): leading, the hand's own groups from the cheapest;
  // following, every play that beats the table — not just what the bot would
  // do, which can be a deliberate pass. One per press, starting over when the
  // cards on the table (or, leading, your hand) change.
  hint(key) {
    const i = this.seatOf(key);
    if (this.phase !== 'playing' || i !== this.turn) return null;
    const s = this.seats[i], prev = this.toBeat(i);
    const opts = prev ? beatOptions(s.cards, prev) : leadOptions(s.cards, { oppMin: this.oppMin(i) });
    if (!opts.length) return [];
    const at = this.round + ':' + (prev ? this.trick.by + ':' + this.trick.cards.join(',') : 'lead:' + s.cards.length);
    s.hintN = s.hintAt === at ? s.hintN + 1 : 0;
    s.hintAt = at;
    return opts[s.hintN % opts.length];
  }
  setAuto(key, on) {
    const i = this.seatOf(key);
    if (i < 0) return;
    const s = this.seats[i];
    s.auto = !!on; s.timeouts = 0;
    if (this.inHand() && this.turn === i) this.setTurn(i);
  }

  // ---- end of a hand ----
  endHand(winner) {
    this.clearTimer();
    const landlordWin = winner === this.landlord;
    const farmers = [0, 1, 2].filter(k => k !== this.landlord);
    // 春天: the farmers never played; 反春: the landlord played only the opening lead.
    const spring = landlordWin ? farmers.every(k => this.seats[k].played === 0) : this.seats[this.landlord].played === 1;
    const factor = this.multiplier * 2 ** this.bombs * (spring ? 2 : 1);
    const unit = DDZ.base * factor;
    const deltas = [0, 1, 2].map(k => (k === this.landlord ? 2 : -1) * (landlordWin ? 1 : -1) * unit);
    this.seats.forEach((s, k) => { if (!s.bot) { s.points += deltas[k]; s.games++; if (deltas[k] > 0) s.wins++; } });
    this.result = { winner, landlordWin, deltas, spring, factor, multiplier: this.multiplier, bombs: this.bombs, names: this.seats.map(s => s.name) };
    this.phase = 'result';
    this.turn = -1;
    for (const s of this.seats) if (!s.bot && !s.leaving && s.connected) this.h.save(s); // 豆子 saved after every hand
    this.release();
  }
  // Let go of people who stood up or dropped during the hand. The result stays
  // up until someone presses 再来一局; with nobody left, the table clears.
  release() {
    this.seats.forEach((s, k) => { if (s && !s.bot && (s.leaving || !s.connected)) { this.h.save(s); this.seats[k] = null; } });
    if (!this.humans().length && !this.waitlist.length) this.clear();
  }
  clear() { this.clearTimer(); this.reset(); this.seats = [null, null, null]; this.phase = 'waiting'; this.turn = -1; this.resumedRound = null; }
  // 再来一局: refill anyone broke and deal again.
  nextHand() {
    this.release();
    if (this.phase !== 'result') return;
    for (const s of this.humans()) if (s.points <= 0) { s.points = DDZ.startPoints; s.refills++; }
    this.first = next(this.first);
    this.deal();
  }

  // Stand up. Mid-hand, 托管 plays your cards to the end, then you're saved —
  // or, alone with bots, the table is parked under you (nothing plays on) and
  // comes back when you next press 开始 alone. Returns a notice, if any.
  leave(key) {
    const w = this.waitlist.findIndex(x => x.key === key);
    if (w >= 0) { this.waitlist.splice(w, 1); return; }
    const i = this.seatOf(key);
    if (i < 0) return;
    const s = this.seats[i];
    if (this.h.park && this.inHand() && this.solo(key)) {
      parkOut(this, s);
      return '这把存好了，下次一个人坐下点「开始」就接着打';
    }
    if (this.inHand()) {
      s.leaving = true; s.auto = true;
      if (this.turn === i) this.setTurn(i);
      return;
    }
    this.h.save(s);
    this.seats[i] = null;
    if (!this.humans().length && !this.waitlist.length) this.clear();
  }
  disconnect(key) {
    const i = this.seatOf(key);
    if (i >= 0) this.seats[i].connected = false;
    this.leave(key);
    // No one left watching: play the hand out now so everyone's points get
    // saved (the end of the hand lets them go).
    if (this.inHand() && !this.humans().some(s => s.connected)) {
      for (let guard = 0; this.inHand() && guard < 1000; guard++) this.botMove(this.turn);
    }
  }
  // Stand up people who haven't done anything for a while; returns their keys.
  sweepIdle() {
    const cutoff = this.h.now() - DDZ.idleMs;
    const idle = this.humans().filter(s => s.activeAt < cutoff).map(s => s.key);
    idle.forEach(k => this.leave(k));
    return idle;
  }

  solo(key) { return this.humans().length === 1 && !this.waitlist.length && this.seatOf(key) >= 0; }
  // 不打这把了: alone at the table, throw away the hand parked under you.
  endMatch(key) {
    const i = this.seatOf(key);
    if (i < 0) return '先坐下';
    if (this.phase === 'waiting' && this.solo(key) && this.h.unpark?.(key)) return null;
    return '没有存着的牌局';
  }

  // ---- saving (games/saving.js) ----
  snapshot() { return snapshotOf(this); }
  restore(snap) { return restoreInto(this, snap); }
  // After a restore: start the clock that was running, from the top.
  resume() { if (this.inHand() && this.turn >= 0) this.setTurn(this.turn); }

  // What one viewer sees: their own cards, everyone's counts, all hands once it's over.
  view(key) {
    const me = this.seatOf(key), over = this.phase === 'result';
    const parked = this.phase === 'waiting' && this.solo(key) ? this.h.peek?.(key) || null : null;
    return {
      phase: this.phase, round: this.round, turn: this.turn, deadline: this.deadline, now: this.h.now(), redealtAt: this.redealtAt || 0,
      landlord: this.landlord, multiplier: this.multiplier, bombs: this.bombs, base: DDZ.base,
      bottom: this.landlord >= 0 || over ? this.bottom : this.bottom.map(() => null),
      bidStage: this.bid && this.phase === 'bidding' ? this.bid.stage : null,
      trickBy: this.trick ? this.trick.by : -1,
      said: this.said,
      seats: this.seats.map((s, k) => s && {
        name: s.name, bot: s.bot, me: k === me, connected: s.connected, auto: !!s.auto, leaving: !!s.leaving,
        points: s.bot ? null : s.points, count: s.cards.length, cards: k === me || over ? s.cards : null,
      }),
      waitlist: this.waitlist.map(w => w.name),
      waiting: this.waitlist.some(w => w.key === key),
      you: me,
      result: this.result,
      parked, // a hand this viewer left alone with bots, waiting for 开始
      resumed: this.resumedRound != null && this.resumedRound === this.round,
    };
  }
}
