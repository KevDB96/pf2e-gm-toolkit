// Library: one browser over every reference file, driven by data/index.json.
//
// Adding a category to tools/fetch-aon.mjs puts it here automatically — the picker, the
// search and the detail sheet are all generic. Creatures get two extras (the party XP
// band filter and add-to-encounter) because that is what a GM actually does with them.

import { state, save, uid } from '../store.js';
import { caps, esc, on, sheet, tip, qs, qsa } from '../dom.js';
import { creatureXP, LEVEL_DC, actionIcons } from '../pf2e.js';
import { manifest, records, recordsStatus, searchIndex, traits as loadTraits } from '../data.js';
import { recordTip } from '../records.js';
import { buildFacets, creatureTypeNames, facetChange, facetOptions, facetSelects }
  from '../facets.js';
import { addEntry, addHazard } from './encounters.js';
import { searchAll } from '../search.js';
import { librarySearchBase, librarySelectedRows, prepareLibraryRows } from '../library-filter.js';
import { addPin, hasPin, removePin } from '../pins.js';

const RENDER_CAP = 200;

let categories = [];
let active = null;      // the manifest entry currently shown
let rows = [];          // records for `active`
let preparedRows = [];  // normalized sidecars for rows; never mutates generated records
let currentBase = [];   // query/XP-filtered rows, shared by every facet calculation
let query = '';
let bandOnly = false;
let axes = [];          // the filter dropdowns for the loaded category
let chosen = {};        // axis id -> chosen value
let creatureTypes = new Set();
let loading = false;
let unavailable = false;

const ALL = '__all__';           // the "All" chip's data-cat value
let global = false;              // true when "All" is selected; `active` is null then
let searchIndexData;             // undefined = not requested yet, null = missing, else the index
let indexLoading = false;
let pending = null;              // { cat, id, pinned?, label? } queued until categories load
let drawTimer = null;

// Fields that get bespoke treatment, or are plumbing the reader does not want to see.
const SKIP = new Set(['id', 'name', 'url', 'notes', 'traits', 'source', 'level', 'kind',
  'strikes', 'specials']);

const LABEL = {
  ac: 'AC', hp: 'HP', dexCap: 'Dex cap', levelDC: 'Level DC', priceRaw: 'Price',
  bulkRaw: 'Bulk', damageType: 'Damage type', keyAbility: 'Key attribute',
  attributeFlaw: 'Attribute flaw', hazardType: 'Hazard type', primaryCheck: 'Primary check',
  secondaryCheck: 'Secondary check', secondaryCasters: 'Secondary casters',
  areaOfConcern: 'Area of concern', divineFont: 'Divine font', favoredWeapon: 'Favoured weapon',
  sacredAnimal: 'Sacred animal', sacredColor: 'Sacred colour', religiousSymbol: 'Religious symbol',
  clericSpell: 'Cleric spell', followerAlignment: 'Follower alignment',
  archetypeCategory: 'Archetype category', generalBackground: 'General background'
};

// price and bulk are the raw integers behind priceRaw/bulkRaw; the formatted ones read better.
const REDUNDANT = new Set(['price', 'bulk']);

// Fields whose numbers are amounts rather than modifiers. Resistance 15 subtracts 15 from
// the damage; it is not a +15 to anything, and printing it signed states a different rule.
// Saves, abilities and skills are the other way round and read with their sign.
const AMOUNTS = new Set(['resistances', 'weaknesses']);

const label = k => LABEL[k] || k.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
const mod = n => (n >= 0 ? '+' : '') + n;

