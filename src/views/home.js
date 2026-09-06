// Home: the launcher. One tile per screen, each showing what is waiting there.

import { state, normalizeState, restoreState } from '../store.js';
import { backupSummary, makeBackup, readBackup } from '../backup.js';
import { closeSheets, esc, on, qs, sheet } from '../dom.js';
import { threatFor } from '../pf2e.js';
import { manifest, campaign, characters } from '../data.js';
import { cancelOfflineDownload, listenOffline, offlineDownload, offlineStatus, requestPersistentStorage, storageStatus } from '../offline.js';
import { totalXP } from './encounters.js';
import * as library from './library.js';
import * as notes from './notes.js';
import { movePin, removePin } from '../pins.js';
import { openGMReference } from '../gm-reference.js';

const HOME_RECENT = 5;   // how many of the Library's recents to surface on Home
const HOME_PINS = 4;

const TILES = [
  { view: 'encounters', glyph: '⚔', title: 'Encounters' },
  { view: 'combat', glyph: '\u{1F3B2}', title: 'Combat' },
  { view: 'library', glyph: '\u{1F4D6}', title: 'Library' },
  { view: 'loot', glyph: '\u{1F4B0}', title: 'Loot' },
  { view: 'notes', glyph: '\u{1F4DC}', title: 'Campaign' },
  { view: 'party', glyph: '\u{1F465}', title: 'Party' },
  { view: 'sound', glyph: '\u266B', title: 'BGM' }
];

// Filled in once the manifest and campaign file resolve; null means "still loading".
let libraryCount = null;
let currentArc = null;
let roster = null;

function plural(n, word, many = word + 's') {
  return `${n} ${n === 1 ? word : many}`;
}

function status(view) {
  const { level, size } = state.party;

  if (view === 'sound') {
    return 'Open saved tracks in YouTube';
  }

  if (view === 'encounters') {
    const entries = state.encounter.entries;
    if (!entries.length) return 'Nothing planned';
    const heads = entries.reduce((n, e) => n + e.count, 0);
    const xp = totalXP(level);
    return `${heads} on the roster · ${xp} XP · ${threatFor(xp, size)}`;
  }

  if (view === 'combat') {
    const list = state.combat.combatants;
    if (!list.length) return 'No combatants';
    if (!state.combat.round) return `${plural(list.length, 'combatant')} ready`;
    return `Round ${state.combat.round} · ${plural(list.length, 'combatant')}`;
  }

  if (view === 'library') {
    return libraryCount === null
      ? 'Loading…'
      : `${libraryCount.toLocaleString()} entries on file`;
  }

  if (view === 'party') {
    if (roster === null) return 'Loading…';
    const here = roster.filter(c => c.group === 'mists-of-zalazar').length;
    const total = roster.length + state.characters.extra.length;
    if (!total) return 'No characters yet';
    return `${plural(here, 'PC')} in the campaign` +
      (total > here ? ` · ${total - here} elsewhere` : '');
  }

  if (view === 'notes') {
    const n = state.notes.entries.length;
    const kept = n ? ` · ${plural(n, 'note')}` : '';
    return (currentArc || 'Campaign') + kept;
  }

  const pool = state.loot.pool;
  if (!pool.length) return 'Hoard empty';
  const gp = pool.reduce((sum, i) => sum + (Number(i.value) || 0), 0);
  const unclaimed = pool.filter(i => !i.owner).length;
  return `${plural(pool.length, 'item')} · ${Math.round(gp)} gp`
    + (unclaimed ? ` · ${unclaimed} unclaimed` : '');
}

