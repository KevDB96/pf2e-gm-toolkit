// Typed-at-the-boundary PFPC workflow adapters. Workflow conditions are folded into
// the existing combatant effects model; this module does not create another condition list.
import { normalizeConditionEffects, conditionEffects } from './pf2e.js';

const object = value => value && typeof value === 'object' && !Array.isArray(value);

/**
 * Apply a newer canonical PFPC workflow envelope to matching PC combatants.
 * PFPC-owned effects are replaced by ID, while other combat effects (including
 * duration and source metadata) remain untouched. The workflow revision is stored
 * on combat state so an older response can never roll back a newer reconciliation.
 */
export function reconcileWorkflowConditions(combat, workflow) {
  if (!object(combat) || !Array.isArray(combat.combatants) || !object(workflow) ||
      !Number.isInteger(workflow.revision) || workflow.revision < 0 || !Array.isArray(workflow.characters)) {
    return { ok: false, status: 'invalid', combat };
  }
  const currentRevision = Number.isInteger(combat.pfpcWorkflowRevision) ? combat.pfpcWorkflowRevision : -1;
  if (workflow.revision <= currentRevision) return { ok: false, status: 'stale', combat };
  const byId = new Map(workflow.characters.filter(row => object(row) && typeof row.characterId === 'string').map(row => [row.characterId, row]));
  let changed = 0;
  const combatants = combat.combatants.map(combatant => {
    if (!object(combatant) || combatant.isPC !== true) return combatant;
    const characterId = combatant.ref?.kind === 'character' ? combatant.ref.id : combatant.characterId;
    const canonical = byId.get(characterId);
    if (!canonical || !Array.isArray(canonical.conditions)) return combatant;
    const effects = normalizeConditionEffects(combatant).filter(effect => effect.origin !== 'PFPC');
    for (const condition of canonical.conditions) {
      if (!object(condition) || typeof condition.id !== 'string' || typeof condition.name !== 'string') continue;
      effects.push({ id: `pfpc-${condition.id}`, name: condition.name, value: condition.value ?? null,
        note: '', sourceId: null, sourceCombatantId: null, origin: 'PFPC', dependsOn: [], duration: null,
        persistent: null, raw: condition.value === undefined ? condition.name : `${condition.name} ${condition.value}` });
    }
    changed += 1;
    return { ...combatant, effects, conditions: conditionEffects(effects) };
  });
  return { ok: true, status: 'applied', revision: workflow.revision, changed,
    combat: { ...combat, combatants, pfpcWorkflowRevision: workflow.revision } };
}

/** Build the revisioned canonical workflow operation for a deliberate GM override. */
export function gmConditionOverride(revision, characterId, condition) {
  if (!Number.isInteger(revision) || revision < 0 || typeof characterId !== 'string' || !characterId || !object(condition) ||
      typeof condition.id !== 'string' || typeof condition.name !== 'string') throw new TypeError('Invalid GM condition override');
  return { revision, action: 'condition-set', characterId,
    condition: { id: condition.id, name: condition.name, ...(Number.isInteger(condition.value) ? { value: condition.value } : {}) } };
}
