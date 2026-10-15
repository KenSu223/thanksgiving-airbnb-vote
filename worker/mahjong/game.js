// One 川麻 table, 血战到底: four seats (people or bots), 108 tiles.
// A hand: deal 13 (the dealer 14) -> 换三张 (everyone passes three tiles of
// one suit, the same random direction for all) -> 定缺 (everyone gives up a
// suit) -> play. Only 碰 and 杠, no 吃. Your 缺 tiles must go first, and you
// can't 胡 while holding any. A discard can be 胡'd by several players at
// once (一炮多响); passing on a 胡 means no 胡 off discards until your next
// draw (过水不胡). Whoever wins leaves the hand and the rest play on, until
// three have won or the wall runs out; then 查花猪 / 查大叫 settle the rest.
// Money moves during the hand (杠 pays at once: 直杠 2 from the discarder,
// 暗杠 2 and 补杠 1 from everyone still playing) and is booked at the end.
// Kept apart from sockets and storage so it can be tested on its own.
// hooks: { now, rand, schedule(fn, ms), cancel(t), save(seat) }.
import { wall, shuffle, sortTiles, counts, take, suitOf, SUITS, idx } from './tiles.js';
import { isWin, fan, waits, holdsSuit } from './hand.js';
import { chooseSwap, chooseLack, chooseDiscard, wantPong, wantKong, wantAddKong } from './bot.js';

export const MJ = { base: 5, hua: 16, startPoints: 1000, swapMs: 25000, lackMs: 15000, turnMs: 60000, claimMs: 10000, botMs: 800, idleMs: 10 * 60 * 1000 };
const BOT_NAMES = ['🤖 小白', '🤖 阿黄', '🤖 小黑', '🤖 大橘'];
const next = i => (i + 1) % 4;

export class MahjongGame {
  constructor(hooks) {
    this.h = hooks;
    this.seats = [null, null, null, null];
    this.waitlist = [];
    this.phase = 'waiting'; // waiting -> swap -> lack -> playing -> result -> (再来一局) …
    this.dealer = 0;
    this.round = 0;
    this.turn = -1; this.deadline = 0; this.timer = null;
    this.reset();
  }
  reset() {
    this.wall = []; this.stage = null; this.last = null; this.claims = null;
    this.ledger = [0, 0, 0, 0]; this.wins = []; this.result = null; this.swapDir = 0;
    this.discarded = false; this.nextDealer = null; this.said = [null, null, null, null];
  }
  humans() { return this.seats.filter(s => s && !s.bot); }
  seatOf(key) { return this.seats.findIndex(s => s && !s.bot && s.key === key); }
  has(key) { return this.seatOf(key) >= 0 || this.waitlist.some(w => w.key === key); }
  inHand() { return this.phase === 'swap' || this.phase === 'lack' || this.phase === 'playing'; }
  live(i) { return !this.seats[i].won; }
  nextLive(i) { let n = next(i); while (!this.live(n) && n !== i) n = next(n); return n; }
  setTimer(ms, fn) {
    this.clearTimer();
    this.deadline = this.h.now() + ms;
    this.timer = this.h.schedule(() => { this.timer = null; this.deadline = 0; fn(); }, ms);
  }
  clearTimer() { if (this.timer) this.h.cancel(this.timer); this.timer = null; this.deadline = 0; }
  machine(s) { return s.bot || s.auto || !s.connected; }

  // ---- seats ----
  sit(key, name, saved) {
    const i = this.seatOf(key);
    if (i >= 0) { Object.assign(this.seats[i], { connected: true, leaving: false, auto: false }); return null; }
    if (this.waitlist.some(w => w.key === key)) return null;
    if (this.humans().length + this.waitlist.length >= 4) return '这桌已经有 4 个人了';
    const p = { key, name, bot: false, connected: true, leaving: false, auto: false, timeouts: 0, activeAt: this.h.now(),
      points: saved ? saved.points : MJ.startPoints, refills: saved?.refills || 0, games: saved?.games || 0, wins: saved?.wins || 0 };
    if (p.points <= 0) { p.points = MJ.startPoints; p.refills++; }
    this.fresh(p);
    const free = this.inHand() ? -1 : this.seats.findIndex(s => !s || s.bot);
    if (free >= 0) this.seats[free] = p; else this.waitlist.push(p);
    return null;
  }
  fresh(s) { Object.assign(s, { hand: [], melds: [], river: [], lack: null, won: null, swap: null, received: null, passHu: false, justKonged: false, afterPong: false, drawn: null, draws: 0 }); }
  bot(i) { const b = { key: 'bot' + i, name: BOT_NAMES[i], bot: true, connected: true }; this.fresh(b); return b; }

