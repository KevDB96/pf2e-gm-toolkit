import { isPublicCampaignSession } from './player-contract.js';

export const PLAYER_TRANSPORT = 'pf2e-companion/session-transport';
export const PLAYER_TRANSPORT_VERSION = 1;

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

/** Build the only payload that may cross the GM/player transport boundary. */
export function createPlayerSnapshot(projection) {
  if (!isPublicCampaignSession(projection)) return null;
  return {
    transport: PLAYER_TRANSPORT,
    version: PLAYER_TRANSPORT_VERSION,
    kind: 'snapshot',
    projection
  };
}

export function createPlayerRequest() {
  return {
    transport: PLAYER_TRANSPORT,
    version: PLAYER_TRANSPORT_VERSION,
    kind: 'snapshot-request'
  };
}

export function isPlayerRequest(value) {
  return object(value) && value.transport === PLAYER_TRANSPORT &&
    value.version === PLAYER_TRANSPORT_VERSION && value.kind === 'snapshot-request' &&
    Object.keys(value).every(key => ['transport', 'version', 'kind'].includes(key));
}

export function isPlayerSnapshot(value) {
  return object(value) && value.transport === PLAYER_TRANSPORT &&
    value.version === PLAYER_TRANSPORT_VERSION && value.kind === 'snapshot' &&
    Object.keys(value).every(key => ['transport', 'version', 'kind', 'projection'].includes(key)) &&
    isPublicCampaignSession(value.projection);
}

function revision(value) {
  return Number.isInteger(value?.projection?.revision) && value.projection.revision >= 0
    ? value.projection.revision
    : null;
}

/** Accept valid envelopes only when they advance the rendered public revision. */
export function acceptPlayerSnapshot(current, incoming) {
  if (!isPlayerSnapshot(incoming)) return current;
  const currentRevision = revision(current);
  const incomingRevision = revision(incoming);
  if (currentRevision !== null && incomingRevision <= currentRevision) return current;
  return incoming;
}
