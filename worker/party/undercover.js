// 谁是卧底, run by a person (the 主持人), not by the app. The host takes the host
// chair (not one of the 14 player seats, and not a player), thinks of the two
// words and types them in — 平民的词 and 卧底的词 — sets how many 卧底 and 白板
// (any number), and either lets the app deal them at random or taps who gets
// which. Everyone then sees only their own word (白板 sees that they're 白板).
// The game itself happens out loud: describing, discussing, voting by hand.
// The app just keeps track — the host taps whoever is voted out, the app shows
// what they were (平民 / 卧底 / 白板, not their word), and the host can undo a
// wrong tap. Nothing is timed, nothing is read aloud, nothing moves on its own.
// When one side has clearly won the app says so, but the host ends the game:
// 平民赢 / 卧底赢 (counted on the board) or 结束不算.
//   平民 win when every 卧底 and 白板 is out; 卧底 (with 白板) win when they're
//   as many as the 平民 left, or three are left with one of them still in.
import { PartyRoom, shuffle, ROOM } from './room.js';

export const UC = { min: 4, max: 14, maxBad: 6, wordLen: 20 };
const ROLE = { civ: '平民', spy: '卧底', blank: '白板' };
const word = w => String(w || '').replace(/\s+/g, ' ').trim().slice(0, UC.wordLen);
const count = (v, d) => { const n = Number(v); return Number.isInteger(n) && n >= 0 && n <= UC.maxBad ? n : d; };

export class UndercoverGame extends PartyRoom {
  constructor(hooks) {
    super(hooks, { min: UC.min, max: UC.max, settings: {} });
    this.mc = null; // the 主持人 in the host chair: { key, name, connected, activeAt }
    // the host's plan for the next game (only the host ever sees it)
    this.setup = { civWord: '', spyWord: '', spies: 1, blanks: 0, mode: 'random', picks: {} };
    this.roles = []; this.words = []; this.alive = []; this.out = [];
    this.civWord = ''; this.spyWord = '';
  }

  // ---- the host chair ----
  isMc(key) { return !!key && this.mc?.key === key; }
  has(key) { return super.has(key) || this.isMc(key); }
  sit(key, name, saved, m = {}) {
    if (this.isMc(key)) { Object.assign(this.mc, { connected: true, name, activeAt: this.h.now() }); return null; }
    if (m.host) return this.takeChair(key, name);
    return super.sit(key, name, saved, m);
  }
  // Sit in the host chair: when it's free, or when the host's phone dropped (take over).
  takeChair(key, name) {
    if (this.mc && this.mc.connected) return this.mc.name + ' 已经是主持人了';
    const i = this.seatOf(key);
    if (i >= 0) {
      if (this.inGame(i)) return '你在这局里，不能当主持人';
      this.keep(this.seats[i]); this.seats[i] = null;
    }
    if (this.mc && this.playing()) this.note(name + ' 接替 ' + this.mc.name + ' 当主持人');
    this.mc = { key, name, connected: true, activeAt: this.h.now() };
    return null;
  }
  leave(key) {
    if (!this.isMc(key)) return super.leave(key);
    if (this.playing()) { this.mc.connected = false; return; } // mid-game the chair waits; someone can take over
    this.mc = null;
  }
  disconnect(key) { if (this.isMc(key)) this.mc.connected = false; else super.disconnect(key); }
  forget(key) { if (this.isMc(key)) this.mc = null; else super.forget(key); }
  // the host can free a dropped player's seat between games, like anyone seated
  kick(key, n) {
    if (!this.isMc(key)) return super.kick(key, n);
    if (this.playing()) return '这局玩完再说';
    const s = this.seats[n];
    if (!s) return null;
    if (s.connected) return s.name + ' 还在线，不能请走';
    this.keep(s); this.seats[n] = null;
    this.note('主持人请走了掉线的 ' + s.name);
    return null;
  }
  sweepIdle() {
    const idle = super.sweepIdle();
    const m = this.mc, now = this.h.now();
    if (m && !this.playing() && ((!m.connected && now - m.activeAt > ROOM.goneMs) || now - m.activeAt > ROOM.idleMs)) { idle.push(m.key); this.mc = null; }
    return idle;
  }
  touchMc() { if (this.mc) this.mc.activeAt = this.h.now(); }

