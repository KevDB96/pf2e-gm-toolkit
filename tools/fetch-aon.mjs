#!/usr/bin/env node
// Build data/*.json from the Archives of Nethys Elasticsearch index.
//
//   node tools/fetch-aon.mjs                    # everything
//   node tools/fetch-aon.mjs creatures spells   # named targets only
//   node tools/fetch-aon.mjs --legacy           # keep pre-Remaster duplicates too
//
// Node 18+ only, no dependencies — this is a build-time tool, never shipped to the
// browser. It keeps the mechanical fields the app computes with and drops the prose
// (`text`, `markdown`, `search_markdown`), which is ~95% of the raw payload. Every
// record keeps its `source` and a deep link back to AoN for the full rules text.
//
// data/campaign.json is hand-authored and is NOT touched by this tool.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { creatureOffence } from './aon-text.mjs';

const ES = 'https://elasticsearch.aonprd.com/aon/_search';
const AON = 'https://2e.aonprd.com';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const PAGE = 250;

const LICENCE =
  'Pathfinder 2e game mechanics are Paizo Inc. content, published as Open Game Content ' +
  'under the OGL/ORC licences and mirrored by Archives of Nethys (2e.aonprd.com), the ' +
  'official free rules reference. Paizo trademarks and Product Identity are not open ' +
  'content and are not redistributed here beyond the names needed to reference a rule. ' +
  'Each record keeps its source and a url back to the Archives.';

// --- transport -------------------------------------------------------------

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

/**
 * The index holds both sides of the Remaster: a superseded pre-Remaster doc carries a
 * `remaster_id` pointing at its replacement, and the replacement carries `legacy_id`
 * pointing back. Dropping anything with a `remaster_id` therefore leaves exactly one
 * copy of each rule — the current one — while keeping legacy content that was never
 * reprinted. `exclude_from_search` is AoN's own "do not list this" flag.
 */
function excludedBy(includeLegacy) {
  const out = [{ term: { exclude_from_search: true } }];
  if (!includeLegacy) out.push({ exists: { field: 'remaster_id' } });
  return out;
}

/**
 * Every category is comfortably under Elasticsearch's 10k result window, so plain
 * from/size paging is enough. The count is verified anyway — if a category ever grows
 * past the window this throws instead of silently writing a truncated file.
 */
async function fetchCategory(category, fields) {
  const query = {
    bool: { filter: [{ term: { category } }], must_not: excludedBy(INCLUDE_LEGACY) }
  };
  const head = await search({ query, size: 0 });
  const total = head.hits.total.value;
  if (total > 10000) {
    throw new Error(category + ' has ' + total + ' docs, past the 10k result window — ' +
      'this category now needs bucketed paging.');
  }

  const docs = [];
  for (let from = 0; from < total; from += PAGE) {
    const page = await search({
      query,
      _source: fields,
      sort: [{ 'name.keyword': 'asc' }],
      from,
      size: Math.min(PAGE, total - from)
    });
    // Names are not unique — runes and variant items repeat them, and so do a handful
    // of creatures — so carry the Elasticsearch document id through as the stable key.
    docs.push(...page.hits.hits.map(h => ({ ...h._source, _id: h._id })));
    process.stdout.write('\r  ' + category + ': ' + docs.length + '/' + total);
    await new Promise(r => setTimeout(r, 120)); // be a polite guest
  }
  process.stdout.write('\n');
  if (docs.length !== total) {
    throw new Error(category + ': expected ' + total + ' docs, got ' + docs.length);
  }
  return docs;
}

// --- field helpers ---------------------------------------------------------

// AoN flattens some fields out of HTML and leaves doubled or edge whitespace behind.
const tidy = v => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() || null : null);

// Items with no published description carry a house placeholder; drop it.
const summary = v => {
  const s = tidy(v);
  return s && !/^Nethys Note:/i.test(s) ? s : null;
};

const list = v => (Array.isArray(v) ? v : v == null ? [] : [v]);
const firstOf = v => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const link = v => (v ? AON + v : null);

/** Tidy strings, and strings inside arrays, leaving everything else alone. */
function clean(v) {
  if (typeof v === 'string') return tidy(v);
  if (Array.isArray(v)) return v.map(clean).filter(x => x !== null && x !== '');
  return v;
}

