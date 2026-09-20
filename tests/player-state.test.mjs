import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptPlayerSnapshot,
  createPlayerRequest,
  createPlayerSnapshot,
  isPlayerSnapshot,
  isPlayerRequest,
  normalizePlayer,
  projectPlayerState
} from '../src/player-state.js';

test('player projection is an allowlisted public snapshot', () => {
  const snapshot = projectPlayerState({ round: 3, activeId: 'b', order: ['b', 'a'], combatants: [
    { id: 'a', name: 'Goblin', hp: 2, ac: 15, init: 12, notes: 'secret' },
    { id: 'b', name: 'Goblin', hp: 20, ac: 18, source: { id: 'secret' }, init: 18 }
  ] }, { entries: {
    a: { token: 'p-a', revealed: true, name: 'Goblin A' },
    b: { token: 'p-b', revealed: false, name: 'Goblin B' }
  } });
  assert.deepEqual(snapshot, {
    version: 2,
    revision: 0,
    phase: 'downtime',
    round: 3,
    currentTurnId: null,
    encounter: { title: '', status: 'planned' },
    recap: { version: 1, status: 'empty', revision: 0, title: '', body: '' },
    characters: [],
    creatures: [],
    notes: [],
    events: [],
    actors: [{ id: 'p-a', name: 'Goblin A', active: false, order: 1 }]
  });
  assert.equal(JSON.stringify(snapshot).includes('hp'), false);
  assert.equal(JSON.stringify(snapshot).includes('secret'), false);
});

test('player settings normalize to safe sparse entries', () => {
  assert.deepEqual(normalizePlayer({ entries: { a: { revealed: true, name: 4 }, bad: null, '__proto__': { revealed: true } } }), {
    entries: { a: { token: '', revealed: true, name: '', conditions: false } }
  });
  assert.equal(normalizePlayer({ entries: { a: { revealConditions: true } } }).entries.a.conditions, true);
});

test('fresh public snapshots expose only explicitly enabled condition/status labels and reflect removal', () => {
  const combatant = {
    id: 'wolf-internal', isPC: false, publicVisibility: 'public', publicId: 'wolf-public',
    publicName: 'Ash Wolf', publicStatus: ['Marked'], conditions: ['Frightened 2'],
    hp: 80, ac: 22, saves: { fort: 10 }, attacks: ['claw'], source: { id: 'secret-source' },
    effects: [{ id: 'secret-effect', duration: { remaining: 2 } }]
  };
  const player = { entries: {
    'wolf-internal': { revealed: true, identity: 'revealed', token: 'wolf-public', name: 'Ash Wolf', conditions: true }
  } };

  const initial = projectPlayerState({ combatants: [combatant] }, player);
  assert.deepEqual(initial.creatures, [{
    id: 'wolf-public', name: 'Ash Wolf', conditions: ['Frightened 2'], status: ['Marked']
  }]);
  assert.equal(JSON.stringify(initial).includes('secret-source'), false);
  assert.equal(JSON.stringify(initial).includes('secret-effect'), false);
  assert.equal(JSON.stringify(initial).includes('duration'), false);

  combatant.conditions = ['Stunned 1'];
  const updated = projectPlayerState({ combatants: [combatant] }, player);
  assert.deepEqual(updated.creatures[0].conditions, ['Stunned 1']);

  combatant.conditions = [];
  const removed = projectPlayerState({ combatants: [combatant] }, player);
  assert.deepEqual(removed.creatures[0].conditions, []);
  assert.equal(JSON.stringify(removed).includes('Frightened 2'), false);
});

function snapshot(revision, phase = 'downtime') {
  return createPlayerSnapshot({
    contract: 'pf2e-companion/public-campaign-session',
    version: 2,
    revision,
    campaign: { title: '' },
    session: { phase, round: 0, currentTurnId: null, encounter: { title: '', status: 'planned' },
      recap: { version: 1, status: 'empty', revision: 0, title: '', body: '' },
      characters: [], creatures: [], notes: [], events: [], actors: [] }
  });
}

test('player accepts only newer public revisions', () => {
  const first = snapshot(4, 'exploration');
  const stale = snapshot(3, 'combat');
  const duplicate = snapshot(4, 'combat');
  const next = snapshot(5, 'combat');
  assert.equal(acceptPlayerSnapshot(null, first), first);
  assert.equal(acceptPlayerSnapshot(first, stale), first);
  assert.equal(acceptPlayerSnapshot(first, duplicate), first);
  assert.equal(acceptPlayerSnapshot(first, next), next);
});

test('player-side phase mutation messages are not requests and cannot change the accepted snapshot', () => {
  const current = snapshot(2, 'exploration');
  const attemptedMutation = { kind: 'set-session-phase', phase: 'combat', revision: 99 };
  assert.equal(isPlayerRequest(attemptedMutation), false);
  assert.equal(acceptPlayerSnapshot(current, attemptedMutation), current);
  assert.equal(current.projection.session.phase, 'exploration');
});

test('transport envelopes are versioned and reject legacy or mixed-channel messages', () => {
  const request = createPlayerRequest();
  assert.equal(isPlayerRequest(request), true);
  assert.equal(isPlayerRequest({ ...request, version: 2 }), false);
  assert.equal(isPlayerRequest({ kind: 'player-request', channel: 'pf2e-gm-toolkit/player-v1' }), false);

  const valid = snapshot(1);
  assert.equal(isPlayerSnapshot(valid), true);
  assert.equal(isPlayerSnapshot({ ...valid, transport: 'other' }), false);
  assert.equal(isPlayerSnapshot({ ...valid, projection: { ...valid.projection, secret: true } }), false);
});
