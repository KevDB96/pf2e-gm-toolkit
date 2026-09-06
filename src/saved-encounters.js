// Pure saved-encounter transformations. Templates are copies, never aliases of the
// working draft, so launching or editing a fight cannot alter a saved preparation.
const clone = value => JSON.parse(JSON.stringify(value));

export function copyEncounterEntries(entries, makeId) {
  return (entries || []).map(entry => ({ ...clone(entry), id: makeId('enc') }));
}

export function savedEncounter({ id, title, notes = '', entries, party, now }) {
  return {
    id,
    title: String(title || 'Untitled encounter').trim() || 'Untitled encounter',
    notes: String(notes || ''),
    createdAt: now,
    updatedAt: now,
    party: { level: party.level, size: party.size },
    entries: clone(entries || [])
  };
}

export function updatedEncounter(saved, { entries, party, now }) {
  return { ...clone(saved), entries: clone(entries || []),
    party: { level: party.level, size: party.size }, updatedAt: now };
}

export function templateWarnings(template) {
  return (template.entries || []).filter(entry =>
    (entry.creature?.id && !entry.creature?.name) || (entry.hazard?.id && !entry.hazard?.name)
  ).map(entry => entry.name || 'Unnamed entry');
}
