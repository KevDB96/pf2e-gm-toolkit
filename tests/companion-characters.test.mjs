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
