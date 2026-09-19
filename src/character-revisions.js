// Optimistic revision helpers for character records.
//
// Revisions are GM-side coordination metadata. They are never part of the
// public Companion character projection.

const object = value => value && typeof value === 'object' && !Array.isArray(value);

export function revisionOf(value) {
  return Number.isInteger(value?.revision) && value.revision >= 0 ? value.revision : 0;
}

function withoutRevision(value) {
  if (!object(value)) return value;
  const { revision, ...rest } = value;
  return rest;
}

function sameValue(left, right) {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((value, index) => sameValue(value, right[index]));
  }
  if (object(left) || object(right)) {
    if (!object(left) || !object(right)) return false;
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    return keys.every(key => sameValue(left[key], right[key]));
  }
  return false;
}

export function sameCharacter(left, right) {
  return sameValue(withoutRevision(left), withoutRevision(right));
}

/**
 * Merge one imported character into a character file using an optional
 * optimistic revision. The input is never mutated. A repeated identical
 * import is an explicit no-op, which makes retries safe.
 */
export function mergeCharacterImport(file, character, { expectedRevision } = {}) {
  const base = object(file) ? file : {};
  const characters = Array.isArray(base.characters) ? base.characters : [];
  const index = characters.findIndex(item => item?.id === character?.id);
  const current = index === -1 ? null : characters[index];
  const currentRevision = revisionOf(current);

  if (current && expectedRevision !== undefined && expectedRevision !== currentRevision) {
    return {
      ok: false,
      status: 'conflict',
      expectedRevision,
      currentRevision,
      current,
      file: base
    };
  }

  if (current && sameCharacter(current, character)) {
    return { ok: true, status: 'unchanged', revision: currentRevision, character: current, file: base };
  }

  const nextRevision = current ? Math.max(currentRevision + 1, revisionOf(character)) : revisionOf(character);
  const nextCharacter = { ...character, revision: nextRevision };
  const nextCharacters = characters.slice();
  if (index === -1) nextCharacters.push(nextCharacter);
  else nextCharacters[index] = nextCharacter;
  return {
    ok: true,
    status: current ? 'updated' : 'added',
    revision: nextRevision,
    character: nextCharacter,
    file: { ...base, characters: nextCharacters }
  };
}
