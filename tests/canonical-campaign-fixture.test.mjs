import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPublicCampaignSession } from '../src/player-contract.js';
import { orderedCombatants } from '../src/combat-turn.js';
import { companionCharactersForCampaign } from '../src/companion-rosters.js';
import { encounterIdentity } from '../src/encounter-visibility.js';
import { companionProjection, createCanonicalCampaignFixture } from './fixtures/canonical-campaign.mjs';

const fixture = createCanonicalCampaignFixture();

test('canonical fixture covers one campaign, GM, players, links, and all phases', () => {
  assert.equal(fixture.campaignId, 'campaign-silver-road');
  assert.equal(fixture.gm.gm.id, 'gm-1');
  assert.deepEqual(fixture.gm.players.map(player => player.id), ['player-aria', 'player-bram']);
  assert.deepEqual(companionCharactersForCampaign(fixture.gm.roster, fixture.campaignId).map(character => character.id), [
    'character-aria', 'character-bram'
  ]);
  assert.deepEqual(Object.keys(fixture.phases), ['downtime', 'exploration', 'combat']);
  assert.deepEqual(Object.values(fixture.phases).map(state => state.session.phase), [
    'downtime', 'exploration', 'combat'
  ]);
  assert.deepEqual(orderedCombatants(fixture.gm.combat.combatants).map(combatant => combatant.id), [
    'combat-aria', 'creature-revealed', 'creature-hidden', 'combat-bram'
  ]);
  assert.equal(encounterIdentity(fixture.gm.encounter.entries[0]), 'revealed');
  assert.equal(encounterIdentity(fixture.gm.encounter.entries[1]), 'hidden');
});

test('Companion parity projection is deterministic and valid for every phase', () => {
  for (const phase of ['downtime', 'exploration', 'combat']) {
    const first = companionProjection(fixture, phase);
    const second = companionProjection(fixture, phase);
    assert.deepEqual(first, second);
    assert.equal(first.session.phase, phase);
    assert.equal(isPublicCampaignSession(first), true);
  }
});

test('Companion projection includes public campaign activity and linked characters only', () => {
  const projection = companionProjection(fixture);
  assert.deepEqual(projection.session.characters, [
    { id: 'character-aria', name: 'Aria Vale', level: 4, class: 'Ranger', ancestry: 'Elf' },
    { id: 'character-bram', name: 'Bram Stone', level: 4, class: 'Fighter', ancestry: 'Dwarf' }
  ]);
  assert.deepEqual(projection.session.creatures, [{
    id: 'warden-public', name: 'Ashen Warden', conditions: ['Frightened 1'], image: './assets/warden.png',
    description: 'A sentinel of the old road.', role: 'guardian', traits: ['construct'], status: ['alert']
  }]);
  assert.deepEqual(projection.session.events, [
    { message: 'Bring your maps.' },
    { id: 'explore-ruins', kind: 'discovery', title: 'Sunken ruins', description: 'A stairway descends beneath the road.', revision: 2 },
    { id: 'downtime-earn', kind: 'activity', title: 'Earn Income', description: 'Work during the quiet days.', revision: 1 },
    { id: 'downtime-public-result', kind: 'result', title: 'Town remembers', resultText: 'The town remembers your help.', revision: 2 }
  ]);
  assert.deepEqual(projection.session.notes, [{ id: 'note-road', title: 'Shared route', body: 'The old road bends north.', author: 'GM', revision: 2 }]);
  assert.deepEqual(projection.session.recap, {
    version: 1, status: 'updated', revision: 4, title: 'The watchtower stirs',
    body: 'The party found a path beneath the watchtower.'
  });
  assert.deepEqual(projection.session.announcements, [{
    id: 'announcement-table', title: 'At the table', message: 'Meet at the watchtower.', revision: 1, createdAt: 100
  }]);
  assert.deepEqual(projection.session.actors.map(actor => [actor.id, actor.name, actor.active]), [
    ['aria-public', 'Aria Vale', false],
    ['warden-public', 'Ashen Warden', true],
    ['bram-public', 'Bram Stone', false]
  ]);
});

test('fixture proves the public boundary excludes GM-only state', () => {
  const serialized = JSON.stringify(companionProjection(fixture));
  for (const secret of [
    'gm-private@example.test', 'campaign-source-private', 'player-aria-private', 'Keep the relic secret',
    'private attack', 'aon-private-warden', 'aon-private-secret', 'Do not reveal this encounter',
    'The bridge is trapped', 'Find the sealed vault', 'Private GM plan', 'Secret result', 'privateDC',
    'weaknesses', 'resistances', 'saves', 'attacks', '"hp":', '"ac":', 'internalSourceId'
  ]) {
    assert.equal(serialized.includes(secret), false, `leaked ${secret}`);
  }
  assert.equal(serialized.includes('Invisible Vault Guardian'), false);
  assert.equal(serialized.includes('Hidden Warden Record'), false);
  assert.equal(isPublicCampaignSession(companionProjection(fixture)), true);
});
