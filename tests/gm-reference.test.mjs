import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adjustedDC, degreeOfSuccess } from '../src/pf2e.js';

test('general reference DCs use level DC plus the published difficulty adjustment', () => {
  assert.equal(adjustedDC(5, 'standard'), 20);
  assert.equal(adjustedDC(5, 'hard'), 22);
  assert.equal(adjustedDC(5, 'very-hard'), 25);
  assert.equal(adjustedDC(5, 'incredibly-hard'), 30);
  assert.equal(adjustedDC(5, 'very-easy'), 15);
});

test('reference result examples keep physical die input and degree rules pure', () => {
  assert.equal(degreeOfSuccess(20 + 20, 25), 3);
  assert.equal(degreeOfSuccess(1 + 10, 25, 1), 0);
});
