import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDowntimeArchive, downtimeArchiveKey, downtimeOperationId, upsertDowntimeArchive, advanceDowntimeMonth, buildDowntimeChoice } from '../src/downtime-history.js';
import { downtimeMarkup } from '../src/views/downtime-gm.js';
import { normalizeState } from '../src/store.js';

const characters = [{ id: 'hero-1', name: 'Kesta' }, { id: 'hero-2', name: 'Orin' }];
const workflow = { revision: 5, month: 7, characters: [
  { characterId: 'hero-1', playerName: 'Morgan', downtime: { activityId: 'other', activityName: 'Restore the shrine', notes: 'Bring silverleaf.' } },
  { characterId: 'hero-2', playerName: 'Lee', downtime: null }
] };

function fakeClient({ initial = workflow, advance, afterFailure = initial } = {}) {
  let current = initial;
  const calls = [];
  return { calls, getWorkflow: async id => { calls.push(['read', id]); return { state: 'ok', data: { workflow: current } }; },
    advanceMonth: async (id, month, operationId) => { calls.push(['advance', id, month, operationId]);
      const result = advance ? await advance(id, month, operationId, calls) : { state: 'ok', data: { workflow: { ...current, month: month + 1, revision: current.revision + 1, characters: current.characters.map(row => ({ ...row, downtime: null })) } } };
      if (result.state === 'ok') current = result.data.workflow;
      else current = afterFailure;
      return result;
    } };
}

test('archive keeps readable month, timestamp, character activities and notes with campaign-specific deterministic keys', () => {
  const archive = buildDowntimeArchive({ campaignId: 'mists/a', month: 7, characters, workflow, timestamp: '2026-10-05T21:00:00.000Z' });
  assert.equal(archive.archive.key, downtimeArchiveKey('mists/a', 7));
  assert.equal(archive.archive.timestamp, '2026-10-05T21:00:00.000Z');
  assert.match(archive.body, /Downtime month 7/);
  assert.match(archive.body, /Kesta[\s\S]*Restore the shrine[\s\S]*Bring silverleaf\./);
  assert.match(archive.body, /Orin[\s\S]*No activity selected/);
  assert.notEqual(downtimeArchiveKey('mists/a', 7), downtimeArchiveKey('other', 7));
  const notes = { entries: [{ id: 'old', title: 'Existing note' }] };
  const first = upsertDowntimeArchive(notes, archive);
  const retry = upsertDowntimeArchive(first, archive);
  assert.equal(first.entries.length, 2);
  assert.equal(retry.entries.length, 2);
  assert.equal(retry.entries[1].archive.key, archive.archive.key);
  const reloaded = normalizeState(JSON.parse(JSON.stringify({ notes: retry })));
  assert.deepEqual(reloaded.notes.entries.find(note => note.archive?.key === archive.archive.key), archive);
});

test('dashboard shows current period, populated and missing selections, editable custom text and notes', () => {
  const html = downtimeMarkup({ campaignId: 'mists', characters, workflow });
  assert.match(html, /Downtime month 7/);
  assert.match(html, /Morgan/);
  assert.match(html, /Restore the shrine/);
  assert.match(html, /No activity selected/);
  assert.match(html, /Bring silverleaf\./);
  assert.match(html, /data-save-choice="hero-1"/);
  assert.match(html, /data-clear-choice="hero-1"/);
  assert.match(html, /data-next-month/);
  assert.match(html, /data-current-id="other"/);
});

test('GM edits preserve unchanged custom activity text and clear removes the full selection', () => {
  const current = { activityId: 'other', activityName: 'Restore the shrine', notes: 'Old note' };
  assert.deepEqual(buildDowntimeChoice(current, 'Restore the shrine', 'New note'), { activityId: 'other', activityName: 'Restore the shrine', notes: 'New note' });
  assert.deepEqual(buildDowntimeChoice(current, 'Research the curse', 'In the archive'), { activityId: 'other', activityName: 'Research the curse', notes: 'In the archive' });
  assert.equal(buildDowntimeChoice(current, '', 'ignored'), null);
});

test('archive persistence failure leaves canonical choices and never calls advance', async () => {
  const client = fakeClient(); let archived = 0;
  const result = await advanceDowntimeMonth({ campaignId: 'mists', client, characters, notes: { entries: [] }, saveArchive: async () => { archived += 1; return false; } });
  assert.equal(result.state, 'archive-failed');
  assert.equal(archived, 1);
  assert.equal(client.calls.some(call => call[0] === 'advance'), false);
});

test('post-archive advance failure retries with the same archive key and operation id', async () => {
  const ids = [], saved = [];
  const client = fakeClient({ advance: async (_id, _month, operationId) => { ids.push(operationId); return ids.length === 1 ? { state: 'unreachable' } : { state: 'ok', data: { workflow: { ...workflow, month: 8, revision: 6, characters: workflow.characters.map(row => ({ ...row, downtime: null })) } } }; } });
  const doAdvance = () => advanceDowntimeMonth({ campaignId: 'mists', client, characters, notes: { entries: saved }, saveArchive: async archive => { saved.splice(0, saved.length, ...upsertDowntimeArchive({ entries: saved }, archive).entries); return true; }, clock: () => '2026-10-05T21:00:00.000Z' });
  assert.equal((await doAdvance()).state, 'advance-failed');
  assert.equal((await doAdvance()).state, 'advanced');
  assert.deepEqual(ids, [downtimeOperationId('mists', 7), downtimeOperationId('mists', 7)]);
  assert.equal(saved.length, 1);
});

test('duplicate requests share one advance and a lost response reconciles the increment', async () => {
  let release; let advances = 0; let reads = 0;
  const next = { ...workflow, month: 8, revision: 6, advances: [{ operationId: downtimeOperationId('mists', 7) }], characters: workflow.characters.map(row => ({ ...row, downtime: null })) };
  const client = { getWorkflow: async () => ({ state: 'ok', data: { workflow: ++reads > 1 ? next : workflow } }),
    advanceMonth: async () => { advances += 1; await new Promise(resolve => { release = resolve; }); return { state: 'unreachable' }; } };
  let saves = 0;
  const args = { campaignId: 'mists', client, characters, notes: { entries: [] }, saveArchive: async () => { saves += 1; return true; } };
  const a = advanceDowntimeMonth(args); const b = advanceDowntimeMonth(args);
  await new Promise(resolve => setTimeout(resolve, 0)); release();
  const [first, second] = await Promise.all([a, b]);
  assert.equal(advances, 1); assert.equal(saves, 1);
  assert.equal(first.state, 'advanced'); assert.equal(second.state, 'advanced');
  assert.equal(first.workflow.characters.every(row => row.downtime === null), true);
});

test('retry sees the completed operation and does not increment again', async () => {
  const client = fakeClient({ initial: { ...workflow, month: 8, advances: [{ operationId: downtimeOperationId('mists', 7) }] } });
  let saves = 0;
  const result = await advanceDowntimeMonth({ campaignId: 'mists', client, characters, notes: { entries: [] }, previousOperation: { campaignId: 'mists', month: 7, operationId: downtimeOperationId('mists', 7) }, saveArchive: async () => { saves += 1; return true; } });
  assert.equal(result.state, 'already-advanced');
  assert.equal(saves, 0);
  assert.equal(client.calls.some(call => call[0] === 'advance'), false);
});
