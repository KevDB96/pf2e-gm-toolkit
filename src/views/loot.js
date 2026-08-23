// Loot: the level's treasure budget, what the party has found, and who claimed it.

import { state, save, uid } from '../store.js';
import { esc, on, sheet, tip, qs } from '../dom.js';
import { treasureFor, toCoins, lootSelection, splitEvenly } from '../pf2e.js';
import { equipment, characters as loadCharacters } from '../data.js';
import { recordTip } from '../records.js';

export function mount(root) {
  root.innerHTML = shell();
  wire(root);
  update(root);
}

function shell() {
  return `
    <div class="card">
      <h2>Treasure budget &mdash; level <span id="lvl"></span></h2>
      <div class="row spread">
        <div><div class="muted">Expected for the level</div><div class="threat" id="budget-gp"></div></div>
        <div style="text-align:right"><div class="muted">Awarded so far</div><div class="threat" id="given-gp" style="color:var(--ink)"></div></div>
      </div>
      <div class="budget-bar" style="margin-top:10px"><div id="loot-bar" style="width:0;background:var(--accent)"></div></div>
      <div class="coins" id="coins" style="margin-top:12px"></div>
    </div>

    <div class="card">
      <h2>Party</h2>
      <div class="list" id="members"></div>
      <button class="ghost" data-add-member style="margin-top:10px">+ Add character</button>
    </div>

    <div class="row wrap">
      <button class="primary grow" data-suggest>Suggest loot</button>
      <button data-add-item>+ Add loot</button>
    </div>

    <div class="list" id="pool"></div>
    <div class="row" id="pool-actions" hidden>
      <button class="danger grow" data-clear>Clear the hoard</button>
    </div>`;
}

function wire(root) {
  on(root, 'click', '[data-add-item]', addItem);
  on(root, 'click', '[data-suggest]', suggestLoot);
  on(root, 'click', '[data-add-member]', addMember);
  on(root, 'click', '[data-claim]', (e, el) => claim(el.dataset.claim));
  on(root, 'click', '[data-del-item]', (e, el) => {
    state.loot.pool = state.loot.pool.filter(i => i.id !== el.dataset.delItem);
    save();
  });
  on(root, 'click', '[data-del-member]', (e, el) => {
    state.party.members = state.party.members.filter(m => m.id !== el.dataset.delMember);
    save();
  });
  on(root, 'click', '[data-clear]', () => { state.loot.pool = []; save(); });
}

export function update(root) {
  const { level, size } = state.party;
  const budget = treasureFor(level, size);
  const given = state.loot.pool.reduce((sum, i) => sum + (Number(i.value) || 0), 0);

  qs('#lvl', root).textContent = level;
  qs('#budget-gp', root).textContent = fmtGp(budget);
  qs('#given-gp', root).textContent = fmtGp(given);
  qs('#loot-bar', root).style.width = Math.min(100, budget ? (given / budget) * 100 : 0) + '%';

  const c = toCoins(budget);
  qs('#coins', root).innerHTML = ['pp', 'gp', 'sp', 'cp']
    .map(k => `<div><b>${c[k].toLocaleString()}</b><small>${k}</small></div>`).join('');

  const members = state.party.members;
  qs('#members', root).innerHTML = members.length
    ? members.map(m => memberRow(m)).join('')
    : '<div class="empty" style="padding:10px">No characters yet.</div>';

  const pool = state.loot.pool;
  qs('#pool', root).innerHTML = pool.length
    ? pool.map(itemRow).join('')
    : '<div class="empty">The hoard is empty.<br>Add coins, gear, or consumables as the party finds them.</div>';
  qs('#pool-actions', root).hidden = pool.length === 0;
}

function memberRow(m) {
  const share = state.loot.pool
    .filter(i => i.owner === m.id)
    .reduce((sum, i) => sum + (Number(i.value) || 0), 0);
  return `
    <div class="item">
      <div class="grow"><div class="name">${esc(m.name)}</div>
        <div class="sub">${esc(m.role || 'adventurer')}</div></div>
      <span class="lvl">${fmtGp(share)}</span>
      <button class="icon ghost danger" data-del-member="${m.id}">&#10005;</button>
    </div>`;
}

