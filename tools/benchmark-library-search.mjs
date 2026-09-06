// Repeatable CPU-only Library search benchmark. It reads bundled JSON but does not fetch
// or write anything. Node timing is a relative baseline, not a phone paint measurement.
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { buildFacets, creatureTypeNames, facetOptions, facetPasses } from '../src/facets.js';
import { creatureXP } from '../src/pf2e.js';
import { librarySearchBase, librarySelectedRows, prepareLibraryRows } from '../src/library-filter.js';
import { searchAll } from '../src/search.js';

const json = file => readFile(new URL(`../data/${file}`, import.meta.url), 'utf8').then(JSON.parse);
const elapsed = (fn, rounds = 20) => {
  const start = performance.now();
  for (let round = 0; round < rounds; round++) fn();
  return (performance.now() - start) / rounds;
};

function baseline(rows, axes, query, bandOnly) {
  const needle = query.toLowerCase();
  const filtered = skip => rows.filter(record => {
    if (bandOnly && creatureXP(record.level, 5) === null) return false;
    if (!facetPasses(record, skip ? axes.filter(axis => axis !== skip) : axes, {})) return false;
    return (record.name || '').toLowerCase().includes(needle)
      || (record.traits || []).some(trait => trait.toLowerCase().includes(needle))
      || (record.notes || '').toLowerCase().includes(needle);
  });
  for (const axis of axes) facetOptions(filtered(axis), axis);
  return filtered().length;
}

function optimized(rows, axes, query, bandOnly) {
  const base = librarySearchBase(prepareLibraryRows(rows), { query, bandOnly, partyLevel: 5 });
  for (const axis of axes) facetOptions(librarySelectedRows(base, axes, {}, axis), axis);
  return librarySelectedRows(base, axes, {}).length;
}

const [creatureFile, equipmentFile, traitsFile, searchFile] = await Promise.all([
  json('creatures.json'), json('equipment.json'), json('traits.json'), json('search.json')
]);
const creatureTypes = creatureTypeNames(traitsFile.traits);
const datasets = [
  ['Creatures', creatureFile.creatures, 'dragon', true],
  ['Equipment', equipmentFile.items, 'fire', false]
];
console.log(`Node ${process.version}; ${process.platform}; no CPU throttling; CPU-only, not input-to-paint or a phone measurement.`);
for (const [label, rows, query, bandOnly] of datasets) {
  const axes = buildFacets(rows, { creatureTypes });
  const beforeCount = baseline(rows, axes, query, bandOnly);
  const afterCount = optimized(rows, axes, query, bandOnly);
  console.log(`${label} “${query}” (${rows.length} rows, ${axes.length} facets): ${elapsed(() => baseline(rows, axes, query, bandOnly)).toFixed(2)} ms → ${elapsed(() => optimized(rows, axes, query, bandOnly)).toFixed(2)} ms; ${beforeCount} matches ${beforeCount === afterCount ? 'unchanged' : `!= ${afterCount}`}`);
}
console.log(`Global index “fire”: ${elapsed(() => searchAll(searchFile.categories, 'fire')).toFixed(2)} ms (ranking unchanged).`);
