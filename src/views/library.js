// Library: one browser over every reference file, driven by data/index.json.
//
// Adding a category to tools/fetch-aon.mjs puts it here automatically — the picker, the
// search and the detail sheet are all generic. Creatures get two extras (the party XP
// band filter and add-to-encounter) because that is what a GM actually does with them.

import { state } from '../store.js';
import { caps, esc, on, sheet, tip, qs, qsa } from '../dom.js';
import { creatureXP, LEVEL_DC, actionIcons } from '../pf2e.js';
import { manifest, records, traits as loadTraits } from '../data.js';
import { recordTip } from '../records.js';
import { buildFacets, creatureTypeNames, facetChange, facetOptions, facetPasses, facetSelects }
  from '../facets.js';
import { addEntry } from './encounters.js';

const RENDER_CAP = 200;

let categories = [];
let active = null;      // the manifest entry currently shown
let rows = [];          // records for `active`
let query = '';
let bandOnly = false;
let axes = [];          // the filter dropdowns for the loaded category
let chosen = {};        // axis id -> chosen value
let creatureTypes = new Set();
let loading = false;

// Fields that get bespoke treatment, or are plumbing the reader does not want to see.
const SKIP = new Set(['id', 'name', 'url', 'notes', 'traits', 'source', 'level', 'kind',
  'strikes', 'specials']);

const LABEL = {
  ac: 'AC', hp: 'HP', dexCap: 'Dex cap', levelDC: 'Level DC', actionCount: 'Actions', priceRaw: 'Price',
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
    <div class="row spread">
      <span class="muted" id="count"></span>
      <button class="ghost" id="clear" hidden
              style="min-height:32px;font-size:0.74rem">Clear filters</button>
    </div>
    <div class="list" id="results"></div>`;

  qs('#search', root).addEventListener('input', e => { query = e.target.value; draw(root); });
  qs('#band', root).addEventListener('change', e => { bandOnly = e.target.checked; draw(root); });
  on(root, 'change', '[data-facet]', (e, el) => {
    facetChange(chosen, el, axes);
    draw(root);
  });
  qs('#clear', root).addEventListener('click', () => {
    chosen = {};
    query = '';
    qs('#search', root).value = '';
    draw(root);
  });
  on(root, 'click', '[data-cat]', (e, el) => select(root, el.dataset.cat));
  on(root, 'click', '[data-open]', (e, el) => openDetail(el.dataset.open));

  loadTraits().then(list => { creatureTypes = creatureTypeNames(list); draw(root); });

  manifest().then(list => {
    categories = list;
    if (!categories.length) {
      qs('#cats', root).innerHTML =
        '<span class="muted">No data/index.json — run <code>npm run data</code>.</span>';
      return;
    }
    drawChips(root);
    select(root, active?.name || categories[0].name);
  });
}

function drawChips(root) {
  qs('#cats', root).innerHTML = categories.map(c => `
    <button class="pick" data-cat="${esc(c.name)}">
      <span aria-hidden="true">${c.glyph}</span> ${esc(c.label)}
    </button>`).join('');
}

function select(root, name) {
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

  qsa('.pick', root).forEach(el => el.classList.toggle('on', el.dataset.cat === name));

  rows = [];
  loading = true;
  draw(root);
  records(active).then(list => {
    // A slower category can resolve after the reader has already moved on.
    if (active?.name !== name) return;
    rows = list;
    loading = false;
    draw(root);
  });
}

/**
 * The records matching the search, the XP band and every chosen filter. `skip` drops one
 * axis from the test, which is how each dropdown lists what is still reachable through the
 * other filters instead of only the value already picked.
 */
function filtered(skip = null) {
  const needle = query.trim().toLowerCase();
  const active = skip ? axes.filter(a => a !== skip) : axes;
  return rows.filter(r => {
    if (bandOnly && creatureXP(r.level, state.party.level) === null) return false;
    if (!facetPasses(r, active, chosen)) return false;
    if (!needle) return true;
    return (r.name || '').toLowerCase().includes(needle)
      || (r.traits || []).some(t => t.toLowerCase().includes(needle))
      || (r.notes || '').toLowerCase().includes(needle);
  });
}

export function update(root) {
  if (qs('#results', root)) draw(root);
}

function draw(root) {
  const results = qs('#results', root);
  const count = qs('#count', root);
  if (!results) return;

  if (loading) {
    count.textContent = '';
    qs('#facets', root).innerHTML = '';
    results.innerHTML = `<div class="empty">Loading ${esc(active?.label || '')}&hellip;</div>`;
    return;
  }

  // Which filters this category gets is decided by the records it holds — creatures offer
  // type, size, rarity and family; spells offer rank, type and tradition; equipment offers
  // category, group and damage type. See buildFacets() in src/facets.js.
  if (!axes.length) axes = buildFacets(rows, { creatureTypes });
  qs('#facets', root).innerHTML =
    facetSelects(axes, chosen, axis => facetOptions(filtered(axis), axis));
  qs('#clear', root).hidden = !query && !Object.values(chosen).some(Boolean);

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

function row(r) {
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

function openDetail(id) {
  const r = rows.find(x => x.id === id);
  if (!r) return;

  const head = [
    active.label.replace(/s$/, ''),
    r.level === undefined ? null : `level ${r.level}`,
    r.rarity && r.rarity !== 'common' ? r.rarity : null
  ].filter(Boolean).join(' · ');

  // Everything the record carries that is not handled above, in file order.
  const extras = Object.keys(r)
    .filter(k => !SKIP.has(k) && !REDUNDANT.has(k) && k !== 'rarity')
    .map(k => stat(k, r[k]))
    .join('');

  const isCreature = active.name === 'creatures';
  const body = `
    <div class="muted">${esc(head)}</div>
    ${(r.traits || []).length
      ? `<div class="row wrap" style="gap:6px">${r.traits
          .map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>`
      : ''}
    ${extras || isCreature ? `<div class="card">${extras}${
      isCreature ? stat('levelDC', LEVEL_DC[Math.max(0, r.level)]) : ''}</div>` : ''}
    ${(r.strikes || []).length
      ? `<div class="card"><h2>Strikes</h2>${strikeRows(r.strikes)}</div>` : ''}
    ${(r.specials || []).length
      ? `<div class="card"><h2>Abilities</h2>${strikeRows(r.specials)}</div>` : ''}
    ${r.notes ? `<div class="card"><h2>Summary</h2><div class="muted">${esc(r.notes)}</div></div>` : ''}
    ${r.url ? `<div class="muted" style="font-size:0.72rem">
      <a href="${esc(r.url)}" target="_blank" rel="noopener">Open on Archives of Nethys</a>
    </div>` : ''}
    ${isCreature ? '<button class="primary" data-to-encounter>Add to encounter</button>' : ''}`;

  const { node, close } = sheet(r.name, body);
  on(node, 'click', '[data-to-encounter]', () => {
    addEntry(r.name, r.level, 'creature', r);
    close();
    location.hash = '#/encounters';
  });
}
