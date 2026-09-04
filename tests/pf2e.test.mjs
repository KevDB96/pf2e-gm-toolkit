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

test('the threat gauge runs trivial to extreme and re-proportions with party size', () => {
  // A band starts at its own budget and runs to the next, which is how threatFor() reads
  // a total — so the needle and the threat name can never disagree.
  const four = pf2e.threatScale(4);
  assert.deepEqual(four.map(b => b.threat), pf2e.THREAT_ORDER);
  assert.deepEqual(four.map(b => b.from), [0, 60, 80, 120, 160]);
  assert.deepEqual(four.map(b => b.to), [60, 80, 120, 160, 200]);
  assert.equal(four.reduce((sum, b) => sum + b.width, 0), 100);
  // Overshooting the extreme budget still sits in the extreme band; threatFor() adds the
  // "beyond extreme" warning on top of it.
  const banded = xp => pf2e.threatFor(xp, 4).replace('beyond extreme', 'extreme');
  for (const band of four) {
    assert.equal(banded(band.from), band.threat);
    assert.equal(banded(band.to - 1), band.threat);
  }

  const six = pf2e.threatScale(6);
  assert.deepEqual(six.map(b => b.from), [0, 90, 120, 180, 240]);
  assert.equal(six.reduce((sum, b) => sum + b.width, 0), 100);
  for (const band of six) assert.equal(pf2e.threatFor(band.from, 6), band.threat);

  // The needle lands inside the band its own threat name points at.
  const bandAt = pct => four.find((b, i) => {
    const start = four.slice(0, i).reduce((sum, x) => sum + x.width, 0);
    return pct >= start && pct < start + b.width;
  });
  for (const xp of [0, 30, 60, 79, 80, 119, 120, 159, 160, 199]) {
    assert.equal(bandAt(pf2e.threatPosition(xp, 4)).threat, banded(xp));
  }
  assert.equal(pf2e.threatPosition(0, 4), 0);
  assert.equal(pf2e.threatPosition(100, 4), 50);
  assert.equal(pf2e.threatPosition(200, 4), 100);
  assert.equal(pf2e.threatPosition(400, 4), 100);   // beyond extreme pins to the right
});

test('elite/weak level adjustment carries the special cases at the bottom of each scale', () => {
  // Elite: normally +1, but +2 at level -1 or 0 — the two lowest levels the app allows.
  assert.equal(pf2e.adjustedLevel(-1, 'elite'), 1);
  assert.equal(pf2e.adjustedLevel(0, 'elite'), 2);
  assert.equal(pf2e.adjustedLevel(1, 'elite'), 2);   // level 1 is not a special case: +1
  assert.equal(pf2e.adjustedLevel(5, 'elite'), 6);

  // Weak: normally -1, but -2 at level 1 specifically (level 0 is not the special case).
  assert.equal(pf2e.adjustedLevel(1, 'weak'), -1);
  assert.equal(pf2e.adjustedLevel(2, 'weak'), 1);
  assert.equal(pf2e.adjustedLevel(0, 'weak'), -1);
  assert.equal(pf2e.adjustedLevel(5, 'weak'), 4);

  // Anything else — null, undefined, a typo — is unchanged, not an error.
  assert.equal(pf2e.adjustedLevel(3, null), 3);
  assert.equal(pf2e.adjustedLevel(3, undefined), 3);
  assert.equal(pf2e.adjustedLevel(3, 'sturdy'), 3);
});

test('elite HP adds by the starting level\'s band, every edge included', () => {
  assert.equal(pf2e.adjustedHP(10, 1, 'elite'), 20);    // level 1 or lower: +10
  assert.equal(pf2e.adjustedHP(10, 0, 'elite'), 20);    // a level below 1 still reads as +10
  assert.equal(pf2e.adjustedHP(10, -1, 'elite'), 20);
  assert.equal(pf2e.adjustedHP(20, 2, 'elite'), 35);    // levels 2-4: +15
  assert.equal(pf2e.adjustedHP(20, 4, 'elite'), 35);
  assert.equal(pf2e.adjustedHP(50, 5, 'elite'), 70);    // levels 5-19: +20
  assert.equal(pf2e.adjustedHP(50, 19, 'elite'), 70);
  assert.equal(pf2e.adjustedHP(200, 20, 'elite'), 230); // level 20+: +30
});

test('weak HP subtracts by the starting level\'s band and never drops below 1', () => {
  assert.equal(pf2e.adjustedHP(20, 1, 'weak'), 10);     // levels 1-2: -10
  assert.equal(pf2e.adjustedHP(20, 2, 'weak'), 10);
  assert.equal(pf2e.adjustedHP(30, 3, 'weak'), 15);     // levels 3-5: -15
  assert.equal(pf2e.adjustedHP(30, 5, 'weak'), 15);
  assert.equal(pf2e.adjustedHP(40, 6, 'weak'), 20);      // levels 6-20: -20
  assert.equal(pf2e.adjustedHP(40, 20, 'weak'), 20);
  assert.equal(pf2e.adjustedHP(60, 21, 'weak'), 30);     // level 21+: -30
  // The published table says nothing about level 0; the app takes the lowest band (-10)
  // as the nearest fit rather than a rule, and never lets the result reach 0 or below.
  assert.equal(pf2e.adjustedHP(20, 0, 'weak'), 10);
  assert.equal(pf2e.adjustedHP(8, 1, 'weak'), 1);       // 8 - 10 floors at 1, not 0 or -2
});

test('elite/weak AC is a flat ±2, and both HP and AC pass a missing value straight through', () => {
  assert.equal(pf2e.adjustedAC(18, 'elite'), 20);
  assert.equal(pf2e.adjustedAC(18, 'weak'), 16);
  assert.equal(pf2e.adjustedAC(null, 'elite'), null);
  assert.equal(pf2e.adjustedAC(undefined, 'weak'), null);
  assert.equal(pf2e.adjustedHP(null, 5, 'elite'), null);
  assert.equal(pf2e.adjustedHP(undefined, 5, 'weak'), null);

  // A null or unrecognised adjust leaves every one of these untouched.
  assert.equal(pf2e.adjustedAC(18, null), 18);
  assert.equal(pf2e.adjustedAC(18, 'sturdy'), 18);
  assert.equal(pf2e.adjustedHP(30, 5, undefined), 30);
});

