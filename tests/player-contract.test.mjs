import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PUBLIC_CONTRACT,
  adaptPublicCampaignSession,
  serializePublicCampaignSession,
  isPublicCampaignSession
} from '../src/player-contract.js';

test('legacy GM state maps deterministically to the versioned public contract', () => {
  const input = {
    campaign: { title: 'Mists', note: 'GM secret', arcs: [{ id: 'private' }] },
    combat: { round: 4, activeId: 'enemy', order: ['enemy', 'pc'], combatants: [
      { id: 'enemy', name: 'Hidden Boss', hp: 99, ac: 30, notes: 'secret' },
      { id: 'pc', name: 'Ari', hp: 12 }
    ] },
    player: { entries: {
      enemy: { revealed: false, token: 'gm-id', name: 'Boss' },
      pc: { revealed: true, token: 'ari', name: 'Ari' }
    } }
  };
  const expected = {
    contract: PUBLIC_CONTRACT,
    version: 1,
    campaign: { title: 'Mists' },
    session: { round: 4, actors: [{ id: 'ari', name: 'Ari', active: false, order: 1 }] }
  };
  assert.deepEqual(adaptPublicCampaignSession(input), expected);
  assert.deepEqual(adaptPublicCampaignSession(input), adaptPublicCampaignSession(input));
});

test('serialized projection contains no GM-private fields or internal ids', () => {
  const serialized = serializePublicCampaignSession({
    campaign: { title: 'Public', gmNotes: 'do not leak', sourceId: 'campaign-secret' },
    combat: { round: 2, activeId: 'a', combatants: [{
      id: 'a', name: 'Secret Name', hp: 20, ac: 18, saves: { fort: 9 }, attacks: ['claw'],
      damage: '2d6', weaknesses: ['fire'], resistances: ['all'], notes: 'private', source: { id: 'src' }
    }] },
    player: { entries: { a: { revealed: true, token: '', name: 'Public Name' } } }
  });
  const parsed = JSON.parse(serialized);
  const keys = [];
  const values = [];
  const visit = value => {
    if (!value || typeof value !== 'object') {
      if (typeof value === 'string') values.push(value.toLowerCase());
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      keys.push(key.toLowerCase());
      visit(child);
    }
  };
  visit(parsed);
  for (const field of ['hp', 'ac', 'saves', 'attacks', 'damage', 'weaknesses', 'resistances', 'notes', 'source']) {
    assert.equal(keys.includes(field), false, `leaked ${field}`);
  }
  for (const value of ['secret name', 'campaign-secret']) {
    assert.equal(values.includes(value), false, `leaked ${value}`);
  }
  assert.equal(isPublicCampaignSession(parsed), true);
  assert.deepEqual(Object.keys(parsed), ['contract', 'version', 'campaign', 'session']);
  assert.deepEqual(Object.keys(parsed.session), ['round', 'actors']);
  assert.deepEqual(Object.keys(parsed.session.actors[0]), ['id', 'name', 'active', 'order']);
});
