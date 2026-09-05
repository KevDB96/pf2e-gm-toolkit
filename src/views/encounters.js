// Encounter planner: build a roster, watch the XP budget, hand it to the tracker.

import { state, save, uid } from '../store.js';
import { esc, on, sheet, tip, qs } from '../dom.js';
import { creatureXP, hazardXP, budgets, threatFor, threatScale, threatPosition, xpAward,
  adjustedLevel, adjustedHP, adjustedAC } from '../pf2e.js';
import { creatures, traits } from '../data.js';
import { recordTip } from '../records.js';
import { buildFacets, creatureTypeNames, facetChange, facetOptions, facetPasses, facetSelects }
  from '../facets.js';

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
      <button data-add-custom>+ Custom</button>
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
  on(root, 'click', '[data-inc]', (e, el) => bump(el.dataset.inc, +1));
  on(root, 'click', '[data-dec]', (e, el) => bump(el.dataset.dec, -1));
  on(root, 'click', '[data-del]', (e, el) => {
    state.encounter.entries = state.encounter.entries.filter(x => x.id !== el.dataset.del);
    save();
  });
  on(root, 'click', '[data-clear]', () => { state.encounter.entries = []; save(); });
  on(root, 'click', '[data-to-combat]', () => toCombat());
  on(root, 'click', '[data-adjust]', (e, el) => setAdjust(el.dataset.adjust, el.dataset.kind));
}

function bump(id, delta) {
  const entry = state.encounter.entries.find(x => x.id === id);
  if (!entry) return;
  entry.count = Math.max(1, entry.count + delta);
  save();
}

/** Elite and Weak are mutually exclusive and each toggles off when tapped again. */
function setAdjust(id, kind) {
  const entry = state.encounter.entries.find(x => x.id === id);
  if (!entry) return;
  entry.adjust = entry.adjust === kind ? null : kind;
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
  const url = e.creature?.url;
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
  const match = state.encounter.entries
    .find(e => e.name === name && e.level === level && e.kind === kind);
  if (match) match.count += 1;
  else state.encounter.entries.push({ id: uid('enc'), name, level, count: 1, kind, creature, adjust: null });
  save();
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

/** How many creatures the planned encounter would put into the tracker. */
export function plannedCount() {
  return state.encounter.entries
    .filter(e => e.kind === 'creature')
    .reduce((n, e) => n + e.count, 0);
}

/**
 * Put the planned creatures into the initiative order and return how many were added.
 * Hazards are left behind: they have no initiative of their own.
 *
 * Exported because the tracker pulls with this as well as the planner pushing with it —
 * the same trip, started from either end — and neither should own a second copy of the
 * mapping from a planner entry to a combatant. Anyone already in the order stays: a second
 * wave of the same creatures is a real thing to plan, so this adds rather than replaces.
 */
export function sendToCombat() {
  let added = 0;
  for (const e of state.encounter.entries) {
    if (e.kind !== 'creature') continue;
    const prefix = e.adjust === 'elite' ? 'Elite ' : e.adjust === 'weak' ? 'Weak ' : '';
    // Adjusted, not the sheet's own numbers — an elite goblin belongs in the tracker
    // with elite HP and AC, or the fight is not the one the planner budgeted for.
    const hp = adjustedHP(e.creature?.hp ?? null, e.level, e.adjust);
    const ac = adjustedAC(e.creature?.ac ?? null, e.adjust);
    for (let i = 0; i < e.count; i++) {
      state.combat.combatants.push({
        id: uid('c'),
        name: prefix + (e.count > 1 ? `${e.name} ${i + 1}` : e.name),
        // The planner is already holding the whole record — it reads hp and ac off it two
        // lines down — so keeping its id costs nothing and is the only reliable way back
        // to the creature's Strikes and saves. Names repeat across the bestiary; ids do
        // not. See the note in combat.js addPC() about rows that predate this.
        ref: e.creature?.id ? { kind: 'creature', id: e.creature.id } : null,
        isPC: false,
        side: 'npc',
        init: null,
        hp,
        maxHp: hp,
        ac,
        conditions: []
      });
      added += 1;
    }
  }
  save();
  return added;
}

function toCombat() {
  sendToCombat();
  location.hash = '#/combat';
}
