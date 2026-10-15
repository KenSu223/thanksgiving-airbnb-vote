// node --test worker/party/werewolf.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { WerewolfGame, PRESETS, WW } from './werewolf.js';
import { seated } from './testkit.js';

const of = (t, r) => t.players.filter(k => t.roles[k] === r);
const one = (t, r) => of(t, r)[0];
// start, everyone ready, run to the first role's turn
function night1(n, seed, settings = {}) {
  const g = seated(WerewolfGame, n, seed);
  if (Object.keys(settings).length) g.t.setSettings(g.keys[0], settings);
  assert.equal(g.t.start(g.keys[0]), null);
  g.keys.forEach(k => g.t.ready(k));
  assert.equal(g.t.phase, 'night');
  g.advance(WW.closeMs);
  return g;
}
// play the rest of a night step by step: actions[role] = (t, keys) => …; anything not given just times out
function playNight(g, actions = {}) {
  for (let guard = 0; guard < 200 && g.t.isNight(); guard++) {
    const role = g.t.phase;
    if (role !== 'night' && actions[role] && !g.t.step.done) actions[role](g.t, g.keys);
    g.advance(1000);
  }
}
const allSpeak = g => { for (let k = 0; k < 40 && ['speak', 'pk', 'last', 'sheriffSpeak', 'sheriffPk'].includes(g.t.phase); k++) g.t.done(g.keys[g.t.speaker()]); };
const toPhase = (g, ph, max = 120000) => { for (let s = 0; s < max && g.t.phase !== ph; s += 500) g.advance(500); return g.t.phase === ph; };

test('presets fit every table size and the deal matches', () => {
  for (let n = 6; n <= 14; n++) {
    const p = PRESETS[n];
    assert.equal(Object.values(p).reduce((a, b) => a + b, 0), n);
    const { t, keys } = seated(WerewolfGame, n, n);
    assert.equal(t.start(keys[0]), null);
    for (const [r, c] of Object.entries(p)) assert.equal(of(t, r).length, c, n + ' ' + r);
  }
});

test('custom roles must add up; wolves see each other, nobody else sees roles', () => {
  const { t, keys } = seated(WerewolfGame, 7, 3);
  t.setSettings(keys[0], { roles: { wolf: 2, villager: 2, seer: 1, witch: 1 } });
  assert.match(t.start(keys[0]), /加起来 6 个/);
  t.setSettings(keys[0], { roles: { wolf: 2, villager: 2, seer: 1, witch: 1, guard: 1 } });
  assert.equal(t.start(keys[0]), null);
  const w = of(t, 'wolf');
  assert.deepEqual(t.view(keys[w[0]]).mine.wolves, w);
  const v = one(t, 'villager');
  assert.equal(t.view(keys[v]).mine.wolves, null);
  assert.ok(t.view(keys[v]).seats.every(s => !JSON.stringify(s).includes('狼人')));
});

test('the night: dead roles are still called; non-actors never see the clock', () => {
  const g = night1(9, 5);
  const { t, keys } = g;
  assert.equal(t.phase, 'wolf'); // 9: no guard
  const wolf = one(t, 'wolf'), vil = one(t, 'villager');
  assert.ok(t.view(keys[wolf]).deadline > 0);
  assert.equal(t.view(keys[vil]).deadline, 0);
  assert.ok(t.say.some(s => s.text.startsWith('狼人请睁眼')));
});

test('wolves agree -> kill; the witch is told and saves; nobody dies (平安夜)', () => {
  const g = night1(9, 7);
  const { t, keys } = g;
  const target = one(t, 'villager');
  playNight(g, {
    wolf: () => of(t, 'wolf').forEach(w => t.wolfPick(keys[w], target)),
    witch: () => { assert.equal(t.view(keys[one(t, 'witch')]).mine.witchSaw, target); assert.equal(t.witch(keys[one(t, 'witch')], 'save'), null); },
    seer: () => t.check(keys[one(t, 'seer')], of(t, 'wolf')[0]),
  });
  assert.ok(toPhase(g, 'signup')); // 9 players: the 警长 election comes first
  assert.equal(t.history[0].kill, target);
  assert.deepEqual(t.view(keys[one(t, 'seer')]).mine.checks, [{ night: 1, seat: of(t, 'wolf')[0], wolf: true }]);
  // nobody runs: badge lost, then 平安夜
  keys.forEach(k => t.signup(k, false));
  g.advance(WW.gapMs + 10);
  assert.ok(t.say.some(s => s.text === '昨晚是平安夜'));
  assert.ok(t.living().length === 9);
});

