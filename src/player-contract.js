// Versioned, public-only adapter between GM state and Companion-facing data.
// Keep transport concerns (BroadcastChannel/window messages) out of this module.

export const PUBLIC_CONTRACT = 'pf2e-companion/public-campaign-session';
export const PUBLIC_CONTRACT_VERSION = 1;
export const PUBLIC_PHASES = Object.freeze(['downtime', 'exploration', 'combat']);

const object = value => value && typeof value === 'object' && !Array.isArray(value);

export function isPublicPhase(value) {
  return PUBLIC_PHASES.includes(value);
}

function publicPhase(value) {
  return isPublicPhase(value) ? value : PUBLIC_PHASES[0];
}

function publicRevision(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function publicPlayerSettings(saved) {
  const entries = object(saved?.entries) ? saved.entries : {};
  const clean = {};
  for (const [id, entry] of Object.entries(entries)) {
    if (id === '__proto__' || id === 'prototype' || id === 'constructor') continue;
    if (!object(entry) || entry.revealed !== true) continue;
    clean[id] = {
      token: typeof entry.token === 'string' ? entry.token.slice(0, 80) : '',
      name: typeof entry.name === 'string' ? entry.name.slice(0, 80).trim() : ''
    };
  }
  return clean;
}

function publicActors(combat, settings) {
  const combatants = Array.isArray(combat?.combatants) ? combat.combatants : [];
  const byId = new Map(combatants.filter(c => typeof c?.id === 'string').map(c => [c.id, c]));
  const ordered = Array.isArray(combat?.order) && combat.order.length
    ? combat.order.map(id => byId.get(id)).filter(Boolean)
    : combatants.slice();
  for (const combatant of combatants) if (!ordered.includes(combatant)) ordered.push(combatant);

  return ordered.flatMap((combatant, index) => {
    const setting = settings[combatant?.id];
    if (!setting) return [];
    return [{
      // This is a public alias, never the GM combatant/source id.
      id: setting.token || `public-${index + 1}`,
      name: setting.name || 'Participant',
      active: combatant.id === combat?.activeId,
      order: index + 1
    }];
  }).map((actor, index) => ({ ...actor, order: index + 1 }));
}

/**
 * Map legacy GM state into the v1 public campaign/session contract.
 * Only explicitly allowlisted fields are copied; unknown GM fields are ignored.
 */
export function adaptPublicCampaignSession({ campaign, combat, player, session, revision } = {}) {
  return {
    contract: PUBLIC_CONTRACT,
    version: PUBLIC_CONTRACT_VERSION,
    revision: publicRevision(revision ?? session?.revision),
    campaign: {
      title: typeof campaign?.title === 'string' ? campaign.title.slice(0, 120) : ''
    },
    session: {
      phase: publicPhase(session?.phase),
      round: Number.isFinite(combat?.round) ? combat.round : 0,
      actors: publicActors(combat, publicPlayerSettings(player))
    }
  };
}

/** Serialize only the already-adapted public contract. */
export function serializePublicCampaignSession(input) {
  return JSON.stringify(adaptPublicCampaignSession(input));
}

export function isPublicCampaignSession(value) {
  return value?.contract === PUBLIC_CONTRACT && value.version === PUBLIC_CONTRACT_VERSION &&
    Number.isInteger(value.revision) && value.revision >= 0 &&
    object(value.campaign) && typeof value.campaign.title === 'string' &&
    object(value.session) && isPublicPhase(value.session.phase) && Number.isFinite(value.session.round) &&
    Array.isArray(value.session.actors);
}