export function mount(root) {
  root.innerHTML = `
    <div class="picker" id="cats"><span class="muted">Loading library&hellip;</span></div>
    <div class="card">
      <input type="search" id="search" placeholder="Search&hellip;" autocomplete="off">
      <label class="row" id="band-wrap" hidden
             style="margin-top:10px;font-size:0.82rem;color:var(--muted)">
        <input type="checkbox" id="band" style="width:auto;min-height:auto">
        Only creatures inside this party&rsquo;s XP band
      </label>
      <div class="row wrap" id="facets" style="margin-top:10px;gap:8px"></div>
    </div>
    <div class="picker" id="recent" hidden></div>
    <div class="row spread">
      <span class="muted" id="count"></span>
      <button class="ghost" id="clear" hidden
              style="min-height:32px;font-size:0.74rem">Clear filters</button>
    </div>
    <div class="list" id="results"></div>`;

  qs('#search', root).addEventListener('input', e => { query = e.target.value; scheduleDraw(root); });
  qs('#band', root).addEventListener('change', e => { bandOnly = e.target.checked; draw(root); });
  on(root, 'change', '[data-facet]', (e, el) => {
    facetChange(chosen, el, axes);
    draw(root);
  });
  qs('#clear', root).addEventListener('click', () => {
    chosen = {};
    query = '';
    bandOnly = false;
    qs('#search', root).value = '';
    qs('#band', root).checked = false;
    draw(root);
  });
  on(root, 'click', '[data-cat]', (e, el) => select(root, el.dataset.cat));
  on(root, 'click', '[data-open]', (e, el) => {
    const r = rows.find(x => x.id === el.dataset.open);
    if (r) openDetailFor(r, active);
  });
  on(root, 'click', '[data-hit-cat]', (e, el) => openByRef(el.dataset.hitCat, el.dataset.hitId));
  on(root, 'click', '[data-see]', (e, el) => seeAll(root, el.dataset.see, el.dataset.seeQuery));
  on(root, 'click', '[data-recent-cat]', (e, el) => openByRef(el.dataset.recentCat, el.dataset.recentId));
  on(root, 'click', '[data-clear-recent]', () => { state.ui.recent = []; save(); });
  on(root, 'click', '[data-offline-data]', () => { location.hash = '#/home'; });

  loadTraits().then(list => { creatureTypes = creatureTypeNames(list); draw(root); });

  manifest().then(list => {
    categories = list;
    if (!categories.length) {
      qs('#cats', root).innerHTML =
        '<span class="muted">No data/index.json — run <code>npm run data</code>.</span>';
      return;
    }
    drawChips(root);
    // The Library opens as one name lookup across the whole rules set. A category is a
    // deliberate refinement, not an arbitrary first page of records.
    select(root, ALL);
    maybeOpenPending();
  });
}

function drawChips(root) {
  qs('#cats', root).innerHTML =
    `<button class="pick" data-cat="${ALL}"><span aria-hidden="true">🔍</span> All</button>` +
    categories.map(c => `
      <button class="pick" data-cat="${esc(c.name)}">
        <span aria-hidden="true">${c.glyph}</span> ${esc(c.label)}
      </button>`).join('');
}

function select(root, name) {
  if (name === ALL) { selectGlobal(root); return; }
  global = false;
  const next = categories.find(c => c.name === name);
  if (!next) return;
  active = next;
  query = '';
  bandOnly = false;
  axes = [];
  chosen = {};
  const search = qs('#search', root);
  if (search) { search.value = ''; search.placeholder = `Search ${active.label.toLowerCase()}…`; }
  const band = qs('#band', root);
  if (band) band.checked = false;
  qs('#band-wrap', root).hidden = active.name !== 'creatures';

  qsa('#cats .pick', root).forEach(el => el.classList.toggle('on', el.dataset.cat === name));

  clearScheduledDraw();
  rows = [];
  preparedRows = [];
  currentBase = [];
  unavailable = false;
  loading = true;
  draw(root);
  recordsStatus(active).then(result => {
    // A slower category can resolve after the reader has already moved on.
    if (active?.name !== name) return;
    rows = result.records;
    preparedRows = prepareLibraryRows(rows);
    unavailable = result.unavailable;
    loading = false;
    draw(root);
  });
}

