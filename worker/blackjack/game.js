// Blackjack rules and table flow. The Durable Object that hosts the table is
// in table.js.
// Rules: 6-deck shoe, dealer stands on soft 17, blackjack pays 3:2, double on
// the first two cards, no split or insurance. Chips are play money, unrelated
// to the expense ledger, and are saved after every hand and when a player
// stands up (or disconnects).
import { snapshotOf, restoreInto } from '../games/saving.js';

export const BJ = { decks: 6, seats: 6, minBet: 10, maxBet: 500, startChips: 1000,
  betMs: 15000, turnMs: 30000, resultMs: 5000, idleMs: 10 * 60 * 1000 };
const BJ_RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const BJ_SUITS = ['♠', '♥', '♦', '♣'];

function bjShoe(rand) {
  const cards = [];
  for (let d = 0; d < BJ.decks; d++) for (const s of BJ_SUITS) for (const r of BJ_RANKS) cards.push(r + s);
  for (let i = cards.length - 1; i > 0; i--) {
    const k = Math.floor(rand() * (i + 1));
    [cards[i], cards[k]] = [cards[k], cards[i]];
  }
  return cards;
}
// Best total of a hand; soft = an ace is still being counted as 11.
function bjValue(cards) {
  let total = 0, aces = 0;
  for (const c of cards) {
    const r = c.slice(0, -1);
    if (r === 'A') { aces++; total += 11; } else total += 'JQK'.includes(r) ? 10 : Number(r);
  }
  while (total > 21 && aces) { total -= 10; aces--; }
  return { total, soft: aces > 0 };
}
const bjNatural = cards => cards.length === 2 && bjValue(cards).total === 21;
const BJ_IN_HAND = ['playing', 'stood', 'bust', 'blackjack'];

// The table's rules and flow, kept apart from sockets and storage so they can
// be tested on their own. hooks: { now, rand, schedule(fn, ms), cancel(t), save(seat) }.
// Saved like the other tables (games/saving.js): snapshot / restore / resume,
// and everyone's chips are saved after every hand.
// Seat status: out (not in this hand) -> bet -> playing -> stood | bust | blackjack -> done.
export class BlackjackGame {
  constructor(hooks) {
    this.h = hooks;
    this.seats = [];
    this.dealer = []; this.holeHidden = true;
    this.phase = 'waiting'; // waiting -> betting -> playing -> result -> waiting
    this.turnKey = null; this.deadline = 0; this.timer = null; this.round = 0;
    this.shoe = bjShoe(hooks.rand);
  }
  seat(key) { return this.seats.find(s => s.key === key); }
  setTimer(ms, fn) {
    this.clearTimer();
    this.deadline = this.h.now() + ms;
    this.timer = this.h.schedule(() => { this.timer = null; this.deadline = 0; fn(); }, ms);
  }
  clearTimer() { if (this.timer) this.h.cancel(this.timer); this.timer = null; this.deadline = 0; }
  draw() { if (!this.shoe.length) this.shoe = bjShoe(this.h.rand); return this.shoe.pop(); }
  allBet() { return this.seats.every(s => s.status === 'bet' || !s.connected); }

  sit(key, name, saved) {
    const s = this.seat(key);
    if (s) { s.connected = true; s.leaving = false; return null; } // back from a dropped connection
    if (this.seats.length >= BJ.seats) return '桌子满了（最多 ' + BJ.seats + ' 人）';
    const seat = { key, name, chips: saved ? saved.chips : BJ.startChips, refills: saved ? saved.refills || 0 : 0,
      bet: 0, cards: [], status: 'out', result: '', net: 0, doubled: false, connected: true, leaving: false, activeAt: this.h.now() };
    if (seat.chips < BJ.minBet) { seat.chips = BJ.startChips; seat.refills++; seat.result = 'refill'; }
    this.seats.push(seat);
    return null;
  }

