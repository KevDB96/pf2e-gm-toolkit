// Compatibility registry for the GM phase control and the Companion's public
// action-reference contexts. Keep this as a contract map, not a second rules
// implementation: the GM phase list remains the source of truth.
import { SESSION_PHASES } from './session-phase.js';

export const COMPANION_PUBLIC_ACTION_CONTEXTS = Object.freeze([
  'downtime',
  'exploration',
  'combat'
]);

export const PHASE_ACTION_CONTEXTS = Object.freeze({
  downtime: 'downtime',
  exploration: 'exploration',
  combat: 'combat'
});

export function actionContextForPhase(phase) {
  return SESSION_PHASES.includes(phase) ? PHASE_ACTION_CONTEXTS[phase] || null : null;
}

export function isCompanionPublicActionContext(context) {
  return COMPANION_PUBLIC_ACTION_CONTEXTS.includes(context);
}

export function isCompatibleActionContext(phase, context) {
  return actionContextForPhase(phase) === context && isCompanionPublicActionContext(context);
}
