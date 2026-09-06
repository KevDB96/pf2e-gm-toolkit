import assert from 'node:assert/strict';
import test from 'node:test';
import { copyEncounterEntries, savedEncounter, templateWarnings, updatedEncounter } from '../src/saved-encounters.js';

const entries = [{ id: 'draft-1', name: 'Elite Drake', level: 6, count: 2, kind: 'creature', adjust: 'elite',
  creature: { id: 'c-1', name: 'Drake', hp: 90 }, custom: { note: 'wave one' } },
  { id: 'draft-2', name: 'Falling ceiling', level: 5, count: 1, kind: 'complex', hazard: { id: 'h-1', name: 'Falling ceiling', routine: 'Fall' } }];

test('saved encounter entries deep copy custom records and receive fresh draft IDs on load', () => {
  const saved = savedEncounter({ id: 'saved-1', title: 'Bridge', entries, party: { level: 6, size: 4 }, now: 10 });
  entries[0].creature.hp = 1;
  assert.equal(saved.entries[0].creature.hp, 90);
  let sequence = 0;
  const loaded = copyEncounterEntries(saved.entries, prefix => `${prefix}-loaded-${++sequence}`);
  assert.deepEqual(loaded.map(entry => entry.id), ['enc-loaded-1', 'enc-loaded-2']);
  assert.equal(loaded[0].adjust, 'elite');
  assert.equal(loaded[1].hazard.routine, 'Fall');
});

test('updating retains template identity and warns only incomplete external references', () => {
  const original = savedEncounter({ id: 'saved-1', title: 'Bridge', entries, party: { level: 6, size: 4 }, now: 10 });
  const updated = updatedEncounter(original, { entries, party: { level: 7, size: 5 }, now: 20 });
  assert.equal(updated.id, 'saved-1');
  assert.equal(updated.createdAt, 10);
  assert.equal(updated.updatedAt, 20);
  assert.deepEqual(templateWarnings({ entries: [{ name: 'Lost', creature: { id: 'gone' } }, entries[0]] }), ['Lost']);
});