  // Anyone at the table (or queued for it) deals: the first hand, and the next one after each result.
  start(key) {
    if (!this.has(key)) return '先坐下';
    const i = this.seatOf(key);
    if (i >= 0) this.touch(i);
    if (this.phase === 'waiting') { this.dealer = Math.floor(this.h.rand() * 4); this.deal(); }
    else if (this.phase === 'result') this.nextHand();
    return null;
  }
  touch(i) { const s = this.seats[i]; s.timeouts = 0; s.activeAt = this.h.now(); }

  deal() {
    this.clearTimer();
    for (const w of this.waitlist.splice(0)) { const i = this.seats.findIndex(s => !s || s.bot); if (i >= 0) this.seats[i] = w; }
    this.seats = this.seats.map((s, i) => s || this.bot(i));
    this.reset();
    this.round++;
    this.wall = shuffle(wall(), this.h.rand);
    this.seats.forEach(s => { this.fresh(s); s.hand = sortTiles(this.wall.splice(0, 13)); });
    const d = this.seats[this.dealer];
    d.drawn = this.wall.shift(); d.hand = sortTiles(d.hand.concat(d.drawn));
    this.turn = this.dealer;
    this.phase = 'swap';
    this.setTimer(MJ.swapMs, () => this.autoStep());
    this.seats.forEach((s, i) => { if (this.machine(s)) this.pickSwap(i, chooseSwap(s.hand)); });
  }

  // ---- 换三张 ----
  swap(key, tiles) {
    const i = this.seatOf(key);
    if (this.phase !== 'swap') return '现在不是换牌的时候';
    if (this.seats[i].swap) return '已经选好了';
    if (!Array.isArray(tiles) || tiles.length !== 3) return '选三张';
    tiles = tiles.map(String);
    if (new Set(tiles.map(suitOf)).size !== 1 || !this.takeAll(this.seats[i].hand, tiles)) return '要选同一门花色的三张';
    this.touch(i);
    this.pickSwap(i, tiles);
    return null;
  }
  takeAll(hand, tiles) { let h = hand; for (const k of tiles) { h = take(h, k); if (!h) return null; } return h; }
  pickSwap(i, tiles) {
    this.seats[i].swap = tiles;
    if (this.seats.every(s => s.swap)) this.doSwap();
  }
  doSwap() {
    this.swapDir = 1 + Math.floor(this.h.rand() * 3); // 1: to the next player, 2: across, 3: to the one before
    this.seats.forEach(s => { s.hand = this.takeAll(s.hand, s.swap); });
    this.seats.forEach((s, i) => {
      const to = this.seats[(i + this.swapDir) % 4];
      to.received = s.swap.slice();
      to.hand = sortTiles(to.hand.concat(s.swap));
    });
    const d = this.seats[this.dealer];
    if (!d.hand.includes(d.drawn)) d.drawn = null;
    this.phase = 'lack';
    this.setTimer(MJ.lackMs, () => this.autoStep());
    this.seats.forEach((s, i) => { if (this.machine(s)) this.pickLack(i, chooseLack(s.hand)); });
  }

  // ---- 定缺 ----
  lack(key, suit) {
    const i = this.seatOf(key);
    if (this.phase !== 'lack') return '现在不是定缺的时候';
    if (!SUITS.includes(suit)) return '选一门';
    this.touch(i);
    this.pickLack(i, suit);
    return null;
  }
  pickLack(i, suit) {
    if (this.seats[i].lack) return;
    this.seats[i].lack = suit;
    if (this.seats.every(s => s.lack)) this.startPlay();
  }
  startPlay() {
    this.phase = 'playing';
    this.seats.forEach(s => { s.hand = sortTiles(s.hand, s.lack); });
    this.setTurn(this.dealer);
  }