  // ---- the host's setup: words, how many 卧底 / 白板, random or picked ----
  start() { return '由主持人发词'; }
  setSettings(key, p) { return this.setUp(key, p); }
  setUp(key, p) {
    if (!this.isMc(key)) return '只有主持人能设置';
    if (this.playing()) return '这局玩完再改';
    if (!p || typeof p !== 'object') return '设置不对';
    const s = { ...this.setup, picks: { ...this.setup.picks } };
    if ('civWord' in p) s.civWord = word(p.civWord);
    if ('spyWord' in p) s.spyWord = word(p.spyWord);
    if ('spies' in p) s.spies = count(p.spies, s.spies);
    if ('blanks' in p) s.blanks = count(p.blanks, s.blanks);
    if ('mode' in p) s.mode = p.mode === 'pick' ? 'pick' : 'random';
    if (p.pick && typeof p.pick === 'object') {
      const k = Number(p.pick.seat), r = p.pick.role;
      if (!this.seats[k]) return '那个座位没人';
      if (r === 'spy' || r === 'blank') s.picks[k] = r; else delete s.picks[k];
    }
    this.setup = s;
    this.touchMc();
    return null;
  }

  // ---- deal ----
  deal(key) {
    if (!this.isMc(key)) return '只有主持人能发词';
    if (this.playing()) return '已经开始了';
    this.seats.forEach((s, k) => { if (s && s.leaving) { this.keep(s); this.seats[k] = null; } });
    const players = this.seats.map((s, k) => (s ? k : -1)).filter(k => k >= 0);
    const n = players.length;
    if (n < UC.min) return '至少要 ' + UC.min + ' 个玩家（主持人不算），现在 ' + n + ' 个';
    const away = players.filter(k => !this.seats[k].connected);
    if (away.length) return away.map(k => this.num(k)).join('、') + ' 掉线了：等他回来，或者先请走';
    const s = this.setup;
    let spySeats, blankSeats;
    if (s.mode === 'pick') {
      const picked = Object.entries(s.picks).map(([k, r]) => [Number(k), r]).filter(([k]) => players.includes(k));
      spySeats = picked.filter(([, r]) => r === 'spy').map(([k]) => k);
      blankSeats = picked.filter(([, r]) => r === 'blank').map(([k]) => k);
    } else {
      if (s.spies + s.blanks > n) return n + ' 个玩家不够分';
      const order = shuffle(players.slice(), this.h.rand);
      spySeats = order.slice(0, s.spies); blankSeats = order.slice(s.spies, s.spies + s.blanks);
    }
    const bad = spySeats.length + blankSeats.length;
    if (!s.civWord) return '先写平民的词';
    if (spySeats.length && !s.spyWord) return '有卧底的话，先写卧底的词';
    if (spySeats.length && s.spyWord === s.civWord) return '两个词不能一样';
    if (!bad) return s.mode === 'pick' ? '点几个座位，指定谁是卧底 / 白板' : '至少要有 1 个卧底或白板';
    if (bad * 2 >= n) return n + ' 个玩家里卧底加白板最多 ' + (Math.ceil(n / 2) - 1) + ' 个';
    this.roles = new Array(this.max).fill(null); this.words = new Array(this.max).fill(null); this.alive = new Array(this.max).fill(false);
    for (const k of players) {
      const r = spySeats.includes(k) ? 'spy' : blankSeats.includes(k) ? 'blank' : 'civ';
      this.roles[k] = r; this.words[k] = r === 'civ' ? s.civWord : r === 'spy' ? s.spyWord : null; this.alive[k] = true;
    }
    this.civWord = s.civWord; this.spyWord = s.spyWord;
    this.players = players; this.game++; this.round = 0; this.result = null; this.out = [];
    this.speech = this.voting = this.looking = null; this.say = []; this.log = [];
    this.host = key; this.phase = 'playing';
    this.touchMc();
    this.note('第 ' + this.game + ' 局：' + n + ' 个玩家，' + spySeats.length + ' 个卧底' + (blankSeats.length ? '、' + blankSeats.length + ' 个白板' : '') + ' · 主持人 ' + this.mc.name + (s.mode === 'pick' ? '（指定的）' : '（随机的）'));
    // the next game starts from a clean plan; the host keeps the counts and mode
    this.setup = { ...s, civWord: '', spyWord: '', picks: {} };
    return null;
  }
  living() { return this.players.filter(k => this.alive[k]); }

