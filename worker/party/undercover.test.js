// node --test worker/party/undercover.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { UndercoverGame } from './undercover.js';
import { seated } from './testkit.js';

// n players in seats 0..n-1 and a host ('mc') in the host chair
function table(n, seed = 1) {
  const g = seated(UndercoverGame, n, seed);
  assert.equal(g.t.sit('mc', 'Host', null, { host: true }), null);
  return g;
}
const plan = (t, p) => assert.equal(t.setUp('mc', p), null);

test('the host chair: not a player, one at a time, a dropped host can be replaced mid-game', () => {
  const { t, keys } = table(5);
  assert.ok(t.has('mc'));
  assert.equal(t.seatOf('mc'), -1);
  assert.match(t.sit('other', 'Other', null, { host: true }), /已经是主持人/);
  assert.match(t.setUp(keys[0], { civWord: 'x' }), /只有主持人/);
  assert.match(t.start(keys[0]), /主持人/);
  assert.match(t.deal(keys[0]), /只有主持人/);
  plan(t, { civWord: '牛奶', spyWord: '豆浆', spies: 1 });
  assert.equal(t.deal('mc'), null);
  t.disconnect('mc');
  assert.match(t.sit(keys[1], 'P2', null, { host: true }), /在这局里/); // a player can't take it
  assert.equal(t.sit('watcher', 'Watcher', null, { host: true }), null);
  assert.ok(t.isMc('watcher'));
  assert.equal(t.view('watcher').all.length, 5);
});

test('random deal: the words and counts the host set; players see only their own word', () => {
  const { t, keys } = table(7, 3);
  plan(t, { civWord: '牛奶', spyWord: '豆浆', spies: 2, blanks: 1 });
  assert.equal(t.deal('mc'), null);
  const roles = t.players.map(k => t.roles[k]);
  assert.equal(roles.filter(r => r === 'spy').length, 2);
  assert.equal(roles.filter(r => r === 'blank').length, 1);
  for (const k of t.players) {
    const v = t.view(keys[k]);
    assert.equal(v.mine.word, t.roles[k] === 'civ' ? '牛奶' : t.roles[k] === 'spy' ? '豆浆' : null);
    assert.equal(v.all, null);
    assert.equal(v.setup, null);
    assert.equal(v.mine.role, null);
    const other = t.roles[k] === 'civ' ? '豆浆' : '牛奶';
    if (t.roles[k] !== 'blank') assert.equal(JSON.stringify(v).includes(other), false, 'no one else\'s word');
  }
  const host = t.view('mc');
  assert.equal(host.all.length, 7);
  assert.deepEqual(host.words, { civ: '牛奶', spy: '豆浆' });
  // the plan's words are cleared for the next game; counts and mode stay
  assert.equal(t.setup.civWord, ''); assert.equal(t.setup.spies, 2);
});

test('picked deal: exactly the seats the host chose', () => {
  const { t } = table(6);
  plan(t, { mode: 'pick', civWord: '猫', spyWord: '老虎' });
  plan(t, { pick: { seat: 4, role: 'spy' } });
  plan(t, { pick: { seat: 1, role: 'blank' } });
  plan(t, { pick: { seat: 2, role: 'spy' } });
  plan(t, { pick: { seat: 2, role: 'civ' } }); // changed mind
  assert.equal(t.deal('mc'), null);
  assert.deepEqual(t.players.filter(k => t.roles[k] !== 'civ').sort(), [1, 4]);
  assert.equal(t.roles[4], 'spy'); assert.equal(t.roles[1], 'blank');
});

test('deal checks: words, at least one 卧底/白板, not too many, enough players', () => {
  const { t } = table(4);
  assert.match(t.deal('mc'), /平民的词/);
  plan(t, { civWord: '牛奶', spies: 1 });
  assert.match(t.deal('mc'), /卧底的词/);
  plan(t, { spyWord: '牛奶' });
  assert.match(t.deal('mc'), /不能一样/);
  plan(t, { spyWord: '豆浆', spies: 2 });
  assert.match(t.deal('mc'), /最多 1 个/);
  plan(t, { spies: 0, blanks: 0 });
  assert.match(t.deal('mc'), /至少要有 1 个/);
  plan(t, { spies: 0, blanks: 1, spyWord: '' }); // a 白板-only game needs no 卧底 word
  assert.equal(t.deal('mc'), null);
  const small = table(3);
  plan(small.t, { civWord: 'a', spyWord: 'b', spies: 1 });
  assert.match(small.t.deal('mc'), /至少要 4 个玩家/);
});

test('the host taps who is out (identity shown, not the word), can undo, and ends it', () => {
  const { t, keys, saved } = table(5, 9);
  plan(t, { civWord: '牛奶', spyWord: '豆浆', spies: 1 });
  t.deal('mc');
  const spy = t.players.find(k => t.roles[k] === 'spy');
  const civ = t.players.find(k => t.roles[k] === 'civ');
  assert.match(t.eliminate(keys[0], civ), /只有主持人/);
  assert.equal(t.eliminate('mc', civ), null);
  assert.deepEqual(t.view(keys[spy]).out, [{ seat: civ, role: '平民' }]);
  assert.equal(JSON.stringify(t.log).includes('牛奶'), false, 'the out player\'s word is not shown');
  assert.match(t.eliminate('mc', civ), /已经出局/);
  assert.equal(t.undo('mc'), null);
  assert.ok(t.alive[civ]);
  assert.equal(t.view('mc').winner, null);
  t.eliminate('mc', spy);
  assert.equal(t.view('mc').winner, 'civ'); // the app says so; nothing ends by itself
  assert.equal(t.phase, 'playing');
  assert.equal(t.end('mc', 'civ'), null);
  assert.equal(t.phase, 'result');
  assert.deepEqual(t.result.winners.sort(), t.players.filter(k => t.roles[k] === 'civ').sort());
  assert.equal(saved.length, 5, 'players counted, the host not');
  assert.equal(saved.filter(s => s.wins === 1).length, 4);
  assert.ok(t.view(keys[0]).reveal.roles.filter(Boolean).length === 5);
});

test('卧底 win suggestion at three left; 结束不算 counts nothing; nothing is timed', () => {
  const { t, saved, timers } = table(5, 11);
  plan(t, { civWord: '牛奶', spyWord: '豆浆', spies: 1 });
  t.deal('mc');
  assert.equal(timers.size, 0);
  assert.equal(t.view('mc').deadline, 0);
  const civs = t.players.filter(k => t.roles[k] === 'civ');
  t.eliminate('mc', civs[0]); t.eliminate('mc', civs[1]);
  assert.equal(t.view('mc').winner, 'spy');
  assert.equal(t.end('mc', null), null);
  assert.equal(t.result.side, null);
  assert.equal(saved.length, 0);
});

test('between games: the host keeps the chair, frees it, players can then take it', () => {
  const { t, keys } = table(4);
  t.leave('mc');
  assert.equal(t.mc, null);
  assert.equal(t.sit(keys[0], 'P1', null, { host: true }), null); // a seated player moves to the chair between games
  assert.equal(t.seats[0], null);
  assert.ok(t.isMc(keys[0]));
});
