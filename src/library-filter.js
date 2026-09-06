// Search/filter work for the Library. Sidecars deliberately keep generated reference
// records untouched: a category may be shared by other screens in the same session.
import { creatureXP } from './pf2e.js';
import { facetPasses } from './facets.js';

const prepared = new WeakMap();

export function prepareLibraryRows(records) {
  if (prepared.has(records)) return prepared.get(records);
  const rows = (records || []).map(record => ({
    record,
    name: (record.name || '').toLowerCase(),
    traits: (record.traits || []).map(trait => String(trait).toLowerCase()),
    notes: (record.notes || '').toLowerCase()
  }));
  prepared.set(records, rows);
  return rows;
}

/** Query and XP are shared by every self-excluding facet calculation. */
export function librarySearchBase(preparedRows, { query = '', bandOnly = false, partyLevel = 1 } = {}) {
  const needle = String(query).trim().toLowerCase();
  return preparedRows.filter(row => {
    const record = row.record;
    if (bandOnly && creatureXP(record.level, partyLevel) === null) return false;
    return !needle || row.name.includes(needle) || row.notes.includes(needle)
      || row.traits.some(trait => trait.includes(needle));
  });
}

/** Apply selections after the shared text/XP pass; omit one axis for its facet options. */
export function librarySelectedRows(base, axes, chosen, skip = null) {
  const applicable = skip ? axes.filter(axis => axis !== skip) : axes;
  return base.filter(row => facetPasses(row.record, applicable, chosen)).map(row => row.record);
}
