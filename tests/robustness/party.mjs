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

done('PARTY');
