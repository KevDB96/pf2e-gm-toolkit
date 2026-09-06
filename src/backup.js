// Portable device-state backups. This module is pure so file input and store writes stay
// at the edges, and a backup can be fully checked before it touches the live session.

export const BACKUP_FORMAT = 'pf2e-gm-toolkit-backup';
// v5 adds the persisted exploration clock. Earlier envelopes remain valid: store normalization
// supplies their missing slices and migrates older condition chips.
export const BACKUP_SCHEMA = 7;
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const byteLength = text => new TextEncoder().encode(text).length;
const unsafeKey = key => key === '__proto__' || key === 'prototype' || key === 'constructor';

function safeKeys(value) {
  if (!value || typeof value !== 'object') return true;
  for (const [key, child] of Object.entries(value)) {
    if (unsafeKey(key) || !safeKeys(child)) return false;
  }
  return true;
}

function expectObject(state, key) {
  if (!object(state[key])) throw new Error(`Backup ${key} is missing or invalid.`);
}

function expectArray(section, key, label) {
  if (!Array.isArray(section[key])) throw new Error(`Backup ${label || key} is missing or invalid.`);
}

/** Parse and structurally validate a version-one backup before store normalization. */
export function readBackup(text) {
  if (typeof text !== 'string' || byteLength(text) > MAX_BACKUP_BYTES) {
    throw new Error('That backup is too large to safely restore on this device.');
  }
  let envelope;
  try { envelope = JSON.parse(text); } catch { throw new Error('That file is not valid JSON.'); }
  if (!object(envelope) || !safeKeys(envelope)) throw new Error('That backup has an unsafe structure.');
  if (envelope.format !== BACKUP_FORMAT) throw new Error('That file is not a PF2e GM Toolkit backup.');
  if (!Number.isInteger(envelope.schemaVersion) || envelope.schemaVersion > BACKUP_SCHEMA) {
    throw new Error('That backup needs a newer version of the toolkit.');
  }
  if (envelope.schemaVersion < 1 || typeof envelope.exportedAt !== 'string'
      || !Number.isFinite(Date.parse(envelope.exportedAt)) || !object(envelope.state)) {
    throw new Error('That backup is incomplete.');
  }

  const state = envelope.state;
  for (const key of ['party', 'encounter', 'combat', 'loot', 'notes', 'sound', 'characters', 'ui']) expectObject(state, key);
  // A v5 envelope made by an older edge can omit the optional new slice; store
  // normalization supplies the empty clock while preserving the rest of the backup.
  if (envelope.schemaVersion >= 3) expectObject(state, 'encounters');
  expectArray(state.encounter, 'entries', 'encounter.entries');
  if (envelope.schemaVersion >= 3) expectArray(state.encounters, 'saved', 'encounters.saved');
  expectArray(state.combat, 'combatants', 'combat.combatants');
  expectArray(state.loot, 'pool', 'loot.pool');
  expectArray(state.notes, 'entries', 'notes.entries');
  expectArray(state.sound, 'saved', 'sound.saved');
  expectArray(state.characters, 'extra', 'characters.extra');
  expectArray(state.ui, 'recent', 'ui.recent');
  if (envelope.schemaVersion >= 4) expectArray(state.ui, 'pins', 'ui.pins');
  if (envelope.schemaVersion >= 5 && state.exploration) {
    expectObject(state.exploration, 'activities');
    expectArray(state.exploration, 'timers', 'exploration.timers');
  }
  if (envelope.schemaVersion >= 6) {
    expectArray(state.combat, 'delayedIds', 'combat.delayedIds');
    expectArray(state.combat, 'ready', 'combat.ready');
  }
  if (envelope.schemaVersion >= 7) expectObject(state, 'player');
  if (state.party.members !== undefined && !Array.isArray(state.party.members)) {
    throw new Error('Backup party members are invalid.');
  }
  return envelope;
}

export function makeBackup(state, exportedAt = new Date().toISOString()) {
  return JSON.stringify({
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA,
    exportedAt,
    state
  }, null, 2);
}

export function backupSummary(state) {
  return {
    notes: state.notes.entries.length,
    characters: state.characters.extra.length,
    planned: state.encounter.entries.length,
    savedEncounters: state.encounters?.saved?.length || 0,
    pins: state.ui?.pins?.length || 0,
    timers: state.exploration?.timers?.length || 0,
    combatants: state.combat.combatants.length,
    loot: state.loot.pool.length,
    tracks: state.sound.saved.length
  };
}
