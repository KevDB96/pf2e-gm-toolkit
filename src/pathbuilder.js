// Convert a Pathbuilder 2e JSON export into the character shape this app stores.
//
// Pure: no DOM, no storage, no fetch — so both the browser importer in
// src/views/party.js and the CLI tool in tools/import-pathbuilder.mjs use exactly this
// code, and the maths is covered by the test suite.
//
// Derived numbers come from src/pf2e.js. Weapon attack bonuses are deliberately NOT
// derived: the export's `attack` and `damageBonus` fields do not decompose reliably
// into a to-hit, and a wrong attack bonus at the table is worse than none.

import {
  abilityMod, proficiencyBonus, proficiencyName, maxHP, SKILL_ABILITY
} from './pf2e.js';

const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Pathbuilder writes a literal placeholder for an optional field left blank: "Not set"
// for a single value, "None selected" for a list that was never filled in. Both are
// placeholders rather than content — a sheet listing "None selected" under Languages is
// what put the second one here.
const PLACEHOLDERS = new Set(['not set', 'none selected']);
const clean = s => {
  if (typeof s !== 'string') return null;
  const t = s.replace(/\s+/g, ' ').trim();
  return !t || PLACEHOLDERS.has(t.toLowerCase()) ? null : t;
};

/** Pathbuilder wraps the character in { success, build }. Accept either shape. */
export function unwrap(json) {
  const build = json?.build || json;
  if (!build || !build.name) {
    throw new Error('That does not look like a Pathbuilder export — no build.name found.');
  }
  return build;
}

