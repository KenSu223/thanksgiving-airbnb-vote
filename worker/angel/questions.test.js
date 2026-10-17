// Secret Angel's answer rules (web/src/features/angel/questions.js, shared by the
// page and worker/angel/routes.js). Run: node --test worker/angel/questions.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { QUESTIONS, MIN_ANSWERS, MAX_ANSWER, cleanAnswers, answersError } from '../../web/src/features/angel/questions.js';

test('ten questions with unique ids; only "what can\'t I be given" is required', () => {
  assert.equal(QUESTIONS.length, 10);
  assert.equal(new Set(QUESTIONS.map(q => q.id)).size, 10);
  assert.deepEqual(QUESTIONS.filter(q => q.required).map(q => q.id), ['nogo']);
  assert.equal(MIN_ANSWERS, 5);
});

test('cleaning keeps known questions, trims, drops blanks, caps the length', () => {
  const a = cleanAnswers({ nogo: '  不喝酒 ', travel: '   ', bogus: 'x', snack: 'a\n b', room: 'x'.repeat(100) });
  assert.deepEqual(Object.keys(a), ['nogo', 'snack', 'room']);
  assert.equal(a.nogo, '不喝酒');
  assert.equal(a.snack, 'a b');
  assert.equal(a.room.length, MAX_ANSWER);
  assert.deepEqual(cleanAnswers(null), {});
  assert.deepEqual(cleanAnswers('nope'), {});
});

test('five answers with "can\'t be given" among them pass; anything less says what is missing', () => {
  const five = { nogo: 'a', travel: 'b', rich: 'c', shop: 'd', snack: 'e' };
  assert.equal(answersError(five), null);
  assert.match(answersError({ travel: 'b', rich: 'c', shop: 'd', snack: 'e', room: 'f' }), /不能送/);
  assert.match(answersError({ nogo: 'a', travel: 'b' }), /再答 3 道/);
  assert.match(answersError({ ...five, shop: '  ' }), /再答 1 道/);
  assert.equal(answersError({ ...five, room: 'f', world: 'g' }), null, 'more than five is fine');
});
