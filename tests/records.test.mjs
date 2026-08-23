// Tests for the one-line record summaries behind the hover descriptions: node --test tests/
//
// The records here are trimmed to the fields recordTip() looks at, in the shape
// tools/fetch-aon.mjs writes them — including the way AoN's own `summary` trails off
// mid-sentence, which is what the flavour rule is there for.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordTip } from '../src/records.js';

test('a creature summarises as the numbers you run it with', () => {
  const advodaza = {
    id: 'creature-4821', name: 'Advodaza', level: 18, ac: 41, hp: 405,
    saves: { fort: 30, ref: 27, will: 33 }, perception: 33,
    speed: '30 feet, fly 50 feet',
    notes: 'Advodazas are the diplomats of Hell, sent to broker infernal contracts with …'
  };
  assert.equal(recordTip(advodaza),
    'AC 41 · HP 405 · Fort +30, Ref +27, Will +33 · Per +33 · Speed 30 feet, fly 50 feet');
});

test('a spell keeps its cost, its target and what it does', () => {
  const plague = {
    id: 'spell-1', name: 'Abyssal Plague', level: 5, actions: 'Two Actions',
    range: 'touch', target: '1 creature', save: 'Fortitude',
    traditions: ['Divine', 'Occult'], notes: 'Inflict a draining curse.'
  };
  const line = recordTip(plague);
  assert.match(line, /^Two Actions · Range touch · 1 creature · Save Fortitude · Divine, Occult/);
  assert.match(line, /Inflict a draining curse\.$/);
  assert.ok(line.length <= 150);
});

test('an item leads with price, bulk and damage', () => {
  const adze = {
    id: 'weapon-467', name: 'Adze', level: 0, priceRaw: '1 gp', bulkRaw: '2',
    damage: '1d10 S', hands: '2',
    notes: 'A common cutting tool, an adze resembles an axe—but the cutting edge is …'
  };
  // The blurb is AoN's own truncation, so it is left out rather than trailing off.
  assert.equal(recordTip(adze), '1d10 S · 1 gp · Bulk 2 · Hands 2');
});

test('a record with nothing mechanical falls back to its blurb', () => {
  assert.equal(
    recordTip({ id: 'feat-1', name: 'Absorb Spell', level: 14, actions: 'Reaction',
      notes: 'You absorb a spell and store it in your body.' }),
    'Reaction · You absorb a spell and store it in your body.');

  // No fields at all: the blurb is all there is, so a clipped one still beats nothing.
  const clipped = recordTip({ id: 'feat-2', name: 'A Home in Every Port',
    notes: "You have a reputation in towns and villages you've visited, and residents are " +
      'always willing to open their doors to you, offering room and board for as long as …' });
  assert.ok(clipped.startsWith('You have a reputation'));
  assert.ok(clipped.length <= 150);

  assert.equal(recordTip({ id: 'x', name: 'Bare' }), '');
  assert.equal(recordTip(null), '');
});

test('a segment too long to summarise is skipped, not squeezed in', () => {
  const line = recordTip({
    id: 'creature-1', name: 'Resistant Thing', ac: 20, hp: 100,
    resistances: { bludgeoning: 15, physical: 15, piercing: 15, poison: 15, slashing: 15 },
    weaknesses: { holy: 10 },
    speed: '25 feet'
  });
  // The weakness is what matters in play and it fits; five resistances are a stat block.
  assert.equal(line, 'AC 20 · HP 100 · Weak Holy 10 · Speed 25 feet');
});

test('a blurb only rides along when it is the effect, not the ecology', () => {
  // A creature has numbers, so its summary is ecology and gets left out...
  const wight = { id: 'c1', name: 'Wight', ac: 18, hp: 40,
    notes: 'Wights are intelligent undead spawned through cycles of spite.' };
  assert.equal(recordTip(wight), 'AC 18 · HP 40');

  // ...and so is an item's, which describes what the thing looks like.
  assert.equal(
    recordTip({ id: 'w1', name: 'Longsword', damage: '1d8 S', priceRaw: '1 gp', bulkRaw: '1',
      notes: "Their blades are heavy and they're between 3 and 4 feet in length." }),
    '1d8 S · 1 gp · Bulk 1');

  // A spell has few numbers to give, and its summary is what it does.
  assert.match(
    recordTip({ id: 's1', name: 'Fireball', actions: 'Two Actions', range: '500 feet',
      save: 'basic Reflex', traditions: ['Arcane', 'Primal'],
      notes: 'An explosion of fire in an area burns creatures.' }),
    /An explosion of fire in an area burns creatures\.$/);
});
