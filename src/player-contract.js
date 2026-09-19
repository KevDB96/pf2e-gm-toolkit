// Versioned, public-only adapter between GM state and Companion-facing data.
// Keep transport concerns (BroadcastChannel/window messages) out of this module.
import { CREATURE_VISIBILITY, creatureVisibilityPolicy } from './creature-visibility.js';

export const PUBLIC_CONTRACT = 'pf2e-companion/public-campaign-session';
export const PUBLIC_CONTRACT_VERSION = 2;
export const PUBLIC_PHASES = Object.freeze(['downtime', 'exploration', 'combat']);

const object = value => value && typeof value === 'object' && !Array.isArray(value);

const PUBLIC_STATUSES = Object.freeze(['planned', 'active', 'complete']);

function publicText(value, max = 120) {
  return typeof value === 'string' ? value.slice(0, max).trim() : '';
}

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
    if (!object(entry)) continue;
    clean[id] = {
      token: typeof entry.token === 'string' ? entry.token.slice(0, 80) : '',
      name: typeof entry.name === 'string' ? entry.name.slice(0, 80).trim() : '',
      conditions: entry.conditions === true || entry.revealConditions === true,
      identity: ['hidden', 'unknown', 'revealed'].includes(entry.identity)
        ? entry.identity : (entry.revealed === true ? 'revealed' : 'hidden'),
      imageVisible: entry.imageVisible === true
    };
  }
  return clean;
}

function publicConditions(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(condition => typeof condition === 'string')
    .map(condition => publicText(condition, 80))
    .filter(Boolean)
    .slice(0, 20);
}

function publicLabels(value) {
  const values = Array.isArray(value) ? value : [value];
  return values.filter(label => typeof label === 'string')
    .map(label => publicText(label, 80))
    .filter(Boolean)
    .slice(0, 20);
}

function publicCreatureMetadata(combatant, policy) {
  if (!policy.metadata) return {};
  const metadata = {};
  const description = publicText(combatant?.publicDescription, 500);
  const role = publicText(combatant?.publicRole, 80);
  const traits = publicLabels(combatant?.publicTraits);
  const status = publicLabels(combatant?.publicStatus);
  if (description) metadata.description = description;
  if (role) metadata.role = role;
  if (traits.length) metadata.traits = traits;
  if (status.length) metadata.status = status;
  return metadata;
}

function publicEncounter(encounter) {
  if (!object(encounter)) return { title: '', status: 'planned' };
  const status = PUBLIC_STATUSES.includes(encounter.status) ? encounter.status : 'planned';
  return {
    title: publicText(encounter.title ?? encounter.name),
    status
  };
}

function publicCharacters(characters) {
  if (!Array.isArray(characters)) return [];
  return characters.flatMap((character, index) => {
    if (!object(character) || (character.public !== true && character.revealed !== true)) return [];
    const name = publicText(character.publicName ?? character.name, 80);
    if (!name) return [];
    const summary = {
      id: publicText(character.token, 80) || `character-${index + 1}`,
      name
    };
    if (Number.isInteger(character.level) && character.level >= -1 && character.level <= 30) {
      summary.level = character.level;
    }
    for (const field of ['class', 'ancestry']) {
      const value = publicText(character[field], 80);
      if (value) summary[field] = value;
    }
    return [summary];
  });
}

function publicNotes(notes) {
  if (!Array.isArray(notes)) return [];
  return notes.flatMap(note => {
    if (!object(note) || note.public !== true) return [];
    const title = publicText(note.title, 120);
    const body = publicText(note.body, 500);
    if (!title && !body) return [];
    return [{ title, body }];
  }).slice(0, 50);
}

function publicEvents(events) {
  if (!Array.isArray(events)) return [];
  return events.flatMap(event => {
    if (!object(event) || event.public !== true) return [];
    const message = publicText(event.message ?? event.title, 240);
    return message ? [{ message }] : [];
  }).slice(0, 50);
}

