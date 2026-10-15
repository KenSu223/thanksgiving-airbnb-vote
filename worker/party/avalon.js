// 阿瓦隆: good (梅林, 派西维尔, 忠臣) against evil (刺客, 莫甘娜, 莫德雷德, 奥伯伦,
// 爪牙). Five quests: the leader picks a team, everyone votes on it in the open
// (more than half 赞成 sends it; five rejections in a row and evil wins), then the
// team secretly plays 成功 / 失败 (good can only play 成功); one 失败 fails a quest
// (two on the 4th quest with 7+ players). Three failed quests: evil wins. Three
// successes: the 刺客 gets one guess at 梅林 — right, and evil wins anyway.
// What each role knows is worked out at the deal and shown only to them:
//   梅林 sees evil except 莫德雷德; 派西维尔 sees 梅林 and 莫甘娜 (not which is which);
//   evil sees evil except 奥伯伦 (who sees nobody).
// 湖中仙女 (7+ players, on by default): after quests 2, 3 and 4 its holder secretly
// checks one player's side and hands it to them; nobody is checked twice.
// Official Avalon is 5–10 players; 11–14 is our own extension (more evil, bigger teams).
import { PartyRoom, shuffle } from './room.js';

export const AV = { min: 5, max: 14, lookMs: 45000, teamMs: 5 * 60000, voteMs: 60000, questMs: 45000, ladyMs: 2 * 60000, assassinMs: 3 * 60000 };
export const SIDES = { 5: [3, 2], 6: [4, 2], 7: [4, 3], 8: [5, 3], 9: [6, 3], 10: [6, 4], 11: [7, 4], 12: [7, 5], 13: [8, 5], 14: [9, 5] };
export const QUESTS = { 5: [2, 3, 2, 3, 3], 6: [2, 3, 4, 3, 4], 7: [2, 3, 3, 4, 4], 8: [3, 4, 4, 5, 5], 9: [3, 4, 4, 5, 5], 10: [3, 4, 4, 5, 5],
  11: [3, 4, 5, 5, 6], 12: [4, 4, 5, 6, 6], 13: [4, 5, 5, 6, 7], 14: [4, 5, 6, 6, 7] };
export const needFails = (n, q) => (q === 3 && n >= 7 ? 2 : 1);
export const ROLE = { merlin: '梅林', percival: '派西维尔', loyal: '亚瑟的忠臣', assassin: '刺客', morgana: '莫甘娜', mordred: '莫德雷德', oberon: '奥伯伦', minion: '莫德雷德的爪牙' };
const EVIL = new Set(['assassin', 'morgana', 'mordred', 'oberon', 'minion']);
export const isEvil = r => EVIL.has(r);
const CN_NUM = ['一', '二', '三', '四', '五'];
const nums = list => list.map(k => k + 1).join('、') + ' 号';

export class AvalonGame extends PartyRoom {
  constructor(hooks) {
    super(hooks, { min: AV.min, max: AV.max, settings: { percival: true, morgana: true, mordred: false, oberon: false, lady: true } });
    this.reset();
  }
  reset() {
    this.roles = new Array(this.max).fill(null); this.knows = new Array(this.max).fill(null);
    this.quests = []; this.q = 0; this.leaderPos = 0; this.team = []; this.rejects = 0;
    this.lady = -1; this.ladyUsed = []; this.ladySeen = new Map(); this.lastVote = null; this.assassinGuess = -1;
  }
  applySettings(p) {
    const s = { ...this.settings };
    for (const k of ['percival', 'morgana', 'mordred', 'oberon', 'lady']) if (k in p) s[k] = !!p[k];
    this.settings = s;
    return null;
  }
  evilRoles() { const s = this.settings; return ['assassin', ...(s.morgana ? ['morgana'] : []), ...(s.mordred ? ['mordred'] : []), ...(s.oberon ? ['oberon'] : [])]; }
  settingsError(n) {
    const bad = SIDES[n]?.[1];
    if (!bad) return '阿瓦隆要 5–14 人';
    if (this.evilRoles().length > bad) return n + ' 个人只有 ' + bad + ' 个坏人，莫甘娜 / 莫德雷德 / 奥伯伦选多了';
    return null;
  }
  ladyOn() { return this.settings.lady && this.players.length >= 7; }

