// Encounter planner: build a roster, watch the XP budget, hand it to the tracker.

import { state, save, uid } from '../store.js';
import { combatTransaction } from '../combat-history.js';
import { esc, on, sheet, tip, qs } from '../dom.js';
import { creatureXP, hazardXP, budgets, threatFor, threatScale, threatPosition, xpAward,
  adjustedLevel, adjustedHP, adjustedAC, adjustedModifier, hazardInitiative } from '../pf2e.js';
import { creatures, traits, hazards } from '../data.js';
import { recordTip } from '../records.js';
import { buildFacets, creatureTypeNames, facetChange, facetOptions, facetPasses, facetSelects }
  from '../facets.js';
import { copyEncounterEntries, savedEncounter, templateWarnings, updatedEncounter } from '../saved-encounters.js';

const KIND_LABEL = { creature: 'Creature', simple: 'Simple hazard', complex: 'Complex hazard' };

// entry.adjust is undefined on rows saved before Elite/Weak existed; adjustedLevel()
// treats anything but 'elite'/'weak' as unchanged, so that reads the same as null.
function entryXP(entry, partyLevel) {
  const level = adjustedLevel(entry.level, entry.adjust);
  const each = entry.kind === 'creature'
    ? creatureXP(level, partyLevel)
    : hazardXP(level, partyLevel, entry.kind === 'complex');
  return each === null ? null : each * entry.count;
}

/** Total XP of the current roster, at the given party level. */
export function totalXP(partyLevel) {
  return state.encounter.entries.reduce((sum, e) => sum + (entryXP(e, partyLevel) || 0), 0);
}

export function mount(root) {
  toCombat.launching = false;
  root.innerHTML = shell();
  wire(root);
  update(root);
}

function shell() {
  return `
    <div class="card" id="budget">
      <h2>Encounter budget</h2>
      <div class="row spread" style="align-items:flex-end">
        <div>
          <span class="threat" id="threat">Trivial</span>
          <div class="muted" id="xp-line">0 XP</div>
        </div>
        <div style="text-align:right">
          <div class="muted">Each PC earns</div>
          <div class="threat" id="award" style="color:var(--ink)">0</div>
        </div>
      </div>
      <div class="gauge">
        <div class="gauge-track" id="gauge"></div>
        <div class="gauge-needle" id="needle" style="left:0"></div>
      </div>
      <div class="gauge-scale" id="thresholds"></div>
    </div>

    <div class="row wrap">
      <button class="primary grow" data-add-bestiary>Bestiary</button>
      <button class="grow" data-add-hazards>Hazards</button>
      <button data-add-custom>+ Custom</button>
      <button data-templates>Saved</button>
    </div>

    <div class="list" id="entries"></div>

    <div class="row wrap" id="footer-actions" hidden>
      <button class="grow" data-to-combat>Send to combat tracker &rarr;</button>
      <button class="danger" data-clear>Clear</button>
    </div>`;
}

function wire(root) {
  on(root, 'click', '[data-add-custom]', () => addCustom());
  on(root, 'click', '[data-add-bestiary]', () => addFromBestiary());
  on(root, 'click', '[data-add-hazards]', () => addFromHazards());
  on(root, 'click', '[data-templates]', () => openTemplates());
  on(root, 'click', '[data-inc]', (e, el) => bump(el.dataset.inc, +1));
  on(root, 'click', '[data-dec]', (e, el) => bump(el.dataset.dec, -1));
  on(root, 'click', '[data-del]', (e, el) => {
    changeDraft(() => { state.encounter.entries = state.encounter.entries.filter(x => x.id !== el.dataset.del); });
  });
  on(root, 'click', '[data-clear]', () => changeDraft(() => { state.encounter.entries = []; }));
  on(root, 'click', '[data-to-combat]', () => toCombat());
  on(root, 'click', '[data-adjust]', (e, el) => setAdjust(el.dataset.adjust, el.dataset.kind));
}

function bump(id, delta) {
  const entry = state.encounter.entries.find(x => x.id === id);
  if (!entry) return;
  changeDraft(() => { entry.count = Math.max(1, entry.count + delta); });
}

