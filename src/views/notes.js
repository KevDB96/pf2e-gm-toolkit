// Notes: the campaign in one place — where you are, what is coming, who everyone is,
// and your own session notes.
//
// data/campaign.json is hand-authored reference (arcs, NPCs, kings, loot). Anything you
// type here lives in `state.notes` and persists to localStorage, so a regenerated
// campaign.json never clobbers your notes.

import { state, save, uid } from '../store.js';
import { esc, on, sheet, qs, qsa } from '../dom.js';
import { campaign, characters as loadCharacters } from '../data.js';
import { addPin, hasPin, removePin } from '../pins.js';
import { bindExploration } from './exploration-gm.js';
import { bindDowntime } from './downtime-gm.js';

const TABS = [
  { id: 'session', label: 'Session' },
  { id: 'arcs', label: 'Arcs' },
  { id: 'race', label: 'Race' },
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
let characterGroups = [];
let workspace = 'general';

export function mount(root) {
  workspace = location.hash.match(/^#\/?notes\/(general|exploration|downtime)$/)?.[1]
    || (location.hash.replace(/^#\/?/, '').split('/')[0] === 'exploration' ? 'exploration' : 'general');
  root.innerHTML = `
    <div class="picker" aria-label="Notes workspace">${[['general','General Notes'],['exploration','Exploration'],['downtime','Downtime']].map(([id,label]) => `<button class="pick" data-notes-workspace="${id}" role="tab" aria-selected="${workspace === id}">${label}</button>`).join('')}</div>
    <div class="picker" id="tabs">${TABS
      .map(t => `<button class="pick" data-tab="${t.id}">${esc(t.label)}</button>`)
      .join('')}</div>
    <div id="panel"><div class="empty">Loading campaign&hellip;</div></div>`;

  on(root, 'click', '[data-tab]', (e, el) => { tab = el.dataset.tab; draw(root); });
  on(root, 'click', '[data-notes-workspace]', (e, el) => { location.hash = `#/notes/${el.dataset.notesWorkspace}`; });
  on(root, 'click', '[data-arc]', (e, el) => {
    openArc = openArc === el.dataset.arc ? null : el.dataset.arc;
    if (data?.arcs?.find(a => a.id === el.dataset.arc)?.status === 'done') completedOpen = true;
    draw(root);
  });
  on(root, 'click', '[data-completed]', () => { completedOpen = !completedOpen; draw(root); });
  on(root, 'click', '[data-add-note]', () => editNote(null));
  on(root, 'click', '[data-add-race-entry]', () => addRaceEntry(root));
  on(root, 'click', '[data-delete-race-entry]', (e, el) => {
    state.race.entries = state.race.entries.filter(entry => entry.id !== el.dataset.deleteRaceEntry);
    save();
    draw(root);
  });
  on(root, 'click', '[data-edit-recap]', () => editRecap());
  on(root, 'click', '[data-edit-note]', (e, el) => editNote(el.dataset.editNote));
  on(root, 'click', '[data-del-note]', (e, el) => {
    const note = state.notes.entries.find(n => n.id === el.dataset.delNote);
    if (!note) return;
    if (note.public === true || note.shared === true) {
      const priorRevision = Number.isInteger(note.revision) && note.revision >= 0
        ? note.revision
        : Number.isInteger(note.version) && note.version >= 0 ? note.version : 0;
      note.deleted = true;
      note.revision = priorRevision + 1;
    } else {
      state.notes.entries = state.notes.entries.filter(n => n.id !== el.dataset.delNote);
    }
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
  root.addEventListener('input', e => {
    if (e.target.id === 'npc-search') { npcQuery = e.target.value; drawNpcs(root); }
  });

  Promise.all([campaign(), loadCharacters()]).then(([c, file]) => {
    data = c;
    roster = [...(file?.characters || []), ...state.characters.extra];
    characterGroups = file?.groups || [];
    if (!openArc) openArc = c?.current?.arc || null;
    draw(root);
  });
}

export function update(root) {
  if (qs('#panel', root)) {
    workspace = location.hash.match(/^#\/?notes\/(general|exploration|downtime)$/)?.[1]
      || (location.hash.replace(/^#\/?/, '').split('/')[0] === 'exploration' ? 'exploration' : 'general');
    draw(root);
  }
}

function draw(root) {
  qsa('[data-notes-workspace]', root).forEach(el => { el.classList.toggle('on', el.dataset.notesWorkspace === workspace); el.setAttribute('aria-selected', String(el.dataset.notesWorkspace === workspace)); });
  qs('#tabs', root).hidden = workspace !== 'general';
  qsa('.pick', root).forEach(el => el.classList.toggle('on', el.dataset.tab === tab));
  const panel = qs('#panel', root);
  if (!panel) return;
  if (workspace === 'exploration') {
    if (qs('[data-exploration-root]', panel)) return;
    panel.innerHTML = '<div data-exploration-root></div>';
    bindExploration(qs('[data-exploration-root]', panel));
    return;
  }
  if (workspace === 'downtime') {
    if (qs('[data-downtime-root]', panel)) return;
    panel.innerHTML = '<div data-downtime-root></div>';
    bindDowntime(qs('[data-downtime-root]', panel));
    return;
  }
  if (!data) {
    panel.innerHTML = '<div class="empty">No data/campaign.json found.</div>';
    return;
  }
  panel.innerHTML =
    tab === 'session' ? session()
    : tab === 'arcs' ? arcs()
    : tab === 'race' ? race()
    : tab === 'npcs' ? npcs()
    : reference();
}

// --- session --------------------------------------------------------------

function session() {
  const cur = data.arcs?.find(a => a.id === data.current?.arc);
  const next = data.arcs?.find(a => a.status === 'next');
  const p = data.party || {};
  const matches = p.level === state.party.level && p.size === state.party.size;

  const visibleNotes = state.notes.entries.filter(note => note?.deleted !== true);
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

    ${recap()}

    <div class="row spread">
      <h2 style="font-size:0.82rem;text-transform:uppercase;color:var(--muted)">Session notes</h2>
      <button data-add-note>+ Note</button>
    </div>
    <div class="list">${
      visibleNotes.length
        ? [...visibleNotes].reverse().map(noteRow).join('')
        : '<div class="empty">No notes yet.<br>Anything you add here stays on this device.</div>'
    }</div>`;
}

// --- wargames race --------------------------------------------------------

function race() {
  const arc = data.arcs?.find(item => item.id === 'wargame');
  const plan = arc?.race;
  if (!plan) return '<div class="empty">No Wargames race plan.</div>';
  const groupNames = ['Mists of Zalazar', 'The Alliance', 'The Royal Guard'];
  const groups = characterGroups.filter(group => groupNames.includes(group.label));
  const suggestions = roster.map(character => `<option value="${esc(character.name)}">`).join('');
  const entries = state.race.entries || [];
  return `<div class="card">
    <span class="badge now">${esc(plan.phase)}</span><h2>${esc(plan.title)}</h2>
    <div class="muted">${esc(plan.scope)}</div>
    <div class="sub" style="margin-top:8px">Teams: ${groups.map(group => esc(group.label)).join(' · ')}</div>
  </div>
  <div class="list">${(plan.legs || []).map((leg, index) => `<div class="card">
    <h2>${index + 1}. ${esc(leg.name)}</h2><div class="muted">${esc(leg.guidance)}</div>
  </div>`).join('')}</div>
  <div class="card">
    <h2>Race tracker</h2>
    <div class="muted">Track each racer or small group independently. Splitting up, helping others, temporary pairings, and pushing ahead are all valid.</div>
    <div class="exploration-form" style="margin-top:10px">
      <select data-race-team aria-label="Team">${groups.map(group => `<option value="${esc(group.label)}">${esc(group.label)}</option>`).join('')}<option value="Other">Other</option></select>
      <input data-race-racers list="race-roster" placeholder="Racer or small group" aria-label="Racer or small group">
      <datalist id="race-roster">${suggestions}</datalist>
      <select data-race-leg aria-label="Current leg">${(plan.legs || []).map((leg, i) => `<option value="${i}">${i + 1}. ${esc(leg.name)}</option>`).join('')}</select>
      <input data-race-placement placeholder="Placement" aria-label="Placement">
      <input data-race-route placeholder="Route choice" aria-label="Route choice">
      <input data-race-delay placeholder="Delays / conditions" aria-label="Delays or conditions">
      <input data-race-moments placeholder="Help / rivalry" aria-label="Help or rivalry moments">
      <input data-race-notes placeholder="Notes" aria-label="Freeform notes">
      <button type="button" data-add-race-entry>Add racer</button>
    </div>
    <div class="list" style="margin-top:12px">${entries.length ? entries.map(entry => `<div class="item" style="align-items:flex-start">
      <div class="grow"><div class="name">${esc(entry.racers)} <span class="tag">${esc(entry.team)}</span></div>
      <div class="sub">${esc((plan.legs || [])[entry.leg]?.name || 'Pyramid Escape')}${entry.placement ? ` · ${esc(entry.placement)}` : ''}${entry.route ? ` · ${esc(entry.route)}` : ''}</div>
      ${[entry.delay, entry.moments, entry.notes].filter(Boolean).map(value => `<div class="sub">${esc(value)}</div>`).join('')}</div>
      <button class="icon ghost danger" type="button" data-delete-race-entry="${esc(entry.id)}" aria-label="Remove ${esc(entry.racers)}">&#10005;</button>
    </div>`).join('') : '<div class="empty">No racers recorded.</div>'}</div>
  </div>`;
}

function addRaceEntry(root) {
  const racers = qs('[data-race-racers]', root).value.trim();
  if (!racers) return;
  state.race.entries.push({
    id: uid('race'), team: qs('[data-race-team]', root).value, racers,
    leg: Number(qs('[data-race-leg]', root).value),
    placement: qs('[data-race-placement]', root).value.trim(),
    route: qs('[data-race-route]', root).value.trim(),
    delay: qs('[data-race-delay]', root).value.trim(),
    moments: qs('[data-race-moments]', root).value.trim(),
    notes: qs('[data-race-notes]', root).value.trim()
  });
  save();
  draw(root);
}

function recap() {
  const value = state.session.recap;
  const hasContent = value.status !== 'empty';
  return `<div class="card">
    <div class="row spread"><h2>Public session recap</h2><button data-edit-recap>${hasContent ? 'Edit' : 'Publish'}</button></div>
    ${hasContent
      ? `<div class="name">${esc(value.title || 'Session recap')}</div><div class="sub" style="white-space:pre-wrap">${esc(value.body)}</div><div class="muted" style="margin-top:6px">${esc(value.status)} · revision ${value.revision}</div>`
      : '<div class="muted">Nothing is published to the player view.</div>'}
    <div class="muted" style="margin-top:6px">Only this title and recap text leave the GM Toolkit.</div>
  </div>`;
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
  if (existing?.deleted === true) return;
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
        if (existing.public === true || existing.shared === true) {
          const currentRevision = Number.isInteger(existing.revision) && existing.revision >= 0
            ? existing.revision
            : Number.isInteger(existing.version) && existing.version >= 0 ? existing.version : 0;
          const nextRevision = currentRevision + 1;
          if (Number.isInteger(existing.revision) && existing.revision >= 0) {
            existing.revision = nextRevision;
          } else if (Number.isInteger(existing.version) && existing.version >= 0) {
            existing.version = nextRevision;
          } else {
            existing.revision = nextRevision;
          }
        }
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

function editRecap() {
  const existing = state.session.recap;
  const body = `
    <label class="field">Title<input type="text" id="recap-title"
      value="${esc(existing.title)}" placeholder="After the bridge"></label>
    <label class="field">Recap<textarea id="recap-body" rows="8"
      placeholder="What players should remember or know">${esc(existing.body)}</textarea></label>
    <button class="primary" id="recap-save">${existing.status === 'empty' ? 'Publish' : 'Save update'}</button>`;

  sheet(existing.status === 'empty' ? 'Publish session recap' : 'Edit public recap', body, (node, close) => {
    qs('#recap-save', node).addEventListener('click', () => {
      const title = qs('#recap-title', node).value.trim();
      const text = qs('#recap-body', node).value.trim();
      const changed = title !== existing.title || text !== existing.body;
      if (!changed) return close();
      const hasContent = Boolean(title || text);
      state.session.recap = {
        version: existing.version,
        status: hasContent ? (existing.status === 'empty' ? 'published' : 'updated') : 'empty',
        revision: existing.revision + 1,
        title,
        body: text
      };
      save();
      close();
    });
  });
}

/** Open a device note by its stable ID; a deleted note never falls back to its title. */
export function openById(id) {
  if (!state.notes.entries.some(note => note.id === id && note.deleted !== true)) return false;
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