  // ---- your turn: 自摸, 杠, or discard ----
  setTurn(i) {
    this.turn = i; this.stage = 'act';
    const s = this.seats[i];
    if (this.machine(s)) return this.setTimer(MJ.botMs, () => this.botAct(i));
    this.setTimer(MJ.turnMs, () => {
      s.timeouts++;
      if (s.timeouts >= 2) s.auto = true; // two missed turns in a row: 托管
      this.botAct(i);
    });
  }
  options(i) {
    const s = this.seats[i], c = counts(s.hand);
    const out = { hu: !s.afterPong && isWin(c, s.melds, s.lack), kongs: [], mustLack: holdsSuit(c, s.lack) };
    if (!s.afterPong && this.wall.length) {
      for (const k of new Set(s.hand)) {
        if (suitOf(k) === s.lack) continue;
        if (c[idx(k)] === 4) out.kongs.push({ kind: k, type: 'an' });
        if (s.melds.some(m => m.type === 'pong' && m.kind === k)) out.kongs.push({ kind: k, type: 'add' });
      }
    }
    return out;
  }
  mine(key) {
    const i = this.seatOf(key);
    return this.phase === 'playing' && this.stage === 'act' && i === this.turn ? i : -1;
  }
  selfHu(key) {
    const i = this.mine(key);
    if (i < 0) return '还没轮到你';
    if (!this.options(i).hu) return '还不能胡';
    this.touch(i);
    this.doSelfHu(i);
    return null;
  }
  kong(key, kind) {
    const i = this.mine(key);
    if (i < 0) return '还没轮到你';
    if (!this.options(i).kongs.some(k => k.kind === kind)) return '不能杠这张';
    this.touch(i);
    this.doKong(i, kind);
    return null;
  }
  discard(key, kind) {
    const i = this.mine(key);
    if (i < 0) return '还没轮到你';
    const s = this.seats[i];
    if (!s.hand.includes(kind)) return '手里没有这张';
    if (suitOf(kind) !== s.lack && this.options(i).mustLack) return '先把缺的那门打完';
    this.touch(i);
    this.doDiscard(i, kind);
    return null;
  }
  seen() { // tiles everyone can see: rivers, melds, hands of players who have won
    const c = new Array(27).fill(0);
    for (const s of this.seats) {
      for (const k of s.river) c[idx(k)]++;
      for (const m of s.melds) c[idx(m.kind)] += m.type === 'kong' ? 4 : 3;
      if (s.won) for (const k of s.hand) c[idx(k)]++;
    }
    return c;
  }
  botAct(i) {
    if (this.phase !== 'playing' || this.stage !== 'act' || this.turn !== i) return;
    const s = this.seats[i], o = this.options(i);
    if (o.hu) return this.doSelfHu(i);
    for (const k of o.kongs) {
      if (k.type === 'an' ? wantKong(s.hand, s.melds, k.kind, true) : wantAddKong(s.hand, s.melds, k.kind)) return this.doKong(i, k.kind);
    }
    this.doDiscard(i, chooseDiscard(s.hand, s.melds, s.lack, this.seen()));
  }

