// Single localStorage-backed state object with change subscriptions.
// Views never touch localStorage directly; they read `state` and call save().

import { normalizeCombat } from './combat-turn.js';
import { normalizeExploration } from './exploration.js';
import { normalizePlayer } from './player-state.js';

const KEY = 'pf2e-gm-toolkit/v1';

const DEFAULTS = {
  // Seeded for the Mists of Zalazar campaign; the header overrides it per session.
  party: { level: 7, size: 5, members: [] },
  encounter: { entries: [], selectedId: null, dirty: false },
  encounters: { saved: [] },        // named, deep-copied encounter templates
  combat: { round: 0, activeId: null, turnEvent: 0, combatants: [], delayedIds: [], ready: [], order: null },
  loot: { pool: [], claimed: {} },
  notes: { entries: [] },         // { id, title, body, at } — your own session notes
  sound: { url: '', saved: [] },  // Last YouTube URL and named links on this device
  characters: { extra: [] },      // PCs pasted in on this device; the repo roster is
                                  // data/characters.json
  exploration: { elapsedMinutes: 0, activities: {}, timers: [] },
  player: { entries: {} },
  ui: { group: { run: 'encounters', table: 'party' }, recent: [], pins: [] },
  // group: last sub-screen used in each group. recent: the Library's last 12 opened
  // records, newest first. pins: stable targets surfaced on Home.
};

function clone(v) { return JSON.parse(JSON.stringify(v)); }

function object(v) { return v && typeof v === 'object' && !Array.isArray(v); }

function slice(defaults, saved, arrays = []) {
  if (!object(saved)) return clone(defaults);
  const out = { ...clone(defaults), ...saved };
  for (const key of arrays) out[key] = Array.isArray(saved[key]) ? saved[key] : clone(defaults[key]);
  return out;
}

function normalizePins(pins) {
  const seen = new Set();
  return pins.flatMap(pin => {
    if (!object(pin) || typeof pin.id !== 'string' || !object(pin.target)) return [];
    const target = pin.target;
    const validReference = target.type === 'reference'
      && typeof target.category === 'string' && typeof target.id === 'string';
    const validNote = target.type === 'note' && typeof target.id === 'string';
    if (!validReference && !validNote) return [];
    const key = validReference ? `reference:${target.category}:${target.id}` : `note:${target.id}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ ...pin, target: validReference
      ? { type: 'reference', category: target.category, id: target.id }
      : { type: 'note', id: target.id }, label: typeof pin.label === 'string' ? pin.label : '' }];
  });
}

function merge(base, saved) {
  // Keep unknown fields: a newer or hand-authored save must not be silently stripped by
  // an older app. Known slices get their expected object/array shapes back.
  const out = object(saved) ? { ...clone(base), ...saved } : clone(base);
  out.party = slice(base.party, saved?.party, ['members']);
  out.encounter = slice(base.encounter, saved?.encounter, ['entries']);
  out.encounter.selectedId = typeof out.encounter.selectedId === 'string' ? out.encounter.selectedId : null;
  out.encounter.dirty = Boolean(out.encounter.dirty);
  out.encounters = slice(base.encounters, saved?.encounters, ['saved']);
  out.combat = slice(base.combat, saved?.combat, ['combatants']);
  out.loot = slice(base.loot, saved?.loot, ['pool']);
  out.loot.claimed = object(out.loot.claimed) ? out.loot.claimed : {};
  out.notes = slice(base.notes, saved?.notes, ['entries']);
  out.sound = slice(base.sound, saved?.sound, ['saved']);
  out.sound.url = typeof out.sound.url === 'string' ? out.sound.url : '';
  out.characters = slice(base.characters, saved?.characters, ['extra']);
  out.exploration = normalizeExploration(saved?.exploration);
  out.player = normalizePlayer(saved?.player);
  out.ui = slice(base.ui, saved?.ui, ['recent', 'pins']);
  out.ui.group = object(out.ui.group) ? { ...base.ui.group, ...out.ui.group } : clone(base.ui.group);
  out.ui.pins = normalizePins(out.ui.pins);
  return out;
}

/** Normalize both localStorage saves and validated portable backups. */
export function normalizeState(saved) {
  const loaded = merge(DEFAULTS, saved);
  loaded.combat = normalizeCombat(loaded.combat);
  return loaded;
}

let persistence = { kind: 'saved', message: '' };
let corruptRaw = null;
let loadProtected = false;

function setPersistence(kind, message = '') {
  persistence = { kind, message };
  persistenceListeners.forEach(fn => fn(persistence));
}

function load() {
  let raw = null;
  try {
    raw = localStorage.getItem(KEY);
    return normalizeState(JSON.parse(raw || 'null'));
  } catch (error) {
    // Do not overwrite malformed data on an unrelated navigation. Keep its exact text
    // available for recovery; reset() is the deliberate escape hatch.
    corruptRaw = raw;
    loadProtected = true;
    persistence = { kind: 'load-error', message: 'Saved data could not be read. It has not been replaced.' };
    const fresh = clone(DEFAULTS);
    fresh.combat = normalizeCombat(fresh.combat);
    return fresh;
  }
}

export const state = load();

const listeners = new Set();
const persistenceListeners = new Set();
const resetHooks = new Set();

/** Persist state and notify subscribers. Call after every mutation. */
export function save() {
  let saved = false;
  try {
    if (loadProtected) throw new Error('Saved data needs recovery or reset first.');
    localStorage.setItem(KEY, JSON.stringify(state));
    saved = true;
    setPersistence('saved', 'Saved');
  } catch (e) {
    setPersistence(loadProtected ? 'load-error' : 'unsaved', loadProtected
      ? 'Saved data could not be read. Download it or reset before saving.'
      : 'Changes are still in this session but could not be saved.');
  }
  listeners.forEach(fn => fn(state));
  return saved;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Subscribe to persistence only. Status changes never cause a view re-render. */
export function subscribePersistence(fn) {
  persistenceListeners.add(fn);
  fn(persistence);
  return () => persistenceListeners.delete(fn);
}

export function persistenceStatus() { return { ...persistence }; }

/** A portable serialization of the live session, available even when storage is blocked. */
export function serializeState() { return JSON.stringify(state, null, 2); }

/** The untouched malformed value, if loading failed; null for ordinary storage failures. */
export function corruptSavedData() { return corruptRaw; }

/**
 * Replace the session only after the complete candidate is successfully persisted.
 * This intentionally bypasses load protection: restoring a reviewed backup is the
 * explicit replacement choice that an incidental navigation save is not.
 */
export function restoreState(candidate) {
  const next = normalizeState(candidate);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    setPersistence('unsaved', 'Backup was checked, but this device could not save it. Current data is unchanged.');
    return false;
  }
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, next);
  corruptRaw = null;
  loadProtected = false;
  resetHooks.forEach(fn => fn());
  setPersistence('saved', 'Saved');
  listeners.forEach(fn => fn(state));
  return true;
}

/** Let transient feature histories clear when the whole state is reset. */
export function registerResetHook(fn) {
  resetHooks.add(fn);
  return () => resetHooks.delete(fn);
}

export function reset() {
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, clone(DEFAULTS));
  state.combat = normalizeCombat(state.combat);
  corruptRaw = null;
  loadProtected = false;
  resetHooks.forEach(fn => fn());
  return save();
}

let seq = 0;
export function uid(prefix = 'id') {
  seq += 1;
  return prefix + '-' + Date.now().toString(36) + '-' + seq;
}
