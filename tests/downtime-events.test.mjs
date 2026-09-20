import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDowntimeRecords,
  publishDowntimeRecord,
  publicDowntimeRecords,
  updateDowntimeRecord,
  withdrawDowntimeRecord
} from '../src/downtime-events.js';

const record = (overrides = {}) => ({
  id: 'earn-income', kind: 'activity', title: 'Earn Income',
  description: 'Work during downtime to earn money.', ...overrides
});

test('downtime records normalize deterministically and lifecycle revisions are stable', () => {
  const source = [
    record({ published: true, revision: 4, gmNotes: 'private' }),
    record({ id: 'duplicate', kind: 'opportunity', title: 'First', published: false }),
    record({ id: 'duplicate', kind: 'result', title: 'Second', published: true })
  ];
  assert.deepEqual(normalizeDowntimeRecords(source), normalizeDowntimeRecords(source));
  assert.deepEqual(normalizeDowntimeRecords(source).map(item => item.id), ['earn-income', 'duplicate']);

  const first = publishDowntimeRecord([], record({ id: 'craft', kind: 'activity' }));
  assert.equal(first.status, 'published');
  assert.equal(first.revision, 1);
  const unchanged = publishDowntimeRecord(first.state, record({ id: 'craft', kind: 'activity' }), 1);
  assert.equal(unchanged.status, 'unchanged');
  const updated = updateDowntimeRecord(first.state, record({ id: 'craft', kind: 'activity', text: 'Make an item.' }), 1);
  assert.equal(updated.status, 'updated');
  assert.equal(updated.revision, 2);
  const stale = updateDowntimeRecord(updated.state, record({ id: 'craft', title: 'Wrong' }), 1);
  assert.equal(stale.status, 'conflict');
  assert.equal(stale.actualRevision, 2);
  const result = publishDowntimeRecord([], record({ id: 'craft-result', kind: 'result', publicResultText: 'First result.' }));
  const resultUpdated = updateDowntimeRecord(result.state,
    record({ id: 'craft-result', kind: 'result', publicResultText: 'Updated result.' }), 1);
  assert.equal(resultUpdated.status, 'updated');
  assert.equal(resultUpdated.revision, 2);
  const withdrawn = withdrawDowntimeRecord(updated.state, 'craft', 2);
  assert.equal(withdrawn.status, 'withdrawn');
  assert.deepEqual(publicDowntimeRecords(withdrawn.state), []);
});

test('public downtime projection filters unpublished records and never promotes hidden outcomes', () => {
  const saved = normalizeDowntimeRecords([
    record({ id: 'private', published: false, dc: 30, gmNotes: 'secret', timer: 'hidden' }),
    record({
      id: 'opportunity-internal', publicId: 'opportunity-public', kind: 'opportunity',
      publicTitle: 'A chance to help', publicDescription: 'A neighbor needs a hand.',
      published: true, dc: 18, sourceId: 'source-private', mechanics: { secret: true },
      result: { text: 'Hidden unless revealed.', public: false }
    }),
    record({
      id: 'result', kind: 'result', title: 'Outcome', description: '', publicText: 'The work is complete.',
      publicResultText: 'The town remembers your help.', published: true,
      privateDC: 25, gmNotes: 'Do not show the critical outcome.'
    })
  ]);

  assert.deepEqual(publicDowntimeRecords(saved), [
    { id: 'opportunity-public', kind: 'opportunity', title: 'A chance to help',
      description: 'A neighbor needs a hand.', revision: 0 },
    { id: 'result', kind: 'result', title: 'Outcome', text: 'The work is complete.',
      resultText: 'The town remembers your help.', revision: 0 }
  ]);
  const serialized = JSON.stringify(publicDowntimeRecords(saved));
  for (const secret of ['opportunity-internal', 'source-private', '30', '18', '25', 'secret', 'Hidden unless revealed']) {
    assert.equal(serialized.includes(secret), false, `leaked ${secret}`);
  }
});