  doDiscard(i, kind) {
    const s = this.seats[i];
    s.hand = sortTiles(take(s.hand, kind), s.lack);
    s.river.push(kind);
    s.drawn = null; s.afterPong = false;
    this.last = { seat: i, kind, afterKong: s.justKonged };
    s.justKonged = false;
    this.discarded = true;
    this.said[i] = null;
    const who = {};
    for (let q = 0; q < 4; q++) {
      if (q === i || !this.live(q)) continue;
      const t = this.seats[q], c = counts(t.hand), opts = {};
      if (!t.passHu) { c[idx(kind)]++; if (isWin(c, t.melds, t.lack)) opts.hu = true; c[idx(kind)]--; }
      if (suitOf(kind) !== t.lack) {
        if (c[idx(kind)] >= 3 && this.wall.length) opts.kong = true;
        if (c[idx(kind)] >= 2) opts.pong = true;
      }
      if (opts.hu || opts.kong || opts.pong) who[q] = { ...opts, choice: null };
    }
    if (!Object.keys(who).length) return this.nextDraw(i);
    this.openClaims({ from: i, kind, rob: false, who });
  }
  // ---- claims on a discard (胡 / 杠 / 碰), or 抢杠 on a 补杠 ----
  openClaims(claims) {
    this.claims = claims;
    this.stage = 'claim';
    for (const q of Object.keys(claims.who).map(Number)) if (this.machine(this.seats[q])) claims.who[q].choice = this.botClaim(q);
    if (this.claimsDone()) return this.setTimer(MJ.botMs, () => this.resolveClaims());
    this.setTimer(MJ.claimMs, () => this.timeoutClaims());
  }
  botClaim(q) {
    const { kind, who } = this.claims, o = who[q], t = this.seats[q];
    if (o.hu) return 'hu';
    if (o.kong && wantKong(t.hand, t.melds, kind, false)) return 'kong';
    if (o.pong && wantPong(t.hand, t.melds, t.lack, kind)) return 'pong';
    return 'pass';
  }
  claimsDone() { return Object.values(this.claims.who).every(o => o.choice); }
  claim(key, choice) {
    const q = this.seatOf(key);
    const o = this.claims?.who[q];
    if (this.stage !== 'claim' || !o || o.choice) return '现在没有能碰杠胡的牌';
    if (choice !== 'pass' && !o[choice]) return '不能这样';
    this.touch(q);
    o.choice = choice;
    if (this.claimsDone()) this.resolveClaims();
    return null;
  }
  // time's up: whoever hasn't answered gets what a bot would do (a 胡 is never missed)
  timeoutClaims() {
    if (!this.claims) return;
    for (const q of Object.keys(this.claims.who).map(Number)) if (!this.claims.who[q].choice) this.claims.who[q].choice = this.botClaim(q);
    this.resolveClaims();
  }
  resolveClaims() {
    if (!this.claims) return;
    this.clearTimer();
    const { from, kind, rob, who } = this.claims;
    this.claims = null;
    const order = [1, 2, 3].map(d => (from + d) % 4).filter(q => who[q]);
    const huers = order.filter(q => who[q].choice === 'hu');
    for (const q of order) if (who[q].hu && who[q].choice !== 'hu') this.seats[q].passHu = true; // 过水不胡
    if (huers.length) {
      if (rob) this.seats[from].hand = take(this.seats[from].hand, kind); // the robbed 补杠 never happens
      else this.seats[from].river.pop();
      if (!this.wins.length) this.nextDealer = huers.length > 1 ? from : huers[0];
      const shot = { gangShot: !rob && this.last?.afterKong, robKong: rob, lastTile: !rob && !this.wall.length };
      huers.forEach((q, n) => this.win(q, { from, tile: kind, self: false, flags: shot, shared: n > 0 }));
      if (this.wins.length >= 3) return this.endHand();
      return this.nextDraw(huers[huers.length - 1]);
    }
    if (rob) return this.finishAddKong(from, kind);
    const kq = order.find(q => who[q].choice === 'kong'), pq = order.find(q => who[q].choice === 'pong');
    if (kq !== undefined) return this.exposedKong(kq, from, kind);
    if (pq !== undefined) return this.pong(pq, from, kind);
    this.nextDraw(from);
  }
  pong(q, from, kind) {
    const t = this.seats[q];
    this.seats[from].river.pop();
    t.hand = take(t.hand, kind, 2);
    t.melds.push({ kind, type: 'pong', from });
    t.afterPong = true;
    this.said[q] = '碰';
    this.setTurn(q);
  }
  exposedKong(q, from, kind) {
    const t = this.seats[q];
    this.seats[from].river.pop();
    t.hand = take(t.hand, kind, 3);
    t.melds.push({ kind, type: 'kong', from });
    this.pay(from, q, 2 * MJ.base); // 直杠
    this.said[q] = '杠';
    this.replacement(q);
  }
  doKong(i, kind) {
    const s = this.seats[i];
    const meld = s.melds.find(m => m.type === 'pong' && m.kind === kind);
    if (!meld) { // 暗杠
      s.hand = take(s.hand, kind, 4);
      s.melds.push({ kind, type: 'kong', concealed: true });
      for (let q = 0; q < 4; q++) if (q !== i && this.live(q)) this.pay(q, i, 2 * MJ.base);
      this.said[i] = '暗杠';
      return this.replacement(i);
    }
    // 补杠: anyone waiting on this tile may 抢杠 first
    const who = {};
    for (let q = 0; q < 4; q++) {
      if (q === i || !this.live(q) || this.seats[q].passHu) continue;
      const c = counts(this.seats[q].hand); c[idx(kind)]++;
      if (isWin(c, this.seats[q].melds, this.seats[q].lack)) who[q] = { hu: true, choice: null };
    }
    if (Object.keys(who).length) return this.openClaims({ from: i, kind, rob: true, who });
    this.finishAddKong(i, kind);
  }
  finishAddKong(i, kind) {
    const s = this.seats[i];
    s.hand = take(s.hand, kind);
    const meld = s.melds.find(m => m.type === 'pong' && m.kind === kind);
    meld.type = 'kong'; meld.added = true;
    for (let q = 0; q < 4; q++) if (q !== i && this.live(q)) this.pay(q, i, MJ.base);
    this.said[i] = '补杠';
    this.replacement(i);
  }
  pay(from, to, n) { this.ledger[from] -= n; this.ledger[to] += n; }
  replacement(i) { // a 杠 draws one more tile, from the far end of the wall
    if (!this.wall.length) return this.endHand();
    const s = this.seats[i];
    s.drawn = this.wall.pop();
    s.hand = sortTiles(s.hand.concat(s.drawn), s.lack);
    s.justKonged = true; s.passHu = false;
    this.setTurn(i);
  }
  nextDraw(from) {
    if (!this.wall.length) return this.endHand();
    const q = this.nextLive(from), s = this.seats[q];
    s.drawn = this.wall.shift();
    s.hand = sortTiles(s.hand.concat(s.drawn), s.lack);
    s.passHu = false; s.justKonged = false; s.draws++;
    this.setTurn(q);
  }

