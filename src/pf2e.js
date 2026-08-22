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

