// 狼人杀, with the app as 上帝 (the moderator): it calls every step out loud (the
// devices with 播报 on read `say`), waits for the people who act, and keeps the
// secrets. Roles: 狼人, 村民, 预言家, 女巫, 猎人, 守卫, 白痴; presets by table size
// (PRESETS) or your own mix. Wolves win 屠边 (every 村民 or every 神 gone); good
// wins when every wolf is gone.
//
// Night: 天黑请闭眼 → 守卫 → 狼人 → 女巫 → 预言家 → 天亮了. Every role in the game is
// called every night even when it's dead, and each call lasts a random minimum
// (WW.roleMin) — so how long a step takes says nothing about who's alive. Only
// the acting player sees the night countdown.
//   守卫: one player (or nobody), not the same one two nights running; can guard himself.
//   狼人: all alive wolves pick (they see each other's picks); agreed = done; at the
//     time limit the most-picked (ties broken at random), or 空刀.
//   女巫: sees who was killed only while she still has the 解药; 救 (not herself, unless
//     首夜可自救 is on and it's night 1) or 毒 one player — one potion a night.
//   预言家: one player → 好人 / 狼人, shown only to the seer.
//   Guarded and saved on the same night still dies (同守同救).
// Day 1 starts with the 警长 election when it's on (default from 9 players):
// 上警 → candidates speak (退水 any time) → the rest vote (tie: PK speeches, revote;
// tie again or nobody voting: 警徽流失). 警长's vote counts 1.5; when he dies he hands
// the badge on or tears it. Then last night's deaths are read out (no causes).
// Every death gets a 「确认技能」 moment (so a 猎人 isn't singled out): a 猎人 not
// poisoned may shoot. First-night deaths and everyone voted out leave 遗言.
// Day: speeches (the 警长 picks the direction and speaks last; otherwise from the
// seat after the first death) → vote → the most votes is out (tie: PK, then nobody).
// 白痴 voted out turns his card: stays in, can't vote again. A wolf can 自爆 any time
// in the day: he's out and night falls at once (during the election: 警徽流失, and
// last night's deaths are still read out first).
import { PartyRoom, shuffle, around } from './room.js';

export const WW = { min: 6, max: 14, lookMs: 40000, closeMs: 4000, gapMs: 2500, roleMin: [7000, 11000],
  guardMs: 30000, wolfMs: 50000, witchMs: 35000, seerMs: 30000,
  signupMs: 20000, voteMs: 30000, skillMs: 25000, skillMin: [4000, 7000], badgeMs: 25000, orderMs: 20000, lastMs: 90000, duskMs: 4000,
  speakSecs: [60, 90, 120, 180] };
export const ROLE = { wolf: '狼人', villager: '村民', seer: '预言家', witch: '女巫', hunter: '猎人', guard: '守卫', idiot: '白痴' };
export const GODS = ['seer', 'witch', 'hunter', 'guard', 'idiot'];
export const PRESETS = {
  6: { wolf: 2, villager: 2, seer: 1, witch: 1 },
  7: { wolf: 2, villager: 3, seer: 1, witch: 1 },
  8: { wolf: 2, villager: 3, seer: 1, witch: 1, hunter: 1 },
  9: { wolf: 3, villager: 3, seer: 1, witch: 1, hunter: 1 },
  10: { wolf: 3, villager: 4, seer: 1, witch: 1, hunter: 1 },
  11: { wolf: 3, villager: 4, seer: 1, witch: 1, hunter: 1, guard: 1 },
  12: { wolf: 4, villager: 4, seer: 1, witch: 1, hunter: 1, idiot: 1 },
  13: { wolf: 4, villager: 4, seer: 1, witch: 1, hunter: 1, idiot: 1, guard: 1 },
  14: { wolf: 4, villager: 5, seer: 1, witch: 1, hunter: 1, idiot: 1, guard: 1 },
};
const NIGHT_ORDER = ['guard', 'wolf', 'witch', 'seer'];
const OPEN = { guard: '守卫请睁眼，你要守护谁？', wolf: '狼人请睁眼，请统一意见，今晚要杀谁？', witch: '女巫请睁眼，你有一瓶解药，一瓶毒药，要用吗？', seer: '预言家请睁眼，你要查验谁？' };
const CLOSE = { guard: '守卫请闭眼', wolf: '狼人请闭眼', witch: '女巫请闭眼', seer: '预言家请闭眼' };
const NIGHT_PHASES = new Set(['night', 'guard', 'wolf', 'witch', 'seer']);
const ELECTION = new Set(['signup', 'sheriffSpeak', 'sheriffPk', 'sheriffVote', 'sheriffPkVote']);
const BOOM = new Set([...ELECTION, 'order', 'speak', 'pk', 'vote', 'pkvote']);
const nums = list => list.map(k => k + 1).join('、') + ' 号';
const sum = c => Object.values(c).reduce((a, b) => a + b, 0);

