// Combat tracker: initiative order, HP, and conditions for one encounter.

import { state, save, uid } from '../store.js';
import { brief, esc, on, sheet, tip, qs, qsa } from '../dom.js';
import {
  CONDITIONS, PERSISTENT_DAMAGE_TYPES, impliedConditions, takesValue, conditionName,
  parseCondition, withConditionValue, persistentDamageTotal, endOfTurnConditions
} from '../pf2e.js';
import { conditions as loadConditions, characters as loadCharacters } from '../data.js';
import { plannedCount, sendToCombat } from './encounters.js';

// What each condition does, keyed by name, for the hover description on a chip. Empty
// until data/conditions.json arrives; a chip with no summary yet simply has no tooltip.
let conditionText = new Map();

// What nextTurn() did to the combatant whose turn just ended, for the line printed near
// the round counter — "Kobold Warrior · Frightened 2 → 1 · persistent fire: take the
// damage, then DC 15 flat check to end it". Held here rather than written straight into
// the DOM, the same way the BGM view holds `handed`: update() rebuilds the board on every
// state change, so anything written only into the DOM would be wiped by the next render.
// Cleared whenever the turn moves on again or combat ends.
let turnReport = null;

function ordered() {
  // Highest initiative first; anyone without a roll yet sorts to the bottom.
  return [...state.combat.combatants].sort((a, b) => (b.init ?? -Infinity) - (a.init ?? -Infinity));
}

const SIDES = [['pc', 'Party'], ['npc', 'Enemies']];

/**
 * Which side of the board a combatant fights on.
 *
 * Its own `side` when it has one, and what it is otherwise — combatants saved before sides
 * existed only know whether they are player characters. Kept separate from `isPC` because
 * the two answer different questions: a charmed player character fights for the enemy, and
 * a summoned ally or a friendly NPC fights for the party without being a PC.
 */
const sideOf = c => c.side || (c.isPC ? 'pc' : 'npc');

/**
 * Keep full PC names in state for roster matching, but use their table name on the board.
 * Some saved rows predate `isPC`; their Party-side placement is the safe legacy signal.
 */
const trackerName = c => (c.isPC || sideOf(c) === 'pc')
  ? String(c.name || '').trim().split(/\s+/)[0] || c.name
  : c.name;

/** A Party/Enemies toggle for an add sheet, already showing `side`. */
function sidePicker(side) {
  return `<div class="field" style="flex:0 0 auto">Side
    <div class="picker">
      ${SIDES.map(([id, label]) => `
        <button class="pick${id === side ? ' on' : ''}" data-side="${id}">${label}</button>`)
        .join('')}
    </div>
  </div>`;
}

/** Wire that toggle: it paints itself and hands the choice back. */
function onSidePick(node, set) {
  on(node, 'click', '[data-side]', (e, el) => {
    qsa('[data-side]', node).forEach(b => b.classList.toggle('on', b === el));
    set(el.dataset.side);
  });
}

export function mount(root) {
  root.innerHTML = shell();
  wire(root);
  update(root);
  if (!conditionText.size) {
    loadConditions().then(list => {
      conditionText = new Map((list || []).map(x => [x.name, x.notes]));
      update(root);
    });
  }
}

function shell() {
  return `
    <div class="card">
      <div class="row spread">
        <div>
          <h2 style="margin:0">Round</h2>
          <div class="threat" id="round" style="color:var(--accent)">&mdash;</div>
        </div>
        <button class="primary" data-next>Next turn</button>
      </div>
      <div class="muted" id="turn-of" style="margin-top:6px"></div>
      <div class="turn-report" id="turn-report" hidden></div>
    </div>

    <div class="board" id="board"></div>

    <div class="row" id="import-row" hidden>
      <button class="grow" data-import-enc></button>
    </div>

    <div class="row wrap">
      <button class="grow" data-add-pc>+ PC</button>
      <button class="grow" data-add-npc>+ NPC</button>
      <button class="danger" data-end>End</button>
    </div>`;
}