/** Elite and Weak are mutually exclusive and each toggles off when tapped again. */
function setAdjust(id, kind) {
  const entry = state.encounter.entries.find(x => x.id === id);
  if (!entry) return;
  changeDraft(() => { entry.adjust = entry.adjust === kind ? null : kind; });
}

function changeDraft(mutate) {
  mutate();
  state.encounter.dirty = true;
  save();
}

export function update(root) {
  const { level, size } = state.party;
  const xp = totalXP(level);
  const threat = threatFor(xp, size);
  const threatEl = qs('#threat', root);

  threatEl.textContent = threat.replace(/^./, c => c.toUpperCase());
  threatEl.dataset.t = threat;
  qs('#xp-line', root).textContent =
    `${xp} XP · party level ${level} · ${size} PC${size === 1 ? '' : 's'}`;
  qs('#award', root).textContent = xpAward(xp, size) + ' XP';

  // Trivial on the left through extreme on the right, each band as wide as the XP range
  // it covers, with the needle where this encounter lands.
  const scale = threatScale(size);
  qs('#gauge', root).innerHTML = scale.map((band, i) => `
    <div class="gauge-seg" data-t="${band.threat}" style="flex:${band.width.toFixed(2)}"
      ${tip(i === 0
        ? `Trivial: under ${band.to} XP`
        : i === scale.length - 1
          ? `Extreme: ${band.from} XP and up`
          : `${band.threat}: ${band.from}–${band.to - 1} XP`)}>
      <span>${esc(band.threat)}</span>
    </div>`).join('');
  const needle = qs('#needle', root);
  needle.style.left = threatPosition(xp, size) + '%';
  needle.dataset.t = threat;
  qs('#thresholds', root).textContent =
    Object.entries(budgets(size)).map(([k, v]) => `${k} ${v}`).join(' · ');

  const entries = state.encounter.entries;
  qs('#entries', root).innerHTML = entries.length
    ? entries.map(e => row(e, level)).join('')
    : '<div class="empty">No creatures yet.<br>Add from the bestiary or enter one by hand.</div>';
  qs('#footer-actions', root).hidden = entries.length === 0;
}

function row(e, partyLevel) {
  const xp = entryXP(e, partyLevel);
  const sub = xp === null
    ? '<span style="color:var(--blood)">outside the −4/+4 XP band</span>'
    : `${KIND_LABEL[e.kind]} · ${xp} XP`;
  // The badge shows the adjusted level — that is the level the budget above is already
  // using — and the prefix is rendered here only; e.name itself is never touched, so
  // toggling Elite/Weak off again shows the original name with nothing to undo.
  const lvl = adjustedLevel(e.level, e.adjust);
  const prefix = e.adjust === 'elite' ? 'Elite ' : e.adjust === 'weak' ? 'Weak ' : '';
  const nameBlock = `<div class="name">${prefix}${esc(e.name)}</div><div class="sub">${sub}</div>`;
  // A planned creature carries the full bestiary record when it was added from the
  // picker or the Library — see addFromBestiary() and the Library's "Add to encounter"
  // — so its url is already there; a hand-typed custom entry has no creature record and
  // renders the same block with no link, exactly as it did before this feature existed.
  const url = e.creature?.url || e.hazard?.url;
  const nameHtml = url
    ? `<a class="enc-link" href="${esc(url)}" target="_blank" rel="noopener"
        ${tip('Read it on the Archives of Nethys. Opens in a new tab.')}>${nameBlock}</a>`
    : nameBlock;
  // Elite/Weak only makes sense for a creature — a hazard's numbers are not built the
  // same way — so the toggle is left off hazard rows entirely rather than shown disabled.
  const toggle = e.kind === 'creature' ? `
    <div class="enc-adjust">
      <button class="pick${e.adjust === 'elite' ? ' on' : ''}" data-adjust="${e.id}" data-kind="elite">Elite</button>
      <button class="pick${e.adjust === 'weak' ? ' on' : ''}" data-adjust="${e.id}" data-kind="weak">Weak</button>
    </div>` : '';
  return `
    <div class="item">
      <span class="lvl">${lvl}</span>
      <div class="grow">
        ${nameHtml}
        ${toggle}
      </div>
      <div class="stepper">
        <button class="icon" data-dec="${e.id}">&minus;</button>
        <output>${e.count}</output>
        <button class="icon" data-inc="${e.id}">+</button>
      </div>
      <button class="icon ghost danger" data-del="${e.id}">&#10005;</button>
    </div>`;
}

