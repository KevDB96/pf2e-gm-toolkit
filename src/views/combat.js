// Combat tracker: initiative order, HP, and conditions for one encounter.

import { state, uid, save } from '../store.js';
import { brief, esc, on, rich, sheet, tip, qs, qsa } from '../dom.js';
import {
  CONDITIONS, PERSISTENT_DAMAGE_TYPES, impliedConditions, takesValue, conditionName,
  parseCondition, withConditionValue, endOfTurnConditions, applyDamage,
  recoveryResult, DEGREES,
  normalizeConditionEffects, conditionEffects, effectiveConditionEffects, removeConditionEffect,
  durationReminders, normalizePersistentDamage, effectivePersistentEffects, persistentLabel,
  safePersistentExpression
} from '../pf2e.js';
import { conditions as loadConditions, characters as loadCharacters } from '../data.js';
import { plannedCount, sendToCombat } from './encounters.js';
import { advanceTurn, delayCombatant, orderedCombatants, rejoinCombatant, removeCombatant } from '../combat-turn.js';
import { openCombatantSheet } from '../combat-details.js';
import { openGMReference } from '../gm-reference.js';
import {
  beginCombatTransaction, canUndo, combatTransaction, commitCombatTransaction,
  configureCombatHistory, undoCombat, undoLabel
} from '../combat-history.js';

// What each condition does, keyed by name, for the hover description on a chip. Empty
// until data/conditions.json arrives; a chip with no summary yet simply has no tooltip.
let conditionText = new Map();
let conditionRecords = new Map();

// What nextTurn() did to the combatant whose turn just ended, for the line printed near
// the round counter — "Kobold Warrior · Frightened 2 → 1 · persistent fire: take the
// damage, then DC 15 flat check to end it". Held here rather than written straight into
// the DOM, the same way the BGM view holds `handed`: update() rebuilds the board on every
// state change, so anything written only into the DOM would be wiped by the next render.
// Cleared whenever the turn moves on again or combat ends.
let turnReport = null;
// Kept alongside the report (and included in combat undo metadata), not in a second
// persisted condition list. Each prompt points back to the authoritative effect ID.
let durationPrompts = [];
// A resolution sheet stages physical rolls outside state. Reloading intentionally cancels
// this draft; nothing has been applied until its explicit Apply button is pressed.
let pendingPersistent = null;
let hpGesture = null;

const historyContext = {
  readMeta: () => ({ report: turnReport, durationPrompts, pendingPersistent }),
  writeMeta: value => {
    turnReport = value?.report ?? null;
    durationPrompts = Array.isArray(value?.durationPrompts) ? value.durationPrompts : [];
    pendingPersistent = value?.pendingPersistent ?? null;
  }
};
configureCombatHistory(historyContext);

