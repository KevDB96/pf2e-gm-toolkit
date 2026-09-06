import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addPin, hasPin, movePin, removePin } from '../src/pins.js';

const spell = { type: 'reference', category: 'spells', id: 'fireball' };
const sameSpellWithNewLabel = { type: 'reference', category: 'spells', id: 'fireball' };
const note = { type: 'note', id: 'note-1' };

test('pins deduplicate by stable target rather than their label', () => {
  const first = { id: 'pin-1', target: spell, label: 'Fireball' };
  const changedLabel = { id: 'pin-2', target: sameSpellWithNewLabel, label: 'Fireball (rank 3)' };
  assert.deepEqual(addPin([first], changedLabel), [first]);
  assert.equal(hasPin([first], sameSpellWithNewLabel), true);
});

test('pins reorder and remove without touching other stable targets', () => {
  const pins = [{ id: 'a', target: spell, label: 'Fireball' }, { id: 'b', target: note, label: 'Plan' }];
  assert.deepEqual(movePin(pins, 'b', -1).map(pin => pin.id), ['b', 'a']);
  assert.deepEqual(removePin(pins, 'a').map(pin => pin.target), [note]);
});
