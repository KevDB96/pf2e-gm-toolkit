// Adapter for records shared by the PF2e Player Companion.
//
// The Companion may carry ownership and GM annotations beside the public
// character envelope.  Those fields are deliberately never copied here.

export const PUBLIC_CHARACTER_CONTRACT = 'pf2e-companion/public-character';
export const PUBLIC_CHARACTER_VERSION = 1;

const object = value => value && typeof value === 'object' && !Array.isArray(value);

function text(value, max = 80) {
  return typeof value === 'string' ? value.slice(0, max).trim() : '';
}

function publicSource(record) {
  if (!object(record)) return null;
  if (record.contract === PUBLIC_CHARACTER_CONTRACT) {
    if (record.version !== PUBLIC_CHARACTER_VERSION || !object(record.character)) return null;
    return record.character;
  }
  if (object(record.publicCharacter)) return record.publicCharacter;
  if (object(record.public)) return record.public;
  return null;
}

/**
 * Convert one Companion/shared-character record to the public session shape.
 * Ownership, annotations, and character mechanics remain outside the result.
 */
export function adaptCompanionCharacter(record) {
  const source = publicSource(record);
  if (!source) return null;
  const id = text(source.id || source.characterId || record.id);
  const name = text(source.name);
  if (!id || !name) return null;

  const character = { id, name };
  if (Number.isInteger(source.level) && source.level >= -1 && source.level <= 30) {
    character.level = source.level;
  }
  for (const field of ['class', 'ancestry']) {
    const value = text(source[field]);
    if (value) character[field] = value;
  }
  return character;
}

/** Resolve a shared character by its stable public id, never by its name. */
export function resolveCompanionCharacter(records, id) {
  if (!Array.isArray(records) || typeof id !== 'string' || !id.trim()) return null;
  for (const record of records) {
    const character = adaptCompanionCharacter(record);
    if (character?.id === id) return character;
  }
  return null;
}