  begin(players) {
    this.reset();
    const n = players.length, [good, bad] = SIDES[n];
    const evil = this.evilRoles();
    const deck = [
      'merlin', ...(this.settings.percival ? ['percival'] : []), ...Array(good).fill('loyal'),
    ].slice(0, good).concat([...evil, ...Array(bad).fill('minion')].slice(0, bad));
    shuffle(deck, this.h.rand);
    players.forEach((k, j) => { this.roles[k] = deck[j]; });
    // what each one knows
    const of = r => players.filter(k => this.roles[k] === r);
    const evilSeen = players.filter(k => isEvil(this.roles[k]) && this.roles[k] !== 'oberon');
    for (const k of players) {
      const r = this.roles[k];
      if (r === 'merlin') this.knows[k] = { see: players.filter(x => isEvil(this.roles[x]) && this.roles[x] !== 'mordred'), as: '坏人', note: this.settings.mordred ? '莫德雷德是坏人，但你看不到他' : '' };
      else if (r === 'percival') this.knows[k] = { see: shuffle([...of('merlin'), ...of('morgana')], this.h.rand), as: of('morgana').length ? '梅林和莫甘娜' : '梅林', note: of('morgana').length ? '其中一个是梅林，另一个是假扮梅林的莫甘娜' : '' };
      else if (isEvil(r) && r !== 'oberon') this.knows[k] = { see: evilSeen.filter(x => x !== k), as: '你的坏人同伴', note: this.settings.oberon ? '奥伯伦也是坏人，但你们互相不认识' : '' };
      else if (r === 'oberon') this.knows[k] = { see: [], as: '', note: '你是坏人，但不认识其他坏人，他们也不认识你' };
      else this.knows[k] = { see: [], as: '', note: '' };
    }
    this.leaderPos = Math.floor(this.h.rand() * n);
    if (this.ladyOn()) { this.lady = players[(this.leaderPos - 1 + n) % n]; this.ladyUsed = [this.lady]; }
    this.announce('身份发好了：' + good + ' 个好人，' + bad + ' 个坏人。请看自己的身份，和你知道的人，看好了点「看好了」');
    this.startLook('look', AV.lookMs, () => this.startTeam());
  }
  leader() { return this.players[this.leaderPos]; }
  size() { return QUESTS[this.players.length][this.q]; }
  nextLeader() { this.leaderPos = (this.leaderPos + 1) % this.players.length; }

