import assert from 'node:assert/strict';
import test from 'node:test';
import {
  encounterEntryIsPlayerVisible,
  encounterIdentity,
  encounterImageIsPlayerVisible,
  normalizeEncounterEntries,
  setEncounterEntryIdentity,
  setEncounterEntryImageVisibility,
  setEncounterEntryVisibility
} from '../src/encounter-visibility.js';

test('encounter creature visibility defaults closed and ignores non-creatures', () => {
  const entries = normalizeEncounterEntries([
    { id: 'creature', kind: 'creature', playerVisible: 'yes' },
    { id: 'hazard', kind: 'complex', playerVisible: true }
  ]);
  assert.equal(encounterEntryIsPlayerVisible(entries[0]), false);
  assert.equal(entries[0].playerVisible, false);
  assert.equal(entries[1].playerVisible, false);
});

test('visibility can be revealed and hidden by stable encounter entry id', () => {
  const entries = [{ id: 'c-1', kind: 'creature', name: 'Goblin' }];
  const revealed = setEncounterEntryVisibility(entries, 'c-1', true);
  assert.equal(encounterEntryIsPlayerVisible(revealed[0]), true);
  assert.equal(encounterEntryIsPlayerVisible(entries[0]), false);
  const hidden = setEncounterEntryVisibility(revealed, 'c-1', false);
  assert.equal(encounterEntryIsPlayerVisible(hidden[0]), false);
});

test('visibility survives encounter template copies and normalization', () => {
  const saved = JSON.parse(JSON.stringify({ entries: [{ id: 'c-1', kind: 'creature', playerVisible: true }] }));
  const loaded = normalizeEncounterEntries(saved.entries);
  assert.equal(loaded[0].playerVisible, true);
  assert.equal(JSON.parse(JSON.stringify(loaded))[0].playerVisible, true);
});

test('slot visibility, identity, and image transitions stay independent and fail closed', () => {
  const base = [{ id: 'c-1', kind: 'creature', playerVisible: true, publicIdentity: 'unknown', publicImageVisible: true }];
  assert.equal(encounterIdentity(base[0]), 'unknown');
  assert.equal(encounterImageIsPlayerVisible(base[0]), false);
  const revealed = setEncounterEntryIdentity(base, 'c-1', 'revealed');
  assert.equal(encounterIdentity(revealed[0]), 'revealed');
  const withImage = setEncounterEntryImageVisibility(revealed, 'c-1', true);
  assert.equal(encounterImageIsPlayerVisible(withImage[0]), true);
  const hidden = setEncounterEntryIdentity(withImage, 'c-1', 'hidden');
  assert.equal(encounterEntryIsPlayerVisible(hidden[0]), false);
  assert.equal(encounterIdentity(hidden[0]), 'hidden');
  assert.equal(encounterImageIsPlayerVisible(hidden[0]), false);
});

test('a visible creature with no valid identity stays presence-only', () => {
  const entries = normalizeEncounterEntries([{ id: 'c-1', kind: 'creature', playerVisible: true }]);
  assert.equal(encounterIdentity(entries[0]), 'unknown');
  assert.equal(encounterImageIsPlayerVisible(entries[0]), false);
});
