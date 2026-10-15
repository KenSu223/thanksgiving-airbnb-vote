// 谁是卧底: everyone gets a word; the 卧底 get a similar but different one (and
// a 白板, if on, gets none). Nobody is told which side they're on — only 白板
// knows. Each round everyone alive describes their word (in person, one by one,
// the app calls the turns), then everyone votes; the most votes is out and their
// identity (平民 / 卧底 / 白板, not the word) is announced. A tie: the tied
// players speak again and the rest vote between them; tied again, nobody's out.
//   平民 win when every 卧底 and 白板 is out.
//   卧底 (with 白板) win when they're as many as the 平民 left, or when only
//   three people are left with one of them still in.
import { PartyRoom, shuffle, around } from './room.js';
import { WORD_PAIRS } from './words.js';

export const UC = { min: 4, max: 14, lookMs: 25000, voteMs: 40000, speakSecs: [30, 60, 90, 120] };
// how many 卧底 by default
export const autoUndercover = n => (n <= 6 ? 1 : n <= 10 ? 2 : 3);
const ROLE = { civ: '平民', spy: '卧底', blank: '白板' };

export class UndercoverGame extends PartyRoom {
  constructor(hooks) {
    super(hooks, { min: UC.min, max: UC.max, settings: { spies: 0, blank: false, speakSec: 60 } });
    this.roles = []; this.words = []; this.alive = [];
    this.pair = null; this.civWord = ''; this.spyWord = '';
    this.out = []; // [{ seat, role, round }]
    this.starter = -1;
  }
  applySettings(p) {
    const s = { ...this.settings };
    if ('spies' in p) { const n = Number(p.spies); if (!Number.isInteger(n) || n < 0 || n > 4) return '卧底人数不对'; s.spies = n; }
    if ('blank' in p) s.blank = !!p.blank;
    if ('speakSec' in p) { const n = Number(p.speakSec); if (!UC.speakSecs.includes(n)) return '发言时间不对'; s.speakSec = n; }
    this.settings = s;
    return null;
  }
  spyCount(n) { return this.settings.spies || autoUndercover(n); }
  settingsError(n) {
    const bad = this.spyCount(n) + (this.settings.blank ? 1 : 0);
    if (bad * 2 >= n) return n + ' 个人最多 ' + Math.ceil(n / 2 - 1) + ' 个卧底（含白板）';
    return null;
  }

  begin(players) {
    const n = players.length, spies = this.spyCount(n), blank = this.settings.blank ? 1 : 0;
    const pair = WORD_PAIRS[Math.floor(this.h.rand() * WORD_PAIRS.length)];
    const flip = this.h.rand() < 0.5;
    this.civWord = flip ? pair[1] : pair[0]; this.spyWord = flip ? pair[0] : pair[1];
    const deck = shuffle([...Array(spies).fill('spy'), ...Array(blank).fill('blank'), ...Array(n - spies - blank).fill('civ')], this.h.rand);
    this.roles = new Array(this.max).fill(null); this.words = new Array(this.max).fill(null); this.alive = new Array(this.max).fill(false);
    players.forEach((k, j) => {
      this.roles[k] = deck[j];
      this.words[k] = deck[j] === 'civ' ? this.civWord : deck[j] === 'spy' ? this.spyWord : null;
      this.alive[k] = true;
    });
    this.out = []; this.starter = -1;
    this.announce('词发好了，' + n + ' 人里有 ' + spies + ' 个卧底' + (blank ? '、1 个白板' : '') + '。请看自己的词，看好了点「看好了」');
    this.startLook('look', UC.lookMs, () => this.startRound());
  }
  living() { return this.players.filter(k => this.alive[k]); }
  canSpeak(i) { return this.alive[i]; }

  startRound() {
    this.round++;
    const live = this.living();
    // round 1 starts with a random player who isn't 白板 (白板 going first has nothing to go on); later rounds move one seat on
    let from;
    if (this.starter < 0) { const ok = live.filter(k => this.roles[k] !== 'blank'); from = ok[Math.floor(this.h.rand() * ok.length)]; }
    else from = live.find(k => k > this.starter) ?? live[0];
    this.starter = from;
    this.startSpeeches('speak', around(live, from), this.settings.speakSec * 1000, () => this.startVoting(),
      { lead: '第 ' + this.round + ' 轮，从 ' + this.num(from) + '开始，每人用一句话描述自己的词' });
  }
  startVoting(pk = null) {
    const live = this.living();
    const voters = pk ? live.filter(k => !pk.includes(k)) : live;
    this.announce(pk ? '平票的 ' + pk.map(k => k + 1).join('、') + ' 号说完了，其他人在他们里面投一个' : '开始投票，投你觉得是卧底的人');
    this.startVote(pk ? 'pkvote' : 'vote', { voters, targets: pk || live, ms: UC.voteMs, label: pk ? 'PK 投票' : '投票',
      then: r => this.counted(r, pk) });
  }
  counted(r, pk) {
    if (r.counts.length) this.note('票型：' + this.tally(r));
    if (!r.top.length) { this.announce('没人投票，这轮没人出局'); return this.afterRound(); }
    if (r.top.length > 1) {
      if (pk) { this.announce('又平票了，这轮没人出局'); return this.afterRound(); }
      this.announce(r.top.map(k => k + 1).join('、') + ' 号平票，请他们再说一轮');
      return this.startSpeeches('pk', r.top, this.settings.speakSec * 1000, () => this.startVoting(r.top), { label: '再说一次' });
    }
    this.eliminate(r.top[0]);
  }
  eliminate(i) {
    this.alive[i] = false;
    this.out.push({ seat: i, role: this.roles[i], round: this.round });
    this.announce(this.num(i) + '出局，他是' + ROLE[this.roles[i]]);
    this.afterRound();
  }
  afterRound() {
    const live = this.living();
    const bad = live.filter(k => this.roles[k] !== 'civ').length, civ = live.length - bad;
    if (!bad) return this.end('civ');
    if (bad >= civ || live.length <= 3) return this.end('spy');
    this.phase = 'between';
    this.setTimer(4000, () => this.startRound());
  }
  end(side) {
    this.announce((side === 'civ' ? '平民赢了！' : '卧底赢了！') + '平民的词是「' + this.civWord + '」，卧底的词是「' + this.spyWord + '」');
    this.finish(k => (side === 'civ' ? this.roles[k] === 'civ' : this.roles[k] !== 'civ'), side === 'civ' ? '平民赢了' : '卧底赢了',
      { side, ...this.reveal() });
  }
  reveal() { return { civWord: this.civWord, spyWord: this.spyWord, roles: this.roles.map(r => r && ROLE[r]) }; }

  viewGame(key, me) {
    const over = this.phase === 'result';
    const mine = this.inGame(me) || (over && this.players.includes(me));
    return {
      alive: this.alive,
      out: this.out.map(o => ({ seat: o.seat, role: ROLE[o.role], round: o.round })),
      // your own word; 白板 is told they're 白板. Nobody else's word until it's over.
      mine: mine && this.roles[me] ? { word: this.words[me], blank: this.roles[me] === 'blank', role: over ? ROLE[this.roles[me]] : null } : null,
      counts: this.players.length ? { spies: this.roles.filter(r => r === 'spy').length, blank: this.roles.filter(r => r === 'blank').length } : null,
      reveal: over && this.result?.roles ? { roles: this.result.roles, words: this.words } : null,
    };
  }
}
