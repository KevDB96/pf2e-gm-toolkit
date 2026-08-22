// Combat tracker: initiative order, HP, and conditions for one encounter.

import { state, save, uid } from '../store.js';
import { esc, on, sheet, qs } from '../dom.js';
import { CONDITIONS, roll } from '../pf2e.js';

function ordered() {
  // Highest initiative first; anyone without a roll yet sorts to the bottom.
  return [...state.combat.combatants].sort((a, b) => (b.init ?? -Infinity) - (a.init ?? -Infinity));
}

export function mount(root) {
  root.innerHTML = shell();
  wire(root);
  update(root);
}

function shell() {
  return `
    <div class="card">
      <div class="row spread">
        <div>
          <h2 style="margin:0">Round</h2>
          <div class="threat" id="round" style="color:var(--gold)">&mdash;</div>
        </div>
        <div class="row">
          <button data-roll-all title="Roll initiative for everyone missing it">Roll init</button>
          <button class="primary" data-next>Next turn</button>
        </div>
      </div>
      <div class="muted" id="turn-of" style="margin-top:6px"></div>
    </div>

    <div class="list" id="combatants"></div>

    <div class="row wrap">
      <button class="grow" data-add-pc>+ PC</button>
      <button class="grow" data-add-npc>+ NPC</button>
      <button class="danger" data-end>End</button>
    </div>`;
}

function wire(root) {
  on(root, 'click', '[data-next]', nextTurn);
  on(root, 'click', '[data-roll-all]', rollAll);
  on(root, 'click', '[data-add-pc]', () => addCombatant(true));
  on(root, 'click', '[data-add-npc]', () => addCombatant(false));
  on(root, 'click', '[data-end]', endCombat);
  on(root, 'click', '[data-dmg]', (e, el) => applyHP(el.dataset.dmg, -stepOf(el)));
  on(root, 'click', '[data-heal]', (e, el) => applyHP(el.dataset.heal, +stepOf(el)));
  on(root, 'click', '[data-cond]', (e, el) => openConditions(el.dataset.cond));
  on(root, 'click', '[data-drop-cond]', (e, el) => {
    const c = find(el.dataset.owner);
    if (!c) return;
    c.conditions = c.conditions.filter(x => x !== el.dataset.dropCond);
    save();
  });
  on(root, 'click', '[data-remove]', (e, el) => {
    state.combat.combatants = state.combat.combatants.filter(x => x.id !== el.dataset.remove);
    save();
  });
  on(root, 'change', '[data-init]', (e, el) => {
    const c = find(el.dataset.init);
    if (c) { c.init = el.value === '' ? null : Number(el.value); save(); }
  });
}

function stepOf(el) {
  // Each HP button carries its own step size; touch has no modifier keys to lean on.
  return Number(el.dataset.step || 1);
}

function find(id) {
  return state.combat.combatants.find(c => c.id === id);
}

export function update(root) {
  const list = ordered();
  const active = list[state.combat.active];

  qs('#round', root).textContent = state.combat.round || '—';
  qs('#turn-of', root).textContent = list.length === 0
    ? 'No combatants yet. Add PCs, or send an encounter over from the planner.'
    : (state.combat.round === 0 ? 'Press Next turn to begin.' : `Turn: ${active ? active.name : '—'}`);

  qs('#combatants', root).innerHTML = list.length
    ? list.map((c, i) => card(c, i === state.combat.active && state.combat.round > 0)).join('')
    : '<div class="empty">Empty initiative order.</div>';
}