/** Drop empty members so the written JSON stays small. */
function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) continue;
    out[k] = v;
  }
  return out;
}

// AoN field name -> app field name, where a plain snake_case-to-camelCase pass is wrong
// or unhelpfully terse.
const RENAME = {
  actions_number: 'actionCount',
  heighten_level: 'heightened',
  is_general_background: 'generalBackground',
  item_category: 'category',
  trait_group: 'groups',
  archetype_category: 'archetypeCategory',
  hazard_type: 'hazardType'
};

const camel = k => RENAME[k] || k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

/**
 * The shape shared by every record, plus whatever extra fields a category declares.
 * Field names follow the app's own conventions (traits, saves.fort, notes) rather than
 * AoN's, so views read one predictable shape across all sixteen files.
 */
const SHARED = ['name', 'level', 'trait', 'rarity', 'summary', 'source', 'url'];

const mapper = (extras = []) => d => {
  const out = {
    id: d._id,
    name: d.name,
    level: d.level,
    traits: list(d.trait),
    rarity: d.rarity,
    notes: summary(d.summary),
    source: list(d.source).join(', ') || null,
    url: link(d.url)
  };

  const saves = compact({
    fort: d.fortitude_save, ref: d.reflex_save, will: d.will_save
  });
  if (Object.keys(saves).length) out.saves = saves;

  for (const f of extras) {
    if (/^(fortitude|reflex|will)_save$/.test(f)) continue;   // folded into saves
    const v = clean(d[f]);
    if (v === null || v === undefined) continue;
    out[camel(f)] = v;
  }
  return compact(out);
};

// --- bespoke shapes --------------------------------------------------------
// Creatures, items and spells get hand-written mappers because their fields need real
// reshaping (speed_raw -> speed, price in copper, the six ability mods). Everything
// else is regular enough for the generic mapper above.

const CREATURE_FIELDS = [...SHARED, 'size', 'ac', 'hp', 'perception', 'fortitude_save',
  'reflex_save', 'will_save', 'speed_raw', 'skill_mod', 'sense', 'resistance', 'weakness',
  'creature_family', 'strength', 'dexterity', 'constitution', 'intelligence', 'wisdom',
  'charisma',
  // Offence, for the battle simulator. `markdown` is the only place a Strike's name,
  // dice and damage type exist — the index's own attack_bonus and strike_damage_average
  // arrays are sorted ascending rather than kept in stat-block order, so pairing them by
  // index invents attacks. It is parsed below and never written out; see the note on
  // dropping prose at the top of this file.
  'immunity', 'spell_dc', 'spell_attack_bonus', 'markdown'];

const creature = c => {
  // compact() only reaches the top level, and a Strike or an ability carries a lot of
  // "not this one" — most abilities have no damage, no DC and no traits. Sparse records
  // are the house style and the nulls were a fifth of the finished file.
  const { strikes, abilities } = creatureOffence(c.markdown);
  const specials = abilities.map(compact);
  return compact({
    id: c._id,
    name: c.name,
    level: c.level,
    traits: list(c.trait),
    rarity: c.rarity,
    size: firstOf(c.size),
    perception: c.perception,
    ac: c.ac,
    hp: c.hp,
    saves: compact({ fort: c.fortitude_save, ref: c.reflex_save, will: c.will_save }),
    abilities: compact({
      str: c.strength, dex: c.dexterity, con: c.constitution,
      int: c.intelligence, wis: c.wisdom, cha: c.charisma
    }),
    speed: tidy(c.speed_raw),
    skills: c.skill_mod || {},
    senses: tidy(c.sense),
    resistances: c.resistance || {},
    weaknesses: c.weakness || {},
    family: c.creature_family,
    notes: summary(c.summary),
    // Immunities cover conditions as well as damage types — "mental", "paralyzed",
    // "sickened" — which is what lets a simulator refuse to Demoralize a construct.
    // AoN doubles a space in a few of them ("death  effects"), so they are tidied.
    immunities: clean(list(c.immunity)),
    spellDC: firstOf(c.spell_dc),
    spellAttack: firstOf(c.spell_attack_bonus),
    strikes: strikes.map(compact),
    specials,
    source: list(c.source).join(', ') || null,
    url: link(c.url)
  });
};

const ITEM_FIELDS = [...SHARED, 'price', 'price_raw', 'bulk', 'bulk_raw', 'item_category',
  'damage', 'damage_type', 'hands', 'weapon_group', 'ac', 'armor_group', 'dex_cap'];