  bet(key, amount) {
    const s = this.seat(key);
    if (!s) return '先坐下';
    if (this.phase !== 'waiting' && this.phase !== 'betting') return '这一局已经开始了，等下一局';
    amount = Math.floor(Number(amount));
    if (!(amount >= BJ.minBet)) return '最少下注 ' + BJ.minBet;
    if (amount > BJ.maxBet) return '最多下注 ' + BJ.maxBet;
    if (amount > s.chips) return '筹码不够';
    s.bet = amount; s.status = 'bet'; s.activeAt = this.h.now();
    if (this.phase === 'waiting') { this.phase = 'betting'; this.setTimer(BJ.betMs, () => this.deal()); }
    if (this.allBet()) this.deal();
    return null;
  }

  deal() {
    this.clearTimer();
    const players = this.seats.filter(s => s.status === 'bet');
    if (!players.length) { this.phase = 'waiting'; return; }
    if (this.shoe.length < BJ.decks * 13) this.shoe = bjShoe(this.h.rand); // cut card at 75%
    this.round++;
    this.dealer = []; this.holeHidden = true;
    for (const s of this.seats) { s.cards = []; s.result = ''; s.net = 0; s.doubled = false; if (s.status === 'bet') s.status = 'playing'; }
    for (let i = 0; i < 2; i++) { for (const s of players) s.cards.push(this.draw()); this.dealer.push(this.draw()); }
    for (const s of players) if (bjNatural(s.cards)) s.status = 'blackjack';
    this.phase = 'playing';
    if (bjNatural(this.dealer)) return this.settle(); // dealer peeks: a dealer blackjack ends the hand at once
    this.nextTurn();
  }

  // Players act in seat order; whoever is first still 'playing' is up.
  nextTurn() {
    for (const s of this.seats) {
      if (s.status !== 'playing') continue;
      if (!s.connected || s.leaving) { s.status = 'stood'; continue; }
      this.turnKey = s.key;
      this.startTurnTimer(s);
      return;
    }
    this.turnKey = null;
    this.dealerPlay();
  }
  startTurnTimer(s) { this.setTimer(BJ.turnMs, () => { s.status = 'stood'; this.nextTurn(); }); }

  act(key, action) {
    const s = this.seat(key);
    if (this.phase !== 'playing' || !s || this.turnKey !== key) return '还没轮到你';
    s.activeAt = this.h.now();
    if (action === 'hit') {
      s.cards.push(this.draw());
      const v = bjValue(s.cards).total;
      if (v < 21) { this.startTurnTimer(s); return null; }
      s.status = v > 21 ? 'bust' : 'stood';
    } else if (action === 'stand') {
      s.status = 'stood';
    } else if (action === 'double') {
      if (s.cards.length !== 2) return '只有头两张牌能加倍';
      if (s.chips < s.bet * 2) return '筹码不够加倍';
      s.bet *= 2; s.doubled = true;
      s.cards.push(this.draw());
      s.status = bjValue(s.cards).total > 21 ? 'bust' : 'stood';
    } else return '不认识的操作';
    this.nextTurn();
    return null;
  }

  dealerPlay() {
    this.holeHidden = false;
    if (this.seats.some(s => s.status === 'stood')) { // only draw if someone is still waiting on the dealer
      while (bjValue(this.dealer).total < 17) this.dealer.push(this.draw());
    }
    this.settle();
  }

  settle() {
    this.clearTimer();
    this.turnKey = null; this.holeHidden = false;
    const d = bjValue(this.dealer).total, dealerBJ = bjNatural(this.dealer);
    for (const s of this.seats) {
      if (!BJ_IN_HAND.includes(s.status)) continue;
      const v = bjValue(s.cards).total, natural = s.status === 'blackjack';
      let net;
      if (s.status === 'bust') net = -s.bet;
      else if (dealerBJ) net = natural ? 0 : -s.bet;
      else if (natural) net = Math.floor(s.bet * 1.5);
      else if (d > 21 || v > d) net = s.bet;
      else net = v === d ? 0 : -s.bet;
      s.result = s.status === 'bust' ? 'bust' : natural && net > 0 ? 'blackjack' : net > 0 ? 'win' : net < 0 ? 'lose' : 'push';
      s.net = net; s.chips += net; s.status = 'done';
    }
    for (const s of this.seats) if (s.connected && !s.leaving) this.h.save(s); // chips saved after every hand
    this.phase = 'result';
    this.setTimer(BJ.resultMs, () => this.nextRound());
  }

