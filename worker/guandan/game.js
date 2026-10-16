// One 掼蛋 table: four seats (people or bots) in two teams, partners across
// from each other (seats 0 + 2 against 1 + 3). Play goes 0 -> 1 -> 2 -> 3.
// A match climbs levels: each team starts at 2; the team that wins a hand
// goes up 3 (partner 2nd, 双下), 2 (partner 3rd) or 1 (partner last), and the
// next hand is played at its level. Winning a hand at your own A, with your
// partner not last, wins the match; levels then start over at 2.
// From the second hand on there's 进贡 / 还贡 (or 抗贡 with both 大王).
// Kept apart from sockets and storage so it can be tested on its own.
// hooks: { now, rand, schedule(fn, ms), cancel(t), save(seat) }.
import { deck, shuffle, sortHand, takeFrom, legalPlay, rankOf, BJ, value } from './cards.js';
import { choosePlay, tributeCard, returnCard, canReturn } from './bot.js';
import { beatOptions, leadOptions } from './hints.js';

export const GD = { base: 10, matchBonus: 60, startPoints: 1000, turnMs: 60000, tributeMs: 20000, botMs: 900, idleMs: 10 * 60 * 1000 };
const BOT_NAMES = ['🤖 小白', '🤖 阿黄', '🤖 小黑', '🤖 大橘'];
const next = i => (i + 1) % 4;
const team = i => i % 2;
const partner = i => (i + 2) % 4;
const UP = { 2: 3, 3: 2, 4: 1 }; // partner's finishing place -> levels gained

