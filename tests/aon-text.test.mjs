// Tests for the Archives of Nethys document reader: node --test tests/
//
// The fixtures are trimmed copies of real `markdown` fields from the Elasticsearch index
// (elasticsearch.aonprd.com), which is what tools/fetch-codex.mjs reads.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fromMarkdown, bodyText, headerPairs, sections, nameMatch,
  creatureStrikes, creatureAbilities, creatureOffence
} from '../tools/aon-text.mjs';

const FEAT = `<title
    level="1"
    right="Feat 4"
    pfs="Standard"
>
[Rescuer's Press](/Feats.aspx?ID=2167) <actions string="" />
</title>

<traits>
<trait label="Rare" url="/Traits.aspx?ID=137" />
<trait label="Archetype" url="/Traits.aspx?ID=12" />
</traits>

<column gap="tiny">

**Source** [Legends](/Sources.aspx?ID=40) pg. 68

**Archetype** [Lastwall Sentry](/Archetypes.aspx?ID=15)

**Prerequisites**
[Lastwall Sentry Dedication](/Feats.aspx?ID=882)

</column>

---

Any shield you wield gains the [shove](/Traits.aspx?ID=193) trait. When you [Shove](/Actions.aspx?ID=38) using a shield and Stride as part of that action, you can move an additional 5 feet.

<title level="2">Knights in Training</title>

**Source** [Legends](/Sources.aspx?ID=40) pg. 68

The following feats represent benefits of training from the Iomedars.

**Related Feats**: [Shall Not Falter, Shall Not Rout](/Feats.aspx?ID=2168)`;

const CLASS_FEATURE = `<title level="1" right="Class Feature 1">[Guardian's Techniques](/Classes.aspx?ID=67)</title>

<column gap="tiny">
**Source** [Battlecry!](/Sources.aspx?ID=268) pg. 37

**Class** Guardian
</column>

---

As a guardian, you have learned certain techniques to help keep your allies safe.

<title level="3" right="">Ever Ready</title>You always gain a reaction whenever you roll initiative for combat, but you can use it only for reactions from guardian feats.

<title level="3" right="">Intercept Attack</title> You gain the Intercept Attack reaction.

<document level="2" id="action-3305" />`;

const WEAPON = `<title level="1" right="Weapon 0" pfs="Standard">
[Breaching Pike](/Weapons.aspx?ID=274)
</title>

<traits>
<trait label="Razing" url="/Traits.aspx?ID=488" />
</traits>

<column gap="tiny">

**Source** [Treasure Vault (Remastered)](/Sources.aspx?ID=191) pg. 26, [Player Core 2](/Sources.aspx?ID=227) pg. 274

<row gap="medium">
**Price** 8 gp

**Damage** 1d6 P

**Bulk** 1
</row>

<row gap="medium">
**Type** Melee

**Category** Martial

**Group** [Spear](/WeaponGroups.aspx?ID=14)
</row>

</column>

---

Forged with a heavy metal wedge as a spearhead.

<title level="2">Critical Specialization Effects</title>

Certain feats can grant you additional benefits.`;

// A heritage: no rule, no column, the stat block is a loose paragraph.
const HERITAGE = `<title level="1" right="Heritage" pfs="Standard">[Fleetwind Centaur](/Heritages.aspx?ID=293)</title>

<traits>

</traits>

**Source** [Howl of the Wild](/Sources.aspx?ID=226) pg. 30

You're sleek of frame and capable of reaching incredible speeds on hooves alone. Your Speed increases by 5 feet.`;

const LIST = `<title level="1" right="Class Feature 1">[Kinetic Gate](/Classes.aspx?ID=23)</title>

<column gap="tiny">
**Source** [Rage of Elements](/Sources.aspx?ID=205) pg. 13
</column>

---

You've awakened a kinetic gate.

<title level="3" right="">Single Gate</title> Choose one element to be your kinetic element.
<ul><li>**Air** You can either Stride up to half your Speed or Step.</li><li>**Earth** Fragments of stone float around you.</li></ul>`;

test('a feat keeps its prose and loses the citation and the appended boilerplate', () => {
  const { text, stats } = fromMarkdown(FEAT, { drop: ['Prerequisites'] });
  assert.match(text, /^Any shield you wield gains the shove trait\./);
  assert.doesNotMatch(text, /Knights in Training|Related Feats|pg\. 68|Source/);
  // Links are flattened, not dropped: the feat still names the stance it references.
  assert.match(text, /you can move an additional 5 feet\.$/);
  assert.deepEqual(stats, [{ label: 'Archetype', value: 'Lastwall Sentry' }]);
});

