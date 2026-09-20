import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SESSION_RECAP_VERSION,
  isSessionRecap,
  normalizeSessionRecap
} from '../src/session-recap.js';
import {
  adaptPublicCampaignSession,
  isPublicCampaignSession
} from '../src/player-contract.js';

test('recap normalization provides versioned empty, published, and updated states', () => {
  const empty = normalizeSessionRecap();
  assert.deepEqual(empty, { version: SESSION_RECAP_VERSION, status: 'empty', revision: 0, title: '', body: '' });
  assert.deepEqual(normalizeSessionRecap({ title: 'After', body: 'The party escaped.' }), {
    version: 1, status: 'published', revision: 0, title: 'After', body: 'The party escaped.'
  });
  const updated = normalizeSessionRecap({ status: 'updated', revision: 3, title: 'After', body: 'They returned.' });
  assert.equal(updated.status, 'updated');
  assert.equal(updated.revision, 3);
  assert.equal(isSessionRecap(updated), true);
});

test('public recap projection copies only safe recap fields and validates the envelope', () => {
  const projection = adaptPublicCampaignSession({
    session: { recap: {
      status: 'updated', revision: 2, title: 'The return', body: 'The party made it home.',
      gmNotes: 'secret', sourceId: 'internal', privateTimer: 900
    } },
    campaign: { gmNotes: 'do not copy' }
  });
  assert.deepEqual(projection.session.recap, {
    version: 1, status: 'updated', revision: 2, title: 'The return', body: 'The party made it home.'
  });
  assert.equal(isPublicCampaignSession(projection), true);
  const serialized = JSON.stringify(projection);
  for (const secret of ['gmNotes', 'sourceId', 'privateTimer', 'internal', 'secret']) {
    assert.equal(serialized.includes(secret), false, `leaked ${secret}`);
  }
});

test('recap input is bounded and empty content cannot publish private fields', () => {
  const projection = adaptPublicCampaignSession({
    recap: { status: 'published', title: 4, body: '', notes: 'private' }
  });
  assert.deepEqual(projection.session.recap, {
    version: 1, status: 'empty', revision: 0, title: '', body: ''
  });
  assert.equal(isPublicCampaignSession(projection), true);
  assert.equal(isSessionRecap({ ...projection.session.recap, extra: 'nope' }), false);
});
