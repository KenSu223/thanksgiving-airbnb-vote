// What the card tables say and which sound a play makes (tableSfx.js). Run: node --test web/src/features/games/tableSfx.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { ddzLine, gdLine, playSound, tileName } from './tableSfx.js';

test('斗地主: singles and pairs by rank, bigger plays by name', () => {
  assert.equal(ddzLine({ type: 'single', main: 3 }), '三');
  assert.equal(ddzLine({ type: 'single', main: 15 }), '二');
  assert.equal(ddzLine({ type: 'single', main: 17 }), '大王');
  assert.equal(ddzLine({ type: 'pair', main: 11 }), '对J');
  assert.equal(ddzLine({ type: 'triple', main: 14 }), '三个A');
  assert.equal(ddzLine({ type: 'triple1', main: 5 }), '三带一');
  assert.equal(ddzLine({ type: 'plane2', main: 9 }), '飞机');
  assert.equal(ddzLine({ type: 'bomb', main: 7 }), '炸弹');
  assert.equal(ddzLine({ type: 'rocket', main: 17 }), '王炸');
});

test('掼蛋: only the shapes are named (ranks move with the level); a big bomb says how many', () => {
  assert.equal(gdLine({ type: 'single', main: 9, count: 1 }), '');
  assert.equal(gdLine({ type: 'full', main: 9, count: 5 }), '三带二');
  assert.equal(gdLine({ type: 'plate', main: 9, count: 6 }), '钢板');
  assert.equal(gdLine({ type: 'bomb', main: 9, count: 4 }), '炸弹');
  assert.equal(gdLine({ type: 'bomb', main: 9, count: 6 }), '6张炸弹');
  assert.equal(gdLine({ type: 'jokers', count: 4 }), '天王炸');
});

test('the sound of a play: bombs boom, runs run, planes fly, the rest is cards landing', () => {
  assert.equal(playSound({ type: 'rocket', count: 2 }), 'rocket');
  assert.equal(playSound({ type: 'jokers', count: 4 }), 'rocket');
  assert.equal(playSound({ type: 'bomb', count: 4 }), 'bomb');
  assert.equal(playSound({ type: 'sflush', count: 5 }), 'bomb');
  assert.equal(playSound({ type: 'plane1', count: 8 }), 'plane');
  assert.equal(playSound({ type: 'straight', count: 5 }), 'run');
  assert.equal(playSound({ type: 'pair', count: 2 }), 'cards');
  assert.equal(playSound({ type: 'single', count: 1 }), 'card');
});

test('川麻 tiles by name, 幺鸡 for the one of bamboo', () => {
  assert.equal(tileName('m1'), '一万');
  assert.equal(tileName('m9'), '九万');
  assert.equal(tileName('s1'), '幺鸡');
  assert.equal(tileName('s8'), '八条');
  assert.equal(tileName('p5'), '五筒');
});
