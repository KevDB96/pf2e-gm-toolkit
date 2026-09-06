// Notes: the campaign in one place — where you are, what is coming, who everyone is,
// and your own session notes.
//
// data/campaign.json is hand-authored reference (arcs, NPCs, kings, loot). Anything you
// type here lives in `state.notes` and persists to localStorage, so a regenerated
// campaign.json never clobbers your notes.

import { state, save, uid, registerResetHook } from '../store.js';
import { esc, on, sheet, qs, qsa } from '../dom.js';
import { campaign, characters as loadCharacters } from '../data.js';
import { addPin, hasPin, removePin } from '../pins.js';
import { advanceExploration, formatElapsed } from '../exploration.js';

const TABS = [
  { id: 'session', label: 'Session' },
  { id: 'arcs', label: 'Arcs' },
  { id: 'npcs', label: 'NPCs' },
  { id: 'reference', label: 'Reference' }
];

const STATUS = {
  done: { label: 'Done', tone: 'done' },
  current: { label: 'Now', tone: 'now' },
  next: { label: 'Next', tone: 'next' },
  later: { label: 'Later', tone: 'later' }
};

let data = null;
let tab = 'session';
let npcQuery = '';
let openArc = null;
let completedOpen = false;
let roster = [];
let explorationUndo = [];
registerResetHook(() => { explorationUndo = []; });

export function mount(root) {
  root.innerHTML = `
    <div class="picker" id="tabs">${TABS
      .map(t => `<button class="pick" data-tab="${t.id}">${esc(t.label)}</button>`)
      .join('')}</div>
    <div id="panel"><div class="empty">Loading campaign&hellip;</div></div>`;

  on(root, 'click', '[data-tab]', (e, el) => { tab = el.dataset.tab; draw(root); });
  on(root, 'click', '[data-arc]', (e, el) => {
    openArc = openArc === el.dataset.arc ? null : el.dataset.arc;
    if (data?.arcs?.find(a => a.id === el.dataset.arc)?.status === 'done') completedOpen = true;
    draw(root);
  });
  on(root, 'click', '[data-completed]', () => { completedOpen = !completedOpen; draw(root); });
  on(root, 'click', '[data-add-note]', () => editNote(null));
  on(root, 'click', '[data-edit-note]', (e, el) => editNote(el.dataset.editNote));
  on(root, 'click', '[data-del-note]', (e, el) => {
    state.notes.entries = state.notes.entries.filter(n => n.id !== el.dataset.delNote);
    save();
  });
  on(root, 'click', '[data-apply-party]', () => {
    if (!data?.party) return;
    state.party.level = data.party.level;
    state.party.size = data.party.size;
    qs('#party-level').value = data.party.level;
    qs('#party-size').value = data.party.size;
    save();
  });
  on(root, 'click', '[data-advance]', (e, el) => advanceTime(Number(el.dataset.advance), root));
  on(root, 'click', '[data-advance-custom]', () => advanceTime(Number(qs('[data-custom-minutes]', root).value), root));
  on(root, 'click', '[data-undo-exploration]', () => {
    const previous = explorationUndo.pop();
    if (!previous) return;
    state.exploration = previous;
    save();
  });
  on(root, 'click', '[data-start-timer]', () => startTimer(root));
  on(root, 'click', '[data-ack-timer]', (e, el) => {
    const timer = state.exploration.timers.find(t => t.id === el.dataset.ackTimer);
    if (!timer) return;
    timer.status = 'acknowledged';
    save();
  });
  on(root, 'click', '[data-set-activity]', () => setActivity(root));
  on(root, 'click', '[data-clear-activity]', (e, el) => {
    delete state.exploration.activities[el.dataset.clearActivity];
    save();
  });
  root.addEventListener('change', e => {
    if (e.target.matches('[data-timer-preset]')) {
      const preset = e.target.selectedOptions[0];
      if (preset?.dataset.minutes) {
        qs('[data-timer-label]', root).value = preset.dataset.label || '';
        qs('[data-timer-minutes]', root).value = preset.dataset.minutes;
      }
    }
  });
  root.addEventListener('input', e => {
    if (e.target.id === 'npc-search') { npcQuery = e.target.value; drawNpcs(root); }
  });

  Promise.all([campaign(), loadCharacters()]).then(([c, file]) => {
    data = c;
    roster = [...(file?.characters || []), ...state.characters.extra];
    if (!openArc) openArc = c?.current?.arc || null;
    draw(root);
  });
}