export function fromPathbuilder(json, { group = 'unfiled', player = null } = {}) {
  const build = unwrap(json);
  const level = Number(build.level) || 1;
  const a = build.abilities || {};
  const mods = {
    str: abilityMod(a.str), dex: abilityMod(a.dex), con: abilityMod(a.con),
    int: abilityMod(a.int), wis: abilityMod(a.wis), cha: abilityMod(a.cha)
  };
  const prof = build.proficiencies || {};
  const attrs = build.attributes || {};
  // Pathbuilder keys its item-bonus map by capitalised skill name.
  const itemBonus = key => build.mods?.[key[0].toUpperCase() + key.slice(1)]?.['Item Bonus'] || 0;

  // Every skill, trained or not: an untrained skill is just the attribute modifier, but
  // it is still the roll a GM asks for, and an item bonus can land on one.
  const skills = Object.keys(SKILL_ABILITY)
    .map(name => ({
      name,
      rank: proficiencyName(prof[name] || 0),
      bonus: proficiencyBonus(prof[name] || 0, level) +
        mods[SKILL_ABILITY[name]] + itemBonus(name)
    }))
    .sort((x, y) => x.name.localeCompare(y.name));

  const keyAbility = build.keyability || 'str';

  return {
    id: slug(build.name),
    group,
    name: clean(build.name),
    player: player || null,
    level,
    class: clean(build.class),
    dualClass: clean(build.dualClass),
    ancestry: clean(build.ancestry),
    heritage: clean(build.heritage),
    background: clean(build.background),
    deity: clean(build.deity),
    size: clean(build.sizeName),
    gender: clean(build.gender),
    age: clean(build.age),
    keyAbility,
    languages: (build.languages || []).map(clean).filter(Boolean),

    abilities: { str: a.str, dex: a.dex, con: a.con, int: a.int, wis: a.wis, cha: a.cha },
    mods,

    // AC comes straight from the export — Pathbuilder has already applied the armour,
    // its runes and every situational bonus, which we cannot reconstruct.
    ac: build.acTotal?.acTotal ?? null,
    shieldBonus: Number(build.acTotal?.shieldBonus) || null,
    hp: maxHP({
      ancestryHP: attrs.ancestryhp, classHP: attrs.classhp, conMod: mods.con, level,
      bonusHP: attrs.bonushp, bonusHPPerLevel: attrs.bonushpPerLevel
    }),
    speed: (Number(attrs.speed) || 0) + (Number(attrs.speedBonus) || 0),
    // The same item-bonus map that carries skill items also carries save items — a
    // Resilient rune lands in mods.Fortitude/Reflex/Will. Missing it understates every
    // save on an armoured character.
    perception: proficiencyBonus(prof.perception || 0, level) + mods.wis +
      itemBonus('perception'),
    perceptionRank: proficiencyName(prof.perception || 0),
    saves: {
      fort: proficiencyBonus(prof.fortitude || 0, level) + mods.con + itemBonus('fortitude'),
      ref: proficiencyBonus(prof.reflex || 0, level) + mods.dex + itemBonus('reflex'),
      will: proficiencyBonus(prof.will || 0, level) + mods.wis + itemBonus('will')
    },
    saveRanks: {
      fort: proficiencyName(prof.fortitude || 0),
      ref: proficiencyName(prof.reflex || 0),
      will: proficiencyName(prof.will || 0)
    },
    classDC: prof.classDC
      ? 10 + proficiencyBonus(prof.classDC, level) + (mods[keyAbility] ?? 0)
      : null,

    skills,
    lores: (build.lores || []).map(([name, rank]) => ({
      name, rank: proficiencyName(rank), bonus: proficiencyBonus(rank, level) + mods.int
    })),
    feats: (build.feats || []).map(([name, choice, type, lvl]) => ({
      name, choice: choice || null, type, level: lvl
    })),
    specials: build.specials || [],

    weapons: (build.weapons || []).map(w => ({
      // `display` already reads "+2 Striking Hooked Returning Greataxe"; fall back to the
      // bare name when it is blank. `base` keeps the unadorned name, which is the only
      // one that can be looked up in data/equipment.json for pricing.
      name: clean(w.display) || clean(w.name),
      base: clean(w.name),
      proficiency: w.prof,
      // Pathbuilder writes "d0" for weapons with no fixed die, such as alchemical
      // bombs, where the damage comes from the item rather than the weapon. The striking
      // rune is named rather than applied — dice scaling is the player's sheet to track.
      damage: [w.die === 'd0' ? null : w.die, w.damageType].filter(Boolean).join(' '),
      striking: clean(w.str),
      extraDamage: w.extraDamage || [],
      potency: w.pot || 0,
      runes: w.runes || []
    })),
    armor: (build.armor || []).map(x => ({
      name: clean(x.display) || clean(x.name), base: clean(x.name),
      proficiency: x.prof, worn: !!x.worn,
      potency: x.pot || 0, resilient: clean(x.res), runes: x.runes || []
    })),
    spellcasting: (build.spellCasters || []).map(c => ({
      name: clean(c.name), tradition: c.magicTradition, type: c.spellcastingType,
      ability: c.ability, innate: !!c.innate,
      rank: proficiencyName(c.proficiency || 0),
      dc: c.proficiency
        ? 10 + proficiencyBonus(c.proficiency, level) + (mods[c.ability] ?? 0)
        : null,
      attack: c.proficiency
        ? proficiencyBonus(c.proficiency, level) + (mods[c.ability] ?? 0)
        : null,
      // Slots per day, indexed by spell rank; rank 0 is cantrips.
      slots: (c.perDay || [])
        .map((count, rank) => ({ rank, count }))
        .filter(s => s.count > 0),
      // Keep the rank structure — a flat list loses which slot a spell is prepared in.
      spells: (c.spells || [])
        .map(s => ({ rank: s.spellLevel, list: s.list || [] }))
        .filter(s => s.list.length)
    })),

    // build.focus is { tradition: { ability: { focusSpells, focusCantrips } } }.
    focusSpells: [...new Set(
      Object.values(build.focus || {})
        .flatMap(byAbility => Object.values(byAbility || {}))
        .flatMap(f => [...(f.focusCantrips || []), ...(f.focusSpells || [])])
    )],
    // Weapon and armour proficiency the build grants for one named item, e.g. an
    // alchemist's expert Alchemical Bomb.
    specificProficiencies: Object.entries(build.specificProficiencies || {})
      .flatMap(([rank, names]) => (names || []).map(name => ({ name, rank }))),

    resistances: build.resistances || [],

    // Alchemist and poisoner formula books. Pathbuilder leaves raw uuids in the "other"
    // list for homebrew entries it cannot name; those are noise, so drop them.
    formulas: (build.formula || [])
      .map(f => ({
        type: f.type,
        known: (f.known || []).filter(n => !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(n))
      }))
      .filter(f => f.known.length),

    familiars: (build.familiars || []).map(f => ({
      name: clean(f.name), type: f.type, abilities: f.abilities || []
    })),
    pets: (build.pets || []).map(p => clean(p.name || p.type)).filter(Boolean),

    focusPoints: build.focusPoints || 0,
    money: build.money || {},
    equipment: (build.equipment || []).map(([name, qty]) => ({ name, qty }))
  };
}
