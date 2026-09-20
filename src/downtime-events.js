// GM-owned downtime activities, opportunities, and results. Only explicitly
// published records and explicitly public result text cross the player boundary.

export const DOWNTIME_RECORD_KINDS = Object.freeze([
  'activity', 'opportunity', 'result'
]);

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : '';
const text = (value, max) => typeof value === 'string' ? value.slice(0, max).trim() : '';

function revision(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function publicField(value, name, max) {
  const nested = object(value.public) ? value.public : {};
  return text(value[`public${name[0].toUpperCase()}${name.slice(1)}`] ?? nested[name] ?? value[name], max);
}

function publicResultText(value) {
  const nested = object(value.public) ? value.public : {};
  const result = object(value.result) ? value.result : {};
  const explicit = value.publicResultText ?? value.resultText ?? nested.resultText ?? result.publicText ??
    (result.public === true || result.revealed === true ? result.text : undefined);
  return text(explicit, 1000);
}

function cleanRecord(value) {
  if (!object(value)) return null;
  const recordId = id(value.publicId ?? value.id);
  const kind = DOWNTIME_RECORD_KINDS.includes(value.type)
    ? value.type
    : (DOWNTIME_RECORD_KINDS.includes(value.kind) ? value.kind : '');
  const title = publicField(value, 'title', 160);
  const body = publicField(value, 'text', 1000);
  const description = publicField(value, 'description', 1000);
  const resultText = publicResultText(value);
  if (!recordId || !kind || (!title && !body && !description && !resultText)) return null;
  return {
    id: recordId,
    kind,
    title,
    ...(body ? { text: body } : {}),
    ...(description ? { description } : {}),
    ...(resultText ? { publicResultText: resultText } : {}),
    published: value.published === true,
    revision: revision(value.revision)
  };
}

function sourceRecords(value) {
  if (Array.isArray(value)) return value;
  if (!object(value)) return [];
  return Array.isArray(value.records) ? value.records
    : Array.isArray(value.entries) ? value.entries
      : Array.isArray(value.events) ? value.events : [];
}

export function normalizeDowntimeRecords(records) {
  const seen = new Set();
  return sourceRecords(records).flatMap(record => {
    const clean = cleanRecord(record);
    if (!clean || seen.has(clean.id)) return [];
    seen.add(clean.id);
    return [clean];
  });
}

export function normalizeDowntime(saved) {
  return { records: normalizeDowntimeRecords(saved) };
}

function result(next, status, record, actualRevision = record?.revision ?? 0) {
  return record
    ? { ok: true, status, state: next, record, revision: record.revision }
    : { ok: false, status, state: next, actualRevision };
}

function apply(saved, input, expectedRevision, published, requireExisting) {
  const next = normalizeDowntimeRecords(saved);
  const clean = cleanRecord({ ...input, published });
  if (!clean) return result(next, 'invalid', null);

  const index = next.findIndex(record => record.id === clean.id);
  const current = index === -1 ? null : next[index];
  const actualRevision = current?.revision ?? 0;
  if ((requireExisting && !current) || (expectedRevision !== undefined && expectedRevision !== actualRevision)) {
    return { ok: false, status: 'conflict', state: next, current, actualRevision };
  }

  if (current && current.id === clean.id && current.kind === clean.kind &&
      current.title === clean.title && current.text === clean.text &&
      current.description === clean.description && current.publicResultText === clean.publicResultText &&
      current.published === clean.published) {
    return result(next, 'unchanged', current);
  }

  clean.revision = current ? actualRevision + 1 : 1;
  if (index === -1) next.push(clean);
  else next[index] = clean;
  return result(next, current ? 'updated' : 'published', clean);
}

/** Add a new public record or publish an existing withdrawn record. */
export function publishDowntimeRecord(saved, record, expectedRevision) {
  return apply(saved, record, expectedRevision, true, false);
}

/** Update a published or private record using the revision the GM read. */
export function updateDowntimeRecord(saved, record, expectedRevision) {
  const current = normalizeDowntimeRecords(saved).find(item => item.id === id(record?.publicId ?? record?.id));
  return apply(saved, record, expectedRevision, current?.published === true, true);
}

/** Withdraw a record while retaining its tombstone and revision in GM state. */
export function withdrawDowntimeRecord(saved, recordId, expectedRevision) {
  const next = normalizeDowntimeRecords(saved);
  const index = next.findIndex(record => record.id === id(recordId));
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

/** Allowlist the fields that may cross the GM/player boundary. */
export function publicDowntimeRecords(records) {
  return normalizeDowntimeRecords(records).filter(record => record.published).map(record => ({
    id: record.id,
    kind: record.kind,
    title: record.title,
    ...(record.text ? { text: record.text } : {}),
    ...(record.description ? { description: record.description } : {}),
    ...(record.publicResultText ? { resultText: record.publicResultText } : {}),
    revision: record.revision
  }));
}

// Naming aliases keep the module usable beside the existing exploration-event
// source while the public contract refers to these as downtime entries.
export const normalizeDowntimeEvents = normalizeDowntimeRecords;
export const publicDowntimeEvents = publicDowntimeRecords;
export const publishDowntimeEvent = publishDowntimeRecord;
export const updateDowntimeEvent = updateDowntimeRecord;
export const withdrawDowntimeEvent = withdrawDowntimeRecord;
