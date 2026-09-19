import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PUBLIC_CHARACTER_CONTRACT,
  PUBLIC_CHARACTER_VERSION,
  adaptCompanionCharacter,
  resolveCompanionCharacter
} from '../src/companion-characters.js';
import {
  adaptCompanionCharacter as contractAdapter,
  resolveCompanionCharacter as contractResolver,
  adaptPublicCampaignSession,
  isPublicCampaignSession
} from '../src/player-contract.js';
import {
  assignCompanionCharacter,
  campaignRoster,
  companionAnnotation,
  companionCharactersByCampaign,
  companionCharactersForCampaign,
  normalizeCompanionRosterState,
  unassignCompanionCharacter
} from '../src/companion-rosters.js';

const sharedRecord = (id, name = id) => ({
  contract: PUBLIC_CHARACTER_CONTRACT,
  version: PUBLIC_CHARACTER_VERSION,
  character: { id, name, level: 4, hp: 99, ac: 24, gmNotes: 'private' }
});

test('Companion assignment is idempotent, reversible, and campaign-scoped', () => {
  let saved = assignCompanionCharacter({}, 'campaign-a', sharedRecord('shared-1', 'Ari'));
  saved = assignCompanionCharacter(saved, 'campaign-a', sharedRecord('shared-1', 'Ari Updated'));
  saved = assignCompanionCharacter(saved, 'campaign-b', sharedRecord('shared-2', 'Bo'));

  assert.deepEqual(saved.assignments, {
    'campaign-a': ['shared-1'],
    'campaign-b': ['shared-2']
  });
  assert.deepEqual(companionCharactersForCampaign(saved, 'campaign-a'), [{
    id: 'shared-1', name: 'Ari Updated', level: 4
  }]);
  assert.deepEqual(companionCharactersForCampaign(saved, 'campaign-b'), [{
    id: 'shared-2', name: 'Bo', level: 4
  }]);

  saved = unassignCompanionCharacter(saved, 'campaign-a', 'shared-1');
  assert.deepEqual(companionCharactersForCampaign(saved, 'campaign-a'), []);
  assert.deepEqual(companionCharactersForCampaign(saved, 'campaign-b'), [{
    id: 'shared-2', name: 'Bo', level: 4
  }]);
  assert.equal(saved.characters.length, 2);
});

test('campaign roster keeps native characters and never duplicates a shared identity', () => {
  const saved = assignCompanionCharacter({}, 'campaign-a', sharedRecord('native-1', 'Shared copy'));
  const roster = campaignRoster([
    { id: 'native-1', name: 'Native character', hp: 40 },
    { id: 'native-1', name: 'duplicate native' }
  ], saved, 'campaign-a');
  assert.deepEqual(roster, [{ id: 'native-1', name: 'Native character', hp: 40 }]);
  assert.equal(JSON.stringify(roster).includes('Shared copy'), false);
});

test('invalid and cross-campaign links fail closed during normalization', () => {
  const normalized = normalizeCompanionRosterState({
    characters: [sharedRecord('known', 'Known'), { public: { id: 'bad', name: '' } }],
    assignments: {
      'campaign-a': ['known', 'known', 'unknown'],
      'campaign-b': ['unknown']
    }
  });
  assert.deepEqual(normalized.assignments, { 'campaign-a': ['known'] });
  assert.deepEqual(companionCharactersForCampaign(normalized, 'campaign-b'), []);
});

test('GM read view groups linked public characters and keeps annotations separate', () => {
  const saved = normalizeCompanionRosterState({
    characters: [sharedRecord('shared-1', 'Ari'), sharedRecord('shared-2', 'Bo')],
    assignments: { 'campaign-a': ['shared-1'], 'campaign-b': ['shared-2'] },
    annotations: {
      'shared-1': { note: 'Ask about the missing map.' },
      'shared-2': { note: 'ignored if not a known character' },
      secret: { note: 'not exposed' }
    }
  });
  assert.deepEqual(companionCharactersByCampaign(saved).map(group => [group.campaignId, group.characters.map(c => c.name)]), [
    ['campaign-a', ['Ari']], ['campaign-b', ['Bo']]
  ]);
  assert.equal(companionAnnotation(saved, 'shared-1'), 'Ask about the missing map.');
  assert.equal(JSON.stringify(companionCharactersByCampaign(saved)).includes('gmNotes'), false);
  assert.equal(companionAnnotation(saved, 'secret'), '');
});

test('versioned Companion character records adapt to the public character summary', () => {
  const record = {
    contract: PUBLIC_CHARACTER_CONTRACT,
    version: PUBLIC_CHARACTER_VERSION,
    character: {
      id: 'char-ari-7', name: 'Ari', level: 7, class: 'Ranger', ancestry: 'Elf',
      hp: 99, ac: 24, saves: { fort: 14 }, gmNotes: 'secret'
    },
    ownerId: 'player-secret', gm: { notes: 'private' }
  };

  assert.deepEqual(adaptCompanionCharacter(record), {
    id: 'char-ari-7', name: 'Ari', level: 7, class: 'Ranger', ancestry: 'Elf'
  });
  assert.deepEqual(resolveCompanionCharacter([record], 'char-ari-7'),
    adaptCompanionCharacter(record));
  assert.deepEqual(contractAdapter(record), adaptCompanionCharacter(record));
  assert.deepEqual(contractResolver([record], 'char-ari-7'), adaptCompanionCharacter(record));
  assert.equal(resolveCompanionCharacter([record], 'Ari'), null);
});

test('Companion records can be supplied through the explicit public boundary input', () => {
  const projection = adaptPublicCampaignSession({ companionCharacters: [{
    contract: PUBLIC_CHARACTER_CONTRACT,
    version: PUBLIC_CHARACTER_VERSION,
    character: { id: 'shared-1', name: 'Shared Hero', level: 3 }
  }] });
  assert.deepEqual(projection.session.characters, [{ id: 'shared-1', name: 'Shared Hero', level: 3 }]);
});

test('Pathbuilder-shaped public data can be shared without duplicating ownership fields', () => {
  const record = {
    id: 'char-pri', ownerId: 'player-secret',
    publicCharacter: { id: 'char-pri', name: 'Priscilla', level: 7, class: 'Druid', ancestry: 'Leshy' },
    player: 'private owner label', ac: 24, hp: 85, gmNotes: 'private'
  };
  assert.deepEqual(adaptPublicCampaignSession({ characters: [record] }).session.characters, [{
    id: 'char-pri', name: 'Priscilla', level: 7, class: 'Druid', ancestry: 'Leshy'
  }]);
});

test('unknown Companion envelope versions fail closed', () => {
  const record = {
    contract: PUBLIC_CHARACTER_CONTRACT, version: PUBLIC_CHARACTER_VERSION + 1,
    character: { id: 'future', name: 'Future' }, ownerId: 'secret'
  };
  assert.equal(adaptCompanionCharacter(record), null);
  assert.deepEqual(adaptPublicCampaignSession({ characters: [record] }).session.characters, []);
});

test('the public session remains the versioned allowlisted envelope', () => {
  const projection = adaptPublicCampaignSession({ characters: [{
    public: { id: 'char-1', name: 'Ari', level: 2 }, ownerId: 'secret', gmNotes: 'secret'
  }] });
  assert.deepEqual(projection.session.characters, [{ id: 'char-1', name: 'Ari', level: 2 }]);
  assert.equal(isPublicCampaignSession(projection), true);
  assert.equal(JSON.stringify(projection).includes('ownerId'), false);
  assert.equal(JSON.stringify(projection).includes('gmNotes'), false);
});
