import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adaptPublicCampaignSession,
  serializePublicCampaignSession,
  isPublicCampaignSession
} from '../src/player-contract.js';
import { projectPlayerState } from '../src/player-state.js';
import {
  acceptPlayerSnapshot,
  createPlayerSnapshot
} from '../src/player-transport.js';
import { companionProjection, createCanonicalCampaignFixture } from './fixtures/canonical-campaign.mjs';

const FORBIDDEN_KEYS = new Set([
  'hp', 'ac', 'saves', 'attacks', 'damage', 'weaknesses', 'resistances',
  'gmNotes', 'gmOnly', 'sourceId', 'internalSourceId', 'ownerId',
  'characterSheet', 'privateDC', 'dc', 'mechanics', 'init', 'effects',
  'duration', 'timer'
]);

function forbiddenKeys(value, path = '$', found = []) {
  if (!value || typeof value !== 'object') return found;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) found.push(`${path}.${key}`);
    forbiddenKeys(child, `${path}.${key}`, found);
  }
  return found;
}

function assertPublicOnly(label, value, sentinels) {
  assert.deepEqual(forbiddenKeys(value), [], `${label} exposed forbidden keys`);
  const serialized = JSON.stringify(value);
  for (const sentinel of sentinels) {
    assert.equal(serialized.includes(sentinel), false, `${label} exposed ${sentinel}`);
  }
}

function renderedPlayerData(projection) {
  const session = projection.session;
  return {
    status: { round: session.round, currentTurnId: session.currentTurnId },
    recap: session.recap,
    actors: session.actors.map(actor => ({
      id: actor.id, name: actor.name, image: actor.image, active: actor.active
    })),
    creatures: session.creatures.map(creature => ({
      id: creature.id,
      name: creature.name,
      conditions: creature.conditions,
      status: creature.status,
      image: creature.image
    }))
  };
}

test('privacy matrix keeps every player-facing projection and rendered fixture public-only', () => {
  const fixture = createCanonicalCampaignFixture();
  const sentinels = [
    'gm-private@example.test', 'campaign-source-private', 'player-aria-private',
    'Keep the relic secret', 'private attack', 'aon-private-warden',
    'aon-private-secret', 'Do not reveal this encounter', 'The bridge is trapped',
    'Private GM plan', 'Secret result', 'Invisible Vault Guardian',
    'Hidden Warden Record'
  ];

  for (const phase of ['downtime', 'exploration', 'combat']) {
    const projection = companionProjection(fixture, phase);
    assert.equal(isPublicCampaignSession(projection), true, `${phase} contract invalid`);
    assertPublicOnly(`${phase} projection`, projection, sentinels);
    assertPublicOnly(`${phase} serialized projection`, JSON.parse(serializePublicCampaignSession(fixture.phases[phase])), sentinels);
    assertPublicOnly(`${phase} rendered fixture`, renderedPlayerData(projection), sentinels);

    const snapshot = createPlayerSnapshot(projection);
    assert.ok(snapshot);
    assertPublicOnly(`${phase} transport snapshot`, snapshot, sentinels);
    assert.equal(acceptPlayerSnapshot(null, snapshot), snapshot);
  }
});

test('legacy compatibility projection and reconnect payloads remain sanitized', () => {
  const fixture = createCanonicalCampaignFixture();
  const legacy = projectPlayerState(fixture.gm.combat, fixture.gm.player, { phase: 'combat', revision: 12 });
  const sentinels = ['aon-private-warden', 'Invisible Vault Guardian', 'private attack'];
  assertPublicOnly('legacy player state', legacy, sentinels);

  const projection = companionProjection(fixture, 'combat');
  const current = createPlayerSnapshot({ ...projection, revision: projection.revision + 1 });
  const reconnect = createPlayerSnapshot({ ...projection, revision: projection.revision + 2 });
  assert.equal(acceptPlayerSnapshot(current, reconnect), reconnect);
  assertPublicOnly('reconnect payload', reconnect, sentinels);
});

test('unpublished rich legacy events cannot bypass the public event adapter', () => {
  const projection = adaptPublicCampaignSession({
    events: [{
      id: 'gm-event', kind: 'event', title: 'GM event', public: false,
      description: 'private description', resultText: 'private result',
      hp: 99, sourceId: 'private-source'
    }]
  });
  assert.deepEqual(projection.session.events, []);
  assertPublicOnly('private legacy event projection', projection, [
    'GM event', 'private description', 'private result', 'private-source'
  ]);
});
