import { createPfpcClient } from '../pfpc-control.js';
import { state } from '../store.js';
import { companionCharactersForCampaign } from '../companion-rosters.js';
import { actions as loadActions } from '../data.js';
import { esc } from '../dom.js';
import { MAP_WIDTH, MAP_HEIGHT, emptyCampaignMap, sanitizeCampaignMap, hexCenter, nearestVisibleHex, pointerToImagePoint, projectPublicCampaignMap } from '../campaign-map.js';

const MARKERS = { party:'assets/maps/nav-party.png', red:'assets/maps/flag-red.png', yellow:'assets/maps/flag-yellow.png', blue:'assets/maps/flag-blue.png', enemy:'assets/maps/marker-new-enemy.png', 'royal-guard':'assets/maps/marker-royal-guard.png', alliance:'assets/maps/marker-alliance.png' };
const colors=['red','yellow','blue'];
const escText=value=>esc(String(value??''));
const markerChoices = map => [
  { key:'party', label:'Party', icon:MARKERS.party },
  ...colors.map(color=>({key:color,label:color[0].toUpperCase()+color.slice(1),icon:MARKERS[color]})),
  { key:'enemy', label:'New enemy', icon:MARKERS.enemy },
  ...map.enemies.map((enemy,i)=>({key:enemy.id,label:`Enemy ${i+1}`,icon:MARKERS.enemy})),
  { key:'faction:royal-guard', label:'Royal Guard', icon:MARKERS['royal-guard'] },
  { key:'faction:alliance', label:'Alliance', icon:MARKERS.alliance }
];
export function explorationMarkup({campaignId,characters,workflow,activityOptions,map,revision,status,campaigns = [],busy = false,mapReady = true, selectedMarker = 'party'}) {
  const campaignChoices = campaigns.length ? campaigns : [{ campaignId, displayName: campaignId }];
  const records=new Map((workflow?.characters||[]).map(row=>[row.characterId,row]));
  const activity=characters.map(ch=>{const w=records.get(ch.id);const selected=w?.exploration?.activityId||'';const choice=activityOptions.find(a=>a.id===selected);const selectedName=choice?.name||w?.exploration?.activityName||'';return `<article class="gm-exploration-character"><details><summary><span><b>${escText(ch.name)}</b><small>${escText(w?.playerName||w?.displayName||ch.playerName||'Player not set')}</small></span><strong class="${selected?'':'missing'}">${selected?escText(selectedName||'Selected activity'): 'No activity selected'}</strong></summary><div class="gm-activity-control"><label>Activity <select data-activity="${escText(ch.id)}"><option value="">No activity</option>${activityOptions.map(a=>`<option value="${escText(a.id)}" ${a.id===selected?'selected':''}>${escText(a.name)}</option>`).join('')}</select></label>${selected?`<p>${escText(choice?.notes||choice?.description||w?.exploration?.description||'No description available.')}</p>`:''}</div></details></article>`;}).join('');
  const marker=(key,hex,visible=true)=>{if(!hex)return '';const p=hexCenter(parseHex(hex));return `<img class="gm-map-marker ${colors.includes(key)?'gm-map-flag ':['enemy','royal-guard','alliance'].includes(key)?'gm-map-banner ':''}${['royal-guard','alliance'].includes(key)?'gm-map-faction ':''}${visible?'':'hidden-marker'}" src="${MARKERS[key]||MARKERS.enemy}" alt="${escText(key)}${visible?'':' hidden'}" style="left:${p.x/MAP_WIDTH*100}%;top:${p.y/MAP_HEIGHT*100}%">`;};
  const markers=[marker('party',map.party),...colors.map(c=>marker(c,map.flags[c].hex,map.flags[c].visible)),...map.enemies.map(e=>marker('enemy',e.hex,e.visible)),...(map.factions||[]).map(f=>marker(f.kind,f.hex,f.visible))].join('');
  const factionVisibility = [['royal-guard','Royal Guard'],['alliance','The Alliance']].map(([kind,label])=>{
    const faction=map.factions?.find(f=>f.kind===kind);
    return `<label><input type="checkbox" data-faction-visibility="${kind}" ${faction?.visible?'checked':''}> ${label} visible</label>`;
  }).join('');
  const choices = markerChoices(map);
  const activeChoice = choices.find(choice=>choice.key===selectedMarker) || choices[0];
  const palette = choices.map(({key,label,icon})=>
    `<button type="button" class="gm-marker-pick ${key===activeChoice.key?'selected':''}" data-select-marker="${escText(key)}" aria-pressed="${key===activeChoice.key}" title="${escText(label)}" ${busy || !mapReady?'disabled':''}><img src="${icon}" alt="" aria-hidden="true"><span>${escText(label)}</span></button>`
  ).join('');
  return `<section class="gm-exploration" data-campaign="${escText(campaignId)}"><header><h2>Exploration</h2><label>Campaign <select data-campaign aria-label="Campaign" ${busy ? 'disabled' : ''}>${campaignChoices.map(c=>`<option value="${escText(c.campaignId)}" ${c.campaignId===campaignId?'selected':''}>${escText(c.displayName)}</option>`).join('')}</select></label></header><p class="gm-sync" role="status">${escText(status||'Connected state loaded')}</p><fieldset class="gm-map-controls" ${busy || !workflow ? 'disabled' : ''}><div class="gm-activity-list">${characters.length?activity:'<p class="empty">No active player characters linked to this campaign.</p>'}</div></fieldset><section class="gm-map-card"><div class="gm-map-heading"><h3>Maguuma Jungle</h3><p>Choose an icon, then tap the map. Visibility controls only what players see.</p></div><fieldset class="gm-map-controls" ${busy || !mapReady ? 'disabled' : ''}><div class="gm-map-palette" role="group" aria-label="Choose marker">${palette}</div><div class="gm-map-tools"><button type="button" data-clear>Clear selected</button></div><div class="gm-map" data-map><img class="gm-map-art" src="assets/maps/maguuma-jungle-hex-map.png" alt="Maguuma Jungle hex map" width="${MAP_WIDTH}" height="${MAP_HEIGHT}">${markers}<button class="gm-map-capture" type="button" data-place-map aria-label="Place ${escText(activeChoice.label)} on map"></button></div><details class="gm-map-precision"><summary>Enter hex coordinates</summary><div class="gm-map-tools gm-map-keyboard"><label>Hex q <input type="number" data-hex-q min="0" step="1" value="0"></label><label>r <input type="number" data-hex-r min="0" step="1" value="0"></label><button type="button" data-place-hex>Place at hex</button></div></details><div class="gm-map-state"><strong>Player view</strong><span>${projectPublicCampaignMap(map).party?'Party placed':'Party not placed'} · ${projectPublicCampaignMap(map).flags.length} flags · ${projectPublicCampaignMap(map).enemies.length} enemies visible</span></div><div class="gm-map-visibility">${colors.map(c=>`<label><input type="checkbox" data-visibility="${c}" ${map.flags[c].visible?'checked':''}> ${c} flag visible</label>`).join('')}${map.enemies.map((e,i)=>`<label><input type="checkbox" data-enemy-visibility="${escText(e.id)}" ${e.visible?'checked':''}> Enemy ${i+1} visible</label>`).join('')}${factionVisibility}</div></fieldset><p class="gm-map-revision" data-revision="${revision}">Map revision ${revision}</p></section></section>`;
}

