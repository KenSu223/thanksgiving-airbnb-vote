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

done('PARTY');
