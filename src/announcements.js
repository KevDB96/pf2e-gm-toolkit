// GM-authored, campaign-scoped notices. Only the allowlisted public fields cross
// into the Player Companion projection.

export const ANNOUNCEMENT_STATUSES = Object.freeze([
  'draft', 'published', 'expired', 'dismissed'
]);

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' ? value.slice(0, max).trim() : '';

function id(value) {
  return text(value, 120);
}

function timestamp(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function cleanAnnouncement(value) {
  if (!object(value)) return null;
  const announcementId = id(value.publicId ?? value.id);
  const campaignId = id(value.campaignId);
  const title = text(value.publicTitle ?? value.title, 160);
  const message = text(value.publicMessage ?? value.message ?? value.body, 2000);
  if (!announcementId || !campaignId || (!title && !message)) return null;

  const createdAt = timestamp(value.createdAt);
  const updatedAt = timestamp(value.updatedAt);
  const expiresAt = timestamp(value.expiresAt);
  const dismissedAt = timestamp(value.dismissedAt);
  const status = ANNOUNCEMENT_STATUSES.includes(value.status)
    ? value.status : (value.published === true ? 'published' : 'draft');
  return {
    id: announcementId,
    campaignId,
    title,
    message,
    status,
    revision: Number.isInteger(value.revision) && value.revision >= 0 ? value.revision : 0,
    ...(createdAt === null ? {} : { createdAt }),
    ...(updatedAt === null ? {} : { updatedAt }),
    ...(expiresAt === null ? {} : { expiresAt }),
    ...(dismissedAt === null ? {} : { dismissedAt })
  };
}

function sourceAnnouncements(value) {
  if (Array.isArray(value)) return value;
  return object(value) && Array.isArray(value.items) ? value.items : [];
}

export function normalizeAnnouncements(saved) {
  const seen = new Set();
  return sourceAnnouncements(saved).flatMap(value => {
    const clean = cleanAnnouncement(value);
    if (!clean || seen.has(clean.id)) return [];
    seen.add(clean.id);
    return [clean];
  });
}

export function normalizeAnnouncementState(saved) {
  return { items: normalizeAnnouncements(saved) };
}

function result(state, status, announcement, actualRevision = announcement?.revision ?? 0) {
  return announcement
    ? { ok: true, status, state, announcement, revision: announcement.revision }
    : { ok: false, status, state, actualRevision };
}

function apply(saved, input, expectedRevision, status, requireExisting) {
  const next = normalizeAnnouncements(saved);
  const clean = cleanAnnouncement({ ...input, status });
  if (!clean) return result(next, 'invalid', null);
  const index = next.findIndex(item => item.id === clean.id);
  const current = index === -1 ? null : next[index];
  const actualRevision = current?.revision ?? 0;
  if ((requireExisting && !current) ||
      (expectedRevision !== undefined && expectedRevision !== actualRevision)) {
    return { ok: false, status: 'conflict', state: next, current, actualRevision };
  }
  const same = current && ['campaignId', 'title', 'message', 'status', 'createdAt', 'updatedAt',
    'expiresAt', 'dismissedAt'].every(field => current[field] === clean[field]);
  if (same) return result(next, 'unchanged', current);
  clean.revision = current ? actualRevision + 1 : 1;
  if (index === -1) next.push(clean);
  else next[index] = clean;
  return result(next, current ? 'updated' : 'published', clean);
}

export function publishAnnouncement(saved, announcement, expectedRevision) {
  return apply(saved, announcement, expectedRevision, 'published', false);
}

export function updateAnnouncement(saved, announcement, expectedRevision) {
  const current = normalizeAnnouncements(saved).find(item => item.id === id(announcement?.publicId ?? announcement?.id));
  return apply(saved, announcement, expectedRevision, current?.status ?? 'draft', true);
}

export function expireAnnouncement(saved, announcementId, expectedRevision) {
  return applyStatus(saved, announcementId, expectedRevision, 'expired');
}

export function dismissAnnouncement(saved, announcementId, expectedRevision) {
  return applyStatus(saved, announcementId, expectedRevision, 'dismissed');
}

function applyStatus(saved, announcementId, expectedRevision, status) {
  const next = normalizeAnnouncements(saved);
  const index = next.findIndex(item => item.id === id(announcementId));
  const current = index === -1 ? null : next[index];
  const actualRevision = current?.revision ?? 0;
  if (!current || (expectedRevision !== undefined && expectedRevision !== actualRevision)) {
    return { ok: false, status: 'conflict', state: next, current, actualRevision };
  }
  if (current.status === status) return result(next, 'unchanged', current);
  const changed = { ...current, status, revision: actualRevision + 1 };
  next[index] = changed;
  return result(next, status, changed);
}

function order(left, right) {
  return (right.updatedAt ?? right.createdAt ?? 0) - (left.updatedAt ?? left.createdAt ?? 0) ||
    (right.createdAt ?? 0) - (left.createdAt ?? 0) || left.id.localeCompare(right.id);
}

/** Return only active notices for one campaign, in deterministic newest-first order. */
export function publicAnnouncements(saved, campaignId, now = Date.now()) {
  const scope = id(campaignId);
  return normalizeAnnouncements(saved).filter(item => item.campaignId === scope &&
    item.status === 'published' && item.dismissedAt === undefined &&
    (item.expiresAt === undefined || item.expiresAt > now)).sort(order).map(item => ({
      id: item.id,
      title: item.title,
      message: item.message,
      revision: item.revision,
      ...(item.createdAt === undefined ? {} : { createdAt: item.createdAt }),
      ...(item.updatedAt === undefined ? {} : { updatedAt: item.updatedAt }),
      ...(item.expiresAt === undefined ? {} : { expiresAt: item.expiresAt })
    }));
}