export class WerewolfGame extends PartyRoom {
  constructor(hooks) {
    super(hooks, { min: WW.min, max: WW.max, settings: { roles: null, sheriff: null, speakSec: 90, witchSelf: false } });
    this.reset();
  }
  reset() {
    this.roles = new Array(this.max).fill(null); this.alive = new Array(this.max).fill(false);
    this.night = 0; this.day = 0; this.steps = []; this.stepIdx = 0; this.step = null; this.act = null;
    this.sheriff = -1; this.badgeLost = false; this.potions = { save: true, poison: true }; this.guardLast = -1;
    this.idiotShown = -1; this.checks = []; this.history = []; this.deaths = [];
    this.nightDeaths = []; this.poisoned = -1; this.queue = []; this.afterQueue = null; this.skipDay = false;
    this.candidates = []; this.withdrawn = []; this.signed = new Set(); this.skill = null; this.badgeFrom = -1;
  }

  // ---- settings ----
  counts(n) { return this.settings.roles || PRESETS[n] || {}; }
  sheriffOn() { return this.settings.sheriff ?? this.players.length >= 9; }
  applySettings(p) {
    const s = { ...this.settings };
    if ('roles' in p) {
      if (p.roles === null) s.roles = null;
      else {
        const r = {};
        for (const k of Object.keys(ROLE)) {
          const v = Number(p.roles?.[k] || 0);
          if (!Number.isInteger(v) || v < 0 || v > (k === 'wolf' ? 5 : k === 'villager' ? 8 : 1)) return ROLE[k] + '的人数不对';
          if (v) r[k] = v;
        }
        s.roles = r;
      }
    }
    if ('sheriff' in p) s.sheriff = p.sheriff === null ? null : !!p.sheriff;
    if ('speakSec' in p) { const v = Number(p.speakSec); if (!WW.speakSecs.includes(v)) return '发言时间不对'; s.speakSec = v; }
    if ('witchSelf' in p) s.witchSelf = !!p.witchSelf;
    this.settings = s;
    return null;
  }
  settingsError(n) {
    const c = this.counts(n), total = sum(c);
    if (!PRESETS[n] && !this.settings.roles) return '狼人杀要 6–14 人';
    if (total !== n) return '角色加起来 ' + total + ' 个，现在 ' + n + ' 个人：改一下角色，或者点「按人数推荐」';
    if (!c.wolf) return '至少要 1 个狼人';
    if (n - c.wolf < 2) return '好人太少了';
    return null;
  }

  // ---- deal ----
  begin(players) {
    this.reset();
    const c = this.counts(players.length);
    const deck = shuffle(Object.entries(c).flatMap(([r, k]) => Array(k).fill(r)), this.h.rand);
    players.forEach((k, j) => { this.roles[k] = deck[j]; this.alive[k] = true; });
    const gods = GODS.filter(r => c[r]).map(r => ROLE[r]).join('、');
    this.announce('身份发好了：' + (c.wolf || 0) + ' 个狼人，' + (c.villager || 0) + ' 个村民' + (gods ? '，神职有' + gods : '') + '。请看自己的身份，看好了点「看好了」');
    this.startLook('look', WW.lookMs, () => this.nightStart());
  }
  living() { return this.players.filter(k => this.alive[k]); }
  aliveOf(r) { return this.players.filter(k => this.roles[k] === r && this.alive[k]); }
  inPlay(r) { return this.players.some(k => this.roles[k] === r); }
  isNight() { return NIGHT_PHASES.has(this.phase); }
  kill(k, how) { if (!this.alive[k]) return; this.alive[k] = false; this.deaths.push({ seat: k, day: this.day, night: this.night, how }); }

