// A compact, shared GM reference sheet. It reads records but never changes route or state.
import { state } from './store.js';
import { actions as loadActions, characters as loadCharacters } from './data.js';
import { actionIcons, adjustedDC, DC_DIFFICULTIES, degreeOfSuccess, DEGREES, skillList } from './pf2e.js';
import { esc, rich, sheet } from './dom.js';

const COMMON = ['Avoid Notice', 'Cover Tracks', 'Demoralize', 'Interact', 'Recall Knowledge',
  'Refocus', 'Search', 'Seek', 'Stride', 'Treat Wounds'];
let filed = [];

const signed = n => n >= 0 ? `+${n}` : String(n);

function allCharacters() { return [...filed, ...state.characters.extra]; }

function groupOptions(group) {
  const groups = [...new Map(allCharacters().map(c => [c.group || '__ungrouped', c.group || 'Un grouped'])).entries()];
  return groups.map(([id, label]) => `<option value="${esc(id)}" ${id === group ? 'selected' : ''}>${esc(label)}</option>`).join('');
}

function dcSection(level, difficulty, result, modifier) {
  const dc = adjustedDC(level, difficulty);
  const diff = DC_DIFFICULTIES.find(item => item.id === difficulty) || DC_DIFFICULTIES[3];
  const outcome = Number.isFinite(modifier) && Number.isFinite(result) && dc !== null
    ? `<div class="reference-outcome">${esc(signed(modifier))} + ${esc(result)} vs DC ${esc(dc)}: <b>${esc(DEGREES[degreeOfSuccess(modifier + result, dc)])}</b></div>` : '';
  return `<div class="reference-section"><h3>DCs</h3>
    <p class="muted">General reference only; use a specific spell, hazard, creature or activity DC when one applies.</p>
    <div class="reference-grid"><label>Level<select data-reference-level>${Array.from({ length: 26 }, (_, n) => `<option value="${n}" ${n === level ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>Difficulty<select data-reference-difficulty>${DC_DIFFICULTIES.map(item => `<option value="${item.id}" ${item.id === difficulty ? 'selected' : ''}>${esc(item.label)} (${item.adjustment >= 0 ? '+' : ''}${item.adjustment})</option>`).join('')}</select></label></div>
    <div class="reference-dc">Final DC <b>${dc ?? '—'}</b> <span class="muted">(${esc(diff.label)})</span></div>
    <details><summary>Check a result</summary><div class="reference-grid"><label>Modifier<input type="number" data-reference-modifier value="${Number.isFinite(modifier) ? modifier : ''}" placeholder="e.g. 12"></label><label>Die result<input type="number" data-reference-result value="${Number.isFinite(result) ? result : ''}" placeholder="1–20"></label></div>${outcome}</details>
  </div>`;
}

function actionsSection(records) {
  const rows = records.filter(r => COMMON.some(name => name.toLowerCase() === String(r.name || '').toLowerCase())).slice(0, 10);
  return `<div class="reference-section"><h3>Common actions</h3>${rows.length ? rows.map(r => `<details class="reference-action"><summary><span>${esc(r.name)}</span><b>${esc(actionIcons(r.actions || r.cost || ''))}</b></summary><div class="codex-text">${rich(r.text || r.notes || '')}</div>${r.url ? `<a class="button-link" href="${esc(r.url)}" target="_blank" rel="noopener">Open on Archives of Nethys</a>` : ''}</details>`).join('') : '<div class="muted">Action records are not available offline yet.</div>'}</div>`;
}

function skillsSection(group) {
  const chars = allCharacters().filter(c => group === '__all__' || (c.group || '__ungrouped') === group);
  return `<div class="reference-section"><h3>Party skills</h3><label>Group<select data-reference-group><option value="__all__" ${group === '__all__' ? 'selected' : ''}>All characters</option>${groupOptions(group)}</select></label>
    ${chars.length ? `<div class="reference-skills">${chars.map(c => `<div class="reference-character"><b>${esc(c.name || c.id)}</b><div class="reference-skill-grid">${skillList(c).map(skill => `<span>${esc(skill.name)} <b>${esc(signed(Number(skill.bonus) || 0))}</b></span>`).join('')}</div><small>Values come from the imported sheet. Armour check penalties are not applied; unknown bonuses remain unknown.</small></div>`).join('')}</div>` : '<div class="muted">No characters in this group. Device-only and missing records remain identifiable by ID in saved data.</div>'}</div>`;
}

export async function openGMReference() {
  const [actionRecords, characterFile] = await Promise.all([loadActions(), loadCharacters()]);
  filed = characterFile?.characters || [];
  let level = state.party.level;
  let difficulty = 'standard';
  let result = null;
  let modifier = null;
  let group = '__all__';
  const { node } = sheet('GM reference', '<div class="empty">Loading reference…</div>');
  const render = () => {
    if (!node.isConnected) return;
    node.querySelector('.sheet').innerHTML = `<div class="row spread"><h2>GM reference</h2><button class="icon ghost" data-close aria-label="Close">✕</button></div>${dcSection(level, difficulty, result, modifier)}${actionsSection(actionRecords || [])}${skillsSection(group)}`;
    node.querySelector('[data-reference-level]').addEventListener('change', e => { level = Number(e.target.value); render(); });
    node.querySelector('[data-reference-difficulty]').addEventListener('change', e => { difficulty = e.target.value; render(); });
    node.querySelector('[data-reference-group]').addEventListener('change', e => { group = e.target.value; render(); });
    node.querySelector('[data-reference-result]').addEventListener('input', e => { result = Number(e.target.value); render(); });
    node.querySelector('[data-reference-modifier]').addEventListener('input', e => { modifier = Number(e.target.value); render(); });
  };
  render();
}
