#!/usr/bin/env node
// Build data/codex.json: the full rules text for exactly what the campaign's PCs use.
//
//   node tools/fetch-codex.mjs
//   node tools/fetch-codex.mjs --group one-shots
//
// The main reference files in data/ deliberately drop the prose — keeping it for all
// 22,000 entries would be ~132 MB. This pulls it back for the few hundred things the
// party actually has in their hands, which is under a megabyte.
//
// It collects three kinds of thing:
//   * everything named on a character sheet — feats, class features, carried items,
//     worn armour and weapons with their runes, prepared and focus spells, formulas
//   * the full selectable spell list for each prepared or spontaneous caster, derived
//     from their own tradition and highest slot rank rather than hardcoded
//   * nothing else — an entry that cannot be matched by name is reported, not invented
//
// Prose comes from the index's `markdown` field and is parsed by tools/aon-text.mjs, so
// paragraphs and sub-headings survive and the "Source … pg. 68" citation does not.
//
// A Pathbuilder sheet rarely writes a name the way the Archives file it, so matching runs
// in four passes, each narrower than a search engine would be and each recorded, so it is
// always clear which entry a sheet name resolved to:
//
//   1. the exact name
//   2. a name close enough to be the same thing — "Sentry Dedication" is Pathbuilder's
//      way of writing "Lastwall Sentry Dedication"
//   3. the Remaster replacement for a name that now only exists as legacy content, so an
//      Everburning Torch resolves to the Everlight Crystal that reprinted it
//   4. a section of a larger page, for sub-features that have no page of their own: a
//      guardian's "Ever Ready" is a section inside Guardian's Techniques

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromMarkdown, sections, nameMatch } from './aon-text.mjs';

const ES = 'https://elasticsearch.aonprd.com/aon/_search';
const AON = 'https://2e.aonprd.com';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BATCH = 150;

const LICENCE =
  'Pathfinder 2e rules text is Paizo Inc. content, published as Open Game Content under ' +
  'the OGL/ORC licences and mirrored by Archives of Nethys (2e.aonprd.com), the official ' +
  'free rules reference. Every entry keeps its source and a url back to the Archives. ' +
  'This file caches only what this campaign\'s characters use.';

async function search(body) {
  const res = await fetch(ES, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(res.status + ' ' + res.statusText + ' from Elasticsearch');
  const json = await res.json();
  if (json.error) throw new Error(json.error.type + ': ' + json.error.reason);
  return json;
}

const tidy = v => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() || null : null);
const list = v => (Array.isArray(v) ? v : v == null ? [] : [v]);
const pause = ms => new Promise(r => setTimeout(r, ms));
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const CURRENT = [{ exists: { field: 'remaster_id' } }, { term: { exclude_from_search: true } }];

const FIELDS = ['name', 'category', 'level', 'trait', 'rarity', 'text', 'markdown', 'url',
  'source', 'actions', 'component', 'range_raw', 'target', 'saving_throw', 'duration', 'area',
  'heighten_level', 'spell_type', 'tradition', 'prerequisite', 'trigger', 'frequency',
  'requirement', 'cost', 'price_raw', 'bulk_raw', 'item_category', 'usage', 'remaster_id'];

/**
 * Stat-block labels that already have a field of their own below, plus the two that are
 * navigation rather than rules. Everything else AoN prints above the rule is kept: a
 * weapon's damage die and hands, an armour's category and check penalty, a shield's
 * Hardness and HP — none of which the index exposes as a field.
 */
const FIELD_LABELS = ['Source', 'Level', 'Traditions', 'Tradition', 'Deities', 'Deity',
  'Domains', 'Bloodlines', 'Range', 'Area', 'Target', 'Targets', 'Defense', 'Saving Throw',
  'Duration', 'Cast', 'Components', 'Cost', 'Trigger', 'Requirements', 'Requirement',
  'Prerequisites', 'Prerequisite', 'Frequency', 'Access', 'Usage', 'Price', 'Bulk',
  'Heightened', 'PFS Note', 'Parent page'];