test('loot suggestions keep to the level band and spread across categories', () => {
  const items = [
    { id: 'w1', name: 'Sword', level: 7, category: 'Weapons', price: 10000 },
    { id: 'w2', name: 'Axe', level: 8, category: 'Weapons', price: 12000 },
    { id: 'w3', name: 'Spear', level: 8, category: 'Weapons', price: 9000 },
    { id: 'c1', name: 'Elixir', level: 7, category: 'Consumables', price: 3000 },
    { id: 'c2', name: 'Potion', level: 8, category: 'Consumables', price: 4000 },
    { id: 'r1', name: 'Rune', level: 8, category: 'Runes', price: 20000 },
    { id: 'x1', name: 'Too low', level: 6, category: 'Weapons', price: 5000 },
    { id: 'x2', name: 'Too high', level: 9, category: 'Weapons', price: 5000 },
    { id: 'x3', name: 'Hireling', level: 7, category: 'Services', price: 100 },
    { id: 'x4', name: 'Cursed Blade', level: 7, category: 'Cursed Items', price: 8000 },
    { id: 'x5', name: 'Plot Compass', level: 7, category: 'Held Items' }   // no price
  ];
  // A fixed sequence stands in for Math.random, so the spread is checkable.
  let at = 0;
  const random = () => [0.11, 0.53, 0.87, 0.29, 0.66, 0.04][at++ % 6];

  const picked = pf2e.lootSelection(items, { level: 7, count: 4, random });
  assert.equal(picked.length, 4);
  assert.equal(picked.some(i => i.price === undefined), false);
  assert.equal(picked.every(i => i.level === 7 || i.level === 8), true);
  assert.equal(picked.some(i => ['Services', 'Cursed Items'].includes(i.category)), false);
  assert.equal(picked.some(i => i.price === undefined), false);
  // Round-robin: the first three come from three different categories rather than
  // three weapons in a row.
  assert.equal(new Set(picked.slice(0, 3).map(i => i.category)).size, 3);

  // Asking for more than the band holds returns the band, not padding or duplicates.
  const all = pf2e.lootSelection(items, { level: 7, count: 50, random });
  assert.equal(all.length, 6);
  assert.equal(new Set(all.map(i => i.id)).size, 6);
  assert.deepEqual(pf2e.lootSelection([], { level: 7 }), []);
  assert.deepEqual(pf2e.lootSelection(items, { level: 20, random }), []);
});

