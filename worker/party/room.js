// One table of a party game (谁是卧底 / 阿瓦隆 / 狼人杀): numbered seats (you pick
// one), settings anyone seated can change before a game, and the pieces every one
// of these games is made of — speaking turns (people talk in person; the app says
// whose turn it is), simultaneous votes, "看好了" pauses, timers, and
// announcements (say: read aloud by the devices that have 播报 on; log: the
// public record). The game itself (roles, phases, who wins) is the subclass.
//
// Leaving your seat or losing the connection never removes you mid-game: your
// seat waits (timeouts act for you), and coming back puts you on it again.
// Nobody can sit down mid-game (watching is fine); seats left empty stay empty.
//
// hooks: { now, rand, schedule(fn, ms), cancel(t), save(seat) } (see games/hall.js)
// Subclass: begin(players) starts a game; viewGame(key, me) adds its part of the
// view; applySettings(patch) / settingsError(n) check settings; onLeave(i) etc. optional.
export const ROOM = { idleMs: 30 * 60 * 1000, goneMs: 5 * 60 * 1000, keepSay: 40, keepLog: 120 };

export class PartyRoom {
  constructor(hooks, { min, max, settings }) {
    this.h = hooks; this.min = min; this.max = max;
    this.seats = new Array(max).fill(null);
    this.waitlist = []; // the hall reads it; party games don't queue (you watch until the next game)
    this.phase = 'waiting';
    this.settings = { ...settings };
    this.round = 0; this.game = 0;
    this.host = null; // who started this game (may skip a speaker, end the game)
    this.players = []; // seat indices in this game, in seat order
    this.say = []; this.log = []; this.seq = 0;
    this.timer = null; this.deadline = 0;
    this.speech = null; this.voting = null; this.looking = null;
    this.result = null;
  }

  // ---- seats ----
  humans() { return this.seats.filter(Boolean); }
  seatOf(key) { return key ? this.seats.findIndex(s => s && s.key === key) : -1; }
  has(key) { return this.seatOf(key) >= 0; }
  playing() { return this.phase !== 'waiting' && this.phase !== 'result'; }
  inGame(i) { return this.playing() && this.players.includes(i); }
  touch(i) { if (this.seats[i]) this.seats[i].activeAt = this.h.now(); }
  sit(key, name, saved, m = {}) {
    const i = this.seatOf(key);
    if (i >= 0) {
      const s = this.seats[i];
      s.connected = true; s.leaving = false; s.name = name; this.touch(i);
      const to = Number(m.seat);
      if (m.seat != null && Number.isInteger(to) && to !== i) return this.moveSeat(key, to);
      return null;
    }
    if (this.playing()) return '这局已经开始了，先看着，下一局再坐';
    let at = Number(m.seat);
    if (!Number.isInteger(at) || at < 0 || at >= this.max || this.seats[at]) at = this.seats.findIndex(s => !s);
    if (at < 0) return '坐满了（最多 ' + this.max + ' 人）';
    this.seats[at] = { key, name, connected: true, leaving: false, activeAt: this.h.now(),
      points: saved?.points || 0, games: saved?.games || 0, wins: saved?.wins || 0 };
    return null;
  }
  moveSeat(key, to) {
    const i = this.seatOf(key);
    if (i < 0) return '先坐下';
    if (this.playing()) return '这局玩完再换座位';
    if (!Number.isInteger(to) || to < 0 || to >= this.max) return '没有这个座位';
    if (this.seats[to]) return (to + 1) + ' 号有人了';
    this.seats[to] = this.seats[i]; this.seats[i] = null;
    return null;
  }
  // Stand up. Mid-game your seat stays (you've just gone quiet); it's freed when the game ends.
  leave(key) {
    const i = this.seatOf(key);
    if (i < 0) return;
    if (this.inGame(i)) { this.seats[i].leaving = true; this.seats[i].connected = false; return; }
    this.keep(this.seats[i]);
    this.seats[i] = null;
    if (!this.humans().length) this.clear();
  }
  keep(s) { if (s && !s.noSave) this.h.save(s); } // save a seat's wins as it goes (never a deleted account's)
  disconnect(key) { const i = this.seatOf(key); if (i >= 0) this.seats[i].connected = false; }
  // The person's account was deleted: off the table now (mid-game the seat stays
  // as a ghost so the game can finish), and never saved again.
  forget(key) {
    const i = this.seatOf(key);
    if (i < 0) return;
    if (this.inGame(i)) { Object.assign(this.seats[i], { leaving: true, connected: false, noSave: true, key: '#gone' + i }); return; }
    this.seats[i] = null;
    if (!this.humans().length) this.clear();
  }
  // Before a game: free the seat of someone who's gone (not connected).
  kick(key, n) {
    if (this.seatOf(key) < 0) return '先坐下';
    if (this.playing()) return '这局玩完再说';
    const s = this.seats[n];
    if (!s) return null;
    if (s.connected) return s.name + ' 还在线，不能请走';
    this.keep(s); this.seats[n] = null;
    this.note(this.nameOf(this.seatOf(key)) + ' 请走了掉线的 ' + s.name);
    return null;
  }
  // Between games, stand up whoever's been gone a while (or idle a long while).
  sweepIdle() {
    if (this.playing()) return [];
    const now = this.h.now();
    const idle = this.humans().filter(s => (!s.connected && now - s.activeAt > ROOM.goneMs) || now - s.activeAt > ROOM.idleMs).map(s => s.key);
    idle.forEach(k => this.leave(k));
    return idle;
  }
  clear() {
    this.clearTimer();
    this.phase = 'waiting'; this.players = []; this.speech = this.voting = this.looking = null; this.result = null; this.host = null;
  }
  nameOf(i) { return i >= 0 && this.seats[i] ? (i + 1) + ' 号 ' + this.seats[i].name : '?'; }
  num(i) { return (i + 1) + ' 号'; }