/** Prose from the flattened `text` field, for the rare document with no markdown. */
function fallbackText(src) {
  let t = tidy(src.text);
  if (!t) return null;
  t = t.replace(/<[^>]*>/g, ' ');
  t = t.replace(/\s*Source\s+.+?pg\.\s*\d+(\s*,\s*.+?pg\.\s*\d+)*/gi, ' ');
  t = t.replace(/\s*-{3,}\s*/g, ' ').replace(/\s+/g, ' ').trim();
  const name = tidy(src.name);
  if (name && t.toLowerCase().startsWith(name.toLowerCase())) t = t.slice(name.length).trim();
  return t || null;
}

function entry(src, id) {
  const { text, stats } = fromMarkdown(src.markdown, { drop: FIELD_LABELS });
  const out = {
    id,
    name: src.name,
    category: src.category,
    level: src.level,
    traits: list(src.trait),
    rarity: src.rarity,
    text: text || fallbackText(src),
    // Kept in the file for the ORC/OGL attribution the licence header depends on; the
    // app deliberately does not print it.
    source: list(src.source).join(', ') || null,
    url: src.url ? AON + src.url : null
  };
  const extra = {
    actions: tidy(src.actions), components: list(src.component),
    range: tidy(src.range_raw), target: tidy(src.target), save: tidy(src.saving_throw),
    duration: tidy(src.duration), area: tidy(src.area), traditions: list(src.tradition),
    heightened: list(src.heighten_level), spellType: src.spell_type,
    prerequisite: tidy(src.prerequisite), trigger: tidy(src.trigger),
    frequency: tidy(src.frequency), requirement: tidy(src.requirement),
    cost: tidy(src.cost), price: tidy(src.price_raw), bulk: tidy(src.bulk_raw),
    itemCategory: src.item_category, usage: tidy(src.usage),
    stats: stats.length ? stats : null
  };
  for (const [k, v] of Object.entries(extra)) {
    if (v === null || v === undefined || v === '') continue;
    if (Array.isArray(v) && !v.length) continue;
    out[k] = v;
  }
  return out;
}

// --- pass 1: the exact name --------------------------------------------------

/** Fetch every entry whose name exactly matches one in `names`. */
async function byName(names) {
  const found = new Map();
  const all = [...names];
  for (let i = 0; i < all.length; i += BATCH) {
    const batch = all.slice(i, i + BATCH);
    const page = await search({
      query: { bool: { filter: [{ terms: { 'name.keyword': batch } }], must_not: CURRENT } },
      _source: FIELDS,
      size: 500
    });
    for (const h of page.hits.hits) {
      // A name can appear in several categories; keep the first, which sorts sensibly
      // enough for the sheet (a feat named like an item is rare).
      if (!found.has(h._source.name)) found.set(h._source.name, entry(h._source, h._id));
    }
    process.stdout.write('\r  named entries: ' + found.size + '/' + all.length);
    await pause(120);
  }
  process.stdout.write('\n');
  return found;
}

// --- pass 2: a name close enough to be the same thing ------------------------

/**
 * Spellings worth searching for a sheet name, each with the names a hit is allowed to be
 * verified against.
 *
 * `name.keyword` is a case-sensitive exact match, so "Pick up the Pace" misses "Pick Up
 * the Pace"; the Remaster reorders grades, listing "Moderate Defoliation Bomb" where a
 * sheet says "Defoliation Bomb (Moderate)"; and class features often drop their
 * parenthetical, so "Field Discovery (Bomber)" is "Field Discovery". Those three are
 * rewrites of the same name, so a hit may be verified against either spelling.
 *
 * Dropping the last word is different: it is a hint about where to look, not a name this
 * thing might have, so its hits are only ever verified against what the sheet wrote.
 * That is what keeps "Spore Order" to the druidic order named Spore.
 *
 * Dropping the parenthetical is `hold`, because the parenthetical usually says which page
 * to read: a kitsune's "Change Shape (Kitsune)" is the kitsune ancestry's version, not
 * the monster ability of that name, so the section pass gets first refusal on it.
 */
