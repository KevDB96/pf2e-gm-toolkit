// Party: the player characters, grouped by campaign or one-shot.
//
// Two sources, deliberately: data/characters.json is the committed roster (imported with
// tools/import-pathbuilder.mjs), and anything pasted into the app at the table lands in
// state.characters in localStorage. Device-only characters are labelled as such so it is
// always obvious which ones survive a browser wipe.

import { state, save } from '../store.js';
import { caps, esc, on, rich, sheet, tip, qs, qsa } from '../dom.js';
import { characters as loadCharacters, codex as loadCodex } from '../data.js';
import { fromPathbuilder } from '../pathbuilder.js';
import { actionIcons, ATTRIBUTES, featsByLevel, skillList } from '../pf2e.js';

const ALL = '__all__';

let groups = [];
let filed = [];          // from data/characters.json
let group = ALL;
let loading = true;

// data/codex.json: full rules text for what these characters use. ~0.9 MB, so it is
// fetched the first time a sheet is opened rather than on mount.
let codex = null;
let codexByName = new Map();

function loadCodexOnce() {
  if (codex) return Promise.resolve(codex);
  return loadCodex().then(c => {
    codex = c || { entries: [], pools: [], byCharacter: {}, unmatched: {}, aliases: {} };
    codexByName = new Map(codex.entries.map(e => [e.name, e]));
    // The Archives file some things under a name no character sheet writes: Pathbuilder's
    // "Sentry Dedication" is "Lastwall Sentry Dedication", and an Everburning Torch is
    // now an Everlight Crystal. The generator records those, so both names resolve.
    for (const [sheetName, entryName] of Object.entries(codex.aliases || {})) {
      const e = codexByName.get(entryName);
      if (e && !codexByName.has(sheetName)) codexByName.set(sheetName, e);
    }
    return codex;
  });
}

const mod = n => (n >= 0 ? '+' : '') + n;

/** The committed roster plus anything added on this device. */
function all() {
  return [...filed, ...state.characters.extra];
}

function inGroup() {
  const list = group === ALL ? all() : all().filter(c => c.group === group);
  return [...list].sort((a, b) => a.name.localeCompare(b.name));
}

function groupLabel(id) {
  return groups.find(g => g.id === id)?.label || id;
}

export function mount(root) {
  root.innerHTML = `
    <div class="picker" id="groups"></div>
    <div class="row spread">
      <span class="muted" id="count"></span>
      <button data-import>+ Import</button>
    </div>
    <div class="list" id="roster"><div class="empty">Loading characters&hellip;</div></div>
    <div class="row wrap" id="actions" hidden>
      <button class="grow" data-to-loot>Use as loot roster</button>
      <button data-to-header>Set header</button>
    </div>`;

  on(root, 'click', '[data-group]', (e, el) => { group = el.dataset.group; draw(root); });
  // The codex is ~0.9 MB, so it is fetched on the first sheet open rather than on mount.
  // openSheet reads codexByName synchronously, so it must wait for that first load.
  on(root, 'click', '[data-open]', (e, el) => {
    const id = el.dataset.open;
    loadCodexOnce().then(() => openSheet(id));
  });
  on(root, 'click', '[data-import]', () => importSheet(root));
  on(root, 'click', '[data-remove]', (e, el) => {
    state.characters.extra = state.characters.extra.filter(c => c.id !== el.dataset.remove);
    save();
  });
  on(root, 'click', '[data-to-loot]', () => {
    state.party.members = inGroup().map(c => ({
      id: c.id, name: c.name, role: [c.class, c.level].filter(Boolean).join(' ')
    }));
    save();
    location.hash = '#/loot';
  });
  on(root, 'click', '[data-to-header]', () => {
    const list = inGroup();
    if (!list.length) return;
    state.party.size = list.length;
    state.party.level = Math.max(...list.map(c => c.level || 1));
    qs('#party-level').value = state.party.level;
    qs('#party-size').value = state.party.size;
    save();
  });

  loadCharacters().then(file => {
    groups = file?.groups || [];
    filed = file?.characters || [];
    loading = false;
    draw(root);
  });
}

export function update(root) {
  if (qs('#roster', root)) draw(root);
}

