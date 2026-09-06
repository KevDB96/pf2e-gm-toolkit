// Shell: owns the party header, the tab bar, and dispatching to a view module.

import { state, save, reset, subscribe, subscribePersistence, serializeState } from './store.js';
import { qs, qsa, installTips } from './dom.js';
import { keepAwake } from './wake.js';
import { bindPlayerBroadcast } from './player-channel.js';
import * as home from './views/home.js';
import * as encounters from './views/encounters.js';
import * as combat from './views/combat.js';
import * as library from './views/library.js';
import * as loot from './views/loot.js';
import * as notes from './views/notes.js';
import * as party from './views/party.js';
import * as sound from './views/sound.js';

const VIEWS = {
  home:       { title: 'PF2e GM',    mod: home },
  encounters: { title: 'Encounters', mod: encounters },
  combat:     { title: 'Combat',     mod: combat },
  library:    { title: 'Library',    mod: library },
  loot:       { title: 'Loot',       mod: loot },
  notes:      { title: 'Campaign',   mod: notes },
  party:      { title: 'Party',      mod: party },
  sound:      { title: 'BGM',        mod: sound }
};

// A tab that opens more than one screen: the strip below the header switches between
// its members. `views` order is the order the sub-strip renders in.
const GROUPS = {
  run:   { title: 'Run',   views: ['encounters', 'combat'] },
  table: { title: 'Table', views: ['party', 'loot', 'notes'] }
};

/** The group id holding a view, or null if the view has its own tab. */
function groupOf(view) {
  for (const [id, g] of Object.entries(GROUPS)) {
    if (g.views.includes(view)) return id;
  }
  return null;
}

let root = qs('#view');
let current = null;

function viewFromHash() {
  const name = location.hash.replace(/^#\/?/, '');
  if (VIEWS[name]) return name;
  // A group hash (#/run, #/table) resolves to that group's remembered member — never
  // by reassigning location.hash here, which would fire another hashchange and re-enter
  // render() for something that already resolves cleanly in one pass.
  const g = GROUPS[name];
  if (g) {
    const remembered = state.ui.group[name];
    return g.views.includes(remembered) ? remembered : g.views[0];
  }
  return 'home';
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
  const gid = groupOf(name);

  if (current !== name) {
    current = name;
    VIEWS[name].mod.mount(freshRoot());
  } else {
    VIEWS[name].mod.update?.(root);
  }

  const subnav = qs('#subnav');
  if (gid) {
    qs('#view-title').textContent = GROUPS[gid].title;
    subnav.innerHTML = GROUPS[gid].views.map(v =>
      `<button class="pick${v === name ? ' on' : ''}" data-view="${v}" role="tab" aria-selected="${v === name}">${VIEWS[v].title}</button>`
    ).join('');
    subnav.hidden = false;
    // Remember this group's last sub-screen, but only persist when it actually changed —
    // save() notifies every subscriber, and calling it on every render is pointless churn.
    if (state.ui.group[gid] !== name) {
      state.ui.group[gid] = name;
      save();
    }
  } else {
    qs('#view-title').textContent = VIEWS[name].title;
    subnav.hidden = true;
  }

  qsa('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === name || t.dataset.view === gid));

  // Combat and BGM are the two screens a GM leaves open on the table; Home and the
  // Library do not need to burn battery holding the phone awake.
  keepAwake(name === 'combat' || name === 'sound');
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

function downloadCurrentData() {
  const blob = new Blob([serializeState()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'pf2e-gm-toolkit-recovery.json';
  link.click();
  URL.revokeObjectURL(url);
}

function bindPersistence() {
  const box = qs('#persistence');
  const message = qs('[data-persistence-message]', box);
  const retry = qs('[data-persistence-retry]', box);
  const download = qs('[data-persistence-download]', box);
  const startFresh = qs('[data-persistence-reset]', box);
  retry.addEventListener('click', () => save());
  download.addEventListener('click', downloadCurrentData);
  startFresh.addEventListener('click', () => {
    if (window.confirm('This replaces the unreadable saved data with a new empty session. Download recovery data first if you need it.')) reset();
  });
  subscribePersistence(status => {
    const failed = status.kind !== 'saved';
    box.hidden = false;
    box.classList.toggle('error', failed);
    box.classList.toggle('saved', !failed);
    message.textContent = failed ? status.message : 'Saved';
    retry.hidden = status.kind !== 'unsaved';
    download.hidden = !failed;
    startFresh.hidden = status.kind !== 'load-error';
  });
}

// --- boot ----------------------------------------------------------------
qsa('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const v = tab.dataset.view;
    const g = GROUPS[v];
    const remembered = g && state.ui.group[v];
    location.hash = '#/' + (g ? (g.views.includes(remembered) ? remembered : g.views[0]) : v);
  });
});

// #subnav is a persistent node — see CLAUDE.md — so its listener is bound exactly once
// here at boot via delegation, never inside render(), even though its buttons are
// replaced by innerHTML on every render.
qs('#subnav').addEventListener('click', (e) => {
  const btn = e.target.closest('.pick');
  if (btn) location.hash = '#/' + btn.dataset.view;
});
window.addEventListener('hashchange', render);
subscribe(() => {
  // A backup replacement updates the state object in place, so the persistent header
  // needs this small direct sync too; persistence status itself uses a different channel.
  qs('#party-level').value = state.party.level;
  qs('#party-size').value = state.party.size;
  VIEWS[current]?.mod.update?.(root);
});

bindParty();
bindPersistence();
bindPlayerBroadcast();
installTips();
render();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
}