function selectGlobal(root) {
  clearScheduledDraw();
  global = true;
  active = null;
  query = '';
  axes = [];
  chosen = {};
  bandOnly = false;
  const search = qs('#search', root);
  if (search) { search.value = ''; search.placeholder = 'Search all entries by name…'; }
  const band = qs('#band', root);
  if (band) band.checked = false;
  qs('#band-wrap', root).hidden = true;
  qs('#facets', root).innerHTML = '';
  qsa('#cats .pick', root).forEach(el => el.classList.toggle('on', el.dataset.cat === ALL));
  rows = [];
  preparedRows = [];
  currentBase = [];
  if (searchIndexData === undefined && !indexLoading) {
    indexLoading = true;
    searchIndex().then(idx => { indexLoading = false; searchIndexData = idx; draw(root); });
  }
  draw(root);
}

/**
 * The records matching the search, the XP band and every chosen filter. `skip` drops one
 * axis from the test, which is how each dropdown lists what is still reachable through the
 * other filters instead of only the value already picked.
 */
function filtered(skip = null) { return librarySelectedRows(currentBase, axes, chosen, skip); }

function clearScheduledDraw() {
  if (drawTimer) clearTimeout(drawTimer);
  drawTimer = null;
}

function scheduleDraw(root) {
  clearScheduledDraw();
  drawTimer = setTimeout(() => {
    drawTimer = null;
    if (root.isConnected) draw(root);
  }, 80);
}

export function update(root) {
  if (qs('#results', root)) draw(root);
}

function draw(root) {
  if (!root.isConnected) return;
  const results = qs('#results', root);
  const count = qs('#count', root);
  if (!results) return;

  drawRecent(root);
  if (global) { drawGlobal(root, results, count); return; }

  // Traits and the category manifest are loaded independently. On a warm cache the
  // smaller traits file can win the race, which used to reach this renderer before
  // select() had established an active category.
  if (!active) {
    count.textContent = '';
    qs('#facets', root).innerHTML = '';
    qs('#clear', root).hidden = true;
    results.innerHTML = '<div class="empty">Loading library&hellip;</div>';
    return;
  }

  if (loading) {
    count.textContent = '';
    qs('#facets', root).innerHTML = '';
    results.innerHTML = `<div class="empty">Loading ${esc(active?.label || '')}&hellip;</div>`;
    return;
  }

  if (unavailable) {
    count.textContent = '';
    qs('#facets', root).innerHTML = '';
    results.innerHTML = `<div class="empty">This ${esc(active.label.toLowerCase())} file is not available on this device. ${navigator.onLine ? 'Use Offline data to download it.' : 'Reconnect, then use Offline data to download it.'}<br><button class="primary" data-offline-data style="margin-top:10px">Offline data</button></div>`;
    return;
  }

  // Which filters this category gets is decided by the records it holds — creatures offer
  // type, size, rarity and family; spells offer rank, type and tradition; equipment offers
  // category, group and damage type. See buildFacets() in src/facets.js.
  if (!axes.length) axes = buildFacets(rows, { creatureTypes });
  // One lowercased text/XP pass feeds both the final results and every self-excluding
  // dropdown count. Selections still run independently per axis, preserving faceting.
  currentBase = librarySearchBase(preparedRows, {
    query, bandOnly, partyLevel: state.party.level
  });
  qs('#facets', root).innerHTML =
    facetSelects(axes, chosen, axis => facetOptions(filtered(axis), axis));
  qs('#clear', root).hidden = !query && !bandOnly && !Object.values(chosen).some(Boolean);

  // The Library is a lookup tool at the table, not a catalogue to scroll through.
  // Loading a category should expose its useful filters but should not immediately paint
  // the first 200 records just because that category happens to be selected.
  const filtering = Boolean(query.trim()) || bandOnly || Object.values(chosen).some(Boolean);
  if (!filtering) {
    count.textContent = rows.length
      ? `${rows.length.toLocaleString()} ${active.label.toLowerCase()} · search or filter to narrow`
      : '';
    results.innerHTML = '<div class="empty">Search or choose a filter to see entries.</div>';
    return;
  }

  const hits = filtered();
  count.textContent = rows.length
    ? `${hits.length} of ${rows.length} ${active.label.toLowerCase()}` +
      (hits.length > RENDER_CAP ? ` · showing the first ${RENDER_CAP}` : '')
    : '';
  results.innerHTML = hits.length
    ? hits.slice(0, RENDER_CAP).map(row).join('')
    : `<div class="empty">${rows.length
        ? 'Nothing matches that search.'
        : `No ${esc(active?.label.toLowerCase() || 'records')} loaded.`}</div>`;
}

