// Encounter planner: build a roster, watch the XP budget, hand it to the tracker.

import { state, save, uid } from '../store.js';
import { esc, on, sheet, qs } from '../dom.js';
import { creatureXP, hazardXP, budgets, threatFor, xpAward } from '../pf2e.js';
import { creatures } from '../data.js';

const KIND_LABEL = { creature: 'Creature', simple: 'Simple hazard', complex: 'Complex hazard' };

function entryXP(entry, partyLevel) {
  const each = entry.kind === 'creature'
    ? creatureXP(entry.level, partyLevel)
    : hazardXP(entry.level, partyLevel, entry.kind === 'complex');
  return each === null ? null : each * entry.count;
}

function total(partyLevel) {
  return state.encounter.entries.reduce((sum, e) => sum + (entryXP(e, partyLevel) || 0), 0);
}

export function mount(root) {
  root.innerHTML = shell();
  wire(root);
  update(root);
}

function shell() {
  return `
    <div class="card" id="budget">
      <h2>Encounter budget</h2>
      <div class="row spread" style="align-items:flex-end">
        <div>
          <span class="threat" id="threat">Trivial</span>
          <div class="muted" id="xp-line">0 XP</div>
        </div>
        <div style="text-align:right">
          <div class="muted">Each PC earns</div>
          <div class="threat" id="award" style="color:var(--ink)">0</div>
        </div>
      </div>
      <div class="budget-bar" style="margin-top:10px"><div id="bar" style="width:0"></div></div>
      <div class="muted" id="thresholds" style="margin-top:6px;font-size:0.72rem"></div>
    </div>

    <div class="row wrap">
      <button class="primary grow" data-add-bestiary>+ From bestiary</button>
      <button data-add-custom>+ Custom</button>
    </div>

    <div class="list" id="entries"></div>

    <div class="row wrap" id="footer-actions" hidden>
      <button class="grow" data-to-combat>Send to combat tracker &rarr;</button>
      <button class="danger" data-clear>Clear</button>
    </div>`;
}

function wire(root) {
  on(root, 'click', '[data-add-custom]', () => addCustom());
  on(root, 'click', '[data-add-bestiary]', () => addFromBestiary());
  on(root, 'click', '[data-inc]', (e, el) => bump(el.dataset.inc, +1));
  on(root, 'click', '[data-dec]', (e, el) => bump(el.dataset.dec, -1));
  on(root, 'click', '[data-del]', (e, el) => {
    state.encounter.entries = state.encounter.entries.filter(x => x.id !== el.dataset.del);
    save();
  });
  on(root, 'click', '[data-clear]', () => { state.encounter.entries = []; save(); });
  on(root, 'click', '[data-to-combat]', () => toCombat());
}

function bump(id, delta) {
  const entry = state.encounter.entries.find(x => x.id === id);
  if (!entry) return;
  entry.count = Math.max(1, entry.count + delta);
  save();
}

export function update(root) {
  const { level, size } = state.party;
  const xp = total(level);
  const b = budgets(size);
  const threat = threatFor(xp, size);
  const threatEl = qs('#threat', root);

  threatEl.textContent = threat.replace(/^./, c => c.toUpperCase());
  threatEl.dataset.t = threat;
  qs('#xp-line', root).textContent =
    `${xp} XP · party level ${level} · ${size} PC${size === 1 ? '' : 's'}`;
  qs('#award', root).textContent = xpAward(xp, size) + ' XP';

  const bar = qs('#bar', root);
  bar.style.width = Math.min(100, (xp / b.extreme) * 100) + '%';
  bar.style.background = getComputedStyle(threatEl).color;

  qs('#thresholds', root).textContent =
    Object.entries(b).map(([k, v]) => `${k} ${v}`).join(' · ');

  const entries = state.encounter.entries;
  qs('#entries', root).innerHTML = entries.length
    ? entries.map(e => row(e, level)).join('')
    : '<div class="empty">No creatures yet.<br>Add from the bestiary or enter one by hand.</div>';
  qs('#footer-actions', root).hidden = entries.length === 0;
}

