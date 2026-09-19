import { PLAYER_CHANNEL, isPlayerSnapshot } from './player-state.js';
import { isPublicCampaignSession } from './player-contract.js';

const status = document.querySelector('[data-player-status]');
const actors = document.querySelector('[data-player-actors]');
let timer;

function render(message) {
  if (!isPlayerSnapshot(message)) return;
  const projection = message.projection;
  const session = isPublicCampaignSession(projection)
    ? projection.session
    : projection;
  status.textContent = session.round > 0 ? `Round ${session.round}` : 'Waiting for combat to begin';
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
    row.append(label, name);
    actors.append(row);
  });
  clearTimeout(timer);
  timer = setTimeout(() => { status.textContent = 'Waiting for the GM window…'; }, 8000);
}

function requestSnapshot() {
  if ('BroadcastChannel' in window) {
    const channel = new BroadcastChannel(PLAYER_CHANNEL);
    channel.addEventListener('message', event => render(event.data));
    channel.postMessage({ kind: 'player-request', channel: PLAYER_CHANNEL });
  } else if (window.opener) {
    window.opener.postMessage({ kind: 'player-request' }, location.origin);
    status.textContent = 'BroadcastChannel is unavailable; using the GM window fallback.';
    window.addEventListener('message', event => {
      if (event.origin === location.origin) render(event.data);
    });
  } else {
    status.textContent = 'BroadcastChannel is unavailable. Open this display from the GM window.';
  }
}

document.querySelector('[data-fullscreen]').addEventListener('click', () => {
  document.documentElement.requestFullscreen?.();
});
requestSnapshot();
