// Bounded, in-memory combat transactions. Refreshing the page clears this history.

import { state, save, registerResetHook } from './store.js';

const LIMIT = 20;
let history = [];
let hookRegistered = false;
let metaAccess = { readMeta: () => null, writeMeta: () => {} };

const clone = value => JSON.parse(JSON.stringify(value));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const contextOf = context => context || metaAccess;

/** Combat view registers its transient turn report; planner imports use the same boundary. */
export function configureCombatHistory(context) { metaAccess = contextOf(context); }

function ensureResetHook() {
  if (!hookRegistered) {
    registerResetHook(clearCombatHistory);
    hookRegistered = true;
  }
}

function snapshot(context) {
  const ctx = contextOf(context);
  return { combat: clone(state.combat), meta: clone(ctx.readMeta()) };
}

function record(before, label, context) {
  const after = snapshot(context);
  if (same(before, after)) return false;
  history.push({ before, label });
  if (history.length > LIMIT) history.shift();
  save();
  return true;
}

/** Run one synchronous combat mutation and save only when it changed something. */
export function combatTransaction(label, mutate, context) {
  ensureResetHook();
  const before = snapshot(context);
  mutate(state.combat);
  return record(before, label, context);
}

/** Begin a pointer/keyboard gesture; preview mutations are committed on release. */
export function beginCombatTransaction(label, context) {
  ensureResetHook();
  return { label, before: snapshot(context), context };
}

export function commitCombatTransaction(transaction) {
  if (!transaction) return false;
  return record(transaction.before, transaction.label, transaction.context);
}

export function undoCombat(context) {
  ensureResetHook();
  const entry = history.pop();
  if (!entry) return false;
  const ctx = contextOf(context);
  state.combat = clone(entry.before.combat);
  ctx.writeMeta(clone(entry.before.meta));
  save();
  return entry.label;
}

export function canUndo() { return history.length > 0; }
export function undoLabel() { return history.at(-1)?.label || ''; }
export function clearCombatHistory() { history = []; }
