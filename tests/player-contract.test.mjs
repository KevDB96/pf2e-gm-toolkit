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
    session: {
      phase: 'downtime', round: 4,
      encounter: { title: '', status: 'planned' }, characters: [], creatures: [], notes: [], events: [],
      actors: [{ id: 'ari', name: 'Ari', active: false, order: 1 }]
    }
  };
  assert.deepEqual(adaptPublicCampaignSession(input), expected);
  assert.deepEqual(adaptPublicCampaignSession(input), adaptPublicCampaignSession(input));
});

test('public actors follow initiative order for revealed PCs, allies, and NPCs only', () => {
  const projection = adaptPublicCampaignSession({
    session: { phase: 'combat' },
    combat: {
      activeId: 'ally-internal',
      order: ['hidden-npc', 'ally-internal', 'pc-internal', 'visible-npc', 'ally-internal'],
      combatants: [
        { id: 'pc-internal', isPC: true, hp: 28, ac: 20, init: 21 },
        { id: 'hidden-npc', isPC: false, side: 'enemy', hp: 80, ac: 22, source: { id: 'npc-source' } },
        { id: 'ally-internal', isPC: false, side: 'ally', hp: 35, ac: 19, saves: { fort: 10 } },
        { id: 'visible-npc', isPC: false, side: 'enemy', hp: 12, ac: 16, attacks: ['claw'] }
      ]
    },
    player: { entries: {
      'pc-internal': { revealed: true, token: 'pc-ari', name: 'Ari' },
      'hidden-npc': { revealed: false, token: 'npc-hidden', name: 'Secret Horror' },
      'ally-internal': { revealed: true, token: 'ally-wolf', name: 'Moonfang' },
      'visible-npc': { revealed: true, token: 'npc-ogre', name: 'The Ogre' }
    } }
  });

  assert.deepEqual(projection.session.actors, [
    { id: 'ally-wolf', name: 'Moonfang', active: true, order: 1 },
    { id: 'pc-ari', name: 'Ari', active: false, order: 2 },
    { id: 'npc-ogre', name: 'The Ogre', active: false, order: 3 }
  ]);
  assert.equal(JSON.stringify(projection).includes('pc-internal'), false);
  assert.equal(JSON.stringify(projection).includes('hidden-npc'), false);
  assert.equal(JSON.stringify(projection).includes('npc-source'), false);
  for (const actor of projection.session.actors) {
    assert.deepEqual(Object.keys(actor), ['id', 'name', 'active', 'order']);
  }
  assert.equal(isPublicCampaignSession(projection), true);
});

test('generated public actor aliases are based only on revealed roster members', () => {
  const input = {
    combat: {
      order: ['hidden', 'revealed-without-token'],
      combatants: [{ id: 'hidden' }, { id: 'revealed-without-token' }]
    },
    player: { entries: {
      hidden: { revealed: false, name: 'GM-only' },
      'revealed-without-token': { revealed: true, name: 'Visible' }
    } }
  };
  assert.deepEqual(adaptPublicCampaignSession(input).session.actors, [
    { id: 'public-1', name: 'Visible', active: false, order: 1 }
  ]);
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
  for (const field of ['hp', 'ac', 'saves', 'attacks', 'damage', 'weaknesses', 'resistances', 'source']) {
    assert.equal(keys.includes(field), false, `leaked ${field}`);
  }
  for (const value of ['secret name', 'campaign-secret']) {
    assert.equal(values.includes(value), false, `leaked ${value}`);
  }
  assert.equal(isPublicCampaignSession(parsed), true);
  assert.deepEqual(Object.keys(parsed), ['contract', 'version', 'revision', 'campaign', 'session']);
  assert.deepEqual(Object.keys(parsed.session), ['phase', 'round', 'encounter', 'characters', 'creatures', 'notes', 'events', 'actors']);
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
  assert.deepEqual(Object.keys(projection.session), ['phase', 'round', 'encounter', 'characters', 'creatures', 'notes', 'events', 'actors']);
});

test('the public boundary projects only explicitly public sections and strips GM mechanics', () => {
  const parsed = JSON.parse(serializePublicCampaignSession({
    campaign: { title: 'Mists', gmNotes: 'secret', sourceId: 'campaign-id' },
    session: { phase: 'combat', privateTimer: 'hidden' },
    encounter: { name: 'Bridge', status: 'active', entries: [{ id: 'monster-id', hp: 40 }] },
    characters: [{ id: 'pc-id', public: true, name: 'Ari', level: 7, class: 'Ranger', ancestry: 'Elf', ac: 22 }],
    notes: [{ id: 'n1', title: 'GM note', body: 'secret' }, { public: true, title: 'Table', body: 'Meet at dawn', gmOnly: true }],
    events: [{ public: true, title: 'Bell', sourceId: 'event-id', hidden: true }],
    combat: { round: 2, activeId: 'monster-id', combatants: [{
      id: 'monster-id', name: 'Ogre', isPC: false, hp: 40, ac: 19, conditions: ['Frightened 1'],
      saves: { fort: 10 }, attacks: ['club'], damage: '2d8', weaknesses: ['fire'], resistances: ['physical'],
      notes: 'GM-only'
    }] },
    player: { entries: { 'monster-id': { revealed: true, conditions: true, token: 'ogre-public', name: 'The Ogre' } } }
  }));
  assert.deepEqual(parsed.session.encounter, { title: 'Bridge', status: 'active' });
  assert.deepEqual(parsed.session.characters, [{ id: 'character-1', name: 'Ari', level: 7, class: 'Ranger', ancestry: 'Elf' }]);
  assert.deepEqual(parsed.session.creatures, [{ id: 'ogre-public', name: 'The Ogre', conditions: ['Frightened 1'] }]);
  assert.deepEqual(parsed.session.notes, [{ title: 'Table', body: 'Meet at dawn' }]);
  assert.deepEqual(parsed.session.events, [{ message: 'Bell' }]);
  assert.equal(isPublicCampaignSession(parsed), true);
  const forbiddenKeys = [];
  const forbiddenValues = [];
  const visit = value => {
    if (!value || typeof value !== 'object') {
      if (typeof value === 'string') forbiddenValues.push(value.toLowerCase());
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      forbiddenKeys.push(key.toLowerCase());
      visit(child);
    }
  };
  visit(parsed);
  for (const field of ['hp', 'ac', 'saves', 'attacks', 'damage', 'weaknesses', 'resistances', 'sourceid', 'gmnotes', 'hidden']) {
    assert.equal(forbiddenKeys.includes(field), false, `leaked ${field}`);
  }
  assert.equal(forbiddenValues.includes('gm-only'), false);
});

test('public contract validation fails closed when an unknown field is added', () => {
  const projection = adaptPublicCampaignSession();
  assert.equal(isPublicCampaignSession({ ...projection, session: { ...projection.session, secret: true } }), false);
  assert.equal(isPublicCampaignSession({ ...projection, campaign: { ...projection.campaign, notes: 'secret' } }), false);
});