export function addEntry(name, level, kind = 'creature', creature = null) {
  changeDraft(() => {
    const match = state.encounter.entries
      .find(e => e.name === name && e.level === level && e.kind === kind);
    if (match) match.count += 1;
    else state.encounter.entries.push({ id: uid('enc'), name, level, count: 1, kind, creature, adjust: null });
  });
}

/** Add a generated hazard without pretending it is a creature record. */
export function addHazard(record) {
  const kind = String(record?.complexity || '').toLowerCase() === 'complex'
    || (record?.traits || []).some(trait => String(trait).toLowerCase() === 'complex')
    ? 'complex' : 'simple';
  changeDraft(() => {
    const match = state.encounter.entries.find(e => e.name === record.name && e.level === record.level && e.kind === kind);
    if (match) { match.count += 1; match.hazard = record; }
    else state.encounter.entries.push({ id: uid('enc'), name: record.name, level: record.level, count: 1, kind, hazard: record, adjust: null });
  });
}

function saveDraft(title, notes = '') {
  const now = new Date().toISOString();
  const template = savedEncounter({ id: uid('saved'), title, notes, entries: state.encounter.entries,
    party: state.party, now });
  state.encounters.saved.push(template);
  state.encounter.selectedId = template.id;
  state.encounter.dirty = false;
  save();
  return template;
}

function updateSaved(id) {
  const index = state.encounters.saved.findIndex(template => template.id === id);
  if (index < 0) return null;
  const next = updatedEncounter(state.encounters.saved[index], {
    entries: state.encounter.entries, party: state.party, now: new Date().toISOString()
  });
  state.encounters.saved[index] = next;
  state.encounter.selectedId = id;
  state.encounter.dirty = false;
  save();
  return next;
}

function loadSaved(template, applyParty = false) {
  state.encounter.entries = copyEncounterEntries(template.entries, uid);
  state.encounter.selectedId = template.id;
  state.encounter.dirty = false;
  if (applyParty && Number.isFinite(template.party?.level) && Number.isFinite(template.party?.size)) {
    state.party.level = Math.min(20, Math.max(1, template.party.level));
    state.party.size = Math.min(8, Math.max(1, template.party.size));
  }
  save();
}

function applySavedParty(template) {
  if (!Number.isFinite(template.party?.level) || !Number.isFinite(template.party?.size)) return;
  state.party.level = Math.min(20, Math.max(1, template.party.level));
  state.party.size = Math.min(8, Math.max(1, template.party.size));
  save();
}

function saveAsSheet(onSave, initialTitle = '') {
  const { node } = sheet('Save encounter', `
    <label class="field">Name<input type="text" data-template-title value="${esc(initialTitle)}" autofocus></label>
    <label class="field">Notes<textarea data-template-notes rows="3" placeholder="Optional table notes"></textarea></label>
    <button class="primary" data-template-save>Save</button>`);
  on(node, 'click', '[data-template-save]', (e, el) => {
    const title = qs('[data-template-title]', node).value;
    const notes = qs('[data-template-notes]', node).value;
    onSave(title, notes);
    node.querySelector('[data-close]')?.click();
  });
}

function confirmLoad(template) {
  if (!state.encounter.dirty || !state.encounter.entries.length) { loadSaved(template); return; }
  const { node, close } = sheet(`Load ${template.title}`, `
    <p class="muted">The current draft has changes. Loading replaces it, but never changes the saved template.</p>
    <button class="primary" data-save-copy>Save current draft, then load</button>
    <button class="danger" data-replace>Replace draft</button>`);
  on(node, 'click', '[data-replace]', () => { loadSaved(template); close(); });
  on(node, 'click', '[data-save-copy]', () => {
    close();
    saveAsSheet((title, notes) => { saveDraft(title, notes); loadSaved(template); }, 'Current draft');
  });
}

