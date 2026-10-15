// Party games over real sockets (worker/party): 谁是卧底 end to end — picking seats,
// settings, dealing words (each person sees only their own; a watcher sees none),
// a phone dropping mid-game and coming back to the same seat and word, speaking
// turns, voting the 卧底 out, the win counted on the board.
// Standalone use: TEST_BASE=http://localhost:8791 node tests/robustness/party.mjs
import { ck, done, client, table, all, talkThrough, login } from './partykit.mjs';

const tag = Date.now().toString(36).slice(-5);
const names = ['甲', '乙', '丙', '丁', '戊'].map(n => n + tag);

// ---- 谁是卧底 ----
const UC = '/api/undercover';
const cs = await table(UC, names);
ck('five people sat in the seats they picked', cs.every((c, i) => c.t().seats[i]?.name === names[i]));
const watcher = await client(UC);
const w = await login('看客' + tag);
watcher.send({ type: 'identify', name: w.name, token: w.token });
cs[0].send({ type: 'seat', seat: 9 });
await cs[0].until(t => t.you === 9, 'moved to 10');
cs[0].send({ type: 'seat', seat: 0 });
await cs[0].until(t => t.you === 0, 'moved back');
ck('moving seats before the game works', true);
cs[1].send({ type: 'settings', settings: { spies: 1, blank: false, speakSec: 30 } });
await cs[0].until(t => t.settings.spies === 1 && t.settings.speakSec === 30, 'settings');
ck('anyone seated can change settings; everyone sees it', true);

cs[2].send({ type: 'start' });
await all(cs, t => t.phase === 'look' && t.mine, 'words dealt');
const words = cs.map(c => c.t().mine.word);
const civ = words.find(x => words.filter(y => y === x).length >= 3);
const spy = words.findIndex(x => x !== civ);
ck('everyone has a word; exactly one differs (the 卧底)', words.every(Boolean) && words.filter(x => x !== civ).length === 1, JSON.stringify(words));
ck('nobody is told their side mid-game', cs.every(c => c.t().mine.role === null));
const spyWord = words[spy];
ck("a player's view never carries anyone else's word", cs.every((c, i) => !JSON.stringify(c.t()).includes(words[i] === civ ? spyWord : civ)));
await watcher.until(t => t.phase === 'look', 'watcher sees the game');
ck("a watcher's view has no words at all", !JSON.stringify(watcher.t()).includes(civ) && !JSON.stringify(watcher.t()).includes(spyWord) && watcher.t().mine === null);
const late = await login('迟到' + tag), lc = await client(UC);
lc.send({ type: 'sit', room: 1, name: late.name, token: late.token, seat: 7 });
await lc.until((t, st) => /已经开始/.test(st.error || ''), 'refused mid-game');
ck('nobody can sit down mid-game', true);

// a phone drops mid-game and comes back
await cs[3].close();
await cs[0].until(t => t.seats[3] && !t.seats[3].connected, 'seat 4 shows offline');
ck('a dropped phone keeps its seat (shown offline)', true);
const back = await client(UC);
back.send({ type: 'identify', name: cs[3].user.name, token: cs[3].user.token });
await back.until(t => t.you === 3 && t.mine, 'back on seat 4');
ck('coming back (just identifying) puts you on your seat with your word', back.t().mine.word === words[3] && back.t().inGame);
back.user = cs[3].user; cs[3] = back;
await cs[0].until(t => t.seats[3].connected, 'seat 4 online again');

for (const c of cs) c.send({ type: 'ready' });
await all(cs, t => t.phase === 'speak', 'speaking');
ck('everyone ready: speaking starts', true);
const first = cs[0].t().speaker;
ck('the first speaker is announced', cs[0].t().say.some(s => s.text.includes((first + 1) + ' 号')));
const notMe = [0, 1, 2, 3, 4].find(k => k !== first && k !== 2); // not the speaker, not the host (2 started)
cs[notMe].send({ type: 'done' });
await cs[notMe].until((t, st) => /等/.test(st.error || ''), 'refused');
ck("someone else can't end your turn", cs[0].t().speaker === first);
await talkThrough(cs);
await all(cs, t => t.phase === 'vote', 'vote');
ck('after everyone spoke: vote', true);
for (const [k, c] of cs.entries()) c.send({ type: 'vote', target: k === spy ? (spy + 1) % 5 : spy });
await all(cs, t => t.phase === 'result', 'result');
const r = cs[0].t().result;
ck('voting the 卧底 out: 平民 win', r.side === 'civ' && r.civWord === civ && r.spyWord === spyWord, JSON.stringify(r).slice(0, 200));
ck('the 卧底 is not a winner; the four others are', !r.winners.includes(spy) && r.winners.length === 4);
ck('everyone sees every role once it is over', cs[1].t().reveal.roles.filter(Boolean).length === 5);
ck('the log has the vote breakdown', cs[0].t().log.some(l => l.text.startsWith('票型')));
const board = cs[0].st.board;
ck('the board counts the win and the game', names.every((n, i) => board.some(b => b.name === n && b.games >= 1 && b.wins === (i === spy ? 0 : 1))), JSON.stringify(board).slice(0, 300));
await Promise.all([...cs, watcher, lc].map(c => c.close()));