test('同守同救 still dies; the guard can\'t guard the same person twice', () => {
  const g = night1(11, 9);
  const { t, keys } = g;
  const target = one(t, 'villager'), guard = one(t, 'guard');
  playNight(g, {
    guard: () => t.guard(keys[guard], target),
    wolf: () => of(t, 'wolf').forEach(w => t.wolfPick(keys[w], target)),
    witch: () => t.witch(keys[one(t, 'witch')], 'save'),
  });
  assert.ok(toPhase(g, 'signup'));
  keys.forEach(k => t.signup(k, false));
  g.advance(WW.gapMs + 10);
  assert.ok(!t.alive[target], '同守同救 dies');
  assert.equal(t.guardLast, target);
});

test('poison kills, and a poisoned hunter cannot shoot; the witch only sees the kill while she has 解药', () => {
  const g = night1(8, 11);
  const { t, keys } = g;
  const hunter = one(t, 'hunter'), witch = one(t, 'witch'), target = one(t, 'villager');
  playNight(g, {
    wolf: () => of(t, 'wolf').forEach(w => t.wolfPick(keys[w], target)),
    witch: () => assert.equal(t.witch(keys[witch], 'poison', hunter), null),
  });
  assert.ok(toPhase(g, 'skill'));
  assert.deepEqual(t.nightDeaths, [target, hunter].sort((a, b) => a - b));
  // walk the skill moments: the hunter (poisoned) never gets to shoot
  for (let s = 0; s < 40 && t.phase !== 'speak'; s++) {
    if (t.phase === 'skill') assert.equal(t.view(keys[hunter]).mine.canShoot, false);
    if (t.phase === 'last') t.done(keys[t.speaker()]);
    g.advance(1000);
  }
  assert.equal(t.phase, 'speak');
  // night 2: no 解药 used yet, so the witch still sees the kill; then she saves -> night 3 she doesn't see it
  allSpeak(g);
  t.voting.voters.forEach(k => t.vote(keys[k], -1));
  assert.ok(toPhase(g, 'witch'));
  assert.notEqual(t.view(keys[witch]).mine.witchSaw, null);
});

test('the hunter shoots when killed at night; the shot player is out', () => {
  const g = night1(8, 13);
  const { t, keys } = g;
  const hunter = one(t, 'hunter'), shot = one(t, 'villager');
  playNight(g, { wolf: () => of(t, 'wolf').forEach(w => t.wolfPick(keys[w], hunter)) });
  assert.ok(toPhase(g, 'skill'));
  assert.equal(t.view(keys[hunter]).mine.canShoot, true);
  assert.equal(t.shoot(keys[hunter], shot), null);
  assert.ok(!t.alive[shot]);
  assert.ok(t.say.some(s => s.text.includes('开枪带走了 ' + (shot + 1) + ' 号')));
});

test('sheriff election: candidates speak, the rest vote, 1.5 votes, and the badge passes on death', () => {
  const g = night1(9, 17);
  const { t, keys } = g;
  playNight(g, { wolf: () => of(t, 'wolf').forEach(w => t.wolfPick(keys[w], -1)) });
  assert.ok(toPhase(g, 'signup'));
  const cands = [0, 1];
  keys.forEach((k, i) => t.signup(k, cands.includes(i)));
  assert.equal(t.phase, 'sheriffSpeak');
  assert.match(t.withdraw(keys[2]), /不在竞选/);
  allSpeak(g);
  assert.equal(t.phase, 'sheriffVote');
  assert.match(t.vote(keys[0], 1), /不用投/); // candidates don't vote
  t.voting.voters.forEach(k => t.vote(keys[k], 1));
  assert.equal(t.sheriff, 1);
  g.advance(WW.gapMs + 10);
  assert.ok(t.say.some(s => s.text === '昨晚是平安夜'));
  // the 警长 picks the order and speaks last
  assert.equal(t.phase, 'order');
  assert.equal(t.order(keys[1], 'ccw'), null);
  assert.equal(t.speech.order.at(-1), 1);
  assert.equal(t.speech.order[0], 0);
  allSpeak(g);
  // everyone votes the 警长 out (1.5 counts in the tally)
  t.voting.voters.forEach(k => t.vote(keys[k], k === 1 ? 2 : 1));
  for (let s = 0; s < 20 && t.phase !== 'badge'; s++) g.advance(1000);
  assert.equal(t.phase, 'badge');
  assert.equal(t.badge(keys[1], 4), null);
  assert.equal(t.sheriff, 4);
});

