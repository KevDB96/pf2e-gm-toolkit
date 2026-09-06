import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recoveryResult } from '../src/pf2e.js';

test('entered recovery rolls resolve ordinary and critical outcomes without randomness', () => {
  assert.deepEqual(recoveryResult({ dying: 2, wounded: 0, roll: 20 }), { roll: 20, degree: 3, dying: 0, wounded: 1, conscious: true, dead: false });
  assert.equal(recoveryResult({ dying: 1, wounded: 1, roll: 1 }).dead, false);
  assert.equal(recoveryResult({ dying: 3, wounded: 0, roll: 1 }).dead, true);
  assert.equal(recoveryResult({ dying: 1, wounded: 0, roll: 21 }), null);
});

test('recovery from dying adds Wounded and leaves healing/manual exceptions to the GM', () => {
  const result = recoveryResult({ dying: 1, wounded: 2, roll: 12 });
  assert.equal(result.dying, 0);
  assert.equal(result.wounded, 3);
  assert.equal(result.conscious, true);
});
