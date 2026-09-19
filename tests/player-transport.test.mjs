import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptPlayerSnapshot,
  createPlayerSnapshot,
  isPlayerSnapshot
} from '../src/player-transport.js';

function projection(revision, phase = 'downtime') {
  return {
    contract: 'pf2e-companion/public-campaign-session', version: 1, revision,
    campaign: { title: '' },
    session: { phase, round: 0, encounter: { title: '', status: 'planned' },
      characters: [], creatures: [], notes: [], events: [], actors: [] }
  };
}

test('live and snapshot deliveries share monotonic revision acceptance', () => {
  const first = createPlayerSnapshot(projection(7, 'exploration'));
  const stale = createPlayerSnapshot(projection(6, 'combat'));
  const duplicate = createPlayerSnapshot(projection(7, 'combat'));
  const next = createPlayerSnapshot(projection(8, 'combat'));
  assert.equal(isPlayerSnapshot(first), true);
  assert.equal(acceptPlayerSnapshot(null, first), first);
  assert.equal(acceptPlayerSnapshot(first, stale), first);
  assert.equal(acceptPlayerSnapshot(first, duplicate), first);
  assert.equal(acceptPlayerSnapshot(first, next), next);
});

test('invalid or unversioned payloads cannot enter the player state', () => {
  const current = createPlayerSnapshot(projection(2));
  for (const incoming of [
    { kind: 'snapshot', projection: projection(99) },
    { ...current, version: 2 },
    { ...current, projection: { ...current.projection, session: { ...current.projection.session, hp: 3 } } }
  ]) {
    assert.equal(isPlayerSnapshot(incoming), false);
    assert.equal(acceptPlayerSnapshot(current, incoming), current);
  }
});
