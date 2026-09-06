// Pure initiative-order and active-turn transitions for the combat tracker.
import { normalizeConditionEffects, conditionEffects } from './pf2e.js';

/** Highest initiative first; array order is the stored tie order. */
export function orderedCombatants(combatants = []) {
  return combatants
    .map((combatant, index) => ({ combatant, index }))
    .sort((a, b) => {
      const ai = Number.isFinite(a.combatant.init) ? a.combatant.init : -Infinity;
      const bi = Number.isFinite(b.combatant.init) ? b.combatant.init : -Infinity;
      return bi - ai || a.index - b.index;
    })
    .map(({ combatant }) => combatant);
}

/** Convert the old active array index into the identity-based activeId field. */
export function normalizeCombat(combat) {
  const next = combat && typeof combat === 'object' ? { ...combat } : {};
  next.combatants = Array.isArray(next.combatants) ? next.combatants : [];
  // Effects are authoritative; `conditions` remains as a derived compatibility field for
  // old callers/backups and is refreshed on every normalization.
  next.combatants = next.combatants.map(combatant => {
    const effects = normalizeConditionEffects(combatant);
    return { ...combatant, effects, conditions: conditionEffects(effects) };
  });
  const ordered = orderedCombatants(next.combatants);
  const ids = new Set(ordered.map(c => c.id).filter(Boolean));
  const savedId = typeof next.activeId === 'string' && ids.has(next.activeId)
    ? next.activeId : null;
  const legacyIndex = Number.isInteger(next.active) ? next.active : null;
  const legacyId = legacyIndex === null ? null : ordered[legacyIndex]?.id || null;
  const activeId = savedId || legacyId;
  const round = Number.isInteger(next.round) && next.round > 0 && activeId ? next.round : 0;
  next.round = round;
  next.activeId = round ? activeId : null;
  // A persisted occurrence counter makes duration prompts stable through initiative
  // edits and exact under combat undo. It advances only in advanceTurn().
  next.turnEvent = Number.isInteger(next.turnEvent) && next.turnEvent >= 0 ? next.turnEvent : 0;
  const validIds = new Set(next.combatants.map(c => c.id));
  next.delayedIds = Array.isArray(next.delayedIds) ? [...new Set(next.delayedIds.filter(id => validIds.has(id)))] : [];
  next.ready = Array.isArray(next.ready) ? next.ready.filter(item => item && typeof item.id === 'string'
    && validIds.has(item.ownerId) && typeof item.action === 'string' && typeof item.trigger === 'string')
    .map(item => ({ ...item, status: item.status === 'used' ? 'used' : 'armed' })) : [];
  next.order = Array.isArray(next.order) ? [...new Set(next.order.filter(id => validIds.has(id))), ...ordered.filter(c => !next.order.includes(c.id)).map(c => c.id)] : null;
  delete next.active;
  return next;
}

/** Advance to the next combatant, returning the ID whose turn ended. */
export function advanceTurn(combat) {
  const next = normalizeCombat(combat);
  const all = next.order?.length ? next.order.map(id => next.combatants.find(c => c.id === id)).filter(Boolean) : orderedCombatants(next.combatants);
  const ordered = all.filter(c => !next.delayedIds.includes(c.id));
  if (!ordered.length) return { combat: { ...next, round: 0, activeId: null }, endingId: null };
  if (next.round === 0) {
    return { combat: { ...next, round: 1, activeId: ordered[0].id, turnEvent: next.turnEvent + 1 }, endingId: null };
  }
  const index = ordered.findIndex(c => c.id === next.activeId);
  const current = index < 0 ? 0 : index;
  const wraps = current === ordered.length - 1;
  return {
    combat: {
      ...next,
      round: next.round + (wraps ? 1 : 0),
      activeId: ordered[wraps ? 0 : current + 1].id,
      turnEvent: next.turnEvent + 1
    },
    endingId: ordered[current].id
  };
}

export function delayCombatant(combat, id) {
  const next = normalizeCombat(combat);
  if (!id || next.round === 0 || next.activeId !== id) return { combat: next, delayed: false };
  const order = (next.order?.length ? next.order : orderedCombatants(next.combatants).map(c => c.id)).filter(x => x !== id);
  const delayedIds = [...new Set([...next.delayedIds, id])];
  const available = order.filter(x => !delayedIds.includes(x));
  if (!available.length) return { combat: { ...next, delayedIds, order, activeId: null }, delayed: true };
  const currentIndex = order.indexOf(id);
  const successor = available.find(x => order.indexOf(x) > currentIndex) || available[0];
  return { combat: { ...next, delayedIds, order, activeId: successor }, delayed: true };
}

export function rejoinCombatant(combat, id, afterId) {
  const next = normalizeCombat(combat);
  if (!next.delayedIds.includes(id)) return { combat: next, rejoined: false };
  const order = (next.order?.length ? next.order : orderedCombatants(next.combatants).map(c => c.id)).filter(x => x !== id);
  const index = afterId ? order.indexOf(afterId) : -1;
  order.splice(index < 0 ? order.length : index + 1, 0, id);
  return { combat: { ...next, delayedIds: next.delayedIds.filter(x => x !== id), order, activeId: afterId || id }, rejoined: true };
}

/** Remove one row without ending its turn; active removal selects its successor. */
export function removeCombatant(combat, id) {
  const next = normalizeCombat(combat);
  const ordered = orderedCombatants(next.combatants);
  const removed = next.combatants.find(c => c.id === id) || null;
  if (!removed) return { combat: next, removed: null, activeRemoved: false };

  const activeRemoved = next.round > 0 && next.activeId === id;
  const turnIndex = ordered.findIndex(c => c.id === id);
  const remaining = next.combatants.filter(c => c.id !== id);
  if (!activeRemoved) return { combat: { ...next, combatants: remaining }, removed, activeRemoved };
  if (!remaining.length) {
    return { combat: { ...next, combatants: [], round: 0, activeId: null }, removed, activeRemoved };
  }

  const wraps = turnIndex === ordered.length - 1;
  const successor = ordered[wraps ? 0 : turnIndex + 1];
  return {
    combat: {
      ...next,
      combatants: remaining,
      round: next.round + (wraps ? 1 : 0),
      activeId: successor.id
    },
    removed,
    activeRemoved
  };
}
