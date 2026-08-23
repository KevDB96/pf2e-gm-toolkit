// Faceted filtering: the dropdowns above a list of records.
//
// One implementation for every screen that browses data/*.json. Which dropdowns appear is
// decided by the records themselves — a category gets whichever of the candidate fields it
// actually carries — so adding a category to tools/fetch-aon.mjs still needs no view
// change, and a field the generator starts emitting turns into a filter on its own.
//
// Pure apart from facetSelects(), which builds the markup: no storage, no fetch, and the
// only DOM helper it borrows is esc().

import { caps, esc } from './dom.js';

export const SIZE_ORDER = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'];
export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'unique'];

/** The comparable form of a value. Filtering is case- and spacing-insensitive. */
export const facetKey = v => String(v ?? '').toLowerCase().trim();

/**
 * The trait names AoN files under "Creature Type", out of data/traits.json — Undead,
 * Dragon, Beast and the rest. Read from the data so a new creature type needs no change
 * here, and pass the result to buildFacets() as `creatureTypes`.
 */
export function creatureTypeNames(traitRecords) {
  return new Set((traitRecords || [])
    .filter(t => (t.groups || []).includes('Creature Type'))
    .map(t => facetKey(t.name)));
}

/**
 * Fields worth filtering on, in the order they should appear. A field only becomes a
 * dropdown when the loaded records hold at least two distinct values for it, so this list
 * covers every category at once: `traditions` matters to spells, `hazardType` to hazards,
 * `pantheon` to deities, and each is simply absent everywhere else.
 *
 * Deliberately an allowlist rather than "any field with few values": the records also
 * carry Bulk, AC, Hardness and Dex Cap, and a dropdown of AC values is noise.
 */
const CANDIDATES = [
  { id: 'level', label: 'Level', field: 'level', numeric: true, range: true },
  { id: 'kind', label: 'Kind', field: 'kind' },
  { id: 'category', label: 'Category', field: 'category' },
  { id: 'type', label: 'Type', field: 'type' },
  { id: 'traditions', label: 'Tradition', field: 'traditions' },
  { id: 'size', label: 'Size', field: 'size', order: SIZE_ORDER },
  { id: 'rarity', label: 'Rarity', field: 'rarity', order: RARITY_ORDER },
  { id: 'family', label: 'Family', field: 'family' },
  { id: 'group', label: 'Group', field: 'group' },
  { id: 'damageType', label: 'Damage type', field: 'damageType' },
  { id: 'hazardType', label: 'Hazard type', field: 'hazardType' },
  { id: 'complexity', label: 'Complexity', field: 'complexity' },
  { id: 'actionCount', label: 'Actions', field: 'actionCount', numeric: true },
  { id: 'attribute', label: 'Attribute', field: 'attribute' },
  { id: 'keyAbility', label: 'Key attribute', field: 'keyAbility' },
  { id: 'archetypeCategory', label: 'Archetype', field: 'archetypeCategory' },
  { id: 'skill', label: 'Skill', field: 'skill' },
  { id: 'pantheon', label: 'Pantheon', field: 'pantheon' },
  { id: 'divineFont', label: 'Divine font', field: 'divineFont' },
  { id: 'sanctification', label: 'Sanctification', field: 'sanctification' },
  { id: 'region', label: 'Region', field: 'region' },
  { id: 'groups', label: 'Trait group', field: 'groups' },
  { id: 'vision', label: 'Vision', field: 'vision' }
];

// A dropdown with hundreds of options is a scroll, not a filter — except for the trait
// catch-all, which is the one place a long list is expected.
const MAX_VALUES = 60;
const MAX_FACETS = 6;

const list = v => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);

/** The values one record has on one axis. */
export function facetValues(record, axis) {
  return (axis.derive ? axis.derive(record) : list(record[axis.field])).filter(
    v => v !== undefined && v !== null && v !== ''
  );
}

/**
 * The chosen value of a range axis as `{ min, max }` numbers, or null when it constrains
 * nothing. `null` on either side means "open at that end".
 *
 * A plain value reads as an exact match on both ends, so a caller that still stores one
 * value per axis keeps working.
 */
export function facetBounds(want) {
  if (want === undefined || want === null || want === '') return null;
  if (typeof want !== 'object') {
    const n = Number(want);
    return Number.isFinite(n) ? { min: n, max: n } : null;
  }
  const edge = v => (v === null || v === undefined || v === '' ? null : Number(v));
  const min = edge(want.min);
  const max = edge(want.max);
  if (min === null && max === null) return null;
  return { min, max };
}

const within = (n, { min, max }) =>
  Number.isFinite(n) && (min === null || n >= min) && (max === null || n <= max);

/** Does a record satisfy every chosen value? An axis with no choice never excludes. */
export function facetPasses(record, axes, chosen) {
  for (const axis of axes) {
    const want = chosen[axis.id];
    if (!want) continue;
    if (axis.range) {
      const span = facetBounds(want);
      if (span && !facetValues(record, axis).some(v => within(Number(v), span))) return false;
      continue;
    }
    if (!facetValues(record, axis).some(v => facetKey(v) === want)) return false;
  }
  return true;
}

/**
 * Fold a `change` on one of the controls facetSelects() rendered into `chosen`, in place.
 * Every screen wires this identically, and a range axis takes two controls that have to
 * agree, so the bookkeeping lives here rather than once per view.
 *
 * The far end follows when a bound crosses it — pick a minimum above the maximum and the
 * maximum moves up to meet it — so the filter can never become a span that matches
 * nothing.
 */