function openTemplates() {
  const { node } = sheet('Saved encounters', '<div data-template-list></div>');
  const draw = () => {
    const selected = state.encounter.selectedId;
    const list = state.encounters.saved;
    qs('[data-template-list]', node).innerHTML = `
      <p class="muted">Saved encounters keep a separate template. Loading gives the planner fresh entry IDs; the party header stays as it is unless you explicitly apply the saved context.</p>
      <div class="row wrap">
        <button class="primary" data-save-as>Save as</button>
        ${selected && list.some(template => template.id === selected) ? '<button data-update-saved>Update saved</button>' : ''}
      </div>
      <div class="saved-encounters">${list.length ? list.map(template => {
        const warnings = templateWarnings(template);
        return `<div class="card saved-encounter${template.id === selected ? ' selected' : ''}">
          <b>${esc(template.title)}</b><span class="muted">${template.entries.length} entries · ${esc(template.party?.level ?? '?')}/${esc(template.party?.size ?? '?')} PCs</span>
          ${template.notes ? `<span class="muted">${esc(template.notes)}</span>` : ''}
          ${warnings.length ? `<span class="saved-warning">Missing reference details: ${esc(warnings.join(', '))}</span>` : ''}
          <div class="row wrap"><button class="primary" data-load-saved="${esc(template.id)}">Load</button>
            <button data-apply-party="${esc(template.id)}">Apply party</button><button data-duplicate="${esc(template.id)}">Duplicate</button>
            <button class="danger" data-delete-saved="${esc(template.id)}">Delete</button></div>
        </div>`;
      }).join('') : '<div class="empty">No saved encounters yet.</div>'}</div>`;
  };
  on(node, 'click', '[data-save-as]', () => saveAsSheet((title, notes) => { saveDraft(title, notes); draw(); }, state.encounters.saved.length ? '' : 'Encounter'));
  on(node, 'click', '[data-update-saved]', () => { updateSaved(state.encounter.selectedId); draw(); });
  on(node, 'click', '[data-load-saved]', (e, el) => {
    const template = state.encounters.saved.find(item => item.id === el.dataset.loadSaved);
    if (template) confirmLoad(template);
  });
  on(node, 'click', '[data-apply-party]', (e, el) => {
    const template = state.encounters.saved.find(item => item.id === el.dataset.applyParty);
    if (template) { applySavedParty(template); draw(); }
  });
  on(node, 'click', '[data-duplicate]', (e, el) => {
    const template = state.encounters.saved.find(item => item.id === el.dataset.duplicate);
    if (!template) return;
    saveAsSheet((title, notes) => {
      const copy = { ...JSON.parse(JSON.stringify(template)), id: uid('saved'), title: title || `${template.title} copy`, notes,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      state.encounters.saved.push(copy); save(); draw();
    }, `${template.title} copy`);
  });
  on(node, 'click', '[data-delete-saved]', (e, el) => {
    const template = state.encounters.saved.find(item => item.id === el.dataset.deleteSaved);
    if (!template || !window.confirm(`Delete saved encounter “${template.title}”?`)) return;
    state.encounters.saved = state.encounters.saved.filter(item => item.id !== template.id);
    if (state.encounter.selectedId === template.id) state.encounter.selectedId = null;
    save(); draw();
  });
  draw();
}

function addCustom() {
  const body = `
    <label class="field">Name<input type="text" id="f-name" placeholder="Goblin Warrior"></label>
    <label class="field">Level<input type="number" id="f-level" value="${state.party.level}" min="-1" max="25"></label>
    <label class="field">Kind
      <select id="f-kind">
        <option value="creature">Creature</option>
        <option value="simple">Simple hazard</option>
        <option value="complex">Complex hazard</option>
      </select>
    </label>
    <button class="primary" id="f-save">Add</button>`;
  sheet('Add to encounter', body, (node, close) => {
    qs('#f-save', node).addEventListener('click', () => {
      const name = qs('#f-name', node).value.trim() || 'Unnamed';
      addEntry(name, Number(qs('#f-level', node).value) || 0, qs('#f-kind', node).value);
      close();
    });
  });
}

async function addFromBestiary() {
  const [all, traitList] = await Promise.all([creatures(), traits()]);
  const axes = buildFacets(all, { creatureTypes: creatureTypeNames(traitList) });

  const body = `
    <input type="search" id="b-search" placeholder="Search creatures&hellip;" autocomplete="off">
    <div class="row spread" style="margin-top:8px">
      <button class="ghost" id="b-filters" aria-expanded="false"
        style="min-height:32px;font-size:0.74rem">Filters</button>
      <span class="muted" id="b-count" style="font-size:0.72rem"></span>
    </div>
    <div id="b-filter-panel" hidden>
      <label class="row" style="font-size:0.82rem;color:var(--muted)">
        <input type="checkbox" id="b-band" style="width:auto;min-height:auto">
        Only creatures inside this party&rsquo;s XP band
      </label>
      <div class="row wrap" id="b-facets" style="margin-top:10px;gap:8px"></div>
      <div class="row" style="margin-top:8px">
      <button class="ghost" id="b-clear" style="min-height:32px;font-size:0.74rem">Clear</button>
      </div>
    </div>
    <div class="list" id="b-list"></div>`;
  const { node, close } = sheet('Bestiary', body);
  qs('.sheet', node).classList.add('sheet-browse');
  const list = qs('#b-list', node);
  const chosen = {};
  let query = '';
  let bandOnly = false;
  let filtersOpen = false;

  /**
   * Everything matching the search, the XP band and every chosen value — optionally
   * ignoring one axis, which is how each dropdown lists what is still reachable through
   * the *other* filters instead of only the value already picked.
   */
  const matches = (skip = null) => {
    const needle = query.trim().toLowerCase();
    const active = skip ? axes.filter(a => a !== skip) : axes;
    return all.filter(c => {
      if (bandOnly && creatureXP(c.level, state.party.level) === null) return false;
      if (!facetPasses(c, active, chosen)) return false;
      if (!needle) return true;
      return c.name.toLowerCase().includes(needle)
        || (c.traits || []).some(t => t.toLowerCase().includes(needle));
    });
  };

  const draw = () => {
    qs('#b-facets', node).innerHTML =
      facetSelects(axes, chosen, axis => facetOptions(matches(axis), axis));
    const hits = matches();
    const activeFilters = (bandOnly ? 1 : 0) + axes.filter(axis => Boolean(chosen[axis.id])).length;
    const filterButton = qs('#b-filters', node);
    filterButton.textContent = activeFilters ? `Filters · ${activeFilters}` : 'Filters';
    filterButton.setAttribute('aria-expanded', String(filtersOpen));
    qs('#b-filter-panel', node).hidden = !filtersOpen;
    qs('#b-count', node).textContent = `${hits.length} creature${hits.length === 1 ? '' : 's'}`
      + (hits.length > 60 ? ' · showing the first 60' : '');

    list.innerHTML = hits.length
      ? hits.slice(0, 60).map(c => {
        const xp = creatureXP(c.level, state.party.level);
        return `
        <button class="item" data-pick="${esc(c.id)}" style="text-align:left"${tip(recordTip(c))}>
          <span class="lvl">${c.level}</span>
          <div class="grow">
            <div class="name">${esc(c.name)}</div>
            <div class="sub">${esc((c.traits || []).join(' · '))}</div>
          </div>
          <span class="muted">${xp === null ? '—' : xp + ' XP'}</span>
        </button>`;
      }).join('')
      : '<div class="empty">Nothing matches that.</div>';
  };

  draw();
  qs('#b-search', node).addEventListener('input', e => { query = e.target.value; draw(); });
  qs('#b-band', node).addEventListener('change', e => { bandOnly = e.target.checked; draw(); });
  qs('#b-filters', node).addEventListener('click', () => { filtersOpen = !filtersOpen; draw(); });
  on(node, 'change', '[data-facet]', (e, el) => {
    facetChange(chosen, el, axes);
    draw();
  });
  qs('#b-clear', node).addEventListener('click', () => {
    for (const axis of axes) chosen[axis.id] = '';
    query = '';
    bandOnly = false;
    qs('#b-search', node).value = '';
    qs('#b-band', node).checked = false;
    draw();
  });
  on(node, 'click', '[data-pick]', (e, el) => {
    const c = all.find(x => x.id === el.dataset.pick);
    if (c) addEntry(c.name, c.level, 'creature', c);
    close();
  });
}

async function addFromHazards() {
  const all = await hazards();
  let query = '';
  const { node, close } = sheet('Hazards', `
    <input type="search" id="h-search" placeholder="Search hazards…" autocomplete="off">
    <div class="list" id="h-list"></div>`);
  const draw = () => {
    const needle = query.trim().toLowerCase();
    const hits = all.filter(h => !needle || h.name?.toLowerCase().includes(needle)
      || (h.traits || []).some(t => t.toLowerCase().includes(needle))).slice(0, 60);
    qs('#h-list', node).innerHTML = hits.map(h => `
      <button class="item" data-hazard-pick="${esc(h.id)}" style="text-align:left"${tip(recordTip(h))}>
        <span class="lvl">${h.level ?? '—'}</span><div class="grow"><div class="name">${esc(h.name)}</div>
        <div class="sub">${esc(h.complexity || 'Simple')} · ${esc(h.hazardType || 'Hazard')}</div></div>
      </button>`).join('') || '<div class="empty">Nothing matches that.</div>';
  };
  draw();
  qs('#h-search', node).addEventListener('input', e => { query = e.target.value; draw(); });
  on(node, 'click', '[data-hazard-pick]', (e, el) => {
    const hazard = all.find(h => h.id === el.dataset.hazardPick);
    if (hazard) addHazard(hazard);
    close();
  });
}

/** How many planned participants (creatures plus complex hazards) enter initiative. */
export function plannedCount() {
  return state.encounter.entries
    .filter(e => e.kind === 'creature' || e.kind === 'complex')
    .reduce((n, e) => n + e.count, 0);
}

/**
 * Put planned creatures and complex hazards into initiative. Simple hazards remain in
 * the planner as accessible trigger references: unlike complex hazards, they react once
 * and do not take encounter turns (GM Core, Hazard Format).
 *
 * Exported because the tracker pulls with this as well as the planner pushing with it —
 * the same trip, started from either end — and neither should own a second copy of the
 * mapping from a planner entry to a combatant. Anyone already in the order stays: a second
 * wave of the same creatures is a real thing to plan, so this adds rather than replaces.
 */
export function sendToCombat() {
  let added = 0;
  combatTransaction('Import encounter', combat => {
    for (const e of state.encounter.entries) {
      if (e.kind !== 'creature' && e.kind !== 'complex') continue;
      if (e.kind === 'complex') {
        const h = e.hazard || {};
        for (let i = 0; i < e.count; i++) {
          combat.combatants.push({
            id: uid('h'), name: e.count > 1 ? `${e.name} ${i + 1}` : e.name,
            ref: h.id ? { kind: 'hazard', id: h.id } : null,
            isHazard: true, isPC: false, side: 'npc', init: null,
            initMod: hazardInitiative(h.stealth), hp: h.hp ?? null, maxHp: h.hp ?? null,
            ac: h.ac ?? null, hardness: h.hardness ?? null, brokenThreshold: h.brokenThreshold ?? null,
            saves: h.saves || {}, immunities: h.immunity || [], resistances: h.resistance || {}, weaknesses: h.weakness || {},
            hazard: { triggered: false, disabled: false, progress: 0, trigger: h.trigger || null,
              routine: h.routine || null, disable: h.disable || null, reset: h.reset || null }, conditions: []
          });
          added += 1;
        }
        continue;
      }
      const prefix = e.adjust === 'elite' ? 'Elite ' : e.adjust === 'weak' ? 'Weak ' : '';
      const hp = adjustedHP(e.creature?.hp ?? null, e.level, e.adjust);
      const ac = adjustedAC(e.creature?.ac ?? null, e.adjust);
      for (let i = 0; i < e.count; i++) {
        combat.combatants.push({
          id: uid('c'),
          name: prefix + (e.count > 1 ? `${e.name} ${i + 1}` : e.name),
          ref: e.creature?.id ? { kind: 'creature', id: e.creature.id } : null,
          adjust: e.adjust === 'elite' || e.adjust === 'weak' ? e.adjust : null,
          baseLevel: e.level,
          isPC: false, side: 'npc', init: null,
          initMod: adjustedModifier(e.creature?.perception, e.adjust),
          hp, maxHp: hp, ac, conditions: []
        });
        added += 1;
      }
    }
  });
  return added;
}


function toCombat() {
  // The navigation is immediate, but a double tap can still reach this handler twice
  // before the view swaps. One launch is one import transaction; deliberate later waves
  // still use sendToCombat() from the tracker or planner after returning.
  if (toCombat.launching) return;
  toCombat.launching = true;
  sendToCombat();
  location.hash = '#/combat';
}