// ---- 阿瓦隆 ----
const AV = '/api/avalon';
const an = ['亚', '瑟', '兰', '斯', '洛'].map(n => n + tag);
const av = await table(AV, an);
av[0].send({ type: 'start' });
await all(av, t => t.phase === 'look' && t.mine, 'roles dealt');
const role = av.map(c => c.t().mine);
const evilIdx = role.map((m, i) => (m.evil ? i : -1)).filter(i => i >= 0);
const merlinIdx = role.findIndex(m => m.key === 'merlin'), assassinIdx = role.findIndex(m => m.key === 'assassin');
ck('5 players: 3 good, 2 evil, a 梅林 and a 刺客', evilIdx.length === 2 && merlinIdx >= 0 && assassinIdx >= 0, JSON.stringify(role.map(m => m.key)));
ck('梅林 sees exactly the evil players', JSON.stringify([...role[merlinIdx].knows.see].sort()) === JSON.stringify(evilIdx));
ck('the evil players see each other', evilIdx.every(e => JSON.stringify(role[e].knows.see) === JSON.stringify(evilIdx.filter(x => x !== e))));
ck("nobody's view carries another player's role", av.every((c, i) => c.t().seats.every(s => !s || !JSON.stringify(s).includes('梅林')) && c.t().reveal === null));
for (const c of av) c.send({ type: 'ready' });
await all(av, t => t.phase === 'team', 'team phase');
const leaderOf = () => av[0].t().leader;
// one rejected team first
{
  const L = leaderOf(), size = av[0].t().sizes[0];
  for (const k of [0, 1, 2, 3, 4].slice(0, size)) av[L].send({ type: 'pick', seat: k });
  await av[0].until(t => t.team.length === size, 'team picked');
  av[(L + 1) % 5].send({ type: 'pick', seat: 4 });
  await av[(L + 1) % 5].until((t, st) => /队长/.test(st.error || ''), 'non-leader refused');
  av[L].send({ type: 'propose' });
  await all(av, t => t.phase === 'teamvote', 'team vote');
  for (const c of av) c.send({ type: 'vote', target: 0 });
  await all(av, t => t.phase === 'team' && t.rejects === 1, 'rejected');
  ck('a rejected team: the lead passes on and the rejection is counted', leaderOf() === (L + 1) % 5 && av[0].t().lastVote.no.length === 5);
}
const good = [0, 1, 2, 3, 4].filter(i => !role[i].evil);
for (let q = 0; q < 3; q++) {
  const L = leaderOf(), size = av[0].t().sizes[q];
  for (const k of good.slice(0, size)) av[L].send({ type: 'pick', seat: k });
  await av[0].until(t => t.team.length === size, 'team ' + q);
  av[L].send({ type: 'propose' });
  await all(av, t => t.phase === 'teamvote', 'vote ' + q);
  for (const c of av) c.send({ type: 'vote', target: 1 });
  await all(av, t => t.phase === 'quest', 'quest ' + q);
  const team = av[0].t().team;
  if (q === 0) {
    av[team[0]].send({ type: 'vote', target: 0 });
    await av[team[0]].until((t, st) => /只能出成功/.test(st.error || ''), 'good fail refused');
    ck('a good player cannot play 失败', true);
  }
  for (const k of team) av[k].send({ type: 'vote', target: 1 });
  await av[0].until(t => t.quests.length === q + 1, 'quest done ' + q);
}
await all(av, t => t.phase === 'assassin', 'assassin');
ck('three quests done: the evil side is shown for the assassination', JSON.stringify([...av[0].t().evilShown].sort()) === JSON.stringify(evilIdx) && av[0].t().assassin === assassinIdx);
const wrong = good.find(i => i !== merlinIdx);
av[assassinIdx].send({ type: 'assassinate', seat: wrong });
await all(av, t => t.phase === 'result', 'avalon result');
const ar = av[0].t().result;
ck('the 刺客 misses 梅林: good win', ar.good === true && ar.winners.length === 3 && !ar.winners.includes(assassinIdx), JSON.stringify(ar).slice(0, 200));
ck('every role shown at the end', av[2].t().reveal.roles.filter(Boolean).length === 5);
ck('the avalon board counts it', an.every((n, i) => av[0].st.board.some(b => b.name === n && b.wins === (role[i].evil ? 0 : 1))));
await Promise.all(av.map(c => c.close()));

