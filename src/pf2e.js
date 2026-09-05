// Pathfinder 2e rules tables and helpers.
// Everything here is pure: no DOM, no storage. Keep it that way so views stay thin.

/** XP cost of a creature, by its level relative to the party level. */
export const XP_BY_RELATIVE_LEVEL = {
  '-4': 10, '-3': 15, '-2': 20, '-1': 30, '0': 40, '1': 60, '2': 80, '3': 120, '4': 160
};

/** Encounter XP budgets for a party of four. */
export const THREAT_BUDGET = { trivial: 40, low: 60, moderate: 80, severe: 120, extreme: 160 };

/** Budget adjustment per character above or below a party of four. */
export const THREAT_ADJUST = { trivial: 10, low: 15, moderate: 20, severe: 30, extreme: 40 };

/** Total party treasure per level, in gp, for a party of four (CRB Table 10-9). */
export const TREASURE_BY_LEVEL = {
  1: 175, 2: 300, 3: 500, 4: 850, 5: 1350, 6: 2000, 7: 2900, 8: 4000, 9: 5700, 10: 8000,
  11: 11500, 12: 16500, 13: 25000, 14: 36500, 15: 54500, 16: 82500, 17: 128000, 18: 208000,
  19: 355000, 20: 490000
};

/** Level-based DCs (CRB Table 10-5). */
export const LEVEL_DC = {
  0: 14, 1: 15, 2: 16, 3: 18, 4: 19, 5: 20, 6: 22, 7: 23, 8: 24, 9: 26, 10: 27,
  11: 28, 12: 30, 13: 31, 14: 32, 15: 34, 16: 35, 17: 36, 18: 38, 19: 39, 20: 40,
  21: 42, 22: 44, 23: 46, 24: 48, 25: 50
};

export const CONDITIONS = [
  'Blinded', 'Clumsy', 'Confused', 'Dazzled', 'Deafened', 'Drained', 'Enfeebled', 'Fatigued',
  'Fleeing', 'Frightened', 'Grabbed', 'Immobilized', 'Off-Guard', 'Paralyzed', 'Persistent Damage',
  'Prone', 'Restrained', 'Sickened', 'Slowed', 'Stunned', 'Stupefied', 'Unconscious', 'Wounded'
];

/**
 * Conditions out of CONDITIONS whose chip carries a number — Clumsy 1, Frightened 2.
 * Persistent Damage carries a damage type instead of a value and already has its own
 * step in the picker, so it is deliberately not here. Doomed and Dying take a value too
 * but are not in CONDITIONS at all, so they stay out of this list as well.
 */
export const VALUED_CONDITIONS = [
  'Clumsy', 'Drained', 'Enfeebled', 'Frightened', 'Sickened', 'Slowed', 'Stunned',
  'Stupefied', 'Wounded'
];

/** Whether a condition name is one that carries a value. */
export function takesValue(name) {
  return VALUED_CONDITIONS.includes(name);
}

/**
 * Conditions that another condition hands out with it, straight from the Remaster
 * condition entries (the same text data/conditions.json carries): Prone is "You are
 * off-guard", Grabbed is "giving you the off-guard and immobilized conditions", Restrained
 * the same, Paralyzed and Confused each say "you have the off-guard condition", Dying is
 * "you are unconscious", and Unconscious is "you have the blinded and off-guard
 * conditions" plus "you fall prone".
 *
 * One direction only, on purpose. Off-guard has plenty of other sources — flanking above
 * all — so standing up out of prone must not silently clear it.
 *
 * Dying is here for the closure even though it is not in CONDITIONS: this is the rules
 * table, and it is what makes Unconscious's own knock-ons reachable if it is ever added.
 */
export const IMPLIED_CONDITIONS = {
  'Confused': ['Off-Guard'],
  'Dying': ['Unconscious'],
  'Grabbed': ['Off-Guard', 'Immobilized'],
  'Paralyzed': ['Off-Guard'],
  'Prone': ['Off-Guard'],
  'Restrained': ['Off-Guard', 'Immobilized'],
  'Unconscious': ['Blinded', 'Off-Guard', 'Prone']
};

/**
 * Everything a condition drags along, following the chain: Dying is Unconscious, which is
 * blinded, off-guard and prone. Breadth-first, so the direct ones come first, and the
 * condition itself is never in its own list.
 */
export function impliedConditions(name) {
  const out = [];
  const queue = [...(IMPLIED_CONDITIONS[name] || [])];
  while (queue.length) {
    const next = queue.shift();
    if (next === name || out.includes(next)) continue;
    out.push(next);
    queue.push(...(IMPLIED_CONDITIONS[next] || []));
  }
  return out;
}

/**
 * Damage types persistent damage comes in, commonest at the table first. The eight energy
 * types are the Energy trait group in data/traits.json; bleed, mental, poison and spirit
 * are the rest of what an ongoing effect deals, and physical persistent damage exists too
 * (a barbed arrow left in the wound). Precision is deliberately absent — it is never
 * persistent.
 */
export const PERSISTENT_DAMAGE_TYPES = [
  'Bleed', 'Fire', 'Acid', 'Cold', 'Electricity', 'Sonic', 'Force', 'Mental', 'Poison',
  'Spirit', 'Vitality', 'Void', 'Bludgeoning', 'Piercing', 'Slashing'
];