function candidates(name) {
  const out = new Map([[name, { verify: [name], hold: false }]]);
  const add = (query, verify, { hold = false, qualifier = null } = {}) => {
    const at = out.get(query);
    out.set(query, {
      verify: [...new Set([...(at?.verify || []), ...verify])],
      // Dropping the parenthetical and dropping the last word are the same query for a
      // name like "Formulas (Bomber)", and either reason to hold it back stands.
      hold: (at?.hold ?? false) || hold,
      qualifier: at?.qualifier || qualifier
    });
  };

  const paren = name.match(/^(.+?)\s*\((.+)\)$/);
  if (paren) {
    add(`${paren[2]} ${paren[1]}`, [`${paren[2]} ${paren[1]}`, name]);
    add(paren[1], [paren[1], name], { hold: true, qualifier: paren[2] });
  }
  const words = name.trim().split(/\s+/);
  if (words.length > 1) add(words.slice(0, -1).join(' '), [name], { hold: true });

  return [...out].map(([query, rest]) => ({ query, ...rest }));
}

// Weakest relation last: an exact hit beats one that only differs in spelling.
const RELATIONS = ['exact', 'longer', 'spelling', 'category'];

/**
 * Second pass. Each spelling is searched as a phrase and again with the index's own
 * fuzziness, then every hit is put to nameMatch() — a loose search that only ever returns
 * a verified name cannot pull in an unrelated entry.
 *
 * A hit with no rules text is passed over: it would leave the sheet showing a heading
 * and nothing else, which is worse than being honest about the miss, because the entry
 * would no longer be listed as unmatched.
 */
async function byCloseName(names) {
  const found = new Map();
  const how = new Map();
  const hold = new Set();
  for (const name of names) {
    let best = null;
    for (const { query, verify, hold: weak, qualifier } of candidates(name)) {
      const queries = [
        { match_phrase: { name: query } },
        { match: { name: { query, fuzziness: 'AUTO', operator: 'and' } } }
      ];
      for (const q of queries) {
        const page = await search({
          query: { bool: { must: [q], must_not: CURRENT } }, _source: FIELDS, size: 10
        });
        await pause(90);
        for (const h of page.hits.hits) {
          const relation = verify
            .map(v => nameMatch(v, h._source.name, h._source.category))
            .filter(Boolean)
            .sort((a, b) => RELATIONS.indexOf(a) - RELATIONS.indexOf(b))[0];
          if (!relation) continue;
          const rank = RELATIONS.indexOf(relation);
          if (best && rank >= best.rank) continue;
          const e = entry(h._source, h._id);
          if (!e.text) continue;
          // "Change Shape (Kitsune)" is the Change Shape that carries the Kitsune trait,
          // and a hit that carries it is not a guess any more.
          const traited = qualifier
            && (e.traits || []).some(t => t.toLowerCase() === qualifier.toLowerCase());
          best = { rank, relation, entry: e, held: weak && !traited };
        }
      }
      if (best?.relation === 'exact' && !best.held) break;
    }
    if (best) {
      found.set(name, best.entry);
      how.set(name, best.relation);
      if (best.held) hold.add(name);
    }
    process.stdout.write('\r  close names: ' + found.size + ' of ' + names.length + ' matched');
  }
  process.stdout.write('\n');
  return { found, how, hold };
}

// --- pass 3: the Remaster replacement ----------------------------------------

/**
 * Third pass, for a name that now only exists as legacy content. The index marks such a
 * document with the `remaster_id` of what reprinted it, and this follows that pointer —
 * so a sheet still carrying an Everburning Torch gets the Everlight Crystal's rules.
 *
 * The replacement has to be the same kind of thing: an item's pointer leads to the item
 * that replaced it, but a retired class feature's leads to the whole class page, which
 * would put a class description under a feature's name.
 */
async function byRemaster(names) {
  const found = new Map();
  const all = [...names];
  for (let i = 0; i < all.length; i += BATCH) {
    const batch = all.slice(i, i + BATCH);
    const page = await search({
      query: { bool: { filter: [{ terms: { 'name.keyword': batch } },
                                { exists: { field: 'remaster_id' } }] } },
      _source: ['name', 'category', 'remaster_id'],
      size: 500
    });
    // `remaster_id` is a list: content that was split across several entries points at
    // all of them, and any one of the same category will do.
    const legacy = new Map();
    for (const h of page.hits.hits) {
      for (const id of list(h._source.remaster_id)) {
        if (!legacy.has(id)) legacy.set(id, h._source);
      }
    }
    if (legacy.size) {
      const now = await search({
        query: { ids: { values: [...legacy.keys()] } }, _source: FIELDS, size: 500
      });
      for (const h of now.hits.hits) {
        const was = legacy.get(h._id);
        if (!was || was.category !== h._source.category) continue;
        const e = entry(h._source, h._id);
        if (e.text && !found.has(was.name)) found.set(was.name, e);
      }
    }
    await pause(120);
  }
  return found;
}