  // ---- the leader picks a team ----
  startTeam() {
    this.phase = 'team'; this.team = [];
    const n = this.players.length, two = needFails(n, this.q) === 2;
    this.announce('第' + CN_NUM[this.q] + '个任务，要 ' + this.size() + ' 个人' + (two ? '，这次两张失败才算失败' : '') + '。队长 ' + this.num(this.leader()) + '，请选人' + (this.rejects ? '（已经连续否决 ' + this.rejects + ' 次）' : ''));
    this.setTimer(AV.teamMs, () => {
      // time's up: the leader's picks so far, filled up at random
      const rest = shuffle(this.players.filter(k => !this.team.includes(k)), this.h.rand);
      this.team = [...this.team, ...rest].slice(0, this.size());
      this.note('队长没选完，系统帮他补齐了');
      this.startTeamVote();
    });
  }
  pick(key, seat) {
    const i = this.seatOf(key);
    if (this.phase !== 'team' || i !== this.leader()) return '只有队长能选人';
    const k = Number(seat);
    if (!this.players.includes(k)) return '没有这个人';
    this.touch(i);
    if (this.team.includes(k)) this.team = this.team.filter(x => x !== k);
    else if (this.team.length >= this.size()) return '这次只要 ' + this.size() + ' 个人';
    else this.team = [...this.team, k].sort((a, b) => a - b);
    return null;
  }
  propose(key) {
    const i = this.seatOf(key);
    if (this.phase !== 'team' || i !== this.leader()) return '只有队长能提交';
    if (this.team.length !== this.size()) return '要选 ' + this.size() + ' 个人';
    this.touch(i);
    this.startTeamVote();
    return null;
  }
  // everyone votes in the open: 1 = 赞成, 0 = 反对; time's up counts as 赞成
  startTeamVote() {
    this.announce('队长选了 ' + nums(this.team) + '。所有人投票：赞成还是反对这个队伍');
    this.startVote('teamvote', { voters: this.players, targets: [0, 1], ms: AV.voteMs, noSelf: false, label: '组队投票', then: r => this.teamCounted(r) });
  }
  teamCounted(r) {
    const yes = r.ballots.filter(([, t]) => t !== 0).map(([k]) => k), no = r.ballots.filter(([, t]) => t === 0).map(([k]) => k);
    const late = r.ballots.filter(([, t]) => t === -1).map(([k]) => k);
    this.lastVote = { team: this.team, yes, no, late, ok: yes.length * 2 > this.players.length };
    this.note('组队投票：赞成 ' + (yes.length ? nums(yes) : '无') + (late.length ? '（' + nums(late) + '没投，算赞成）' : '') + '；反对 ' + (no.length ? nums(no) : '无'));
    if (this.lastVote.ok) {
      this.rejects = 0;
      this.announce('赞成 ' + yes.length + ' 票，反对 ' + no.length + ' 票，组队通过');
      return this.startQuest();
    }
    this.rejects++;
    this.announce('赞成 ' + yes.length + ' 票，反对 ' + no.length + ' 票，没通过（连续第 ' + this.rejects + ' 次）');
    if (this.rejects >= 5) return this.end(false, '连续五次组队被否决，坏人赢');
    this.nextLeader();
    this.startTeam();
  }

  // ---- the team plays 成功 / 失败 in secret ----
  startQuest() {
    this.announce('请 ' + nums(this.team) + '执行任务：好人只能出成功，坏人可以出失败');
    // 1 = 成功, 0 = 失败; time's up counts as 成功
    this.startVote('quest', { voters: this.team, targets: [0, 1], ms: AV.questMs, noSelf: false, label: '执行任务', then: r => this.questDone(r) });
  }
  // team vote: 1 赞成 / 0 反对; quest: 1 成功 / 0 失败 — and good can only play 成功
  vote(key, target) {
    const i = this.seatOf(key);
    if (this.phase === 'quest' && Number(target) === 0 && i >= 0 && !isEvil(this.roles[i])) return '好人只能出成功';
    if ((this.phase === 'quest' || this.phase === 'teamvote') && target !== 0 && target !== 1) return '选一个';
    return super.vote(key, target);
  }
  questDone(r) {
    const n = this.players.length, fails = r.ballots.filter(([, t]) => t === 0).length;
    const ok = fails < needFails(n, this.q);
    this.quests.push({ team: this.team, fails, ok, size: this.team.length });
    this.announce('第' + CN_NUM[this.q] + '个任务' + (ok ? '成功' : '失败') + '：' + fails + ' 张失败');
    this.q++;
    const wins = this.quests.filter(x => x.ok).length, losses = this.quests.length - wins;
    if (losses >= 3) return this.end(false, '三个任务失败，坏人赢');
    if (wins >= 3) return this.startAssassin();
    this.nextLeader();
    if (this.ladyOn() && this.q >= 2 && this.q <= 4) return this.startLady();
    this.startTeam();
  }