/** XP a single creature contributes, or null if it is outside the -4..+4 band. */
export function creatureXP(creatureLevel, partyLevel) {
  const delta = creatureLevel - partyLevel;
  if (delta < -4 || delta > 4) return null;
  return XP_BY_RELATIVE_LEVEL[String(delta)];
}

/**
 * XP a hazard contributes. Simple hazards are worth a fifth of a creature of the
 * same level; complex hazards are worth the full amount.
 */
export function hazardXP(hazardLevel, partyLevel, complex = false) {
  const base = creatureXP(hazardLevel, partyLevel);
  if (base === null) return null;
  return complex ? base : Math.max(1, Math.round(base / 5));
}

/** The five threat budgets adjusted for a party that is not exactly four characters. */
export function budgets(partySize) {
  const extra = partySize - 4;
  const out = {};
  for (const threat of Object.keys(THREAT_BUDGET)) {
    out[threat] = THREAT_BUDGET[threat] + extra * THREAT_ADJUST[threat];
  }
  return out;
}

/** Name the threat level a given XP total lands on for this party size. */
export function threatFor(xp, partySize) {
  const b = budgets(partySize);
  if (xp > b.extreme) return 'beyond extreme';
  if (xp >= b.extreme) return 'extreme';
  if (xp >= b.severe) return 'severe';
  if (xp >= b.moderate) return 'moderate';
  if (xp >= b.low) return 'low';
  return 'trivial';
}

export const THREAT_ORDER = ['trivial', 'low', 'moderate', 'severe', 'extreme'];

/**
 * The top of the gauge: one band's worth of headroom past the extreme budget, so an
 * encounter that overshoots has somewhere to sit instead of jamming against the end.
 */
function threatTop(partySize) {
  const b = budgets(partySize);
  return b.extreme + (b.extreme - b.severe);
}

/**
 * The five threat bands as a scale for a gauge running trivial on the left to extreme on
 * the right. Each band is as wide as the XP range it covers, so the gauge re-proportions
 * itself with the party size instead of showing five equal blocks that lie about the
 * distances.
 *
 * A band starts at its own budget and runs to the next one up, which is exactly how
 * threatFor() names a total: an encounter is low as soon as it reaches the low budget and
 * stays low until it reaches moderate. Everything under the low budget reads as trivial,
 * so that is where the first band starts — at zero, not at the trivial budget.
 */
export function threatScale(partySize) {
  const b = budgets(partySize);
  const starts = [0, b.low, b.moderate, b.severe, b.extreme];
  const top = threatTop(partySize);
  return THREAT_ORDER.map((threat, i) => {
    const from = starts[i];
    const to = i + 1 < starts.length ? starts[i + 1] : top;
    return { threat, from, to, width: ((to - from) / top) * 100 };
  });
}

/**
 * Where an XP total sits on that scale, as a percentage. Anything past the headroom pins
 * to the right-hand end, where the threat name reads "beyond extreme".
 */
export function threatPosition(xp, partySize) {
  const top = threatTop(partySize);
  return top <= 0 ? 0 : Math.max(0, Math.min(100, (xp / top) * 100));
}

/**
 * XP each character earns. Budgets scale with party size, but the award does not:
 * divide the encounter total by the real party size and multiply by four.
 */
export function xpAward(encounterXP, partySize) {
  if (partySize <= 0) return 0;
  return Math.floor((encounterXP / partySize) * 4);
}

/** Total party treasure for a level, scaled for parties other than four. */
export function treasureFor(level, partySize) {
  const base = TREASURE_BY_LEVEL[Math.min(20, Math.max(1, level))] || 0;
  return Math.round(base * (partySize / 4));
}

/**
 * Equipment categories that are not treasure. Services and structures cannot be looted,
 * materials and trade goods are crafting stock rather than gear, and a cursed item is a
 * problem handed to a player rather than a reward. Everything else in the file is
 * something a party can carry and use.
 */
export const NOT_LOOT = new Set(['Services', 'Materials', 'Trade Goods', 'Structures',
  'Contracts', 'Customizations', 'Adjustments', 'Cursed Items', 'Blighted Boons',
  'High-Tech', 'Figurehead']);

/**
 * A spread of usable treasure for a party of `level`: items of exactly that level or one
 * higher, which is the band the treasure tables hand out, priced, and drawn from
 * categories a party can actually use.
 *
 * Picks round-robin across categories rather than at random over the whole band, or a
 * roll lands on eight wands and calls it a hoard. `random` is injectable so the selection
 * can be tested; pass Math.random for real use.
 *
 * `budget` is a gp target — the level's own treasure allowance — and the selection fills
 * up to it rather than to a fixed number of items: an item that would overshoot by more
 * than a twentieth is skipped, and picking stops once the total is within a tenth of the
 * target. `count` is only the backstop that keeps a low-level budget from turning into
 * forty vials of acid. Prices here are in copper, as `data/equipment.json` stores them.
 */