export function update(root) {
  if (qs('#panel', root)) draw(root);
}

function draw(root) {
  qsa('.pick', root).forEach(el => el.classList.toggle('on', el.dataset.tab === tab));
  const panel = qs('#panel', root);
  if (!panel) return;
  if (!data) {
    panel.innerHTML = '<div class="empty">No data/campaign.json found.</div>';
    return;
  }
  panel.innerHTML =
    tab === 'session' ? session()
    : tab === 'arcs' ? arcs()
    : tab === 'npcs' ? npcs()
    : reference();
}

// --- session --------------------------------------------------------------

function session() {
  const cur = data.arcs?.find(a => a.id === data.current?.arc);
  const next = data.arcs?.find(a => a.status === 'next');
  const p = data.party || {};
  const matches = p.level === state.party.level && p.size === state.party.size;

  return `
    <div class="card">
      <h2>${esc(data.title || 'Campaign')}</h2>
      ${cur ? `<div class="threat" data-t="moderate">${esc(cur.title)}</div>` : ''}
      <div class="muted" style="margin-top:4px">${esc(data.current?.note || '')}</div>
      ${next ? `<div class="muted" style="margin-top:8px;font-size:0.76rem">
        Then: ${esc(next.title)}</div>` : ''}
    </div>

    <div class="card">
      <h2>Party</h2>
      <div class="share"><span class="muted">Campaign</span>
        <b>${p.size} PCs · level ${p.level}</b></div>
      <div class="share"><span class="muted">App header</span>
        <b>${state.party.size} PCs · level ${state.party.level}</b></div>
      ${matches ? '' :
        '<button data-apply-party style="margin-top:10px">Set header to campaign party</button>'}
    </div>

    ${exploration()}

    <div class="row spread">
      <h2 style="font-size:0.82rem;text-transform:uppercase;color:var(--muted)">Session notes</h2>
      <button data-add-note>+ Note</button>
    </div>
    <div class="list">${
      state.notes.entries.length
        ? [...state.notes.entries].reverse().map(noteRow).join('')
        : '<div class="empty">No notes yet.<br>Anything you add here stays on this device.</div>'
    }</div>`;
}

function characterName(id) {
  if (!id) return 'Party / no specific character';
  return roster.find(c => c.id === id)?.name || `Missing character (${id})`;
}

function exploration() {
  const clock = state.exploration;
  const timers = clock.timers || [];
  const due = timers.filter(t => t.status === 'due');
  const options = roster.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  return `<div class="card exploration-clock">
    <div class="row spread"><h2>Exploration clock</h2><b>${esc(formatElapsed(clock.elapsedMinutes))}</b></div>
    <div class="muted">Fictional time only. It advances when you choose an amount.</div>
    <div class="exploration-actions">
      <button data-advance="10">+10 min</button>
      <label class="compact-field">Minutes<input type="number" min="1" step="1" value="20" data-custom-minutes></label>
      <button data-advance-custom>Advance</button>
      <button class="ghost" data-undo-exploration ${explorationUndo.length ? '' : 'disabled'}>Undo last</button>
    </div>
    <div class="exploration-section"><b>Current activities</b>
      ${Object.keys(clock.activities).length ? Object.entries(clock.activities).map(([id, a]) =>
        `<div class="exploration-row"><span>${esc(characterName(id))}: ${esc(a.label)}</span><button class="ghost" data-clear-activity="${esc(id)}">Clear</button></div>`).join('') : '<div class="muted">None recorded.</div>'}
      <div class="exploration-form"><select data-activity-character><option value="">Party / no specific character</option>${options}</select><input type="text" data-activity-label placeholder="Activity (e.g. Search)"><button data-set-activity>Set</button></div>
    </div>
    <div class="exploration-section"><b>Timers</b>
      ${timers.length ? timers.map(timerRow).join('') : '<div class="muted">No timers.</div>'}
      <div class="exploration-form"><select data-timer-preset><option>Custom reminder</option><option data-label="Refocus" data-minutes="10">Refocus · 10 min</option><option data-label="Treat Wounds" data-minutes="10">Treat Wounds · 10 min</option><option data-label="Treat Wounds immunity" data-minutes="60">Treat Wounds immunity · 1 hour</option></select><input type="text" data-timer-label placeholder="Reminder label"><input type="number" min="1" step="1" value="10" data-timer-minutes placeholder="Minutes"><select data-timer-target><option value="">No specific character</option>${options}</select><button data-start-timer>Start</button></div>
      ${due.length ? `<div class="timer-notice">${due.length} reminder${due.length === 1 ? '' : 's'} due</div>` : ''}
    </div>
  </div>`;
}