  // ---- night ----
  nightStart() {
    this.night++; this.phase = 'night'; this.skipDay = false;
    this.act = { guard: -1, picks: new Map(), kill: -1, save: false, poison: -1, check: -1, witchSaw: null };
    this.steps = NIGHT_ORDER.filter(r => this.inPlay(r));
    this.announce(this.night === 1 ? '天黑请闭眼' : '天黑了，请闭眼');
    this.setTimer(WW.closeMs, () => this.nextStep(0));
  }
  nextStep(idx) {
    if (idx >= this.steps.length) return this.dawn();
    const role = this.steps[idx];
    this.stepIdx = idx; this.phase = role;
    const min = WW.roleMin[0] + this.h.rand() * (WW.roleMin[1] - WW.roleMin[0]);
    this.step = { role, minEnd: this.h.now() + min, done: false };
    if (role === 'witch') this.act.witchSaw = this.potions.save ? this.act.kill : null; // no 解药 left: she isn't told
    this.announce(OPEN[role]);
    const acting = this.aliveOf(role).length > 0;
    this.setTimer(acting ? WW[role + 'Ms'] : min, () => this.stepTimeout());
  }
  stepTimeout() { if (this.step.role === 'wolf' && !this.step.done) this.settleWolves(); this.closeStep(); }
  // the role is done: close once the minimum has passed (so a quick choice looks like any other)
  stepDone() {
    this.step.done = true;
    const wait = this.step.minEnd - this.h.now();
    if (wait > 0) this.setTimer(wait, () => this.closeStep()); else this.closeStep();
  }
  closeStep() {
    this.clearTimer();
    this.announce(CLOSE[this.step.role]);
    const idx = this.stepIdx + 1;
    this.phase = 'night';
    this.setTimer(WW.gapMs, () => this.nextStep(idx));
  }
  acting(i, role) { return this.step && !this.step.done && this.phase === role && this.roles[i] === role && this.alive[i]; }

  guard(key, seat) {
    const i = this.seatOf(key), k = Number(seat);
    if (!this.acting(i, 'guard')) return '现在不是你守人的时候';
    if (k !== -1 && (!this.alive[k] || !this.players.includes(k))) return '只能守活着的人';
    if (k !== -1 && k === this.guardLast) return '不能连着两晚守同一个人';
    this.touch(i);
    this.act.guard = k;
    this.stepDone();
    return null;
  }
  wolfPick(key, seat) {
    const i = this.seatOf(key), k = Number(seat);
    if (!this.acting(i, 'wolf')) return '现在不是狼人行动的时候';
    if (k !== -1 && (!this.alive[k] || !this.players.includes(k))) return '只能杀活着的人';
    this.touch(i);
    this.act.picks.set(i, k);
    const wolves = this.aliveOf('wolf');
    const picks = wolves.map(w => this.act.picks.get(w));
    if (picks.every(x => x !== undefined) && picks.every(x => x === picks[0])) { this.act.kill = picks[0]; this.stepDone(); }
    return null;
  }
  settleWolves() {
    const tally = new Map();
    for (const [, k] of this.act.picks) if (k >= 0) tally.set(k, (tally.get(k) || 0) + 1);
    const most = Math.max(0, ...tally.values());
    const top = [...tally].filter(([, c]) => c === most && most > 0).map(([k]) => k);
    this.act.kill = top.length ? top[Math.floor(this.h.rand() * top.length)] : -1;
  }
  witch(key, use, seat) {
    const i = this.seatOf(key), k = Number(seat);
    if (!this.acting(i, 'witch')) return '现在不是女巫行动的时候';
    if (use === 'save') {
      if (!this.potions.save) return '解药用过了';
      if (this.act.kill < 0) return '今晚没有人被杀';
      if (this.act.kill === i && !(this.settings.witchSelf && this.night === 1)) return '女巫不能救自己';
      this.act.save = true; this.potions.save = false;
    } else if (use === 'poison') {
      if (!this.potions.poison) return '毒药用过了';
      if (!this.players.includes(k) || !this.alive[k] || k === i) return '毒一个活着的别人';
      this.act.poison = k; this.potions.poison = false;
    } else if (use !== 'none') return '选救、毒或者不用';
    this.touch(i);
    this.stepDone();
    return null;
  }
  check(key, seat) {
    const i = this.seatOf(key), k = Number(seat);
    if (!this.acting(i, 'seer')) return '现在不是预言家行动的时候';
    if (!this.players.includes(k) || !this.alive[k] || k === i) return '查一个活着的别人';
    this.touch(i);
    this.act.check = k;
    this.checks.push({ night: this.night, seat: k, wolf: this.roles[k] === 'wolf' });
    this.stepDone();
    return null;
  }

