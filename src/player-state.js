// The only data allowed across the GM/player boundary.
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
export function projectPlayerState(combat, player) {
  const entries = normalizePlayer(player).entries;
  const combatants = Array.isArray(combat?.combatants) ? combat.combatants : [];
  const order = Array.isArray(combat?.order) && combat.order.length
    ? combat.order.map(id => combatants.find(c => c?.id === id)).filter(Boolean)
    : combatants.slice();
  for (const combatant of combatants) if (!order.includes(combatant)) order.push(combatant);

  const actors = [];
  for (const combatant of order) {
    const entry = entries[combatant?.id];
    if (!entry?.revealed) continue;
    actors.push({
      id: entry.token || `public-${actors.length + 1}`,
      name: entry.name.trim() || String(combatant.name || 'Participant'),
      active: combatant.id === combat?.activeId,
      order: actors.length + 1
    });
  }
  return {
    version: 1,
    round: Number.isFinite(combat?.round) ? combat.round : 0,
    actors
  };
}

export function isPlayerSnapshot(value) {
  return value?.kind === 'snapshot' && value.channel === PLAYER_CHANNEL &&
    value.projection?.version === 1 && Array.isArray(value.projection.actors) &&
    Number.isFinite(value.projection.round);
}