export function facetChange(chosen, el, axes) {
  const id = el.dataset.facet;
  const axis = (axes || []).find(a => a.id === id);
  if (!axis?.range) {
    chosen[id] = el.value;
    return chosen;
  }
  const edge = el.dataset.bound === 'max' ? 'max' : 'min';
  const at = facetBounds(chosen[id]) || { min: null, max: null };
  const next = { ...at, [edge]: el.value === '' ? null : Number(el.value) };
  if (next.min !== null && next.max !== null) {
    if (edge === 'min' && next.max < next.min) next.max = next.min;
    if (edge === 'max' && next.min > next.max) next.min = next.max;
  }
  chosen[id] = next.min === null && next.max === null ? '' : next;
  return chosen;
}

/** `key -> { label, count }` for one axis over the records given, in display order. */
export function facetOptions(records, axis) {
  const found = new Map();
  for (const record of records) {
    for (const value of facetValues(record, axis)) {
      const key = facetKey(value);
      const at = found.get(key);
      if (at) at.count += 1;
      else found.set(key, { label: axis.numeric ? String(value) : caps(value), count: 1 });
    }
  }
  const entries = [...found.entries()];
  entries.sort(([a, x], [b, y]) => {
    if (axis.numeric) return Number(a) - Number(b);
    if (axis.order) return axis.order.indexOf(a) - axis.order.indexOf(b);
    return x.label.localeCompare(y.label);
  });
  return new Map(entries);
}

/**
 * The axes worth showing for a set of records.
 *
 * `creatureTypes` are the trait names AoN files under "Creature Type" (from
 * data/traits.json). When the records carry any of them, Type filters on those and the
 * catch-all Trait axis drops them, so the two dropdowns never offer the same value twice.
 */
export function buildFacets(records, { creatureTypes = new Set(), limit = MAX_FACETS } = {}) {
  const rows = records || [];
  if (!rows.length) return [];

  const usable = axis => {
    const seen = new Set();
    for (const record of rows) {
      for (const value of facetValues(record, axis)) seen.add(facetKey(value));
      if (seen.size > MAX_VALUES) return false;
    }
    return seen.size >= 2;
  };

  const axes = [];
  const creatureType = {
    id: 'creatureType',
    label: 'Type',
    derive: r => (r.traits || []).filter(t => creatureTypes.has(facetKey(t)))
  };
  // Only when creature types describe most of these records. A handful of items carry the
  // Dragon trait and a few feats mention Undead, and a "Type" dropdown of creature types
  // over the equipment list is noise — worse, it would take the slot that spells want for
  // their own Cantrip/Focus/Spell type.
  const typed = rows.filter(r => facetValues(r, creatureType).length).length;
  if (creatureTypes.size && typed / rows.length >= 0.5 && usable(creatureType)) {
    axes.push(creatureType);
  }

  for (const candidate of CANDIDATES) {
    if (axes.length >= limit) break;
    // "Type" is already taken when creature types filled it.
    if (candidate.id === 'type' && axes.some(a => a.id === 'creatureType')) continue;
    if (usable(candidate)) axes.push(candidate);
  }

  // Everything the other axes do not cover. Traits are the only axis allowed to be long:
  // this is where Incorporeal, Mindless, Swarm and the old alignment codes live.
  const covered = new Set();
  for (const axis of axes) {
    for (const key of facetOptions(rows, axis).keys()) covered.add(key);
  }
  const trait = {
    id: 'trait',
    label: 'Trait',
    derive: r => (r.traits || []).filter(t => !covered.has(facetKey(t)))
  };
  if (rows.some(r => (r.traits || []).length) && facetOptions(rows, trait).size >= 2) {
    axes.push(trait);
  }
  return axes;
}

/**
 * The dropdowns themselves. `optionsFor(axis)` supplies each axis's counted options —
 * callers pass the records filtered by every *other* axis, so a dropdown always lists what
 * is still reachable rather than only the value already picked.
 */
export function facetSelects(axes, chosen, optionsFor) {
  return axes.map(axis => {
    const options = optionsFor(axis);
    if (!options.size) return '';
    if (axis.range) return rangeSelects(axis, chosen[axis.id], options);
    const picked = chosen[axis.id] || '';
    return `
      <label class="field" style="flex:1 1 45%;min-width:9em">${esc(axis.label)}
        <select data-facet="${esc(axis.id)}">
          <option value="">Any</option>
          ${[...options].map(([key, { label, count }]) =>
            `<option value="${esc(key)}"${key === picked ? ' selected' : ''}
              >${esc(label)} (${count})</option>`).join('')}
        </select>
      </label>`;
  }).join('');
}

/**
 * A from/to pair for a range axis: two dropdowns over the values still reachable, either
 * of which can stay on Any. Levels run from -1 into the mid-twenties, and one exact level
 * is almost never what a GM is after - "level 3 to 7" is.
 *
 * Dropdowns rather than number boxes on purpose: no phone keyboard opens, the options are
 * only the levels the list actually holds, and each control keeps its 44px. No counts on
 * the labels - a count belongs to one value, not to one end of a span.
 */
function rangeSelects(axis, want, options) {
  const span = facetBounds(want) || { min: null, max: null };
  const end = (edge, picked) => `
    <select data-facet="${esc(axis.id)}" data-bound="${edge}">
      <option value="">Any</option>
      ${[...options].map(([key, { label }]) =>
        `<option value="${esc(key)}"${Number(key) === picked ? ' selected' : ''}
          >${esc(label)}</option>`).join('')}
    </select>`;
  return `
    <div class="field" style="flex:1 1 100%">${esc(axis.label)}
      <div class="row">
        ${end('min', span.min)}
        <span class="muted" style="flex:0 0 auto">to</span>
        ${end('max', span.max)}
      </div>
    </div>`;
}
