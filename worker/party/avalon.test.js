// node --test worker/party/avalon.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { AvalonGame, SIDES, QUESTS, isEvil } from './avalon.js';
import { seated } from './testkit.js';

const allReady = (t, keys) => keys.forEach(k => t.ready(k));
// the leader proposes a team (the first `size` players from `prefer`, then anyone), everyone approves or not
function proposeAndVote(t, keys, approve, prefer = []) {
  const L = t.leader();
  const team = [...new Set([...prefer, ...t.players])].slice(0, t.size());
  for (const k of team) t.pick(keys[L], k);
  assert.equal(t.propose(keys[L]), null);
  for (const k of t.players) t.vote(keys[k], approve ? 1 : 0);
}
const playQuest = (t, keys, failWith = 0) => {
  let fails = 0;
  for (const k of t.team) t.vote(keys[k], isEvil(t.roles[k]) && fails++ < failWith ? 0 : 1);
};

test('the deal: right sides for every size, and who knows whom', () => {
  for (let n = 5; n <= 14; n++) {
    const { t, keys } = seated(AvalonGame, n, n);
    if (n >= 8) t.setSettings(keys[0], { mordred: true });
    if (n >= 10) t.setSettings(keys[0], { oberon: true }); // 4 evil seats from 10 players
    assert.equal(t.start(keys[0]), null, 'start with ' + n);
    const evil = t.players.filter(k => isEvil(t.roles[k]));
    assert.equal(evil.length, SIDES[n][1]);
    const merlin = t.players.find(k => t.roles[k] === 'merlin');
    const mordred = t.players.find(k => t.roles[k] === 'mordred');
    const oberon = t.players.find(k => t.roles[k] === 'oberon');
    assert.deepEqual([...t.knows[merlin].see].sort(), evil.filter(k => k !== mordred).sort(), 'merlin sees evil but mordred');
    const percival = t.players.find(k => t.roles[k] === 'percival');
    const morgana = t.players.find(k => t.roles[k] === 'morgana');
    assert.deepEqual([...t.knows[percival].see].sort(), [merlin, morgana].sort());
    for (const e of evil) {
      if (e === oberon) assert.deepEqual(t.knows[e].see, []);
      else assert.deepEqual([...t.knows[e].see].sort(), evil.filter(k => k !== e && k !== oberon).sort());
    }
    // nobody else's role leaks into a view
    const v = t.view(keys[0]);
    assert.equal(v.reveal, null);
    assert.equal(JSON.stringify(v.seats).includes('梅林'), false);
  }
});

test('too many evil roles for the table is refused', () => {
  const { t, keys } = seated(AvalonGame, 5);
  t.setSettings(keys[0], { mordred: true });
  assert.match(t.start(keys[0]), /选多了/);
});

test('teams: only the leader picks, the right size, five rejections and evil wins', () => {
  const { t, keys } = seated(AvalonGame, 5, 3);
  t.start(keys[0]); allReady(t, keys);
  assert.equal(t.phase, 'team');
  const L = t.leader(), other = t.players.find(k => k !== L);
  assert.match(t.pick(keys[other], 0), /队长/);
  assert.match(t.propose(keys[L]), /要选 2/);
  for (let r = 0; r < 5; r++) {
    assert.equal(t.phase, 'team');
    proposeAndVote(t, keys, false);
  }
  assert.equal(t.phase, 'result');
  assert.equal(t.result.good, false);
  assert.match(t.result.title, /五次/);
});

test('good can only play 成功; one 失败 fails a quest; three fails and evil wins', () => {
  const { t, keys } = seated(AvalonGame, 5, 9);
  t.start(keys[0]); allReady(t, keys);
  const evil = t.players.filter(k => isEvil(t.roles[k]));
  for (let q = 0; q < 3; q++) {
    proposeAndVote(t, keys, true, evil);
    assert.equal(t.phase, 'quest');
    const good = t.team.find(k => !isEvil(t.roles[k]));
    if (good != null) assert.match(t.vote(keys[good], 0), /只能出成功/);
    playQuest(t, keys, 1);
  }
  assert.equal(t.quests.filter(x => !x.ok).length, 3);
  assert.equal(t.phase, 'result');
  assert.equal(t.result.good, false);
});

