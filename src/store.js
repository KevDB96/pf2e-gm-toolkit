// Single localStorage-backed state object with change subscriptions.
// Views never touch localStorage directly; they read `state` and call save().

const KEY = 'pf2e-gm-toolkit/v1';

const DEFAULTS = {
  // Seeded for the Mists of Zalazar campaign; the header overrides it per session.
  party: { level: 7, size: 5, members: [] },
  encounter: { entries: [] },       // { id, name, level, count, kind: 'creature'|'simple'|'complex' }
  combat: { round: 0, active: 0, combatants: [] },
  loot: { pool: [], claimed: {} },
  notes: { entries: [] },         // { id, title, body, at } — your own session notes
  sound: { url: '', saved: [] },  // Last YouTube URL and named links on this device
  characters: { extra: [] },      // PCs pasted in on this device; the repo roster is
                                  // data/characters.json
};

function clone(v) { return JSON.parse(JSON.stringify(v)); }

function merge(base, saved) {
  const out = clone(base);
  if (!saved || typeof saved !== 'object') return out;
  for (const k of Object.keys(out)) {
    if (saved[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      out[k] = { ...out[k], ...saved[k] };
    } else if (saved[k] !== undefined) {
      out[k] = saved[k];
    }
  }
  return out;
}

function load() {
  try {
    return merge(DEFAULTS, JSON.parse(localStorage.getItem(KEY) || 'null'));
  } catch {
    return clone(DEFAULTS);
  }
}

export const state = load();

const listeners = new Set();

/** Persist state and notify subscribers. Call after every mutation. */
export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Could not persist state', e);
  }
  listeners.forEach(fn => fn(state));
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function reset() {
  Object.assign(state, clone(DEFAULTS));
  save();
}

let seq = 0;
export function uid(prefix = 'id') {
  seq += 1;
  return prefix + '-' + Date.now().toString(36) + '-' + seq;
}
