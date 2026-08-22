// Bestiary: search the bundled creature data and read a compact stat block.

import { state } from '../store.js';
import { esc, on, sheet, qs } from '../dom.js';
import { creatureXP, LEVEL_DC } from '../pf2e.js';
import { creatures } from '../data.js';
import { addEntry } from './encounters.js';

let all = [];
let query = '';
let bandOnly = false;

export function mount(root) {
  root.innerHTML = `
    <div class="card">
      <input type="search" id="search" placeholder="Search name or trait&hellip;" autocomplete="off">
      <label class="row" style="margin-top:10px;font-size:0.82rem;color:var(--muted)">
        <input type="checkbox" id="band" style="width:auto;min-height:auto">
        Only creatures inside this party&rsquo;s XP band
      </label>
    </div>
    <div class="muted" id="count"></div>
    <div class="list" id="results"><div class="empty">Loading bestiary&hellip;</div></div>`;

  qs('#search', root).addEventListener('input', e => { query = e.target.value; update(root); });
  qs('#band', root).addEventListener('change', e => { bandOnly = e.target.checked; update(root); });
  on(root, 'click', '[data-open]', (e, el) => openStatBlock(el.dataset.open));

  creatures().then(list => { all = list; update(root); });
}

export function update(root) {
  const results = qs('#results', root);
  if (!results) return;
  const hits = filtered();
  qs('#count', root).textContent = all.length
    ? `${hits.length} of ${all.length} creatures`
    : '';
  results.innerHTML = hits.length
    ? hits.slice(0, 200).map(row).join('')
    : `<div class="empty">${all.length ? 'Nothing matches that search.' : 'No creature data loaded.<br>See README for importing a full bestiary.'}</div>`;
}

function filtered() {
  const needle = query.trim().toLowerCase();
  return all.filter(c => {
    if (bandOnly && creatureXP(c.level, state.party.level) === null) return false;
    if (!needle) return true;
    return c.name.toLowerCase().includes(needle)
      || (c.traits || []).some(t => t.toLowerCase().includes(needle));
  });
}

function row(c) {
  const xp = creatureXP(c.level, state.party.level);
  return `
    <button class="item" data-open="${esc(c.name)}" style="text-align:left">
      <span class="lvl">${c.level}</span>
      <div class="grow">
        <div class="name">${esc(c.name)}</div>
        <div class="sub">${esc((c.traits || []).join(' · ')) || '&mdash;'}</div>
      </div>
      <span class="muted">${xp === null ? '' : xp + ' XP'}</span>
    </button>`;
}

function stat(label, value) {
  if (value === undefined || value === null || value === '') return '';
  return `<div class="share"><span class="muted">${esc(label)}</span><b>${esc(value)}</b></div>`;
}

function openStatBlock(name) {
  const c = all.find(x => x.name === name);
  if (!c) return;
  const s = c.saves || {};
  const body = `
    <div class="muted">Creature ${c.level}${(c.traits || []).length ? ' · ' + esc(c.traits.join(', ')) : ''}</div>
    <div class="card">
      ${stat('Perception', c.perception !== undefined ? fmtMod(c.perception) : null)}
      ${stat('AC', c.ac)}
      ${stat('HP', c.hp)}
      ${stat('Fort', s.fort !== undefined ? fmtMod(s.fort) : null)}
      ${stat('Ref', s.ref !== undefined ? fmtMod(s.ref) : null)}
      ${stat('Will', s.will !== undefined ? fmtMod(s.will) : null)}
      ${stat('Speed', c.speed)}
      ${stat('Level DC', LEVEL_DC[Math.max(0, c.level)])}
    </div>
    ${(c.attacks || []).length ? `<div class="card"><h2>Attacks</h2>${
      c.attacks.map(a => `<div class="share"><span>${esc(a.name)} ${fmtMod(a.bonus)}</span><b>${esc(a.damage)}</b></div>`).join('')
    }</div>` : ''}
    ${c.notes ? `<div class="card"><h2>Notes</h2><div class="muted">${esc(c.notes)}</div></div>` : ''}
    ${c.source ? `<div class="muted" style="font-size:0.72rem">Source: ${esc(c.source)}</div>` : ''}
    <button class="primary" data-to-encounter>Add to encounter</button>`;

  const { node, close } = sheet(c.name, body);
  on(node, 'click', '[data-to-encounter]', () => {
    addEntry(c.name, c.level, 'creature', c);
    close();
    location.hash = '#/encounters';
  });
}

function fmtMod(n) {
  return (n >= 0 ? '+' : '') + n;
}
