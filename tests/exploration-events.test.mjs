import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeExplorationEvents,
  publishExplorationEvent,
  publicExplorationEvents,
  updateExplorationEvent,
  withdrawExplorationEvent
} from '../src/exploration-events.js';

const event = (overrides = {}) => ({ id: 'ruins', kind: 'location', title: 'The Sunken Ruins',
  description: 'A stairway descends beneath the old road.', ...overrides });

test('exploration events publish, update, withdraw, and reject stale revisions', () => {
  const first = publishExplorationEvent([], event());
  assert.equal(first.status, 'published');
  assert.equal(first.revision, 1);

  const updated = updateExplorationEvent(first.state, event({ description: 'A sealed stairway descends beneath the old road.' }), 1);
  assert.equal(updated.status, 'updated');
  assert.equal(updated.revision, 2);

  const stale = updateExplorationEvent(updated.state, event({ title: 'Wrong' }), 1);
  assert.equal(stale.ok, false);
  assert.equal(stale.status, 'conflict');
  assert.equal(stale.actualRevision, 2);

  const withdrawn = withdrawExplorationEvent(updated.state, 'ruins', 2);
  assert.equal(withdrawn.status, 'withdrawn');
  assert.equal(withdrawn.revision, 3);
  assert.deepEqual(publicExplorationEvents(withdrawn.state), []);
});

test('normalization and public projection strip GM-only fields and unpublished events', () => {
  const saved = normalizeExplorationEvents([
    event({ id: 'secret', published: false, sourceId: 'gm-source', gmNotes: 'private' }),
    event({ id: 'public', kind: 'discovery', published: true, revision: 4, sourceId: 'gm-source' })
  ]);
  assert.equal(JSON.stringify(publicExplorationEvents(saved)).includes('gm-source'), false);
  assert.deepEqual(publicExplorationEvents(saved), [{ id: 'public', kind: 'discovery',
    title: 'The Sunken Ruins', description: 'A stairway descends beneath the old road.', revision: 4 }]);
  assert.equal(JSON.stringify(publicExplorationEvents(saved)).includes('secret'), false);
});