export class GuandanGame {
  constructor(hooks) {
    this.h = hooks;
    this.seats = [null, null, null, null];
    this.waitlist = [];
    this.phase = 'waiting'; // waiting -> (tribute) -> playing -> result -> (再来一局) …
    this.levels = [2, 2]; // by team
    this.banker = -1;     // team whose level is being played (-1: nobody yet, play 2)
    this.last = null;     // finishing order of the last hand, for 进贡
    this.round = 0;
    this.turn = -1; this.deadline = 0; this.timer = null;
    this.reset();
  }
  reset() {
    this.level = this.banker < 0 ? 2 : this.levels[this.banker];
    this.trick = null; this.passes = 0; this.order = []; this.said = [null, null, null, null];
    this.tribute = null; this.result = null;
  }
  humans() { return this.seats.filter(s => s && !s.bot); }
  seatOf(key) { return this.seats.findIndex(s => s && !s.bot && s.key === key); }
  has(key) { return this.seatOf(key) >= 0 || this.waitlist.some(w => w.key === key); }
  inHand() { return this.phase === 'tribute' || this.phase === 'playing'; }
  out(i) { return this.order.includes(i); }
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
    if (this.humans().length + this.waitlist.length >= 4) return '这桌已经有 4 个人了';
    const p = { key, name, bot: false, connected: true, leaving: false, auto: false, cards: [], timeouts: 0, activeAt: this.h.now(),
      points: saved ? saved.points : GD.startPoints, refills: saved?.refills || 0, games: saved?.games || 0, wins: saved?.wins || 0 };
    if (p.points <= 0) { p.points = GD.startPoints; p.refills++; }
    const free = this.inHand() ? -1 : this.seats.findIndex(s => !s || s.bot);
    if (free >= 0) this.seats[free] = p; else this.waitlist.push(p);
    return null;
  }
  bot(i) { return { key: 'bot' + i, name: BOT_NAMES[i], bot: true, connected: true, cards: [] }; }

  // Anyone at the table (or queued for it) deals: the first hand, and the next one after each result.
  start(key) {
    if (!this.has(key)) return '先坐下';
    const i = this.seatOf(key);
    if (i >= 0) this.touch(i);
    if (this.phase === 'waiting') { this.first = Math.floor(this.h.rand() * 4); this.deal(); }
    else if (this.phase === 'result') this.nextHand();
    return null;
  }

  deal() {
    this.clearTimer();
    for (const w of this.waitlist.splice(0)) { const i = this.seats.findIndex(s => !s || s.bot); if (i >= 0) this.seats[i] = w; }
    this.seats = this.seats.map((s, i) => s || this.bot(i));
    this.reset();
    this.round++;
    const d = shuffle(deck(), this.h.rand);
    this.seats.forEach((s, i) => { s.cards = sortHand(d.slice(i * 27, i * 27 + 27), this.level); });
    if (this.last) this.startTribute(); else this.startPlay(this.first ?? 0);
  }

  // ---- 进贡 / 还贡 ----
  // 末游 gives 头游 their biggest card (not a wild heart); after a 双下 both
  // losers give, the bigger card to 头游. Holding both 大王 between the givers
  // is 抗贡: no tribute, 头游 leads. Each receiver gives back a card of 10 or
  // lower; the giver of the bigger tribute leads.
  startTribute() {
    const [o1, o2, o3, o4] = this.last;
    const double = team(o1) === team(o2);
    const givers = double ? [o3, o4] : [o4];
    const bigJokers = givers.reduce((n, g) => n + this.seats[g].cards.filter(c => rankOf(c) === BJ).length, 0);
    if (bigJokers >= 2) {
      this.tribute = { resist: true, gives: [], returns: [] };
      givers.forEach(g => { this.said[g] = '抗贡'; });
      return this.startPlay(o1);
    }
    const picks = givers.map(g => ({ from: g, card: tributeCard(this.seats[g].cards, this.level) }));
    let gives;
    if (!double) gives = [{ ...picks[0], to: o1 }];
    else {
      const [a, b] = picks, va = value(a.card, this.level), vb = value(b.card, this.level);
      gives = va >= vb ? [{ ...a, to: o1 }, { ...b, to: o2 }] : [{ ...b, to: o1 }, { ...a, to: o2 }];
    }
    for (const g of gives) {
      this.seats[g.from].cards = takeFrom(this.seats[g.from].cards, [g.card]);
      this.seats[g.to].cards = sortHand(this.seats[g.to].cards.concat(g.card), this.level);
    }
    this.tribute = { resist: false, gives, returns: gives.map(g => ({ from: g.to, to: g.from, card: null })), leader: gives[0].from };
    this.phase = 'tribute';
    this.setTimer(GD.tributeMs, () => this.finishReturns());
    // bots give back right away
    for (const r of this.tribute.returns) {
      const s = this.seats[r.from];
      if (s.bot || s.auto || !s.connected) this.doReturn(r.from, returnCard(s.cards, this.level));
    }
  }
  giveBack(key, card) {
    const i = this.seatOf(key);
    if (this.phase !== 'tribute') return '现在不用还贡';
    const r = this.tribute.returns.find(x => x.from === i && !x.card);
    if (!r) return '你不用还贡';
    if (!this.seats[i].cards.includes(card)) return '手里没有这张牌';
    if (!canReturn(card, this.level) && this.seats[i].cards.some(c => canReturn(c, this.level))) return '还贡要 10 或以下的牌';
    this.touch(i);
    this.doReturn(i, card);
    return null;
  }
  doReturn(i, card) {
    const r = this.tribute.returns.find(x => x.from === i && !x.card);
    if (!r) return;
    r.card = card;
    this.seats[i].cards = takeFrom(this.seats[i].cards, [card]);
    this.seats[r.to].cards = sortHand(this.seats[r.to].cards.concat(card), this.level);
    if (this.tribute.returns.every(x => x.card)) { this.clearTimer(); this.startPlay(this.tribute.leader); }
  }
  finishReturns() { // time's up: give back for whoever hasn't
    for (const r of this.tribute.returns) if (!r.card) this.doReturn(r.from, returnCard(this.seats[r.from].cards, this.level));
  }

  // ---- play ----
  startPlay(leader) {
    this.phase = 'playing';
    this.trick = null; this.passes = 0;
    this.setTurn(leader);
  }
  // Bots (and people on 托管) move after a short pause; people get a countdown.
  setTurn(i) {
    this.turn = i;
    const s = this.seats[i];
    if (s.bot || s.auto || !s.connected) return this.setTimer(GD.botMs, () => this.botMove(i));
    this.setTimer(GD.turnMs, () => {
      s.timeouts++;
      if (s.timeouts >= 2) s.auto = true; // two missed turns in a row: 托管
      this.botMove(i);
    });
  }
  nextIn(i) { let n = next(i); while (this.out(n)) n = next(n); return n; }
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
    const play = legalPlay(cards, prev, this.level);
    if (!play) return prev ? '管不上，或者牌型不对' : '这不是一手能出的牌';
    s.cards = left;
    this.trick = { play, cards: sortHand(cards, this.level), by: i };
    this.passes = 0;
    this.said[i] = { cards: this.trick.cards, play };
    if (!left.length) {
      this.order.push(i);
      if (this.handOver()) { this.endHand(); return null; }
    }
    this.advance(i);
    return null;
  }
  doPass(i) {
    if (!this.toBeat(i)) return '该你出牌了，不能不出';
    this.said[i] = '不出';
    this.passes++;
    this.advance(i);
    return null;
  }
  // Once everyone still holding cards has passed, the trick's owner leads; if
  // they've gone out, their partner leads instead (接风).
  advance(i) {
    const owner = this.trick.by;
    const holding = [0, 1, 2, 3].filter(k => !this.out(k));
    const needed = holding.filter(k => k !== owner).length;
    if (this.passes >= needed) {
      const lead = !this.out(owner) ? owner : !this.out(partner(owner)) ? partner(owner) : this.nextIn(owner);
      this.trick = null; this.passes = 0;
      this.said = this.said.map((x, k) => (k === lead ? x : null));
      if (this.out(owner) && lead === partner(owner)) this.said[lead] = '接风';
      return this.setTurn(lead);
    }
    this.setTurn(this.nextIn(i));
  }
  // Over when a team has both players out, or three players are out.
  handOver() {
    const o = this.order;
    return o.length >= 3 || (o.length === 2 && team(o[0]) === team(o[1]));
  }
  touch(i) { const s = this.seats[i]; s.timeouts = 0; s.activeAt = this.h.now(); }

  ctx(i) {
    const opp = [next(i), (i + 3) % 4].filter(k => !this.out(k));
    return {
      partnerOwns: !!(this.trick && this.trick.by === partner(i)),
      oppMin: opp.length ? Math.min(...opp.map(k => this.seats[k].cards.length)) : 27,
    };
  }
  botMove(i) {
    if (this.phase === 'tribute') return this.finishReturns();
    if (this.phase !== 'playing') return;
    const s = this.seats[i];
    const prev = this.toBeat(i);
    const cards = choosePlay(s.cards, prev, this.level, this.ctx(i));
    if (cards && !this.doPlay(i, cards)) return;
    if (prev) return this.doPass(i);
    this.doPlay(i, [s.cards[s.cards.length - 1]]); // fallback lead: the smallest card
  }
  // 提示 (hints.js): leading, the hand's own groups from the cheapest;
  // following, everything that beats the table. One per press, starting over
  // when the cards on the table (or, leading, your hand) change.
  hint(key) {
    const i = this.seatOf(key);
    if (this.phase !== 'playing' || i !== this.turn) return null;
    const s = this.seats[i], prev = this.toBeat(i);
    const opts = prev ? beatOptions(s.cards, prev, this.level) : leadOptions(s.cards, this.level, this.ctx(i));
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
    if (this.phase === 'playing' && this.turn === i) this.setTurn(i);
    if (on && this.phase === 'tribute') { const r = this.tribute.returns.find(x => x.from === i && !x.card); if (r) this.doReturn(i, returnCard(s.cards, this.level)); }
  }

  // ---- end of a hand ----
  endHand() {
    this.clearTimer();
    const holding = [0, 1, 2, 3].filter(k => !this.out(k));
    // whoever is still holding cards finishes last, in turn order
    for (let k = this.turn, n = 0; n < 4; k = next(k), n++) if (holding.includes(k) && !this.order.includes(k)) this.order.push(k);
    const order = this.order, win = team(order[0]);
    const place = order.indexOf(partner(order[0])) + 1;
    const up = UP[place];
    const matchWon = this.banker === win && this.levels[win] === 14 && place !== 4;
    const unit = matchWon ? GD.matchBonus : GD.base * up;
    const deltas = [0, 1, 2, 3].map(k => (team(k) === win ? unit : -unit));
    this.seats.forEach((s, k) => { if (!s.bot) { s.points += deltas[k]; s.games++; if (deltas[k] > 0) s.wins++; } });
    const before = this.levels.slice();
    if (matchWon) { this.levels = [2, 2]; this.banker = -1; this.last = null; }
    else { this.levels[win] = Math.min(14, this.levels[win] + up); this.banker = win; this.last = order.slice(); }
    this.result = { order: order.slice(), winTeam: win, up, matchWon, deltas, level: this.level, before, after: this.levels.slice(),
      names: this.seats.map(s => s.name) };
    this.phase = 'result';
    this.turn = -1;
    this.release();
  }
  // Let go of people who stood up or dropped during the hand. The result stays
  // up until someone presses 再来一局; with nobody left, the table clears.
  release() {
    this.seats.forEach((s, k) => { if (s && !s.bot && (s.leaving || !s.connected)) { this.h.save(s); this.seats[k] = null; } });
    if (!this.humans().length && !this.waitlist.length) this.clear();
  }
  clear() {
    this.clearTimer();
    this.seats = [null, null, null, null]; this.levels = [2, 2]; this.banker = -1; this.last = null;
    this.reset(); this.phase = 'waiting'; this.turn = -1;
  }
  nextHand() {
    this.release();
    if (this.phase !== 'result') return;
    for (const s of this.humans()) if (s.points <= 0) { s.points = GD.startPoints; s.refills++; }
    this.first = this.last ? null : Math.floor(this.h.rand() * 4);
    this.deal();
  }

  // Stand up. Mid-hand, 托管 plays your cards to the end, then you're saved.
  leave(key) {
    const w = this.waitlist.findIndex(x => x.key === key);
    if (w >= 0) { this.waitlist.splice(w, 1); return; }
    const i = this.seatOf(key);
    if (i < 0) return;
    const s = this.seats[i];
    if (this.inHand()) {
      s.leaving = true;
      this.setAuto(key, true);
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
    // No one left watching: play the hand out now so everyone's points get saved.
    if (this.inHand() && !this.humans().some(s => s.connected)) {
      for (let guard = 0; this.inHand() && guard < 3000; guard++) this.botMove(this.turn);
    }
  }
  sweepIdle() {
    const cutoff = this.h.now() - GD.idleMs;
    const idle = this.humans().filter(s => s.activeAt < cutoff).map(s => s.key);
    idle.forEach(k => this.leave(k));
    return idle;
  }

  // What one viewer sees: their own cards, everyone's counts, all hands once it's over.
  view(key) {
    const me = this.seatOf(key), over = this.phase === 'result';
    const tr = this.tribute;
    return {
      phase: this.phase, round: this.round, turn: this.turn, deadline: this.deadline, now: this.h.now(),
      level: this.level, levels: this.levels, banker: this.banker, base: GD.base,
      trickBy: this.trick ? this.trick.by : -1,
      said: this.said,
      order: this.order,
      seats: this.seats.map((s, k) => s && {
        name: s.name, bot: s.bot, me: k === me, connected: s.connected, auto: !!s.auto, leaving: !!s.leaving,
        points: s.bot ? null : s.points, count: s.cards.length, cards: k === me || over ? s.cards : null,
        place: this.order.indexOf(k) + 1,
      }),
      // tribute cards are public; the card given back is only shown to the two players involved
      tribute: tr && { resist: tr.resist, gives: tr.gives, returns: tr.returns.map(r => ({ from: r.from, to: r.to, done: !!r.card, card: r.from === me || r.to === me || over ? r.card : null })) },
      mustReturn: this.phase === 'tribute' && tr.returns.some(r => r.from === me && !r.card),
      waitlist: this.waitlist.map(w => w.name),
      waiting: this.waitlist.some(w => w.key === key),
      you: me,
      result: this.result,
    };
  }
}