// --- pass 4: a section of a larger page --------------------------------------

// Pages that describe several sub-features at once. Restricting the search to these
// keeps a phrase like "Formula Book" from ranking a dozen feats that merely mention it
// above the class feature that actually defines it.
const HOSTS = ['class-feature', 'class', 'archetype', 'research-field', 'druidic-order',
  'feat', 'heritage', 'ancestry', 'background', 'category-page', 'rules', 'deity',
  'instinct', 'muse', 'doctrine', 'methodology', 'hybrid-study', 'cause', 'conscious-mind',
  'subconscious-mind', 'tenet', 'lesson', 'bloodline', 'implement', 'element', 'ikon'];

/**
 * Fourth pass. A Pathbuilder sheet lists sub-features as if they were entries of their
 * own — "Ever Ready", "Dual Gate", "Versatile Vials" — but the Archives describe them
 * inside a larger page. This finds that page and lifts out the one section, which is why
 * such an entry keeps a `parent` and shares the parent's url.
 *
 * A parenthetical says which page to prefer: "Field Vials (Bomber)" is the Bomber
 * research field's section, and every other research field has a section by that name.
 */
async function bySection(names) {
  const found = new Map();
  for (const name of names) {
    const parenthetical = name.match(/^(.+?)\s*\((.+)\)$/);
    const attempts = parenthetical
      ? [{ text: parenthetical[1], page: parenthetical[2] }, { text: parenthetical[1] }]
      : [{ text: name }];

    let hit = null;
    for (const attempt of attempts) {
      const filter = [{ match_phrase: { text: attempt.text } }, { terms: { category: HOSTS } }];
      if (attempt.page) filter.push({ match_phrase: { name: attempt.page } });
      const page = await search({
        query: { bool: { filter, must_not: CURRENT } },
        _source: ['name', 'category', 'markdown', 'url', 'source'],
        size: 30
      });
      await pause(90);
      // Headings first: a bold lead-in is a looser reading of the page, and only worth
      // taking when nothing is filed under a heading of that name.
      for (const bold of [false, true]) {
        for (const h of page.hits.hits) {
          const { text } = fromMarkdown(h._source.markdown, { cutAt: 1 });
          const section = sections(text, { bold })
            .find(s => nameMatch(attempt.text, s.name) === 'exact');
          if (section) { hit = { host: h, section }; break; }
        }
        if (hit) break;
      }
      if (hit) break;
    }

    if (hit) {
      const host = hit.host._source;
      found.set(name, {
        id: hit.host._id + '#' + slug(hit.section.name),
        // Named as the sheet names it: two research fields both describe a "Field Vials",
        // and the sheet is the only place that says which one this character has.
        name,
        category: host.category,
        parent: host.name,
        traits: [],
        text: hit.section.text,
        source: list(host.source).join(', ') || null,
        url: host.url ? AON + host.url : null
      });
    }
    process.stdout.write('\r  page sections: ' + found.size + ' of ' + names.length + ' matched');
  }
  process.stdout.write('\n');
  return found;
}

/** Every spell of a tradition up to a rank — a prepared caster's selectable list. */
async function spellPool(tradition, maxRank) {
  const query = {
    bool: {
      filter: [{ term: { category: 'spell' } },
               { term: { tradition: tradition } },
               { range: { level: { lte: maxRank } } }],
      must_not: CURRENT
    }
  };
  const head = await search({ query, size: 0 });
  const total = head.hits.total.value;
  const out = [];
  for (let from = 0; from < total; from += 250) {
    const page = await search({
      query, _source: FIELDS, sort: [{ 'name.keyword': 'asc' }],
      from, size: Math.min(250, total - from)
    });
    out.push(...page.hits.hits.map(h => entry(h._source, h._id)));
    process.stdout.write('\r  ' + tradition + ' <= rank ' + maxRank + ': ' +
      out.length + '/' + total);
    await pause(120);
  }
  process.stdout.write('\n');
  return out;
}