function draw(root) {
  const picker = qs('#groups', root);
  const known = [...new Set([...groups.map(g => g.id), ...all().map(c => c.group)])];
  picker.innerHTML = [
    `<button class="pick${group === ALL ? ' on' : ''}" data-group="${ALL}">All</button>`,
    ...known.map(id => `<button class="pick${group === id ? ' on' : ''}"
      data-group="${esc(id)}">${esc(groupLabel(id))}</button>`)
  ].join('');

  const list = inGroup();
  qs('#count', root).textContent = loading
    ? ''
    : `${list.length} character${list.length === 1 ? '' : 's'}`;
  qs('#actions', root).hidden = list.length === 0;

  qs('#roster', root).innerHTML = loading
    ? '<div class="empty">Loading characters&hellip;</div>'
    : list.length
      ? list.map(row).join('')
      : `<div class="empty">No characters here yet.<br>
          Import a Pathbuilder export, or run
          <code>node tools/import-pathbuilder.mjs</code>.</div>`;
}

function row(c) {
  const s = c.saves || {};
  const local = state.characters.extra.some(x => x.id === c.id);
  const line = [
    c.ac === null || c.ac === undefined ? null : `AC ${c.ac}`,
    c.hp ? `HP ${c.hp}` : null,
    c.perception === undefined ? null : `Per ${mod(c.perception)}`,
    s.fort === undefined ? null : `F ${mod(s.fort)}`,
    s.ref === undefined ? null : `R ${mod(s.ref)}`,
    s.will === undefined ? null : `W ${mod(s.will)}`
  ].filter(Boolean).join(' · ');

  return `
    <button class="item" data-open="${esc(c.id)}" style="text-align:left">
      <span class="lvl">${c.level ?? '—'}</span>
      <div class="grow">
        <div class="name">${esc(c.name)}${local
          ? ' <span class="tag">this device</span>' : ''}</div>
        <div class="sub">${esc([c.ancestry, c.class].filter(Boolean).join(' · '))}</div>
        <div class="sub" style="margin-top:2px">${esc(line)}</div>
      </div>
    </button>`;
}

function stat(label, value) {
  if (value === null || value === undefined || value === '') return '';
  return `<div class="share"><span class="muted">${esc(label)}</span><b>${esc(value)}</b></div>`;
}

/**
 * One skill. Untrained skills are listed too — a GM calls for Nature from whoever is
 * standing there — but dimmed, so the trained ones are still what the eye lands on.
 */
function skillRow(label, sk) {
  const untrained = sk.rank === 'untrained';
  return `<div class="share${untrained ? ' faint' : ''}">
    <span class="muted">${esc(label)}</span>
    <b>${esc(mod(sk.bonus))} <span class="muted">${esc(sk.rank)}</span></b></div>`;
}

/**
 * The opening of an entry's rules text, for the hover description. Homebrew entries have
 * no text by definition, so they say what they are instead of saying nothing.
 */