test('three successes: the assassin guesses; wrong guess and good wins, right guess and evil wins', () => {
  for (const hit of [false, true]) {
    const { t, keys, saved } = seated(AvalonGame, 6, hit ? 21 : 22);
    t.start(keys[0]); allReady(t, keys);
    const good = t.players.filter(k => !isEvil(t.roles[k]));
    for (let q = 0; q < 3; q++) { proposeAndVote(t, keys, true, good); playQuest(t, keys, 0); }
    assert.equal(t.phase, 'assassin');
    const assassin = t.players.find(k => t.roles[k] === 'assassin');
    assert.deepEqual(t.view(keys[0]).evilShown.sort(), t.players.filter(k => isEvil(t.roles[k])).sort());
    const merlin = t.players.find(k => t.roles[k] === 'merlin');
    const loyal = t.players.find(k => t.roles[k] === 'loyal');
    assert.match(t.assassinate(keys[merlin], loyal), /只有刺客/);
    assert.equal(t.assassinate(keys[assassin], hit ? merlin : loyal), null);
    assert.equal(t.phase, 'result');
    assert.equal(t.result.good, !hit);
    assert.equal(saved.filter(s => s.wins === 1).length, hit ? 2 : 4);
  }
});

test('7 players: the 4th quest needs two fails; 湖中仙女 checks after quests 2–4 and moves on', () => {
  const { t, keys } = seated(AvalonGame, 7, 5);
  t.start(keys[0]); allReady(t, keys);
  assert.deepEqual(t.view(keys[0]).sizes, QUESTS[7]);
  assert.ok(t.lady >= 0);
  const evil = t.players.filter(k => isEvil(t.roles[k]));
  const good = t.players.filter(k => !isEvil(t.roles[k]));
  // q1 success, q2 fail
  proposeAndVote(t, keys, true, good); playQuest(t, keys, 0);
  assert.equal(t.phase, 'team');
  proposeAndVote(t, keys, true, evil); playQuest(t, keys, 1);
  assert.equal(t.phase, 'lady');
  const holder = t.lady;
  assert.match(t.useLady(keys[holder], holder), /别人/);
  const target = t.players.find(k => k !== holder && !t.ladyUsed.includes(k));
  assert.equal(t.useLady(keys[holder], target), null);
  assert.equal(t.lady, target);
  assert.deepEqual(t.view(keys[holder]).mine.ladySeen, [{ seat: target, evil: isEvil(t.roles[target]) }]);
  assert.deepEqual(t.view(keys[target]).mine.ladySeen, [], 'only the checker sees the result');
  // q3 success -> lady again; skip it by timing out
  proposeAndVote(t, keys, true, good); playQuest(t, keys, 0);
  assert.equal(t.phase, 'lady');
  // q4 with one fail only still succeeds (needs two)
  t.useLady(keys[t.lady], t.players.find(k => !t.ladyUsed.includes(k) && k !== t.lady));
  proposeAndVote(t, keys, true, [...evil.slice(0, 1), ...good]); playQuest(t, keys, 1);
  assert.equal(t.quests[3].fails, 1);
  assert.equal(t.quests[3].ok, true);
  assert.equal(t.phase, 'assassin');
});

test('timeouts: missing team votes count as 赞成, missing quest cards as 成功, the leader is filled in', () => {
  const { t, keys, advance } = seated(AvalonGame, 5, 13);
  t.start(keys[0]);
  advance(46000); assert.equal(t.phase, 'team');
  advance(5 * 60000 + 1000); assert.equal(t.phase, 'teamvote'); assert.equal(t.team.length, 2);
  advance(61000); assert.equal(t.phase, 'quest');
  assert.ok(t.lastVote.ok);
  advance(46000);
  assert.equal(t.quests[0].ok, true);
  assert.equal(t.phase, 'team');
});