function timerRow(timer) {
  const stateLabel = timer.status === 'due' ? 'Due' : timer.status === 'acknowledged' ? 'Acknowledged' : `due in ${Math.max(0, timer.dueAtMinute - state.exploration.elapsedMinutes)}m`;
  return `<div class="exploration-row"><span>${esc(timer.label)} <small>(${esc(characterName(timer.targetId))}) · ${esc(stateLabel)}</small></span>${timer.status === 'due' ? `<button data-ack-timer="${esc(timer.id)}">Acknowledge</button>` : ''}</div>`;
}

function advanceTime(minutes, root) {
  if (!Number.isFinite(minutes) || minutes <= 0) return;
  explorationUndo.push(JSON.parse(JSON.stringify(state.exploration)));
  state.exploration = advanceExploration(state.exploration, minutes).exploration;
  save();
}

function startTimer(root) {
  const label = qs('[data-timer-label]', root).value.trim();
  const minutes = Math.floor(Number(qs('[data-timer-minutes]', root).value));
  if (!label || !Number.isFinite(minutes) || minutes <= 0) return;
  const preset = qs('[data-timer-preset]', root).selectedOptions[0];
  state.exploration.timers.push({ id: uid('timer'), label, startedAtMinute: state.exploration.elapsedMinutes,
    dueAtMinute: state.exploration.elapsedMinutes + minutes, targetId: qs('[data-timer-target]', root).value || null,
    source: preset?.dataset.minutes ? `aon:${preset.dataset.label.toLowerCase().replaceAll(' ', '-')}` : null, status: 'active' });
  save();
}

function setActivity(root) {
  const label = qs('[data-activity-label]', root).value.trim();
  if (!label) return;
  const id = qs('[data-activity-character]', root).value || '_party';
  state.exploration.activities[id] = { label, startedAtMinute: state.exploration.elapsedMinutes };
  save();
}

function noteRow(n) {
  return `
    <div class="item" style="align-items:flex-start">
      <div class="grow">
        <div class="name">${esc(n.title || 'Untitled')}</div>
        <div class="sub" style="white-space:pre-wrap">${esc(n.body || '')}</div>
        <div class="sub" style="opacity:0.6;margin-top:4px">${esc(n.at || '')}</div>
      </div>
      <button class="icon ghost" data-edit-note="${esc(n.id)}">&#9998;</button>
      <button class="icon ghost danger" data-del-note="${esc(n.id)}">&#10005;</button>
    </div>`;
}

function editNote(id) {
  const existing = state.notes.entries.find(n => n.id === id);
  const target = existing ? { type: 'note', id: existing.id } : null;
  const pinned = target && hasPin(state.ui.pins, target);
  const body = `
    <label class="field">Title<input type="text" id="n-title"
      value="${esc(existing?.title || '')}" placeholder="Session 24 — Wargames"></label>
    <label class="field">Note<textarea id="n-body" rows="7"
      placeholder="What happened, what to remember">${esc(existing?.body || '')}</textarea></label>
    <button class="primary" id="n-save">${existing ? 'Save' : 'Add'}</button>
    ${existing ? `<button class="ghost" data-pin-note>${pinned ? 'Unpin from session' : 'Pin to session'}</button>` : ''}`;

  sheet(existing ? 'Edit note' : 'New note', body, (node, close) => {
    qs('#n-save', node).addEventListener('click', () => {
      const title = qs('#n-title', node).value.trim();
      const text = qs('#n-body', node).value.trim();
      if (!title && !text) return close();
      if (existing) {
        existing.title = title;
        existing.body = text;
      } else {
        state.notes.entries.push({
          id: uid('note'),
          title,
          body: text,
          at: new Date().toLocaleString()
        });
      }
      save();
      close();
    });
    on(node, 'click', '[data-pin-note]', (event, button) => {
      const existingPin = state.ui.pins.find(pin => hasPin([pin], target));
      state.ui.pins = existingPin
        ? removePin(state.ui.pins, existingPin.id)
        : addPin(state.ui.pins, { id: uid('pin'), target, label: existing.title || 'Untitled note' });
      save();
      button.textContent = existingPin ? 'Pin to session' : 'Unpin from session';
    });
  });
}

