import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PUBLIC_CONTRACT,
  PUBLIC_PHASES,
  adaptPublicCampaignSession,
  serializePublicCampaignSession,
  isPublicCampaignSession,
  isPublicPhase
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
    revision: 0,
    campaign: { title: 'Mists' },
    session: { phase: 'downtime', round: 4, actors: [{ id: 'ari', name: 'Ari', active: false, order: 1 }] }
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
  assert.deepEqual(Object.keys(parsed), ['contract', 'version', 'revision', 'campaign', 'session']);
  assert.deepEqual(Object.keys(parsed.session), ['phase', 'round', 'actors']);
  assert.deepEqual(Object.keys(parsed.session.actors[0]), ['id', 'name', 'active', 'order']);
});

test('only the three public session phases are accepted', () => {
  assert.deepEqual(PUBLIC_PHASES, ['downtime', 'exploration', 'combat']);
  for (const phase of PUBLIC_PHASES) {
    assert.equal(isPublicPhase(phase), true);
    assert.equal(adaptPublicCampaignSession({ session: { phase } }).session.phase, phase);
  }
  for (const phase of ['rest', '', null, 4, 'Combat']) {
    assert.equal(isPublicPhase(phase), false);
    assert.equal(adaptPublicCampaignSession({ session: { phase } }).session.phase, 'downtime');
  }
});

test('public revisions are non-negative integers and phase/session data stays allowlisted', () => {
  const projection = adaptPublicCampaignSession({
    revision: 7,
    session: { phase: 'combat', gmNotes: 'secret', revision: 2 },
    combat: { round: 3, privateTimer: 'hidden' },
    player: { entries: {} }
  });
  assert.equal(projection.revision, 7);
  assert.equal(isPublicCampaignSession(projection), true);
  assert.equal(isPublicCampaignSession({ ...projection, revision: -1 }), false);
  assert.equal(isPublicCampaignSession({ ...projection, session: { ...projection.session, phase: 'rest' } }), false);
  assert.deepEqual(Object.keys(projection.session), ['phase', 'round', 'actors']);
});
