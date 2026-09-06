import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceExploration, formatElapsed, normalizeExploration } from '../src/exploration.js';

test('simultaneous timers mature once when their deadlines are crossed', () => {
  const start = normalizeExploration({ elapsedMinutes: 0, timers: [
    { id: 'a', label: 'A', startedAtMinute: 0, dueAtMinute: 10, status: 'active' },
    { id: 'b', label: 'B', startedAtMinute: 0, dueAtMinute: 30, status: 'active' }
  ]});
  const ten = advanceExploration(start, 10);
  assert.deepEqual(ten.matured, ['a']);
  const thirty = advanceExploration(ten.exploration, 20);
  assert.deepEqual(thirty.matured, ['b']);
  assert.equal(thirty.exploration.timers.find(t => t.id === 'a').status, 'due');
  assert.equal(thirty.exploration.timers.find(t => t.id === 'b').status, 'due');
});

test('normalization is safe across reloads and does not use wall-clock time', () => {
  const clock = normalizeExploration({ elapsedMinutes: 1439, timers: [{ id: 'x', label: 'x', startedAtMinute: 1439, dueAtMinute: 1440 }] });
  assert.equal(advanceExploration(clock, 0).exploration.elapsedMinutes, 1439);
  assert.equal(advanceExploration(clock, 1).exploration.elapsedMinutes, 1440);
  assert.equal(formatElapsed(1440), '1d');
});

test('invalid minutes and missing optional fields are tolerated', () => {
  assert.deepEqual(normalizeExploration({ elapsedMinutes: -5, activities: [], timers: [{}] }), { elapsedMinutes: 0, activities: {}, timers: [] });
});