/** Open a device note by its stable ID; a deleted note never falls back to its title. */
export function openById(id) {
  if (!state.notes.entries.some(note => note.id === id)) return false;
  editNote(id);
  return true;
}

// --- arcs -----------------------------------------------------------------

function arcs() {
  const all = data.arcs || [];
  const completed = all.filter(a => a.status === 'done');
  const upcoming = all.filter(a => a.status !== 'done');
  return `<div class="list">
    ${upcoming.map(arcRow).join('')}
    ${completed.length ? `<div class="card" style="padding:0">
      <button data-completed class="arc-head">
        <span class="badge done">Done</span>
        <span class="grow"><span class="name">Completed arcs</span>
          <span class="sub">${completed.length} arc${completed.length === 1 ? '' : 's'}</span></span>
        <span class="chev">${completedOpen ? '&minus;' : '+'}</span>
      </button>
      ${completedOpen ? `<div class="completed-arcs">${completed.map(arcRow).join('')}</div>` : ''}
    </div>` : ''}
  </div>`;
}

function arcRow(a) {
  const s = STATUS[a.status] || STATUS.later;
  const open = openArc === a.id;
  return `
    <div class="card" style="padding:0">
      <button data-arc="${esc(a.id)}" class="arc-head">
        <span class="badge ${s.tone}">${esc(s.label)}</span>
        <span class="grow">
          <span class="name">${esc(a.title)}</span>
          <span class="sub">${esc(a.summary || '')}</span>
        </span>
        <span class="chev">${open ? '&minus;' : '+'}</span>
      </button>
      ${open ? `<div class="arc-body">
        <ul>${(a.beats || []).map(b => `<li>${esc(b)}</li>`).join('')}</ul>
        ${Object.entries(a.detail || {}).map(([heading, lines]) => `
          <h3>${esc(heading)}</h3>
          <ul>${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>`).join('')}
      </div>` : ''}
    </div>`;
}

// --- npcs -----------------------------------------------------------------

function npcs() {
  return `
    <div class="card">
      <input type="search" id="npc-search" placeholder="Search NPCs&hellip;"
             autocomplete="off" value="${esc(npcQuery)}">
    </div>
    <div class="list" id="npc-list">${npcRows()}</div>`;
}

function drawNpcs(root) {
  const list = qs('#npc-list', root);
  if (list) list.innerHTML = npcRows();
}

function npcRows() {
  const needle = npcQuery.trim().toLowerCase();
  const hits = (data.npcs || []).filter(n =>
    !needle || n.name.toLowerCase().includes(needle)
    || (n.role || '').toLowerCase().includes(needle)
    || (n.group || '').toLowerCase().includes(needle));
  if (!hits.length) return '<div class="empty">No NPC matches that.</div>';
  return hits.map(n => `
    <div class="item" style="align-items:flex-start">
      <div class="grow">
        <div class="name">${esc(n.name)}</div>
        <div class="sub">${esc(n.role || '')}</div>
      </div>
      <span class="tag">${esc(n.group || '')}</span>
    </div>`).join('');
}

// --- reference ------------------------------------------------------------

function reference() {
  const loot = data.lootTable;
  return `
    ${(data.antagonists || []).map(x => `
      <div class="card">
        <h2>${esc(x.name)}</h2>
        <div class="muted">${esc(x.summary)}</div>
        <ul class="notes-list">${(x.points || []).map(p => `<li>${esc(p)}</li>`).join('')}</ul>
      </div>`).join('')}

    ${loot ? `<div class="card">
      <h2>Loot table — level ${loot.level}</h2>
      ${loot.items.map(i => `<div class="share"><span>${esc(i.name)}</span>
        <b>${i.gp} gp</b></div>`).join('')}
    </div>` : ''}

    <div class="card">
      <h2>Ideas &amp; notes</h2>
      <ul class="notes-list">${(data.ideas || []).map(i => `<li>${esc(i)}</li>`).join('')}</ul>
    </div>

    <div class="card">
      <h2>The kings of Zalazar</h2>
      ${(data.kings || []).map(k => `
        <div class="item" style="background:none;border:none;padding:6px 0">
          <span class="lvl">${k.n ?? '—'}</span>
          <div class="grow">
            <div class="name">${esc(k.title)}</div>
            ${k.note ? `<div class="sub">${esc(k.note)}</div>` : ''}
          </div>
        </div>`).join('')}
    </div>`;
}
