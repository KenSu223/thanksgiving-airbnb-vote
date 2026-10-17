// Which accounts the RETIRED list takes off (worker/users/retire.js): a plain
// name for good, a { name, createdBefore } entry only the account made before
// that moment. Run: node --test worker/users/retire.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { retiredList, isRetired } from './retire.js';

const list = retiredList({ RETIRE: 'Retiree' });

test('the PM Test account from before goes; one made afterwards stays', () => {
  assert.equal(isRetired({ name: 'PM Test', createdAt: Date.parse('2026-10-16T20:00:00Z') }, list), true);
  assert.equal(isRetired({ name: 'pm test', createdAt: Date.parse('2026-10-16T20:00:00Z') }, list), true, 'names match case-insensitively');
  assert.equal(isRetired({ name: 'PM Test' }, list), true, 'no creation time counts as before');
  assert.equal(isRetired({ name: 'PM Test', createdAt: Date.parse('2026-10-17T05:00:00Z') }, list), false);
});

test('a plain name retires every account of that name; others are untouched', () => {
  assert.equal(isRetired({ name: 'Retiree', createdAt: Date.now() }, list), true);
  assert.equal(isRetired({ name: 'PM', createdAt: 1 }, list), false);
  assert.equal(isRetired({ name: 'Ken', createdAt: 1 }, list), false);
});