  // ---- dawn ----
  dawn() {
    const a = this.act, dead = new Set();
    // guarded or saved lives; both (同守同救) or neither dies
    if (a.kill >= 0 && (a.guard === a.kill) === a.save) dead.add(a.kill);
    if (a.poison >= 0) dead.add(a.poison);
    this.history.push({ night: this.night, guard: a.guard, kill: a.kill, save: a.save, poison: a.poison, check: a.check });
    this.guardLast = a.guard;
    this.nightDeaths = [...dead].sort((x, y) => x - y);
    this.poisoned = a.poison;
    this.step = null; this.day++; this.phase = 'dawn';
    this.announce('天亮了');
    this.setTimer(WW.gapMs, () => (this.day === 1 && this.sheriffOn() && !this.badgeLost ? this.sheriffStart() : this.revealNight()));
  }
  revealNight() {
    this.phase = 'dawn';
    const d = this.nightDeaths;
    this.announce(d.length ? '昨晚 ' + nums(d) + '死亡' : '昨晚是平安夜');
    for (const k of d) this.kill(k, 'night');
    if (this.checkEnd()) return;
    this.queue = [];
    for (const k of d) this.queueDeath(k, { canShoot: k !== this.poisoned, lastWords: this.night === 1 });
    this.runQueue(() => (this.skipDay ? this.dusk() : this.discussion()));
  }
  queueDeath(k, { canShoot, lastWords }) {
    this.queue.push({ type: 'skill', seat: k, canShoot });
    if (this.sheriff === k) this.queue.push({ type: 'badge', seat: k });
    if (lastWords) this.queue.push({ type: 'last', seat: k });
  }
  runQueue(then) { this.afterQueue = then; this.nextInQueue(); }
  nextInQueue() {
    if (this.phase === 'result') return;
    const q = this.queue.shift();
    if (!q) { const f = this.afterQueue; this.afterQueue = null; return f && f(); }
    if (q.type === 'skill') return this.skillStart(q.seat, q.canShoot);
    if (q.type === 'badge') return this.badgeStart(q.seat);
    this.startSpeeches('last', [q.seat], WW.lastMs, () => this.nextInQueue(), { label: '发表遗言' });
  }
  canSpeak(i) {
    if (this.phase === 'last') return true;
    if (this.phase === 'sheriffSpeak' || this.phase === 'sheriffPk') return this.candidates.includes(i);
    return this.alive[i];
  }

  // every death gets this moment: the 猎人 (not poisoned) may shoot; anyone else it just passes
  skillStart(seat, canShoot) {
    this.phase = 'skill';
    const hunter = this.roles[seat] === 'hunter' && canShoot;
    this.skill = { seat, hunter };
    this.announce('请 ' + this.num(seat) + '确认是否发动技能');
    const min = WW.skillMin[0] + this.h.rand() * (WW.skillMin[1] - WW.skillMin[0]);
    this.setTimer(hunter ? WW.skillMs : min, () => this.skillEnd());
  }
  shoot(key, seat) {
    const i = this.seatOf(key), k = Number(seat);
    if (this.phase !== 'skill' || !this.skill?.hunter || this.skill.seat !== i) return '现在不能开枪';
    if (k === -1) { this.touch(i); this.skillEnd(); return null; }
    if (!this.players.includes(k) || !this.alive[k]) return '只能带走活着的人';
    this.touch(i);
    this.clearTimer();
    this.announce(this.num(i) + '是猎人，开枪带走了 ' + this.num(k));
    this.kill(k, 'shot');
    this.skill = null;
    if (this.checkEnd()) return null;
    if (this.sheriff === k) this.queue.unshift({ type: 'badge', seat: k });
    this.nextInQueue();
    return null;
  }
  skillEnd() { this.clearTimer(); this.skill = null; this.nextInQueue(); }

