// Pure, fail-closed policy for creature information shown to players.

export const CREATURE_VISIBILITY = Object.freeze({
  HIDDEN: 'hidden',
  PRESENCE: 'presence',
  IMAGE: 'image',
  IDENTITY: 'identity',
  PUBLIC: 'public'
});

export const CREATURE_VISIBILITY_LEVELS = Object.freeze(Object.values(CREATURE_VISIBILITY));

const object = value => value && typeof value === 'object' && !Array.isArray(value);

const rank = level => CREATURE_VISIBILITY_LEVELS.indexOf(level);

function validLevel(value) {
  return typeof value === 'string' && CREATURE_VISIBILITY_LEVELS.includes(value);
}

/**
 * Resolve one creature's player-facing visibility. Explicit policy fields take
 * precedence over legacy controls; an explicit unknown value is hidden.
 */
export function creatureVisibility(record, setting) {
  const source = object(record) ? record : {};
  const configured = object(setting) ? setting : {};

  if (source.publicVisibility !== undefined || source.visibility !== undefined) {
    const value = source.publicVisibility ?? source.visibility;
    return validLevel(value) ? value : CREATURE_VISIBILITY.HIDDEN;
  }
  if (configured.publicVisibility !== undefined || configured.visibility !== undefined) {
    const value = configured.publicVisibility ?? configured.visibility;
    return validLevel(value) ? value : CREATURE_VISIBILITY.HIDDEN;
  }

  if (source.publicVisible === false || configured.revealed === false) {
    return CREATURE_VISIBILITY.HIDDEN;
  }

  // Compatibility with the existing GM controls. Missing/malformed identity
  // does not grant identity; it grants only the explicitly visible presence.
  const identity = source.publicIdentity ?? configured.identity;
  if (identity === 'hidden') return CREATURE_VISIBILITY.HIDDEN;
  if (identity === 'unknown') return CREATURE_VISIBILITY.PRESENCE;
  if (identity === 'revealed' || configured.revealed === true) {
    return source.publicMetadata === true || configured.publicMetadata === true
      ? CREATURE_VISIBILITY.PUBLIC : CREATURE_VISIBILITY.IDENTITY;
  }
  // A legacy public name is itself an explicit identity reveal, even when the
  // old boolean controls did not carry a separate identity field.
  if (typeof source.publicName === 'string' && source.publicName.trim()) {
    return source.publicMetadata === true || configured.publicMetadata === true
      ? CREATURE_VISIBILITY.PUBLIC : CREATURE_VISIBILITY.IDENTITY;
  }
  if ((source.publicVisible === true && source.publicImageVisible === true) ||
      (configured.revealed === true && configured.imageVisible === true)) {
    return CREATURE_VISIBILITY.IMAGE;
  }
  if (source.publicVisible === true || configured.revealed === true) {
    return CREATURE_VISIBILITY.PRESENCE;
  }
  return CREATURE_VISIBILITY.HIDDEN;
}

/** Return the exact capabilities granted by a resolved visibility level. */
export function visibilityCapabilities(level) {
  const resolved = validLevel(level) ? level : CREATURE_VISIBILITY.HIDDEN;
  const atLeast = minimum => rank(resolved) >= rank(minimum);
  return Object.freeze({
    level: resolved,
    present: resolved !== CREATURE_VISIBILITY.HIDDEN,
    image: atLeast(CREATURE_VISIBILITY.IMAGE),
    identity: atLeast(CREATURE_VISIBILITY.IDENTITY),
    metadata: atLeast(CREATURE_VISIBILITY.PUBLIC)
  });
}

/** Resolve and expose only policy capabilities to projection code. */
export function creatureVisibilityPolicy(record, setting) {
  return visibilityCapabilities(creatureVisibility(record, setting));
}
