// Tests for the shared filter dropdowns: node --test tests/
//
// The records here are trimmed to the fields the facets care about, in the shape
// tools/fetch-aon.mjs writes them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_ORDER, buildFacets, creatureTypeNames, facetChange, facetKey, facetOptions,
  facetPasses, facetSelects
} from '../src/facets.js';

const TRAIT_FILE = [
  { name: 'Undead', groups: ['Creature Type'] },
  { name: 'Animal', groups: ['Creature Type'] },
  { name: 'Incorporeal', groups: ['Monster'] },
  { name: 'Rare', groups: ['Rarity'] }
];

const CREATURES = [
  { id: 'c1', name: 'Ghost', level: 4, size: 'Medium', rarity: 'common', family: 'Ghost',
    traits: ['Incorporeal', 'Spirit', 'Undead', 'Medium'] },
  { id: 'c2', name: 'Wight', level: 3, size: 'Medium', rarity: 'common', family: 'Wight',
    traits: ['Undead', 'Medium'] },
  { id: 'c3', name: 'Wolf', level: 1, size: 'Large', rarity: 'common', family: 'Wolf',
    traits: ['Animal', 'Large'] },
  { id: 'c4', name: 'Ancient Wolf', level: 4, size: 'Large', rarity: 'rare', family: 'Wolf',
    traits: ['Animal', 'Large', 'Rare'] }
];

const SPELLS = [
  { id: 's1', name: 'Heal', level: 1, type: 'Spell', traditions: ['Divine', 'Primal'],
    rarity: 'common', traits: ['Healing', 'Vitality'] },
  { id: 's2', name: 'Fireball', level: 3, type: 'Spell', traditions: ['Arcane', 'Primal'],
    rarity: 'common', traits: ['Fire'] },
  { id: 's3', name: 'Light', level: 1, type: 'Cantrip', traditions: ['Arcane'],
    rarity: 'common', traits: ['Concentrate', 'Light'] }
];

test('a category is offered the filters its own records support', () => {
  const types = creatureTypeNames(TRAIT_FILE);
  assert.deepEqual([...types], ['undead', 'animal']);

  const beasts = buildFacets(CREATURES, { creatureTypes: types });
  assert.deepEqual(beasts.map(a => a.id),
    ['creatureType', 'level', 'size', 'rarity', 'family', 'trait']);

  // Spells have no creature types, so Type falls back to the field of that name, and
  // Tradition appears because spells are the only records that carry it.
  const spells = buildFacets(SPELLS, { creatureTypes: types });
  assert.deepEqual(spells.map(a => a.id), ['level', 'type', 'traditions', 'trait']);
  // No size, rarity or family dropdown: one rarity value, and the fields are absent.
  assert.equal(spells.some(a => ['size', 'rarity', 'family'].includes(a.id)), false);

  assert.deepEqual(buildFacets([]), []);
  assert.deepEqual(buildFacets([{ id: 'x', name: 'Lonely' }]), []);
});

test('the trait dropdown drops what the other dropdowns already cover', () => {
  const axes = buildFacets(CREATURES, { creatureTypes: creatureTypeNames(TRAIT_FILE) });
  const trait = axes.find(a => a.id === 'trait');
  const offered = [...facetOptions(CREATURES, trait).keys()];
  // Undead and Animal are the Type dropdown; Medium and Large are Size; Rare is Rarity.
  assert.deepEqual(offered, ['incorporeal', 'spirit']);
});

test('options are counted, ordered and labelled for display', () => {
  const axes = buildFacets(CREATURES, { creatureTypes: creatureTypeNames(TRAIT_FILE) });

  const size = facetOptions(CREATURES, axes.find(a => a.id === 'size'));
  assert.deepEqual([...size.keys()], ['medium', 'large']);          // sheet order, not A-Z
  assert.deepEqual(size.get('medium'), { label: 'Medium', count: 2 });

  const level = facetOptions(CREATURES, axes.find(a => a.id === 'level'));
  assert.deepEqual([...level.keys()], ['1', '3', '4']);             // numeric, not '1','3','4' as text
  assert.deepEqual(level.get('4'), { label: '4', count: 2 });

  const rarity = facetOptions(CREATURES, axes.find(a => a.id === 'rarity'));
  assert.deepEqual([...rarity].map(([k, v]) => `${k}:${v.label}:${v.count}`),
    ['common:Common:3', 'rare:Rare:1']);
});

test('a record has to satisfy every chosen value', () => {
  const axes = buildFacets(CREATURES, { creatureTypes: creatureTypeNames(TRAIT_FILE) });
  const ghost = CREATURES[0];

  assert.equal(facetPasses(ghost, axes, {}), true);
  assert.equal(facetPasses(ghost, axes, { creatureType: 'undead' }), true);
  assert.equal(facetPasses(ghost, axes, { creatureType: 'undead', size: 'medium' }), true);
  assert.equal(facetPasses(ghost, axes, { creatureType: 'undead', size: 'large' }), false);
  assert.equal(facetPasses(ghost, axes, { trait: 'incorporeal' }), true);
  assert.equal(facetPasses(ghost, axes, { family: 'wolf' }), false);
  // A value in a different case still matches: keys are normalised both ways.
  assert.equal(facetPasses(ghost, axes, { size: facetKey(' MEDIUM ') }), true);
});

