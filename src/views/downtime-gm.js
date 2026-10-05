import { createPfpcClient } from '../pfpc-control.js';
import { state, save, persistenceStatus } from '../store.js';
import { companionCharactersForCampaign } from '../companion-rosters.js';
import { esc, on } from '../dom.js';
import { downtimeOperationId, upsertDowntimeArchive, archiveSaved, advanceDowntimeMonth, buildDowntimeChoice } from '../downtime-history.js';

const e = value => esc(String(value ?? ''));
const campaignIds = () => Object.keys(state.companion.assignments || {});

export function downtimeMarkup({ campaignId, characters, workflow, status = '', busy = false }) {
  const records = new Map((workflow?.characters || []).map(row => [row.characterId, row]));
  const rows = characters.map(character => {
    const row = records.get(character.id);
    const choice = row?.downtime;
    const name = choice?.activityName || '';
    const notes = choice?.notes || '';
    return `<article class="gm-exploration-character"><details><summary><span><b>${e(character.name)}</b><small>${e(row?.playerName || row?.displayName || character.playerName || 'Player not set')}</small></span><strong class="${choice ? '' : 'missing'}">${choice ? e(name || 'Custom activity') : 'No activity selected'}</strong></summary><div class="gm-activity-control"><label>Activity<input type="text" data-activity-name="${e(character.id)}" data-current-id="${e(choice?.activityId || '')}" value="${e(name)}" placeholder="Choose or enter an activity"></label><label>Notes<textarea data-activity-notes="${e(character.id)}" rows="3">${e(notes)}</textarea></label><div class="downtime-actions"><button type="button" data-save-choice="${e(character.id)}" ${busy ? 'disabled' : ''}>Save activity</button><button class="ghost" type="button" data-clear-choice="${e(character.id)}" ${busy || !choice ? 'disabled' : ''}>Clear</button></div></div></details></article>`;
  }).join('');
  const history = state.notes.entries.filter(note => note?.category === 'downtime-history' && note.archive?.campaignId === campaignId)
    .sort((a, b) => b.archive.month - a.archive.month).map(note => `<details class="downtime-archive"><summary>${e(note.archive.period)} · ${e(new Date(note.archive.timestamp).toLocaleString())}</summary><pre>${e(note.body)}</pre></details>`).join('');
  const month = Number.isInteger(workflow?.month) ? workflow.month : null;
  const opId = month === null ? '' : downtimeOperationId(campaignId, month);
  return `<section class="gm-exploration gm-downtime" data-campaign="${e(campaignId)}"><header><h2>Downtime</h2><label>Campaign <select data-campaign>${campaignIds().map(id => `<option value="${e(id)}" ${id === campaignId ? 'selected' : ''}>${e(id)}</option>`).join('')}</select></label></header><p class="gm-sync" role="status">${e(status || 'Connected state loaded')}</p>${month === null ? '<p class="empty">Downtime month unavailable.</p>' : `<section class="downtime-period"><h3>Downtime month ${month}</h3><button type="button" data-next-month data-operation="${e(opId)}" ${busy || !workflow ? 'disabled' : ''}>${busy ? 'Advancing…' : 'Archive and start next month'}</button></section>`}<div class="gm-activity-list">${characters.length ? rows : '<p class="empty">No active player characters linked to this campaign.</p>'}</div><section class="downtime-history"><h3>Downtime history</h3>${history || '<p class="empty">No archived months.</p>'}</section></section>`;
}

export function bindDowntime(root, { client = createPfpcClient(), campaignId = () => campaignIds()[0] || '', clock = () => new Date().toISOString() } = {}) {
  let currentCampaign = '', workflow = null, status = '', busy = false, request = null;
  const draw = () => { root.innerHTML = currentCampaign ? downtimeMarkup({ campaignId: currentCampaign, characters: companionCharactersForCampaign(state.companion, currentCampaign), workflow, status, busy }) : '<section class="gm-exploration gm-downtime"><h2>Downtime</h2><p class="empty">Link player characters to a campaign in Party.</p></section>'; };
  async function refresh(id = currentCampaign) {
    currentCampaign = id;
    if (!id) { workflow = null; draw(); return null; }
    const result = await client.getWorkflow(id, { retries: 1 });
    if (result.state === 'ok') { workflow = result.data.workflow || result.data; status = 'Connected state loaded'; }
    else { workflow = null; status = `Downtime unavailable: ${result.state}`; }
    draw(); return result;
  }
  async function advance() {
    if (busy || !currentCampaign) return;
    busy = true; status = 'Reading current downtime month…'; draw();
    const result = await advanceDowntimeMonth({ campaignId: currentCampaign, client,
      characters: companionCharactersForCampaign(state.companion, currentCampaign), notes: state.notes, clock,
      previousOperation: request,
      onOperation: operation => { request = operation; },
      saveArchive: archive => { state.notes = upsertDowntimeArchive(state.notes, archive); save(); return archiveSaved(persistenceStatus()); } });
    if (result.workflow) workflow = result.workflow;
    if (result.state === 'advanced') { request = null; status = `Downtime month ${workflow.month} started`; }
    else if (result.state === 'already-advanced') { request = null; status = 'Month already advanced'; }
    else if (result.state === 'archive-failed') status = 'Archive could not be saved. The month was not advanced.';
    else if (result.state === 'read-failed') status = `Could not read downtime: ${result.reason}`;
    else if (result.state === 'invalid-month') status = 'Downtime month unavailable';
    else status = `Archive saved. Advance failed: ${result.reason}. Retry to continue.`;
    busy = false; draw();
  }
  on(root, 'change', async (_event, el) => {
    if (!el.matches('[data-campaign]')) return;
    request = null; workflow = null; await refresh(el.value);
  });
  on(root, 'click', async (_event, el) => {
    if (el.matches('[data-next-month]')) { await advance(); return; }
    const id = el.dataset.saveChoice || el.dataset.clearChoice;
    if (!id || busy || !workflow) return;
    const existing = workflow.characters.find(row => row.characterId === id)?.downtime;
    const input = root.querySelector(`[data-activity-name="${CSS.escape(id)}"]`);
    const notes = root.querySelector(`[data-activity-notes="${CSS.escape(id)}"]`)?.value || '';
    const choice = el.dataset.clearChoice ? null : buildDowntimeChoice(existing, input?.value, notes);
    if (!choice && !el.dataset.clearChoice) { status = 'Enter an activity name or clear the selection.'; draw(); return; }
    busy = true; draw();
    const result = await client.setDowntime(currentCampaign, workflow.revision, id, choice);
    if (result.state === 'ok') { workflow = result.data.workflow || result.data; status = 'Activity updated'; }
    else { status = result.state === 'conflict' ? 'Activity changed elsewhere. Reloading latest state…' : `Activity update failed: ${result.state}`; }
    busy = false;
    if (result.state === 'conflict') await refresh(); else draw();
  });
  currentCampaign = campaignId();
  draw(); void refresh(currentCampaign);
}

export function mount(root) { bindDowntime(root); }
export function update() {}