  badgeStart(seat) {
    if (this.sheriff !== seat) return this.nextInQueue();
    this.phase = 'badge'; this.badgeFrom = seat;
    this.announce('请警长 ' + this.num(seat) + '移交警徽，或者撕掉');
    this.setTimer(WW.badgeMs, () => this.passBadge(-1));
  }
  badge(key, seat) {
    const i = this.seatOf(key), k = Number(seat);
    if (this.phase !== 'badge' || this.badgeFrom !== i) return '现在不是你交警徽的时候';
    if (k !== -1 && (!this.players.includes(k) || !this.alive[k])) return '只能交给活着的人';
    this.touch(i);
    this.passBadge(k);
    return null;
  }
  passBadge(k) {
    this.clearTimer();
    if (k >= 0) { this.sheriff = k; this.announce('警徽交给了 ' + this.num(k)); }
    else { this.sheriff = -1; this.badgeLost = true; this.announce('警长撕掉了警徽'); }
    this.badgeFrom = -1;
    this.nextInQueue();
  }

  // ---- the 警长 election (day 1) ----
  sheriffStart() {
    this.phase = 'signup'; this.candidates = []; this.withdrawn = []; this.signed = new Set();
    this.announce('现在开始竞选警长，想上警的请在 20 秒内点「上警」');
    this.setTimer(WW.signupMs, () => this.signupEnd());
  }
  signup(key, yes) {
    const i = this.seatOf(key);
    if (this.phase !== 'signup' || !this.players.includes(i)) return '现在不是上警的时候';
    this.touch(i);
    this.candidates = yes ? [...new Set([...this.candidates, i])].sort((a, b) => a - b) : this.candidates.filter(k => k !== i);
    this.signed.add(i);
    if (this.players.every(k => this.signed.has(k) || !this.seats[k]?.connected)) this.signupEnd();
    return null;
  }
  signupEnd() {
    this.clearTimer();
    const c = this.candidates;
    if (!c.length) return this.noSheriff('没有人上警');
    if (c.length === this.players.length) return this.noSheriff('所有人都上警了，没有人能投票');
    const from = c[Math.floor(this.h.rand() * c.length)];
    this.startSpeeches('sheriffSpeak', around(c, from), this.settings.speakSec * 1000, () => this.sheriffVote(),
      { lead: '上警的有 ' + nums(c) + '，从 ' + this.num(from) + '开始竞选发言，想退出的可以点「退水」' });
  }
  withdraw(key) {
    const i = this.seatOf(key);
    if ((this.phase !== 'sheriffSpeak' && this.phase !== 'sheriffPk') || !this.candidates.includes(i)) return '你不在竞选';
    this.touch(i);
    this.candidates = this.candidates.filter(k => k !== i);
    this.withdrawn.push(i);
    this.announce(this.num(i) + '退水');
    if (this.speaker() === i) this.nextSpeaker();
    return null;
  }
  sheriffVote(pk = null) {
    const c = pk ? pk.filter(k => this.candidates.includes(k)) : this.candidates;
    if (!c.length) return this.noSheriff('上警的人都退水了');
    if (c.length === 1) return this.elect(c[0]);
    const voters = this.players.filter(k => !this.candidates.includes(k) && !this.withdrawn.includes(k));
    if (!voters.length) return this.noSheriff('没有人能投票');
    this.announce((pk ? '在 ' + nums(c) + '里再投一次' : '竞选发言结束，警下的人请投票') + '，投给你想要的警长');
    this.startVote(pk ? 'sheriffPkVote' : 'sheriffVote', { voters, targets: c, ms: WW.voteMs, label: '警长投票', then: r => this.sheriffVoted(r, pk) });
  }
  sheriffVoted(r, pk) {
    if (r.counts.length) this.note('警长票型：' + this.tally(r));
    if (!r.top.length) return this.noSheriff('没有人投票');
    if (r.top.length > 1) {
      if (pk) return this.noSheriff('再次平票');
      this.announce(nums(r.top) + '平票，请他们再发言一次');
      return this.startSpeeches('sheriffPk', r.top, this.settings.speakSec * 1000, () => this.sheriffVote(r.top));
    }
    this.elect(r.top[0]);
  }
  elect(k) {
    this.sheriff = k;
    this.announce(this.num(k) + '当选警长，他的一票算一票半');
    this.phase = 'dawn';
    this.setTimer(WW.gapMs, () => this.revealNight());
  }
  noSheriff(why) {
    this.badgeLost = true;
    this.announce(why + '，警徽流失');
    this.phase = 'dawn';
    this.setTimer(WW.gapMs, () => this.revealNight());
  }