function card(c, isTurn) {
  const pct = c.maxHp ? Math.max(0, Math.min(100, (c.hp / c.maxHp) * 100)) : 0;
  const tone = pct <= 25 ? 'crit' : pct <= 50 ? 'warn' : '';
  const dead = c.maxHp !== null && c.hp <= 0;
  const cls = ['item', 'combatant', isTurn ? 'is-turn' : '', c.isPC ? 'is-pc' : '', dead ? 'is-dead' : '']
    .filter(Boolean).join(' ');

  const hpBlock = c.maxHp === null
    ? '<span class="muted">no HP tracked</span>'
    : `<button class="icon" data-dmg="${c.id}" data-step="5">−5</button>
       <button class="icon" data-dmg="${c.id}" data-step="1">−1</button>
       <span class="hp"><b>${c.hp}</b><span class="muted">/${c.maxHp}</span></span>
       <button class="icon" data-heal="${c.id}" data-step="1">+1</button>
       <button class="icon" data-heal="${c.id}" data-step="5">+5</button>`;

  return `
    <div class="${cls}">
      <input class="init" data-init="${c.id}" type="number" value="${c.init ?? ''}"
             placeholder="?" style="width:3.2em;min-height:38px;text-align:center">
      <div class="grow">
        <div class="name">${esc(c.name)}</div>
        <div class="sub">${c.isPC ? 'PC' : 'NPC'}${c.ac ? ' · AC ' + c.ac : ''}</div>
      </div>
      <button class="icon ghost danger" data-remove="${c.id}">&#10005;</button>
      <div class="row" style="flex:1 0 100%;justify-content:flex-end;gap:4px">${hpBlock}</div>
      ${c.maxHp === null ? '' : `<div class="hpbar ${tone}"><div style="width:${pct}%"></div></div>`}
      <div class="chips" style="flex:1 0 100%">
        ${c.conditions.map(cond => `
          <span class="chip" data-owner="${c.id}" data-drop-cond="${esc(cond)}">${esc(cond)} &#10005;</span>
        `).join('')}
        <span class="chip add" data-cond="${c.id}">+ condition</span>
      </div>
    </div>`;
}

function applyHP(id, delta) {
  const c = find(id);
  if (!c || c.maxHp === null) return;
  c.hp = Math.max(0, Math.min(c.maxHp, c.hp + delta));
  save();
}

function nextTurn() {
  const list = ordered();
  if (!list.length) return;
  if (state.combat.round === 0) {
    state.combat.round = 1;
    state.combat.active = 0;
  } else {
    state.combat.active += 1;
    if (state.combat.active >= list.length) {
      state.combat.active = 0;
      state.combat.round += 1;
    }
  }
  save();
}

function rollAll() {
  for (const c of state.combat.combatants) {
    if (c.init === null) c.init = roll('d20').total + (c.initMod || 0);
  }
  save();
}

function endCombat() {
  state.combat = { round: 0, active: 0, combatants: [] };
  save();
}

function addCombatant(isPC) {
  const body = `
    <label class="field">Name<input type="text" id="c-name" placeholder="${isPC ? 'Valeros' : 'Goblin Warrior'}"></label>
    <div class="row">
      <label class="field grow">Initiative<input type="number" id="c-init" placeholder="roll or type"></label>
      <label class="field grow">Max HP<input type="number" id="c-hp" min="0" placeholder="optional"></label>
      <label class="field grow">AC<input type="number" id="c-ac" placeholder="optional"></label>
    </div>
    <button class="primary" id="c-save">Add to initiative</button>`;
  sheet(isPC ? 'Add PC' : 'Add NPC', body, (node, close) => {
    qs('#c-save', node).addEventListener('click', () => {
      const hp = Number(qs('#c-hp', node).value);
      const initRaw = qs('#c-init', node).value;
      const ac = Number(qs('#c-ac', node).value);
      state.combat.combatants.push({
        id: uid('c'),
        name: qs('#c-name', node).value.trim() || (isPC ? 'PC' : 'NPC'),
        isPC,
        init: initRaw === '' ? null : Number(initRaw),
        hp: hp > 0 ? hp : null,
        maxHp: hp > 0 ? hp : null,
        ac: ac > 0 ? ac : null,
        conditions: []
      });
      save();
      close();
    });
  });
}

function openConditions(id) {
  const c = find(id);
  if (!c) return;
  const body = `<div class="chips">${CONDITIONS.map(cond => `
    <span class="chip add" data-pick="${esc(cond)}" style="font-size:0.8rem;padding:8px 12px">${esc(cond)}</span>
  `).join('')}</div>`;
  const { node, close } = sheet(`Conditions · ${c.name}`, body);
  on(node, 'click', '[data-pick]', (e, el) => {
    const cond = el.dataset.pick;
    if (!c.conditions.includes(cond)) c.conditions.push(cond);
    save();
    close();
  });
}