const item = kind => i => compact({
  id: i._id,
  name: i.name,
  level: i.level,
  kind,                                   // equipment | weapon | armor | shield
  category: i.item_category,
  price: i.price ?? null,                 // copper pieces, matching toCoins()
  priceRaw: tidy(i.price_raw),
  bulk: i.bulk ?? null,
  bulkRaw: tidy(i.bulk_raw),
  traits: list(i.trait),
  rarity: i.rarity,
  damage: tidy(i.damage),
  damageType: list(i.damage_type),
  hands: tidy(i.hands),
  group: i.weapon_group || i.armor_group || null,
  ac: i.ac ?? null,
  dexCap: i.dex_cap ?? null,
  notes: summary(i.summary),
  source: list(i.source).join(', ') || null,
  url: link(i.url)
});

const SPELL_FIELDS = [...SHARED, 'actions', 'actions_number', 'component', 'range_raw',
  'target', 'saving_throw', 'tradition', 'spell_type', 'heighten_level'];

const spell = s => compact({
  id: s._id,
  name: s.name,
  level: s.level,
  type: s.spell_type,
  traits: list(s.trait),
  rarity: s.rarity,
  actions: tidy(s.actions),
  actionCount: s.actions_number ?? null,
  components: list(s.component),
  range: tidy(s.range_raw),
  target: tidy(s.target),
  save: tidy(s.saving_throw),
  traditions: list(s.tradition),
  heightened: list(s.heighten_level),
  notes: summary(s.summary),
  source: list(s.source).join(', ') || null,
  url: link(s.url)
});

const CLASS_FIELDS = [...SHARED, 'hp', 'attribute', 'attack_proficiency',
  'defense_proficiency', 'fortitude_proficiency', 'reflex_proficiency',
  'will_proficiency', 'perception_proficiency', 'skill_proficiency'];

const klass = c => compact({
  id: c._id,
  name: c.name,
  hp: c.hp,
  keyAbility: list(c.attribute),
  rarity: c.rarity,
  proficiencies: compact({
    attack: clean(list(c.attack_proficiency)),
    defense: clean(list(c.defense_proficiency)),
    fort: c.fortitude_proficiency,
    ref: c.reflex_proficiency,
    will: c.will_proficiency,
    perception: c.perception_proficiency,
    skills: clean(list(c.skill_proficiency))
  }),
  notes: summary(c.summary),
  source: list(c.source).join(', ') || null,
  url: link(c.url)
});

// --- targets ---------------------------------------------------------------
// `label` and `blurb` drive the Library screen's category picker; `key` is the array
// name inside the file. Order here is the order shown in the app.