  // ---- the day ----
  discussion() {
    const live = this.living();
    if (this.sheriff >= 0 && this.alive[this.sheriff]) {
      this.phase = 'order';
      this.announce('请警长 ' + this.num(this.sheriff) + '选择发言顺序');
      return this.setTimer(WW.orderMs, () => this.speakFrom('cw'));
    }
    const first = this.nightDeaths[0];
    const from = first != null ? (live.find(k => k > first) ?? live[0]) : live[Math.floor(this.h.rand() * live.length)];
    this.speeches(around(live, from));
  }
  order(key, dir) {
    const i = this.seatOf(key);
    if (this.phase !== 'order' || i !== this.sheriff) return '只有警长能选发言顺序';
    if (dir !== 'cw' && dir !== 'ccw') return '选顺时针或者逆时针';
    this.touch(i);
    this.speakFrom(dir);
    return null;
  }
  // from the 警长's left or right, round the table; the 警长 speaks last
  speakFrom(dir) {
    this.clearTimer();
    const live = this.living().filter(k => k !== this.sheriff);
    let order = around(live, live.find(k => k > this.sheriff) ?? live[0]);
    if (dir === 'ccw') order = [...order].reverse();
    this.speeches([...order, this.sheriff]);
  }
  speeches(order) {
    this.startSpeeches('speak', order, this.settings.speakSec * 1000, () => this.dayVote(),
      { lead: '第 ' + this.day + ' 天，从 ' + this.num(order[0]) + '开始发言' });
  }
  weight(k) { return k === this.sheriff ? 1.5 : 1; }
  voters(exclude = []) { return this.living().filter(k => k !== this.idiotShown && !exclude.includes(k)); }
  dayVote() {
    this.announce('发言结束，开始投票，请在 30 秒内投出你要放逐的人');
    this.startVote('vote', { voters: this.voters(), targets: this.living(), ms: WW.voteMs, label: '放逐投票', weight: k => this.weight(k), then: r => this.dayVoted(r, null) });
  }
  dayVoted(r, pk) {
    if (r.counts.length) this.note('票型：' + this.tally(r));
    if (!r.top.length) { this.announce('没有人投票，今天没有人出局'); return this.dusk(); }
    if (r.top.length > 1) {
      if (pk) { this.announce('再次平票，今天没有人出局'); return this.dusk(); }
      this.announce(nums(r.top) + '平票，请他们再发言一次');
      return this.startSpeeches('pk', r.top, this.settings.speakSec * 1000, () => this.pkVote(r.top));
    }
    this.exile(r.top[0]);
  }
  pkVote(tied) {
    const voters = this.voters(tied);
    if (!voters.length) { this.announce('没有人能投票，今天没有人出局'); return this.dusk(); }
    this.announce('在 ' + nums(tied) + '里再投一次');
    this.startVote('pkvote', { voters, targets: tied, ms: WW.voteMs, label: 'PK 投票', weight: k => this.weight(k), then: r => this.dayVoted(r, tied) });
  }
  exile(k) {
    if (this.roles[k] === 'idiot' && this.idiotShown < 0) {
      this.idiotShown = k;
      this.announce(this.num(k) + '翻牌，是白痴，免于出局，以后不能投票');
      if (this.sheriff === k) { this.sheriff = -1; this.badgeLost = true; this.announce('白痴翻牌，警徽流失'); }
      return this.dusk();
    }
    this.announce(this.num(k) + '被投票出局');
    this.kill(k, 'vote');
    if (this.checkEnd()) return;
    this.queue = [{ type: 'skill', seat: k, canShoot: true }, ...(this.sheriff === k ? [{ type: 'badge', seat: k }] : []), { type: 'last', seat: k }];
    this.runQueue(() => this.dusk());
  }
  dusk() { this.phase = 'dusk'; this.speech = null; this.voting = null; this.setTimer(WW.duskMs, () => this.nightStart()); }