  // ---- 湖中仙女 ----
  startLady() {
    this.phase = 'lady';
    this.announce('湖中仙女在 ' + this.num(this.lady) + '手上，请选一个人，查看他是好人还是坏人');
    this.setTimer(AV.ladyMs, () => { this.note('湖中仙女这次没用'); this.startTeam(); });
  }
  useLady(key, seat) {
    const i = this.seatOf(key), k = Number(seat);
    if (this.phase !== 'lady' || i !== this.lady) return '湖中仙女不在你手上';
    if (!this.players.includes(k) || k === i) return '选一个别人';
    if (this.ladyUsed.includes(k)) return this.num(k) + '拿过湖中仙女，不能查';
    this.touch(i);
    const seen = this.ladySeen.get(i) || [];
    seen.push({ seat: k, evil: isEvil(this.roles[k]) });
    this.ladySeen.set(i, seen);
    this.announce(this.num(i) + '查验了 ' + this.num(k) + '，湖中仙女交给 ' + this.num(k));
    this.lady = k; this.ladyUsed.push(k);
    this.clearTimer();
    this.startTeam();
    return null;
  }

  // ---- three successes: the 刺客 guesses 梅林 ----
  startAssassin() {
    this.phase = 'assassin';
    this.announce('好人完成了三个任务！刺客请现身，和坏人同伴商量，指认谁是梅林');
    this.setTimer(AV.assassinMs, () => {
      const assassin = this.players.find(k => this.roles[k] === 'assassin');
      const guess = shuffle(this.players.filter(k => !(this.knows[assassin]?.see || []).includes(k) && k !== assassin), this.h.rand)[0];
      this.note('刺客没选，系统随便指了一个');
      this.assassinate(this.seats[assassin]?.key, guess, true);
    });
  }
  assassinate(key, seat, forced = false) {
    const i = this.seatOf(key), k = Number(seat);
    if (this.phase !== 'assassin' || (!forced && this.roles[i] !== 'assassin')) return '只有刺客能指认';
    if (!this.players.includes(k) || k === i) return '选一个别人';
    this.clearTimer();
    this.assassinGuess = k;
    const hit = this.roles[k] === 'merlin';
    this.announce('刺客指认 ' + this.num(k) + '是梅林——' + (hit ? '猜对了！' : '猜错了！'));
    this.end(!hit, hit ? '刺客刺中梅林，坏人赢' : '梅林活下来了，好人赢');
    return null;
  }

  end(goodWins, title) {
    this.announce(title);
    this.finish(k => isEvil(this.roles[k]) !== goodWins, title, { good: goodWins, ...this.reveal() });
  }
  reveal() { return { roles: this.roles.map(r => r && ROLE[r]), evil: this.roles.map(r => !!r && isEvil(r)) }; }

  viewGame(key, me) {
    const inIt = this.players.includes(me) && this.phase !== 'waiting';
    const n = this.players.length;
    return {
      sizes: n ? QUESTS[n] : null, twoFails: n >= 7 ? 3 : -1,
      quests: this.quests, q: this.q, leader: this.playing() ? this.leader() : -1, team: this.team, rejects: this.rejects,
      lastVote: this.lastVote, lady: this.lady, ladyUsed: this.ladyUsed, ladyOn: this.playing() ? this.ladyOn() : !!this.settings.lady,
      assassinGuess: this.assassinGuess,
      // the assassination is done in the open: the evil side shows itself and talks it over
      evilShown: this.phase === 'assassin' ? this.players.filter(k => isEvil(this.roles[k])) : null,
      assassin: this.phase === 'assassin' ? this.players.find(k => this.roles[k] === 'assassin') : -1,
      mine: inIt && this.roles[me] ? {
        role: ROLE[this.roles[me]], evil: isEvil(this.roles[me]), key: this.roles[me], knows: this.knows[me],
        ladySeen: this.ladySeen.get(me) || [],
      } : null,
      reveal: this.phase === 'result' && this.result?.roles ? { roles: this.result.roles, evil: this.result.evil } : null,
    };
  }
}