const TARGETS = {
  creatures: {
    file: 'creatures.json', key: 'creatures', label: 'Creatures', glyph: '\u{1F409}',
    blurb: 'Monsters and NPCs with their stats, Strikes and immunities.',
    build: async () => (await fetchCategory('creature', CREATURE_FIELDS)).map(creature)
  },
  equipment: {
    file: 'equipment.json', key: 'items', label: 'Equipment', glyph: '\u{1F5E1}',
    blurb: 'Gear, weapons, armour and shields.',
    build: async () => {
      const out = [];
      for (const kind of ['equipment', 'weapon', 'armor', 'shield']) {
        out.push(...(await fetchCategory(kind, ITEM_FIELDS)).map(item(kind)));
      }
      return out.sort((a, b) => a.name.localeCompare(b.name));
    }
  },
  spells: {
    file: 'spells.json', key: 'spells', label: 'Spells', glyph: '✨',
    blurb: 'Every spell, cantrip and focus spell.',
    build: async () => (await fetchCategory('spell', SPELL_FIELDS)).map(spell)
  },
  feats: {
    file: 'feats.json', key: 'feats', label: 'Feats', glyph: '\u{1F3AF}',
    blurb: 'Class, ancestry, skill and general feats.',
    build: async () => (await fetchCategory('feat', [...SHARED, 'actions',
      'actions_number', 'prerequisite', 'trigger', 'frequency', 'archetype', 'skill',
      'access'])).map(mapper(['actions', 'actions_number', 'prerequisite', 'trigger',
        'frequency', 'archetype', 'skill', 'access']))
  },
  actions: {
    file: 'actions.json', key: 'actions', label: 'Actions', glyph: '⚡',
    blurb: 'Basic and specialty actions with their costs.',
    build: async () => (await fetchCategory('action', [...SHARED, 'actions',
      'actions_number', 'cost', 'trigger', 'requirement', 'frequency']))
      .map(mapper(['actions', 'actions_number', 'cost', 'trigger', 'requirement',
        'frequency']))
  },
  hazards: {
    file: 'hazards.json', key: 'hazards', label: 'Hazards', glyph: '\u{1F573}',
    blurb: 'Traps and environmental dangers.',
    build: async () => (await fetchCategory('hazard', [...SHARED, 'ac', 'hp', 'hardness',
      'complexity', 'hazard_type', 'immunity', 'stealth', 'disable', 'reset',
      'fortitude_save', 'reflex_save', 'will_save']))
      .map(mapper(['ac', 'hp', 'hardness', 'complexity', 'hazard_type', 'immunity',
        'stealth', 'disable', 'reset']))
  },
  conditions: {
    file: 'conditions.json', key: 'conditions', label: 'Conditions', glyph: '\u{1F300}',
    blurb: 'What each condition actually does.',
    build: async () => (await fetchCategory('condition', SHARED)).map(mapper())
  },
  classes: {
    file: 'classes.json', key: 'classes', label: 'Classes', glyph: '\u{1F6E1}',
    blurb: 'HP, key attribute and proficiency progressions.',
    build: async () => (await fetchCategory('class', CLASS_FIELDS)).map(klass)
  },
  ancestries: {
    file: 'ancestries.json', key: 'ancestries', label: 'Ancestries', glyph: '\u{1F9DD}',
    blurb: 'Ancestries with HP, size, speed and vision.',
    build: async () => (await fetchCategory('ancestry', [...SHARED, 'hp', 'size',
      'attribute', 'attribute_flaw', 'language', 'vision']))
      .map(mapper(['hp', 'size', 'attribute', 'attribute_flaw', 'language', 'vision']))
  },
  heritages: {
    file: 'heritages.json', key: 'heritages', label: 'Heritages', glyph: '\u{1F33F}',
    blurb: 'Heritage options for each ancestry.',
    build: async () => (await fetchCategory('heritage', SHARED)).map(mapper())
  },
  backgrounds: {
    file: 'backgrounds.json', key: 'backgrounds', label: 'Backgrounds', glyph: '\u{1F4DC}',
    blurb: 'Backgrounds with their attributes and skills.',
    build: async () => (await fetchCategory('background', [...SHARED, 'attribute',
      'skill', 'region', 'feat', 'is_general_background']))
      .map(mapper(['attribute', 'skill', 'region', 'feat', 'is_general_background']))
  },
  archetypes: {
    file: 'archetypes.json', key: 'archetypes', label: 'Archetypes', glyph: '\u{1F3AD}',
    blurb: 'Multiclass and specialist archetypes.',
    build: async () => (await fetchCategory('archetype', [...SHARED, 'prerequisite',
      'archetype_category', 'access']))
      .map(mapper(['prerequisite', 'archetype_category', 'access']))
  },
  deities: {
    file: 'deities.json', key: 'deities', label: 'Deities', glyph: '\u{1F54A}',
    blurb: 'Edicts, anathema, domains and favoured weapons.',
    build: async () => (await fetchCategory('deity', [...SHARED, 'edict', 'anathema',
      'divine_font', 'domain', 'favored_weapon', 'sanctification', 'area_of_concern',
      'pantheon', 'sacred_animal', 'sacred_color', 'religious_symbol', 'cleric_spell',
      'skill', 'attribute', 'alignment']))
      .map(mapper(['edict', 'anathema', 'divine_font', 'domain', 'favored_weapon',
        'sanctification', 'area_of_concern', 'pantheon', 'sacred_animal', 'sacred_color',
        'religious_symbol', 'cleric_spell', 'skill', 'attribute', 'alignment']))
  },
  rituals: {
    file: 'rituals.json', key: 'rituals', label: 'Rituals', glyph: '\u{1F56F}',
    blurb: 'Rituals with their checks and casting costs.',
    build: async () => (await fetchCategory('ritual', [...SHARED, 'actions', 'cost',
      'primary_check', 'secondary_check', 'secondary_casters', 'range', 'area', 'target',
      'duration', 'heighten_level']))
      .map(mapper(['actions', 'cost', 'primary_check', 'secondary_check',
        'secondary_casters', 'range', 'area', 'target', 'duration', 'heighten_level']))
  },
  skills: {
    file: 'skills.json', key: 'skills', label: 'Skills', glyph: '\u{1F3B2}',
    blurb: 'The skill list and what each one governs.',
    build: async () => (await fetchCategory('skill', [...SHARED, 'attribute']))
      .map(mapper(['attribute']))
  },
  traits: {
    file: 'traits.json', key: 'traits', label: 'Traits', glyph: '\u{1F3F7}',
    blurb: 'What every rules trait means.',
    // `trait_group` is how AoN sorts traits into Creature Type, Rarity, Weapon, School
    // and the rest. The encounter planner builds its filter dropdowns from it, so the
    // groups come from the data rather than a hardcoded list of creature types.
    build: async () => (await fetchCategory('trait', [...SHARED, 'trait_group']))
      .map(mapper(['trait_group']))
  }
};