  // ---- settings & starting ----
  setSettings(key, patch) {
    const i = this.seatOf(key);
    if (i < 0) return '先坐下';
    if (this.playing()) return '这局玩完再改';
    if (!patch || typeof patch !== 'object') return '设置不对';
    const err = this.applySettings(patch);
    if (err) return err;
    this.touch(i);
    return null;
  }
  applySettings() { return null; }
  settingsError() { return null; }
  start(key) {
    const i = this.seatOf(key);
    if (i < 0) return '先坐下';
    if (this.playing()) return '已经开始了';
    // people who stood up or have been gone since the last game don't get dealt in
    this.seats.forEach((s, k) => { if (s && s.leaving) { this.keep(s); this.seats[k] = null; } });
    const players = this.seats.map((s, k) => (s ? k : -1)).filter(k => k >= 0);
    if (players.length < this.min) return '至少要 ' + this.min + ' 个人（现在 ' + players.length + ' 个）';
    const away = players.filter(k => !this.seats[k].connected);
    if (away.length) return away.map(k => this.num(k)).join('、') + ' 掉线了：等他回来，或者先请走';
    const err = this.settingsError(players.length);
    if (err) return err;
    this.touch(i);
    this.host = key; this.players = players; this.game++; this.round = 0; this.result = null;
    this.speech = this.voting = this.looking = null;
    this.say = []; this.log = [];
    this.note('第 ' + this.game + ' 局开始，' + players.length + ' 人 · ' + this.seats[i].name + ' 开的');
    this.begin(players);
    return null;
  }
  // End the game early (anyone in it): show everything, no wins counted.
  stop(key) {
    const i = this.seatOf(key);
    if (!this.inGame(i)) return '你不在这局里';
    this.announce(this.nameOf(i) + ' 结束了这局');
    this.finish(null, '提前结束', this.reveal());
    return null;
  }
  reveal() { return {}; } // what a stopped game shows (everyone's role)
  // The game's over: winners is a function seat index -> true/false (null: nobody, it was stopped).
  finish(winners, title, extra = {}) {
    this.clearTimer();
    this.speech = this.voting = this.looking = null;
    for (const k of this.players) {
      const s = this.seats[k];
      if (!s || !winners || s.noSave) continue;
      s.games++;
      if (winners(k)) s.wins++;
      this.h.save(s);
    }
    this.result = { title, winners: winners ? this.players.filter(winners) : [], ...extra };
    this.phase = 'result';
  }

  // ---- timers ----
  setTimer(ms, fn) {
    this.clearTimer();
    this.deadline = this.h.now() + ms;
    this.timer = this.h.schedule(() => { this.timer = null; this.deadline = 0; fn(); }, ms);
  }
  clearTimer() { if (this.timer) this.h.cancel(this.timer); this.timer = null; this.deadline = 0; }

  // ---- what everyone hears / reads ----
  // announce: read aloud on 播报 devices and written in the log; note: log only.
  announce(text) {
    const id = ++this.seq;
    this.say.push({ id, text, at: this.h.now() }); if (this.say.length > ROOM.keepSay) this.say.shift();
    this.log.push({ id, text, at: this.h.now() }); if (this.log.length > ROOM.keepLog) this.log.shift();
  }
  note(text) {
    const id = ++this.seq;
    this.log.push({ id, text, at: this.h.now() }); if (this.log.length > ROOM.keepLog) this.log.shift();
  }

  // ---- "看好了": everyone looks at their card; go on when all are ready or time's up ----
  startLook(phase, ms, then) {
    this.phase = phase;
    this.looking = { ready: new Set(), then };
    this.setTimer(ms, () => this.endLook());
  }
  ready(key) {
    const i = this.seatOf(key);
    if (!this.looking || !this.inGame(i)) return null;
    this.touch(i);
    this.looking.ready.add(i);
    if (this.players.every(k => this.looking.ready.has(k) || !this.seats[k]?.connected)) this.endLook();
    return null;
  }
  endLook() { const l = this.looking; if (!l) return; this.looking = null; this.clearTimer(); l.then(); }

