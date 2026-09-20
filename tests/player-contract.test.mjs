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
    version: 2,
    revision: 0,
    campaign: { title: 'Mists' },
    session: {
      phase: 'downtime', round: 4, currentTurnId: null,
      encounter: { title: '', status: 'planned' },
      recap: { version: 1, status: 'empty', revision: 0, title: '', body: '' },
      characters: [], creatures: [], notes: [], events: [],
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
      round: 3,
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
  assert.equal(projection.session.round, 3);
  assert.equal(projection.session.currentTurnId, 'ally-wolf');
  assert.equal(JSON.stringify(projection).includes('pc-internal'), false);
  assert.equal(JSON.stringify(projection).includes('hidden-npc'), false);
  assert.equal(JSON.stringify(projection).includes('npc-source'), false);
  for (const actor of projection.session.actors) {
    assert.deepEqual(Object.keys(actor), ['id', 'name', 'active', 'order']);
  }
  assert.equal(isPublicCampaignSession(projection), true);
});

test('encounter visibility fails closed and visible creature projections stay sanitized', () => {
  const base = {
    session: { phase: 'combat' },
    combat: { round: 1, order: ['hidden-creature', 'visible-creature'], activeId: 'visible-creature', combatants: [
      { id: 'hidden-creature', isPC: false, name: 'Secret Hydra', publicVisible: false, hp: 999, ac: 30 },
      { id: 'visible-creature', isPC: false, name: 'Ogre', publicVisible: true, publicName: 'The Ogre', hp: 80, ac: 20, source: { id: 'secret-source' } }
    ] }
  };
  const projection = adaptPublicCampaignSession(base);
  assert.deepEqual(projection.session.actors, [{ id: 'public-1', name: 'The Ogre', active: true, order: 1 }]);
  assert.deepEqual(projection.session.creatures, []);
  assert.equal(JSON.stringify(projection).includes('Secret Hydra'), false);
  assert.equal(JSON.stringify(projection).includes('secret-source'), false);
  assert.equal(isPublicCampaignSession(projection), true);
});

test('public identity and image controls never leak hidden monster fields', () => {
  const input = {
    session: { phase: 'combat' },
    combat: { round: 1, order: ['hidden', 'unknown', 'revealed'], activeId: 'unknown', combatants: [
      { id: 'hidden', isPC: false, publicVisible: false, publicIdentity: 'revealed', publicName: 'Secret Hydra', publicImage: 'https://example.test/hydra.png', publicImageVisible: true, hp: 999, ac: 30 },
      { id: 'unknown', isPC: false, publicVisible: true, publicIdentity: 'unknown', publicName: 'Secret Ogre', publicImage: 'https://example.test/ogre.png', publicImageVisible: true, hp: 80 },
      { id: 'revealed', isPC: false, publicVisible: true, publicIdentity: 'revealed', publicName: 'The Ogre', publicImage: 'https://example.test/ogre.png', publicImageVisible: true, hp: 80 }
    ] }
  };
  const projection = adaptPublicCampaignSession(input);
  assert.deepEqual(projection.session.actors.map(({ name, image }) => ({ name, image })), [
    { name: 'Unknown creature', image: undefined },
    { name: 'The Ogre', image: 'https://example.test/ogre.png' }
  ]);
  const serialized = JSON.stringify(projection);
  assert.equal(serialized.includes('Secret Hydra'), false);
  assert.equal(serialized.includes('Secret Ogre'), false);
  assert.equal(serialized.includes('hydra.png'), false);
  assert.equal(isPublicCampaignSession(projection), true);
});

