import { state, subscribe } from './store.js';
import { PLAYER_CHANNEL, isPlayerRequest } from './player-state.js';
import { adaptPublicCampaignSession } from './player-contract.js';

let channel = null;
let installed = false;
let heartbeat = null;

function snapshot() {
  return { kind: 'snapshot', channel: PLAYER_CHANNEL,
    projection: adaptPublicCampaignSession({
      campaign: state.campaign,
      combat: state.combat,
      encounter: state.encounter,
      characters: state.characters?.extra,
      notes: state.notes?.entries,
      player: state.player,
      session: state.session
    }) };
}

function installFallback() {
  if (installed) return;
  installed = true;
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || !isPlayerRequest(event.data)) return;
    event.source?.postMessage(snapshot(), location.origin);
  });
}

export function initPlayerBroadcast() {
  installFallback();
  if (!channel && 'BroadcastChannel' in window) {
    channel = new BroadcastChannel(PLAYER_CHANNEL);
    channel.addEventListener('message', event => {
      if (isPlayerRequest(event.data)) channel.postMessage(snapshot());
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