  // ---- the host taps who's out (and can take a wrong tap back) ----
  eliminate(key, seat) {
    if (!this.isMc(key)) return '只有主持人能点出局';
    if (this.phase !== 'playing') return '现在不在局里';
    const k = Number(seat);
    if (!this.players.includes(k) || !this.alive[k]) return '这个人已经出局了';
    this.alive[k] = false;
    this.out.push({ seat: k, role: this.roles[k] });
    this.note(this.nameOf(k) + ' 出局，是' + ROLE[this.roles[k]]);
    this.touchMc();
    return null;
  }
  undo(key) {
    if (!this.isMc(key)) return '只有主持人能撤销';
    if (this.phase !== 'playing') return '现在不在局里';
    const last = this.out.pop();
    if (!last) return '还没有人出局';
    this.alive[last.seat] = true;
    this.note('撤销：' + this.nameOf(last.seat) + ' 回到场上');
    this.touchMc();
    return null;
  }
  // which side has won by the rules, if one has
  winner() {
    if (this.phase !== 'playing') return null;
    const live = this.living();
    const bad = live.filter(k => this.roles[k] !== 'civ').length, civ = live.length - bad;
    if (!bad) return 'civ';
    if (bad >= civ || live.length <= 3) return 'spy';
    return null;
  }
  // The host ends it: 'civ' / 'spy' counts on the board; anything else just ends it.
  end(key, side) {
    if (!this.isMc(key)) return '只有主持人能结束';
    if (this.phase !== 'playing') return '现在不在局里';
    const title = side === 'civ' ? '平民赢了' : side === 'spy' ? '卧底赢了' : '这局结束（不算输赢）';
    this.note(title + '。平民的词是「' + this.civWord + '」' + (this.spyWord ? '，卧底的词是「' + this.spyWord + '」' : ''));
    const winners = side === 'civ' ? k => this.roles[k] === 'civ' : side === 'spy' ? k => this.roles[k] !== 'civ' : null;
    this.finish(winners, title, { side: side === 'civ' || side === 'spy' ? side : null, ...this.reveal() });
    this.touchMc();
    return null;
  }
  stop(key) { return this.end(key, null); }
  reveal() { return { civWord: this.civWord, spyWord: this.spyWord, roles: this.roles.map(r => r && ROLE[r]), words: this.words }; }

  viewGame(key, me) {
    const isMc = this.isMc(key), playing = this.phase === 'playing', over = this.phase === 'result';
    const seated = this.players.includes(me) && (playing || over);
    return {
      deadline: 0, // nothing is timed
      mc: this.mc && { name: this.mc.name, connected: this.mc.connected, me: isMc },
      isMc,
      setup: isMc ? this.setup : null,
      alive: this.alive,
      out: this.out.map(o => ({ seat: o.seat, role: ROLE[o.role] })),
      counts: playing || over ? { spies: this.roles.filter(r => r === 'spy').length, blanks: this.roles.filter(r => r === 'blank').length } : null,
      // your own word (白板 is told they're 白板); nobody else's until it's over
      mine: seated && this.roles[me] ? { word: this.words[me], blank: this.roles[me] === 'blank', role: over ? ROLE[this.roles[me]] : null } : null,
      // the host sees every role and word while it's on
      all: isMc && playing ? this.players.map(k => ({ seat: k, role: ROLE[this.roles[k]], word: this.words[k] })) : null,
      words: isMc && playing ? { civ: this.civWord, spy: this.spyWord } : null,
      winner: isMc ? this.winner() : null,
      reveal: over && this.result?.roles ? { roles: this.result.roles, words: this.result.words, civWord: this.result.civWord, spyWord: this.result.spyWord } : null,
    };
  }
}
