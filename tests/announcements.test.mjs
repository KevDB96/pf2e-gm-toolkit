import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dismissAnnouncement,
  expireAnnouncement,
  normalizeAnnouncements,
  publishAnnouncement,
  publicAnnouncements,
  updateAnnouncement
} from '../src/announcements.js';

const notice = (overrides = {}) => ({
  id: 'notice-1', campaignId: 'mists', title: 'At the table', message: 'Meet at the bridge.',
  createdAt: 100, ...overrides
});

test('announcements publish, update, expire, and dismiss with revisions', () => {
  const first = publishAnnouncement([], notice({ sourceId: 'gm-private', gmNotes: 'secret' }));
  assert.equal(first.status, 'published');
  assert.equal(first.revision, 1);
  assert.equal(JSON.stringify(first.announcement).includes('gm-private'), false);

  const updated = updateAnnouncement(first.state,
    notice({ message: 'Meet at the old bridge.', updatedAt: 200 }), 1);
  assert.equal(updated.status, 'updated');
  assert.equal(updated.revision, 2);
  assert.deepEqual(publicAnnouncements(updated.state, 'mists', 250), [{
    id: 'notice-1', title: 'At the table', message: 'Meet at the old bridge.', revision: 2,
    createdAt: 100, updatedAt: 200
  }]);

  const stale = updateAnnouncement(updated.state, notice({ message: 'Wrong' }), 1);
  assert.equal(stale.status, 'conflict');
  assert.equal(stale.actualRevision, 2);

  const expired = expireAnnouncement(updated.state, 'notice-1', 2);
  assert.equal(expired.status, 'expired');
  assert.deepEqual(publicAnnouncements(expired.state, 'mists', 250), []);

  const second = publishAnnouncement(expired.state, notice({ id: 'notice-2', message: 'Bring maps.' }));
  const dismissed = dismissAnnouncement(second.state, 'notice-2', 1);
  assert.equal(dismissed.status, 'dismissed');
  assert.deepEqual(publicAnnouncements(dismissed.state, 'mists', 250), []);
});

test('public announcements expire, order, sanitize, and isolate campaigns', () => {
  const saved = normalizeAnnouncements([
    notice({ id: 'old', title: 'Older', createdAt: 100, expiresAt: 500, published: true }),
    notice({ id: 'new', title: 'Newer', createdAt: 200, updatedAt: 300, published: true,
      publicMessage: 'Visible only.', sender: 'GM', sourceId: 'secret-source' }),
    notice({ id: 'other-campaign', campaignId: 'other', published: true }),
    notice({ id: 'private', published: false }),
    notice({ id: 'dismissed', status: 'dismissed', published: true })
  ]);

  assert.deepEqual(publicAnnouncements(saved, 'mists', 500), [{
    id: 'new', title: 'Newer', message: 'Visible only.', revision: 0,
    createdAt: 200, updatedAt: 300
  }]);
  const serialized = JSON.stringify(publicAnnouncements(saved, 'mists', 250));
  assert.equal(serialized.includes('secret-source'), false);
  assert.equal(serialized.includes('other-campaign'), false);
  assert.deepEqual(publicAnnouncements(saved, 'other', 250).map(item => item.id), ['other-campaign']);
});
