import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceTurn, delayCombatant, normalizeCombat, rejoinCombatant } from '../src/combat-turn.js';

const combat = (activeId = 'a') => normalizeCombat({ round: 1, activeId, turnEvent: 4,
  combatants: [{ id: 'a', name: 'A', init: 20 }, { id: 'b', name: 'B', init: 10 }, { id: 'c', name: 'C', init: 5 }] });

test('delay removes the current actor once and keeps identity-based progression', () => {
  const result = delayCombatant(combat(), 'a');
  assert.equal(result.combat.activeId, 'b');
  assert.deepEqual(result.combat.delayedIds, ['a']);
  assert.equal(advanceTurn(result.combat).combat.activeId, 'c');
});

test('rejoin inserts after the selected actor without changing initiative values', () => {
  const delayed = delayCombatant(combat(), 'a').combat;
  const joined = rejoinCombatant(delayed, 'a', 'b').combat;
  assert.deepEqual(joined.order, ['b', 'a', 'c']);
  assert.deepEqual(joined.delayedIds, []);
  assert.equal(joined.combatants.find(c => c.id === 'a').init, 20);
  assert.equal(advanceTurn(joined).combat.activeId, 'a');
});

test('when every actor is delayed, the transition has an explicit no-active state', () => {
  const one = delayCombatant(combat(), 'a').combat;
  const two = delayCombatant({ ...one, activeId: 'b' }, 'b').combat;
  const three = delayCombatant({ ...two, activeId: 'c' }, 'c').combat;
  assert.equal(three.activeId, null);
  assert.equal(three.round, 1);
  assert.deepEqual(three.delayedIds, ['a', 'b', 'c']);
});