export function mount(root) {
  root.innerHTML = `
    <div class="menu" id="menu">${TILES.map(tile).join('')}</div>
    <div class="home-tools">
      <button class="data-manage" data-gm-reference>GM reference</button>
      <button class="data-manage" data-offline>Offline data</button>
      <button class="data-manage" data-data>Manage backup &amp; restore</button>
    </div>
    <div class="session-pins" id="pins" hidden></div>
    <div class="picker" id="recent" hidden></div>
    <div class="empty" id="party-note"></div>`;

  on(root, 'click', '[data-go]', (e, el) => { location.hash = '#/' + el.dataset.go; });
  on(root, 'click', '[data-recent-cat]', (e, el) => {
    library.openRecord(el.dataset.recentCat, el.dataset.recentId);
    location.hash = '#/library';
  });
  on(root, 'click', '[data-pin-open]', (e, el) => {
    const pin = state.ui.pins.find(item => item.id === el.dataset.pinOpen);
    if (pin) openPin(pin);
  });
  on(root, 'click', '[data-manage-pins]', openPinManager);
  on(root, 'click', '[data-data]', openDataManager);
  on(root, 'click', '[data-offline]', openOfflineData);
  on(root, 'click', '[data-gm-reference]', openGMReference);

  if (libraryCount === null) {
    manifest().then(cats => {
      libraryCount = cats.reduce((n, c) => n + (c.count || 0), 0);
      if (qs('#menu', root)) update(root);
    });
  }
  if (roster === null) {
    characters().then(file => {
      roster = file?.characters || [];
      if (qs('#menu', root)) update(root);
    });
  }
  if (currentArc === null) {
    campaign().then(c => {
      currentArc = c?.arcs?.find(a => a.id === c.current?.arc)?.title || '';
      if (qs('#menu', root)) update(root);
    });
  }

  drawRecent(root);
  update(root);
}