function ordered() {
  return orderedCombatants(state.combat.combatants);
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
      conditionRecords = new Map((list || []).map(x => [x.name, x]));
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
        <div class="row wrap"><button class="ghost" data-gm-reference>Reference</button><button class="ghost" data-player-settings>Display</button><button class="ghost" data-open-player>Player view</button><button class="primary" data-next>Next turn</button></div>
      </div>
      <div class="muted" id="turn-of" style="margin-top:6px"></div>
      <div class="turn-report" id="turn-report" hidden></div>
      <button class="ghost" data-undo disabled>Undo</button>
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
  on(root, 'click', '[data-gm-reference]', openGMReference);
  on(root, 'click', '[data-player-settings]', openPlayerSettings);
  on(root, 'click', '[data-open-player]', openPlayerView);
  on(root, 'click', '[data-delay]', delayActive);
  on(root, 'click', '[data-rejoin]', (e, el) => rejoin(el.dataset.rejoin));
  on(root, 'click', '[data-ready]', openReadySheet);
  on(root, 'click', '[data-ready-used]', (e, el) => updateReady(el.dataset.readyUsed, 'used'));
  on(root, 'click', '[data-ready-clear]', (e, el) => clearReady(el.dataset.readyClear));
  on(root, 'click', '[data-duration-choice]', (e, el) => {
    const prompt = durationPrompts.find(x => x.id === el.dataset.durationChoice && x.ownerId === el.dataset.owner);
    if (!prompt) return;
    combatTransaction(el.dataset.durationAction === 'end' ? 'End expired condition' : 'Keep expired condition', () => {
      if (el.dataset.durationAction === 'end') {
        const c = find(prompt.ownerId);
        if (c) {
          const effects = ensureEffects(c);
          c.effects = removeConditionEffect(effects, prompt.id);
          c.conditions = conditionEffects(effectiveConditionEffects(c.effects));
        }
      } else {
        const c = find(prompt.ownerId);
        if (c) {
          c.effects = ensureEffects(c).map(effect => effect.id === prompt.id
            ? { ...effect, duration: null } : effect);
          c.conditions = conditionEffects(effectiveConditionEffects(c.effects));
        }
      }
      durationPrompts = durationPrompts.filter(x => x !== prompt);
    }, historyContext);
  });
  on(root, 'click', '[data-add-pc]', () => addFromRoster());
  on(root, 'click', '[data-add-npc]', () => addCombatant(false));
  on(root, 'click', '[data-import-enc]', () => sendToCombat());
  on(root, 'click', '[data-end]', endCombat);
  on(root, 'click', '[data-undo]', () => { undoCombat(historyContext); update(root); });
  on(root, 'change', '[data-hp]', (e, el) => typeHP(el.dataset.hp, el.value));
  on(root, 'pointerdown', '[data-hp-slide]', (e, el) => {
    if (e.pointerId !== undefined && el.setPointerCapture) el.setPointerCapture(e.pointerId);
    hpGesture = beginCombatTransaction('Set HP', historyContext);
    dragHP(el);
  });
  on(root, 'keydown', '[data-hp-slide]', (e, el) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
      if (!hpGesture) hpGesture = beginCombatTransaction('Set HP', historyContext);
    }
  });
  on(root, 'input', '[data-hp-slide]', (e, el) => { if (!hpGesture) hpGesture = beginCombatTransaction('Set HP', historyContext); dragHP(el); });
  on(root, 'change', '[data-hp-slide]', () => { commitCombatTransaction(hpGesture); hpGesture = null; });
  on(root, 'pointerup', '[data-hp-slide]', () => { commitCombatTransaction(hpGesture); hpGesture = null; });
  on(root, 'pointercancel', '[data-hp-slide]', () => { if (hpGesture) { state.combat = hpGesture.before.combat; turnReport = hpGesture.before.meta; update(root); } hpGesture = null; });
  on(root, 'click', '[data-cond]', (e, el) => openConditions(el.dataset.cond));
  on(root, 'click', '[data-open-stats]', (e, el) => {
    const combatant = find(el.dataset.openStats);
    if (combatant) openCombatantSheet(combatant);
  });
  on(root, 'click', '[data-condition-detail]', (e, el) => {
    const c = find(el.dataset.owner);
    if (c) openConditionDetail(c, el.dataset.conditionDetail);
  });
  on(root, 'click', '[data-remove]', (e, el) => {
    combatTransaction('Remove combatant', combat => {
      const result = removeCombatant(combat, el.dataset.remove);
      if (result.activeRemoved) turnReport = null;
      Object.assign(combat, result.combat);
    }, historyContext);
  });
  on(root, 'change', '[data-init]', (e, el) => {
    combatTransaction('Edit initiative', combat => {
      const c = combat.combatants.find(x => x.id === el.dataset.init);
      if (c) c.init = el.value === '' ? null : Number(el.value);
    }, historyContext);
  });
}

function find(id) {
  return state.combat.combatants.find(c => c.id === id);
}

function openPlayerView() {
  window.open('player.html', 'pf2e-gm-player', 'popup,width=420,height=760');
}

function openPlayerSettings() {
  const list = ordered();
  const entries = state.player?.entries || {};
  const body = `<p class="muted">Only revealed names and public turn order are sent to the player window. HP, AC, initiatives, notes, source IDs, and hidden combatants never leave this screen.</p>
    ${list.length ? list.map(c => { const entry = entries[c.id] || {}; return `<div class="player-setting"><label><input type="checkbox" data-player-reveal="${esc(c.id)}"${entry.revealed ? ' checked' : ''}> Reveal</label><input class="grow" data-player-name="${esc(c.id)}" value="${esc(entry.name || '')}" placeholder="Public name (optional)" aria-label="Public name for ${esc(trackerName(c))}"><span class="muted">${esc(trackerName(c))}</span></div>`; }).join('') : '<p class="empty">Add combatants before configuring the player display.</p>'}
    <button class="primary" data-player-save>Save display settings</button>`;
  const { node, close } = sheet('Player display', body, sheetNode => {
    on(sheetNode, 'click', '[data-player-save]', () => {
      const next = {};
      for (const c of list) {
        const prior = entries[c.id] || {};
        next[c.id] = {
          token: prior.token || uid('player'),
          revealed: Boolean(qs(`[data-player-reveal="${CSS.escape(c.id)}"]`, sheetNode)?.checked),
          name: qs(`[data-player-name="${CSS.escape(c.id)}"]`, sheetNode)?.value.trim().slice(0, 80) || ''
        };
      }
      state.player = { entries: next };
      save();
      close();
    });
  });
}

