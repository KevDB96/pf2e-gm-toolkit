// Detail sheets opened from Combat. They take explicit records and never change route,
// Library filters, recents, or the source record they display.

import { state, save } from './store.js';
import { combatTransaction } from './combat-history.js';
import { characters, creatures, hazards } from './data.js';
import { caps, esc, on, qs, qsa, sheet } from './dom.js';
import { adjustHP, adjustedCreatureProjection, adjustmentDelta } from './pf2e.js';

const signed = value => Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${value}` : '—';
const row = (label, value) => value === null || value === undefined || value === '' ? ''
  : `<div class="share"><span class="muted">${esc(label)}</span><b>${esc(value)}</b></div>`;
const modifierList = values => values && typeof values === 'object'
  ? Object.entries(values).map(([key, value]) => `${caps(key)} ${signed(value)}`).join(' · ') : null;

function attackRows(list) {
  return (list || []).map(item => {
    const left = item.bonus === undefined ? caps(item.name) : `${caps(item.name)} ${signed(item.bonus)}`;
    const damage = item.damage || (item.dc ? `DC ${item.dc}${item.save ? ` ${caps(item.save)}` : ''}` : '—');
    const note = item.damageAdjustment ? ` · damage ${item.damageAdjustment > 0 ? '+' : ''}${item.damageAdjustment}` : '';
    return `<div class="share"><span class="muted">${esc(left)}</span><b>${esc(damage + note)}</b></div>`;
  }).join('');
}

function hpEntry(combatant) {
  if (combatant.maxHp === null || !Number.isSafeInteger(combatant.maxHp)) {
    return '<div class="hp-entry muted">Numeric damage/healing is unavailable because this combatant has no tracked maximum HP.</div>';
  }
  return `<div class="hp-entry" data-hp-entry>
    <h2>Damage / healing</h2>
    <p class="muted">Enter damage after the GM has handled defenses. This does not model temporary HP or shields.</p>
    <div class="row wrap"><label class="field hp-entry-amount">Amount<input data-hp-amount type="number" inputmode="numeric" min="0" step="1" placeholder="0"></label>
      <div class="picker" role="group" aria-label="Damage or healing"><button class="pick on" data-hp-mode="damage">Damage</button><button class="pick" data-hp-mode="healing">Healing</button></div></div>
    <div class="hp-entry-preview muted" data-hp-preview>Enter a whole number to preview.</div>
    <button class="primary" data-hp-apply disabled>Apply damage</button>
  </div>`;
}

function wireHPEntry(node, combatant) {
  const entry = qs('[data-hp-entry]', node);
  if (!entry) return;
  let mode = 'damage';
  let applied = false;
  const amount = qs('[data-hp-amount]', entry);
  const preview = qs('[data-hp-preview]', entry);
  const apply = qs('[data-hp-apply]', entry);
  const update = () => {
    const live = state.combat.combatants.find(item => item.id === combatant.id);
    if (!live) { preview.textContent = 'This combatant is no longer available.'; apply.disabled = true; return; }
    const raw = amount.value.trim();
    const value = /^\d+$/.test(raw) ? Number(raw) : null;
    const result = adjustHP(live.hp, live.maxHp, value, mode);
    if (!result) { preview.textContent = 'Enter a nonnegative whole number.'; apply.disabled = true; return; }
    preview.textContent = `${mode === 'damage' ? 'Damage' : 'Healing'}: HP ${result.before} → ${result.after}`;
    apply.textContent = `Apply ${mode}`;
    apply.disabled = applied;
  };
  on(entry, 'click', '[data-hp-mode]', (event, button) => {
    mode = button.dataset.hpMode;
    qsa('[data-hp-mode]', entry).forEach(item => item.classList.toggle('on', item === button));
    update();
  });
  on(entry, 'input', '[data-hp-amount]', update);
  on(entry, 'click', '[data-hp-apply]', () => {
    if (applied) return;
    const live = state.combat.combatants.find(item => item.id === combatant.id);
    const value = /^\d+$/.test(amount.value.trim()) ? Number(amount.value.trim()) : null;
    const result = adjustHP(live?.hp, live?.maxHp, value, mode);
    if (!live || !result) { update(); return; }
    applied = true;
    apply.disabled = true;
    combatTransaction(`Apply ${mode}`, combat => {
      const target = combat.combatants.find(item => item.id === combatant.id);
      if (target) target.hp = adjustHP(target.hp, target.maxHp, value, mode)?.after ?? target.hp;
    });
    preview.textContent = `${mode === 'damage' ? 'Damage' : 'Healing'} applied: HP ${result.before} → ${result.after}`;
  });
}

/** Reusable record renderer: explicit record in, non-navigating sheet out. */
export function openRecordSheet(record, { adjust = null, baseLevel = record?.level, title = record?.name, combatant = null } = {}) {
  const projected = adjustedCreatureProjection(record, adjust, baseLevel);
  const adjustment = adjustmentDelta(adjust);
  const body = `
    <div class="muted">Creature · level ${esc(projected.level)}${adjustment ? ` · ${esc(caps(adjust))}` : ''}</div>
    <div class="card">
      ${row('AC', projected.ac)}${row('HP', projected.hp)}
      ${row('Perception', signed(projected.perception))}${row('Saves', modifierList(projected.saves))}
      ${row('Skills', modifierList(projected.skills))}${row('Spell DC', projected.spellDC)}
    </div>
    ${combatant ? hpEntry(combatant) : ''}
    ${(projected.strikes || []).length ? `<div class="card"><h2>Strikes</h2>${attackRows(projected.strikes)}</div>` : ''}
    ${(projected.specials || []).length ? `<div class="card"><h2>Abilities</h2>${attackRows(projected.specials)}</div>` : ''}
    ${adjustment ? `<div class="muted">Elite/Weak applies ${adjustment > 0 ? '+' : ''}${adjustment} to attacks, DCs, saves, Perception, skills, and damage. Damage is annotated; limited-use abilities may instead need a GM-applied ±4 adjustment.</div>` : ''}
    ${record.url ? `<a class="button-link" href="${esc(record.url)}" target="_blank" rel="noopener">Open on Archives of Nethys</a>` : ''}`;
  const result = sheet(title, body);
  if (combatant) wireHPEntry(result.node, combatant);
  return result;
}

/** Reusable character renderer for a resolved explicit character record. */
export function openCharacterSheet(character, combatant = null) {
  const saves = character.saves || {};
  const body = `
    <div class="muted">${esc([character.class && `${character.class} ${character.level}`, character.player && `played by ${character.player}`].filter(Boolean).join(' · '))}</div>
    <div class="card">
      ${row('AC', character.ac)}${row('HP', character.hp)}${row('Perception', signed(character.perception))}
      ${row('Fortitude', signed(saves.fort))}${row('Reflex', signed(saves.ref))}${row('Will', signed(saves.will))}
      ${row('Speed', character.speed ? `${character.speed} feet` : null)}${row('Class DC', character.classDC)}
    </div>${combatant ? hpEntry(combatant) : ''}`;
  const result = sheet(character.name, body);
  if (combatant) wireHPEntry(result.node, combatant);
  return result;
}

function localSheet(combatant, reason) {
  if (combatant.isHazard) return localHazardSheet(combatant, reason);
  const body = `
    <div class="muted">${esc(reason)}</div>
    <div class="card">
      ${row('Initiative', combatant.init)}${row('AC', combatant.ac)}
      ${row('HP', combatant.maxHp === null ? null : `${combatant.hp}/${combatant.maxHp}`)}
      ${row('Perception', signed(combatant.initMod))}${row('Conditions', (combatant.conditions || []).join(', ') || '—')}
    </div>${hpEntry(combatant)}
    <label class="field">GM notes<textarea data-combat-notes rows="3">${esc(combatant.notes || '')}</textarea></label>`;
  const { node } = sheet(combatant.name, body);
  wireHPEntry(node, combatant);
  on(node, 'change', '[data-combat-notes]', (event, el) => {
    const live = state.combat.combatants.find(item => item.id === combatant.id);
    if (live) { live.notes = el.value; save(); }
  });
}

function localHazardSheet(combatant, reason) {
  const hazard = combatant.hazard || {};
  const saves = combatant.saves || {};
  const body = `
    <div class="muted">${esc(reason)}</div>
    <div class="card">
      ${row('Initiative (Stealth)', signed(combatant.initMod))}${row('AC', combatant.ac)}
      ${row('HP', combatant.maxHp === null ? null : `${combatant.hp}/${combatant.maxHp}`)}${row('Hardness', combatant.hardness)}
      ${row('Broken threshold', combatant.brokenThreshold)}${row('Fortitude', signed(saves.fort))}${row('Reflex', signed(saves.ref))}${row('Will', signed(saves.will))}
    </div>${hpEntry(combatant)}
    ${row('Trigger', hazard.trigger)}${row('Routine', hazard.routine)}${row('Disable', hazard.disable)}${row('Reset', hazard.reset)}
    <div class="row wrap"><button class="ghost" data-hazard-trigger>${hazard.triggered ? 'Triggered' : 'Mark triggered'}</button>
      <button class="ghost" data-hazard-disabled>${hazard.disabled ? 'Disabled' : 'Mark disabled'}</button></div>
    <label class="field">Disable progress <input data-hazard-progress type="number" inputmode="numeric" min="0" value="${hazard.progress || 0}"></label>`;
  const { node } = sheet(combatant.name, body);
  wireHPEntry(node, combatant);
  const change = mutate => combatTransaction('Update hazard', combat => {
    const live = combat.combatants.find(item => item.id === combatant.id);
    if (!live) return;
    live.hazard = { ...(live.hazard || {}), ...mutate(live.hazard || {}) };
  });
  on(node, 'click', '[data-hazard-trigger]', () => change(h => ({ triggered: !h.triggered })));
  on(node, 'click', '[data-hazard-disabled]', () => change(h => ({ disabled: !h.disabled })));
  on(node, 'change', '[data-hazard-progress]', (event, el) => {
    const progress = Math.max(0, Math.round(Number(el.value) || 0));
    change(() => ({ progress }));
  });
}

/** Resolve typed references first; an old row may only fall back on an exact unique name. */
export async function openCombatantSheet(combatant) {
  const ref = combatant.ref;
  if (ref) {
    if (ref.kind === 'creature' && typeof ref.id === 'string') {
      const matches = (await creatures()).filter(record => record.id === ref.id);
      if (matches.length === 1) return openRecordSheet(matches[0], {
        adjust: combatant.adjust, baseLevel: combatant.baseLevel ?? matches[0].level, combatant
      });
      return localSheet(combatant, 'The referenced creature is unavailable. These are the combat values currently known.');
    }
    if (ref.kind === 'character' && typeof ref.id === 'string') {
      const file = await characters();
      const matches = [...(file?.characters || []), ...state.characters.extra].filter(record => record.id === ref.id);
      if (matches.length === 1) return openCharacterSheet(matches[0], combatant);
      return localSheet(combatant, 'The referenced character is unavailable. These are the combat values currently known.');
    }
    if (ref.kind === 'hazard' && typeof ref.id === 'string') {
      const matches = (await hazards()).filter(record => record.id === ref.id);
      if (matches.length === 1) return localHazardSheet(combatant, 'Complex hazard · use its recorded routine on its turn.');
      return localHazardSheet(combatant, 'The referenced hazard is unavailable. These are the combat values currently known.');
    }
    return localSheet(combatant, 'This combatant has an invalid saved reference. No identity was guessed.');
  }

  if (combatant.isPC) {
    const file = await characters();
    const matches = [...(file?.characters || []), ...state.characters.extra].filter(record => record.name === combatant.name);
    return matches.length === 1 ? openCharacterSheet(matches[0], combatant)
      : localSheet(combatant, 'This legacy character could not be matched uniquely.');
  }
  const matches = (await creatures()).filter(record => record.name === combatant.name);
  return matches.length === 1 ? openRecordSheet(matches[0], { adjust: null, combatant })
    : localSheet(combatant, 'This manual or legacy creature could not be matched uniquely.');
}