function itemRow(i) {
  const owner = state.party.members.find(m => m.id === i.owner);
  return `
    <div class="item">
      <div class="grow">
        <div class="name">${esc(i.name)}</div>
        <div class="sub">${fmtGp(i.value)}${i.note ? ' · ' + esc(i.note) : ''}</div>
      </div>
      <button data-claim="${i.id}" style="min-height:36px;font-size:0.78rem">
        ${owner ? esc(owner.name) : 'Unclaimed'}
      </button>
      <button class="icon ghost danger" data-del-item="${i.id}">&#10005;</button>
    </div>`;
}

function addItem() {
  const body = `
    <label class="field">Item<input type="text" id="l-name" placeholder="+1 striking longsword"></label>
    <div class="row">
      <label class="field grow">Value (gp)<input type="number" id="l-value" min="0" step="0.1" placeholder="0"></label>
      <label class="field grow">Note<input type="text" id="l-note" placeholder="from the ogre&rsquo;s chest"></label>
    </div>
    <button class="primary" id="l-save">Add to hoard</button>`;
  sheet('Add loot', body, (node, close) => {
    qs('#l-save', node).addEventListener('click', () => {
      state.loot.pool.push({
        id: uid('loot'),
        name: qs('#l-name', node).value.trim() || 'Unnamed treasure',
        value: Number(qs('#l-value', node).value) || 0,
        note: qs('#l-note', node).value.trim(),
        owner: null
      });
      save();
      close();
    });
  });
}

/**
 * Fill the loot roster from the committed characters when it is empty, so a share of gold
 * has someone to belong to without a trip through the Party screen's "Use as loot roster".
 * The campaign group is the party; a device-only import counts too. Adding them here is
 * the same thing that button does, and the Party card on this screen shows the result.
 */
async function adoptRoster() {
  if (state.party.members.length) return;
  const file = await loadCharacters();
  const main = (file?.groups || []).find(g => g.kind === 'campaign')?.id;
  const roster = [...(file?.characters || []), ...state.characters.extra]
    .filter(c => !main || c.group === main);
  if (!roster.length) return;
  state.party.members = roster.map(c => ({
    id: c.id,
    name: c.name,
    role: [c.class, c.level].filter(Boolean).join(' ')
  }));
  save();
}

/**
 * A rolled selection of usable treasure at the party's level, or one level above it —
 * the band the treasure tables hand out, so nothing here is out of reach or already
 * obsolete — totalling roughly the treasure that level is owed. Tap an item to drop it in
 * the hoard at its list price, or reroll for a fresh spread.
 *
 * Whatever the items leave short is listed as gold, already divided evenly between the
 * party and claimed for each of them, so "Add all to hoard" hands out exactly what the
 * level is owed with nobody doing the division.
 */
