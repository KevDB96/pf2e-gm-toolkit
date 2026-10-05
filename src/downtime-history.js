// Readable, campaign-scoped snapshots of canonical PFPC downtime months.
export function downtimeArchiveKey(campaignId, month) {
  if (typeof campaignId !== 'string' || !campaignId.trim() || !Number.isInteger(month) || month < 0) {
    throw new TypeError('Invalid downtime archive identity');
  }
  return `downtime-history:${encodeURIComponent(campaignId)}:${month}`;
}

export function downtimeOperationId(campaignId, month) {
  return `advance-month:${encodeURIComponent(campaignId)}:${month}`;
}

export function buildDowntimeArchive({ campaignId, month, characters, workflow, timestamp }) {
  const key = downtimeArchiveKey(campaignId, month);
  const entries = (characters || []).map(character => {
    const row = workflow?.characters?.find(item => item.characterId === character.id);
    const activity = row?.downtime;
    return { characterId: character.id, characterName: character.name || 'Unnamed character',
      activityId: activity?.activityId || null, activity: activity?.activityName || '', notes: activity?.notes || '' };
  });
  const period = `Downtime month ${month}`;
  const body = [period, ...entries.map(entry => `\n${entry.characterName}\nActivity: ${entry.activity || 'No activity selected'}${entry.notes ? `\nNotes: ${entry.notes}` : ''}`)].join('\n');
  return { id: key, title: period, body, at: timestamp, category: 'downtime-history',
    archive: { key, campaignId, month, timestamp, period, entries } };
}

export function upsertDowntimeArchive(notes, archive) {
  const entries = Array.isArray(notes?.entries) ? notes.entries : [];
  const index = entries.findIndex(note => note?.category === 'downtime-history' && note.archive?.key === archive.archive.key);
  if (index < 0) return { ...notes, entries: [...entries, archive], inserted: true };
  const next = entries.slice();
  next[index] = { ...next[index], ...archive };
  return { ...notes, entries: next, inserted: false };
}

export function buildDowntimeChoice(existing, activityName, notes) {
  const name = String(activityName ?? '').trim();
  if (!name) return null;
  const preserveId = existing?.activityId && existing.activityName === name;
  return { activityId: preserveId ? existing.activityId : 'other', activityName: name, notes: String(notes ?? '') };
}

export function archiveSaved(persistence) {
  return persistence?.kind === 'saved';
}

const activeAdvances = new Map();

/** Save the canonical archive before requesting PFPC's idempotent month advance. */
export function advanceDowntimeMonth({ campaignId, client, characters, notes, saveArchive, clock = () => new Date().toISOString(), previousOperation = null, onOperation = () => {} }) {
  const lockKey = campaignId;
  if (activeAdvances.has(lockKey)) return activeAdvances.get(lockKey);
  const task = (async () => {
    const read = await client.getWorkflow(campaignId, { retries: 1 });
    if (read.state !== 'ok') return { state: 'read-failed', reason: read.state };
    const workflow = read.data.workflow || read.data;
    const month = workflow.month;
    if (!Number.isInteger(month)) return { state: 'invalid-month', workflow };
    if (previousOperation?.campaignId === campaignId && Number.isInteger(previousOperation.month) && month > previousOperation.month) {
      const completed = Array.isArray(workflow.advances) && workflow.advances.some(item => item?.operationId === previousOperation.operationId);
      if (completed || month > previousOperation.month) return { state: 'already-advanced', workflow, operationId: previousOperation.operationId };
    }
    const operationId = downtimeOperationId(campaignId, month);
    if (Array.isArray(workflow.advances) && workflow.advances.some(item => item?.operationId === operationId)) {
      return { state: 'already-advanced', workflow };
    }
    const key = downtimeArchiveKey(campaignId, month);
    const existing = notes.entries.find(note => note?.category === 'downtime-history' && note.archive?.key === key);
    const archive = existing || buildDowntimeArchive({ campaignId, month, characters, workflow, timestamp: clock() });
    if (!await saveArchive(archive)) return { state: 'archive-failed', workflow };
    onOperation({ campaignId, month, operationId });
    const result = await client.advanceMonth(campaignId, month, operationId);
    if (result.state === 'ok') return { state: 'advanced', workflow: result.data.workflow || result.data, operationId, archive };
    const latest = await client.getWorkflow(campaignId, { retries: 1 });
    if (latest.state === 'ok') {
      const updated = latest.data.workflow || latest.data;
      const confirmed = Array.isArray(updated.advances) && updated.advances.some(item => item?.operationId === operationId);
      if (confirmed || updated.month > month) return { state: 'advanced', workflow: updated, operationId, archive, reconciled: true };
    }
    return { state: 'advance-failed', reason: result.state, workflow, operationId, archive };
  })();
  activeAdvances.set(lockKey, task);
  return task.finally(() => { if (activeAdvances.get(lockKey) === task) activeAdvances.delete(lockKey); });
}
