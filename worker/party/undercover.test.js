// node --test worker/party/undercover.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { UndercoverGame, autoUndercover } from './undercover.js';
import { seated } from './testkit.js';

const allReady = (t, keys) => keys.forEach(k => t.ready(k));
const talkThrough = (t, keys) => { for (let g = 0; g < 30 && t.speech; g++) t.done(keys[t.speaker()]); };

test('seats: pick a number, move, no sitting mid-game, leaving mid-game keeps the seat', () => {
  const { t, keys } = seated(UndercoverGame, 5);
  assert.equal(t.sit('x', 'X', null, { seat: 9 }), null);
  assert.equal(t.seats[9].name, 'X');
  assert.match(t.moveSeat('x', 0), /有人了/);
  assert.equal(t.moveSeat('x', 7), null);
  assert.equal(t.seats[7].name, 'X');
  t.leave('x');
  assert.equal(t.start(keys[0]), null);
  assert.match(t.sit('late', 'Late', null, {}), /已经开始/);
  t.leave(keys[4]);
  assert.ok(t.seats[4], 'seat kept mid-game');
  assert.equal(t.seats[4].connected, false);
});

test('deal: one 卧底 for 5, words differ, only 白板 knows; nobody sees others\' words', () => {
  const { t, keys } = seated(UndercoverGame, 5);
  t.start(keys[0]);
  assert.equal(autoUndercover(5), 1);
  const spies = t.players.filter(k => t.roles[k] === 'spy');
  assert.equal(spies.length, 1);
  assert.notEqual(t.civWord, t.spyWord);
  const v = t.view(keys[0]);
  assert.ok(v.mine.word);
  assert.equal(v.mine.role, null, 'no side told mid-game');
  assert.equal(v.reveal, null);
  assert.equal(JSON.stringify(v).includes(t.words[1] === v.mine.word ? '\u0000' : t.words[1]), false, 'another word is not in my view');
});

test('a full game: speak, vote the 卧底 out, 平民 win and get the win', () => {
  const { t, keys, saved } = seated(UndercoverGame, 5, 7);
  t.start(keys[0]);
  allReady(t, keys);
  assert.equal(t.phase, 'speak');
  const other = [1, 2, 3, 4].find(k => k !== t.speaker()); // not the speaker, not the host (0 started it; the host may skip)
  assert.match(t.done(keys[other]), /等/);
  talkThrough(t, keys);
  assert.equal(t.phase, 'vote');
  const spy = t.players.find(k => t.roles[k] === 'spy');
  for (const k of t.players) t.vote(keys[k], k === spy ? (spy + 1) % 5 : spy);
  assert.equal(t.phase, 'result');
  assert.equal(t.result.side, 'civ');
  const civs = t.players.filter(k => t.roles[k] === 'civ');
  assert.deepEqual(t.result.winners, civs);
  assert.equal(saved.length, 5);
  assert.ok(saved.every(s => s.games === 1));
  assert.equal(saved.filter(s => s.wins === 1).length, 4);
  assert.ok(t.view(keys[0]).reveal.roles.filter(Boolean).length === 5);
});

test('a tie goes to PK; a second tie means nobody is out', () => {
  const { t, keys } = seated(UndercoverGame, 6, 3);
  t.start(keys[0]); allReady(t, keys); talkThrough(t, keys);
  // 3 and 4 get two votes each -> tie
  [3, 3, 4, 4, 1, 2].forEach((target, k) => t.vote(keys[k], target));
  assert.equal(t.phase, 'pk');
  assert.deepEqual(t.speech.order, [3, 4]);
  talkThrough(t, keys);
  assert.equal(t.phase, 'pkvote');
  assert.match(t.vote(keys[3], 4), /不用投/); // the tied don't vote
  t.vote(keys[0], 3); t.vote(keys[1], 3); t.vote(keys[2], 4); t.vote(keys[5], 4);
  assert.equal(t.phase, 'between');
  assert.ok(t.alive.slice(0, 6).every(Boolean));
});

test('the 卧底 win when three are left with them in', () => {
  const { t, keys, advance } = seated(UndercoverGame, 5, 11);
  t.start(keys[0]); allReady(t, keys);
  const spy = t.players.find(k => t.roles[k] === 'spy');
  for (let round = 0; round < 4 && t.phase !== 'result'; round++) {
    talkThrough(t, keys);
    const victim = t.living().find(k => k !== spy);
    for (const k of t.living()) t.vote(keys[k], k === victim ? spy : victim);
    if (t.phase === 'between') advance(5000);
  }
  assert.equal(t.phase, 'result');
  assert.equal(t.result.side, 'spy');
  assert.deepEqual(t.result.winners, [spy]);
});

test('timeouts carry the game: no one acts and it still moves', () => {
  const { t, keys, advance } = seated(UndercoverGame, 4, 5);
  t.start(keys[0]);
  advance(26000); assert.equal(t.phase, 'speak');
  advance(4 * 61000); assert.equal(t.phase, 'vote');
  advance(36000); // nobody voted (the vote ran 40 s; the next round starts 4 s later)
  assert.equal(t.phase, 'between');
  assert.match(t.log.at(-1).text, /没人投票/);
});

test('settings: too many 卧底 refused at start; stop shows everything without counting', () => {
  const { t, keys, saved } = seated(UndercoverGame, 4);
  assert.equal(t.setSettings(keys[0], { spies: 2 }), null);
  assert.match(t.start(keys[0]), /最多/);
  t.setSettings(keys[0], { spies: 1, blank: false });
  assert.equal(t.start(keys[0]), null);
  assert.equal(t.stop(keys[1]), null);
  assert.equal(t.phase, 'result');
  assert.equal(saved.length, 0);
  assert.ok(t.view(keys[2]).reveal.roles.filter(Boolean).length === 4);
});
