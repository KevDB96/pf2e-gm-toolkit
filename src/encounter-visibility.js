// GM-owned encounter visibility. Missing or malformed values fail closed.

export const ENCOUNTER_IDENTITIES = Object.freeze(['hidden', 'unknown', 'revealed']);

const object = value => value && typeof value === 'object' && !Array.isArray(value);

export function encounterEntryIsPlayerVisible(entry) {
  return object(entry) && entry.kind === 'creature' && entry.playerVisible === true;
}

export function encounterIdentity(entry) {
  if (!encounterEntryIsPlayerVisible(entry)) return 'hidden';
  return ENCOUNTER_IDENTITIES.includes(entry.publicIdentity) ? entry.publicIdentity : 'revealed';
}

export function encounterImageIsPlayerVisible(entry) {
  return encounterIdentity(entry) === 'revealed' && entry.publicImageVisible === true;
}

export function normalizeEncounterEntries(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.map(entry => {
    if (!object(entry)) return entry;
    return {
      ...entry,
      playerVisible: entry.kind === 'creature' && entry.playerVisible === true,
      publicIdentity: entry.kind === 'creature' && entry.playerVisible === true
        ? (ENCOUNTER_IDENTITIES.includes(entry.publicIdentity) ? entry.publicIdentity : 'revealed')
        : 'hidden',
      publicImageVisible: entry.kind === 'creature' && entry.playerVisible === true
        && entry.publicIdentity === 'revealed' && entry.publicImageVisible === true
    };
  });
}

export function setEncounterEntryIdentity(entries, id, identity) {
  const next = ENCOUNTER_IDENTITIES.includes(identity) ? identity : 'hidden';
  return normalizeEncounterEntries(entries).map(entry => entry?.id === id && entry.kind === 'creature'
    ? { ...entry, playerVisible: next !== 'hidden', publicIdentity: next,
      publicImageVisible: next === 'revealed' && entry.publicImageVisible === true }
    : entry);
}

export function setEncounterEntryImageVisibility(entries, id, visible) {
  return normalizeEncounterEntries(entries).map(entry => entry?.id === id && entry.kind === 'creature'
    ? { ...entry, publicImageVisible: encounterIdentity(entry) === 'revealed' && visible === true }
    : entry);
}

export function setEncounterEntryVisibility(entries, id, visible) {
  return normalizeEncounterEntries(entries).map(entry => entry?.id === id && entry.kind === 'creature'
    ? { ...entry, playerVisible: visible === true,
      publicIdentity: visible === true ? encounterIdentity(entry) : 'hidden',
      publicImageVisible: visible === true && encounterImageIsPlayerVisible(entry) }
    : entry);
}