function ensureEffects(c) {
  c.effects = normalizeConditionEffects(c);
  c.conditions = conditionEffects(effectiveConditionEffects(c.effects));
  return c.effects;
}

export function update(root) {
  const list = ordered();
  const active = list.find(c => c.id === state.combat.activeId);

  qs('#round', root).textContent = state.combat.round || '—';
  qs('#turn-of', root).textContent = list.length === 0
    ? 'No combatants yet. Add PCs, or send an encounter over from the planner.'
    : (state.combat.round === 0 ? 'Press Next turn to begin.' : active ? `Turn: ${trackerName(active)}` : 'Everyone is delayed. Rejoin someone to continue.');

  // What the last "Next turn" tap did — cleared once the turn moves on again or combat
  // ends, so it never survives past the moment it is still useful for.
  const report = qs('#turn-report', root);
  report.hidden = !turnReport;
  report.innerHTML = turnReport ? esc(turnReport) : '';
  if (durationPrompts.length) {
    report.hidden = false;
    report.insertAdjacentHTML('beforeend', durationPrompts.map(prompt => `
      <div class="turn-expiry">${esc(prompt.ownerName)} · ${esc(prompt.name)}: ${esc(prompt.message)}
        <button class="ghost" data-duration-choice="${esc(prompt.id)}" data-owner="${esc(prompt.ownerId)}" data-duration-action="keep">Keep</button>
        <button class="danger" data-duration-choice="${esc(prompt.id)}" data-owner="${esc(prompt.ownerId)}" data-duration-action="end">End</button>
      </div>`).join(''));
  }
  const undo = qs('[data-undo]', root);
  undo.disabled = !canUndo();
  undo.textContent = canUndo() ? `Undo: ${undoLabel()}` : 'Undo';
  const ready = state.combat.ready || [];
  const delayed = (state.combat.delayedIds || []).map(id => find(id)).filter(Boolean);
  if (ready.length || delayed.length) {
    report.hidden = false;
    report.insertAdjacentHTML('beforeend', `<div class="turn-expiry">${ready.map(item => `<span>${esc(trackerName(find(item.ownerId) || { name: item.ownerId }))}: ${esc(item.action)} when ${esc(item.trigger)} · ${esc(item.status)}</span>${item.status === 'armed' ? `<button class="ghost" data-ready-used="${esc(item.id)}">Used</button>` : ''}<button class="ghost" data-ready-clear="${esc(item.id)}">Clear</button>`).join('')}</div>`);
    if (delayed.length) report.insertAdjacentHTML('beforeend', `<div class="turn-expiry"><span>Delayed: ${delayed.map(c => esc(trackerName(c))).join(', ')}</span>${delayed.map(c => `<button class="ghost" data-rejoin="${esc(c.id)}">Rejoin ${esc(trackerName(c))}</button>`).join('')}</div>`);
  }

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
      `+ ${planned} ${planned === 1 ? 'participant' : 'participants'} from the planner`;
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
        <button class="combat-name grow" data-open-stats="${c.id}" aria-label="Open statistics for ${esc(name)}">${esc(name)}</button>
        <button class="icon ghost danger" data-remove="${c.id}"
                aria-label="Remove ${esc(name)}">&#10005;</button>
      </div>
      ${sub ? `<div class="sub">${esc(sub)}</div>` : ''}
      <div class="hprow">${hpBlock}</div>
      ${isTurn ? '<div class="combat-quick-actions"><button class="ghost" data-delay>Delay</button><button class="ghost" data-ready>Ready</button></div>' : ''}
      <div class="chips">
        ${conditionEffects(effectiveConditionEffects(normalizeConditionEffects(c))).map(cond => `
          <button class="chip" data-owner="${c.id}" data-condition-detail="${esc(cond)}"${tip(describe(cond))}
                  aria-label="View ${esc(cond)} on ${esc(name)}">${esc(cond)}</button>
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
    Number.isFinite(c.initMod) ? `${c.isHazard ? 'Stealth' : 'Perc'} ` + (c.initMod >= 0 ? '+' : '') + c.initMod : null,
    c.isHazard && c.hazard?.disabled ? 'disabled' : null
  ].filter(Boolean).join(' · ');
}

const hpPct = c => (c.maxHp ? Math.max(0, Math.min(100, (c.hp / c.maxHp) * 100)) : 0);
const toneFor = pct => (pct <= 25 ? 'crit' : pct <= 50 ? 'warn' : '');
const clampHP = (c, n) => Math.max(0, Math.min(c.maxHp, Math.round(n)));

/** A number typed into the HP box. An empty or junk box snaps back rather than zeroing. */
function typeHP(id, raw) {
  const n = Number(raw);
  if (raw === '' || !Number.isFinite(n)) return;
  combatTransaction('Set HP', combat => {
    const c = combat.combatants.find(x => x.id === id);
    if (c && c.maxHp !== null) c.hp = clampHP(c, n);
  }, historyContext);
  if (n === 0) openZeroHPResolution(id);
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
  ensureEffects(c);
  const { conditions, ticked, reminders } = endOfTurnConditions(c.conditions);
  // Frightened is the one verified automatic change. Update effect instances, never the
  // derived list, so dependencies and source metadata survive the tick.
  c.effects = c.effects.map(effect => {
    if (effect.name !== 'Frightened') return effect;
    const value = (effect.value ?? 1) - 1;
    return value > 0 ? { ...effect, value, raw: withConditionValue('Frightened', value) } : null;
  }).filter(Boolean);
  c.conditions = conditionEffects(effectiveConditionEffects(c.effects));
  void conditions; // The source-aware effect list above is authoritative.
  const parts = [...ticked, ...reminders];
  return parts.length ? `${trackerName(c)} · ${parts.join(' · ')}` : null;
}

function persistentFor(c) {
  return effectivePersistentEffects(ensureEffects(c));
}

function completeNextTurn(combat, ending, results = []) {
  durationPrompts = [];
  turnReport = ending ? endTurnFor(ending) : null;
  const reports = [];
  if (ending) {
    const before = ending.hp;
    let total = 0;
    for (const result of results) {
      total += result.damage;
      if (result.recovered) ending.effects = removeConditionEffect(ending.effects, result.id);
      reports.push(`${result.label}: ${result.damage}${result.recovered ? ' · recovered' : ''}`);
    }
    ending.conditions = conditionEffects(effectiveConditionEffects(ending.effects));
    if (total && ending.maxHp !== null && Number.isFinite(ending.hp)) {
      ending.hp = Math.max(0, ending.hp - total);
      reports.unshift(`persistent damage ${total} (HP ${before} → ${ending.hp})`);
    }
    if (reports.length) turnReport = `${trackerName(ending)} · ${[turnReport?.replace(`${trackerName(ending)} · `, ''), ...reports].filter(Boolean).join(' · ')}`;
  }
  const event = (combat.turnEvent || 0) + 1;
  if (ending) remindAt(combat, ending.id, 'end', event);
  const advanced = advanceTurn(combat);
  Object.assign(combat, advanced.combat);
  const starting = combat.combatants.find(c => c.id === combat.activeId);
  if (starting) remindAt(combat, starting.id, 'start', combat.turnEvent);
}

function openPersistentResolution(ending) {
  if (pendingPersistent) return;
  const entries = persistentFor(ending);
  if (!entries.length) return;
  const draft = { ownerId: ending.id };
  pendingPersistent = draft;
  const body = `<p class="muted">Enter physical rolls, then choose recovery for each type. Defences are applied once unless you enter a final, already-adjusted amount.</p>
    <div class="list">${entries.map(({ effect, persistent }) => `
      <div class="item persistent-resolution" data-persistent-id="${esc(effect.id)}">
        <b>${esc(persistentLabel(persistent))}</b>
        <label class="field">${persistent.expression ? 'Physical roll' : 'Damage'}
          <input data-persistent-damage="${esc(effect.id)}" type="number" inputmode="numeric" min="0" step="1" value="${persistent.amount ?? ''}" ${persistent.expression ? 'autofocus' : ''}></label>
        <label class="field">Recovery DC <input data-persistent-dc="${esc(effect.id)}" type="number" inputmode="numeric" min="1" value="${persistent.recoveryDC}"></label>
        <label class="field">Recovery <select data-persistent-recovery="${esc(effect.id)}"><option value="failed">Failed</option><option value="succeeded">Succeeded</option></select></label>
        <label class="check"><input data-persistent-final="${esc(effect.id)}" type="checkbox"> Final damage after defences</label>
      </div>`).join('')}</div>
    <div class="row"><button class="ghost" data-persistent-cancel>Cancel</button><button class="primary" data-persistent-apply>Apply end of turn</button></div>`;
  const { node, close } = sheet(`Persistent damage · ${trackerName(ending)}`, body, (sheetNode) => {
    on(sheetNode, 'click', '[data-persistent-cancel]', () => close());
    on(sheetNode, 'click', '[data-persistent-apply]', () => {
      const results = [];
      for (const { effect, persistent } of entries) {
        const raw = Number(qs(`[data-persistent-damage="${effect.id}"]`, sheetNode).value);
        if (!Number.isFinite(raw) || raw < 0) return;
        const dc = Number(qs(`[data-persistent-dc="${effect.id}"]`, sheetNode).value);
        const final = qs(`[data-persistent-final="${effect.id}"]`, sheetNode).checked;
        const recovered = qs(`[data-persistent-recovery="${effect.id}"]`, sheetNode).value === 'succeeded';
        const defended = final ? Math.round(raw) : applyDamage({ [persistent.type]: Math.round(raw) }, ending).total;
        results.push({ id: effect.id, damage: defended, recovered, label: `${persistent.type} ${Math.round(raw)}${final ? ' final' : ''} (DC ${Number.isFinite(dc) && dc > 0 ? dc : persistent.recoveryDC})` });
      }
      combatTransaction('Resolve persistent damage', combat => {
        const owner = combat.combatants.find(c => c.id === ending.id);
        if (owner) completeNextTurn(combat, owner, results);
        pendingPersistent = null;
      }, historyContext);
      close();
    });
  }, () => { if (pendingPersistent === draft) pendingPersistent = null; });
}

function remindAt(combat, targetId, phase, event) {
  const ids = combat.combatants.map(c => c.id);
  for (const combatant of combat.combatants) {
    const effects = ensureEffects(combatant);
    const result = durationReminders(effects, { targetId, phase, event, combatantIds: ids });
    combatant.effects = result.effects;
    combatant.conditions = conditionEffects(effectiveConditionEffects(result.effects));
    durationPrompts.push(...result.reminders.map(reminder => ({
      ...reminder, ownerId: combatant.id, ownerName: trackerName(combatant)
    })));
  }
}

function nextTurn() {
  if (pendingPersistent) return;
  const ending = state.combat.round > 0
    ? state.combat.combatants.find(c => c.id === state.combat.activeId) : null;
  if (ending && hasCondition(ending, 'Dying')) {
    openRecoveryResolution(ending);
    return;
  }
  if (ending && persistentFor(ending).length) {
    openPersistentResolution(ending);
    return;
  }
  combatTransaction('Next turn', combat => {
    const active = combat.round > 0 ? combat.combatants.find(c => c.id === combat.activeId) : null;
    completeNextTurn(combat, active);
  }, historyContext);
}

function hasCondition(c, name) { return conditionEffects(effectiveConditionEffects(ensureEffects(c))).some(x => conditionName(x) === name); }

function setConditionValue(c, name, value) {
  const effects = ensureEffects(c).filter(effect => effect.name !== name);
  effects.push({ id: uid('effect'), name, value, raw: withConditionValue(name, value), source: { kind: 'manual' } });
  c.effects = effects;
  c.conditions = conditionEffects(effectiveConditionEffects(effects));
}

function openZeroHPResolution(id) {
  const c = find(id);
  if (!c) return;
  const body = `<p class="muted">Zero HP is not automatically death. Choose the ruling that applies; nonlethal effects and creature-specific exceptions remain manual.</p><label class="check"><input type="checkbox" data-zero-nonlethal> Nonlethal or otherwise unconscious only</label><label class="check"><input type="checkbox" data-zero-critical> Critical damage or critical failure on a save</label><label class="field">Dying value (optional)<input type="number" min="1" max="4" data-zero-dying placeholder="Leave unchanged"></label><button class="primary" data-zero-apply>Apply ruling</button>`;
  const { node, close } = sheet(`Zero HP · ${trackerName(c)}`, body, sheetNode => {
    on(sheetNode, 'click', '[data-zero-apply]', () => {
      const nonlethal = qs('[data-zero-nonlethal]', sheetNode).checked;
      const raw = qs('[data-zero-dying]', sheetNode).value;
      const dying = raw === '' ? null : Math.max(1, Math.min(4, Number(raw)));
      const critical = qs('[data-zero-critical]', sheetNode).checked;
      combatTransaction('Resolve zero HP', combat => {
        const owner = combat.combatants.find(x => x.id === id);
        if (!owner || nonlethal) return;
        if (dying !== null) setConditionValue(owner, 'Dying', dying);
        else if (!hasCondition(owner, 'Dying')) setConditionValue(owner, 'Dying', critical ? 2 : 1);
      }, historyContext);
      close();
    });
  });
}

function openRecoveryResolution(c) {
  const dying = conditionValueOf(c, 'Dying') || 1;
  const body = `<p class="muted">Enter the physical d20. Recovery DC is 10 + Dying (${10 + dying}). Apply only after reviewing the result.</p><label class="field">d20 result<input type="number" min="1" max="20" data-recovery-roll inputmode="numeric"></label><button class="primary" data-recovery-preview>Preview</button><div data-recovery-result></div><button class="primary" data-recovery-apply disabled>Apply recovery</button>`;
  const { node, close } = sheet(`Recovery check · ${trackerName(c)}`, body, sheetNode => {
    let result = null;
    on(sheetNode, 'click', '[data-recovery-preview]', () => {
      result = recoveryResult({ dying, wounded: conditionValueOf(c, 'Wounded') || 0, roll: Number(qs('[data-recovery-roll]', sheetNode).value) });
      qs('[data-recovery-result]', sheetNode).innerHTML = result ? `<p class="reference-outcome">${esc(DEGREES[result.degree])}: Dying ${result.dying}${result.conscious ? ' · conscious' : result.dead ? ' · death' : ''}</p>` : '<p class="form-error">Enter a d20 result from 1 to 20.</p>';
      qs('[data-recovery-apply]', sheetNode).disabled = !result;
    });
    on(sheetNode, 'click', '[data-recovery-apply]', () => {
      if (!result) return;
      combatTransaction('Apply recovery check', combat => {
        const owner = combat.combatants.find(x => x.id === c.id);
        if (!owner) return;
        const effects = ensureEffects(owner).filter(effect => effect.name !== 'Dying' && effect.name !== 'Wounded');
        if (result.dying) effects.push({ id: uid('effect'), name: 'Dying', value: result.dying, raw: withConditionValue('Dying', result.dying), source: { kind: 'manual' } });
        if (result.wounded) effects.push({ id: uid('effect'), name: 'Wounded', value: result.wounded, raw: withConditionValue('Wounded', result.wounded), source: { kind: 'manual' } });
        owner.effects = effects; owner.conditions = conditionEffects(effectiveConditionEffects(effects));
      }, historyContext);
      close();
    });
  });
}

function conditionValueOf(c, name) { return ensureEffects(c).find(effect => effect.name === name)?.value || null; }

function delayActive() {
  const ending = state.combat.round > 0 ? find(state.combat.activeId) : null;
  if (!ending) return;
  if (persistentFor(ending).length) { openPersistentResolution(ending); return; }
  combatTransaction('Delay turn', combat => {
    durationPrompts = [];
    turnReport = endTurnFor(ending);
    const event = (combat.turnEvent || 0) + 1;
    combat.turnEvent = event;
    remindAt(combat, ending.id, 'end', event);
    Object.assign(combat, delayCombatant(combat, ending.id).combat);
    const starting = combat.combatants.find(c => c.id === combat.activeId);
    if (starting) remindAt(combat, starting.id, 'start', combat.turnEvent);
  }, historyContext);
}

function rejoin(id) {
  combatTransaction('Rejoin delayed combatant', combat => {
    Object.assign(combat, rejoinCombatant(combat, id, combat.activeId || null).combat);
  }, historyContext);
}

function updateReady(id, status) {
  combatTransaction(status === 'used' ? 'Use Ready reminder' : 'Clear Ready reminder', combat => {
    const item = combat.ready.find(x => x.id === id);
    if (item) item.status = status;
  }, historyContext);
}

function clearReady(id) {
  combatTransaction('Clear Ready reminder', combat => {
    combat.ready = combat.ready.filter(item => item.id !== id);
  }, historyContext);
}

function openReadySheet() {
  const owner = state.combat.activeId;
  if (!owner) return;
  const body = `<label class="field">Action<input data-ready-action placeholder="Strike, Step, Cast a spell"></label><label class="field">Trigger<input data-ready-trigger placeholder="the cultist enters"></label><p class="muted">Ready uses two actions and changes the readied action into a reaction when its trigger occurs. This reminder does not move initiative or detect the trigger.</p><button class="primary" data-ready-save>Save reminder</button>`;
  const { node, close } = sheet('Ready action', body, sheetNode => {
    on(sheetNode, 'click', '[data-ready-save]', () => {
      const action = qs('[data-ready-action]', sheetNode).value.trim();
      const trigger = qs('[data-ready-trigger]', sheetNode).value.trim();
      if (!action || !trigger) return;
      combatTransaction('Set Ready reminder', combat => {
        combat.ready.push({ id: uid('ready'), ownerId: owner, action, trigger, status: 'armed' });
      }, historyContext);
      close();
    });
  });
}

function endCombat() {
  combatTransaction('End combat', combat => {
    Object.assign(combat, { round: 0, activeId: null, combatants: [] });
    turnReport = null;
    durationPrompts = [];
  }, historyContext);
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
    combatTransaction('Add player characters', () => {
      listed().filter(c => chosen.has(c.id)).forEach(c => addPC(c, side));
    }, historyContext);
    close();
  });
  qs('#r-all', node).addEventListener('click', () => {
    combatTransaction('Add player characters', () => {
      listed().forEach(c => addPC(c, side));
    }, historyContext);
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
    initMod: Number.isFinite(c.perception) ? c.perception : null,
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
      combatTransaction(isPC ? 'Add PC' : 'Add NPC', combat => {
        combat.combatants.push({
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
      }, historyContext);
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
  const effects = ensureEffects(c);
  const root = { id: uid('effect'), name: conditionName(name), value: parseCondition(name).value,
    note: parseCondition(name).note, origin: 'Manual', sourceId: null, dependsOn: [], duration: null, raw: String(name) };
  effects.push(root);
  for (const cond of impliedConditions(conditionName(name))) {
    const cname = conditionName(cond);
    effects.push({ id: uid('effect'), name: cname, value: parseCondition(cond).value,
      note: parseCondition(cond).note, origin: root.origin, sourceId: root.id, dependsOn: [root.id], duration: null, raw: String(cond) });
  }
  c.conditions = conditionEffects(effectiveConditionEffects(effects));
}

function addPersistent(c, type, input, replaceAmbiguous = false) {
  const text = String(input || '').trim();
  const amount = /^\d+$/.test(text) && Number(text) > 0 ? Number(text) : null;
  const expression = amount === null ? safePersistentExpression(text) : null;
  if (amount === null && !expression) return { ok: false };
  const effects = ensureEffects(c);
  const persistent = { type: type.toLowerCase(), amount, expression, recoveryDC: 15 };
  const same = effects.filter(effect => normalizePersistentDamage(effect.persistent, effect)?.type === persistent.type);
  // Fixed values have an unambiguous rule: only the higher amount applies. Dice entries
  // remain as separate visible sources because their relative results are not knowable
  // until the GM rolls them.
  if (amount !== null) {
    const highest = same.map(effect => normalizePersistentDamage(effect.persistent, effect)?.amount)
      .filter(Number.isFinite).reduce((max, value) => Math.max(max, value), 0);
    if (highest >= amount) return { ok: true };
    for (const effect of same) {
      const old = normalizePersistentDamage(effect.persistent, effect);
      if (old?.amount !== null) effects.splice(effects.indexOf(effect), 1);
    }
  }
  const uncertain = same.find(effect => normalizePersistentDamage(effect.persistent, effect)?.expression);
  if (uncertain && !replaceAmbiguous) return { ok: false, conflict: uncertain, candidate: persistent };
  if (uncertain && replaceAmbiguous) effects.splice(effects.indexOf(uncertain), 1);
  effects.push({ id: uid('effect'), name: 'Persistent Damage', value: null, note: type.toLowerCase(),
    origin: 'Manual', sourceId: null, dependsOn: [], duration: null, persistent,
    raw: persistentLabel(persistent) });
  c.conditions = conditionEffects(effectiveConditionEffects(effects));
  return { ok: true };
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
  const focusPicker = () => requestAnimationFrame(() => qs('[data-pick], [data-back], #persistent-value', node)?.focus());

  const chip = (value, label, text) => `
    <button class="chip add" data-pick="${esc(value)}"
            style="font-size:0.8rem;padding:8px 12px"${tip(text)}>${esc(label)}</button>`;

  const backChip = `
    <button class="chip add" data-back style="font-size:0.8rem;padding:8px 12px"
      >&larr; Conditions</button>`;

  const listConditions = () => {
    title.textContent = `Conditions · ${trackerName(c)}`;
    pick.innerHTML = CONDITIONS.map(cond => chip(cond, cond, describe(cond))).join('');
    focusPicker();
  };

  const listTypes = () => {
    title.textContent = 'Persistent damage';
    pick.innerHTML = backChip +
      PERSISTENT_DAMAGE_TYPES
        .map(t => chip(`${PERSISTENT} (${t.toLowerCase()})`, t, conditionText.get(PERSISTENT)))
        .join('');
    focusPicker();
  };

  const listValues = (name) => {
    title.textContent = `${name} · value`;
    const text = describe(name);
    pick.innerHTML = backChip +
      [1, 2, 3, 4].map(n => chip(withConditionValue(name, n), String(n), text)).join('');
    focusPicker();
  };

  const persistentValue = type => {
    title.textContent = `Persistent ${type.toLowerCase()} damage`;
    pick.innerHTML = backChip + `
      <label class="field" style="margin-top:8px">Damage each turn (fixed amount or dice, e.g. 1d6+2)
        <input id="persistent-value" type="text" inputmode="text" value="1"
               aria-label="Persistent ${esc(type)} damage each turn">
      </label>
      <button class="primary" data-set-persistent="${esc(type)}">Set damage</button>`;
    focusPicker();
  };

  const persistentConflict = (type, input, conflict, candidate) => {
    title.textContent = `Persistent ${type.toLowerCase()} damage`;
    const old = normalizePersistentDamage(conflict.persistent, conflict);
    pick.innerHTML = `<p>Two dice expressions of the same type can’t be compared before rolling.</p>
      <button class="ghost" data-persistent-keep>Keep ${esc(persistentLabel(old))}</button>
      <button class="primary" data-persistent-use>Use ${esc(persistentLabel(candidate))}</button>`;
    on(node, 'click', '[data-persistent-keep]', () => close());
    on(node, 'click', '[data-persistent-use]', () => {
      combatTransaction('Replace persistent damage', () => addPersistent(c, type, input, true), historyContext);
      close();
    });
    focusPicker();
  };

  listConditions();
  on(node, 'click', '[data-back]', listConditions);
  on(node, 'click', '[data-set-persistent]', (e, el) => {
    const amount = qs('#persistent-value', node).value;
    const type = el.dataset.setPersistent.toLowerCase();
    const before = JSON.parse(JSON.stringify(ensureEffects(c)));
    const preview = addPersistent(c, type, amount);
    // Preview above mutates only if it can settle the result; restore it when this is an
    // ambiguous dice choice so the sheet can ask before a transaction is committed.
    if (preview.conflict) {
      // addPersistent returned before mutating in this branch.
      persistentConflict(type, amount, preview.conflict, preview.candidate);
      return;
    }
    if (!preview.ok) return;
    c.effects = before;
    c.conditions = conditionEffects(effectiveConditionEffects(before));
    combatTransaction('Add persistent damage', () => addPersistent(c, type, amount), historyContext);
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
    combatTransaction('Add condition', () => { addCondition(c, picked); }, historyContext);
    close();
  });
}

/** Read a condition before changing it; removal is deliberately a separate action. */
function openConditionDetail(combatant, condition) {
  const name = conditionName(condition);
  const record = conditionRecords.get(name);
  const text = record?.text || record?.notes || describe(condition);
  const body = `
    <div class="codex-text">${rich(text)}</div>
    ${record?.url ? `<a class="button-link" href="${esc(record.url)}" target="_blank" rel="noopener">Open on Archives of Nethys</a>` : ''}
    <div class="row wrap">
      <button class="ghost" data-set-expiry="start">Remind next start</button>
      <button class="ghost" data-set-expiry="end">Remind next end</button>
    </div>
    <button class="danger" data-remove-condition>Remove condition</button>`;
  const { node, close } = sheet(name, body, (sheetNode) => {
    on(sheetNode, 'click', '[data-set-expiry]', (e, el) => {
      combatTransaction('Set condition expiry reminder', () => {
        const effects = ensureEffects(combatant);
        const shown = effectiveConditionEffects(effects).find(effect =>
          (effect.raw || withConditionValue(effect.name, effect.value)) === condition);
        if (shown) {
          combatant.effects = effects.map(effect => effect.id === shown.id ? {
            ...effect,
            duration: { targetId: combatant.id, phase: el.dataset.setExpiry, remaining: 1, lastEvent: null, unresolved: false }
          } : effect);
          combatant.conditions = conditionEffects(effectiveConditionEffects(combatant.effects));
        }
      }, historyContext);
      close();
    });
    on(sheetNode, 'click', '[data-remove-condition]', () => {
      combatTransaction('Remove condition', () => {
        const effects = ensureEffects(combatant);
        const shown = effectiveConditionEffects(effects).find(effect =>
          (effect.raw || withConditionValue(effect.name, effect.value)) === condition);
        combatant.effects = shown ? removeConditionEffect(effects, shown.id) : effects;
        combatant.conditions = conditionEffects(effectiveConditionEffects(combatant.effects));
      }, historyContext);
      close();
    });
  });
  return node;
}