  // ---- speaking turns: order is seat indices; the speaker (or the host) says 说完了 ----
  startSpeeches(phase, order, ms, then, { label = '发言', lead = '' } = {}) {
    this.phase = phase;
    this.speech = { order, pos: -1, ms, then, label };
    if (lead) this.announce(lead);
    this.nextSpeaker();
  }
  nextSpeaker() {
    const sp = this.speech;
    if (!sp) return;
    sp.pos++;
    while (sp.pos < sp.order.length && !this.canSpeak(sp.order[sp.pos])) sp.pos++;
    if (sp.pos >= sp.order.length) { this.speech = null; this.clearTimer(); return sp.then(); }
    const i = sp.order[sp.pos];
    this.announce('请 ' + this.num(i) + (sp.label === '发言' ? '发言' : sp.label));
    this.setTimer(sp.ms, () => this.nextSpeaker());
  }
  canSpeak() { return true; }
  speaker() { return this.speech ? this.speech.order[this.speech.pos] : -1; }
  // 说完了: the speaker, or the host (someone's phone died), or anyone if the speaker's gone
  done(key) {
    const i = this.seatOf(key), sp = this.speaker();
    if (sp < 0) return '现在没人在发言';
    const gone = !this.seats[sp]?.connected;
    if (i !== sp && key !== this.host && !gone) return '等 ' + this.num(sp) + ' 说完';
    this.touch(i);
    this.nextSpeaker();
    return null;
  }

  // ---- votes: everyone in voters picks one of targets (or abstains); all in or time's up ----
  // weight(i) gives a voter's weight (警长 1.5). then({ counts, ballots, top }) gets the tally.
  startVote(phase, { voters, targets, ms, then, weight = () => 1, noSelf = true, label = '投票' }) {
    this.phase = phase;
    this.voting = { voters, targets, then, weight, noSelf, label, ballots: new Map() };
    this.setTimer(ms, () => this.endVote());
  }
  vote(key, target) {
    const v = this.voting, i = this.seatOf(key);
    if (!v || !v.voters.includes(i)) return '这轮你不用投';
    const t = target === -1 || target == null ? -1 : Number(target);
    if (t !== -1 && !v.targets.includes(t)) return '不能投 ' + this.num(t);
    if (t !== -1 && v.noSelf && t === i) return '不能投自己';
    this.touch(i);
    v.ballots.set(i, t);
    if (v.voters.every(k => v.ballots.has(k))) this.endVote();
    return null;
  }
  endVote() {
    const v = this.voting;
    if (!v) return;
    this.voting = null; this.clearTimer();
    const counts = new Map(), ballots = [];
    for (const k of v.voters) {
      const t = v.ballots.has(k) ? v.ballots.get(k) : -1;
      ballots.push([k, t]);
      if (t >= 0) counts.set(t, (counts.get(t) || 0) + v.weight(k));
    }
    const most = Math.max(0, ...counts.values());
    const top = most > 0 ? [...counts].filter(([, c]) => c === most).map(([t]) => t).sort((a, b) => a - b) : [];
    v.then({ counts: [...counts].sort((a, b) => b[1] - a[1]), ballots, top });
  }
  // "3 号 ← 1、5 号（2 票）" lines for the log
  tally({ counts, ballots }) {
    const lines = counts.map(([t, c]) => this.num(t) + ' ← ' + ballots.filter(([, x]) => x === t).map(([k]) => k + 1).join('、') + ' 号（' + c + ' 票）');
    const none = ballots.filter(([, x]) => x === -1).map(([k]) => k + 1);
    if (none.length) lines.push('弃票：' + none.join('、') + ' 号');
    return lines.join('；');
  }

  // ---- what one viewer sees ----
  view(key) {
    const me = this.seatOf(key);
    const v = this.voting, sp = this.speaker();
    return {
      phase: this.phase, game: this.game, round: this.round, deadline: this.deadline, now: this.h.now(),
      min: this.min, max: this.max, settings: this.settings, host: this.host,
      you: me, inGame: this.inGame(me), players: this.players,
      seats: this.seats.map((s, k) => s && { name: s.name, key: s.key, connected: s.connected, leaving: !!s.leaving, wins: s.wins, games: s.games, me: k === me }),
      speaker: sp, speechLabel: this.speech?.label || null,
      vote: v && { label: v.label, voters: v.voters, targets: v.targets, voted: v.voters.filter(k => v.ballots.has(k)), mine: v.ballots.has(me) ? v.ballots.get(me) : null, noSelf: v.noSelf },
      looking: this.looking ? { ready: [...this.looking.ready] } : null,
      say: this.say.slice(-12), log: this.log.slice(-60),
      result: this.result,
      ...this.viewGame(key, me),
    };
  }
  viewGame() { return {}; }
}

// Shuffle in place with the hooks' rand.
export function shuffle(a, rand) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
// Seats in order around the table starting at `from` (clockwise = higher numbers).
export function around(players, from) {
  const k = players.indexOf(from);
  return k < 0 ? players.slice() : players.slice(k).concat(players.slice(0, k));
}