function row(e, partyLevel) {
  const xp = entryXP(e, partyLevel);
  const sub = xp === null
    ? '<span style="color:var(--blood)">outside the −4/+4 XP band</span>'
    : `${KIND_LABEL[e.kind]} · ${xp} XP`;
  return `
    <div class="item">
      <span class="lvl">${e.level}</span>
      <div class="grow">
        <div class="name">${esc(e.name)}</div>
        <div class="sub">${sub}</div>
      </div>
      <div class="stepper">
        <button class="icon" data-dec="${e.id}">&minus;</button>
        <output>${e.count}</output>
        <button class="icon" data-inc="${e.id}">+</button>
      </div>
      <button class="icon ghost danger" data-del="${e.id}">&#10005;</button>
    </div>`;
}

export function addEntry(name, level, kind = 'creature', creature = null) {
  const match = state.encounter.entries
    .find(e => e.name === name && e.level === level && e.kind === kind);
  if (match) match.count += 1;
  else state.encounter.entries.push({ id: uid('enc'), name, level, count: 1, kind, creature });
  save();
}

function addCustom() {
  const body = `
    <label class="field">Name<input type="text" id="f-name" placeholder="Goblin Warrior"></label>
    <label class="field">Level<input type="number" id="f-level" value="${state.party.level}" min="-1" max="25"></label>
    <label class="field">Kind
      <select id="f-kind">
        <option value="creature">Creature</option>
        <option value="simple">Simple hazard</option>
        <option value="complex">Complex hazard</option>
      </select>
    </label>
    <button class="primary" id="f-save">Add</button>`;
  sheet('Add to encounter', body, (node, close) => {
    qs('#f-save', node).addEventListener('click', () => {
      const name = qs('#f-name', node).value.trim() || 'Unnamed';
      addEntry(name, Number(qs('#f-level', node).value) || 0, qs('#f-kind', node).value);
      close();
    });
  });
}

async function addFromBestiary() {
  const all = await creatures();
  const body = `
    <input type="search" id="b-search" placeholder="Search creatures&hellip;" autocomplete="off">
    <div class="list" id="b-list"></div>`;
  const { node, close } = sheet('Bestiary', body);
  const list = qs('#b-list', node);

  const draw = (q = '') => {
    const needle = q.toLowerCase();
    const hits = all.filter(c => c.name.toLowerCase().includes(needle)
      || (c.traits || []).some(t => t.toLowerCase().includes(needle))).slice(0, 60);
    list.innerHTML = hits.length
      ? hits.map(c => `
        <button class="item" data-pick="${esc(c.name)}" style="text-align:left">
          <span class="lvl">${c.level}</span>
          <div class="grow">
            <div class="name">${esc(c.name)}</div>
            <div class="sub">${esc((c.traits || []).join(', '))}</div>
          </div>
        </button>`).join('')
      : `<div class="empty">Nothing matches &ldquo;${esc(q)}&rdquo;.</div>`;
  };

  draw();
  qs('#b-search', node).addEventListener('input', e => draw(e.target.value));
  on(node, 'click', '[data-pick]', (e, el) => {
    const c = all.find(x => x.name === el.dataset.pick);
    if (c) addEntry(c.name, c.level, 'creature', c);
    close();
  });
}

function toCombat() {
  for (const e of state.encounter.entries) {
    if (e.kind !== 'creature') continue;
    for (let i = 0; i < e.count; i++) {
      state.combat.combatants.push({
        id: uid('c'),
        name: e.count > 1 ? `${e.name} ${i + 1}` : e.name,
        isPC: false,
        init: null,
        hp: e.creature?.hp ?? null,
        maxHp: e.creature?.hp ?? null,
        ac: e.creature?.ac ?? null,
        conditions: []
      });
    }
  }
  save();
  location.hash = '#/combat';
}