test('creature cards are allowlisted, stable across reveal changes, and metadata-gated', () => {
  const combatants = [
    { id: 'secret-a', isPC: false, publicVisibility: 'hidden', publicId: 'hidden-wolf-card',
      publicDescription: 'Should stay hidden', hp: 999 },
    { id: 'secret-b', isPC: false, publicVisibility: 'public', publicId: 'wolf-card',
      publicName: 'Ash Wolf', publicImage: './wolf.png', publicDescription: 'A watchful wolf.',
      publicRole: 'skirmisher', publicTraits: ['beast', 'fire'], publicStatus: ['Marked'],
      conditions: ['Frightened 2'], hp: 80, ac: 22, saves: { fort: 10 }, source: { id: 'gm-source' } }
  ];
  const player = { entries: {
    'secret-a': { token: 'wolf-card', name: 'Hidden Wolf', revealed: false, conditions: true },
    'secret-b': { token: 'wolf-card', name: 'Ash Wolf', revealed: true, conditions: true }
  } };
  const revealed = adaptPublicCampaignSession({ session: { phase: 'combat' }, combat: { combatants }, player });
  assert.deepEqual(revealed.session.creatures, [{
    id: 'wolf-card', name: 'Ash Wolf', image: './wolf.png', conditions: ['Frightened 2'],
    description: 'A watchful wolf.', role: 'skirmisher', traits: ['beast', 'fire'], status: ['Marked']
  }]);
  assert.equal(JSON.stringify(revealed).includes('gm-source'), false);
  assert.equal(JSON.stringify(revealed).includes('999'), false);
  assert.equal(isPublicCampaignSession(revealed), true);

  const hidden = adaptPublicCampaignSession({ session: { phase: 'combat' }, combat: {
    combatants: combatants.map(creature => ({ ...creature, publicVisibility: 'hidden' }))
  }, player });
  assert.deepEqual(hidden.session.creatures, []);

  const presence = adaptPublicCampaignSession({ session: { phase: 'combat' }, combat: {
    combatants: [{ ...combatants[1], publicVisibility: 'presence' }]
  }, player });
  assert.deepEqual(presence.session.creatures, [{ id: 'wolf-card', name: 'Unknown creature', conditions: [] }]);
});

test('staged reveals publish only explicit allowlisted labels at the selected tier', () => {
  const projection = adaptPublicCampaignSession({
    combat: { combatants: [{
      id: 'wolf', publicVisibility: 'identity', publicName: 'Ash Wolf',
      hp: 80, ac: 22, publicReveal: {
        tier: 'known',
        decisions: [
          { tier: 'basic', category: 'appearance', labels: ['Scaled'] },
          { tier: 'known', category: 'traits', labels: ['Beast'] },
          { tier: 'detailed', category: 'lore', labels: ['Secret weakness: fire'] },
          { tier: 'known', category: 'weaknesses', labels: ['fire'] }
        ]
      }
    }] },
    player: { entries: {
      wolf: { token: 'public-1', name: 'Ash Wolf', conditions: true }
    } }
  });
  assert.deepEqual(projection.session.creatures, [{
    id: 'public-1', name: 'Ash Wolf', conditions: [],
    reveals: [
      { category: 'appearance', labels: ['Scaled'] },
      { category: 'traits', labels: ['Beast'] }
    ]
  }]);
  const serialized = JSON.stringify(projection);
  for (const secret of ['Secret weakness: fire', 'weaknesses', '80', '22']) {
    assert.equal(serialized.includes(secret), false, `leaked ${secret}`);
  }
});

