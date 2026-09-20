// Small, player-facing recap value. Keep this separate from GM notes so the
// public contract can copy only the deliberately allowlisted fields.

export const SESSION_RECAP_VERSION = 1;
export const SESSION_RECAP_STATUSES = Object.freeze(['empty', 'published', 'updated']);

const object = value => value && typeof value === 'object' && !Array.isArray(value);

function text(value, max) {
  return typeof value === 'string' ? value.slice(0, max).trim() : '';
}

function revision(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

/** Normalize a GM-owned value into the complete public recap envelope. */
export function normalizeSessionRecap(value) {
  const source = object(value) ? value : {};
  const title = text(source.title, 120);
  const body = text(source.body, 4000);
  const hasContent = Boolean(title || body);
  const requested = SESSION_RECAP_STATUSES.includes(source.status) ? source.status : null;
  const status = !hasContent ? 'empty' : requested === 'updated' ? 'updated' : 'published';
  return {
    version: SESSION_RECAP_VERSION,
    status,
    revision: revision(source.revision),
    title,
    body
  };
}

export function isSessionRecap(value) {
  return object(value) &&
    Object.keys(value).length === 5 &&
    value.version === SESSION_RECAP_VERSION &&
    SESSION_RECAP_STATUSES.includes(value.status) &&
    Number.isInteger(value.revision) && value.revision >= 0 &&
    typeof value.title === 'string' && value.title.length <= 120 &&
    typeof value.body === 'string' && value.body.length <= 4000 &&
    (value.status === 'empty' ? !value.title && !value.body : Boolean(value.title || value.body));
}