function drawRecent(root) {
  const el = qs('#recent', root);
  if (!el) return;
  const list = state.ui.recent;
  if (query.trim() || !list.length) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = list.map(r => `
      <button class="pick" data-recent-cat="${esc(r.cat)}" data-recent-id="${esc(r.id)}">${esc(r.name)}</button>`
    ).join('') +
    '<button class="pick" data-clear-recent>Clear recent</button>';
}

function drawGlobal(root, results, count) {
  qs('#facets', root).innerHTML = '';
  count.textContent = '';
  qs('#clear', root).hidden = !query && !Object.values(chosen).some(Boolean);

  if (indexLoading) {
    results.innerHTML = '<div class="empty">Loading the search index&hellip;</div>';
    return;
  }
  if (searchIndexData === null) {
    results.innerHTML =
      '<div class="empty">No data/search.json — run <code>npm run data</code>.</div>';
    return;
  }
  if (!query.trim()) {
    results.innerHTML = '<div class="empty">Search by name to see entries.</div>';
    return;
  }
  const groups = searchAll(searchIndexData, query, { perCategory: 6 });
  results.innerHTML = groups.length
    ? groups.map(groupBlock).join('')
    : '<div class="empty">Nothing matches that search.</div>';
}

function groupBlock(g) {
  const cat = categories.find(c => c.name === g.category);
  if (!cat) return '';
  const rowsHtml = g.hits.map(h => globalRow(cat, h)).join('');
  const more = g.total > g.hits.length
    ? `<button class="ghost" data-see="${esc(cat.name)}" data-see-query="${esc(query)}"
              style="min-height:44px;width:100%;font-size:0.78rem;margin-top:4px">
        See all ${g.total} in ${esc(cat.label)}
      </button>`
    : '';
  return `
    <div class="group-head">${cat.glyph} ${esc(cat.label)} · ${g.total}</div>
    <div class="list">${rowsHtml}</div>
    ${more}`;
}

function globalRow(cat, h) {
  return `
    <button class="item" data-hit-cat="${esc(cat.name)}" data-hit-id="${esc(h.id)}" style="text-align:left">
      ${h.level === undefined ? '' : `<span class="lvl">${h.level}</span>`}
      <div class="grow">
        <div class="name">${esc(h.name)}</div>
      </div>
    </button>`;
}

function seeAll(root, catName, savedQuery) {
  select(root, catName);
  query = savedQuery;
  const search = qs('#search', root);
  if (search) search.value = savedQuery;
}

function row(r) {
  if (!active) return '';
  const xp = active.name === 'creatures' ? creatureXP(r.level, state.party.level) : null;
  const sub = (r.traits || []).join(' · ') || r.notes || '';
  return `
    <button class="item" data-open="${esc(r.id)}" style="text-align:left"${tip(recordTip(r))}>
      ${r.level === undefined ? '' : `<span class="lvl">${r.level}</span>`}
      <div class="grow">
        <div class="name">${esc(r.name)}</div>
        <div class="sub">${esc(sub.length > 90 ? sub.slice(0, 88) + '…' : sub) || '&mdash;'}</div>
      </div>
      ${xp === null ? '' : `<span class="muted">${xp} XP</span>`}
    </button>`;
}

/**
 * A creature's Strikes and its activatable abilities, one line each.
 *
 * These are the only fields in `data/` holding an array of objects, and the generic
 * branch in stat() would join them straight to "[object Object]". They also read far
 * better as their own lines than as one comma-joined run: a Strike is a name, a bonus and
 * a damage expression, which is the shape a GM reads off a stat block.
 */