  // Between hands: let go of players who stood up or dropped, refill anyone who went broke.
  // The last hand's cards stay on the table until the next deal.
  nextRound() {
    this.clearTimer();
    this.phase = 'waiting';
    for (const s of [...this.seats]) {
      if (s.leaving || !s.connected) { this.remove(s); continue; }
      s.bet = 0; s.status = 'out';
      if (s.chips < BJ.minBet) { s.chips = BJ.startChips; s.refills++; s.result = 'refill'; }
    }
  }

  remove(s) { this.seats = this.seats.filter(x => x !== s); this.h.save(s); }

  // Stand up. Mid-hand you stay until the hand is settled (your hand plays out
  // as a stand), then your chips are saved.
  leave(key) {
    const s = this.seat(key);
    if (!s) return;
    if (this.phase === 'playing' && BJ_IN_HAND.includes(s.status)) {
      s.leaving = true;
      if (this.turnKey === key) { s.status = 'stood'; this.nextTurn(); }
      return;
    }
    this.remove(s);
    if (this.phase === 'betting') {
      if (!this.seats.some(x => x.status === 'bet')) { this.clearTimer(); this.phase = 'waiting'; }
      else if (this.allBet()) this.deal();
    }
  }

  disconnect(key) {
    const s = this.seat(key);
    if (!s) return;
    s.connected = false;
    this.leave(key);
    // Nobody left to watch: play the hand out now so everyone's chips get saved.
    if (!this.seats.some(x => x.connected)) {
      if (this.phase === 'playing') {
        for (const x of this.seats) if (x.status === 'playing') x.status = 'stood';
        this.turnKey = null;
        this.dealerPlay();
      }
      if (this.phase === 'result') this.nextRound();
    }
  }

  // Stand up seated players who haven't bet in a while; returns their keys.
  sweepIdle() {
    if (this.phase !== 'waiting' && this.phase !== 'betting') return [];
    const cutoff = this.h.now() - BJ.idleMs;
    const idle = this.seats.filter(s => s.status === 'out' && s.activeAt < cutoff);
    idle.forEach(s => this.leave(s.key));
    return idle.map(s => s.key);
  }

  // ---- saving (games/saving.js) ----
  snapshot() { return snapshotOf(this); }
  restore(snap) { return restoreInto(this, snap); }
  // After a restore: start the clock that was running, from the top.
  resume() {
    if (this.phase === 'betting') this.setTimer(BJ.betMs, () => this.deal());
    else if (this.phase === 'playing') {
      const s = this.seat(this.turnKey);
      if (s && s.status === 'playing') this.startTurnTimer(s); else this.nextTurn();
    } else if (this.phase === 'result') this.setTimer(BJ.resultMs, () => this.nextRound());
  }

  view() {
    const shown = this.holeHidden ? this.dealer.slice(0, 1) : this.dealer;
    return {
      phase: this.phase, round: this.round, turn: this.turnKey, deadline: this.deadline, now: this.h.now(),
      dealer: this.holeHidden && this.dealer.length ? [this.dealer[0], null] : this.dealer,
      dealerTotal: shown.length ? bjValue(shown).total : null,
      seats: this.seats.map(s => ({ key: s.key, name: s.name, chips: s.chips, bet: s.bet, cards: s.cards,
        total: s.cards.length ? bjValue(s.cards).total : null, status: s.status, result: s.result, net: s.net,
        doubled: s.doubled, connected: s.connected, leaving: s.leaving, refills: s.refills })),
      rules: { minBet: BJ.minBet, maxBet: BJ.maxBet, seats: BJ.seats },
    };
  }
}
