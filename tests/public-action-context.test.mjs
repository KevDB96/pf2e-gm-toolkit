import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SESSION_PHASES } from '../src/session-phase.js';
import {
  COMPANION_PUBLIC_ACTION_CONTEXTS,
  PHASE_ACTION_CONTEXTS,
  actionContextForPhase,
  isCompanionPublicActionContext,
  isCompatibleActionContext
} from '../src/public-action-context.js';

test('every GM public phase has exactly one Companion action-reference context', () => {
  assert.deepEqual(Object.keys(PHASE_ACTION_CONTEXTS), SESSION_PHASES);
  assert.deepEqual(COMPANION_PUBLIC_ACTION_CONTEXTS, SESSION_PHASES);
  for (const phase of SESSION_PHASES) {
    const context = actionContextForPhase(phase);
    assert.equal(context, phase);
    assert.equal(isCompanionPublicActionContext(context), true);
    assert.equal(isCompatibleActionContext(phase, context), true);
  }
});

test('unknown phases and cross-phase contexts fail closed', () => {
  assert.equal(actionContextForPhase('rest'), null);
  assert.equal(actionContextForPhase('Combat'), null);
  assert.equal(isCompanionPublicActionContext('gm-private'), false);
  assert.equal(isCompatibleActionContext('combat', 'exploration'), false);
  assert.equal(isCompatibleActionContext('combat', 'gm-private'), false);
});