function wire(root) {
  on(root, 'click', '[data-next]', nextTurn);
  on(root, 'click', '[data-add-pc]', () => addFromRoster());
  on(root, 'click', '[data-add-npc]', () => addCombatant(false));
  on(root, 'click', '[data-import-enc]', () => sendToCombat());
  on(root, 'click', '[data-end]', endCombat);
  on(root, 'change', '[data-hp]', (e, el) => typeHP(el.dataset.hp, el.value));
  on(root, 'input', '[data-hp-slide]', (e, el) => dragHP(el));
  // Released: the list may be rebuilt again.
  on(root, 'change', '[data-hp-slide]', () => save());
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

function find(id) {
  return state.combat.combatants.find(c => c.id === id);
}

export function update(root) {
  const list = ordered();
  const active = list[state.combat.active];

  qs('#round', root).textContent = state.combat.round || '—';
  qs('#turn-of', root).textContent = list.length === 0
    ? 'No combatants yet. Add PCs, or send an encounter over from the planner.'
    : (state.combat.round === 0 ? 'Press Next turn to begin.' : `Turn: ${active ? trackerName(active) : '—'}`);

  // What the last "Next turn" tap did — cleared once the turn moves on again or combat
  // ends, so it never survives past the moment it is still useful for.
  const report = qs('#turn-report', root);
  report.hidden = !turnReport;
  report.textContent = turnReport || '';

  // Both sides at once: the party down the left, whatever they are fighting down the
  // right, each column in initiative order. Turn order is still the one interleaved list —
  // the columns only decide where a combatant is drawn, never when it acts — so the
  // highlight goes on the active combatant by identity rather than by position.
  const turnOf = state.combat.round > 0 ? active : null;
  qs('#board', root).innerHTML =
    column('pc', 'Party', list, turnOf) + column('npc', 'Enemies', list, turnOf);

  // Whatever the planner is currently holding, one tap away. Hidden when it holds nothing,
  // so the row costs no space in the common case.
  const planned = plannedCount();
  qs('#import-row', root).hidden = planned === 0;
  if (planned) {
    qs('[data-import-enc]', root).textContent =
      `+ ${planned} ${planned === 1 ? 'enemy' : 'enemies'} from the planner`;
  }
}

/**
 * One side of the board. `list` is already in initiative order, so filtering keeps it.
 *
 * Nothing is capped: five a side is what the layout is built to show on one phone screen,
 * but a sixth combatant continues down its column rather than being hidden — a tracker
 * that quietly stops listing someone is worse than one you have to scroll.
 */
function column(side, label, list, turnOf) {
  const rows = list.filter(c => sideOf(c) === side);
  return `
    <div class="side" data-side="${side}">
      <div class="side-head">${label}${rows.length ? ` · ${rows.length}` : ''}</div>
      ${rows.length
        ? rows.map(c => card(c, c === turnOf)).join('')
        : `<div class="empty side-empty">${side === 'pc'
            ? 'No PCs yet.<br>Add from the roster.'
            : 'No enemies yet.<br>Bring some in from the planner.'}</div>`}
    </div>`;
}

function card(c, isTurn) {
  const name = trackerName(c);
  const pct = hpPct(c);
  const dead = c.maxHp !== null && c.hp <= 0;
  const cls = ['item', 'combatant', isTurn ? 'is-turn' : '',
    sideOf(c) === 'pc' ? 'is-party' : '', dead ? 'is-dead' : '']
    .filter(Boolean).join(' ');

  // HP is one line: the number, and the rest of the width is the bar. The bar doubles as
  // the control — a range input laid over it, because an 8px bar is nothing to aim at, so
  // the input's own hit area is the whole strip. Nothing else earns a place on the row: a
  // pair of ±1/±5 buttons either side of the number left it too wide to read at 390px, and
  // dragging the bar covers what they did.
  const hpBlock = c.maxHp === null
    ? '<span class="muted">no HP tracked</span>'
    : `<span class="hp"><input data-hp="${c.id}" type="number" inputmode="numeric" min="0"
              max="${c.maxHp}" value="${c.hp}" aria-label="Current HP of ${esc(name)}"
              ><span class="muted">/${c.maxHp}</span></span>
       <div class="hpwrap">
         <div class="hpbar ${toneFor(pct)}"><div style="width:${pct}%"></div></div>
         <input class="hpslide" type="range" min="0" max="${c.maxHp}" step="1"
                value="${c.hp}" data-hp-slide="${c.id}" aria-label="Set HP of ${esc(name)}">
       </div>`;

  // A card in a 163px column, so it stacks rather than spreads, and the name wraps instead
  // of ellipsising — "Goblin Warrior 2" on two lines still tells you which goblin it is.
  const sub = subLine(c);
  return `
    <div class="${cls}">
      <div class="row" style="gap:6px">
        <input class="init" data-init="${c.id}" type="number" inputmode="numeric"
               value="${c.init ?? ''}" placeholder="?"
               aria-label="Initiative for ${esc(c.name)}">
        <div class="name grow">${esc(name)}</div>
        <button class="icon ghost danger" data-remove="${c.id}"
                aria-label="Remove ${esc(name)}">&#10005;</button>
      </div>
      ${sub ? `<div class="sub">${esc(sub)}</div>` : ''}
      <div class="hprow">${hpBlock}</div>
      <div class="chips">
        ${c.conditions.map(cond => `
          <button class="chip" data-owner="${c.id}" data-drop-cond="${esc(cond)}"${tip(describe(cond))}
                  aria-label="Remove ${esc(cond)} from ${esc(name)}">${esc(cond)} &#10005;</button>
        `).join('')}
        <button class="chip add" data-cond="${c.id}">+ condition</button>
      </div>
    </div>`;
}

/**
 * What a card says under the name: what it takes to run this combatant.
 *
 * No "PC"/"NPC" any more — the column it is drawn in says which side it is on, and the
 * two characters were the difference between the sub-line fitting and wrapping.
 */
function subLine(c) {
  return [
    c.ac ? 'AC ' + c.ac : null,
    // Initiative is typed at the table, so the modifier to add to the die belongs on the
    // card rather than on a character sheet two taps away.
    Number.isFinite(c.initMod) ? 'Perc ' + (c.initMod >= 0 ? '+' : '') + c.initMod : null
  ].filter(Boolean).join(' · ');
}

const hpPct = c => (c.maxHp ? Math.max(0, Math.min(100, (c.hp / c.maxHp) * 100)) : 0);
const toneFor = pct => (pct <= 25 ? 'crit' : pct <= 50 ? 'warn' : '');
const clampHP = (c, n) => Math.max(0, Math.min(c.maxHp, Math.round(n)));

/** A number typed into the HP box. An empty or junk box snaps back rather than zeroing. */
function typeHP(id, raw) {
  const c = find(id);
  if (!c || c.maxHp === null) return;
  const n = Number(raw);
  if (raw !== '' && Number.isFinite(n)) c.hp = clampHP(c, n);
  save();
}

/**
 * A drag along the HP bar, painted straight onto the row it belongs to.
 *
 * Deliberately no save() here: save() notifies the view and the whole list is rebuilt,
 * which would replace the slider under the finger halfway through the drag. The `change`
 * event on release does the saving.
 */
function dragHP(el) {
  const c = find(el.dataset.hpSlide);
  const row = el.closest('.combatant');
  if (!c || c.maxHp === null || !row) return;
  c.hp = clampHP(c, Number(el.value));
  const pct = hpPct(c);
  const bar = qs('.hpbar', row);
  bar.className = 'hpbar ' + toneFor(pct);
  bar.firstElementChild.style.width = pct + '%';
  const box = qs('[data-hp]', row);
  if (box) box.value = c.hp;
  row.classList.toggle('is-dead', c.hp <= 0);
}

/**
 * Apply endOfTurnConditions() to the combatant whose turn is ending, and build the line
 * for the round counter out of what it reports. Mutates the combatant's own conditions;
 * returns null when there is nothing worth printing (nothing ticked, nothing to remind).
 */
function endTurnFor(c) {
  const persistent = persistentDamageTotal(c.conditions);
  const before = c.hp;
  const { conditions, ticked, reminders } = endOfTurnConditions(c.conditions);
  c.conditions = conditions;
  // A combatant without tracked HP still needs the flat-check reminder, but there is no
  // health value for the tracker to change. Persistent damage cannot reduce HP below 0.
  if (persistent && c.maxHp !== null && Number.isFinite(c.hp)) {
    c.hp = Math.max(0, c.hp - persistent);
    ticked.unshift(`persistent damage ${persistent} (HP ${before} → ${c.hp})`);
  }
  const parts = [...ticked, ...reminders];
  return parts.length ? `${trackerName(c)} · ${parts.join(' · ')}` : null;
}

function nextTurn() {
  const list = ordered();
  if (!list.length) return;
  if (state.combat.round === 0) {
    // Round 0 -> 1 starts the first turn; nobody's turn has ended yet.
    state.combat.round = 1;
    state.combat.active = 0;
    turnReport = null;
  } else {
    // ordered() re-sorts on every call, so the combatant whose turn is ending has to be
    // read out of *this* list, before the pointer moves — including the last combatant
    // in the round, whose end-of-turn happens right as the round rolls over.
    const ending = list[state.combat.active];
    turnReport = ending ? endTurnFor(ending) : null;

    state.combat.active += 1;
    if (state.combat.active >= list.length) {
      state.combat.active = 0;
      state.combat.round += 1;
    }
  }
  save();
}

function endCombat() {
  state.combat = { round: 0, active: 0, combatants: [] };
  turnReport = null;
  save();
}

/**
 * Pick player characters out of the imported roster: tick as many as you like, or take a
 * whole party in one tap. AC, HP and the Perception modifier come from the sheet, so the
 * only thing left to type is the total the player rolled. Anyone already in the order is
 * shown as such rather than added twice.
 */
async function addFromRoster() {
  const file = await loadCharacters();
  const groups = file?.groups || [];
  const filed = file?.characters || [];
  const roster = [...filed, ...state.characters.extra];
  if (!roster.length) {
    addCombatant(true);
    return;
  }

  const groupLabel = id => groups.find(g => g.id === id)?.label || id;
  const ids = [...new Set(roster.map(c => c.group))];
  // The main party is the campaign group when there is one — that is the "whole party"
  // button — and everything otherwise.
  let group = groups.find(g => g.kind === 'campaign')?.id || ids[0] || ALL_GROUPS;

  const body = `
    <div class="picker" id="r-groups"></div>
    <div class="list" id="r-list"></div>
    ${sidePicker('pc')}
    <div class="row wrap" style="margin-top:10px">
      <button class="primary grow" id="r-add" disabled>Add selected</button>
      <button class="grow" id="r-all">Add whole party</button>
    </div>
    <button class="ghost" id="r-hand" style="margin-top:8px">Enter one by hand instead</button>`;
  const { node, close } = sheet('Add player characters', body);
  const chosen = new Set();
  // The party side by default, but a charmed or captured PC can be dropped in on the other.
  let side = 'pc';
  onSidePick(node, next => { side = next; });

  const inOrder = c => state.combat.combatants.some(x => x.isPC && x.name === c.name);
  const listed = () => (group === ALL_GROUPS ? roster : roster.filter(c => c.group === group))
    .slice().sort((a, b) => a.name.localeCompare(b.name));

  const draw = () => {
    qs('#r-groups', node).innerHTML = [
      `<button class="pick${group === ALL_GROUPS ? ' on' : ''}"
        data-rgroup="${ALL_GROUPS}">All</button>`,
      ...ids.map(id => `<button class="pick${group === id ? ' on' : ''}"
        data-rgroup="${esc(id)}">${esc(groupLabel(id))}</button>`)
    ].join('');

    qs('#r-list', node).innerHTML = listed().map(c => {
      const already = inOrder(c);
      return `
      <button class="item${already ? ' faint' : ''}" data-rpick="${esc(c.id)}"
              style="text-align:left">
        <span class="lvl">${c.level ?? '—'}</span>
        <div class="grow">
          <div class="name">${esc(c.name)}</div>
          <div class="sub">${esc([c.ancestry, c.class].filter(Boolean).join(' · '))}${
            c.ac ? ' · AC ' + c.ac : ''}${c.hp ? ' · HP ' + c.hp : ''}</div>
        </div>
        <span class="muted">${already ? 'in the order'
          : chosen.has(c.id) ? '&#10003; picked' : ''}</span>
      </button>`;
    }).join('') || '<div class="empty">No characters in this group.</div>';

    const picked = listed().filter(c => chosen.has(c.id) && !inOrder(c)).length;
    const add = qs('#r-add', node);
    add.disabled = picked === 0;
    add.textContent = picked ? `Add ${picked} selected` : 'Add selected';
    const all = listed().filter(c => !inOrder(c)).length;
    qs('#r-all', node).textContent = group === ALL_GROUPS
      ? `Add all ${all}`
      : `Add all of ${groupLabel(group)}`;
    qs('#r-all', node).disabled = all === 0;
  };

  draw();
  on(node, 'click', '[data-rgroup]', (e, el) => { group = el.dataset.rgroup; draw(); });
  on(node, 'click', '[data-rpick]', (e, el) => {
    const id = el.dataset.rpick;
    if (chosen.has(id)) chosen.delete(id);
    else chosen.add(id);
    draw();
  });
  qs('#r-add', node).addEventListener('click', () => {
    listed().filter(c => chosen.has(c.id)).forEach(c => addPC(c, side));
    save();
    close();
  });
  qs('#r-all', node).addEventListener('click', () => {
    listed().forEach(c => addPC(c, side));
    save();
    close();
  });
  qs('#r-hand', node).addEventListener('click', () => { close(); addCombatant(true); });
}

const ALL_GROUPS = '__all__';

/** One imported character into the initiative order, skipping anyone already there. */
function addPC(c, side = 'pc') {
  if (state.combat.combatants.some(x => x.isPC && x.name === c.name)) return;
  state.combat.combatants.push({
    id: uid('c'),
    name: c.name,
    // Where this row came from. A combatant otherwise carries no way back to the record
    // behind it — only the AC and HP copied below — so anything that wants the whole sheet
    // has to look it up. Rows saved before this field existed simply do not have it
    // (merge() in store.js replaces the combatants array wholesale rather than backfilling
    // into it), so a lookup falls back to matching on name for those.
    ref: c.id ? { kind: 'character', id: c.id } : null,
    isPC: true,
    side,
    init: null,
    // Perception is the initiative modifier for the usual case. Kept because the row
    // prints it: the GM types the total the player rolled, and having the modifier on the
    // card is the whole point of storing it.
    initMod: c.perception ?? 0,
    hp: c.hp ?? null,
    maxHp: c.hp ?? null,
    ac: c.ac ?? null,
    conditions: []
  });
}

function addCombatant(isPC) {
  // Which button opened this sheet only sets the starting side; either can go either way.
  let side = isPC ? 'pc' : 'npc';
  const body = `
    <label class="field">Name<input type="text" id="c-name" placeholder="${isPC ? 'Valeros' : 'Goblin Warrior'}"></label>
    <div class="row">
      <label class="field grow">Initiative<input type="number" id="c-init" placeholder="e.g. 18"></label>
      <label class="field grow">Max HP<input type="number" id="c-hp" min="0" placeholder="optional"></label>
      <label class="field grow">AC<input type="number" id="c-ac" placeholder="optional"></label>
    </div>
    ${sidePicker(side)}
    <button class="primary" id="c-save">Add to initiative</button>`;
  sheet(isPC ? 'Add PC' : 'Add NPC', body, (node, close) => {
    onSidePick(node, next => { side = next; });
    qs('#c-save', node).addEventListener('click', () => {
      const hp = Number(qs('#c-hp', node).value);
      const initRaw = qs('#c-init', node).value;
      const ac = Number(qs('#c-ac', node).value);
      state.combat.combatants.push({
        id: uid('c'),
        name: qs('#c-name', node).value.trim() || (isPC ? 'PC' : 'NPC'),
        isPC,
        side,
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

const PERSISTENT = 'Persistent Damage';

/**
 * The hover description for a chip: what the condition mechanically does, and what it
 * brings with it. Goes through conditionName() rather than the raw chip text, so
 * "Frightened 2" and "Persistent Damage (fire)" both still find their entry — getting
 * this wrong silently drops the tooltip. The rules text goes through brief() here rather
 * than being left to tip(), so the knock-on conditions sit inside the budget instead of
 * competing with the prose for it.
 */
function describe(cond) {
  const base = conditionName(cond);
  const also = impliedConditions(base);
  return [
    brief(conditionText.get(base), 100),
    also.length ? `Also applies: ${also.join(', ')}.` : ''
  ].filter(Boolean).join(' ');
}

/**
 * A condition and everything the rules hand out with it — prone is also off-guard, and
 * grabbed is off-guard and immobilized — because applying them one at a time by hand is
 * how a −2 to AC gets forgotten mid-fight. See IMPLIED_CONDITIONS in src/pf2e.js.
 *
 * `name` may already carry a value ("Frightened 2") or a persistent-damage parenthetical.
 * A valued condition the combatant already has is matched by conditionName() and its old
 * chip replaced, rather than dedup'd with includes() — "Frightened 1" and "Frightened 3"
 * are the same condition at two different values, not two chips.
 */
function addCondition(c, name) {
  for (const cond of [name, ...impliedConditions(conditionName(name))]) {
    const cname = conditionName(cond);
    if (takesValue(cname)) {
      c.conditions = c.conditions.filter(x => conditionName(x) !== cname);
      c.conditions.push(cond);
    } else if (cname === PERSISTENT) {
      // A second application of the same damage type replaces the amount already shown;
      // it must not create two fire ticks. Different types remain separate conditions.
      const note = parseCondition(cond).note;
      c.conditions = c.conditions.filter(x => {
        const old = parseCondition(x);
        return old.name !== PERSISTENT || old.note !== note;
      });
      c.conditions.push(cond);
    } else if (!c.conditions.includes(cond)) {
      c.conditions.push(cond);
    }
  }
}

/**
 * The condition picker. Two conditions need a second tap rather than filing the chip on
 * the first: persistent damage, because "persistent damage" alone does not say what it
 * is doing, and every valued condition, because "Frightened" alone has no value on it
 * yet. Both swap the sheet's contents over to their own row of choices — a damage type
 * for persistent damage followed by its amount, and values 1-4 for a valued condition.
 *
 * The second step replaces the contents of the sheet already open rather than stacking
 * another one over it — two sheets deep, closing the top one looks like a sheet that
 * refuses to close.
 */
function openConditions(id) {
  const c = find(id);
  if (!c) return;
  const { node, close } = sheet(`Conditions · ${trackerName(c)}`, '<div class="chips" id="cond-pick"></div>');
  const title = qs('h2', node);
  const pick = qs('#cond-pick', node);

  const chip = (value, label, text) => `
    <span class="chip add" data-pick="${esc(value)}"
          style="font-size:0.8rem;padding:8px 12px"${tip(text)}>${esc(label)}</span>`;

  const backChip = `
    <span class="chip add" data-back style="font-size:0.8rem;padding:8px 12px"
      >&larr; Conditions</span>`;

  const listConditions = () => {
    title.textContent = `Conditions · ${trackerName(c)}`;
    pick.innerHTML = CONDITIONS.map(cond => chip(cond, cond, describe(cond))).join('');
  };

  const listTypes = () => {
    title.textContent = 'Persistent damage';
    pick.innerHTML = backChip +
      PERSISTENT_DAMAGE_TYPES
        .map(t => chip(`${PERSISTENT} (${t.toLowerCase()})`, t, conditionText.get(PERSISTENT)))
        .join('');
  };

  const listValues = (name) => {
    title.textContent = `${name} · value`;
    const text = describe(name);
    pick.innerHTML = backChip +
      [1, 2, 3, 4].map(n => chip(withConditionValue(name, n), String(n), text)).join('');
  };

  const persistentValue = type => {
    title.textContent = `Persistent ${type.toLowerCase()} damage`;
    pick.innerHTML = backChip + `
      <label class="field" style="margin-top:8px">Damage each turn
        <input id="persistent-value" type="number" inputmode="numeric" min="1" step="1"
               value="1" aria-label="Persistent ${esc(type)} damage each turn">
      </label>
      <button class="primary" data-set-persistent="${esc(type)}">Set damage</button>`;
  };

  listConditions();
  on(node, 'click', '[data-back]', listConditions);
  on(node, 'click', '[data-set-persistent]', (e, el) => {
    const amount = Number(qs('#persistent-value', node).value);
    if (!Number.isFinite(amount) || amount < 1) return;
    const type = el.dataset.setPersistent.toLowerCase();
    addCondition(c, `Persistent Damage ${Math.round(amount)} (${type})`);
    save();
    close();
  });
  on(node, 'click', '[data-pick]', (e, el) => {
    const picked = el.dataset.pick;
    if (picked === PERSISTENT) {
      listTypes();
      return;
    }
    if (conditionName(picked) === PERSISTENT) {
      persistentValue(parseCondition(picked).note || 'damage');
      return;
    }
    if (takesValue(picked)) {
      listValues(picked);
      return;
    }
    addCondition(c, picked);
    save();
    close();
  });
}