test('白痴 voted out turns his card, stays in, and loses his vote', () => {
  const g = night1(12, 19);
  const { t, keys } = g;
  t.settings.sheriff = false;
  const idiot = one(t, 'idiot');
  playNight(g, { wolf: () => of(t, 'wolf').forEach(w => t.wolfPick(keys[w], -1)) });
  assert.ok(toPhase(g, 'speak'));
  allSpeak(g);
  t.voting.voters.forEach(k => t.vote(keys[k], k === idiot ? (idiot + 1) % 12 : idiot));
  assert.equal(t.idiotShown, idiot);
  assert.ok(t.alive[idiot]);
  assert.ok(toPhase(g, 'speak', 400000));
  allSpeak(g);
  assert.ok(!t.voting.voters.includes(idiot));
});

test('a wolf 自爆s mid-day: night falls; killing every 神 wins it for the wolves (屠边)', () => {
  const g = night1(6, 23, { sheriff: false });
  const { t, keys } = g;
  const [w1] = of(t, 'wolf'), seer = one(t, 'seer'), witch = one(t, 'witch');
  playNight(g, { wolf: () => of(t, 'wolf').forEach(w => t.wolfPick(keys[w], seer)) });
  assert.ok(toPhase(g, 'speak'));
  assert.equal(t.boom(keys[w1]), null);
  assert.ok(!t.alive[w1]);
  assert.equal(t.phase, 'dusk');
  assert.ok(toPhase(g, 'wolf'));
  of(t, 'wolf').filter(w => t.alive[w]).forEach(w => t.wolfPick(keys[w], witch));
  playNight(g, {});
  for (let s = 0; s < 30 && t.phase !== 'result'; s++) g.advance(1000);
  assert.equal(t.phase, 'result');
  assert.equal(t.result.good, false);
  assert.match(t.result.title, /神职/);
  assert.ok(t.result.winners.every(k => t.roles[k] === 'wolf'));
});

test('voting out every wolf wins it for the good side, and wins are counted', () => {
  const g = night1(6, 29, { sheriff: false });
  const { t, keys, saved } = g;
  for (let day = 0; day < 4 && t.phase !== 'result'; day++) {
    playNight(g, { wolf: () => of(t, 'wolf').filter(w => t.alive[w]).forEach(w => t.wolfPick(keys[w], -1)) });
    for (let s = 0; s < 60 && !['speak', 'result'].includes(t.phase); s++) { if (t.phase === 'last') t.done(keys[t.speaker()]); g.advance(1000); }
    if (t.phase === 'result') break;
    allSpeak(g);
    const wolf = of(t, 'wolf').find(w => t.alive[w]);
    t.voting.voters.forEach(k => t.vote(keys[k], k === wolf ? t.living().find(x => x !== wolf) : wolf));
    for (let s = 0; s < 120 && !['dusk', 'result', 'night'].includes(t.phase); s++) { if (t.phase === 'last') t.done(keys[t.speaker()]); g.advance(1000); }
    for (let s = 0; s < 20 && t.phase === 'dusk'; s++) g.advance(1000);
    if (t.phase === 'night') g.advance(WW.closeMs);
  }
  assert.equal(t.phase, 'result');
  assert.equal(t.result.good, true);
  assert.equal(saved.filter(s => s.wins === 1).length, 4);
  assert.ok(t.view(keys[0]).reveal.history.length >= 1);
});

test('the guard cannot guard the same player two nights running', () => {
  const g = night1(11, 31, { sheriff: false });
  const { t, keys } = g;
  const guard = one(t, 'guard'), v = one(t, 'villager');
  playNight(g, { guard: () => t.guard(keys[guard], v), wolf: () => of(t, 'wolf').forEach(w => t.wolfPick(keys[w], -1)) });
  assert.ok(toPhase(g, 'speak'));
  allSpeak(g);
  t.voting.voters.forEach(k => t.vote(keys[k], -1));
  assert.ok(toPhase(g, 'guard'));
  assert.match(t.guard(keys[guard], v), /两晚/);
  assert.equal(t.guard(keys[guard], guard), null); // himself is fine
});