test('a loot selection fills the level\'s treasure budget without blowing it', () => {
  // Prices are copper, as data/equipment.json stores them: 100 gp, 200 gp, 50 gp.
  const items = [
    { id: 'a1', name: 'Blade', level: 5, category: 'Weapons', price: 10000 },
    { id: 'a2', name: 'Sabre', level: 6, category: 'Weapons', price: 20000 },
    { id: 'a3', name: 'Dirk', level: 5, category: 'Weapons', price: 5000 },
    { id: 'b1', name: 'Draught', level: 5, category: 'Consumables', price: 10000 },
    { id: 'b2', name: 'Tonic', level: 6, category: 'Consumables', price: 5000 },
    { id: 'c1', name: 'Cloak', level: 6, category: 'Worn Items', price: 20000 },
    { id: 'c2', name: 'Ring', level: 5, category: 'Worn Items', price: 30000 }
  ];
  let at = 0;
  const random = () => [0.37, 0.72, 0.18, 0.91, 0.44, 0.6][at++ % 6];
  const gp = list => list.reduce((sum, i) => sum + i.price, 0) / 100;

  const filled = pf2e.lootSelection(items, { level: 5, budget: 500, random });
  assert.ok(gp(filled) <= 525, `${gp(filled)} gp overshot the 500 gp budget`);
  assert.ok(gp(filled) >= 450, `${gp(filled)} gp fell short of the 500 gp budget`);

  // A budget smaller than anything in the band comes back empty rather than overspending.
  assert.deepEqual(pf2e.lootSelection(items, { level: 5, budget: 10, random }), []);

  // A budget larger than the whole band takes the band and stops.
  const everything = pf2e.lootSelection(items, { level: 5, budget: 100000, random });
  assert.equal(everything.length, items.length);

  // The item cap still holds: a big budget at a cheap level cannot return forty items.
  const capped = pf2e.lootSelection(items, { level: 5, budget: 100000, count: 3, random });
  assert.equal(capped.length, 3);
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

test('an amount splits evenly without losing a copper', () => {
  assert.deepEqual(pf2e.splitEvenly(100, 4), [25, 25, 25, 25]);
  // 170 gp five ways is 34 gp each; 10 gp three ways cannot be equal, so the odd coppers
  // go to the front and the shares still add back up to the whole.
  assert.deepEqual(pf2e.splitEvenly(170, 5), [34, 34, 34, 34, 34]);
  const thirds = pf2e.splitEvenly(10, 3);
  assert.deepEqual(thirds, [3.34, 3.33, 3.33]);
  assert.equal(thirds.reduce((a, b) => a + b, 0).toFixed(2), '10.00');
  assert.deepEqual(pf2e.splitEvenly(7, 1), [7]);
  assert.deepEqual(pf2e.splitEvenly(0, 4), [0, 0, 0, 0]);
  assert.deepEqual(pf2e.splitEvenly(50, 0), []);
  assert.deepEqual(pf2e.splitEvenly(-5, 2), [0, 0]);
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
    for (const s of c.strikes || []) {
      assert.equal(typeof s.name, 'string', c.name);
      assert.equal(typeof s.bonus, 'number', c.name);
      assert.ok(s.kind === 'melee' || s.kind === 'ranged', c.name);
    }
    // An ability that rolls a save has to say which one, or the sim cannot resolve it.
    for (const a of c.specials || []) {
      assert.equal(typeof a.name, 'string', c.name);
      if (a.save) assert.ok(['fort', 'ref', 'will'].includes(a.save), c.name + ': ' + a.save);
    }
    for (const i of c.immunities || []) assert.equal(typeof i, 'string', c.name);
  }
});

test('most creatures carry at least one strike', async () => {
  // The guard that catches the Archives changing its stat-block markup: the parser would
  // quietly write an empty array for every creature and every fight would end 0-0. It was
  // 94.2% when this landed, and the floor is set well below that so a genuine drift in the
  // data does not fail the suite on its own.
  const { readFile } = await import('node:fs/promises');
  const url = new URL('../data/creatures.json', import.meta.url);
  const { creatures } = JSON.parse(await readFile(url, 'utf8'));
  const armed = creatures.filter(c => (c.strikes || []).length).length;
  assert.ok(armed / creatures.length > 0.8,
    `only ${armed} of ${creatures.length} creatures have a strike`);
});

test('a parsed strike is something the damage maths can actually read', async () => {
  const { readFile } = await import('node:fs/promises');
  const url = new URL('../data/creatures.json', import.meta.url);
  const { creatures } = JSON.parse(await readFile(url, 'utf8'));
  const damaging = creatures.flatMap(c => c.strikes || []).filter(s => s.damage);
  const parsed = damaging.filter(s => pf2e.parseDamage(s.damage).clauses.length);
  // The rest are the effect-only Strikes — "attach", "tongue grab" — which have no dice
  // by design rather than by failure.
  assert.ok(parsed.length / damaging.length > 0.95,
    `only ${parsed.length} of ${damaging.length} strike damage clauses parse`);
});

test('ability modifiers round down from the score', () => {
  assert.equal(pf2e.abilityMod(10), 0);
  assert.equal(pf2e.abilityMod(11), 0);          // odd scores do not round up
  assert.equal(pf2e.abilityMod(12), 1);
  assert.equal(pf2e.abilityMod(19), 4);
  assert.equal(pf2e.abilityMod(8), -1);
  assert.equal(pf2e.abilityMod(7), -2);
});

test('untrained adds no level, every other rank does', () => {
  assert.equal(pf2e.proficiencyBonus(0, 7), 0);  // untrained is a flat +0
  assert.equal(pf2e.proficiencyBonus(2, 7), 9);  // trained
  assert.equal(pf2e.proficiencyBonus(4, 7), 11); // expert
  assert.equal(pf2e.proficiencyBonus(6, 7), 13); // master
  assert.equal(pf2e.proficiencyBonus(8, 7), 15); // legendary
  assert.equal(pf2e.proficiencyBonus(2, 1), 3);
});

test('proficiency ranks are named from their bonus', () => {
  assert.equal(pf2e.proficiencyName(0), 'untrained');
  assert.equal(pf2e.proficiencyName(2), 'trained');
  assert.equal(pf2e.proficiencyName(4), 'expert');
  assert.equal(pf2e.proficiencyName(6), 'master');
  assert.equal(pf2e.proficiencyName(8), 'legendary');
  assert.equal(pf2e.proficiencyName(99), 'untrained');
});

test('max HP takes ancestry once and class plus Con every level', () => {
  // Vulpia Kasai: Kitsune 8 + level 7 x (Kineticist 8 + Con +4) = 92
  assert.equal(pf2e.maxHP({ ancestryHP: 8, classHP: 8, conMod: 4, level: 7 }), 92);
  assert.equal(pf2e.maxHP({ ancestryHP: 8, classHP: 8, conMod: 4, level: 1 }), 20);
  assert.equal(pf2e.maxHP({ ancestryHP: 6, classHP: 6, conMod: 0, level: 3 }), 24);
  assert.equal(pf2e.maxHP({ ancestryHP: 8, classHP: 8, conMod: 2, level: 2,
                            bonusHP: 5, bonusHPPerLevel: 1 }), 35);
  assert.equal(pf2e.maxHP(), 0);
});

test('a Pathbuilder export converts to the stored character shape', async () => {
  const { fromPathbuilder } = await import('../src/pathbuilder.js');
  const c = fromPathbuilder({
    build: {
      name: 'Vulpia Kasai', class: 'Kineticist', level: 7, ancestry: 'Kitsune',
      heritage: 'Sylph', sizeName: 'Medium', keyability: 'con',
      abilities: { str: 12, dex: 14, con: 19, int: 16, wis: 10, cha: 14 },
      attributes: { ancestryhp: 8, classhp: 8, bonushp: 0, bonushpPerLevel: 0,
                    speed: 25, speedBonus: 5 },
      proficiencies: { classDC: 4, perception: 2, fortitude: 6, reflex: 4, will: 4,
                       arcana: 4, nature: 2, occultism: 2, crafting: 0 },
      mods: { Occultism: { 'Item Bonus': 1 } },
      lores: [['Plane of Fire', 2]],
      acTotal: { acTotal: 22 },
      spellCasters: [{ name: 'Elementally Infused', magicTradition: 'primal',
                       ability: 'cha', proficiency: 2, spells: [{ list: ['Ignition'] }] }]
    }
  }, { group: 'mists-of-zalazar' });

  assert.equal(c.id, 'vulpia-kasai');
  assert.equal(c.group, 'mists-of-zalazar');
  assert.equal(c.hp, 92);                     // 8 + 7 x (8 + 4)
  assert.equal(c.ac, 22);                     // taken from the export, not recomputed
  assert.equal(c.speed, 30);                  // 25 base + 5 bonus
  assert.equal(c.perception, 9);              // trained 9 + Wis 0
  assert.deepEqual(c.saves, { fort: 17, ref: 13, will: 11 });
  assert.equal(c.saveRanks.fort, 'master');
  assert.equal(c.classDC, 25);                // 10 + expert 11 + Con 4
  assert.equal(c.spellcasting[0].dc, 21);     // 10 + trained 9 + Cha 2

  const byName = Object.fromEntries(c.skills.map(s => [s.name, s.bonus]));
  assert.equal(byName.arcana, 14);            // expert 11 + Int 3
  assert.equal(byName.nature, 9);             // trained 9 + Wis 0
  assert.equal(byName.occultism, 13);         // trained 9 + Int 3 + item 1
  assert.equal(byName.crafting, 3);           // untrained: Int 3, and no level
  assert.equal(byName.medicine, 0);           // untrained and Wis 0, but still listed
  assert.equal(c.skills.length, 16);          // every skill, so the sheet can show them
  assert.deepEqual(c.lores, [{ name: 'Plane of Fire', rank: 'trained', bonus: 12 }]);
});

test('feats group by category, actions before passives', () => {
  const groups = pf2e.featGroups([
    { name: 'Wall Jump', type: 'General Feat', traits: ['General', 'Skill'] },
    { name: 'Fleetwind Centaur', type: 'Heritage', traits: [] },
    { name: "Rescuer's Press", type: 'Archetype Feat', traits: ['Archetype', 'Rare'] },
    { name: 'Repulse the Wicked', type: 'Archetype Feat', traits: ['Archetype'],
      actions: 'Reaction' },
    { name: 'Sentry Dedication', type: 'Archetype Feat',
      traits: ['Archetype', 'Dedication', 'Uncommon'] },
    { name: 'Practiced Brawn', type: 'Ancestry Feat', traits: ['Centaur'] },
    { name: 'Hampering Stance', type: 'Class Feat', traits: ['Aura', 'Guardian', 'Stance'],
      actions: 'Single Action' },
    { name: 'Homebrewed Boon', type: 'Table Reward' }
  ]);

  // Heritage first, then the chosen feats, then anything the tool does not recognise.
  assert.deepEqual(groups.map(g => g.type), ['Heritage', 'Ancestry Feat', 'Class Feat',
    'Archetype Feat', 'General Feat', 'Table Reward']);

  const archetype = groups.find(g => g.type === 'Archetype Feat');
  assert.deepEqual(archetype.feats.map(f => f.name),
    // The reaction leads; the two passives then sort by their trait lists, so
    // "Archetype Dedication Uncommon" comes before "Archetype Rare".
    ['Repulse the Wicked', 'Sentry Dedication', "Rescuer's Press"]);

  assert.deepEqual(pf2e.featGroups(), []);
  assert.deepEqual(pf2e.featGroups([{ name: 'Lone Feat' }]).map(g => g.type), ['Other']);
});

test('untrained skills are reconstructed for characters imported without them', () => {
  // Records written before the importer kept untrained skills hold only the trained ones.
  const filled = pf2e.skillList({
    skills: [{ name: 'arcana', rank: 'expert', bonus: 14 }],
    mods: { str: 1, dex: 2, con: 4, int: 3, wis: 0, cha: 2 }
  });
  assert.equal(filled.length, 16);
  assert.deepEqual(filled[0], { name: 'acrobatics', rank: 'untrained', bonus: 2 });
  assert.deepEqual(filled[1], { name: 'arcana', rank: 'expert', bonus: 14 });
  assert.equal(filled.find(s => s.name === 'medicine').bonus, 0);
  // A character with no skills and no attributes at all still lists every skill.
  assert.equal(pf2e.skillList({}).length, 16);
  assert.equal(pf2e.skillList().every(s => s.bonus === 0), true);
});

test('a non-Pathbuilder payload is rejected rather than half-converted', async () => {
  const { fromPathbuilder } = await import('../src/pathbuilder.js');
  assert.throws(() => fromPathbuilder({ hello: 'world' }), /Pathbuilder export/);
  assert.throws(() => fromPathbuilder(null), /Pathbuilder export/);
});

test('a placeholder language is dropped rather than listed as one', async () => {
  const { fromPathbuilder } = await import('../src/pathbuilder.js');
  // Pathbuilder exports ["None selected"] for a sheet whose languages were never set,
  // which the Party sheet would otherwise list as a language the character speaks.
  const blank = fromPathbuilder({
    build: { name: 'Kali', class: 'Barbarian', level: 7, languages: ['None selected'] }
  });
  assert.deepEqual(blank.languages, []);

  const spoken = fromPathbuilder({
    build: { name: 'Kali', class: 'Barbarian', level: 7, languages: ['Common', 'Jotun'] }
  });
  assert.deepEqual(spoken.languages, ['Common', 'Jotun']);
});

test('alchemist extras survive the conversion, noise does not', async () => {
  const { fromPathbuilder } = await import('../src/pathbuilder.js');
  const c = fromPathbuilder({
    build: {
      name: 'Queek Blight-Tail', class: 'Alchemist', level: 7, keyability: 'int',
      abilities: { str: 12, dex: 18, con: 12, int: 19, wis: 10, cha: 14 },
      attributes: { ancestryhp: 6, classhp: 8, bonushp: 4, speed: 25, speedBonus: -5 },
      proficiencies: { fortitude: 4, reflex: 4, will: 4, perception: 2 },
      resistances: ['poison 3'],
      specificProficiencies: { trained: [], expert: ['Alchemical Bomb'], master: [] },
      familiars: [{ type: 'Familiar', name: 'Familiar (S. Queek)',
                    abilities: ['Touch Telepathy'] }],
      formula: [
        { type: 'Alchemist', known: ['Blight Bomb (Moderate)'] },
        { type: 'other', known: ['35bf6ba7-2a37-4f39-aab4-9d66be6aa9eb', 'Bottled Sunlight'] },
        { type: 'Empty', known: [] }
      ],
      weapons: [{ display: 'Alchemical Bomb', prof: 'martial', die: 'd0',
                  damageType: 'Varies' }],
      acTotal: { acTotal: 24 }
    }
  }, { group: 'mists-of-zalazar' });

  assert.equal(c.hp, 73);                       // 6 ancestry + 4 bonus + 7 x (8 + 1)
  assert.equal(c.speed, 20);                    // a negative speed bonus still applies
  assert.deepEqual(c.resistances, ['poison 3']);
  assert.deepEqual(c.specificProficiencies, [{ name: 'Alchemical Bomb', rank: 'expert' }]);
  assert.equal(c.familiars[0].name, 'Familiar (S. Queek)');

  // The raw uuid Pathbuilder leaves in "other" is dropped, and an empty book with it.
  assert.equal(c.formulas.length, 2);
  assert.deepEqual(c.formulas[1].known, ['Bottled Sunlight']);

  // "d0" is Pathbuilder's placeholder for a weapon with no fixed die.
  assert.equal(c.weapons[0].damage, 'Varies');
});

test('item bonuses reach saves and Perception, not just skills', async () => {
  const { fromPathbuilder } = await import('../src/pathbuilder.js');
  // Rhea Elmheart: +1 Resilient full plate puts an item bonus on all three saves.
  const c = fromPathbuilder({
    build: {
      name: 'Rhea Elmheart', class: 'Guardian', level: 7, keyability: 'str',
      abilities: { str: 18, dex: 10, con: 18, int: 10, wis: 16, cha: 12 },
      attributes: { ancestryhp: 8, classhp: 12, speed: 30, speedBonus: 5 },
      proficiencies: { perception: 4, fortitude: 4, reflex: 4, will: 4,
                       acrobatics: 2, athletics: 6 },
      mods: {
        Acrobatics: { 'Item Bonus': 1 }, Fortitude: { 'Item Bonus': 1 },
        Reflex: { 'Item Bonus': 1 }, Will: { 'Item Bonus': 1 }
      },
      acTotal: { acTotal: 28, shieldBonus: '2' }
    }
  }, { group: 'mists-of-zalazar' });

  assert.deepEqual(c.saves, { fort: 16, ref: 12, will: 15 });  // each +1 from Resilient
  assert.equal(c.perception, 14);                              // expert 11 + Wis 3, no item
  assert.equal(c.shieldBonus, 2);
  assert.equal(c.hp, 120);                                     // 8 + 7 x (12 + Con 4)

  const byName = Object.fromEntries(c.skills.map(s => [s.name, s.bonus]));
  assert.equal(byName.athletics, 17);                          // master 13 + Str 4
  assert.equal(byName.acrobatics, 10);                         // trained 9 + Dex 0 + item 1
});

test('prepared casters keep their slots, ranks and focus spells', async () => {
  const { fromPathbuilder } = await import('../src/pathbuilder.js');
  const c = fromPathbuilder({
    build: {
      name: 'Priscilla Cybin', class: 'Druid', level: 7, keyability: 'wis',
      gender: 'Not set', deity: 'Not set',
      abilities: { str: 10, dex: 16, con: 16, int: 10, wis: 19, cha: 14 },
      attributes: { ancestryhp: 8, classhp: 8, speed: 25, speedBonus: 5 },
      proficiencies: { perception: 4, fortitude: 4, reflex: 4, will: 4 },
      spellCasters: [{
        name: 'Druid', magicTradition: 'primal', spellcastingType: 'prepared',
        ability: 'wis', proficiency: 4, perDay: [5, 3, 3, 3, 2, 0, 0],
        spells: [{ spellLevel: 0, list: ['Guidance'] },
                 { spellLevel: 3, list: ['Fireball'] },
                 { spellLevel: 4, list: [] }]
      }],
      focus: { primal: { wis: { focusSpells: ['Mushroom Patch', 'Fungal Exhalation'],
                                focusCantrips: [] } } },
      focusPoints: 2,
      acTotal: { acTotal: 24, shieldBonus: '2' }
    }
  }, { group: 'mists-of-zalazar' });

  assert.equal(c.deity, null);            // "Not set" is not a deity
  assert.equal(c.gender, null);
  assert.equal(c.spellcasting[0].dc, 25); // 10 + expert 11 + Wis 4
  assert.equal(c.spellcasting[0].attack, 15);
  assert.deepEqual(c.spellcasting[0].slots,
    [{ rank: 0, count: 5 }, { rank: 1, count: 3 }, { rank: 2, count: 3 },
     { rank: 3, count: 3 }, { rank: 4, count: 2 }]);
  assert.equal(c.spellcasting[0].spells.length, 2);   // the empty rank 4 list is dropped
  assert.deepEqual(c.focusSpells, ['Mushroom Patch', 'Fungal Exhalation']);
  assert.equal(c.focusPoints, 2);
});

test('character wealth benchmarks match the published table', () => {
  assert.equal(pf2e.wealthFor(1), 15);
  assert.equal(pf2e.wealthFor(7), 720);
  assert.equal(pf2e.wealthFor(20), 112000);
  assert.equal(pf2e.wealthFor(25), 112000);   // clamps at 20
  assert.equal(pf2e.wealthFor(0), 15);
  assert.equal(pf2e.CHARACTER_CURRENCY[7], 125);
});

test('cumulative treasure sums the levels already played', () => {
  // Reaching 7th means levels 1-6 were played: 175+300+500+850+1350+2000 = 5175 for a
  // party of four, so 1293.75 each.
  assert.equal(pf2e.cumulativeTreasure(7, 4), 5175 / 4);
  // Budgets scale with party size and each level is rounded to whole gp, so a party of
  // five lands a shade off the exact quarter rather than on it.
  assert.equal(pf2e.cumulativeTreasure(7, 5), 1294);
  assert.equal(pf2e.cumulativeTreasure(1, 4), 0);   // nothing played yet
});

test('gear valuation prices runes and reports what it could not match', async () => {
  const { priceIndex, valueCharacter, lookup, toGp } = await import('../src/wealth.js');
  const index = priceIndex([
    { name: 'Greataxe', price: 200 },                    // 2 gp
    { name: 'Weapon Potency (+2)', price: 93500 },       // 935 gp
    { name: 'Striking', price: 6500 },                   // 65 gp
    { name: 'Hooked', price: 14000 },                    // 140 gp
    { name: 'Returning', price: 5500 },                  // 55 gp
    { name: 'Hide Armor', price: 200 },                  // 2 gp, reached via alias
    { name: "Explorer's Clothing", price: 1000 },        // 10 gp, reached by flipping
    { name: 'Lesser Aether Marbles', price: 1900 }       // 19 gp, reached by pluralising
  ]);

  assert.equal(lookup(index, 'Hide'), 200);                        // alias
  assert.equal(lookup(index, "Clothing (Explorer's)"), 1000);      // flipped
  assert.equal(lookup(index, 'Aether Marble (Lesser)'), 1900);     // flipped + plural
  assert.equal(lookup(index, 'Gleamslicer, bane of the sea'), null);

  const v = valueCharacter({
    equipment: [{ name: "Clothing (Explorer's)", qty: 1 },
                { name: 'Ceremonial dagger', qty: 1 }],
    weapons: [{ name: '+2 Striking Hooked Returning Greataxe', base: 'Greataxe',
                potency: 2, striking: 'striking', runes: ['Hooked', 'Returning'] }],
    armor: [{ name: 'Hide', base: 'Hide', potency: 0, runes: [] }],
    money: { gp: 100, sp: 5 }
  }, index);

  // 2 + 935 + 65 + 140 + 55 greataxe with runes, + 2 hide, + 10 clothing
  assert.equal(toGp(v.gear), 1209);
  assert.equal(toGp(v.coins), 100.5);
  assert.equal(toGp(v.total), 1309.5);
  // The homebrew dagger is named, not silently counted as zero.
  assert.deepEqual(v.unmatched, ['Ceremonial dagger']);
});

test('action costs render as icons, durations pass through', () => {
  assert.equal(pf2e.actionIcons('Single Action'), '◆');
  assert.equal(pf2e.actionIcons('Two Actions'), '◆◆');
  assert.equal(pf2e.actionIcons('Three Actions'), '◆◆◆');
  assert.equal(pf2e.actionIcons('Free Action'), '◇');
  assert.equal(pf2e.actionIcons('Reaction'), '⤾');
  // Compound forms keep their connecting words.
  assert.equal(pf2e.actionIcons('Single Action to Three Actions'), '◆ to ◆◆◆');
  assert.equal(pf2e.actionIcons('Two Actions or Three Actions'), '◆◆ or ◆◆◆');
  assert.equal(pf2e.actionIcons('Two Actions to 2 rounds'), '◆◆ to 2 rounds');
  // Casting times that are not action costs are left as written.
  assert.equal(pf2e.actionIcons('10 minutes'), '10 minutes');
  assert.equal(pf2e.actionIcons('1 hour'), '1 hour');
  assert.equal(pf2e.actionIcons(null), null);
});

test('a condition brings its knock-on conditions with it', () => {
  // Straight out of the Remaster condition text: prone is off-guard, grabbed is off-guard
  // and immobilized, and dying is unconscious — which is blinded, off-guard and prone.
  assert.deepEqual(pf2e.impliedConditions('Prone'), ['Off-Guard']);
  assert.deepEqual(pf2e.impliedConditions('Grabbed'), ['Off-Guard', 'Immobilized']);
  assert.deepEqual(pf2e.impliedConditions('Restrained'), ['Off-Guard', 'Immobilized']);
  assert.deepEqual(pf2e.impliedConditions('Unconscious'), ['Blinded', 'Off-Guard', 'Prone']);
  assert.deepEqual(pf2e.impliedConditions('Dying'),
    ['Unconscious', 'Blinded', 'Off-Guard', 'Prone']);

  // Off-guard is where the chains end, and most conditions start nothing.
  assert.deepEqual(pf2e.impliedConditions('Off-Guard'), []);
  assert.deepEqual(pf2e.impliedConditions('Frightened'), []);
  assert.deepEqual(pf2e.impliedConditions('Persistent Damage'), []);
  assert.deepEqual(pf2e.impliedConditions('Not A Condition'), []);

  // Everything implied is something the picker can also apply on its own.
  for (const [cond, also] of Object.entries(pf2e.IMPLIED_CONDITIONS)) {
    for (const name of also) {
      assert.ok(pf2e.CONDITIONS.includes(name), `${cond} implies unlistable ${name}`);
    }
  }
});

test('persistent damage offers the types an ongoing effect can deal', () => {
  const types = pf2e.PERSISTENT_DAMAGE_TYPES;
  assert.equal(types[0], 'Bleed');                       // by far the commonest
  for (const energy of ['Acid', 'Cold', 'Electricity', 'Fire', 'Force', 'Sonic',
    'Vitality', 'Void']) {
    assert.ok(types.includes(energy), `missing energy type ${energy}`);
  }
  assert.ok(!types.includes('Precision'));               // never persistent
  assert.equal(new Set(types).size, types.length);
});

// --- checks ------------------------------------------------------------------

test('ten over the DC is a critical success and ten under a critical failure', () => {
  const d = (total, dc) => pf2e.DEGREES[pf2e.degreeOfSuccess(total, dc)];
  assert.equal(d(25, 25), 'success');
  assert.equal(d(24, 25), 'failure');
  assert.equal(d(35, 25), 'critical success');
  assert.equal(d(34, 25), 'success');
  assert.equal(d(15, 25), 'critical failure');
  assert.equal(d(16, 25), 'failure');
});

test('a natural 20 shifts the degree one step up and a natural 1 one step down', () => {
  const d = (total, dc, nat) => pf2e.DEGREES[pf2e.degreeOfSuccess(total, dc, nat)];
  assert.equal(d(25, 25, 20), 'critical success');   // success -> critical
  assert.equal(d(40, 25, 1), 'success');             // critical -> success
  assert.equal(d(24, 25, 1), 'critical failure');    // failure -> critical failure
  // A shift cannot run off either end.
  assert.equal(d(10, 25, 1), 'critical failure');
  assert.equal(d(45, 25, 20), 'critical success');
});

test('a natural 20 that misses by nine is still only a failure', () => {
  // The shift applies after the bands, not instead of them. Getting this backwards turns
  // every natural 20 into a critical hit, which is a different game.
  assert.equal(pf2e.DEGREES[pf2e.degreeOfSuccess(16, 25, 20)], 'success');
  assert.equal(pf2e.DEGREES[pf2e.degreeOfSuccess(14, 25, 20)], 'failure');
});

test('the multiple attack penalty is minus five then minus ten', () => {
  assert.equal(pf2e.mapPenalty(0), 0);
  assert.equal(pf2e.mapPenalty(1), -5);
  assert.equal(pf2e.mapPenalty(2), -10);
  assert.equal(pf2e.mapPenalty(3), -10);            // a fourth attack is no worse
});

test('an agile weapon takes minus four then minus eight instead', () => {
  assert.equal(pf2e.mapPenalty(1, { agile: true }), -4);
  assert.equal(pf2e.mapPenalty(2, { agile: true }), -8);
});

// --- conditions --------------------------------------------------------------

test('a tracker chip splits into its name, its value and its note', () => {
  assert.deepEqual(pf2e.parseCondition('Frightened 2'),
    { name: 'Frightened', value: 2, note: null });
  assert.deepEqual(pf2e.parseCondition('Persistent Damage (fire)'),
    { name: 'Persistent Damage', value: null, note: 'fire' });
  assert.deepEqual(pf2e.parseCondition('Prone'), { name: 'Prone', value: null, note: null });
});

test('frightened 2 is minus two to attacks, AC, saves and DCs alike', () => {
  const m = pf2e.conditionModifiers(['Frightened 2']);
  assert.equal(m.attack, -2);
  assert.equal(m.ac, -2);
  assert.equal(m.will, -2);
  assert.equal(m.dc, -2);
});

test('status penalties do not stack — the worse frightened wins', () => {
  // Two sources of the same status penalty give the worse of the two, not their sum.
  assert.equal(pf2e.conditionModifiers(['Frightened 2', 'Frightened 1']).attack, -2);
  // Sickened is a status penalty too, so it does not add to frightened either.
  assert.equal(pf2e.conditionModifiers(['Frightened 2', 'Sickened 1']).attack, -2);
});

test('off-guard and frightened do stack, because they are different types', () => {
  // Circumstance and status are separate buckets. Summing everything would overstate
  // exactly what stacking debuffs is supposed to be worth.
  const m = pf2e.conditionModifiers(['Frightened 2', 'Off-Guard']);
  assert.equal(m.ac, -4);          // -2 status, -2 circumstance
  assert.equal(m.attack, -2);      // off-guard does nothing to the target's own attacks
});

test('prone costs two on attacks and off-guard costs two AC', () => {
  assert.equal(pf2e.conditionModifiers(['Prone']).attack, -2);
  assert.equal(pf2e.conditionModifiers(['Off-Guard']).ac, -2);
});

test('slowed takes actions away and paralysed takes the whole turn', () => {
  assert.equal(pf2e.conditionModifiers([]).actions, 3);
  assert.equal(pf2e.conditionModifiers(['Slowed 1']).actions, 2);
  assert.equal(pf2e.conditionModifiers(['Stunned 2']).actions, 1);
  assert.equal(pf2e.conditionModifiers(['Slowed 1', 'Stunned 2']).actions, 1);  // worst wins
  assert.equal(pf2e.conditionModifiers(['Paralyzed']).canAct, false);
  assert.equal(pf2e.conditionModifiers(['Paralyzed']).actions, 0);
});

test('a condition the table does not model is ignored rather than throwing', () => {
  assert.equal(pf2e.conditionModifiers(['Grabbed', 'Dazzled', 'Nonsense 4']).attack, 0);
});

test('conditionName and conditionValue round-trip through withConditionValue', () => {
  // The normal case: a valued chip built by the picker reads back the same value.
  assert.equal(pf2e.conditionName(pf2e.withConditionValue('Frightened', 2)), 'Frightened');
  assert.equal(pf2e.conditionValue(pf2e.withConditionValue('Frightened', 2)), 2);
  // A null or zero value collapses to the bare name, same as a condition with none at all.
  assert.equal(pf2e.withConditionValue('Prone', null), 'Prone');
  assert.equal(pf2e.withConditionValue('Prone', 0), 'Prone');
  assert.equal(pf2e.conditionValue(pf2e.withConditionValue('Prone', null)), null);
  // A persistent-damage chip's parenthetical is not a value — the name still resolves
  // past it, and asking for its value gives null rather than misreading the note.
  assert.equal(pf2e.conditionName('Persistent Damage (fire)'), 'Persistent Damage');
  assert.equal(pf2e.conditionValue('Persistent Damage (fire)'), null);
});

test('takesValue names exactly the conditions whose chip carries a number', () => {
  assert.equal(pf2e.takesValue('Frightened'), true);
  assert.equal(pf2e.takesValue('Clumsy'), true);
  // Persistent Damage carries a damage type, not a value, and already has its own step.
  assert.equal(pf2e.takesValue('Persistent Damage'), false);
  assert.equal(pf2e.takesValue('Prone'), false);
  for (const name of pf2e.VALUED_CONDITIONS) {
    assert.ok(pf2e.CONDITIONS.includes(name), `${name} is not a listed condition`);
  }
});

test('frightened decreases by 1 at the end of the turn and ends at 0', () => {
  const three = pf2e.endOfTurnConditions(['Frightened 3']);
  assert.deepEqual(three.conditions, ['Frightened 2']);
  assert.deepEqual(three.ticked, ['Frightened 3 → 2']);
  assert.deepEqual(three.reminders, []);

  const one = pf2e.endOfTurnConditions(['Frightened 1']);
  assert.deepEqual(one.conditions, []);
  assert.deepEqual(one.ticked, ['Frightened ended']);

  // A valueless Frightened is a chip from before values existed — treated as Frightened 1,
  // so it ends rather than silently surviving forever.
  const bare = pf2e.endOfTurnConditions(['Frightened']);
  assert.deepEqual(bare.conditions, []);
  assert.deepEqual(bare.ticked, ['Frightened ended']);
});

test('no other condition is decremented at end of turn, valued or not', () => {
  // This is the assertion that stops someone "improving" this into decrementing
  // everything with a number: Clumsy, Stunned, Slowed and Wounded are untouched. Stunned
  // and Slowed in particular reduce actions at the *start* of a turn, and Stunned's own
  // decrease is by however many actions were actually lost — a number only the GM knows.
  const list = ['Clumsy 1', 'Stunned 2', 'Slowed 1', 'Wounded 3'];
  const result = pf2e.endOfTurnConditions(list);
  assert.deepEqual(result.conditions, list);
  assert.deepEqual(result.ticked, []);
  assert.deepEqual(result.reminders, []);
});

test('persistent damage produces a reminder and is never rolled or altered by the app', () => {
  const result = pf2e.endOfTurnConditions(['Persistent Damage (fire)']);
  // The chip itself is untouched — the app does not roll the flat check or apply damage.
  assert.deepEqual(result.conditions, ['Persistent Damage (fire)']);
  assert.deepEqual(result.ticked, []);
  assert.equal(result.reminders.length, 1);
  assert.match(result.reminders[0], /fire/);
  assert.match(result.reminders[0], /DC 15 flat check/);
});

test('a combatant with no conditions comes back unchanged with nothing to report', () => {
  assert.deepEqual(pf2e.endOfTurnConditions([]), { conditions: [], ticked: [], reminders: [] });
  assert.deepEqual(pf2e.endOfTurnConditions(undefined), { conditions: [], ticked: [], reminders: [] });
});

// --- damage ------------------------------------------------------------------

test('a damage expression parses its dice, its bonus and its type', () => {
  const { clauses } = pf2e.parseDamage('3d12+15 piercing');
  assert.equal(clauses.length, 1);
  assert.deepEqual(
    { count: clauses[0].count, faces: clauses[0].faces, bonus: clauses[0].bonus, type: clauses[0].type },
    { count: 3, faces: 12, bonus: 15, type: 'piercing' });
});

test('a second damage clause is its own clause, not a rider', () => {
  const { clauses, rider } = pf2e.parseDamage('3d12+15 piercing plus 2d6 fire');
  assert.equal(clauses.length, 2);
  assert.equal(clauses[1].type, 'fire');
  assert.equal(rider, null);
});

test('a negative damage bonus written as an en dash is still a penalty', () => {
  // Mitflit's shortsword. AoN writes this with U+2013; a hyphen-only regex reads it as a
  // clean 1d6 and drops the penalty silently.
  const { clauses } = pf2e.parseDamage('1d6–1 piercing');
  assert.equal(clauses[0].bonus, -1);
  assert.equal(clauses[0].type, 'piercing');
});

test('a plus rider stays out of the numbers and out of the damage type', () => {
  const { clauses, rider } = pf2e.parseDamage('2d6+8 plus sticky paint');
  assert.equal(clauses.length, 1);
  assert.equal(clauses[0].type, null);   // "sticky" is not a damage type
  assert.equal(rider, 'sticky paint');
});

test('a strike whose damage is an effect yields no dice at all', () => {
  const { clauses, rider } = pf2e.parseDamage('attach');
  assert.deepEqual(clauses, []);
  assert.equal(rider, 'attach');
});

test('a choice of damage type records all three', () => {
  const { clauses } = pf2e.parseDamage('1d6+3 bludgeoning, piercing, or slashing');
  assert.deepEqual(clauses[0].types, ['bludgeoning', 'piercing', 'slashing']);
  assert.equal(clauses[0].type, 'bludgeoning');
});

test('negative damage reads as void and positive as vitality', () => {
  // Both spellings are still in the data: older creature entries and Pathbuilder exports.
  assert.equal(pf2e.parseDamage('4d8 negative').clauses[0].type, 'void');
  assert.equal(pf2e.parseDamage('1d6 positive').clauses[0].type, 'vitality');
});

test('average damage is the mean of the dice plus the bonus', () => {
  assert.equal(pf2e.averageDamage(pf2e.parseDamage('2d6+4')), 11);
  assert.equal(pf2e.averageDamage(pf2e.parseDamage('1d8')), 4.5);
  assert.equal(pf2e.averageDamage(pf2e.parseDamage('attach')), 0);
});

test('a critical hit doubles the whole roll, modifier included', () => {
  const flat = () => 0.999;                       // every die comes up its maximum
  const parsed = pf2e.parseDamage('2d6+4 slashing');
  assert.equal(pf2e.rollDamage(parsed, { random: flat }).total, 16);
  assert.equal(pf2e.rollDamage(parsed, { random: flat, critical: true }).total, 32);
});

test('immunities apply first, then weaknesses, then resistances', () => {
  // Player Core's order. Immunity removes the type outright, before anything else runs.
  assert.deepEqual(pf2e.applyDamage({ fire: 20 }, { immunities: ['fire'], weaknesses: { fire: 10 } }),
    { total: 0, byType: {}, blocked: 20 });
  // Weakness adds before resistance subtracts.
  assert.equal(pf2e.applyDamage({ fire: 10 }, { weaknesses: { fire: 5 }, resistances: { fire: 3 } }).total, 12);
  assert.equal(pf2e.applyDamage({ slashing: 20 }, { resistances: { slashing: 5 } }).total, 15);
});

test('resistance cannot take a damage type below zero', () => {
  const out = pf2e.applyDamage({ cold: 3 }, { resistances: { cold: 10 } });
  assert.equal(out.total, 0);
  assert.deepEqual(out.byType, {});
});

test('what the defences absorbed is reported, and a weakness never reads as blocked', () => {
  assert.equal(pf2e.applyDamage({ slashing: 20 }, { resistances: { slashing: 5 } }).blocked, 5);
  // A weakness raises the damage; counting the shortfall would make blocked negative.
  assert.equal(pf2e.applyDamage({ fire: 20 }, { weaknesses: { fire: 10 } }).blocked, 0);
});

test('an immunity written with AoN’s doubled space still matches', () => {
  // The index emits "death  effects" and "nonlethal  attacks" with two spaces.
  assert.equal(pf2e.applyDamage({ 'death effects': 9 },
    { immunities: ['death  effects'] }).total, 0);
});

test('immunity to a condition stops it being applied at all', () => {
  const skeleton = { immunities: ['mental', 'paralyzed'], traits: ['Undead'] };
  assert.equal(pf2e.immuneTo(skeleton, 'mental'), true);
  assert.equal(pf2e.immuneTo(skeleton, 'prone'), false);
  // Demoralize checks several traits at once and any one of them is enough.
  assert.equal(pf2e.immuneTo(skeleton, 'fear', 'emotion', 'mental'), true);
});

test('a mindless creature cannot be demoralised even with no immunity listed', () => {
  // No stat block spells this out as an immunity line, but a skeleton has no mind to work
  // on and Demoralize is a mental effect.
  const golem = { traits: ['Construct', 'Mindless'], immunities: [] };
  assert.equal(pf2e.immuneTo(golem, 'mental'), true);
  assert.equal(pf2e.immuneTo(golem, 'fear'), true);
  assert.equal(pf2e.immuneTo(golem, 'fire'), false);
  assert.equal(pf2e.immuneTo({ traits: ['Humanoid'] }, 'mental'), false);
});

// --- persistent damage and dying ---------------------------------------------

test('persistent damage rolls again until the DC 15 flat check ends it', () => {
  // 0.1 -> a d20 face of 3, which fails; 0.9 -> 19, which passes.
  const low = () => 0.1;
  const high = () => 0.9;
  assert.equal(pf2e.persistentTick('2d6 fire', { random: low }).ends, false);
  assert.equal(pf2e.persistentTick('2d6 fire', { random: high }).ends, true);
  assert.ok(pf2e.persistentTick('2d6 fire', { random: low }).total > 0);
});

test('a dying creature dies at dying 4, and a critical hit gets it there faster', () => {
  assert.deepEqual(pf2e.dyingAfterDamage({ dying: 0, wounded: 0 }),
    { dying: 1, wounded: 0, dead: false });
  // Wounded 1 means you start a step further along.
  assert.equal(pf2e.dyingAfterDamage({ dying: 0, wounded: 1 }).dying, 2);
  assert.equal(pf2e.dyingAfterDamage({ dying: 0, wounded: 0, critical: true }).dying, 2);
  assert.equal(pf2e.dyingAfterDamage({ dying: 3, wounded: 0 }).dead, true);
});

test('a recovery check wakes you on a success and kills you on enough failures', () => {
  const high = () => 0.9;                     // natural 19: beats DC 11
  const low = () => 0.0;                      // natural 1: critical failure, +2 dying
  assert.equal(pf2e.recoveryCheck({ dying: 1, random: high }).conscious, true);
  assert.equal(pf2e.recoveryCheck({ dying: 1, random: high }).wounded, 1);
  assert.equal(pf2e.recoveryCheck({ dying: 2, random: low }).dead, true);
});

// --- randomness ---------------------------------------------------------------

test('the same seed produces the same sequence twice, and a different seed does not', () => {
  const take = seed => Array.from({ length: 5 }, pf2e.rng(seed));
  assert.deepEqual(take(42), take(42));
  assert.notDeepEqual(take(42), take(43));
  // And it behaves like Math.random: [0, 1).
  assert.ok(Array.from({ length: 200 }, pf2e.rng(7)).every(n => n >= 0 && n < 1));
});
