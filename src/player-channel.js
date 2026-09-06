import { state, subscribe } from './store.js';
import { PLAYER_CHANNEL, projectPlayerState } from './player-state.js';

let channel = null;
let installed = false;
let heartbeat = null;

function snapshot() {
  return { kind: 'snapshot', channel: PLAYER_CHANNEL, projection: projectPlayerState(state.combat, state.player) };
}

function installFallback() {
  if (installed) return;
  installed = true;
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.data?.kind !== 'player-request') return;
    event.source?.postMessage(snapshot(), location.origin);
  });
}

export function initPlayerBroadcast() {
  installFallback();
  if (!channel && 'BroadcastChannel' in window) {
    channel = new BroadcastChannel(PLAYER_CHANNEL);
    channel.addEventListener('message', event => {
      if (event.data?.kind === 'player-request') channel.postMessage(snapshot());
    });
    channel.postMessage(snapshot());
    heartbeat = setInterval(() => channel?.postMessage(snapshot()), 3000);
  }
  return Boolean(channel);
}

export function broadcastPlayerState() {
  if (channel) channel.postMessage(snapshot());
}

export function bindPlayerBroadcast() {
  initPlayerBroadcast();
  return subscribe(broadcastPlayerState);
}