const bytes = n => n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil((n || 0) / 1024)} KB`;
const statusText = status => ({ ready: 'Available', older: 'Older copy', missing: 'Missing',
  downloading: 'Downloading', failed: 'Failed' }[status] || 'Unavailable');

function openOfflineData() {
  let snapshot = null;
  let job = null;
  let stop = () => {};
  const { node } = sheet('Offline data', '<div data-offline-body class="empty">Checking saved data…</div>', null, () => stop());
  const render = async () => {
    const storage = await storageStatus();
    if (!node.isConnected) return;
    if (!snapshot?.supported) {
      node.querySelector('[data-offline-body]').innerHTML = 'Offline controls need an active service worker. Reload while online, then try again.';
      return;
    }
    const categories = await manifest();
    if (!node.isConnected) return;
    const names = new Map(categories.map(c => [c.file, c]));
    const rows = snapshot.categories.map(item => ({ ...item, category: names.get(item.file) }));
    const missing = rows.filter(r => r.status === 'missing' || r.status === 'older');
    const total = missing.reduce((sum, r) => sum + r.bytes, 0);
    const progress = job ? `<p class="muted">${job.completed || 0} of ${job.total || 0} complete${job.failed?.length ? ` · ${job.failed.length} failed` : ''}</p>` : '';
    node.querySelector('[data-offline-body]').className = '';
    node.querySelector('[data-offline-body]').innerHTML = `
      <p class="muted">Rules data is verified from this device’s cache. Music in YouTube and full Archives of Nethys pages still need internet.</p>
      <div class="offline-core"><b>Core files</b>${snapshot.core.map(item => `<span>${esc(item.file.replace('.json', ''))} · ${statusText(item.status)}</span>`).join('')}</div>
      <div class="row spread"><span><b>${missing.length ? `${missing.length} to save` : 'All reference data saved'}</b><br><span class="muted">${missing.length ? bytes(total) : 'Ready for offline use'}</span></span>
        ${job ? `<button class="ghost" data-cancel>Stop</button>` : missing.length ? `<button class="primary" data-download ${navigator.onLine ? '' : 'disabled'}>Download missing</button>` : ''}</div>
      ${progress}
      <div class="offline-list">${rows.map(item => `<div class="offline-row"><span>${esc(item.category?.label || item.file)}</span><span class="muted">${bytes(item.bytes)}</span><b class="offline-${item.status}">${statusText(item.status)}</b></div>`).join('')}</div>
      <div class="row spread offline-storage"><span class="muted">Storage ${storage.usage !== undefined ? `${bytes(storage.usage)} used${storage.quota ? ` of ${bytes(storage.quota)}` : ''}` : 'estimate unavailable'}${storage.persisted ? ' · protected where supported' : ''}</span>
        ${storage.persisted === false ? '<button class="ghost" data-persist>Ask browser to protect</button>' : ''}</div>
      <p class="muted" style="font-size:.76rem">Protection is a browser request, not a guarantee; browser storage can still be cleared by its settings.</p>`;
    node.querySelector('[data-download]')?.addEventListener('click', async () => {
      const id = `offline-${Date.now()}`;
      job = { id, total: missing.length, completed: 0, failed: [] };
      await offlineDownload(missing.map(item => item.file), id);
      render();
    });
    node.querySelector('[data-cancel]')?.addEventListener('click', () => cancelOfflineDownload(job.id));
    node.querySelector('[data-persist]')?.addEventListener('click', async () => { await requestPersistentStorage(); render(); });
  };
  stop = listenOffline(message => {
    if (message.action !== 'progress' || message.id !== job?.id) return;
    job = { ...job, ...message };
    if (message.phase !== 'downloading') {
      job = null;
      offlineStatus().then(next => { snapshot = next; render(); });
    } else render();
  });
  offlineStatus().then(next => { snapshot = next; render(); });
}

function download(text, name) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function summaryText(summary) {
  return `${summary.notes} notes · ${summary.characters} device PCs · ${summary.planned} planned entries · `
    + `${summary.combatants} combatants · ${summary.loot} loot · ${summary.tracks} saved tracks · ${summary.pins} pins`;
}

function openDataManager() {
  let candidate = null;
  let downloaded = false;
  const { node, close } = sheet('Backup & restore', `
    <p class="muted">Backups include this device’s campaign state, not bundled rules data or temporary undo history.</p>
    <button class="primary" data-backup>Download backup</button>
    <label class="button-file">Restore backup<input type="file" accept="application/json,.json" data-restore-file></label>
    <div class="form-error" data-restore-error hidden></div>
    <div class="backup-preview" data-restore-preview hidden></div>`);
  const file = qs('[data-restore-file]', node);
  const error = qs('[data-restore-error]', node);
  const preview = qs('[data-restore-preview]', node);
  const showError = message => {
    error.textContent = message;
    error.hidden = false;
    preview.hidden = true;
    candidate = null;
  };
  qs('[data-backup]', node).addEventListener('click', () => {
    download(makeBackup(state), 'pf2e-gm-toolkit-backup.json');
    downloaded = true;
    if (candidate) renderPreview();
  });
  const renderPreview = () => {
    const counts = backupSummary(candidate);
    error.hidden = true;
    preview.hidden = false;
    preview.innerHTML = `
      <b>Ready to restore</b><span>${esc(summaryText(counts))}</span>
      <p>This replaces this device’s data. Download the current backup first; the browser cannot confirm where it was kept.</p>
      <button class="danger" data-apply ${downloaded ? '' : 'disabled'}>Apply backup</button>`;
    const apply = qs('[data-apply]', preview);
    apply?.addEventListener('click', () => {
      if (!restoreState(candidate)) {
        showError('The backup is valid, but this device could not save it. Nothing was changed.');
        return;
      }
      closeSheets();
    });
  };
  file.addEventListener('change', async () => {
    const selected = file.files?.[0];
    if (!selected) return;
    try {
      candidate = normalizeState(readBackup(await selected.text()).state);
      renderPreview();
    } catch (e) {
      showError(e.message || 'Could not read that backup.');
    }
  });
}

function drawRecent(root) {
  const el = qs('#recent', root);
  if (!el) return;
  const list = state.ui.recent.slice(0, HOME_RECENT);
  el.hidden = !list.length;
  el.innerHTML = list.map(r => `
    <button class="pick" data-recent-cat="${esc(r.cat)}" data-recent-id="${esc(r.id)}">${esc(r.name)}</button>`
  ).join('');
}

function pinKind(pin) {
  return pin.target?.type === 'note' ? 'Session note' : 'Rules reference';
}

function drawPins(root) {
  const el = qs('#pins', root);
  if (!el) return;
  const pins = state.ui.pins.slice(0, HOME_PINS);
  el.hidden = !pins.length;
  el.innerHTML = pins.length ? `
    <div class="row spread"><h2>Session pins</h2><button class="ghost pin-manage" data-manage-pins>Manage</button></div>
    <div class="pin-preview">${pins.map(pin => `
      <button class="item home-pin" data-pin-open="${esc(pin.id)}">
        <span class="grow"><span class="name">${esc(pin.label || 'Untitled pin')}</span>
        <span class="sub">${esc(pinKind(pin))}</span></span><span class="chev" aria-hidden="true">&rsaquo;</span>
      </button>`).join('')}
    </div>
    ${state.ui.pins.length > HOME_PINS ? `<div class="muted pin-more">${state.ui.pins.length - HOME_PINS} more in Manage</div>` : ''}` : '';
}

function missingPinnedNote(pin) {
  const { node, close } = sheet('Pinned note missing', `<p class="muted">${esc(pin.label || 'This note')} is no longer available under its saved note ID. It has not been matched by title.</p><button class="ghost danger" data-remove-missing-pin>Remove pin</button>`);
  on(node, 'click', '[data-remove-missing-pin]', () => {
    state.ui.pins = removePin(state.ui.pins, pin.id);
    save();
    close();
  });
}

function openPin(pin) {
  const target = pin.target;
  if (target?.type === 'reference') {
    library.openPinnedRecord(target.category, target.id, pin.label);
    location.hash = '#/library';
  } else if (target?.type === 'note' && !notes.openById(target.id)) {
    missingPinnedNote(pin);
  }
}

function openPinManager() {
  const { node } = sheet('Manage session pins', '<div data-pin-list></div>');
  const render = () => {
    const list = qs('[data-pin-list]', node);
    if (!list) return;
    if (!state.ui.pins.length) {
      list.innerHTML = '<div class="empty">No session pins yet. Pin a rules reference or session note to keep it here.</div>';
      return;
    }
    list.innerHTML = `<div class="pin-list">${state.ui.pins.map((pin, index) => `
      <div class="card pin-row">
        <div class="grow"><div class="name">${esc(pin.label || 'Untitled pin')}</div><div class="sub">${esc(pinKind(pin))}</div></div>
        <div class="pin-actions">
          <button class="ghost" data-pin-up="${esc(pin.id)}" ${index ? '' : 'disabled'}>Move up</button>
          <button class="ghost" data-pin-down="${esc(pin.id)}" ${index < state.ui.pins.length - 1 ? '' : 'disabled'}>Move down</button>
          <button class="ghost danger" data-pin-remove="${esc(pin.id)}">Remove</button>
        </div>
      </div>`).join('')}</div>`;
    list.querySelectorAll('[data-pin-up]').forEach(button => button.addEventListener('click', () => {
      state.ui.pins = movePin(state.ui.pins, button.dataset.pinUp, -1); save(); render();
    }));
    list.querySelectorAll('[data-pin-down]').forEach(button => button.addEventListener('click', () => {
      state.ui.pins = movePin(state.ui.pins, button.dataset.pinDown, 1); save(); render();
    }));
    list.querySelectorAll('[data-pin-remove]').forEach(button => button.addEventListener('click', () => {
      state.ui.pins = removePin(state.ui.pins, button.dataset.pinRemove); save(); render();
    }));
  };
  render();
}

function tile(t) {
  return `
    <button class="menu-tile" data-go="${t.view}">
      <span class="glyph" aria-hidden="true">${t.glyph}</span>
      <span class="grow">
        <span class="name">${esc(t.title)}</span>
        <span class="sub" data-status="${t.view}"></span>
      </span>
      <span class="chev" aria-hidden="true">&rsaquo;</span>
    </button>`;
}

export function update(root) {
  drawPins(root);
  drawRecent(root);
  for (const t of TILES) {
    const el = qs(`[data-status="${t.view}"]`, root);
    if (el) el.textContent = status(t.view);
  }
  const { level, size } = state.party;
  const note = qs('#party-note', root);
  if (note) {
    note.textContent =
      `Party level ${level} · ${size} PC${size === 1 ? '' : 's'}. `
      + 'Change either in the header — every budget follows.';
  }
}