// --- collect what the party uses --------------------------------------------

const args = process.argv.slice(2);
const groupFlag = args.indexOf('--group');
const group = groupFlag === -1 ? null : args[groupFlag + 1];

const file = JSON.parse(await readFile(join(ROOT, 'data', 'characters.json'), 'utf8'));
const chars = file.characters.filter(c => !group || c.group === group);
if (!chars.length) {
  console.error('No characters' + (group ? ' in group "' + group + '"' : '') + '.');
  process.exit(1);
}

function runeNames(piece, kind) {
  const out = [];
  if (piece.potency > 0) {
    out.push(`${kind === 'armor' ? 'Armor' : 'Weapon'} Potency (+${piece.potency})`);
  }
  if (piece.striking) out.push(piece.striking === 'striking' ? 'Striking' : piece.striking);
  if (piece.resilient) out.push(piece.resilient === 'resilient' ? 'Resilient' : piece.resilient);
  out.push(...(piece.runes || []));
  return out;
}

const wanted = new Set();
const byCharacter = {};

for (const c of chars) {
  const bucket = { feats: [], features: [], items: [], spells: [], formulas: [] };
  const take = (kind, name) => { if (name) { bucket[kind].push(name); wanted.add(name); } };

  for (const f of c.feats || []) take('feats', f.name);
  for (const s of c.specials || []) take('features', s);
  for (const e of c.equipment || []) take('items', e.name);
  for (const w of c.weapons || []) {
    take('items', w.base);
    for (const r of runeNames(w, 'weapon')) take('items', r);
  }
  for (const a of c.armor || []) {
    take('items', a.base);
    for (const r of runeNames(a, 'armor')) take('items', r);
  }
  for (const sc of c.spellcasting || []) {
    for (const s of sc.spells || []) for (const n of s.list) take('spells', n);
  }
  for (const n of c.focusSpells || []) take('spells', n);
  for (const fb of c.formulas || []) for (const n of fb.known) take('formulas', n);

  for (const k of Object.keys(bucket)) bucket[k] = [...new Set(bucket[k])].sort();
  byCharacter[c.id] = bucket;
}

console.log('Named on the sheets: ' + wanted.size + ' distinct entries');
const named = await byName(wanted);
// How each sheet name was resolved, for the run's own report and for `matchedBy` in the
// file: nothing here should look like it came from an exact hit when it did not.
const how = new Map([...named.keys()].map(n => [n, 'name']));

// A name that only differs in case, plural or word order is the same name and is taken
// straight away. Anything looser is held back until the later passes have had their turn:
// an alchemist's "Formula Book" is the class feature described under Alchemist, not the
// blank formula book that happens to contain those words.
const provisional = new Map();

const leftAfterName = [...wanted].filter(n => !named.has(n));
if (leftAfterName.length) {
  console.log('\nPass 2: ' + leftAfterName.length + ' names to match loosely');
  const close = await byCloseName(leftAfterName);
  for (const [name, e] of close.found) {
    const relation = close.how.get(name);
    if (relation === 'exact' && !close.hold.has(name)) {
      named.set(name, e);
      how.set(name, relation);
    } else {
      provisional.set(name, { entry: e, relation });
    }
  }
}

const leftAfterClose = [...wanted].filter(n => !named.has(n));
if (leftAfterClose.length) {
  console.log('Pass 3: looking for Remaster replacements for ' + leftAfterClose.length);
  const replaced = await byRemaster(leftAfterClose);
  for (const [name, e] of replaced) {
    named.set(name, e);
    how.set(name, 'remaster');
    console.log('  ' + name + ' -> ' + e.name);
  }
}

const leftAfterRemaster = [...wanted].filter(n => !named.has(n));
if (leftAfterRemaster.length) {
  console.log('Pass 4: looking inside larger pages for ' + leftAfterRemaster.length);
  const inside = await bySection(leftAfterRemaster);
  for (const [name, e] of inside) {
    named.set(name, e);
    how.set(name, 'section');
    console.log('  ' + name + ' -> a section of ' + e.parent);
  }
}

const stillHeld = [...provisional.keys()].filter(n => !named.has(n));
if (stillHeld.length) console.log('Taking ' + stillHeld.length + ' loose name matches:');
for (const [name, held] of provisional) {
  if (named.has(name)) continue;
  named.set(name, held.entry);
  how.set(name, held.relation);
  console.log('  ' + name + ' -> ' + held.entry.name + ' (' + held.relation + ')');
}