test('conditions require a revealed creature identity and never apply to PCs or hidden creatures', () => {
  const combatants = [
    { id: 'pc', isPC: true, conditions: ['Dying 2'], publicVisibility: 'public', publicName: 'Ari' },
    { id: 'hidden', isPC: false, conditions: ['Frightened 3'], publicVisibility: 'hidden' },
    { id: 'presence', isPC: false, conditions: ['Clumsy 2'], publicVisibility: 'presence' },
    { id: 'revealed', isPC: false, conditions: ['Slowed 1'], publicVisibility: 'identity', publicName: 'The Ogre' }
  ];
  const projection = adaptPublicCampaignSession({
    combat: { combatants },
    player: { entries: Object.fromEntries(combatants.map(combatant => [combatant.id, {
      revealed: true, conditions: true, token: `${combatant.id}-public`, name: combatant.publicName || combatant.id
    }])) }
  });
  assert.deepEqual(projection.session.creatures, [
    { id: 'presence-public', name: 'Unknown creature', conditions: [] },
    { id: 'revealed-public', name: 'The Ogre', conditions: ['Slowed 1'] }
  ]);
  assert.equal(JSON.stringify(projection).includes('Dying 2'), false);
  assert.equal(JSON.stringify(projection).includes('Frightened 3'), false);
  assert.equal(JSON.stringify(projection).includes('Clumsy 2'), false);
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
  assert.deepEqual(Object.keys(parsed.session), ['phase', 'round', 'currentTurnId', 'encounter', 'recap', 'characters', 'creatures', 'notes', 'events', 'actors']);
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
  assert.deepEqual(Object.keys(projection.session), ['phase', 'round', 'currentTurnId', 'encounter', 'recap', 'characters', 'creatures', 'notes', 'events', 'actors']);
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

test('campaign notes omit private structure and never fall back to local ids', () => {
  const projection = adaptPublicCampaignSession({ notes: [
    { id: 'private-id', title: 'Secret title', body: 'Secret body', at: 'secret time',
      authorId: 'secret-author', gmOnly: true, revision: 99 },
    { id: 'legacy-local-id', public: true, title: 'Shared legacy', body: 'Safe text',
      at: 'private time', authorId: 'private-author' },
    { id: 'shared-local-id', public: true, publicId: 'shared-public-id', title: 'Shared',
      body: 'Visible', at: 'private time', authorId: 'private-author', gmNotes: 'secret',
      revision: 2 }
  ] });
  assert.deepEqual(projection.session.notes, [
    { title: 'Shared legacy', body: 'Safe text' },
    { id: 'shared-public-id', title: 'Shared', body: 'Visible', revision: 2 }
  ]);
  const serialized = JSON.stringify(projection);
  for (const secret of ['private-id', 'Secret title', 'Secret body', 'secret time',
    'secret-author', 'shared-local-id', 'private-author', 'secret']) {
    assert.equal(serialized.includes(secret), false, `leaked ${secret}`);
  }
  assert.equal(isPublicCampaignSession(projection), true);
});

test('shared notes preserve source order, safe authorship, and non-negative revisions', () => {
  const projection = adaptPublicCampaignSession({ notes: [
    { public: true, publicId: 'first', title: 'First', body: 'One', version: 4,
      publicAuthor: 'GM', authorId: 'hidden-author' },
    { shared: true, publicId: 'second', title: 'Second', body: 'Two', revision: 0,
      publicAuthor: 'Players', author: { id: 'hidden', name: 'Do not copy' } }
  ] });
  assert.deepEqual(projection.session.notes, [
    { id: 'first', title: 'First', body: 'One', author: 'GM', revision: 4 },
    { id: 'second', title: 'Second', body: 'Two', author: 'Players', revision: 0 }
  ]);
  assert.equal(isPublicCampaignSession(projection), true);
});

test('edited shared note state carries its newer public revision', () => {
  const edited = adaptPublicCampaignSession({ notes: [{
    id: 'local-note', public: true, publicId: 'shared-note', title: 'Updated', body: 'New text', revision: 3
  }] });
  assert.deepEqual(edited.session.notes, [{
    id: 'shared-note', title: 'Updated', body: 'New text', revision: 3
  }]);
  assert.equal(isPublicCampaignSession(edited), true);
});

test('modern shared notes without a public id fail closed while legacy public notes remain compatible', () => {
  const projection = adaptPublicCampaignSession({ notes: [
    { id: 'shared-local', shared: true, title: 'Must stay private', body: 'No public id' },
    { id: 'legacy-local', public: true, title: 'Legacy shared', body: 'Still supported', revision: 7 }
  ] });
  assert.deepEqual(projection.session.notes, [{ title: 'Legacy shared', body: 'Still supported' }]);
});

test('shared deletions become public tombstones while private deletions disappear', () => {
  const projection = adaptPublicCampaignSession({ notes: [
    { id: 'private-delete', public: false, deleted: true, revision: 8, title: 'secret', body: 'secret' },
    { id: 'shared-delete', public: true, publicId: 'public-delete', deleted: true,
      revision: 3, title: 'must not leak', body: 'must not leak', authorId: 'private' }
  ] });
  assert.deepEqual(projection.session.notes, [
    { id: 'public-delete', revision: 3, deleted: true }
  ]);
  assert.equal(JSON.stringify(projection).includes('shared-delete'), false);
  assert.equal(JSON.stringify(projection).includes('must not leak'), false);
  assert.equal(isPublicCampaignSession(projection), true);
});

test('note envelope validation rejects unknown fields and malformed shared values', () => {
  const projection = adaptPublicCampaignSession({ notes: [
    { public: true, publicId: 'note', title: 'Shared', body: 'Text', revision: 1 }
  ] });
  assert.equal(isPublicCampaignSession(projection), true);
  for (const notes of [
    [{ ...projection.session.notes[0], gmNotes: 'secret' }],
    [{ ...projection.session.notes[0], revision: -1 }],
    [{ ...projection.session.notes[0], author: { id: 'secret' } }],
    [{ id: 'note', revision: 1, deleted: true, title: 'not allowed' }],
    [{ id: 4, title: 'Shared', body: 'Text', revision: 1 }]
  ]) {
    assert.equal(isPublicCampaignSession({ ...projection, session: {
      ...projection.session, notes
    } }), false);
  }
});

test('published exploration events project as safe revisions while private events stay in GM state', () => {
  const projection = adaptPublicCampaignSession({
    session: { phase: 'exploration' },
    explorationEvents: [
      { id: 'ruins', kind: 'location', title: 'Sunken Ruins', description: 'A stairway descends.',
        published: true, revision: 2, sourceId: 'gm-source', gmNotes: 'secret route' },
      { id: 'secret-objective', kind: 'objective', title: 'Find the sealed vault', description: 'Do not reveal this yet.',
        published: false, revision: 1 }
    ]
  });
  assert.deepEqual(projection.session.events, [{ id: 'ruins', kind: 'location', title: 'Sunken Ruins',
    description: 'A stairway descends.', revision: 2 }]);
  assert.equal(JSON.stringify(projection).includes('secret-objective'), false);
  assert.equal(JSON.stringify(projection).includes('gm-source'), false);
  assert.equal(JSON.stringify(projection).includes('sealed vault'), false);
  assert.equal(isPublicCampaignSession(projection), true);
});

test('published downtime records integrate as safe public events with explicit result text only', () => {
  const projection = adaptPublicCampaignSession({
    session: { phase: 'downtime' },
    downtimeRecords: [
      { id: 'activity-1', kind: 'activity', title: 'Earn Income', text: 'Work for the day.', published: true, revision: 2,
        privateDC: 20, gmNotes: 'secret', timer: { dueAt: 999 } },
      { id: 'opportunity-1', type: 'opportunity', publicTitle: 'A favor', published: true, revision: 1,
        outcome: { text: 'Hidden outcome' }, sourceId: 'internal-source' },
      { id: 'result-1', kind: 'result', title: 'Resolved', publicResultText: 'The favor is complete.', published: true, revision: 3,
        dc: 30, mechanics: { hidden: true } },
      { id: 'private-1', kind: 'result', title: 'GM-only result', published: false, revision: 4 }
    ]
  });
  assert.deepEqual(projection.session.events, [
    { id: 'activity-1', kind: 'activity', title: 'Earn Income', text: 'Work for the day.', revision: 2 },
    { id: 'opportunity-1', kind: 'opportunity', title: 'A favor', revision: 1 },
    { id: 'result-1', kind: 'result', title: 'Resolved', resultText: 'The favor is complete.', revision: 3 }
  ]);
  assert.equal(JSON.stringify(projection).includes('Hidden outcome'), false);
  assert.equal(JSON.stringify(projection).includes('internal-source'), false);
  assert.equal(JSON.stringify(projection).includes('privateDC'), false);
  assert.equal(isPublicCampaignSession(projection), true);
});

test('strict public contract validation rejects unknown downtime fields and malformed result text', () => {
  const projection = adaptPublicCampaignSession({ downtimeRecords: [
    { id: 'result-1', kind: 'result', title: 'Resolved', publicResultText: 'Done', published: true, revision: 1 }
  ] });
  assert.equal(isPublicCampaignSession(projection), true);
  assert.equal(isPublicCampaignSession({ ...projection, session: {
    ...projection.session, events: [{ ...projection.session.events[0], dc: 15 }]
  } }), false);
  assert.equal(isPublicCampaignSession({ ...projection, session: {
    ...projection.session, events: [{ ...projection.session.events[0], resultText: 15 }]
  } }), false);
});

test('public contract validation fails closed when an unknown field is added', () => {
  const projection = adaptPublicCampaignSession();
  assert.equal(isPublicCampaignSession({ ...projection, session: { ...projection.session, secret: true } }), false);
  assert.equal(isPublicCampaignSession({ ...projection, campaign: { ...projection.campaign, notes: 'secret' } }), false);
});

test('combat lifecycle publishes a public turn only for a live revealed combatant', () => {
  const player = { entries: {
    first: { revealed: true, token: 'first-public', name: 'First' },
    second: { revealed: true, token: 'second-public', name: 'Second' }
  } };
  const combatants = [{ id: 'first', init: 20 }, { id: 'second', init: 10 }];
  const start = adaptPublicCampaignSession({ combat: { round: 0, activeId: null, combatants }, player });
  assert.equal(start.session.round, 0);
  assert.equal(start.session.currentTurnId, null);
  assert.equal(start.session.actors.some(actor => actor.active), false);

  const active = adaptPublicCampaignSession({
    combat: { round: 1, activeId: 'second', order: ['first', 'second'], combatants }, player
  });
  assert.equal(active.session.round, 1);
  assert.equal(active.session.currentTurnId, 'second-public');
  assert.equal(active.session.actors.find(actor => actor.id === 'second-public').active, true);

  const removed = adaptPublicCampaignSession({
    combat: { round: 1, activeId: 'second', order: ['first'], combatants: [combatants[0]] }, player
  });
  assert.equal(removed.session.round, 1);
  assert.equal(removed.session.currentTurnId, null);
  assert.equal(removed.session.actors.some(actor => actor.active), false);

  const ended = adaptPublicCampaignSession({
    combat: { round: 0, activeId: null, combatants: [] }, player
  });
  assert.equal(ended.session.round, 0);
  assert.equal(ended.session.currentTurnId, null);
  assert.deepEqual(ended.session.actors, []);
});

test('public aliases remain deterministic and unique when roster tokens collide', () => {
  const projection = adaptPublicCampaignSession({
    combat: { round: 1, activeId: 'b', order: ['a', 'b'], combatants: [{ id: 'a' }, { id: 'b' }] },
    player: { entries: {
      a: { revealed: true, token: 'same', name: 'A' },
      b: { revealed: true, token: 'same', name: 'B' }
    } }
  });
  assert.deepEqual(projection.session.actors.map(actor => actor.id), ['same', 'public-2-2']);
  assert.equal(projection.session.currentTurnId, 'public-2-2');
  assert.equal(isPublicCampaignSession(projection), true);
});