// ---- 狼人杀 (the runner sets PARTY_SPEED so the 上帝's deliberate pauses fly by) ----
const WWP = '/api/werewolf';
const wn = ['子', '丑', '寅', '卯', '辰', '巳'].map(n => n + tag);
const ww = await table(WWP, wn);
ww[0].send({ type: 'settings', settings: { sheriff: false } });
await ww[0].until(t => t.settings.sheriff === false, 'no sheriff');
ww[0].send({ type: 'start' });
await all(ww, t => t.phase === 'look' && t.mine, 'roles');
const wr = ww.map(c => c.t().mine.key);
const seatsOf = r => wr.map((x, i) => (x === r ? i : -1)).filter(i => i >= 0);
const wolves = seatsOf('wolf'), vills = seatsOf('villager'), seer = seatsOf('seer')[0], witch = seatsOf('witch')[0];
ck('6 players: 2 狼人, 2 村民, 预言家, 女巫', wolves.length === 2 && vills.length === 2 && seer >= 0 && witch >= 0, JSON.stringify(wr));
ck('the wolves know each other; a 村民 knows nobody', JSON.stringify(ww[wolves[0]].t().mine.wolves) === JSON.stringify(wolves) && ww[vills[0]].t().mine.wolves === null);
ck("no view carries anyone else's role", ww.every((c, i) => !JSON.stringify(c.t().seats).includes('狼人') && c.t().reveal === null));
for (const c of ww) c.send({ type: 'ready' });
await all(ww, t => t.phase === 'wolf', 'wolves wake', 15000);
ck('night: the 上帝 says 天黑请闭眼, then calls the wolves', ww[0].t().say.some(s => s.text === '天黑请闭眼') && ww[0].t().say.at(-1).text.startsWith('狼人请睁眼'));
ck('only the acting wolves see the night clock', ww[wolves[0]].t().deadline > 0 && ww[vills[0]].t().deadline === 0 && ww[seer].t().deadline === 0);
ww[vills[1]].send({ type: 'kill', seat: vills[0] });
await ww[vills[1]].until((t, st) => /狼人/.test(st.error || ''), 'non-wolf refused');
ck('a 村民 cannot pick the kill', true);
ww[wolves[0]].send({ type: 'kill', seat: vills[0] });
await ww[wolves[1]].until(t => (t.mine.picks || []).some(([w, x]) => w === wolves[0] && x === vills[0]), 'teammate sees the pick');
ck("a wolf sees his teammate's pick", true);
ww[wolves[1]].send({ type: 'kill', seat: vills[0] });
await ww[witch].until(t => t.phase === 'witch' && t.mine.acting, 'witch', 15000);
ck('the 女巫 is told who was killed', ww[witch].t().mine.witchSaw === vills[0]);
ww[witch].send({ type: 'witch', use: 'none' });
await ww[seer].until(t => t.phase === 'seer' && t.mine.acting, 'seer', 15000);
ww[seer].send({ type: 'check', seat: wolves[0] });
await ww[seer].until(t => (t.mine.checks || []).length === 1, 'check result');
ck('the 预言家 sees 狼人 on a wolf; nobody else sees the check', ww[seer].t().mine.checks[0].wolf === true && ww[vills[1]].t().mine.checks === null);
await ww[0].until(t => t.say.some(s => s.text === '昨晚 ' + (vills[0] + 1) + ' 号死亡'), 'dawn', 15000);
ck('dawn: last night\'s death is read out, without the cause', !ww[0].t().say.some(s => /被狼|被刀/.test(s.text)));
// the dead player's skill moment, then his last words (night 1)
await ww[0].until(t => t.phase === 'last', 'last words', 15000);
ww[vills[0]].send({ type: 'done' });
await ww[0].until(t => t.phase === 'speak', 'speeches', 10000);
for (let g = 0; g < 10 && ww[0].t().phase === 'speak'; g++) {
  const sp = ww[0].t().speaker;
  ww[sp].send({ type: 'done' });
  await ww[0].until(t => t.speaker !== sp || t.phase !== 'speak', 'next speaker');
}
await all(ww, t => t.phase === 'vote', 'vote');
ck('the dead don\'t vote', !ww[0].t().vote.voters.includes(vills[0]));
for (const k of ww[0].t().vote.voters) ww[k].send({ type: 'vote', target: k === wolves[0] ? seer : wolves[0] });
await ww[0].until(t => t.say.some(s => s.text === (wolves[0] + 1) + ' 号被投票出局'), 'exiled');
ck('the vote is read out and the breakdown logged', ww[0].t().log.some(l => l.text.startsWith('票型')));
await ww[0].until(t => t.phase === 'last', 'exile last words', 15000);
ww[wolves[0]].send({ type: 'done' });
await ww[wolves[1]].until(t => t.phase === 'wolf' && t.mine.acting, 'night 2', 20000);
ww[wolves[1]].send({ type: 'kill', seat: vills[1] });
await ww[0].until(t => t.phase === 'result', 'result', 30000);
const wres = ww[0].t().result;
ck('night 2 kills the last 村民: wolves win (屠边)', wres.good === false && /村民全部出局/.test(wres.title), JSON.stringify(wres).slice(0, 160));
ck('the winners are the two wolves', JSON.stringify([...wres.winners].sort()) === JSON.stringify(wolves));
ck('every role and each night are shown at the end', ww[3].t().reveal.roles.filter(Boolean).length === 6 && ww[3].t().reveal.history.length === 2);
ck('the werewolf board counts it', wn.every((n, i) => ww[0].st.board.some(b => b.name === n && b.wins === (wolves.includes(i) ? 1 : 0))));
await Promise.all(ww.map(c => c.close()));

done('PARTY');