export function lootSelection(items,
  { level = 1, count = 20, budget = null, random = Math.random } = {}) {
  const band = (items || []).filter(i =>
    (i.level === level || i.level === level + 1)
    && typeof i.price === 'number' && i.price > 0
    && !NOT_LOOT.has(i.category));

  const byCategory = new Map();
  for (const item of band) {
    if (!byCategory.has(item.category)) byCategory.set(item.category, []);
    byCategory.get(item.category).push(item);
  }

  // Shuffle inside each category, and shuffle the category order, so a reroll moves.
  const shuffle = list => {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };

  const queues = shuffle([...byCategory.values()].map(shuffle));
  const target = budget === null ? null : Math.max(0, budget) * 100;   // gp -> copper
  const picked = [];
  let spent = 0;
  let takenThisPass = true;

  while (picked.length < count && queues.some(q => q.length) && takenThisPass) {
    takenThisPass = false;
    for (const queue of queues) {
      if (picked.length >= count) break;
      if (target !== null && spent >= target * 0.9) break;
      // Walk this category for something that still fits, rather than giving up on the
      // category because its most expensive item would blow the budget.
      while (queue.length) {
        const item = queue.pop();
        if (target !== null && spent + item.price > target * 1.05) continue;
        picked.push(item);
        spent += item.price;
        takenThisPass = true;
        break;
      }
    }
    if (target === null) takenThisPass = true;    // no budget: fill to `count`
  }
  return picked;
}

/**
 * Item categories that do not presume a particular weapon, armour proficiency, casting
 * tradition, or class feature. They make safe individual treasure suggestions from the
 * character data we have, rather than offering a fighter a random staff or a wizard a
 * weapon they cannot use well.
 */
export const PERSONAL_LOOT_CATEGORIES = new Set([
  'Adventuring Gear', 'Alchemical Items', 'Consumables', 'Held Items', 'Spellhearts',
  'Talismans', 'Tattoos', 'Worn Items'
]);

/**
 * A short selection of broadly usable items for one character. The character argument is
 * intentionally accepted even though the current reference data can only establish broad
 * compatibility; it keeps the recommendation boundary ready for richer equipment data.
 */
export function personalLootSelection(items, character,
  { level = 1, count = 2, budget = null, random = Math.random } = {}) {
  void character;
  const selected = lootSelection((items || []).filter(i =>
    PERSONAL_LOOT_CATEGORIES.has(i.category)
    && (budget === null || i.price <= Math.max(0, budget) * 100)),
  { level, count, budget, random });
  if (budget === null) return selected;

  // Party-wide suggestions may use the table's small rounding headroom, but an individual
  // award must never spend more than the amount the level still has available.
  let spent = 0;
  const limit = Math.max(0, budget) * 100;
  return selected.filter(item => {
    if (spent + item.price > limit) return false;
    spent += item.price;
    return true;
  });
}

/**
 * Split a gp amount into `ways` even shares. Divided in copper so nothing is lost to
 * rounding: the shares differ by at most a copper piece, and they always add back up to
 * the amount handed in.
 */
export function splitEvenly(gp, ways) {
  const parts = Math.floor(ways);
  if (!Number.isFinite(gp) || parts < 1) return [];
  const copper = Math.round(Math.max(0, gp) * 100);
  const each = Math.floor(copper / parts);
  const extra = copper - each * parts;
  return Array.from({ length: parts }, (_, i) => (each + (i < extra ? 1 : 0)) / 100);
}

/** Split a gp value into the coin denominations a GM would actually hand out. */
export function toCoins(gp) {
  const total = Math.max(0, Math.round(gp * 100)); // work in copper
  const pp = Math.floor(total / 1000);
  let rest = total - pp * 1000;
  const gold = Math.floor(rest / 100);
  rest -= gold * 100;
  const sp = Math.floor(rest / 10);
  const cp = rest - sp * 10;
  return { pp, gp: gold, sp, cp };
}

/** Roll dice from notation like "2d6+3" or "d20". Returns { total, rolls }. */
export function roll(notation) {
  const m = String(notation).trim().match(/^(\d*)d(\d+)\s*([+-]\s*\d+)?$/i);
  if (!m) return { total: Number(notation) || 0, rolls: [] };
  const count = Number(m[1] || 1);
  const faces = Number(m[2]);
  const mod = m[3] ? Number(m[3].replace(/\s+/g, '')) : 0;
  const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * faces));
  return { total: rolls.reduce((a, b) => a + b, 0) + mod, rolls, mod };
}


/**
 * Proficiency rank bonuses. These, the ability modifier formula, and the HP formula
 * below are unchanged between pre- and post-Remaster.
 */
export const PROFICIENCY = { untrained: 0, trained: 2, expert: 4, master: 6, legendary: 8 };

const RANK_NAMES = ['untrained', 'trained', 'expert', 'master', 'legendary'];

/** Name a rank bonus (0/2/4/6/8). Anything unexpected reads as untrained. */
export function proficiencyName(rankBonus) {
  return RANK_NAMES[rankBonus / 2] || 'untrained';
}

/**
 * Total proficiency bonus before ability and item modifiers.
 * Untrained is a flat +0 — you do not add your level.
 */
export function proficiencyBonus(rankBonus, level) {
  return rankBonus > 0 ? level + rankBonus : 0;
}

/** Ability modifier from a score. */
export function abilityMod(score) {
  return Math.floor((Number(score) - 10) / 2);
}

/**
 * A character's maximum HP: ancestry HP once, then class HP plus the Constitution
 * modifier at every level including 1st.
 */
export function maxHP({ ancestryHP = 0, classHP = 0, conMod = 0, level = 1,
                       bonusHP = 0, bonusHPPerLevel = 0 } = {}) {
  return ancestryHP + bonusHP + level * (classHP + conMod + bonusHPPerLevel);
}

