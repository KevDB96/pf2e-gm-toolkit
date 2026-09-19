import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phaseControlMarkup, phaseLabel, SESSION_PHASES } from '../src/session-phase.js';

test('session phase control is an allowlisted, keyboard-native three-button control', () => {
  assert.deepEqual(SESSION_PHASES, ['downtime', 'exploration', 'combat']);
  const markup = phaseControlMarkup('combat');
  assert.equal((markup.match(/data-session-phase=/g) || []).length, 3);
  assert.match(markup, /data-session-phase="combat"[^>]*aria-pressed="true"/);
  assert.equal((markup.match(/aria-pressed="true"/g) || []).length, 1);
  assert.doesNotMatch(markup, /rest|secret|gm/);
});

test('invalid phase values fail closed to downtime', () => {
  assert.equal(phaseLabel('exploration'), 'Exploration');
  assert.equal(phaseLabel('invalid'), 'Downtime');
  const markup = phaseControlMarkup('invalid');
  assert.match(markup, /data-session-phase="downtime"[^>]*aria-pressed="true"/);
});