test('stat-block pairs the index has no field for survive, in page order', () => {
  const { stats } = fromMarkdown(WEAPON, { drop: ['Price', 'Bulk'] });
  assert.deepEqual(stats, [
    { label: 'Damage', value: '1d6 P' },
    { label: 'Type', value: 'Melee' },
    { label: 'Category', value: 'Martial' },
    { label: 'Group', value: 'Spear' }
  ]);
  assert.equal(fromMarkdown(WEAPON).text, 'Forged with a heavy metal wedge as a spearhead.');
});

test('sub-headings become "## " and paragraphs stay separated', () => {
  const text = fromMarkdown(CLASS_FEATURE).text;
  assert.equal(text, [
    'As a guardian, you have learned certain techniques to help keep your allies safe.',
    '## Ever Ready',
    'You always gain a reaction whenever you roll initiative for combat, but you can use ' +
      'it only for reactions from guardian feats.',
    '## Intercept Attack',
    'You gain the Intercept Attack reaction.'
  ].join('\n\n'));
});

test('sub-features are recoverable as sections of the page that describes them', () => {
  const found = sections(fromMarkdown(CLASS_FEATURE).text);
  assert.deepEqual(found.map(s => s.name), ['Ever Ready', 'Intercept Attack']);
  assert.match(found[0].text, /^You always gain a reaction/);
});

test('a page with its sub-features at level 2 needs cutAt 1 to reach them', () => {
  // Cutting at level 2 is right for display — it is where the boilerplate starts — but
  // an alchemist research field files "Field Vials" at that level.
  const md = FEAT.replace('<title level="2">Knights in Training</title>',
    '<title level="2" right="Level 1">Field Vials</title>');
  assert.deepEqual(sections(fromMarkdown(md).text).map(s => s.name), []);
  assert.deepEqual(sections(fromMarkdown(md, { cutAt: 1 }).text).map(s => s.name),
    ['Field Vials']);
});

test('bold lead-ins are sections only when asked for', () => {
  const text = fromMarkdown(LIST).text;
  assert.match(text, /\n- \*\*Air\*\* You can either Stride/);
  assert.deepEqual(sections(text).map(s => s.name), ['Single Gate']);
  assert.deepEqual(sections(text, { bold: true }).map(s => s.name),
    ['Single Gate', 'Air', 'Earth']);
});

test('an inline action cost survives as its icon', () => {
  const md = `<title level="1" right="Spell 1">[Heal](/Spells.aspx?ID=1)</title>

---

You channel vital energy.

 <actions string="Single Action" /> The spell has a range of touch.<br /> <actions string="Two Actions" /> The spell has a range of 30 feet.`;

  assert.equal(fromMarkdown(md).text, [
    'You channel vital energy.',
    '**◆** The spell has a range of touch.\n**◆◆** The spell has a range of 30 feet.'
  ].join('\n\n'));
});

test('an entry with no rule still separates its stat block from its prose', () => {
  const { text, stats } = fromMarkdown(HERITAGE);
  assert.equal(text, "You're sleek of frame and capable of reaching incredible speeds " +
    'on hooves alone. Your Speed increases by 5 feet.');
  assert.deepEqual(stats, []);
  assert.deepEqual(headerPairs('**Source** [Howl of the Wild](/Sources.aspx?ID=226) pg. 30'),
    [{ label: 'Source', value: 'Howl of the Wild pg. 30' }]);
});

test('markdown that is missing entirely is not an error', () => {
  assert.deepEqual(fromMarkdown(null), { text: null, stats: [] });
  assert.deepEqual(sections(null), []);
});