/** The attribute each skill keys off. Lore skills always key off Intelligence. */
export const SKILL_ABILITY = {
  acrobatics: 'dex', arcana: 'int', athletics: 'str', crafting: 'int', deception: 'cha',
  diplomacy: 'cha', intimidation: 'cha', medicine: 'wis', nature: 'wis', occultism: 'int',
  performance: 'cha', religion: 'wis', society: 'int', stealth: 'dex', survival: 'wis',
  thievery: 'dex'
};

/**
 * Feat categories in the order a sheet reads best: what the character *is* first, then
 * what they chose, then what the table handed them. These are the `type` strings a
 * Pathbuilder export writes; an unrecognised one sorts last under its own heading rather
 * than being dropped.
 */
export const FEAT_TYPES = ['Heritage', 'Ancestry Feat', 'Class Feat', 'Archetype Feat',
  'Skill Feat', 'General Feat', 'Bonus Feat', 'Awarded Feat'];

/**
 * Feats grouped by category, and within a category ordered so the ones that cost an
 * action come before the passive ones, then by trait, then by name.
 *
 * Mid-combat a GM is looking for what a character can *do* — a Reaction they might spend
 * on an ally, a Stance they might enter — and the passives are what they already have.
 * Sorting by the whole trait list rather than one trait keeps the feats that behave alike
 * together: a guardian's two Archetype reactions land next to each other.
 *
 * `actions` and `traits` come from the codex and are both optional; a feat with no codex
 * entry is treated as passive, which is what an unmatched homebrew feat usually is.
 */
export function featGroups(feats = []) {
  const rank = new Map(FEAT_TYPES.map((type, i) => [type, i]));
  const groups = new Map();
  for (const feat of feats) {
    const type = feat.type || 'Other';
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type).push(feat);
  }

  const key = f => [
    f.actions ? 0 : 1,
    (f.traits || []).join(' ').toLowerCase(),
    (f.name || '').toLowerCase()
  ];
  const compare = (a, b) => {
    const [x, y] = [key(a), key(b)];
    return x[0] - y[0] || x[1].localeCompare(y[1]) || x[2].localeCompare(y[2]);
  };

  return [...groups]
    .sort(([a], [b]) =>
      (rank.get(a) ?? FEAT_TYPES.length) - (rank.get(b) ?? FEAT_TYPES.length)
      || a.localeCompare(b))
    .map(([type, list]) => ({ type, feats: [...list].sort(compare) }));
}

/**
 * Feats in the order a character gained them: lowest level first, then alphabetically
 * within a level. Missing levels belong last so older and homebrew records remain visible
 * without being mistaken for first-level choices.
 */
export function featsByLevel(feats = []) {
  return [...feats].sort((a, b) => {
    const aLevel = Number.isFinite(a.level) ? a.level : Infinity;
    const bLevel = Number.isFinite(b.level) ? b.level : Infinity;
    return aLevel - bLevel || (a.name || '').localeCompare(b.name || '');
  });
}

/** The six attributes in sheet order, keyed as characters store them. */
export const ATTRIBUTES = [
  ['str', 'Strength'], ['dex', 'Dexterity'], ['con', 'Constitution'],
  ['int', 'Intelligence'], ['wis', 'Wisdom'], ['cha', 'Charisma']
];

/**
 * All sixteen skills in alphabetical order, with the untrained ones filled in.
 *
 * Untrained is worth showing: a GM calls for Nature or Society from whoever is standing
 * there, not from whoever trained it. An untrained skill is the attribute modifier and
 * nothing else — untrained adds no level — which is the same arithmetic the importer
 * does, so a character stored before it kept untrained skills reconstructs exactly.
 *
 * Armour check penalties are in neither: Pathbuilder's export does not decompose into
 * one, and the trained bonuses this merges with do not include it either.
 */
export function skillList({ skills = [], mods = {} } = {}) {
  const known = new Map((skills || []).map(s => [s.name, s]));
  return Object.keys(SKILL_ABILITY).sort().map(name => known.get(name) || {
    name,
    rank: 'untrained',
    bonus: mods[SKILL_ABILITY[name]] ?? 0
  });
}

/**
 * Lump-sum gp a character built at each level is expected to hold, covering permanent
 * items, consumables and currency together (Character Wealth, GM Core p. 61 / CRB
 * Table 10-10; the two printings agree). This is the "new character at level N"
 * benchmark, not the running total an ongoing party accumulates — see
 * cumulativeTreasure() for that.
 */
export const CHARACTER_WEALTH = {
  1: 15, 2: 30, 3: 75, 4: 140, 5: 270, 6: 450, 7: 720, 8: 1100, 9: 1600, 10: 2300,
  11: 3200, 12: 4500, 13: 6400, 14: 9300, 15: 13500, 16: 20000, 17: 30000, 18: 45000,
  19: 69000, 20: 112000
};

/** Currency alone (excluding items) for a character built at each level. */
export const CHARACTER_CURRENCY = {
  1: 15, 2: 20, 3: 25, 4: 30, 5: 50, 6: 80, 7: 125, 8: 180, 9: 250, 10: 350,
  11: 500, 12: 700, 13: 1000, 14: 1500, 15: 2250, 16: 3250, 17: 5000, 18: 7500,
  19: 12000, 20: 20000
};

/** Expected lump-sum wealth for a character of this level. */
export function wealthFor(level) {
  return CHARACTER_WEALTH[Math.min(20, Math.max(1, level))] || 0;
}

/**
 * Treasure a party should have been handed on the way to `level`, per character.
 * Sums the per-level party budgets for every level already completed — reaching level 7
 * means levels 1 through 6 have been played — then divides across the party. An ongoing
 * party sits well above the Character Wealth benchmark because that table assumes a
 * freshly built character with nothing inherited.
 */
