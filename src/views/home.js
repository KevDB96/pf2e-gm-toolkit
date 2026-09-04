// Home: the launcher. One tile per screen, each showing what is waiting there.

import { state } from '../store.js';
import { esc, on, qs } from '../dom.js';
import { threatFor } from '../pf2e.js';
import { manifest, campaign, characters } from '../data.js';
import { totalXP } from './encounters.js';

const TILES = [
  { view: 'encounters', glyph: '⚔', title: 'Encounters' },
  { view: 'combat', glyph: '\u{1F3B2}', title: 'Combat' },
  { view: 'library', glyph: '\u{1F4D6}', title: 'Library' },
  { view: 'loot', glyph: '\u{1F4B0}', title: 'Loot' },
  { view: 'notes', glyph: '\u{1F4DC}', title: 'Campaign' },
  { view: 'party', glyph: '\u{1F465}', title: 'Party' },
  { view: 'sound', glyph: '\u266B', title: 'Sound' }
];

// Filled in once the manifest and campaign file resolve; null means "still loading".
let libraryCount = null;
let currentArc = null;
let roster = null;

function plural(n, word, many = word + 's') {
  return `${n} ${n === 1 ? word : many}`;
}

function status(view) {
  const { level, size } = state.party;

  if (view === 'sound') {
    return state.sound.url ? 'YouTube link ready' : 'No track selected';
  }

  if (view === 'encounters') {
    const entries = state.encounter.entries;
    if (!entries.length) return 'Nothing planned';
    const heads = entries.reduce((n, e) => n + e.count, 0);
    const xp = totalXP(level);
    return `${heads} on the roster · ${xp} XP · ${threatFor(xp, size)}`;
  }

  if (view === 'combat') {
    const list = state.combat.combatants;
    if (!list.length) return 'No combatants';
    if (!state.combat.round) return `${plural(list.length, 'combatant')} ready`;
    return `Round ${state.combat.round} · ${plural(list.length, 'combatant')}`;
  }

  if (view === 'library') {
    return libraryCount === null
      ? 'Loading…'
      : `${libraryCount.toLocaleString()} entries on file`;
  }

  if (view === 'party') {
    if (roster === null) return 'Loading…';
    const here = roster.filter(c => c.group === 'mists-of-zalazar').length;
    const total = roster.length + state.characters.extra.length;
    if (!total) return 'No characters yet';
    return `${plural(here, 'PC')} in the campaign` +
      (total > here ? ` · ${total - here} elsewhere` : '');
  }

  if (view === 'notes') {
    const n = state.notes.entries.length;
    const kept = n ? ` · ${plural(n, 'note')}` : '';
    return (currentArc || 'Campaign') + kept;
  }

  const pool = state.loot.pool;
  if (!pool.length) return 'Hoard empty';
  const gp = pool.reduce((sum, i) => sum + (Number(i.value) || 0), 0);
  const unclaimed = pool.filter(i => !i.owner).length;
  return `${plural(pool.length, 'item')} · ${Math.round(gp)} gp`
    + (unclaimed ? ` · ${unclaimed} unclaimed` : '');
}

export function mount(root) {
  root.innerHTML = `
    <div class="menu" id="menu">${TILES.map(tile).join('')}</div>
    <div class="empty" id="party-note"></div>`;

  on(root, 'click', '[data-go]', (e, el) => { location.hash = '#/' + el.dataset.go; });

  if (libraryCount === null) {
    manifest().then(cats => {
      libraryCount = cats.reduce((n, c) => n + (c.count || 0), 0);
      if (qs('#menu', root)) update(root);
    });
  }
  if (roster === null) {
    characters().then(file => {
      roster = file?.characters || [];
      if (qs('#menu', root)) update(root);
    });
  }
  if (currentArc === null) {
    campaign().then(c => {
      currentArc = c?.arcs?.find(a => a.id === c.current?.arc)?.title || '';
      if (qs('#menu', root)) update(root);
    });
  }

  update(root);
}

function tile(t) {
  return `
    <button class="menu-tile" data-go="${t.view}">
      <span class="glyph" aria-hidden="true">${t.glyph}</span>
      <span class="grow">
        <span class="name">${esc(t.title)}</span>
        <span class="sub" data-status="${t.view}"></span>
      </span>
      <span class="chev" aria-hidden="true">&rsaquo;</span>
    </button>`;
}

export function update(root) {
  for (const t of TILES) {
    const el = qs(`[data-status="${t.view}"]`, root);
    if (el) el.textContent = status(t.view);
  }
  const { level, size } = state.party;
  const note = qs('#party-note', root);
  if (note) {
    note.textContent =
      `Party level ${level} · ${size} PC${size === 1 ? '' : 's'}. `
      + 'Change either in the header — every budget follows.';
  }
}