function publicActors(combat, settings) {
  const combatants = Array.isArray(combat?.combatants) ? combat.combatants : [];
  const byId = new Map(combatants.filter(c => typeof c?.id === 'string').map(c => [c.id, c]));
  const ordered = [];
  const seenIds = new Set();
  const add = id => {
    if (typeof id !== 'string' || seenIds.has(id)) return;
    const combatant = byId.get(id);
    if (!combatant) return;
    seenIds.add(id);
    ordered.push(combatant);
  };
  if (Array.isArray(combat?.order) && combat.order.length) {
    for (const id of combat.order) add(id);
  }
  for (const combatant of combatants) add(combatant?.id);

  let publicIndex = 0;
  const usedPublicIds = new Set();
  const activeId = Number.isInteger(combat?.round) && combat.round > 0
    ? combat.activeId : null;
  return ordered.flatMap(combatant => {
    const setting = settings[combatant?.id];
    const policy = creatureVisibilityPolicy(combatant, setting);
    if (!policy.present) return [];
    const image = policy.image
      ? publicImage(combatant?.publicImage) : '';
    publicIndex += 1;
    const preferredId = publicText(setting?.token, 80) || `public-${publicIndex}`;
    let id = preferredId;
    while (usedPublicIds.has(id)) id = `public-${publicIndex}-${usedPublicIds.size + 1}`;
    usedPublicIds.add(id);
    return [{
      // This is a public alias, never the GM combatant/source id.
      id,
      name: policy.identity ? (publicText(setting?.name || combatant?.publicName, 80) || 'Participant') : 'Unknown creature',
      ...(image ? { image } : {}),
      active: combatant.id === activeId,
      order: publicIndex
    }];
  });
}

function publicCombatState(combat, settings) {
  const actors = publicActors(combat, settings);
  const active = actors.find(actor => actor.active);
  const round = Number.isInteger(combat?.round) && combat.round > 0 ? combat.round : 0;
  return { round, currentTurnId: active?.id || null, actors };
}

function publicCreatures(combat, settings) {
  const combatants = Array.isArray(combat?.combatants) ? combat.combatants : [];
  const usedPublicIds = new Set();
  return combatants.flatMap((combatant, index) => {
    const setting = settings[combatant?.id];
    const policy = creatureVisibilityPolicy(combatant, setting);
    if (!policy.present || combatant?.isPC === true || !setting || setting.conditions !== true) return [];
    const name = policy.identity ? (publicText(setting.name || combatant?.publicName, 80) || 'Creature') : 'Unknown creature';
    const preferredId = publicText(setting.token || combatant?.publicId || combatant?.publicToken, 80)
      || `creature-${index + 1}`;
    let id = preferredId;
    let suffix = 2;
    while (usedPublicIds.has(id)) id = `${preferredId}-${suffix++}`;
    usedPublicIds.add(id);
    return [{
      id,
      name,
      conditions: publicConditions(combatant.conditions),
      ...(policy.image
        && publicImage(combatant?.publicImage) ? { image: publicImage(combatant.publicImage) } : {}),
      ...publicCreatureMetadata(combatant, policy)
    }];
  });
}

function publicImage(value) {
  if (typeof value !== 'string' || value.length > 2048) return '';
  const url = value.trim();
  if (!url || /[\u0000-\u001f\u007f]/.test(url)) return '';
  try {
    const parsed = new URL(url, 'https://pf2e.invalid');
    if (!['https:', 'http:'].includes(parsed.protocol) && !url.startsWith('./') && !url.startsWith('../')) return '';
    return url;
  } catch { return ''; }
}

/**
 * Map legacy GM state into the v2 public campaign/session contract.
 * Only explicitly allowlisted fields are copied; unknown GM fields are ignored.
 */
export function adaptPublicCampaignSession({ campaign, combat, player, session, revision,
  encounter, characters, notes, events } = {}) {
  const settings = publicPlayerSettings(player);
  const publicCombat = publicCombatState(combat, settings);
  return {
    contract: PUBLIC_CONTRACT,
    version: PUBLIC_CONTRACT_VERSION,
    revision: publicRevision(revision ?? session?.revision),
    campaign: {
      title: typeof campaign?.title === 'string' ? campaign.title.slice(0, 120) : ''
    },
    session: {
      phase: publicPhase(session?.phase),
      round: publicCombat.round,
      currentTurnId: publicCombat.currentTurnId,
      encounter: publicEncounter(encounter),
      characters: publicCharacters(characters),
      creatures: publicCreatures(combat, settings),
      notes: publicNotes(notes),
      events: publicEvents(events),
      actors: publicCombat.actors
    }
  };
}