async function suggestLoot() {
  const { level, size } = state.party;
  const budget = treasureFor(level, size);
  const body = `
    <div class="codex-meta" id="s-meta">Loading the item list&hellip;</div>
    <div class="list" id="s-list"></div>
    <div class="row wrap" style="margin-top:10px">
      <button class="grow" id="s-reroll" disabled>Reroll</button>
      <button class="primary grow" id="s-all" disabled>Add all to hoard</button>
    </div>`;
  const { node } = sheet(`Loot for level ${level}`, body);

  const [items] = await Promise.all([equipment(), adoptRoster()]);
  const meta = qs('#s-meta', node);
  const list = qs('#s-list', node);
  let picked = [];
  let total = 0;

  const shares = () => {
    const short = budget - total;
    if (short <= 0.5) return [];
    const members = state.party.members;
    // With nobody to split between — no roster and no imported characters — the gold
    // still goes in, as one unclaimed pile.
    return members.length
      ? splitEvenly(short, members.length).map((value, i) => ({ value, member: members[i] }))
      : [{ value: short, member: null }];
  };

  const draw = () => {
    picked = lootSelection(items, { level, budget });
    total = picked.reduce((sum, i) => sum + i.price / 100, 0);
    const gold = shares();
    meta.textContent = picked.length
      ? `${picked.length} items of level ${level}–${level + 1} · ${fmtGp(total)} of the ` +
        `${fmtGp(budget)} for level ${level}`
      : `No priced items at level ${level}–${level + 1}.`;
    // Two controls per row: the row itself takes the item, and the arrow opens it on the
    // Archives first. Deciding whether a wand of that spell is worth handing over means
    // reading the item, and the summary on a suggestion is a line of stats at most.
    list.innerHTML = (picked.length
      ? picked.map(i => `
        <div class="item pickrow">
          <button class="take" data-take="${esc(i.id)}"${tip(recordTip(i))}>
            <span class="lvl">${i.level}</span>
            <div class="grow">
              <div class="name">${esc(i.name)}</div>
              <div class="sub">${esc(i.category)}${
                i.rarity && i.rarity !== 'common' ? ' · ' + esc(i.rarity) : ''}</div>
            </div>
            <span class="muted">${esc(fmtGp(i.price / 100))}</span>
          </button>
          ${i.url ? `<a class="aon" href="${esc(i.url)}" target="_blank" rel="noopener"
             aria-label="Read ${esc(i.name)} on Archives of Nethys"
             ${tip('Read it on the Archives of Nethys first. Opens in a new tab.')}
             >&#8599;</a>` : ''}
        </div>`).join('')
      : '<div class="empty">Nothing to suggest at that level.</div>')
      // The rest of the level's treasure arrives as gold, already split — so the total
      // handed out matches what the level is owed without anyone doing the division.
      + gold.map(g => `
        <div class="item">
          <span class="lvl">gp</span>
          <div class="grow">
            <div class="name">Gold${g.member ? ` &mdash; ${esc(g.member.name)}` : ''}</div>
            <div class="sub">the rest of the level ${level} treasure, split
              ${gold.length === 1 ? 'once' : gold.length + ' ways'}</div>
          </div>
          <span class="muted">${esc(fmtGp(g.value))}</span>
        </div>`).join('');
  };

  const take = item => {
    state.loot.pool.push({
      id: uid('loot'),
      name: item.name,
      value: item.price / 100,
      note: `level ${item.level} ${String(item.category).toLowerCase()}`,
      owner: null
    });
  };

  draw();
  for (const id of ['#s-reroll', '#s-all']) qs(id, node).disabled = false;
  qs('#s-reroll', node).addEventListener('click', draw);
  qs('#s-all', node).addEventListener('click', () => {
    picked.forEach(take);
    for (const g of shares()) {
      state.loot.pool.push({
        id: uid('loot'),
        name: g.member ? `Gold — ${g.member.name}` : 'Gold',
        value: g.value,
        note: `the rest of the level ${level} treasure`,
        owner: g.member ? g.member.id : null
      });
    }
    save();
    draw();
  });
  on(node, 'click', '[data-take]', (e, el) => {
    const item = picked.find(i => i.id === el.dataset.take);
    if (!item) return;
    take(item);
    save();
    // The whole row goes, not just the button that was tapped — the Archives link beside
    // it belongs to an item that is now in the hoard.
    (el.closest('.item') || el).remove();
  });
}

function addMember() {
  const body = `
    <label class="field">Character<input type="text" id="m-name" placeholder="Valeros"></label>
    <label class="field">Class or role<input type="text" id="m-role" placeholder="Fighter"></label>
    <button class="primary" id="m-save">Add</button>`;
  sheet('Add character', body, (node, close) => {
    qs('#m-save', node).addEventListener('click', () => {
      state.party.members.push({
        id: uid('pc'),
        name: qs('#m-name', node).value.trim() || 'Adventurer',
        role: qs('#m-role', node).value.trim()
      });
      save();
      close();
    });
  });
}

function claim(itemId) {
  const item = state.loot.pool.find(i => i.id === itemId);
  if (!item) return;
  const members = state.party.members;
  if (!members.length) { addMember(); return; }
  // Cycle through unclaimed -> each member -> unclaimed again.
  const order = [null, ...members.map(m => m.id)];
  const next = order[(order.indexOf(item.owner) + 1) % order.length];
  item.owner = next;
  save();
}

function fmtGp(v) {
  const n = Number(v) || 0;
  return (Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1)) + ' gp';
}