// --- main ------------------------------------------------------------------

const args = process.argv.slice(2);

// Default: one copy of every rule, the post-Remaster one wherever both exist. Pass
// --legacy to keep the superseded pre-Remaster duplicates as well.
const INCLUDE_LEGACY = args.includes('--legacy');
const RULESET = INCLUDE_LEGACY
  ? 'Both. Pre-Remaster entries that were later reprinted are included alongside their ' +
    'Remaster replacements, so names repeat.'
  : 'Remaster. Where a rule exists in both editions this keeps only the post-Remaster ' +
    'version (Player Core, Monster Core, GM Core); pre-Remaster content that was never ' +
    'reprinted is still included.';

const wanted = args.filter(a => !a.startsWith('--'));
if (!wanted.length) wanted.push(...Object.keys(TARGETS));
const unknown = wanted.filter(w => !TARGETS[w]);
if (unknown.length) {
  console.error('Unknown target(s): ' + unknown.join(', '));
  console.error('Available: ' + Object.keys(TARGETS).join(', '));
  process.exit(1);
}

await mkdir(OUT, { recursive: true });

const written = {};
for (const name of wanted) {
  const target = TARGETS[name];
  console.log('\n' + name);
  const built = await target.build();

  // A very small number of AoN documents have no name at all. They cannot be searched
  // or displayed, so drop them — but say so rather than truncating silently.
  const records = built.filter(r => r.name);
  if (records.length !== built.length) {
    console.log('  dropped ' + (built.length - records.length) +
      ' record(s) with no name: ' +
      built.filter(r => !r.name).map(r => r.id).join(', '));
  }
  const payload = {
    _licence: LICENCE,
    _source: 'Archives of Nethys, Elasticsearch index aon (elasticsearch.aonprd.com)',
    _ruleset: RULESET,
    _generated: new Date().toISOString(),
    _count: records.length,
    [target.key]: records
  };
  const json = JSON.stringify(payload);
  await writeFile(join(OUT, target.file), json + '\n', 'utf8');
  written[name] = { count: records.length, bytes: json.length };
  console.log('  wrote data/' + target.file + ' — ' + records.length + ' records, ' +
    (json.length / 1024 / 1024).toFixed(2) + ' MB');
}

// The manifest is what the Library screen reads to build its category picker, so a new
// category needs no view change. Only rewritten when every target was built, otherwise
// a partial run would drop categories from the app.
if (wanted.length === Object.keys(TARGETS).length) {
  const manifest = {
    _generated: new Date().toISOString(),
    _ruleset: RULESET,
    categories: Object.entries(TARGETS).map(([name, t]) => ({
      name,
      file: t.file,
      key: t.key,
      label: t.label,
      glyph: t.glyph,
      blurb: t.blurb,
      count: written[name].count,
      bytes: written[name].bytes
    }))
  };
  await writeFile(join(OUT, 'index.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  const total = Object.values(written).reduce((n, w) => n + w.bytes, 0);
  console.log('\nwrote data/index.json — ' + manifest.categories.length + ' categories, ' +
    (total / 1024 / 1024).toFixed(2) + ' MB total');
} else {
  console.log('\nPartial run: data/index.json left alone.');
}

console.log('Done. Remember to bump CACHE_NAME in service-worker.js.');
