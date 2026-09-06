import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceTurn, normalizeCombat, orderedCombatants, removeCombatant } from '../src/combat-turn.js';

const A = { id: 'a', name: 'A', init: 30 };
const B = { id: 'b', name: 'B', init: 20 };
const C = { id: 'c', name: 'C', init: 10 };
const roster = [A, B, C];

test('initiative order is descending and ties retain stored order', () => {
  assert.deepEqual(orderedCombatants([
    { id: 'b', init: 20 }, { id: 'a', init: 20 }, { id: 'c', init: 30 }
  ]).map(c => c.id), ['c', 'b', 'a']);
});

test('legacy active index migrates to the ordered combatant ID', () => {
  assert.equal(normalizeCombat({ round: 2, active: 1, combatants: roster }).activeId, 'b');
  assert.equal(normalizeCombat({ round: 2, active: 99, combatants: roster }).activeId, null);
  assert.equal(normalizeCombat({ round: 2, active: 0, combatants: [] }).activeId, null);
  assert.equal(normalizeCombat({ round: 0, active: 0, combatants: roster }).activeId, null);
  assert.equal(normalizeCombat({ round: 2, activeId: 'missing', combatants: roster }).activeId, null);
});

test('starting a round and advancing use active identity', () => {
  const start = advanceTurn({ round: 0, activeId: null, combatants: roster });
  assert.equal(start.combat.activeId, 'a');
  assert.equal(start.combat.round, 1);
  const next = advanceTurn({ round: 1, activeId: 'b', combatants: roster });
  assert.equal(next.endingId, 'b');
  assert.equal(next.combat.activeId, 'c');
  assert.equal(next.combat.round, 1);
  assert.equal(start.combat.turnEvent, 1);
  assert.equal(next.combat.turnEvent, 1);
});

test('turn occurrence counter is monotonic and normalizes legacy combat', () => {
  const legacy = normalizeCombat({ round: 1, activeId: 'a', combatants: roster });
  assert.equal(legacy.turnEvent, 0);
  const one = advanceTurn(legacy);
  const two = advanceTurn(one.combat);
  assert.equal(one.combat.turnEvent, 1);
  assert.equal(two.combat.turnEvent, 2);
});

test('initiative edits do not transfer the active identity', () => {
  const edited = { ...B, init: 40 };
  const next = advanceTurn({ round: 1, activeId: 'b', combatants: [A, edited, C] });
  assert.equal(next.endingId, 'b');
  assert.equal(next.combat.activeId, 'a');
});

test('adding a combatant preserves the active identity', () => {
  const D = { id: 'd', name: 'D', init: 40 };
  const next = advanceTurn({ round: 1, activeId: 'b', combatants: [D, ...roster] });
  assert.equal(next.endingId, 'b');
  assert.equal(next.combat.activeId, 'c');
});

test('removing a non-active row preserves the active identity', () => {
  const result = removeCombatant({ round: 1, activeId: 'b', combatants: roster }, 'a');
  assert.equal(result.activeRemoved, false);
  assert.equal(result.combat.activeId, 'b');
  assert.deepEqual(result.combat.combatants.map(c => c.id), ['b', 'c']);
});

test('removing the active row selects its successor without ending its turn', () => {
  const result = removeCombatant({ round: 1, activeId: 'b', combatants: roster }, 'b');
  assert.equal(result.activeRemoved, true);
  assert.equal(result.combat.activeId, 'c');
  assert.equal(result.combat.round, 1);
});

test('removing the last active row wraps once, and removing the final row resets combat', () => {
  const wrapped = removeCombatant({ round: 3, activeId: 'c', combatants: roster }, 'c');
  assert.equal(wrapped.combat.activeId, 'a');
  assert.equal(wrapped.combat.round, 4);

  const empty = removeCombatant({ round: 4, activeId: 'a', combatants: [A] }, 'a');
  assert.equal(empty.combat.activeId, null);
  assert.equal(empty.combat.round, 0);
  assert.deepEqual(empty.combat.combatants, []);
});