  // ---- winning ----
  doSelfHu(i) {
    if (!this.wins.length) this.nextDealer = i;
    const s = this.seats[i];
    const tile = s.drawn && s.hand.includes(s.drawn) ? s.drawn : s.hand[s.hand.length - 1];
    this.win(i, { from: -1, tile, self: true, flags: {
      gangFlower: s.justKonged, lastTile: !this.wall.length,
      heaven: i === this.dealer && !this.discarded,
      earth: i !== this.dealer && s.draws === 1 && !this.seats.some(x => x.melds.length) && this.seats[i].river.length === 0,
    } });
    if (this.wins.length >= 3) return this.endHand();
    this.nextDraw(i);
  }
  // The winning tile is kept on its own (s.won.tile), next to the hand. When
  // several players 胡 the same discard it's one tile; `shared` marks the
  // second and third.
  win(q, { from, tile, self, flags, shared }) {
    const s = this.seats[q];
    if (self) s.hand = take(s.hand, tile);
    const c = counts(s.hand); c[idx(tile)]++;
    const f = fan(c, s.melds, { ...flags, self });
    const amount = MJ.base * 2 ** f.fan;
    if (self) { for (let p = 0; p < 4; p++) if (p !== q && this.live(p)) this.pay(p, q, amount + MJ.base); } // 自摸加底
    else this.pay(from, q, amount);
    s.won = { order: this.wins.length + 1, tile, self, from, fan: f.fan, names: f.names, amount, shared: !!shared };
    s.drawn = null;
    this.wins.push(q);
    this.said[q] = self ? '自摸' : '胡';
  }

  // ---- end of a hand ----
  endHand() {
    this.clearTimer();
    this.claims = null;
    const left = [0, 1, 2, 3].filter(k => this.live(k));
    let check = [];
    if (left.length >= 2) { // the wall ran out: 查花猪, 查大叫
      check = left.map(i => {
        const s = this.seats[i], c = counts(s.hand), hua = holdsSuit(c, s.lack);
        const w = hua ? [] : waits(c, s.melds, s.lack);
        return { seat: i, hua, ready: w.length > 0, fan: w.length ? Math.max(...w.map(x => x.fan)) : 0, waits: w.map(x => x.kind) };
      });
      for (const a of check) if (a.hua) for (const b of check) if (!b.hua) this.pay(a.seat, b.seat, MJ.hua * MJ.base);
      for (const a of check) if (!a.hua && !a.ready) for (const b of check) if (b.ready) this.pay(a.seat, b.seat, MJ.base * 2 ** b.fan);
    }
    this.seats.forEach((s, k) => { if (!s.bot) { s.points += this.ledger[k]; s.games++; if (this.ledger[k] > 0) s.wins++; } });
    this.result = { deltas: this.ledger.slice(), wins: this.wins.map(q => ({ seat: q, ...this.seats[q].won })), check, wallLeft: this.wall.length,
      names: this.seats.map(s => s.name) };
    if (this.nextDealer !== null) this.dealer = this.nextDealer;
    this.phase = 'result';
    this.turn = -1; this.stage = null;
    this.release();
  }
  // Let go of people who stood up or dropped during the hand. The result stays
  // up until someone presses 再来一局; with nobody left, the table clears.
  release() {
    this.seats.forEach((s, k) => { if (s && !s.bot && (s.leaving || !s.connected)) { this.h.save(s); this.seats[k] = null; } });
    if (!this.humans().length && !this.waitlist.length) this.clear();
  }
  clear() { this.clearTimer(); this.reset(); this.seats = [null, null, null, null]; this.phase = 'waiting'; this.turn = -1; }
  nextHand() {
    this.release();
    if (this.phase !== 'result') return;
    for (const s of this.humans()) if (s.points <= 0) { s.points = MJ.startPoints; s.refills++; }
    this.deal();
  }

