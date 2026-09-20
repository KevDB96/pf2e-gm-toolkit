// GM-owned exploration discoveries and objectives. Only explicitly published
// records are eligible for the Player Companion projection.

export const EXPLORATION_EVENT_KINDS = Object.freeze([
  'location', 'discovery', 'objective', 'event'
]);

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : '';
const text = (value, max) => typeof value === 'string' ? value.slice(0, max).trim() : '';

function revision(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function cleanEvent(value) {
  if (!object(value)) return null;
  const eventId = id(value.id);
  const kind = EXPLORATION_EVENT_KINDS.includes(value.kind) ? value.kind : 'event';
  const title = text(value.title, 160);
  const description = text(value.description, 1000);
  if (!eventId || (!title && !description)) return null;
  return {
    id: eventId,
    kind,
    title,
    description,
    published: value.published === true,
    revision: revision(value.revision)
  };
}

export function normalizeExplorationEvents(events) {
  if (!Array.isArray(events)) return [];
  const seen = new Set();
  return events.flatMap(event => {
    const clean = cleanEvent(event);
    if (!clean || seen.has(clean.id)) return [];
    seen.add(clean.id);
    return [clean];
  });
}

function result(next, status, event, actualRevision = event?.revision ?? 0) {
  return event
    ? { ok: true, status, state: next, event, revision: event.revision }
    : { ok: false, status, state: next, actualRevision };
}

function apply(saved, input, expectedRevision, published, requireExisting) {
  const next = normalizeExplorationEvents(saved);
  const clean = cleanEvent({ ...input, published });
  if (!clean) return result(next, 'invalid', null);

  const index = next.findIndex(event => event.id === clean.id);
  const current = index === -1 ? null : next[index];
  const actualRevision = current?.revision ?? 0;
  if ((requireExisting && !current) || (expectedRevision !== undefined && expectedRevision !== actualRevision)) {
    return { ok: false, status: 'conflict', state: next, current, actualRevision };
  }

  if (current && current.title === clean.title && current.description === clean.description
      && current.kind === clean.kind && current.published === clean.published) {
    return result(next, 'unchanged', current);
  }

  clean.revision = current ? actualRevision + 1 : 1;
  if (index === -1) next.push(clean);
  else next[index] = clean;
  return result(next, current ? 'updated' : 'published', clean);
}

/** Add a new player-safe event or publish an existing withdrawn event. */
export function publishExplorationEvent(saved, event, expectedRevision) {
  return apply(saved, event, expectedRevision, true, false);
}

/** Update a published or private event using the revision the GM read. */
export function updateExplorationEvent(saved, event, expectedRevision) {
  const current = normalizeExplorationEvents(saved).find(item => item.id === id(event?.id));
  return apply(saved, event, expectedRevision, current?.published === true, true);
}

/** Withdraw an event while retaining its tombstone and revision in GM state. */
export function withdrawExplorationEvent(saved, eventId, expectedRevision) {
  const next = normalizeExplorationEvents(saved);
  const index = next.findIndex(event => event.id === id(eventId));
  const current = index === -1 ? null : next[index];
  const actualRevision = current?.revision ?? 0;
  if (!current || (expectedRevision !== undefined && expectedRevision !== actualRevision)) {
    return { ok: false, status: 'conflict', state: next, current, actualRevision };
  }
  if (!current.published) return result(next, 'unchanged', current);
  const withdrawn = { ...current, published: false, revision: actualRevision + 1 };
  next[index] = withdrawn;
  return result(next, 'withdrawn', withdrawn);
}

/** Allowlist the fields that may cross the GM/Companion boundary. */
export function publicExplorationEvents(events) {
  return normalizeExplorationEvents(events).filter(event => event.published).map(event => ({
    id: event.id,
    kind: event.kind,
    title: event.title,
    ...(event.description ? { description: event.description } : {}),
    revision: event.revision
  }));
}
