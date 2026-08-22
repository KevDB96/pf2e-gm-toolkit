// Dependency-free tests for the rules module: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as pf2e from '../src/pf2e.js';

test('creature XP scales with level relative to the party', () => {
  assert.equal(pf2e.creatureXP(1, 1), 40);       // party level
  assert.equal(pf2e.creatureXP(-1, 1), 20);      // two levels below
  assert.equal(pf2e.creatureXP(4, 1), 120);      // three levels above
  assert.equal(pf2e.creatureXP(-3, 1), 10);      // four levels below, bottom of the band
  assert.equal(pf2e.creatureXP(6, 1), null);     // outside the band
  assert.equal(pf2e.creatureXP(1, 6), null);
});

test('four level -1 creatures are a moderate threat for a level 1 party of four', () => {
  const xp = 4 * pf2e.creatureXP(-1, 1);
  assert.equal(xp, 80);
  assert.equal(pf2e.threatFor(xp, 4), 'moderate');
});

test('simple hazards are worth a fifth of a creature, complex ones the full amount', () => {
  assert.equal(pf2e.hazardXP(1, 1, false), 8);
  assert.equal(pf2e.hazardXP(1, 1, true), 40);
});

test('budgets adjust per character above or below a party of four', () => {
  assert.deepEqual(pf2e.budgets(4), pf2e.THREAT_BUDGET);
  assert.deepEqual(pf2e.budgets(5),
    { trivial: 50, low: 75, moderate: 100, severe: 150, extreme: 200 });
  assert.deepEqual(pf2e.budgets(3),
    { trivial: 30, low: 45, moderate: 60, severe: 90, extreme: 120 });
});

test('threat naming covers every band including beyond extreme', () => {
  assert.equal(pf2e.threatFor(0, 4), 'trivial');
  assert.equal(pf2e.threatFor(60, 4), 'low');
  assert.equal(pf2e.threatFor(80, 4), 'moderate');
  assert.equal(pf2e.threatFor(120, 4), 'severe');
  assert.equal(pf2e.threatFor(160, 4), 'extreme');
  assert.equal(pf2e.threatFor(200, 4), 'beyond extreme');
});

test('XP award divides by real party size and multiplies by four', () => {
  assert.equal(pf2e.xpAward(80, 4), 80);
  assert.equal(pf2e.xpAward(100, 5), 80);
  assert.equal(pf2e.xpAward(60, 3), 80);
  assert.equal(pf2e.xpAward(80, 0), 0);
});

test('treasure scales with party size and clamps to levels 1-20', () => {
  assert.equal(pf2e.treasureFor(3, 4), 500);
  assert.equal(pf2e.treasureFor(3, 6), 750);
  assert.equal(pf2e.treasureFor(0, 4), 175);   // clamped up to level 1
  assert.equal(pf2e.treasureFor(99, 4), 490000); // clamped down to level 20
});

test('gp converts to the coin denominations a GM hands out', () => {
  assert.deepEqual(pf2e.toCoins(175), { pp: 17, gp: 5, sp: 0, cp: 0 });
  assert.deepEqual(pf2e.toCoins(12.35), { pp: 1, gp: 2, sp: 3, cp: 5 });
  assert.deepEqual(pf2e.toCoins(0), { pp: 0, gp: 0, sp: 0, cp: 0 });
  assert.deepEqual(pf2e.toCoins(-5), { pp: 0, gp: 0, sp: 0, cp: 0 });
});

test('dice notation rolls inside its range', () => {
  for (let i = 0; i < 200; i++) {
    const r = pf2e.roll('2d6+3');
    assert.equal(r.rolls.length, 2);
    assert.ok(r.total >= 5 && r.total <= 15, `2d6+3 gave ${r.total}`);
  }
  const d20 = pf2e.roll('d20');
  assert.ok(d20.total >= 1 && d20.total <= 20);
  assert.equal(pf2e.roll('7').total, 7);        // flat number
  assert.equal(pf2e.roll('nonsense').total, 0); // unparseable
});

test('bundled creature data matches the documented schema', async () => {
  const { readFile } = await import('node:fs/promises');
  const url = new URL('../data/creatures.json', import.meta.url);
  const data = JSON.parse(await readFile(url, 'utf8'));
  assert.ok(Array.isArray(data.creatures));
  for (const c of data.creatures) {
    assert.equal(typeof c.name, 'string');
    assert.equal(typeof c.level, 'number');
    assert.ok(Array.isArray(c.traits));
  }
});
