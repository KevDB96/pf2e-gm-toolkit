import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeCharacterImport } from '../src/character-revisions.js';
import {
  assignCompanionCharacter,
  companionCharactersForCampaign,
  updateCompanionCharacter
} from '../src/companion-rosters.js';
import {
  PUBLIC_CHARACTER_CONTRACT,
  PUBLIC_CHARACTER_VERSION
} from '../src/companion-characters.js';

const record = (id, name, revision = 0) => ({
  contract: PUBLIC_CHARACTER_CONTRACT,
  version: PUBLIC_CHARACTER_VERSION,
  revision,
  character: { id, name, level: 4, hp: 99, gmNotes: 'private' }
});

test('concurrent Companion updates reject a stale revision and preserve the newer record', () => {
  const initial = assignCompanionCharacter({}, 'campaign-a', record('shared-1', 'Ari'));
  const first = updateCompanionCharacter(initial, 'campaign-a', record('shared-1', 'Ari One'), 0);
  assert.equal(first.ok, true);
  assert.equal(first.status, 'updated');
  assert.equal(first.revision, 1);

  const stale = updateCompanionCharacter(first.state, 'campaign-a', record('shared-1', 'Ari Stale'), 0);
  assert.equal(stale.ok, false);
  assert.equal(stale.status, 'conflict');
  assert.equal(stale.actualRevision, 1);
  assert.equal(companionCharactersForCampaign(stale.state, 'campaign-a')[0].name, 'Ari One');
  assert.equal(JSON.stringify(stale.state).includes('gmNotes'), false);
});

test('a conflict can refresh and retry against the returned revision', () => {
  const initial = assignCompanionCharacter({}, 'campaign-a', record('shared-1', 'Ari'));
  const newer = updateCompanionCharacter(initial, 'campaign-a', record('shared-1', 'Ari Newer'), 0);
  const conflict = updateCompanionCharacter(newer.state, 'campaign-a', record('shared-1', 'Ari Retry'), 0);
  const retry = updateCompanionCharacter(conflict.state, 'campaign-a', record('shared-1', 'Ari Retry'), conflict.actualRevision);
  assert.equal(retry.ok, true);
  assert.equal(retry.status, 'updated');
  assert.equal(companionCharactersForCampaign(retry.state, 'campaign-a')[0].name, 'Ari Retry');
});

test('repeated imports are idempotent and do not consume a revision', () => {
  const first = mergeCharacterImport({ characters: [] }, { id: 'ari', name: 'Ari', level: 4 });
  assert.equal(first.status, 'added');
  assert.equal(first.revision, 0);

  const repeated = mergeCharacterImport(first.file, { id: 'ari', name: 'Ari', level: 4 });
  assert.equal(repeated.ok, true);
  assert.equal(repeated.status, 'unchanged');
  assert.equal(repeated.file, first.file);

  const updated = mergeCharacterImport(first.file, { id: 'ari', name: 'Ari', level: 5 }, { expectedRevision: 0 });
  assert.equal(updated.status, 'updated');
  assert.equal(updated.revision, 1);

  const stale = mergeCharacterImport(updated.file, { id: 'ari', name: 'Ari', level: 6 }, { expectedRevision: 0 });
  assert.equal(stale.ok, false);
  assert.equal(stale.status, 'conflict');
  assert.equal(stale.file, updated.file);
  assert.equal(updated.file.characters[0].level, 5);
});
