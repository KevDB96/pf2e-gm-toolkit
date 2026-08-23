// Shell: owns the party header, the tab bar, and dispatching to a view module.

import { state, save, subscribe } from './store.js';
import { qs, qsa, installTips } from './dom.js';
import * as home from './views/home.js';
import * as encounters from './views/encounters.js';
import * as combat from './views/combat.js';
import * as library from './views/library.js';
import * as loot from './views/loot.js';
import * as notes from './views/notes.js';
import * as party from './views/party.js';

const VIEWS = {
  home:       { title: 'PF2e GM',    mod: home },
  encounters: { title: 'Encounters', mod: encounters },
  combat:     { title: 'Combat',     mod: combat },
  library:    { title: 'Library',    mod: library },
  loot:       { title: 'Loot',       mod: loot },
  notes:      { title: 'Campaign',   mod: notes },
  party:      { title: 'Party',      mod: party }
};

let root = qs('#view');
let current = null;

function viewFromHash() {
  const name = location.hash.replace(/^#\/?/, '');
  return VIEWS[name] ? name : 'home';
}

/**
 * A brand new host element for the next view.
 *
 * A view delegates its events from the node it is handed, and those listeners sit on the
 * node itself — clearing `innerHTML` does not touch them. Reusing one node therefore
 * stacked a fresh set of handlers on every mount: after leaving Combat and coming back,
 * one tap on "+ condition" opened two sheets (closing one left the other behind, which
 * read as a sheet that would not close), and −1 HP took off as many points as the view had
 * been mounted. Swapping in a new node lets the old view's listeners go with the old one.
 */
function freshRoot() {
  const next = document.createElement('section');
  next.id = 'view';
  next.className = 'view';
  next.setAttribute('aria-live', 'polite');
  root.replaceWith(next);
  root = next;
  return next;
}

function render() {
  const name = viewFromHash();
  qs('#view-title').textContent = VIEWS[name].title;
  qsa('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
  if (current !== name) {
    current = name;
    VIEWS[name].mod.mount(freshRoot());
  } else {
    VIEWS[name].mod.update?.(root);
  }
}

// --- party header ---------------------------------------------------------
function bindParty() {
  const level = qs('#party-level');
  const size = qs('#party-size');
  level.value = state.party.level;
  size.value = state.party.size;
  const commit = () => {
    state.party.level = clamp(Number(level.value), 1, 20);
    state.party.size = clamp(Number(size.value), 1, 8);
    level.value = state.party.level;
    size.value = state.party.size;
    save();
  };
  level.addEventListener('change', commit);
  size.addEventListener('change', commit);
}

function clamp(n, lo, hi) {
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
}

// --- boot ----------------------------------------------------------------
qsa('.tab').forEach(tab => {
  tab.addEventListener('click', () => { location.hash = '#/' + tab.dataset.view; });
});
window.addEventListener('hashchange', render);
subscribe(() => VIEWS[current]?.mod.update?.(root));

bindParty();
installTips();
render();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
}
