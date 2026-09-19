// Pure, fail-closed staged reveal state for GM-selected public information.
// This module deliberately contains no creature mechanics or source records.

export const REVEAL_TIERS = Object.freeze(['none', 'basic', 'known', 'detailed']);

export const REVEAL_CATEGORIES = Object.freeze([
  'appearance',
  'behavior',
  'habitat',
  'role',
  'traits',
  'lore'
]);

const REVEAL_CATEGORY_MIN_TIER = Object.freeze({
  appearance: 'basic',
  behavior: 'known',
  habitat: 'known',
  role: 'known',
  traits: 'known',
  lore: 'detailed'
});

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const MAX_DECISIONS = 50;
const MAX_LABELS = 20;
const MAX_LABEL_LENGTH = 120;

export function isRevealTier(value) {
  return typeof value === 'string' && REVEAL_TIERS.includes(value);
}

export function isRevealCategory(value) {
  return typeof value === 'string' && REVEAL_CATEGORIES.includes(value);
}

function tierRank(value) {
  return REVEAL_TIERS.indexOf(value);
}

function publicLabels(value) {
  const values = Array.isArray(value) ? value : [value];
  const seen = new Set();
  return values.filter(label => typeof label === 'string')
    .map(label => label.slice(0, MAX_LABEL_LENGTH).trim())
    .filter(label => label && !seen.has(label) && seen.add(label))
    .slice(0, MAX_LABELS);
}

function normalizeDecision(decision) {
  if (!object(decision) || !isRevealTier(decision.tier) || !isRevealCategory(decision.category)) {
    return null;
  }
  const minimumTier = REVEAL_CATEGORY_MIN_TIER[decision.category];
  if (tierRank(decision.tier) < tierRank(minimumTier)) return null;
  const labels = publicLabels(decision.labels ?? decision.value);
  return labels.length ? { tier: decision.tier, category: decision.category, labels } : null;
}

/** Normalize GM-owned reveal state without carrying unknown fields forward. */
export function normalizeRevealState(value) {
  const source = object(value) ? value : {};
  const tier = isRevealTier(source.tier) ? source.tier : 'none';
  const decisions = Array.isArray(source.decisions)
    ? source.decisions.map(normalizeDecision).filter(Boolean).slice(0, MAX_DECISIONS)
    : [];
  return { tier, decisions };
}

/** Set a valid tier only when it advances the current state. */
export function advanceRevealTier(value, requestedTier) {
  const current = normalizeRevealState(value);
  const target = requestedTier === undefined
    ? REVEAL_TIERS[Math.min(tierRank(current.tier) + 1, REVEAL_TIERS.length - 1)]
    : requestedTier;
  return isRevealTier(target) && tierRank(target) > tierRank(current.tier)
    ? { ...current, tier: target }
    : current;
}

/** Set a valid tier only when it retracts the current state. */
export function retractRevealTier(value, requestedTier) {
  const current = normalizeRevealState(value);
  const target = requestedTier === undefined
    ? REVEAL_TIERS[Math.max(tierRank(current.tier) - 1, 0)]
    : requestedTier;
  return isRevealTier(target) && tierRank(target) < tierRank(current.tier)
    ? { ...current, tier: target }
    : current;
}

/**
 * Return only the decisions currently permitted by the selected tier. The
 * output is a public category/labels list; no source or internal identifiers
 * can cross this boundary.
 */
export function publicRevealDecisions(value) {
  const state = normalizeRevealState(value);
  const grouped = new Map();
  for (const decision of state.decisions) {
    if (tierRank(decision.tier) > tierRank(state.tier)) continue;
    if (!grouped.has(decision.category)) grouped.set(decision.category, []);
    const labels = grouped.get(decision.category);
    for (const label of decision.labels) {
      if (!labels.includes(label) && labels.length < MAX_LABELS) labels.push(label);
    }
  }
  return REVEAL_CATEGORIES.flatMap(category => {
    const labels = grouped.get(category);
    return labels?.length ? [{ category, labels }] : [];
  });
}