export function cumulativeTreasure(level, partySize) {
  let total = 0;
  for (let l = 1; l < Math.min(21, Math.max(1, level)); l++) {
    total += treasureFor(l, partySize);
  }
  return partySize > 0 ? total / partySize : 0;
}

/**
 * Action-cost notation. Pathfinder writes these as icons; the community-standard plain
 * text stand-ins are geometric shapes, which render everywhere without a bundled font.
 */
export const ACTION_ICONS = {
  'free action': '◇',
  'reaction': '⤾',
  'single action': '◆',
  'one action': '◆',
  'two actions': '◆◆',
  'three actions': '◆◆◆'
};

// Longest first, so "two actions" is consumed before a bare "action" could match.
const ACTION_KEYS = Object.keys(ACTION_ICONS).sort((a, b) => b.length - a.length);

/**
 * Swap action-cost phrases for their icons, leaving everything else alone.
 * Handles the compound forms too: "Single Action to Three Actions" becomes "◆ to ◆◆◆",
 * and a duration like "10 minutes" passes through untouched.
 */
export function actionIcons(actions) {
  if (!actions) return null;
  let out = String(actions);
  for (const key of ACTION_KEYS) {
    out = out.replace(new RegExp(key, 'gi'), ACTION_ICONS[key]);
  }
  return out;
}

// --- elite and weak ------------------------------------------------------------

/**
 * Elite and Weak creature adjustments, transcribed from:
 *   Elite — https://2e.aonprd.com/Rules.aspx?ID=3264
 *   Weak  — https://2e.aonprd.com/Rules.aspx?ID=3265
 *
 * Both templates touch the same set of numbers, elite up and weak down. Only level, HP
 * and AC are things the app tracks and adjusts below; the rest is recorded here because
 * a GM reading this table needs the whole rule, not just the third the app computes:
 *   - AC, attack modifiers, DCs, saving throws, Perception and skill modifiers: ±2
 *   - Strikes and other offensive abilities: ±2 damage, or ±4 for one with a use limit
 *     (a spellcaster's spells, a dragon's breath)
 *   - HP: banded on the creature's *starting* level — see adjustedHP()
 *   - level: elite +1, weak -1, each with a special case at the bottom of the scale —
 *     see adjustedLevel()
 *
 * `adjust` is 'elite', 'weak', or anything else — null, undefined, a typo — meaning
 * unchanged, so a caller can pass a planner entry's `adjust` field straight through
 * without validating it first.
 */

/** Elite's HP table, keyed on the creature's starting level. ID 3264. */
const ELITE_HP_BANDS = [
  { max: 1, delta: 10 },
  { max: 4, delta: 15 },
  { max: 19, delta: 20 },
  { max: Infinity, delta: 30 }
];

/**
 * Weak's HP table, keyed on the creature's starting level. ID 3265. The published table
 * starts at level 1 and says nothing about level 0 or -1, which this app allows a
 * creature to be — there is no rule to quote for that gap, so a sub-1 creature takes the
 * lowest band (10) as the nearest fit, a choice this app makes rather than a number
 * Paizo published. adjustedHP() also floors the result at 1 either way, so a weak
 * creature can never end at 0 or negative HP.
 */
const WEAK_HP_BANDS = [
  { max: 2, delta: 10 },
  { max: 5, delta: 15 },
  { max: 20, delta: 20 },
  { max: Infinity, delta: 30 }
];

/**
 * The level change alone. Elite normally adds 1 and weak normally subtracts 1, but each
 * has a special case at the bottom of the scale: elite adds 2 instead at level -1 or 0,
 * and weak subtracts 2 instead at level 1 — both tables call this out explicitly rather
 * than leaving it to the general rule.
 */
export function adjustedLevel(level, adjust) {
  if (adjust === 'elite') return level === -1 || level === 0 ? level + 2 : level + 1;
  if (adjust === 'weak') return level === 1 ? level - 2 : level - 1;
  return level;
}

/**
 * HP after Elite or Weak, banded on the creature's *starting* `level` (before
 * adjustment) — a level 1 creature made elite adds 10 even though its adjusted level is
 * 2, because the table keys off where it started, not where it lands. Passes `null`
 * (or `undefined`) through unchanged for a creature with no HP recorded, and floors the
 * result at 1 so nothing here documents a dead or negative-HP creature.
 */
export function adjustedHP(hp, level, adjust) {
  if (hp === null || hp === undefined) return null;
  if (adjust === 'elite') {
    return hp + ELITE_HP_BANDS.find(b => level <= b.max).delta;
  }
  if (adjust === 'weak') {
    return Math.max(1, hp - WEAK_HP_BANDS.find(b => level <= b.max).delta);
  }
  return hp;
}

/** AC after Elite (+2) or Weak (-2). Passes `null`/`undefined` through unchanged. */
export function adjustedAC(ac, adjust) {
  if (ac === null || ac === undefined) return null;
  if (adjust === 'elite') return ac + 2;
  if (adjust === 'weak') return ac - 2;
  return ac;
}

// --- checks ------------------------------------------------------------------

/** The four degrees of success, worst first, so a degree is an index 0..3. */
export const DEGREES = ['critical failure', 'failure', 'success', 'critical success'];