function strikeRows(list) {
  return (list || []).map((s) => {
    const traits = (s.traits || []).length ? ` (${s.traits.map(caps).join(', ')})` : '';
    const right = s.damage
      || [s.dc ? `DC ${s.dc}${s.basic ? ' basic' : ''}${s.save ? ' ' + caps(s.save) : ''}` : null,
          s.recharge ? `recharge ${s.recharge}` : null].filter(Boolean).join(' · ')
      || '—';
    const left = s.bonus === undefined
      ? `${caps(s.name)}${s.actions ? ' ' + actionIcons(s.actions) : ''}`
      : `${caps(s.name)} ${mod(s.bonus)}`;
    return `<div class="share"><span class="muted">${esc(left + traits)}</span>`
      + `<b>${esc(right)}</b></div>`;
  }).join('');
}

function stat(k, v) {
  if (v === null || v === undefined || v === '') return '';
  // Action costs read as icons, the way Pathbuilder and the Archives show them.
  if (k === 'actions') v = actionIcons(v);
  // The only field in data/*.json this app shows in feet: rituals' `area`, confirmed with
  // the user. The generator stores it as an array of numbers, and 0 in that array means
  // "nothing recorded" rather than an area of zero (e.g. Ash-Strewn Ending) — drop those
  // instead of printing "Area 0 feet". Keyed on the field name, not the category, per
  // CLAUDE.md: a view must not special-case one category of records.
  if (k === 'area') {
    const feet = (Array.isArray(v) ? v : [v]).filter(n => typeof n === 'number' && n > 0);
    if (!feet.length) return '';
    v = feet.join(', ') + ' feet';
  }
  if (Array.isArray(v)) { if (!v.length) return ''; v = v.join(', '); }
  if (typeof v === 'object') {
    // The keys inside a value are names of things — Fort, Dex, Acrobatics, Holy — and are
    // stored lowercase, so they get the same capitals as the row's own label.
    const signed = !AMOUNTS.has(k);
    const parts = Object.entries(v).map(([n, m]) =>
      `${caps(n)} ${typeof m === 'number' && signed ? mod(m) : m}`);
    if (!parts.length) return '';
    v = parts.join(', ');
  }
  if (typeof v === 'boolean') v = v ? 'yes' : 'no';
  return `<div class="share"><span class="muted">${esc(label(k))}</span><b>${esc(v)}</b></div>`;
}