test('sheet names reach the entry they mean, and no further', () => {
  assert.equal(nameMatch('Shield Block', 'Shield Block'), 'exact');
  assert.equal(nameMatch("Rescuer's Press", 'Rescuers Press'), 'exact');

  // Pathbuilder drops the archetype and the item's noun.
  assert.equal(nameMatch('Sentry Dedication', 'Lastwall Sentry Dedication'), 'longer');
  assert.equal(nameMatch('Reinforcing (Lesser)', 'Reinforcing Rune (Lesser)'), 'longer');
  assert.equal(nameMatch('Cognitive Crossover', "Kreighton's Cognitive Crossover"), 'longer');
  assert.equal(nameMatch('Fire', 'Fire Shield'), null);        // one word is too little to go on
  assert.equal(nameMatch('Shield Block', 'Reactive Shield Block Stance Master'), null);

  // A one-character difference in one word of several, and no more than that.
  assert.equal(nameMatch('Repulse the Wicked', 'Repulse the Wicken'), 'spelling');
  assert.equal(nameMatch('Lesser Aether Marble', 'Lesser Aether Marbles'), 'spelling');
  assert.equal(nameMatch('Ray of Frost', 'Ray of Rest'), null);
  assert.equal(nameMatch('Shovel', 'Shove'), null);        // a one-word name is all there is
  assert.equal(nameMatch('Bite', 'Kite'), null);
  assert.equal(nameMatch('Bane', 'Bless'), null);

  // The sheet appended what the thing is.
  assert.equal(nameMatch('Spore Order', 'Spore', 'druidic-order'), 'category');
  assert.equal(nameMatch('Spore Order', 'Spore', 'feat'), null);
});

// --- creature stat blocks ----------------------------------------------------
// Trimmed from the real `markdown` of the creatures named. Every awkward shape below was
// found by running the parser over a 600-creature sample, not invented.

const DRAGON = `**AC** 37; **Fort** +30, **Ref** +27, **Will** +33

**Melee**
<actions string="Single Action" />
jaws +29 ([Fire](/Traits.aspx?ID=72), [Magical](/Traits.aspx?ID=103), [reach 15 feet](/Traits.aspx?ID=192)),
**Damage** 3d12+15 piercing plus 2d6 fire

**Melee**
<actions string="Single Action" />
claw +29 ([Agile](/Traits.aspx?ID=170), [Magical](/Traits.aspx?ID=103), [reach 10 feet](/Traits.aspx?ID=192)),
**Damage** 3d10+15 slashing

**Melee**
<actions string="Single Action" />
tail +27 ([Magical](/Traits.aspx?ID=103), [reach 20 feet](/Traits.aspx?ID=192)),
**Damage** 3d12+13 slashing

**Breath Weapon ** <actions string="Two Actions" /> ([Arcane](/Traits.aspx?ID=11), [Evocation](/Traits.aspx?ID=65), [Fire](/Traits.aspx?ID=72)) The dragon breathes a blast of flame that deals 15d6 fire damage in a 50-foot cone (DC 36 basic Reflex save). It can't use Breath Weapon again for 1d4 rounds.

**Draconic Frenzy** <actions string="Two Actions" />  The dragon makes two claw Strikes and one wing Strike in any order.

**Draconic Momentum**   The dragon recharges its Breath Weapon whenever it scores a critical hit with a Strike.

</column>

<aside>
<title level="2">Red Dragon Spellcasters</title>

**Young Red Dragon**<br />**Arcane Prepared Spells** DC 29, attack +23

**Sneak Attack** <actions string="Single Action" /> The impostor deals 2d6 precision damage.
</aside>`;

test('a creature strike parses its name, attack bonus, traits and damage', () => {
  const [jaws] = creatureStrikes(DRAGON);
  assert.equal(jaws.name, 'jaws');
  assert.equal(jaws.kind, 'melee');
  assert.equal(jaws.bonus, 29);
  assert.equal(jaws.damage, '3d12+15 piercing plus 2d6 fire');
  assert.equal(jaws.actions, 'Single Action');
});

test('strikes come back in stat-block order, not sorted by bonus', () => {
  // The index's own attack_bonus array for this dragon is [27,27,29,29] and its
  // strike_damage_average is [24,31,32,41] — both sorted ascending. Zipping those two
  // would invent a +27 wing attack dealing 41 damage, which is why the markdown is the
  // only source the generator reads.
  assert.deepEqual(creatureStrikes(DRAGON).map(s => `${s.name} +${s.bonus}`),
    ['jaws +29', 'claw +29', 'tail +27']);
});

test('strike traits keep their values, so reach 15 feet is not just reach', () => {
  const [jaws, claw] = creatureStrikes(DRAGON);
  assert.deepEqual(jaws.traits, ['fire', 'magical', 'reach 15 feet']);
  // agile is what drives the -4/-8 multiple attack penalty rather than -5/-10.
  assert.ok(claw.traits.includes('agile'));
});

