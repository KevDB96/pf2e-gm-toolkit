import assert from 'node:assert/strict';
import test from 'node:test';
import { librarySearchBase, librarySelectedRows, prepareLibraryRows } from '../src/library-filter.js';

const rows = [
  { id: 'a', name: 'Fire Drake', level: 3, traits: ['Dragon'], notes: 'Breathes fire', rarity: 'common' },
  { id: 'b', name: 'Frost Drake', level: 3, traits: ['Dragon'], notes: 'Breathes cold', rarity: 'rare' },
  { id: 'c', name: 'Fire Mephit', level: 1, traits: [], notes: '' }
];
const axes = [{ id: 'rarity', field: 'rarity' }];

test('Library sidecars normalize sparse record text without mutating records', () => {
  const prepared = prepareLibraryRows(rows);
  assert.equal(prepareLibraryRows(rows), prepared);
  assert.deepEqual(librarySearchBase(prepared, { query: 'fire' }).map(row => row.record.id), ['a', 'c']);
  assert.equal(Object.hasOwn(rows[0], '_search'), false);
});

test('Library sidecars keep self-excluding facet results and XP filtering intact', () => {
  const prepared = prepareLibraryRows(rows);
  const base = librarySearchBase(prepared, { query: 'drake', bandOnly: true, partyLevel: 3 });
  const chosen = { rarity: 'rare' };
  assert.deepEqual(librarySelectedRows(base, axes, chosen).map(row => row.id), ['b']);
  assert.deepEqual(librarySelectedRows(base, axes, chosen, axes[0]).map(row => row.id), ['a', 'b']);
});
