import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileWorkflowConditions, gmConditionOverride } from '../src/pfpc-workflow.js';

test('player workflow conditions appear in the existing GM combat condition model', () => {
  const combat = { round: 1, combatants: [
    { id: 'row-1', isPC: true, ref: { kind: 'character', id: 'hero' }, effects: [{ id: 'gm-1', name: 'Wounded', value: 1, origin: 'Manual', raw: 'Wounded 1' }] },
    { id: 'npc-1', isPC: false, effects: [] }
  ] };
  const applied = reconcileWorkflowConditions(combat, { revision: 4, month: 1, characters: [
    { characterId: 'hero', conditions: [{ id: 'frightened', name: 'Frightened', value: 2 }], exploration: null, downtime: null }
  ] });
  assert.equal(applied.status, 'applied');
  assert.equal(applied.combat.combatants[0].conditions.includes('Frightened 2'), true);
  assert.equal(applied.combat.combatants[0].conditions.includes('Wounded 1'), true);
  assert.deepEqual(applied.combat.combatants[1], combat.combatants[1]);
  assert.equal(applied.combat.pfpcWorkflowRevision, 4);
});

test('canonical newer workflow revision wins and stale updates cannot roll it back', () => {
  const first = reconcileWorkflowConditions({ combatants: [{ id: 'row', isPC: true, characterId: 'hero', effects: [] }] }, {
    revision: 8, month: 1, characters: [{ characterId: 'hero', conditions: [{ id: 'frightened', name: 'Frightened', value: 2 }] }]
  });
  const stale = reconcileWorkflowConditions(first.combat, {
    revision: 7, month: 1, characters: [{ characterId: 'hero', conditions: [] }]
  });
  assert.equal(stale.status, 'stale');
  assert.equal(stale.combat.combatants[0].conditions.includes('Frightened 2'), true);
  assert.equal(gmConditionOverride(8, 'hero', { id: 'frightened', name: 'Frightened', value: 1 }).condition.value, 1);
});

test('invalid workflow and GM override are rejected; reconciliation adds no player-private list', () => {
  assert.equal(reconcileWorkflowConditions({ combatants: [] }, { revision: -1, characters: [] }).status, 'invalid');
  assert.throws(() => gmConditionOverride(-1, 'hero', { id: 'frightened', name: 'Frightened' }));
  const result = reconcileWorkflowConditions({ combatants: [] }, { revision: 1, characters: [] });
  assert.equal(Object.hasOwn(result.combat, 'playerConditions'), false);
  assert.equal(Object.hasOwn(result.combat, 'workflow'), false);
});
