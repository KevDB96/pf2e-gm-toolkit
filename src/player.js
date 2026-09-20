import { PLAYER_CHANNEL } from './player-state.js';
import { isPublicCampaignSession } from './player-contract.js';
import { acceptPlayerSnapshot, createPlayerRequest } from './player-transport.js';

const status = document.querySelector('[data-player-status]');
const actors = document.querySelector('[data-player-actors]');
const recap = document.querySelector('[data-player-recap]');
let timer;
let poller;
let liveChannel = null;
let requestFallback = null;
let fallbackListenerInstalled = false;
let currentSnapshot = null;

function keepAlive() {
  clearTimeout(timer);
  timer = setTimeout(() => { status.textContent = 'Waiting for the GM window…'; }, 8000);
}

function render(message) {
  const accepted = acceptPlayerSnapshot(currentSnapshot, message);
  if (accepted === currentSnapshot) {
    if (Number.isInteger(message?.projection?.revision) &&
        message.projection.revision === currentSnapshot?.projection?.revision) keepAlive();
    return;
  }
  currentSnapshot = accepted;
  const projection = accepted.projection;
  const session = isPublicCampaignSession(projection)
    ? projection.session
    : projection;
  status.textContent = session.round > 0 ? `Round ${session.round}` : 'Waiting for combat to begin';
  recap.replaceChildren();
  if (session.recap?.status !== 'empty') {
    const heading = document.createElement('h2');
    heading.textContent = session.recap.title || 'Session recap';
    const body = document.createElement('p');
    body.textContent = session.recap.body;
    recap.append(heading, body);
    recap.hidden = false;
  } else {
    recap.hidden = true;
  }
  actors.replaceChildren();
  if (!session.actors.length) {
    const empty = document.createElement('p');
    empty.className = 'player-empty';
    empty.textContent = 'No combatants are revealed for players yet.';
    actors.append(empty);
    return;
  }
  session.actors.forEach((actor, index) => {
    const row = document.createElement('div');
    row.className = `player-actor${actor.active ? ' is-current' : ''}`;
    const label = document.createElement('span');
    label.className = 'player-actor-label';
    label.textContent = actor.active ? 'CURRENT' : (index === session.actors.findIndex(x => x.active) + 1 ? 'NEXT' : '');
    const name = document.createElement('strong');
    name.textContent = actor.name;
    if (actor.image) {
      const image = document.createElement('img');
      image.className = 'player-actor-image';
      image.src = actor.image;
      image.alt = '';
      image.referrerPolicy = 'no-referrer';
      row.append(image);
    }
    row.append(label, name);
    actors.append(row);
  });
  const creatures = Array.isArray(session.creatures) ? session.creatures : [];
  const visibleCreatures = creatures.filter(creature =>
    (Array.isArray(creature.conditions) && creature.conditions.length) ||
    (Array.isArray(creature.status) && creature.status.length));
  if (visibleCreatures.length) {
    const heading = document.createElement('h2');
    heading.className = 'player-creatures-heading';
    heading.textContent = 'Conditions and status';
    actors.append(heading);
    visibleCreatures.forEach(creature => {
      const card = document.createElement('section');
      card.className = 'player-creature-status';
      const name = document.createElement('strong');
      name.textContent = creature.name;
      card.append(name);
      const labels = document.createElement('div');
      labels.className = 'player-condition-list';
      for (const condition of creature.conditions || []) {
        const label = document.createElement('span');
        label.className = 'player-condition';
        label.textContent = condition;
        labels.append(label);
      }
      for (const statusLabel of creature.status || []) {
        const label = document.createElement('span');
        label.className = 'player-status-label';
        label.textContent = statusLabel;
        labels.append(label);
      }
      card.append(labels);
      actors.append(card);
    });
  }
  keepAlive();
}

function requestSnapshot() {
  const request = createPlayerRequest();
  if (liveChannel) {
    liveChannel.postMessage(request);
  } else if (requestFallback) {
    requestFallback(request);
  }
}

function connectTransport() {
  if ('BroadcastChannel' in window) {
    liveChannel = new BroadcastChannel(PLAYER_CHANNEL);
    liveChannel.addEventListener('message', event => render(event.data));
  } else if (window.opener) {
    requestFallback = request => window.opener?.postMessage(request, location.origin);
    status.textContent = 'BroadcastChannel is unavailable; using the GM window fallback.';
    if (!fallbackListenerInstalled) {
      fallbackListenerInstalled = true;
      window.addEventListener('message', event => {
        if (event.origin === location.origin) render(event.data);
      });
    }
  } else {
    status.textContent = 'BroadcastChannel is unavailable. Open this display from the GM window.';
  }
  requestSnapshot();
  poller = setInterval(requestSnapshot, 3000);
}

window.addEventListener('visibilitychange', () => {
  if (!document.hidden) requestSnapshot();
});

document.querySelector('[data-fullscreen]').addEventListener('click', () => {
  document.documentElement.requestFullscreen?.();
});
connectTransport();