// --- selectable spell pools --------------------------------------------------

const pools = [];
const seen = new Map();
for (const [name, e] of named) seen.set(e.name, e);

for (const c of chars) {
  for (const sc of c.spellcasting || []) {
    // Innate casters have no list to choose from, and a caster with no ranked slots is
    // not preparing anything either.
    if (sc.innate) continue;
    const maxRank = Math.max(0, ...(sc.slots || []).map(s => s.rank));
    if (!maxRank) continue;
    // The importer stores this as a lowercase singular, e.g. "primal"; AoN indexes the
    // tradition capitalised.
    const trad = sc.tradition;
    if (!trad) continue;
    const label = trad[0].toUpperCase() + trad.slice(1);
    console.log('\n' + c.name + ': selectable ' + label + ' spells up to rank ' + maxRank);
    const entries = await spellPool(label, maxRank);
    for (const e of entries) if (!seen.has(e.name)) seen.set(e.name, e);
    pools.push({
      id: c.id + '-' + label.toLowerCase(),
      owner: c.id,
      ownerName: c.name,
      label: label + ' spells, rank 0–' + maxRank,
      maxRank,
      tradition: label,
      names: entries.map(e => e.name).sort()
    });
  }
}

// --- write -------------------------------------------------------------------

// A sheet name that resolved to an entry filed under a different name — every one of
// them from pass 2 or 3 — needs an alias, or the sheet has no way to reach it.
const aliases = {};
for (const [name, e] of named) if (e.name !== name) aliases[name] = e.name;

const matchedBy = {};
for (const [name, relation] of how) if (relation !== 'name') matchedBy[name] = relation;

const unmatched = {};
for (const c of chars) {
  const missing = Object.values(byCharacter[c.id]).flat()
    .filter(n => !named.has(n) && !seen.has(n));
  if (missing.length) unmatched[c.id] = [...new Set(missing)].sort();
}

// Everything still unmatched gets a homebrew stub, so a plot item, a named weapon or a
// table's own invention is an entry like any other and the sheet can open it. A stub
// carries the name and nothing else: no invented rules text, no source, no Archives link.
// `unmatched` still lists them, so the run's report — and the sheet — stay honest about
// which names the Archives had nothing for.
for (const name of [...new Set(Object.values(unmatched).flat())]) {
  seen.set(name, {
    id: 'homebrew-' + slug(name),
    name,
    category: 'homebrew',
    homebrew: true,
    traits: [],
    text: null,
    source: null,
    url: null
  });
}

const payload = {
  _note: 'Full rules text for what this campaign\'s characters use. Generated by ' +
    'tools/fetch-codex.mjs from data/characters.json — re-run after importing a PC.',
  _licence: LICENCE,
  _source: 'Archives of Nethys, Elasticsearch index aon (elasticsearch.aonprd.com)',
  _generated: new Date().toISOString(),
  _count: seen.size,
  byCharacter,
  // Sheet name -> entry name, for the names the Archives file differently.
  aliases,
  // Sheet name -> how it was resolved, for anything that was not an exact name match.
  matchedBy,
  pools,
  unmatched,
  entries: [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
};

const out = join(ROOT, 'data', 'codex.json');
const json = JSON.stringify(payload);
await writeFile(out, json + '\n', 'utf8');

console.log('\nwrote data/codex.json — ' + seen.size + ' entries, ' +
  (json.length / 1024 / 1024).toFixed(2) + ' MB');
const relations = {};
for (const relation of how.values()) relations[relation] = (relations[relation] || 0) + 1;
console.log('matched by: ' + Object.entries(relations)
  .map(([k, v]) => k + ' ' + v).join(', '));
const missCount = Object.values(unmatched).flat().length;
if (missCount) {
  console.log(missCount + ' sheet entries had no match; each is listed under "unmatched" ' +
    'and carries a homebrew stub so the sheet can still show it:');
  for (const [id, names] of Object.entries(unmatched)) {
    console.log('  ' + id + ': ' + names.join(', '));
  }
}
console.log('Remember to bump CACHE_NAME in service-worker.js.');