  // Whatever is waiting on someone: let a bot decide it (timeouts, 托管, nobody connected).
  autoStep() {
    if (this.phase === 'swap') { this.seats.forEach((s, i) => { if (!s.swap) this.pickSwap(i, chooseSwap(s.hand)); }); }
    else if (this.phase === 'lack') { this.seats.forEach((s, i) => { if (!s.lack) this.pickLack(i, chooseLack(s.hand)); }); }
    else if (this.phase === 'playing') { if (this.stage === 'claim') this.timeoutClaims(); else this.botAct(this.turn); }
  }
  setAuto(key, on) {
    const i = this.seatOf(key);
    if (i < 0) return;
    const s = this.seats[i];
    s.auto = !!on; s.timeouts = 0;
    if (!on) return;
    if (this.phase === 'swap' && !s.swap) this.pickSwap(i, chooseSwap(s.hand));
    else if (this.phase === 'lack' && !s.lack) this.pickLack(i, chooseLack(s.hand));
    else if (this.phase === 'playing' && this.stage === 'act' && this.turn === i) this.setTurn(i);
    else if (this.phase === 'playing' && this.stage === 'claim' && this.claims.who[i] && !this.claims.who[i].choice) {
      this.claims.who[i].choice = this.botClaim(i);
      if (this.claimsDone()) this.resolveClaims();
    }
  }

  // Stand up. Mid-hand, 托管 plays your tiles to the end, then you're saved.
  leave(key) {
    const w = this.waitlist.findIndex(x => x.key === key);
    if (w >= 0) { this.waitlist.splice(w, 1); return; }
    const i = this.seatOf(key);
    if (i < 0) return;
    const s = this.seats[i];
    if (this.inHand()) { s.leaving = true; this.setAuto(key, true); return; }
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
      for (let guard = 0; this.inHand() && guard < 3000; guard++) this.autoStep();
    }
  }
  sweepIdle() {
    const cutoff = this.h.now() - MJ.idleMs;
    const idle = this.humans().filter(s => s.activeAt < cutoff).map(s => s.key);
    idle.forEach(k => this.leave(k));
    return idle;
  }

  // What one viewer sees: their own tiles, everyone's melds and discards, the
  // hands of players who've won, all hands once it's over.
  view(key) {
    const me = this.seatOf(key), over = this.phase === 'result';
    const o = me >= 0 && this.mine(key) === me ? this.options(me) : null;
    const c = this.claims && me >= 0 && this.claims.who[me];
    return {
      phase: this.phase, round: this.round, turn: this.turn, stage: this.stage, deadline: this.deadline, now: this.h.now(),
      dealer: this.dealer, wallLeft: this.wall.length, base: MJ.base, swapDir: this.phase === 'swap' ? 0 : this.swapDir,
      last: this.last && { seat: this.last.seat, kind: this.last.kind },
      claimOn: this.claims && { from: this.claims.from, kind: this.claims.kind, rob: this.claims.rob },
      said: this.said,
      seats: this.seats.map((s, k) => s && {
        name: s.name, bot: s.bot, me: k === me, connected: s.connected, auto: !!s.auto, leaving: !!s.leaving,
        points: s.bot ? null : s.points, count: s.hand.length,
        hand: k === me || over || s.won ? s.hand : null,
        drawn: k === me ? s.drawn : null,
        melds: s.melds.map(m => ({ kind: m.concealed && k !== me && !over ? null : m.kind, type: m.type, concealed: !!m.concealed })),
        river: s.river,
        lack: this.phase === 'lack' && k !== me ? null : s.lack,
        picked: this.phase === 'swap' ? !!s.swap : this.phase === 'lack' ? !!s.lack : false,
        swap: k === me ? s.swap : null,
        received: k === me && this.phase !== 'swap' ? s.received : null,
        won: s.won,
      }),
      options: o,
      claim: c && !c.choice ? { hu: !!c.hu, kong: !!c.kong, pong: !!c.pong } : null,
      ledger: this.ledger,
      waitlist: this.waitlist.map(w => w.name),
      waiting: this.waitlist.some(w => w.key === key),
      you: me,
      result: this.result,
    };
  }
}
