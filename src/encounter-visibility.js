// GM-owned encounter visibility. Missing or malformed values fail closed.

const object = value => value && typeof value === 'object' && !Array.isArray(value);

export function encounterEntryIsPlayerVisible(entry) {
  return object(entry) && entry.kind === 'creature' && entry.playerVisible === true;
}

export function normalizeEncounterEntries(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.map(entry => {
    if (!object(entry)) return entry;
    return {
      ...entry,
      playerVisible: entry.kind === 'creature' && entry.playerVisible === true
    };
  });
}

export function setEncounterEntryVisibility(entries, id, visible) {
  return normalizeEncounterEntries(entries).map(entry => entry?.id === id && entry.kind === 'creature'
    ? { ...entry, playerVisible: visible === true }
    : entry);
}
