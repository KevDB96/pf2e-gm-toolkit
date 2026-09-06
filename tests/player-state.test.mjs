import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePlayer, projectPlayerState } from '../src/player-state.js';

test('player projection is an allowlisted public snapshot', () => {
  const snapshot = projectPlayerState({ round: 3, activeId: 'b', order: ['b', 'a'], combatants: [
    { id: 'a', name: 'Goblin', hp: 2, ac: 15, init: 12, notes: 'secret' },
    { id: 'b', name: 'Goblin', hp: 20, ac: 18, source: { id: 'secret' }, init: 18 }
  ] }, { entries: {
    a: { token: 'p-a', revealed: true, name: 'Goblin A' },
    b: { token: 'p-b', revealed: false, name: 'Goblin B' }
  } });
  assert.deepEqual(snapshot, { version: 1, round: 3, actors: [{ id: 'p-a', name: 'Goblin A', active: false, order: 1 }] });
  assert.equal(JSON.stringify(snapshot).includes('hp'), false);
  assert.equal(JSON.stringify(snapshot).includes('secret'), false);
});

test('player settings normalize to safe sparse entries', () => {
  assert.deepEqual(normalizePlayer({ entries: { a: { revealed: true, name: 4 }, bad: null, '__proto__': { revealed: true } } }), {
    entries: { a: { token: '', revealed: true, name: '' } }
  });
});
