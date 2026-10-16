// Party games over real sockets (worker/party): 谁是卧底 run by a host — the host
// chair, the host's words dealt (each person sees only their own; a watcher sees
// none), a phone dropping and coming back, the host tapping outs and undoing,
// ending it, the board; then 阿瓦隆 and 狼人杀 end to end.
// Standalone use: TEST_BASE=http://localhost:8791 node tests/robustness/party.mjs
import { ck, done, client, table, all, login } from './partykit.mjs';

const tag = Date.now().toString(36).slice(-5);
const names = ['甲', '乙', '丙', '丁', '戊'].map(n => n + tag);

// ---- 谁是卧底 (run by a host: words typed in, roles dealt, outs tapped — all by hand) ----
const UC = '/api/undercover';
const cs = await table(UC, names);
ck('five players sat in the seats they picked', cs.every((c, i) => c.t().seats[i]?.name === names[i]));
const hostUser = await login('主持' + tag);
const host = await client(UC);
host.send({ type: 'sit', room: 1, name: hostUser.name, token: hostUser.token, host: true });
await host.until(t => t.isMc && t.mc?.me, 'host chair');
ck('the host sits in the host chair, not a player seat', host.t().you === -1 && host.t().seats.every(s => !s || s.name !== hostUser.name));
const watcher = await client(UC);
const w = await login('看客' + tag);
watcher.send({ type: 'identify', name: w.name, token: w.token });
cs[0].send({ type: 'sit', room: 1, name: cs[0].user.name, token: cs[0].user.token, host: true });
await cs[0].until((t, st) => /已经是主持人/.test(st.error || ''), 'second host refused');
ck('only one host at a time', true);
cs[1].send({ type: 'deal' });
await cs[1].until((t, st) => /只有主持人/.test(st.error || ''), 'player cannot deal');
ck('players cannot deal', true);
host.send({ type: 'settings', settings: { civWord: '火锅', spyWord: '麻辣烫', spies: 1, blanks: 0, mode: 'random' } });
await host.until(t => t.setup?.civWord === '火锅', 'setup saved');
ck("the host's words are only in the host's view", !JSON.stringify(cs[2].t()).includes('火锅') && !JSON.stringify(watcher.t()).includes('麻辣烫'));
host.send({ type: 'deal' });
await all(cs, t => t.phase === 'playing' && t.mine, 'words dealt');
const words = cs.map(c => c.t().mine.word);
const spy = words.findIndex(x => x === '麻辣烫');
ck('everyone has the word the host typed; exactly one has the 卧底 word', words.filter(x => x === '火锅').length === 4 && spy >= 0, JSON.stringify(words));
ck("a player's view never carries the other word", cs.every((c, i) => !JSON.stringify(c.t()).includes(words[i] === '火锅' ? '麻辣烫' : '火锅')));
ck('the host sees everyone\u2019s role and word', host.t().all.length === 5 && host.t().all.some(a => a.word === '麻辣烫' && a.role === '卧底'));
await watcher.until(t => t.phase === 'playing', 'watcher sees the game');
ck("a watcher's view has no words", !JSON.stringify(watcher.t()).includes('火锅') && !JSON.stringify(watcher.t()).includes('麻辣烫'));
ck('nothing is timed', host.t().deadline === 0 && cs[0].t().deadline === 0);
// a phone drops mid-game and comes back
await cs[3].close();
const back = await client(UC);
back.send({ type: 'identify', name: cs[3].user.name, token: cs[3].user.token });
await back.until(t => t.you === 3 && t.mine, 'back on seat 4');
ck('a dropped phone comes back to its seat and word', back.t().mine.word === words[3]);
back.user = cs[3].user; cs[3] = back;
// the host taps who's out
const civ = [0, 1, 2, 3, 4].find(k => k !== spy);
cs[civ === 0 ? 1 : 0].send({ type: 'out', seat: civ });
await cs[civ === 0 ? 1 : 0].until((t, st) => /只有主持人/.test(st.error || ''), 'player cannot tap out');
ck('players cannot tap someone out', true);
host.send({ type: 'out', seat: civ });
await all(cs, t => t.out?.length === 1, 'out shown');
ck('the out player is shown as 平民 (not their word)', cs[0].t().out[0].role === '平民' && !cs[0].t().log.some(l => l.text.includes('火锅')));
host.send({ type: 'undo' });
await host.until(t => t.out.length === 0 && t.alive[civ], 'undo');
ck('the host can undo a wrong tap', true);
host.send({ type: 'out', seat: spy });
await host.until(t => t.winner === 'civ', 'winner suggested');
ck('when the 卧底 is out the app tells the host 平民 won, but does not end it', host.t().phase === 'playing');
host.send({ type: 'end', side: 'civ' });
await all(cs, t => t.phase === 'result', 'result');
const r = cs[0].t().result;
ck('the host ends it: 平民 win, the 卧底 is not a winner', r.side === 'civ' && r.winners.length === 4 && !r.winners.includes(spy), JSON.stringify(r).slice(0, 200));
ck('everyone sees every role and the two words once it is over', cs[1].t().reveal.roles.filter(Boolean).length === 5 && cs[1].t().reveal.civWord === '火锅');
// the boards show only the top 3; everyone below gets their own place, nobody else's
const placeOf = (c, n) => [...(c.st.board || []), c.st.boardMe].find(b => b && b.name === n);
ck('the board counts the players (each sees their own place), not the host',
  names.every((n, i) => { const b = placeOf(cs[i], n); return b && b.games >= 1 && b.wins === (i === spy ? 0 : 1); }) && !placeOf(host, hostUser.name),
  JSON.stringify(cs.map(c => [c.st.board.map(b => b.name), c.st.boardMe])).slice(0, 400));
ck('only the top 3 are on the board', [...cs, host, watcher].every(c => c.st.board.length <= 3), JSON.stringify(cs.map(c => c.st.board.length)));
ck('a player below the top 3 sees their own place, ranked', cs.some(c => c.st.boardMe?.rank >= 4) && cs.every(c => !c.st.boardMe || (c.st.boardMe.rank >= 4 && c.st.boardMe.name === c.user.name)), JSON.stringify(cs.map(c => c.st.boardMe)));
ck('a signed-in watcher who never played gets no place', !watcher.st.boardMe);
await Promise.all([...cs, watcher, host].map(c => c.close()));

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
ck('the avalon board counts it (each sees their own place)', an.every((n, i) => placeOf(av[i], n)?.wins === (role[i].evil ? 0 : 1)) && av.every(c => c.st.board.length <= 3));
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
await all(ww, t => t.phase === 'result', 'everyone sees the end', 10000); // each socket gets it in its own time
ck('every role and each night are shown at the end', ww[3].t().reveal.roles.filter(Boolean).length === 6 && ww[3].t().reveal.history.length === 2);
ck('the werewolf board counts it (each sees their own place)', wn.every((n, i) => placeOf(ww[i], n)?.wins === (wolves.includes(i) ? 1 : 0)) && ww.every(c => c.st.board.length <= 3));
await Promise.all(ww.map(c => c.close()));

done('PARTY');