test('the dropdowns render with the current choice selected', () => {
  const axes = buildFacets(CREATURES, { creatureTypes: creatureTypeNames(TRAIT_FILE) });
  const html = facetSelects(axes.filter(a => a.id === 'size'), { size: 'large' },
    axis => facetOptions(CREATURES, axis));
  assert.match(html, /<select data-facet="size">/);
  assert.match(html, /<option value="">Any<\/option>/);
  assert.match(html, /<option value="large" selected\s*>Large \(2\)<\/option>/);
  assert.doesNotMatch(html, /value="medium" selected/);

  // An axis with nothing left to offer renders nothing at all.
  assert.equal(facetSelects(axes, {}, () => new Map()), '');
});

test('level filters as a range, not one exact value', () => {
  const axes = buildFacets(CREATURES, { creatureTypes: creatureTypeNames(TRAIT_FILE) });
  const level = axes.find(a => a.id === 'level');
  const [ghost, wight, wolf] = CREATURES;   // levels 4, 3, 1

  assert.equal(level.range, true);
  assert.equal(facetPasses(wolf, axes, { level: { min: 3, max: 4 } }), false);
  assert.equal(facetPasses(wight, axes, { level: { min: 3, max: 4 } }), true);
  assert.equal(facetPasses(ghost, axes, { level: { min: 3, max: 4 } }), true);
  // One open end filters from or up to, and no end at all excludes nothing.
  assert.equal(facetPasses(wolf, axes, { level: { min: 3, max: null } }), false);
  assert.equal(facetPasses(wolf, axes, { level: { min: null, max: 3 } }), true);
  assert.equal(facetPasses(wolf, axes, { level: { min: null, max: null } }), true);
  // A bare value still reads as that one level, so a stored single choice keeps working.
  assert.equal(facetPasses(wight, axes, { level: '3' }), true);
  assert.equal(facetPasses(wight, axes, { level: '4' }), false);
});

test('a range axis renders as a from/to pair over the reachable values', () => {
  const axes = buildFacets(CREATURES, { creatureTypes: creatureTypeNames(TRAIT_FILE) });
  const html = facetSelects(axes.filter(a => a.id === 'level'), { level: { min: 3, max: null } },
    axis => facetOptions(CREATURES, axis));

  assert.match(html, /<select data-facet="level" data-bound="min">/);
  assert.match(html, /<select data-facet="level" data-bound="max">/);
  assert.match(html, /<option value="3" selected\s*>3<\/option>/);
  // The open end stays on Any, and no counts on either: a count belongs to one value.
  assert.equal(html.match(/selected/g).length, 1);
  assert.doesNotMatch(html, /\(2\)/);
});

test('the two ends of a range keep each other honest', () => {
  const axes = buildFacets(CREATURES, { creatureTypes: creatureTypeNames(TRAIT_FILE) });
  const at = value => ({ dataset: { facet: 'level', bound: 'min' }, value });
  const to = value => ({ dataset: { facet: 'level', bound: 'max' }, value });

  assert.deepEqual(facetChange({}, at('3'), axes).level, { min: 3, max: null });
  // A minimum above the maximum takes the maximum with it rather than matching nothing.
  assert.deepEqual(facetChange({ level: { min: null, max: 2 } }, at('5'), axes).level,
    { min: 5, max: 5 });
  assert.deepEqual(facetChange({ level: { min: 5, max: 7 } }, to('2'), axes).level,
    { min: 2, max: 2 });
  // Back to Any at both ends is no filter at all, so "Clear filters" hides again.
  assert.equal(facetChange({ level: { min: 3, max: null } }, at(''), axes).level, '');
  // Every other axis is still one value.
  assert.equal(facetChange({}, { dataset: { facet: 'size' }, value: 'large' }, axes).size, 'large');
});

// AoN's `actions` field ("Free Action", "Single Action", ... but also duration strings
// like "1 hour" for rituals and long casts) is the only action-cost field the app uses —
// see CLAUDE.md, "Reference data". An axis with an `order` list has to put those known
// costs first, cheapest first, and still make sense of everything an order list can't
// name.
const ACTIONS = [
  { id: 'x1', name: 'Coup de Grace', actions: 'Two Actions' },
  { id: 'x2', name: 'Recall Knowledge', actions: 'Free Action' },
  { id: 'x3', name: 'Long Ritual', actions: '1 minute' },
  { id: 'x4', name: 'Strike', actions: 'Single Action' },
  { id: 'x5', name: 'Extended Ritual', actions: '1 hour' }
];

test('an ordered axis sorts its known values first and pushes the rest to the end', () => {
  const axis = { field: 'actions', order: ACTION_ORDER };
  const options = facetOptions(ACTIONS, axis);
  // Free Action, Single Action and Two Actions in cost order; "1 hour" and "1 minute"
  // are not a fixed cost, so they land after every known one, sorted by label like any
  // other unrecognised value rather than first (a bare indexOf(-1) would put them there).
  assert.deepEqual([...options.keys()],
    ['free action', 'single action', 'two actions', '1 hour', '1 minute']);
});

test('the Library offers an Actions dropdown over the real actions field, in cost order', () => {
  const axes = buildFacets(ACTIONS);
  const actions = axes.find(a => a.id === 'actions');
  assert.ok(actions, 'buildFacets() should surface an "actions" axis');
  assert.equal(actions.label, 'Actions');

  const options = facetOptions(ACTIONS, actions);
  assert.deepEqual([...options.keys()],
    ['free action', 'single action', 'two actions', '1 hour', '1 minute']);
});