// Keep the exact canonical parser semantics centralized in campaign-map.js.
import { parseHexId } from '../campaign-map.js';
function parseHex(value){return parseHexId(value);}

const SELECTED_CAMPAIGN_KEY = 'pf2e-gm-toolkit/map-campaign';

function setupMarkup(connection, status) {
  const form = connection === 'unconfigured'
    ? '<form data-map-connect><label>Campaign service URL <input name="url" type="url" required></label><button type="submit">Connect</button></form>'
    : '<button type="button" data-map-retry>Retry</button>';
  return '<section class="gm-exploration gm-map-setup"><h2>Exploration</h2><p role="status">' + escText(status) + '</p>' + form + '</section>';
}

function readMapEnvelope(data) {
  const envelope = data?.campaignMap || data;
  if (!Number.isSafeInteger(envelope?.revision) || envelope.revision < 0 || !envelope.map) throw new Error('Invalid map response');
  return { map: sanitizeCampaignMap(envelope.map), revision: envelope.revision };
}

export function bindExploration(root, {
  client = createPfpcClient(), actions = loadActions, campaignId = () => '',
  localStore = globalThis.localStorage, notify = () => {}
} = {}) {
  let currentCampaign = '', campaigns = [], workflow = null, map = emptyCampaignMap();
  let mapRevision = 0, busy = false, mapReady = false, actionRows = [];
  let selectedMarker = 'party';
  let generation = 0;
  const remembered = () => { try { return localStore?.getItem(SELECTED_CAMPAIGN_KEY) || ''; } catch { return ''; } };
  const remember = id => { try { localStore?.setItem(SELECTED_CAMPAIGN_KEY, id); } catch { /* Selection still works without device storage. */ } };
  const draw = (status = 'Connected state loaded') => {
    if (!currentCampaign) return;
    root.innerHTML = explorationMarkup({ campaignId: currentCampaign, campaigns,
      characters: companionCharactersForCampaign(state.companion, currentCampaign), workflow,
      activityOptions: actionRows.filter(a => a.traits?.includes('Exploration')),
      map, revision: mapRevision, status, busy, mapReady, selectedMarker });
  };
  async function refresh(id = currentCampaign) {
    if (!campaigns.some(c => c.campaignId === id)) return;
    const request = ++generation;
    currentCampaign = id; workflow = null; map = emptyCampaignMap(); mapRevision = 0;
    mapReady = false; busy = true; draw('Loading campaign…');
    try {
      const [w, m, a] = await Promise.all([
        client.getWorkflow(id, { retries: 1 }), client.getCampaignMap(id, { retries: 1 }), actions().catch(() => [])
      ]);
      if (request !== generation) return;
      actionRows = a || [];
      if (w.state === 'ok') workflow = w.data.workflow || w.data;
      if (m.state === 'ok') {
        const envelope = readMapEnvelope(m.data);
        map = envelope.map; mapRevision = envelope.revision;
        mapReady = true; remember(id);
        if (selectedMarker.startsWith('enemy-') && !map.enemies.some(enemy=>enemy.id===selectedMarker)) selectedMarker='enemy';
      }
      busy = false;
      draw(mapReady ? (workflow ? 'Connected state loaded' : 'Map ready. Player activities are unavailable.') : 'Map could not be loaded.');
      if (!mapReady) root.querySelector('.gm-sync')?.insertAdjacentHTML('beforeend', ' <button type="button" data-map-retry>Retry</button>');
    } catch {
      if (request !== generation) return;
      busy = false; draw('Map could not be loaded.');
      root.querySelector('.gm-sync')?.insertAdjacentHTML('beforeend', ' <button type="button" data-map-retry>Retry</button>');
    }
  }
  async function connect() {
    const request = ++generation;
    currentCampaign = ''; campaigns = []; workflow = null; mapReady = false; busy = true;
    root.innerHTML = '<section class="gm-exploration"><h2>Exploration</h2><p role="status">Loading campaigns…</p></section>';
    try {
      const result = await client.getCampaigns({ retries: 1 });
      if (request !== generation) return;
      busy = false;
      if (result.state !== 'ok') {
        const messages = { unconfigured: 'Connect your campaign service to prepare the map.' };
        root.innerHTML = setupMarkup(result.state, messages[result.state] || 'Campaigns could not be loaded.'); return;
      }
      campaigns = result.data.campaigns;
      if (!Array.isArray(campaigns) || !campaigns.every(c => typeof c.campaignId === 'string' && c.campaignId && typeof c.displayName === 'string')) throw new Error('Invalid campaigns');
      if (!campaigns.length) {
        root.innerHTML = setupMarkup('empty', 'No campaigns are available on the Player Companion service.'); return;
      }
      const preferred = campaignId() || remembered();
      const selected = campaigns.find(c => c.campaignId === preferred) || (campaigns.length === 1 ? campaigns[0] : null);
      if (selected) { await refresh(selected.campaignId); return; }
      root.innerHTML = '<section class="gm-exploration"><h2>Exploration</h2><label>Campaign <select data-campaign aria-label="Campaign"><option value="">Choose a campaign</option>' + campaigns.map(c => '<option value="' + escText(c.campaignId) + '">' + escText(c.displayName) + '</option>').join('') + '</select></label></section>';
    } catch {
      if (request !== generation) return;
      busy = false; root.innerHTML = setupMarkup('unreachable', 'Campaigns could not be loaded.');
    }
  }
  async function saveMap(next) {
    if (busy || !mapReady) return;
    const id = currentCampaign, request = generation, revision = mapRevision;
    busy = true; draw('Saving map…');
    try {
      const result = await client.setCampaignMap(id, revision, next);
      if (request !== generation || id !== currentCampaign) return;
      if (result.state === 'ok') {
        const envelope = readMapEnvelope(result.data);
        map = envelope.map; mapRevision = envelope.revision;
        busy = false; draw('Map saved.');
      } else {
        await refresh(id);
        draw(result.state === 'conflict' ? 'Map changed elsewhere. Latest markers loaded.' : 'Map could not be saved.');
      }
    } catch {
      if (request !== generation) return;
      busy = false; draw('Map could not be saved.');
    }
  }
  async function place(hexId) {
    const hex = parseHexId(hexId);
    if (!hex || busy || !mapReady) { notify('Choose a valid visible hex.'); return; }
    const next = structuredClone(map), key = selectedMarker;
    if (key === 'party') next.party = hex.id;
    else if (colors.includes(key)) next.flags[key].hex = hex.id;
    else if (key.startsWith('enemy-')) { const enemy = next.enemies.find(x => x.id === key); if (enemy) enemy.hex = hex.id; }
    else if (key.startsWith('faction:')) {
      const kind = key.slice(8); next.factions ||= [];
      const faction = next.factions.find(x => x.kind === kind);
      if (faction) faction.hex = hex.id; else next.factions.push({ kind, hex: hex.id, visible: false });
    } else {
      let id, seq = 0;
      do { id = 'enemy-' + Date.now().toString(36) + (seq++ || ''); } while (next.enemies.some(enemy => enemy.id === id));
      next.enemies.push({ id, hex: hex.id, visible: false });
    }
    await saveMap(next);
  }
  root.addEventListener('submit', async event => {
    const form = event.target;
    if (!form.matches('[data-map-connect]')) return;
    event.preventDefault(); if (busy) return;
    busy = true;
    try {
      const data = new FormData(form);
      client.configureBaseUrl(data.get('url'));
      await connect();
    } catch { root.innerHTML = setupMarkup('unconfigured', 'Enter a valid campaign service URL.'); }
    finally { busy = false; }
  });
  root.addEventListener('change', async event => {
    const t = event.target;
    if (t.matches('[data-campaign]')) { if (!busy) await refresh(t.value); return; }
    if (busy) return;
    if (t.matches('[data-activity]')) {
      if (!workflow) return;
      busy = true; draw('Saving activity…');
      try {
        const result = await client.setExploration(currentCampaign,workflow.revision,t.dataset.activity,t.value||null);
        if (result.state === 'ok') { workflow = result.data.workflow || result.data; busy = false; draw(); }
        else { await refresh(); draw('Activity could not be saved.'); }
      } catch { busy = false; draw('Activity could not be saved.'); }
      return;
    }
    if (!mapReady) return;
    const next = structuredClone(map);
    if (t.matches('[data-visibility]')) next.flags[t.dataset.visibility].visible = t.checked;
    else if (t.matches('[data-enemy-visibility]')) { const enemy = next.enemies.find(x => x.id === t.dataset.enemyVisibility); if (enemy) enemy.visible = t.checked; }
    else if (t.matches('[data-faction-visibility]')) {
      const kind = t.dataset.factionVisibility;
      if (!['royal-guard','alliance'].includes(kind)) return;
      next.factions ||= [];
      const faction = next.factions.find(x => x.kind === kind);
      if (faction) faction.visible = t.checked;
      else next.factions.push({ kind, hex: null, visible: t.checked });
    }
    else return;
    await saveMap(next);
  });
  root.addEventListener('click', async event => {
    const t = event.target;
    if (t.matches('[data-map-retry]')) { if (!busy) { if (currentCampaign) await refresh(); else await connect(); } return; }
    if (busy || !mapReady) return;
    const picked = t.closest?.('[data-select-marker]');
    if (picked) { selectedMarker = picked.dataset.selectMarker; draw(); return; }
    if (t.matches('[data-place-map]')) {
      const point = pointerToImagePoint(event.clientX, event.clientY, t.parentElement.getBoundingClientRect());
      const hex = point && nearestVisibleHex(point);
      if (hex) await place(hex.id); else notify('Choose a visible hex.'); return;
    }
    if (t.matches('[data-place-hex]')) { await place('h2:' + root.querySelector('[data-hex-q]').value + ':' + root.querySelector('[data-hex-r]').value); return; }
    if (t.matches('[data-clear]')) {
      const next = structuredClone(map), key = selectedMarker;
      if (key === 'party') next.party = null;
      else if (colors.includes(key)) next.flags[key].hex = null;
      else if (key.startsWith('enemy-')) { next.enemies = next.enemies.filter(x => x.id !== key); selectedMarker = 'enemy'; }
      else if (key.startsWith('faction:')) {
        // Clearing removes only the marker's position, never its visibility.
        const faction=next.factions?.find(x=>x.kind===key.slice(8));
        if (faction) faction.hex=null;
      }
      await saveMap(next);
    }
  });
  const ready = connect();
  return { ready, refresh };
}
