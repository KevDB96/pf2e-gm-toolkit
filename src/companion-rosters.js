// Campaign-scoped links to characters owned by the PF2e Player Companion.
//
// A link contains only the Companion character's stable public id.  The GM
// Toolkit never copies a shared character into a native roster, so assigning a
// character cannot create a second identity or expose Companion-private data.

import {
  PUBLIC_CHARACTER_CONTRACT,
  PUBLIC_CHARACTER_VERSION,
  adaptCompanionCharacter
} from './companion-characters.js';
import { revisionOf, sameCharacter } from './character-revisions.js';

const EMPTY = Object.freeze({ characters: [], assignments: {}, annotations: {} });

const object = value => value && typeof value === 'object' && !Array.isArray(value);

function id(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function publicRecord(record) {
  const character = adaptCompanionCharacter(record);
  if (!character) return null;
  return {
    contract: PUBLIC_CHARACTER_CONTRACT,
    version: PUBLIC_CHARACTER_VERSION,
    character,
    revision: revisionOf(record)
  };
}

function uniqueRecords(records) {
  const seen = new Set();
  return (Array.isArray(records) ? records : []).flatMap(record => {
    const clean = publicRecord(record);
    if (!clean || seen.has(clean.character.id)) return [];
    seen.add(clean.character.id);
    return [clean];
  });
}

function uniqueIds(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).flatMap(value => {
    const valueId = id(value);
    if (!valueId || seen.has(valueId)) return [];
    seen.add(valueId);
    return [valueId];
  });
}

/** Normalize saved shared-character records and campaign links. */
export function normalizeCompanionRosterState(saved) {
  if (!object(saved)) return { ...EMPTY, assignments: {}, annotations: {} };
  const characters = uniqueRecords(saved.characters);
  const known = new Set(characters.map(record => record.character.id));
  const assignments = {};
  if (object(saved.assignments)) {
    for (const [campaignId, ids] of Object.entries(saved.assignments)) {
      const cleanCampaignId = id(campaignId);
      if (!cleanCampaignId) continue;
      const links = uniqueIds(ids).filter(characterId => known.has(characterId));
      if (links.length) assignments[cleanCampaignId] = links;
    }
  }
  const annotations = {};
  if (object(saved.annotations)) {
    for (const [characterId, value] of Object.entries(saved.annotations)) {
      if (!known.has(characterId) || !object(value)) continue;
      const note = typeof value.note === 'string' ? value.note.slice(0, 2000).trim() : '';
      if (note) annotations[characterId] = { note };
    }
  }
  return { characters, assignments, annotations };
}

/** Add or refresh a shared character link for exactly one campaign. */
export function assignCompanionCharacter(saved, campaignId, record) {
  const campaign = id(campaignId);
  const clean = publicRecord(record);
  if (!campaign || !clean) return normalizeCompanionRosterState(saved);

  const next = normalizeCompanionRosterState(saved);
  const index = next.characters.findIndex(item => item.character.id === clean.character.id);
  const current = index === -1 ? null : next.characters[index];
  clean.revision = current && sameCharacter(current.character, clean.character)
    ? current.revision : Math.max(clean.revision, (current?.revision || -1) + 1);
  if (index === -1) next.characters.push(clean);
  else next.characters[index] = clean;
  const links = next.assignments[campaign] || [];
  if (!links.includes(clean.character.id)) next.assignments[campaign] = [...links, clean.character.id];
  return next;
}

/**
 * Apply a shared-character refresh only against the revision the GM read.
 * A conflict returns the untouched normalized state and the newer record so a
 * caller can refresh and retry without overwriting player-owned changes.
 */
export function updateCompanionCharacter(saved, campaignId, record, expectedRevision) {
  const campaign = id(campaignId);
  const clean = publicRecord(record);
  const next = normalizeCompanionRosterState(saved);
  if (!campaign || !clean) return { ok: false, status: 'invalid', state: next };

  const index = next.characters.findIndex(item => item.character.id === clean.character.id);
  const current = index === -1 ? null : next.characters[index];
  const actualRevision = current?.revision ?? 0;
  if (current && expectedRevision !== actualRevision) {
    return { ok: false, status: 'conflict', state: next, current, actualRevision };
  }
  if (!current && expectedRevision !== undefined && expectedRevision !== 0) {
    return { ok: false, status: 'conflict', state: next, current: null, actualRevision: 0 };
  }
  if (current && sameCharacter(current.character, clean.character)) {
    const links = next.assignments[campaign] || [];
    if (!links.includes(clean.character.id)) next.assignments[campaign] = [...links, clean.character.id];
    return { ok: true, status: 'unchanged', state: next, record: current, revision: actualRevision };
  }

  clean.revision = Math.max(clean.revision, actualRevision + (current ? 1 : 0));
  if (index === -1) next.characters.push(clean);
  else next.characters[index] = clean;
  const links = next.assignments[campaign] || [];
  if (!links.includes(clean.character.id)) next.assignments[campaign] = [...links, clean.character.id];
  return { ok: true, status: current ? 'updated' : 'added', state: next, record: clean, revision: clean.revision };
}

/** Remove one campaign link without deleting the shared character itself. */
export function unassignCompanionCharacter(saved, campaignId, characterId) {
  const campaign = id(campaignId);
  const sharedId = id(characterId);
  const next = normalizeCompanionRosterState(saved);
  if (!campaign || !sharedId || !next.assignments[campaign]) return next;
  const links = next.assignments[campaign].filter(value => value !== sharedId);
  if (links.length) next.assignments[campaign] = links;
  else delete next.assignments[campaign];
  return next;
}

/** Return shared public characters linked to one campaign, never another campaign. */
export function companionCharactersForCampaign(saved, campaignId) {
  const campaign = id(campaignId);
  const next = normalizeCompanionRosterState(saved);
  const records = new Map(next.characters.map(record => [record.character.id, record.character]));
  return (next.assignments[campaign] || []).flatMap(characterId => {
    const character = records.get(characterId);
    return character ? [character] : [];
  });
}

/** Return each campaign's linked public characters for a GM read view. */
export function companionCharactersByCampaign(saved) {
  const next = normalizeCompanionRosterState(saved);
  const records = new Map(next.characters.map(record => [record.character.id, record.character]));
  return Object.entries(next.assignments).map(([campaignId, ids]) => ({
    campaignId,
    characters: ids.flatMap(characterId => {
      const character = records.get(characterId);
      return character ? [character] : [];
    })
  })).filter(group => group.characters.length);
}

/** Read one explicitly GM-owned annotation; Companion fields never enter this result. */
export function companionAnnotation(saved, characterId) {
  const next = normalizeCompanionRosterState(saved);
  return next.annotations[characterId]?.note || '';
}

/** Merge a campaign's shared links with native records without duplicate IDs. */
export function campaignRoster(nativeCharacters, saved, campaignId) {
  const result = [];
  const seen = new Set();
  for (const character of Array.isArray(nativeCharacters) ? nativeCharacters : []) {
    const characterId = id(character?.id);
    if (!characterId || seen.has(characterId)) continue;
    seen.add(characterId);
    result.push(character);
  }
  for (const character of companionCharactersForCampaign(saved, campaignId)) {
    if (seen.has(character.id)) continue;
    seen.add(character.id);
    result.push(character);
  }
  return result;
}