  // 自爆: a wolf ends the day on the spot
  boom(key) {
    const i = this.seatOf(key);
    if (!BOOM.has(this.phase) || this.roles[i] !== 'wolf' || !this.alive[i]) return '现在不能自爆';
    this.touch(i);
    const election = ELECTION.has(this.phase);
    this.clearTimer(); this.speech = null; this.voting = null;
    this.announce(this.num(i) + '自爆，是狼人');
    this.kill(i, 'boom');
    if (this.sheriff === i) { this.sheriff = -1; this.badgeLost = true; this.announce('自爆的警长不能移交警徽，警徽流失'); }
    if (election) {
      this.badgeLost = true; this.candidates = [];
      this.announce('警长竞选中断，警徽流失');
      this.skipDay = true;
      this.phase = 'dawn';
      this.setTimer(WW.gapMs, () => this.revealNight());
      return null;
    }
    if (!this.checkEnd()) this.dusk();
    return null;
  }

  // ---- who's won (屠边) ----
  checkEnd() {
    if (this.phase === 'result') return true;
    const live = this.living();
    const wolves = live.filter(k => this.roles[k] === 'wolf').length;
    const gods = live.filter(k => GODS.includes(this.roles[k])).length;
    const villagers = live.filter(k => this.roles[k] === 'villager').length;
    const hadGods = this.players.some(k => GODS.includes(this.roles[k])), hadVillagers = this.players.some(k => this.roles[k] === 'villager');
    if (!wolves) { this.end(true, '狼人全部出局，好人赢！'); return true; }
    if (hadVillagers && !villagers) { this.end(false, '村民全部出局，狼人赢！'); return true; }
    if (hadGods && !gods) { this.end(false, '神职全部出局，狼人赢！'); return true; }
    return false;
  }
  end(goodWins, title) {
    this.announce(title);
    this.finish(k => (this.roles[k] === 'wolf') !== goodWins, title, { good: goodWins, ...this.reveal() });
  }
  reveal() { return { roles: this.roles.map(r => r && ROLE[r]), wolves: this.roles.map(r => r === 'wolf'), history: this.history }; }

  // ---- what one viewer sees ----
  viewGame(key, me) {
    const r = this.roles[me], inIt = this.players.includes(me) && this.phase !== 'waiting';
    const night = this.isNight();
    const acting = this.acting(me, this.phase);
    const mine = inIt && r ? {
      role: ROLE[r], key: r, wolf: r === 'wolf', alive: this.alive[me], acting,
      wolves: r === 'wolf' ? this.players.filter(k => this.roles[k] === 'wolf') : null,
      picks: r === 'wolf' && this.phase === 'wolf' && this.act ? [...this.act.picks] : null,
      potions: r === 'witch' ? this.potions : null,
      // the witch, while it's her turn: who died tonight (-1 nobody), or null when she has no 解药 left to know it
      witchSaw: r === 'witch' && this.phase === 'witch' && this.alive[me] ? this.act.witchSaw : undefined,
      witchSelf: r === 'witch' ? !!this.settings.witchSelf && this.night === 1 : false,
      guardLast: r === 'guard' ? this.guardLast : null,
      checks: r === 'seer' ? this.checks : null,
      canShoot: this.phase === 'skill' && this.skill?.seat === me && this.skill.hunter,
      canBoom: r === 'wolf' && this.alive[me] && BOOM.has(this.phase),
    } : null;
    return {
      // the night's clock only for the one acting: how long a step runs gives nothing away
      deadline: night && !acting ? 0 : this.deadline,
      isNight: night, day: this.day, nightNo: this.night,
      alive: this.alive, sheriff: this.sheriff, badgeLost: this.badgeLost, idiotShown: this.idiotShown,
      deaths: this.deaths.map(d => ({ seat: d.seat, day: d.day, how: d.how === 'night' ? 'night' : d.how })),
      candidates: ELECTION.has(this.phase) ? this.candidates : [], withdrawn: ELECTION.has(this.phase) ? this.withdrawn : [],
      signed: this.phase === 'signup' ? [...this.signed] : [],
      skillSeat: this.phase === 'skill' ? this.skill?.seat ?? -1 : -1, badgeFrom: this.phase === 'badge' ? this.badgeFrom : -1,
      // the mix this table plays (in a game) or would play (before one: custom, or the preset for the people seated)
      counts: this.counts(this.playing() ? this.players.length : Math.max(WW.min, Math.min(WW.max, this.seats.filter(Boolean).length))),
      sheriffOn: this.playing() ? this.sheriffOn() : (this.settings.sheriff ?? this.seats.filter(Boolean).length >= 9),
      mine,
      reveal: this.phase === 'result' && this.result?.roles ? { roles: this.result.roles, wolves: this.result.wolves, history: this.result.history } : null,
    };
  }
}