test('an offensive ability is only kept when it costs an action', () => {
  const names = creatureAbilities(DRAGON).map(a => a.name);
  assert.ok(names.includes('Breath Weapon'));       // has an <actions> tag
  assert.ok(names.includes('Draconic Frenzy'));     // has one, but no damage to read
  // Draconic Momentum is a passive note written in exactly the same shape. Without the
  // tag filter a simulator reads it, and Sneak Attack, as free damage every turn.
  assert.ok(!names.includes('Draconic Momentum'));
  assert.ok(!names.includes('Sneak Attack'));
});

test('a breath weapon keeps its save, its DC and how long until it recharges', () => {
  const breath = creatureAbilities(DRAGON).find(a => a.name === 'Breath Weapon');
  assert.equal(breath.damage, '15d6 fire');
  assert.equal(breath.dc, 36);
  assert.equal(breath.save, 'ref');        // keyed as creature.saves is: fort/ref/will
  assert.equal(breath.basic, true);
  assert.equal(breath.recharge, '1d4');
  assert.deepEqual(breath.traits, ['arcane', 'evocation', 'fire']);
});

test('the variant boxes below a stat block are not read as part of it', () => {
  // A dragon page ends with a "Red Dragon Spellcasters" <aside> whose bold labels look
  // exactly like ability blocks.
  assert.ok(!creatureAbilities(DRAGON).some(a => a.name === 'Sneak Attack'));
});

test('a negative damage bonus written as an en dash is still a penalty', () => {
  // Mitflit. AoN writes this as U+2013, and roll() only understands [+-], so a dash left
  // alone parses as a clean 1d6 with the -1 silently dropped. 57 of 1,084 strikes in a
  // 600-creature sample are written this way.
  const md = '**AC** 16\n\n**Melee**\n<actions string="Single Action" />\n'
    + 'shortsword +8 ([Agile](/Traits.aspx?ID=170)),\n**Damage** 1d6–1 piercing';
  assert.equal(creatureStrikes(md)[0].damage, '1d6-1 piercing');
});

test('a strike with no actions tag is still a strike', () => {
  // Petitioner writes the whole thing on one line with no <actions> at all.
  const md = '**AC** 18\n\n**Melee** fist +7, **Damage** 1d8+2 bludgeoning <br />**Abyss**';
  const [fist] = creatureStrikes(md);
  assert.equal(fist.name, 'fist');
  assert.equal(fist.bonus, 7);
  assert.equal(fist.damage, '1d8+2 bludgeoning');   // the <br /> ends the clause
  assert.equal(fist.actions, null);
});

test('a strike whose damage is an effect keeps the effect rather than inventing dice', () => {
  const md = '**AC** 15\n\n**Melee**\n<actions string="Single Action" />\n'
    + 'barbed leg +8 ([Finesse](/Traits.aspx?ID=171)),\n**Damage** attach';
  assert.equal(creatureStrikes(md)[0].damage, 'attach');
});

test('a strike with no damage type keeps the expression and claims no type', () => {
  // The javelin case: AoN simply omits the type on some Strikes. Guessing "piercing"
  // from the weapon name would apply the wrong weakness.
  const md = '**AC** 20\n\n**Ranged**\n<actions string="Single Action" />\n'
    + 'javelin +13 ([thrown 30 feet](/Traits.aspx?ID=711)),\n**Damage** 2d6+8 plus sticky paint';
  const [j] = creatureStrikes(md);
  assert.equal(j.kind, 'ranged');
  assert.equal(j.damage, '2d6+8 plus sticky paint');
  assert.deepEqual(j.traits, ['thrown 30 feet']);
});

test('a plus rider stays in the damage text rather than being dropped', () => {
  const md = '**AC** 24\n\n**Melee**\n<actions string="Single Action" />\n'
    + 'horn +20,\n**Damage** 2d10+9 piercing plus [Knockdown](/MonsterAbilities.aspx?ID=46)';
  assert.equal(creatureStrikes(md)[0].damage, '2d10+9 piercing plus Knockdown');
});

test('a creature with no melee or ranged line has no strikes', () => {
  assert.deepEqual(creatureStrikes('**AC** 14\n\n**Fort** +5'), []);
  assert.deepEqual(creatureOffence(null), { strikes: [], abilities: [] });
  assert.deepEqual(creatureOffence('').strikes, []);
});

test('creatureOffence returns both halves at once', () => {
  const both = creatureOffence(DRAGON);
  assert.equal(both.strikes.length, 3);
  assert.equal(both.abilities.length, 2);
});
