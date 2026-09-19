// Compatibility facade for the public contract. New boundary code belongs in
// player-contract.js; this file preserves the existing display API for the GM UI.
import { adaptPublicCampaignSession } from './player-contract.js';
import {
  createPlayerRequest,
  createPlayerSnapshot,
  isPlayerRequest,
  isPlayerSnapshot,
  acceptPlayerSnapshot
} from './player-transport.js';

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

export { createPlayerRequest, createPlayerSnapshot, isPlayerRequest, isPlayerSnapshot,
  acceptPlayerSnapshot };
