// Compatibility facade for the public contract. New boundary code belongs in
// player-contract.js; this file preserves the existing display API for the GM UI.
import { adaptPublicCampaignSession, isPublicCampaignSession } from './player-contract.js';

export const PLAYER_CHANNEL = 'pf2e-gm-toolkit/player-v1';

const object = value => value && typeof value === 'object' && !Array.isArray(value);

export function normalizePlayer(saved) {
  const entries = object(saved?.entries) ? saved.entries : {};
  const clean = {};
  for (const [id, entry] of Object.entries(entries)) {
    if (id === '__proto__' || id === 'prototype' || id === 'constructor') continue;
    if (!object(entry)) continue;
    clean[id] = {
      token: typeof entry.token === 'string' ? entry.token : '',
      revealed: entry.revealed === true,
      name: typeof entry.name === 'string' ? entry.name.slice(0, 80) : ''
    };
  }
  return { entries: clean };
}

/** Return a deliberately small, public-only snapshot for the player display. */
export function projectPlayerState(combat, player, session) {
  const contract = adaptPublicCampaignSession({ combat, player, session });
  return {
    version: contract.version,
    revision: contract.revision,
    ...contract.session
  };
}

export function isPlayerSnapshot(value) {
  return value?.kind === 'snapshot' && value.channel === PLAYER_CHANNEL && (
    isPublicCampaignSession(value.projection) ||
    (value.projection?.version === 1 && Array.isArray(value.projection.actors) &&
      Number.isFinite(value.projection.round))
  );
}

/** Player messages are requests for a read-only snapshot, never commands. */
export function isPlayerRequest(value) {
  return value?.kind === 'player-request' &&
    (!value.channel || value.channel === PLAYER_CHANNEL);
}

function snapshotRevision(value) {
  const projection = value?.projection;
  return Number.isInteger(projection?.revision) && projection.revision >= 0
    ? projection.revision
    : null;
}

/** Accept only valid snapshots newer than the one already rendered. */
export function acceptPlayerSnapshot(current, incoming) {
  if (!isPlayerSnapshot(incoming)) return current;
  const currentRevision = snapshotRevision(current);
  const incomingRevision = snapshotRevision(incoming);
  if (currentRevision !== null && (incomingRevision === null || incomingRevision <= currentRevision)) {
    return current;
  }
  return incoming;
}