function blurb(e) {
  if (!e) return '';
  if (e.homebrew) return 'Homebrew — nothing in the Archives matches this name.';
  // brief() takes it from there: the first paragraph of a feat opens on what it feels like
  // as often as on what it does, and a hover description wants the second half.
  return String(e.text || '').split('\n\n')[0]
    .replace(/^#+ +/, '').replace(/[*_]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * A row that opens the rules text for `name`. Every name on a sheet has an entry — the
 * codex writes a homebrew stub for anything the Archives do not have — so the row always
 * links; a stub simply says so rather than pretending to rules text.
 */
function entryRow(name, value, label = name) {
  const e = codexByName.get(name);
  const right = `<b>${esc(value ?? '')}</b>${e ? '<span class="go">›</span>' : ''}`;
  if (!e) {
    return `<div class="share"><span>${esc(label)}</span>${right}</div>`;
  }
  return `<button class="share" data-codex="${esc(name)}"${tip(blurb(e))}>
    <span>${esc(label)}</span>${right}</button>`;
}

function chipRow(names) {
  return names.map(n => {
    const e = codexByName.get(n);
    return e
      ? `<button class="tag" data-codex="${esc(n)}"${tip(blurb(e))}>${esc(n)} ›</button>`
      : `<span class="tag">${esc(n)}</span>`;
  }).join('');
}

function openSheet(id) {
  const c = all().find(x => x.id === id);
  if (!c) return;
  const s = c.saves || {};
  const r = c.saveRanks || {};
  const local = state.characters.extra.some(x => x.id === c.id);
  const withRank = (v, rank) => `${mod(v)}${rank ? ` (${rank})` : ''}`;

  const identity = [c.ancestry, c.heritage, c.background, c.size, c.gender, c.age && `age ${c.age}`]
    .filter(Boolean).join(' · ');
  const pools = (codex?.pools || []).filter(p => p.owner === c.id);
  const missing = codex?.unmatched?.[c.id] || [];

  const body = `
    <div class="muted">${esc([
      c.class && `${c.class} ${c.level}`,
      c.player && `played by ${c.player}`,
      groupLabel(c.group)
    ].filter(Boolean).join(' · '))}</div>
    ${identity ? `<div class="muted" style="font-size:0.78rem">${esc(identity)}</div>` : ''}

    <div class="card">
      <h2>Defences</h2>
      ${stat('AC', c.ac)}
      ${stat('AC with shield', c.shieldBonus && c.ac ? c.ac + c.shieldBonus : null)}
      ${stat('HP', c.hp)}
      ${stat('Perception', c.perception === undefined ? null
        : withRank(c.perception, c.perceptionRank))}
      ${stat('Fortitude', s.fort === undefined ? null : withRank(s.fort, r.fort))}
      ${stat('Reflex', s.ref === undefined ? null : withRank(s.ref, r.ref))}
      ${stat('Will', s.will === undefined ? null : withRank(s.will, r.will))}
      ${stat('Speed', c.speed ? c.speed + ' feet' : null)}
      ${stat('Class DC', c.classDC)}
    </div>

    <div class="card">
      <h2>Attributes</h2>
      ${ATTRIBUTES.map(([k, label]) => stat(label,
        c.abilities?.[k] === undefined ? null
          : `${c.abilities[k]} (${mod(c.mods?.[k] ?? 0)})`)).join('')}
    </div>

    <div class="card">
      <h2>Skills</h2>
      ${skillList(c).map(sk => skillRow(caps(sk.name), sk)).join('')}
      ${(c.lores || []).map(l => skillRow(`${l.name} Lore`, l)).join('')}
      <div class="sub" style="margin-top:8px">Armour check penalties are not applied.</div>
    </div>

    ${(c.spellcasting || []).length || (c.focusSpells || []).length ? `<div class="card">
      <h2>Spellcasting</h2>
      ${(c.spellcasting || []).map(sc => `
        <div class="share"><span>${esc(sc.name)}</span><b>${
          [sc.dc ? 'DC ' + sc.dc : null,
           sc.attack === null || sc.attack === undefined ? null : 'attack ' + mod(sc.attack)]
            .filter(Boolean).join(' · ')}</b></div>
        <div class="sub">${esc([
          sc.tradition, sc.type, sc.innate ? 'innate' : null, sc.rank
        ].filter(Boolean).join(' · '))}</div>
        ${(sc.slots || []).length ? `<div class="sub">Slots: ${esc(sc.slots
          .map(s => `${s.rank === 0 ? 'cantrips' : 'rank ' + s.rank} x${s.count}`)
          .join(' · '))}</div>` : ''}
        ${(sc.spells || []).map(s => `
          <div class="sub" style="margin-top:6px"><b>${
            s.rank === 0 ? 'Cantrips' : 'Rank ' + s.rank}</b></div>
          <div class="row wrap" style="gap:6px">${chipRow(s.list)}</div>`).join('')}
        <div style="height:8px"></div>`).join('')}
      ${(c.focusSpells || []).length ? `
        <div class="sub"><b>Focus${c.focusPoints ? ` (${c.focusPoints} pt)` : ''}</b></div>
        <div class="row wrap" style="gap:6px">${chipRow(c.focusSpells)}</div>` : ''}
      ${pools.map(p => `<button class="share" data-pool="${esc(p.id)}">
        <span>${esc(p.label)}</span><b>${p.names.length}</b><span class="go">›</span>
        </button>`).join('')}
    </div>` : ''}

    ${(c.weapons || []).length || (c.armor || []).length ? `<div class="card">
      <h2>Gear in hand</h2>
      ${(c.weapons || []).map(w => entryRow(w.base || w.name, [
        w.damage,
        caps(w.striking),
        ...(w.extraDamage || [])
      ].filter(Boolean).join(' · '), w.name)).join('')}
      ${(c.armor || []).filter(x => x.worn)
        .map(x => entryRow(x.base || x.name, caps(x.proficiency), x.name)).join('')}
      <div class="sub" style="margin-top:8px">Attack bonuses are not derived from the
        export — check the player's sheet.</div>
    </div>` : ''}

    ${(c.resistances || []).length || (c.specificProficiencies || []).length
      || (c.familiars || []).length ? `<div class="card">
      <h2>Notable</h2>
      ${(c.resistances || []).map(x => stat('Resistance', x)).join('')}
      ${(c.specificProficiencies || []).map(p => stat(p.name, p.rank)).join('')}
      ${(c.familiars || []).map(f => stat(f.name || 'Familiar',
        (f.abilities || []).join(', ') || f.type)).join('')}
      ${(c.pets || []).map(p => stat('Companion', p)).join('')}
    </div>` : ''}

    ${(c.formulas || []).length ? `<div class="card">
      <h2>Formula book</h2>
      ${c.formulas.map(f => `
        <div class="sub" style="margin-top:6px"><b>${esc(f.type)}</b> · ${f.known.length}</div>
        <div class="row wrap" style="gap:6px">${chipRow(f.known)}</div>`).join('')}
    </div>` : ''}

    ${(c.specials || []).length ? `<div class="card">
      <h2>Class features</h2>
      <div class="row wrap" style="gap:6px">${chipRow(c.specials)}</div>
    </div>` : ''}

    ${(c.feats || []).length ? `<div class="card">
      <h2>Feats</h2>
      ${featsByLevel((c.feats || []).map(f => {
        const e = codexByName.get(f.name);
        return { ...f, actions: e?.actions || null, traits: e?.traits || [] };
      })).map(f => entryRow(f.name, [
        Number.isFinite(f.level) ? `Lv ${f.level}` : null,
        actionIcons(f.actions)
      ].filter(Boolean).join(' · '), f.name + (f.choice ? ` (${f.choice})` : ''))).join('')}
    </div>` : ''}

    ${(c.languages || []).length ? `<div class="card">
      <h2>Languages</h2>
      <div class="row wrap" style="gap:6px">${c.languages
        .map(x => `<span class="tag">${esc(x)}</span>`).join('')}</div>
    </div>` : ''}

    ${(c.equipment || []).length ? `<div class="card">
      <h2>Carried</h2>
      ${c.equipment.map(i => entryRow(i.name, i.qty > 1 ? '×' + i.qty : '')).join('')}
      ${c.money ? `<div class="share" style="margin-top:8px"><span class="muted">Money</span>
        <b>${esc(['pp', 'gp', 'sp', 'cp']
          .filter(k => c.money[k]).map(k => `${c.money[k]} ${k}`).join(' ') || '—')}</b></div>` : ''}
    </div>` : ''}

    ${missing.length ? `<div class="muted" style="font-size:0.72rem">
      ${missing.length} entr${missing.length === 1 ? 'y is' : 'ies are'} listed as homebrew
      — nothing in the Archives matches th${missing.length === 1 ? 'at name' : 'ose names'}:
      ${esc(missing.join(', '))}</div>` : ''}

    ${local ? `<button class="danger" data-remove="${esc(c.id)}">Remove from this device</button>`
      : ''}`;

  const { node, close } = sheet(c.name, body);
  on(node, 'click', '[data-remove]', () => close());
  on(node, 'click', '[data-codex]', (e, el) => openEntry(el.dataset.codex));
  on(node, 'click', '[data-pool]', (e, el) => openPool(el.dataset.pool));
}

/** The rules text for one entry, stacked over whatever sheet opened it. */
function openEntry(name) {
  const e = codexByName.get(name);
  if (!e) return;

  const head = [
    // A sub-feature has no page of its own, so its category is whatever page describes
    // it — "Class" for a guardian's Ever Ready. Naming that page says far more.
    e.homebrew ? 'Homebrew' : e.parent ? `Part of ${e.parent}` : caps(e.category),
    e.level === undefined || e.level === null ? null : 'Level ' + e.level,
    e.rarity && e.rarity !== 'common' ? caps(e.rarity) : null
  ].filter(Boolean).join(' · ');

  const line = (label, value) => value
    ? `<div class="share"><span class="muted">${esc(label)}</span><b>${esc(value)}</b></div>`
    : '';

  const body = `
    <div class="codex-meta">${esc(head)}</div>
    ${(e.traits || []).length
      ? `<div class="row wrap" style="gap:6px;margin-bottom:10px">${e.traits
          .map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>`
      : ''}
    ${[['Actions', actionIcons(e.actions)], ['Cost', e.cost], ['Price', e.price], ['Bulk', e.bulk],
       ['Range', e.range], ['Area', e.area], ['Target', e.target], ['Save', e.save],
       ['Duration', e.duration], ['Components', (e.components || []).join(', ')],
       ['Traditions', (e.traditions || []).join(', ')],
       ['Trigger', e.trigger], ['Requirements', e.requirement],
       ['Frequency', e.frequency], ['Prerequisites', e.prerequisite],
       ['Usage', e.usage],
       ['Heightened', (e.heightened || []).join(', ')],
       // The stat block's own rows: a weapon's damage die and hands, an armour's category
       // and check penalty, a shield's Hardness. The index has no field for any of them.
       ...(e.stats || []).map(s => [s.label, s.value])]
      .map(([l, v]) => line(l, v)).join('')}
    ${e.text ? `<div class="card" style="margin-top:10px">
      <div class="codex-text">${rich(e.text)}</div></div>` : ''}
    ${e.homebrew ? `<div class="card" style="margin-top:10px">
      <div class="codex-text"><p>No rules text on file. Nothing in the Archives of Nethys
      matches this name, so it is homebrew, a plot item, or named differently at your
      table. It is listed here because the character carries it.</p></div></div>` : ''}
    ${e.name === name ? '' : `<div class="muted" style="font-size:0.72rem">The sheet lists
      this as &ldquo;${esc(name)}&rdquo;.</div>`}
    ${e.url ? `<div class="muted" style="font-size:0.72rem">
      <a href="${esc(e.url)}" target="_blank" rel="noopener">Open on Archives of Nethys</a>
    </div>` : ''}`;

  const { node } = sheet(e.name, body);
  on(node, 'click', '[data-codex]', (ev, el) => openEntry(el.dataset.codex));
}

/** A searchable list of a caster's whole selectable spell list. */
function openPool(id) {
  const pool = (codex?.pools || []).find(p => p.id === id);
  if (!pool) return;

  const body = `
    <div class="codex-meta">${esc(pool.ownerName)} · ${pool.names.length} spells</div>
    <input type="search" id="pool-search" placeholder="Search&hellip;" autocomplete="off">
    <div class="muted" id="pool-count" style="margin-top:8px"></div>
    <div class="list" id="pool-list" style="margin-top:8px"></div>`;

  const { node } = sheet(pool.label, body);
  const listEl = qs('#pool-list', node);
  const countEl = qs('#pool-count', node);

  const draw = (q = '') => {
    const needle = q.trim().toLowerCase();
    const hits = pool.names
      .map(n => codexByName.get(n))
      .filter(Boolean)
      .filter(e => !needle || e.name.toLowerCase().includes(needle)
        || (e.traits || []).some(t => t.toLowerCase().includes(needle))
        || (e.text || '').toLowerCase().includes(needle));
    countEl.textContent = `${hits.length} of ${pool.names.length}` +
      (hits.length > 120 ? ' · showing the first 120' : '');
    listEl.innerHTML = hits.length
      ? hits.slice(0, 120).map(e => `
        <button class="item" data-codex="${esc(e.name)}" style="text-align:left"${tip(blurb(e))}>
          <span class="lvl">${e.level ?? '—'}</span>
          <div class="grow">
            <div class="name">${esc(e.name)}</div>
            <div class="sub">${esc((e.traits || []).join(' · ') || '')}</div>
          </div>
        </button>`).join('')
      : '<div class="empty">Nothing matches that.</div>';
  };

  qs('#pool-search', node).addEventListener('input', e => draw(e.target.value));
  on(node, 'click', '[data-codex]', (e, el) => openEntry(el.dataset.codex));
  draw();
}

function importSheet(root) {
  const options = [...new Set([...groups.map(g => g.id), ...all().map(c => c.group)])];
  const body = `
    <div class="muted" style="font-size:0.78rem">Paste a Pathbuilder 2e JSON export.
      It is stored on this device only — to commit a character to the repo, run
      <code>node tools/import-pathbuilder.mjs</code> instead.</div>
    <label class="field" style="margin-top:10px">Group
      <select id="i-group">${options
        .map(id => `<option value="${esc(id)}">${esc(groupLabel(id))}</option>`).join('')}
      </select>
    </label>
    <label class="field">Player (optional)<input type="text" id="i-player"></label>
    <label class="field">Pathbuilder JSON
      <textarea id="i-json" rows="8" placeholder='{"success":true,"build":{...}}'></textarea>
    </label>
    <div class="muted" id="i-error" style="color:var(--blood)"></div>
    <button class="primary" id="i-save">Import</button>`;

  sheet('Import character', body, (node, close) => {
    qs('#i-save', node).addEventListener('click', () => {
      const err = qs('#i-error', node);
      const text = qs('#i-json', node).value.trim();
      if (!text) { err.textContent = 'Paste the export first.'; return; }
      let character;
      try {
        character = fromPathbuilder(JSON.parse(text), {
          group: qs('#i-group', node).value,
          player: qs('#i-player', node).value.trim() || null
        });
      } catch (e) {
        err.textContent = e instanceof SyntaxError
          ? 'That is not valid JSON — copy the whole export.'
          : e.message;
        return;
      }
      state.characters.extra = state.characters.extra.filter(x => x.id !== character.id);
      state.characters.extra.push(character);
      save();
      close();
      draw(root);
    });
  });
}