/**
 * Degree of success as an index into DEGREES.
 *
 * Ten over the DC is a critical success and ten under a critical failure. A natural 20
 * then shifts the result one degree up and a natural 1 one degree down — and the shift
 * comes *after* the bands, which is the part that is easy to get wrong: a natural 20 that
 * still misses the DC by nine is a failure improved to a success, not an automatic
 * critical hit.
 *
 * `natural` is the d20 face. Pass null for a check with no die behind it.
 */
export function degreeOfSuccess(total, dc, natural = null) {
  let degree = total >= dc + 10 ? 3 : total >= dc ? 2 : total <= dc - 10 ? 0 : 1;
  if (natural === 20) degree += 1;
  else if (natural === 1) degree -= 1;
  return Math.max(0, Math.min(3, degree));
}

/**
 * The multiple attack penalty for the `nth` attack-trait action of a turn, counting from
 * zero. Agile weapons take the shorter track.
 *
 * This applies to every action with the attack trait, not only Strikes — Trip, Shove,
 * Grapple and Disarm all take it and all add to it. Demoralize does not, and that
 * asymmetry is most of why the order a turn is spent in matters.
 */
export const MAP = { normal: [0, -5, -10], agile: [0, -4, -8] };

export function mapPenalty(nth, { agile = false } = {}) {
  const track = agile ? MAP.agile : MAP.normal;
  return track[Math.min(Math.max(0, nth), track.length - 1)];
}

// --- conditions --------------------------------------------------------------

/**
 * What a condition does to the numbers, from the Remaster condition entries.
 *
 * `value` marks the conditions that carry one (Frightened 2); `flat` is a fixed amount.
 * `affects` names the statistics the penalty lands on, in the vocabulary
 * conditionModifiers() reports back.
 *
 * All of these are *status* penalties bar Off-Guard and Prone, which are circumstance —
 * and that distinction is load-bearing rather than pedantry. Penalties of the same type
 * do not stack, so two sources of frightened give the worse of the two rather than their
 * sum, while off-guard and frightened do stack because they are different types. Adding
 * everything up would overstate precisely what stacking debuffs is meant to measure.
 */
export const CONDITION_EFFECTS = {
  Frightened: { value: true, kind: 'status', affects: ['attack', 'ac', 'fort', 'ref', 'will', 'perception', 'skill', 'dc'] },
  Sickened: { value: true, kind: 'status', affects: ['attack', 'ac', 'fort', 'ref', 'will', 'perception', 'skill', 'dc'] },
  Clumsy: { value: true, kind: 'status', affects: ['ac', 'ref'] },
  Enfeebled: { value: true, kind: 'status', affects: ['attack'] },
  Drained: { value: true, kind: 'status', affects: ['fort'] },
  Stupefied: { value: true, kind: 'status', affects: ['will', 'dc'] },
  'Off-Guard': { flat: 2, kind: 'circumstance', affects: ['ac'] },
  Prone: { flat: 2, kind: 'circumstance', affects: ['attack'] },
  Slowed: { value: true, actions: true },
  Stunned: { value: true, actions: true },
  Paralyzed: { helpless: true },
  Unconscious: { helpless: true }
};

/**
 * Split a tracker chip into its parts. The tracker stores conditions as free strings, so
 * "Frightened 2" and "Persistent Damage 5 (fire)" both arrive as one.
 */
export function parseCondition(chip) {
  const raw = String(chip ?? '').trim();
  const note = raw.match(/\(([^)]*)\)\s*$/);
  const body = raw.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const value = body.match(/\s(\d+)$/);
  return {
    name: value ? body.slice(0, value.index).trim() : body,
    value: value ? Number(value[1]) : null,
    note: note ? note[1].trim() : null
  };
}

/**
 * The bare condition out of a chip string — the name half of parseCondition(), for a
 * call site that only wants to look the condition up (a description, the implied-
 * condition chain) and would otherwise have to destructure the whole thing. Strips both
 * a trailing value and a trailing parenthetical, so "Frightened 2", "Persistent Damage
 * 5 (fire)" and "Prone" all resolve to their entry in CONDITIONS.
 */
export function conditionName(text) {
  return parseCondition(text).name;
}

/** The trailing number on a chip, or null when it does not carry one. */
export function conditionValue(text) {
  return parseCondition(text).value;
}

/** Build a chip string. A null or zero value is the same as none: the bare name. */
export function withConditionValue(name, n) {
  return n ? `${name} ${n}` : name;
}

/**
 * The total HP damage a persistent-damage condition deals at the end of a turn.
 *
 * Older saved chips only carry a type ("Persistent Damage (fire)") and deliberately
 * contribute zero: the app cannot invent the amount they represent. Each newly created
 * chip stores its amount before its type, which parseCondition() reads as `value`.
 */
export function persistentDamageTotal(list = []) {
  return list.reduce((total, chip) => {
    const { name, value } = parseCondition(chip);
    return name === 'Persistent Damage' && Number.isFinite(value) && value > 0
      ? total + value
      : total;
  }, 0);
}

/**
 * One modifier set for a list of condition chips, with penalties already resolved against
 * each other by type. Everything it reports is a penalty, so the numbers are negative or
 * zero.
 *
 * `canAct` is false while helpless; `actions` is how many of the usual three remain.
 */