function openDetailFor(record, categoryEntry) {
  const head = [
    categoryEntry.label.replace(/s$/, ''),
    record.level === undefined ? null : `level ${record.level}`,
    record.rarity && record.rarity !== 'common' ? record.rarity : null
  ].filter(Boolean).join(' · ');

  const extras = Object.keys(record)
    .filter(k => !SKIP.has(k) && !REDUNDANT.has(k) && k !== 'rarity')
    .map(k => stat(k, record[k]))
    .join('');

  const isCreature = categoryEntry.name === 'creatures';
  const target = { type: 'reference', category: categoryEntry.name, id: record.id };
  const pinned = hasPin(state.ui.pins, target);
  const body = `
    <div class="muted">${esc(head)}</div>
    ${(record.traits || []).length
      ? `<div class="row wrap" style="gap:6px">${record.traits
          .map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>`
      : ''}
    ${extras || isCreature ? `<div class="card">${extras}${
      isCreature ? stat('levelDC', LEVEL_DC[Math.max(0, record.level)]) : ''}</div>` : ''}
    ${(record.strikes || []).length
      ? `<div class="card"><h2>Strikes</h2>${strikeRows(record.strikes)}</div>` : ''}
    ${(record.specials || []).length
      ? `<div class="card"><h2>Abilities</h2>${strikeRows(record.specials)}</div>` : ''}
    ${record.notes ? `<div class="card"><h2>Summary</h2><div class="muted">${esc(record.notes)}</div></div>` : ''}
    ${record.url ? `<div class="muted" style="font-size:0.72rem">
      <a href="${esc(record.url)}" target="_blank" rel="noopener">Open on Archives of Nethys</a>
    </div>` : ''}
    ${(isCreature || categoryEntry.name === 'hazards') ? '<button class="primary" data-to-encounter>Add to encounter</button>' : ''}
    <button class="ghost" data-pin-reference>${pinned ? 'Unpin from session' : 'Pin to session'}</button>`;

  const { node, close } = sheet(record.name, body);
  on(node, 'click', '[data-to-encounter]', () => {
    if (isCreature) addEntry(record.name, record.level, 'creature', record);
    else addHazard(record);
    close();
    location.hash = '#/encounters';
  });
  on(node, 'click', '[data-pin-reference]', (event, button) => {
    const existingPin = state.ui.pins.find(pin => hasPin([pin], target));
    state.ui.pins = existingPin
      ? removePin(state.ui.pins, existingPin.id)
      : addPin(state.ui.pins, { id: uid('pin'), target, label: record.name });
    save();
    button.textContent = existingPin ? 'Pin to session' : 'Unpin from session';
  });

  remember(categoryEntry.name, record.id, record.name);
}

function remember(cat, id, name) {
  const kept = state.ui.recent.filter(r => !(r.cat === cat && r.id === id));
  kept.unshift({ cat, id, name });
  state.ui.recent = kept.slice(0, 12);
  save();
}

function dropRecent(cat, id) {
  const before = state.ui.recent.length;
  state.ui.recent = state.ui.recent.filter(r => !(r.cat === cat && r.id === id));
  if (state.ui.recent.length !== before) save();
}

function openByRef(cat, id, options = {}) {
  const catEntry = categories.find(c => c.name === cat);
  if (!catEntry) {
    if (!options.pinned) { dropRecent(cat, id); return; }
    missingPinnedRecord(options.label, { type: 'reference', category: cat, id });
    return;
  }
  recordsStatus(catEntry).then(result => {
    if (result.unavailable) {
      sheet('Rules file unavailable', `<p class="muted">This result appears in the name search, but its ${esc(catEntry.label.toLowerCase())} detail file is not saved here. ${navigator.onLine ? 'Open Offline data on Home to download it.' : 'Reconnect to download it.'}</p><button class="primary" data-offline-data>Offline data</button>`, node => {
        on(node, 'click', '[data-offline-data]', () => { location.hash = '#/home'; });
      });
      return;
    }
    const list = result.records;
    const r = list.find(x => x.id === id);
    if (!r) {
      if (!options.pinned) { dropRecent(cat, id); return; }
      missingPinnedRecord(options.label, { type: 'reference', category: cat, id });
      return;
    }
    openDetailFor(r, catEntry);
  });
}

function missingPinnedRecord(label, target) {
  const pin = state.ui.pins.find(item => hasPin([item], target));
  const { node, close } = sheet('Pinned record missing', `<p class="muted">${esc(label || 'This record')} is no longer available under its saved record ID. It has not been matched by name.</p>${pin ? '<button class="ghost danger" data-remove-missing-pin>Remove pin</button>' : ''}`);
  on(node, 'click', '[data-remove-missing-pin]', () => {
    state.ui.pins = removePin(state.ui.pins, pin.id);
    save();
    close();
  });
}

function maybeOpenPending() {
  if (!pending || !categories.length) return;
  const { cat, id, pinned, label } = pending;
  pending = null;
  openByRef(cat, id, { pinned, label });
}

/**
 * Queue a Library record to open, for Home's "recently opened" strip — Home cannot build
 * a Library detail sheet itself, since the sheet needs the manifest entry and the loaded
 * category records. If Library has already been mounted this session (categories loaded),
 * this opens the sheet immediately; otherwise mount() opens it once the manifest resolves.
 * Never import home.js from here — this dependency runs one way only.
 */
export function openRecord(cat, id) {
  pending = { cat, id };
  maybeOpenPending();
}

/** Open a Home session pin by its immutable reference target. */
export function openPinnedRecord(cat, id, label) {
  pending = { cat, id, pinned: true, label };
  maybeOpenPending();
}
