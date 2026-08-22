// Loot: the level's treasure budget, what the party has found, and who claimed it.

import { state, save, uid } from '../store.js';
import { esc, on, sheet, qs } from '../dom.js';
import { treasureFor, toCoins } from '../pf2e.js';

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
      <div class="budget-bar" style="margin-top:10px"><div id="loot-bar" style="width:0;background:var(--gold)"></div></div>
      <div class="coins" id="coins" style="margin-top:12px"></div>
    </div>

    <div class="card">
      <h2>Party</h2>
      <div class="list" id="members"></div>
      <button class="ghost" data-add-member style="margin-top:10px">+ Add character</button>
    </div>

    <div class="row wrap">
      <button class="primary grow" data-add-item>+ Add loot</button>
      <button data-split>Split coins evenly</button>
    </div>

    <div class="list" id="pool"></div>
    <div class="row" id="pool-actions" hidden>
      <button class="danger grow" data-clear>Clear the hoard</button>
    </div>`;
}

function wire(root) {
  on(root, 'click', '[data-add-item]', addItem);
  on(root, 'click', '[data-add-member]', addMember);
  on(root, 'click', '[data-split]', splitCoins);
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

function splitCoins() {
  const members = state.party.members;
  if (!members.length) { addMember(); return; }
  const unclaimed = state.loot.pool.filter(i => !i.owner);
  if (!unclaimed.length) return;
  unclaimed.forEach((item, i) => { item.owner = members[i % members.length].id; });
  save();
}

function fmtGp(v) {
  const n = Number(v) || 0;
  return (Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1)) + ' gp';
}