export function conditionModifiers(conditions = []) {
  const worst = { status: {}, circumstance: {} };
  let lost = 0;
  let canAct = true;

  for (const chip of conditions) {
    const { name, value } = parseCondition(chip);
    const effect = CONDITION_EFFECTS[name];
    if (!effect) continue;
    if (effect.helpless) { canAct = false; continue; }
    const amount = effect.flat ?? (effect.value ? (value ?? 1) : 0);
    if (effect.actions) { lost = Math.max(lost, amount); continue; }
    for (const stat of effect.affects || []) {
      const bucket = worst[effect.kind];
      bucket[stat] = Math.max(bucket[stat] || 0, amount);
    }
  }

  // The trailing || 0 is not noise: negating a zero gives -0, which is a real value that
  // prints as "-0" and compares unequal to 0 under strict equality.
  const total = stat =>
    -((worst.status[stat] || 0) + (worst.circumstance[stat] || 0)) || 0;
  return {
    attack: total('attack'), ac: total('ac'), dc: total('dc'),
    fort: total('fort'), ref: total('ref'), will: total('will'),
    perception: total('perception'), skill: total('skill'),
    actions: canAct ? Math.max(0, 3 - lost) : 0,
    canAct
  };
}

/**
 * What a combatant's condition chips do at the end of their own turn.
 *
 * Frightened is the one condition with a plain automatic decrease: it goes down by 1 and
 * drops off entirely at 0, per its own Player Core condition entry. A Frightened chip with no
 * number at all is treated as Frightened 1 — every Frightened the rules hand out carries
 * a value, so a valueless one is a chip from before values existed — and it ends the same
 * way a Frightened 1 does.
 *
 * Everything else here is a reminder for the GM, never a change the app makes on its own:
 * - Persistent damage is rolled and saved against at the table, not by this helper, so
 *   its chip is left exactly as it is and a reminder names the damage type and the DC 15
 *   flat check. The tracker applies the amount stored on its chip separately.
 * - Stunned and Slowed are deliberately not decremented here even though they carry a
 *   value: they reduce actions at the *start* of a turn, not the end, and Stunned's
 *   decrease is by however many actions were actually lost, which only the GM at the
 *   table knows. Automating either would be automating a number the app cannot see.
 *
 * Every other condition, valued or not, passes through untouched.
 */
export function endOfTurnConditions(list) {
  const conditions = [];
  const ticked = [];
  const reminders = [];

  for (const chip of list || []) {
    const { name, value, note } = parseCondition(chip);

    if (name === 'Frightened') {
      const current = value ?? 1;
      const next = current - 1;
      if (next > 0) {
        conditions.push(withConditionValue('Frightened', next));
        ticked.push(`Frightened ${current} → ${next}`);
      } else {
        ticked.push('Frightened ended');
      }
      continue;
    }

    if (name === 'Persistent Damage') {
      reminders.push(
        `persistent${note ? ' ' + note : ''}${value ? ' ' + value : ''}: take the damage, then DC ${PERSISTENT_FLAT_DC} flat check to end it`);
      conditions.push(chip);
      continue;
    }

    conditions.push(chip);
  }

  return { conditions, ticked, reminders };
}

// --- damage ------------------------------------------------------------------

/**
 * Pre-Remaster damage types that were renamed rather than removed. Both the Archives'
 * older creature entries and Pathbuilder exports still write the old names, so the two
 * callers share one table rather than each normalising its own.
 */
export const DAMAGE_TYPE_ALIASES = {
  negative: 'void', positive: 'vitality', good: 'spirit', evil: 'spirit',
  lawful: 'spirit', chaotic: 'spirit'
};

/**
 * Fold every dash shape to a hyphen. AoN writes the minus in `1d6-1 piercing` as an en
 * dash, and the regexes below only understand `[+-]`.
 */
const hyphen = s => String(s ?? '').replace(/[‐-―−]/g, '-');

const damageType = t => {
  const key = String(t || '').toLowerCase();
  return DAMAGE_TYPE_ALIASES[key] || key || null;
};

// Words that sit among the type words without being one.
const NOT_A_TYPE = new Set(['or', 'and', 'plus', 'damage', 'persistent', 'splash', 'to']);

/**
 * A damage expression, from a creature Strike, a PC weapon, or a line of spell text.
 *
 *   "3d12+15 piercing plus 2d6 fire"          two clauses
 *   "1d6+3 bludgeoning, piercing, or slashing" one clause offering three types
 *   "2d6+8 plus sticky paint"                  one typeless clause, rider "sticky paint"
 *   "attach"                                   no clauses at all
 *
 * A clause with no type keeps `type: null` rather than guessing one from the weapon's
 * name: a guess would apply the wrong weakness, which is worse than applying none.
 */
export function parseDamage(text) {
  const raw = hyphen(text).trim();
  const re = /(\d*)d(\d+)\s*([+-]\s*\d+)?/gi;
  const found = [];
  for (let m; (m = re.exec(raw));) found.push({ m, at: m.index, end: re.lastIndex });

  const clauses = found.map((f, i) => {
    // The words between this clause and the next describe it — but only up to the
    // conjunction that starts a rider. "2d6+8 plus sticky paint" is a typeless clause
    // with a rider on it, not eight points of sticky damage.
    const until = i + 1 < found.length ? found[i + 1].at : raw.length;
    const segment = raw.slice(f.end, until).split(/\b(?:plus|and)\b/i)[0];
    const types = segment.split(/[\s,]+/)
      .map(w => w.toLowerCase())
      .filter(w => w && /^[a-z]+$/.test(w) && !NOT_A_TYPE.has(w))
      .map(damageType);
    return {
      count: Number(f.m[1] || 1),
      faces: Number(f.m[2]),
      bonus: f.m[3] ? Number(f.m[3].replace(/\s+/g, '')) : 0,
      type: types[0] || null,
      types
    };
  });

  // Whatever follows the last clause and its own type words: "plus Knockdown".
  const tail = found.length ? raw.slice(found[found.length - 1].end) : raw;
  const plus = tail.match(/\b(?:plus|and)\b\s+(.+)$/i);
  const rider = found.length ? (plus ? plus[1].trim() : null) : (raw || null);
  return { clauses, rider };
}

