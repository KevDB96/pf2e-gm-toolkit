// Pure builder for data/search.json, the cross-category name index.
//
// Two callers share this so they cannot drift apart: tools/fetch-aon.mjs calls it after
// every full data run, and a one-off script calls it to materialise the file from
// category data already on disk. Both pass in the `_licence`/`_ruleset` text rather than
// this module inventing or importing its own copy, which is what keeps this file free of
// any dependency on fetch-aon.mjs (or vice versa) and safe to import on its own.

/**
 * Build the search-index payload from records already grouped by category.
 *
 * @param {Record<string, object[]>} byCategory - manifest `name` (the TARGETS key, e.g.
 *   "creatures", "spells") -> that category's records, in the shape tools/fetch-aon.mjs
 *   writes them (each usually has `id`, `name`, and `level`).
 * @param {{ licence?: string, ruleset?: string }} [meta] - the `_licence`/`_ruleset` text
 *   to stamp on the payload, taken from wherever the caller already has it.
 * @returns {{ _licence: (string|undefined), _ruleset: (string|undefined), _count: number,
 *   categories: Record<string, Array<[string, string, number] | [string, string]>> }}
 */
export function buildSearchIndex(byCategory, { licence, ruleset } = {}) {
  const categories = {};
  let count = 0;
  for (const [name, records] of Object.entries(byCategory || {})) {
    const entries = [];
    for (const r of records || []) {
      // A record with no id or no name is one no view could open or look up — the same
      // rule fetch-aon.mjs already applies when it drops nameless records.
      if (!r || !r.id || !r.name) continue;
      // Positional, and no null padding: most categories carry a level, a handful
      // (conditions, traits, skills, classes, ...) never do.
      entries.push(typeof r.level === 'number' ? [r.id, r.name, r.level] : [r.id, r.name]);
    }
    categories[name] = entries;
    count += entries.length;
  }
  return { _licence: licence, _ruleset: ruleset, _count: count, categories };
}