/** Serialize only the already-adapted public contract. */
export function serializePublicCampaignSession(input) {
  return JSON.stringify(adaptPublicCampaignSession(input));
}

export function isPublicCampaignSession(value) {
  const session = value?.session;
  const exactKeys = (candidate, keys) => object(candidate) &&
    Object.keys(candidate).every(key => keys.includes(key)) &&
    keys.every(key => Object.prototype.hasOwnProperty.call(candidate, key));
  const allowedKeys = (candidate, keys) => object(candidate) &&
    Object.keys(candidate).every(key => keys.includes(key));
  const validActors = actors => Array.isArray(actors) && actors.every(actor =>
    allowedKeys(actor, ['id', 'name', 'image', 'active', 'order']) &&
    typeof actor.id === 'string' && typeof actor.name === 'string' &&
    (actor.image === undefined || typeof actor.image === 'string') &&
    typeof actor.active === 'boolean' && Number.isInteger(actor.order));
  const validCharacters = characters => Array.isArray(characters) && characters.every(character =>
    allowedKeys(character, ['id', 'name', 'level', 'class', 'ancestry']) &&
    typeof character.id === 'string' && typeof character.name === 'string' &&
    (character.level === undefined || Number.isInteger(character.level)) &&
    (character.class === undefined || typeof character.class === 'string') &&
    (character.ancestry === undefined || typeof character.ancestry === 'string'));
  const validCreatures = creatures => Array.isArray(creatures) && creatures.every(creature =>
    allowedKeys(creature, ['id', 'name', 'image', 'conditions', 'description', 'role', 'traits', 'status']) &&
    typeof creature.id === 'string' && typeof creature.name === 'string' &&
    (creature.image === undefined || typeof creature.image === 'string') &&
    Array.isArray(creature.conditions) && creature.conditions.every(condition => typeof condition === 'string') &&
    (creature.description === undefined || typeof creature.description === 'string') &&
    (creature.role === undefined || typeof creature.role === 'string') &&
    (creature.traits === undefined || (Array.isArray(creature.traits) && creature.traits.every(trait => typeof trait === 'string'))) &&
    (creature.status === undefined || (Array.isArray(creature.status) && creature.status.every(label => typeof label === 'string'))));
  const validMessages = (messages, key) => Array.isArray(messages) && messages.every(message =>
    exactKeys(message, key === 'notes' ? ['title', 'body'] : ['message']) &&
    Object.values(message).every(value => typeof value === 'string'));
  return exactKeys(value, ['contract', 'version', 'revision', 'campaign', 'session']) &&
    value.contract === PUBLIC_CONTRACT && value.version === PUBLIC_CONTRACT_VERSION &&
    Number.isInteger(value.revision) && value.revision >= 0 &&
    exactKeys(value.campaign, ['title']) && typeof value.campaign.title === 'string' &&
    exactKeys(session, ['phase', 'round', 'currentTurnId', 'encounter', 'characters', 'creatures', 'notes', 'events', 'actors']) &&
    isPublicPhase(session.phase) && Number.isInteger(session.round) && session.round >= 0 &&
    (session.currentTurnId === null || typeof session.currentTurnId === 'string') &&
    Array.isArray(session.actors) &&
    session.actors.every(actor => actor?.active === (session.currentTurnId !== null && actor?.id === session.currentTurnId)) &&
    exactKeys(session.encounter, ['title', 'status']) && typeof session.encounter.title === 'string' &&
    PUBLIC_STATUSES.includes(session.encounter.status) &&
    validCharacters(session.characters) && validCreatures(session.creatures) &&
    validMessages(session.notes, 'notes') && validMessages(session.events, 'events') &&
    validActors(session.actors);
}