/** Mean of a parsed expression, with no dice rolled. Powers every "expected" column. */
export function averageDamage(parsed) {
  return (parsed?.clauses || []).reduce(
    (n, c) => n + (c.count * (c.faces + 1)) / 2 + c.bonus, 0);
}

/**
 * Roll a parsed expression, totalled per damage type.
 *
 * A critical hit doubles the whole result, modifier included, and it happens here — which
 * is to say before any of the immunity, weakness and resistance in applyDamage(). The
 * order is the rule and it is not cosmetic: doubling after a resistance would be worth
 * considerably more than the rules give it.
 */
export function rollDamage(parsed, { random = Math.random, critical = false } = {}) {
  const byType = {};
  let total = 0;
  for (const c of parsed?.clauses || []) {
    let sum = c.bonus;
    for (let i = 0; i < c.count; i++) sum += 1 + Math.floor(random() * c.faces);
    sum = Math.max(0, critical ? sum * 2 : sum);
    const key = c.type || 'untyped';
    byType[key] = (byType[key] || 0) + sum;
    total += sum;
  }
  return { total, byType };
}

/**
 * Damage after the target's defences, in the order Player Core gives for applying them:
 * **immunities first, then weaknesses, and resistances third**.
 *
 * Weakness and resistance each apply once per damage type, not once per die. `blocked` is
 * everything the defences absorbed, which is worth reporting rather than discarding — a
 * fight lost to an unnoticed immunity is exactly what a GM wants to have seen coming.
 */
export function applyDamage(byType, { immunities = [], resistances = {}, weaknesses = {} } = {}) {
  const key = s => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
  const immune = new Set(immunities.map(key));
  const lower = obj => Object.fromEntries(
    Object.entries(obj || {}).map(([k, v]) => [key(k), v]));
  const res = lower(resistances);
  const weak = lower(weaknesses);

  const out = {};
  let total = 0;
  let blocked = 0;
  for (const [type, amount] of Object.entries(byType || {})) {
    if (immune.has(type)) { blocked += amount; continue; }
    const n = Math.max(0, amount + (weak[type] || 0) - (res[type] || 0));
    blocked += Math.max(0, amount - n);
    if (n > 0) out[type] = n;
    total += n;
  }
  return { total, byType: out, blocked };
}

/**
 * Is this target simply not a legal subject for an effect with these traits?
 *
 * Two sources, because neither is complete on its own: the creature's own `immunities`
 * list, and the Mindless trait, which no immunity line spells out but which is what makes
 * Demoralize pointless against a skeleton.
 */
export function immuneTo(target, ...names) {
  const key = s => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
  const immune = new Set((target?.immunities || []).map(key));
  const traits = new Set((target?.traits || []).map(key));
  if (traits.has('mindless') && names.some(n => /^(mental|emotion|fear)$/i.test(n))) {
    return true;
  }
  return names.some(n => immune.has(key(n)));
}

// --- persistent damage and dying ---------------------------------------------

/** Persistent damage ends on a DC 15 flat check, at the end of the turn it ticked in. */
export const PERSISTENT_FLAT_DC = 15;

export function persistentTick(expression, { random = Math.random } = {}) {
  const rolled = rollDamage(parseDamage(expression), { random });
  const flat = 1 + Math.floor(random() * 20);
  return { ...rolled, ends: flat >= PERSISTENT_FLAT_DC };
}

/** Dying 4 is dead. A critical hit that drops you starts you one step further along. */
export const DYING_MAX = 4;

export function dyingAfterDamage({ dying = 0, wounded = 0, critical = false } = {}) {
  const next = dying > 0
    ? dying + (critical ? 2 : 1)
    : 1 + wounded + (critical ? 1 : 0);
  return { dying: Math.min(DYING_MAX, next), wounded, dead: next >= DYING_MAX };
}

/**
 * The recovery check a dying creature makes at the start of its turn, against DC 10 plus
 * its dying value. Success reduces dying by 1 and a critical success by 2; failure adds
 * 1 and a critical failure 2. Reaching 0 means waking up with another wound.
 */
export function recoveryCheck({ dying = 1, wounded = 0, random = Math.random } = {}) {
  const natural = 1 + Math.floor(random() * 20);
  const degree = degreeOfSuccess(natural, 10 + dying, natural);
  const next = dying + [2, 1, -1, -2][degree];
  if (next <= 0) return { dying: 0, wounded: wounded + 1, conscious: true, dead: false };
  return {
    dying: Math.min(DYING_MAX, next),
    wounded,
    conscious: false,
    dead: next >= DYING_MAX
  };
}

// --- randomness ---------------------------------------------------------------

/**
 * A seeded generator with the same contract as Math.random, so anything already taking a
 * `random` option — lootSelection() does — becomes reproducible by handing it one of
 * these. mulberry32: small, fast, and far better than needed for counting hits.
 */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
