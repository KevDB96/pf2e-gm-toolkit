// Tests for the cross-category search index matcher: node --test tests/
//
// Fixtures are hand-written in the [id, name, level] / [id, name] shape
// src/data.js's searchIndex() hands back, not read from data/.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchAll } from '../src/search.js';

test('a query under two characters (after trimming) matches nothing', () => {
  const index = { spells: [['s1', 'Fireball', 3]] };
  assert.deepEqual(searchAll(index, ''), []);
  assert.deepEqual(searchAll(index, 'a'), []);
  // Trimming happens before the length check, so two spaces around one letter still
  // counts as a one-character query rather than sneaking past on raw length.
  assert.deepEqual(searchAll(index, '  a  '), []);
});

test('exact beats prefix beats word-start beats substring, with a length tiebreak', () => {
  // Wall of Fire and Sceptre of the Firebrand both match "fire" only through their last
  // word ("Fire" and "Firebrand" both start with it) — so both land at word-start rank,
  // and the 12-character name sorts ahead of the 24-character one. This is the exact
  // case the spec calls out, not an incidental example.
  const index = {
    spells: [
      ['f1', 'Fire', 1],
      ['f2', 'Fireball', 3],
      ['f3', 'Wall of Fire', 4],
      ['f4', 'Sceptre of the Firebrand', 12]
    ]
  };
  const [result] = searchAll(index, 'fire');
  assert.equal(result.category, 'spells');
  assert.deepEqual(result.hits.map(h => h.name),
    ['Fire', 'Fireball', 'Wall of Fire', 'Sceptre of the Firebrand']);
});

test('perCategory caps the returned hits but total still counts every match', () => {
  const index = {
    feats: [
      ['a', 'Fire A'], ['b', 'Fire B'], ['c', 'Fire C'], ['d', 'Fire D'],
      ['e', 'Fire E'], ['f', 'Fire F'], ['g', 'Fire G']
    ]
  };
  const [defaultCap] = searchAll(index, 'fire');
  assert.equal(defaultCap.total, 7);
  assert.equal(defaultCap.hits.length, 6);           // default perCategory

  const [smallerCap] = searchAll(index, 'fire', { perCategory: 2 });
  assert.equal(smallerCap.total, 7);
  assert.equal(smallerCap.hits.length, 2);
});

test('categories sort best-match first, ties broken by the index object\'s own order', () => {
  // "feats" matches "fire" as a whole-name prefix (rank 1); "spells" only reaches
  // word-start (rank 2) because "Fireball" is a word inside a longer name, not the start
  // of it — so feats must come first even though "spells" sorts earlier alphabetically.
  const index = {
    spells: [['s1', 'Sceptre of Fireball Storm']],
    feats: [['f1', 'Fireball Focus']]
  };
  const ranked = searchAll(index, 'fire');
  assert.deepEqual(ranked.map(r => r.category), ['feats', 'spells']);

  // Now force an exact tie in rank: both categories only match "fire" as a substring
  // (neither name's words start with it), so the tie must be broken by insertion order
  // in the index object — "zeta" first, "alpha" second — not alphabetically.
  const tied = {
    zeta: [['z1', 'Wildfire Salvo']],
    alpha: [['a1', 'Backfire Trap']]
  };
  const tiedRanked = searchAll(tied, 'fire');
  assert.deepEqual(tiedRanked.map(r => r.category), ['zeta', 'alpha']);
});

test('a two-element entry (no level) is handled and its hit has an undefined level', () => {
  const index = { conditions: [['c1', 'Frightened']] };
  const [result] = searchAll(index, 'frightened');
  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0].level, undefined);
  assert.equal(result.hits[0].id, 'c1');
  assert.equal(result.hits[0].name, 'Frightened');
});

test('a missing index returns no results rather than throwing', () => {
  assert.deepEqual(searchAll(null, 'fire'), []);
  assert.deepEqual(searchAll(undefined, 'fire'), []);
});
