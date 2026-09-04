// Pure matching logic over the search index from src/data.js's searchIndex() — no DOM,
// no fetch, no storage, so it can be unit-tested the way src/pf2e.js is.

/**
 * Search every category in the index at once and return the categories that matched,
 * best category first.
 *
 * @param {Record<string, Array<[string,string,number]|[string,string]>>|null} index - the
 *   `categories` object from src/data.js's searchIndex(), or null if it hasn't loaded.
 * @param {string} query - what the GM typed.
 * @param {{ perCategory?: number }} [opts]
 * @returns {Array<{ category: string, hits: Array<{id:string,name:string,level:(number|undefined)}>, total: number }>}
 */
export function searchAll(index, query, { perCategory = 6 } = {}) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!index || q.length < 2) return [];

  const results = [];
  for (const [category, entries] of Object.entries(index)) {
    if (!Array.isArray(entries)) continue;
    const hits = [];
    for (const entry of entries) {
      const [id, name, level] = entry;
      if (!name) continue;
      const rank = matchRank(name.toLowerCase(), q);
      if (rank === -1) continue;
      hits.push({ id, name, level, rank });
    }
    if (!hits.length) continue;

    // Within a rank, shorter names first, then alphabetically — "fire" surfaces "Fire"
    // and "Fireball" ahead of "Wall of Fire" ahead of "Sceptre of the Firebrand".
    hits.sort((a, b) =>
      a.rank - b.rank || a.name.length - b.name.length || a.name.localeCompare(b.name));

    results.push({
      category,
      bestRank: hits[0].rank,
      total: hits.length,
      hits: hits.slice(0, perCategory).map(({ id, name, level }) => ({ id, name, level }))
    });
  }

  // Best-match category first; ties keep the order the categories appear in the index
  // object (the manifest order), which a stable sort preserves on its own.
  results.sort((a, b) => a.bestRank - b.bestRank);
  return results.map(({ category, hits, total }) => ({ category, hits, total }));
}

/**
 * Exact beats prefix beats "starts a word inside the name" beats plain substring. Lower
 * is better; -1 means no match at all. `name` and `q` are both already lower-cased.
 */
function matchRank(name, q) {
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (name.split(/\s+/).some(word => word.startsWith(q))) return 2;
  if (name.includes(q)) return 3;
  return -1;
}
