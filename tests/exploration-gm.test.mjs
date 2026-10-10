import test from 'node:test';
import assert from 'node:assert/strict';
import { explorationMarkup, bindExploration } from '../src/views/exploration-gm.js';
import { emptyCampaignMap, hexCenter, MAP_WIDTH, MAP_HEIGHT } from '../src/campaign-map.js';

const props={campaignId:'campaign-a',characters:[{id:'hero-a',name:'Kesta',playerName:'Morgan'}],workflow:{revision:4,characters:[{characterId:'hero-a',playerName:'Morgan',exploration:{activityId:'action-2629',activityName:'Scout'}}]},activityOptions:[{id:'action-2629',name:'Scout',notes:'You scout ahead and behind the group.'}],map:emptyCampaignMap(),revision:3};

test('populated and missing activity states show player identity, selected activity, and authoritative effect text',()=>{
  const populated=explorationMarkup(props);
  assert.match(populated,/Morgan/); assert.match(populated,/Scout/); assert.match(populated,/You scout ahead and behind the group/);
  assert.match(populated,/data-activity="hero-a"/); assert.match(populated,/No activity/);
  const missing=explorationMarkup({...props,workflow:{revision:5,characters:[]}});
  assert.match(missing,/No activity selected/);
});

test('map markup exposes accessible keyboard placement, independent marker visibility, and responsive image contract',()=>{
  const map=emptyCampaignMap(); map.flags.red={hex:'h2:1:1',visible:true}; map.flags.blue={hex:'h2:2:1',visible:false}; map.enemies=[{id:'enemy-secret',hex:'h2:3:1',visible:false}];
  const html=explorationMarkup({...props,map});
  assert.match(html,/aspect-ratio|width="1536"/); assert.match(html,/data-place-hex/); assert.match(html,/aria-label="Place Party on map"/);
  assert.match(html, /data-select-marker="red"/); assert.match(html, /data-select-marker="blue"/);
  assert.doesNotMatch(html, /data-arm|data-marker|Place \/ move/);
  assert.match(html,/data-visibility="red" checked/); assert.match(html,/data-visibility="blue"/); assert.match(html,/data-enemy-visibility="enemy-secret"/);
  assert.match(html,/Visibility controls only what players see/); assert.match(html,/Player view/);
  assert.match(html, /class="gm-map-marker gm-map-flag "/);
  assert.match(html, /class="gm-map-marker gm-map-flag hidden-marker"/);
  assert.match(html, /class="gm-map-marker gm-map-banner hidden-marker"/); // hidden enemies keep independent visibility
});

test('generated Enemy, Royal Guard and Alliance art renders distinctly in palette and map', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const filename of ['marker-new-enemy.png', 'marker-royal-guard.png', 'marker-alliance.png']) {
    const bytes = await readFile(new URL('../assets/maps/' + filename, import.meta.url));
    assert.equal(bytes.subarray(0,8).toString('hex'), '89504e470d0a1a0a');
  }
  const map=emptyCampaignMap();
  map.enemies=[{id:'enemy-a',hex:'h2:2:2',visible:false}];
  map.factions=[
    {kind:'royal-guard',hex:'h2:3:3',visible:true},
    {kind:'alliance',hex:'h2:4:4',visible:false}
  ];
  const html=explorationMarkup({...props,map});
  for (const asset of ['marker-new-enemy.png', 'marker-royal-guard.png', 'marker-alliance.png']) {
    assert.ok(html.includes('assets/maps/' + asset));
  }
  assert.match(html, /data-select-marker="faction:royal-guard"[^>]*><img src="assets\/maps\/marker-royal-guard\.png"/);
  assert.match(html, /data-select-marker="faction:alliance"[^>]*><img src="assets\/maps\/marker-alliance\.png"/);
  assert.match(html, /<img class="gm-map-marker gm-map-banner gm-map-faction " src="assets\/maps\/marker-royal-guard\.png" alt="royal-guard" /);
  assert.match(html, /<img class="gm-map-marker gm-map-banner gm-map-faction hidden-marker" src="assets\/maps\/marker-alliance\.png" alt="alliance hidden" /);
  assert.match(html, /<img class="gm-map-marker gm-map-banner hidden-marker" src="assets\/maps\/marker-new-enemy\.png" alt="enemy hidden" /);
  assert.doesNotMatch(html, /<img class="gm-map-marker[^"]*" src="assets\/maps\/marker-enemy\.svg"/);
});

test('GM flags and faction markers are fully opaque even when hidden from players', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  assert.ok(css.includes('.gm-map-marker.gm-map-flag.hidden-marker,'));
  assert.ok(css.includes('.gm-map-marker.gm-map-faction.hidden-marker { opacity:1; filter:none; }'));
  assert.ok(css.includes('.gm-map-marker.hidden-marker { opacity:.38; filter:grayscale(.7); }'));
  const map = emptyCampaignMap();
  map.flags.red = { hex: 'h2:1:1', visible: false };
  map.factions = [{ kind: 'alliance', hex: 'h2:2:2', visible: false }];
  map.enemies = [{ id: 'enemy-hidden', hex: 'h2:3:3', visible: false }];
  const html = explorationMarkup({ ...props, map });
  assert.match(html, /class="gm-map-marker gm-map-flag hidden-marker"/);
  assert.match(html, /class="gm-map-marker gm-map-banner gm-map-faction hidden-marker"/);
  assert.match(html, /class="gm-map-marker gm-map-banner hidden-marker"/);
  const { projectPublicCampaignMap } = await import('../src/campaign-map.js');
  const player = projectPublicCampaignMap(map);
  assert.deepEqual(player.flags, []);
  assert.deepEqual(player.enemies, []);
  assert.equal(player.factions, undefined);
});

test('flag artwork offsets up and right while keeping other map markers centered', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.gm-map-marker \{[^}]*transform:translate\(-50%,-50%\)/);
  assert.match(css, /\.gm-map-marker\.gm-map-flag \{ transform:translate\(-30%,-70%\); \}/);
  const map=emptyCampaignMap(); map.party='h2:2:2'; map.flags.red={hex:'h2:2:2',visible:true};
  const html=explorationMarkup({...props,map});
  const party=html.match(/<img class="gm-map-marker " src="[^"]+" alt="party" style="([^"]+)"/)?.[1];
  const flag=html.match(/<img class="gm-map-marker gm-map-flag " src="[^"]+" alt="red" style="([^"]+)"/)?.[1];
  assert.ok(party && flag);
  assert.equal(flag, party); // visual CSS shift only, canonical hex remains identical
});

function setupView({ campaigns = [{ campaignId: 'mists', displayName: 'Mists of Zalazar' }], mapFailure = false } = {}) {
  const calls = [], saved = new Map(campaigns.map(c => [c.campaignId, { revision: 1, map: emptyCampaignMap() }]));
  const listeners = new Map(), values = new Map(), nodes = new Map([
    ['[data-hex-q]', { value: '1' }], ['[data-hex-r]', { value: '1' }],
  ]);
  const root = {
    innerHTML: '', addEventListener: (type, handler) => listeners.set(type, handler),
    querySelector: selector => selector === '.gm-sync' ? { insertAdjacentHTML: (_position, html) => { root.innerHTML += html; } } : nodes.get(selector),
  };
  const localStore = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const client = {
    getCampaigns: async () => { calls.push(['campaigns']); return { state: 'ok', data: { campaigns } }; },
    getWorkflow: async id => { calls.push(['workflow', id]); return { state: 'unreachable' }; },
    getCampaignMap: async id => { calls.push(['map', id]); return mapFailure ? { state: 'unreachable' } : { state: 'ok', data: { campaignMap: structuredClone(saved.get(id)) } }; },
    setCampaignMap: async (id, revision, map) => {
      calls.push(['save', id, revision, structuredClone(map)]);
      const next = { revision: revision + 1, map: structuredClone(map) }; saved.set(id, next);
      return { state: 'ok', data: { campaignMap: next } };
    },
  };
  const event = async (type, selector, fields = {}) => {
    const target = {
      matches: pattern => pattern.split(',').map(part => part.trim()).includes(selector),
      closest: pattern => pattern === '[data-select-marker]' && selector === '[data-select-marker]' ? target : null,
      ...fields,
    };
    await listeners.get(type)({ target, preventDefault() {} });
  };
  const bind = () => bindExploration(root, { client, localStore, actions: async () => [] });
  const select = key => event('click', '[data-select-marker]', { dataset: { selectMarker: key } });
  const tap = (q, r, bounds = { left: 7, top: 11, width: 384, height: 256 }) => {
    const { x, y } = hexCenter({ q, r });
    return event('click', '[data-place-map]', {
      clientX: bounds.left + x * bounds.width / MAP_WIDTH,
      clientY: bounds.top + y * bounds.height / MAP_HEIGHT,
      parentElement: { getBoundingClientRect: () => bounds },
    });
  };
  return { root, calls, saved, client, nodes, bind, event, select, tap };
}

test('empty roster loads the server campaign and prepares flags while activities are unavailable', async () => {
  const view = setupView(); await view.bind().ready;
  assert.match(view.root.innerHTML, /Mists of Zalazar/);
  assert.match(view.root.innerHTML, /No active player characters/);
  assert.match(view.root.innerHTML, /Map ready/);
  assert.match(view.root.innerHTML, /data-map/);
  assert.doesNotMatch(view.root.innerHTML, /Link player characters/);
  await view.select('red');
  await view.tap(1, 1);
  assert.equal(view.saved.get('mists').map.flags.red.hex, 'h2:1:1');
  assert.equal(view.saved.get('mists').map.flags.red.visible, false);
  await view.event('change', '[data-visibility]', { dataset: { visibility: 'red' }, checked: true });
  assert.equal(view.saved.get('mists').map.flags.red.visible, true);
  assert.equal(view.calls.filter(call => call[0] === 'save')[1][2], 2);
  await view.bind().ready;
  assert.match(view.root.innerHTML, /red.*h2:1:1|data-visibility="red" checked/);
});

test('direct map taps move the selected flag and clearing preserves its visibility', async () => {
  const view = setupView(); await view.bind().ready;
  await view.select('yellow');
  assert.match(view.root.innerHTML, /data-select-marker="yellow" aria-pressed="true"/);
  await view.event('change', '[data-visibility]', { dataset: { visibility: 'yellow' }, checked: true });
  await view.tap(3, 2);
  assert.equal(view.saved.get('mists').map.flags.yellow.hex, 'h2:3:2');
  assert.equal(view.saved.get('mists').map.flags.yellow.visible, true);
  await view.tap(4, 2);
  assert.equal(view.saved.get('mists').map.flags.yellow.hex, 'h2:4:2');
  assert.equal(view.saved.get('mists').map.flags.yellow.visible, true);
  await view.event('click', '[data-clear]');
  assert.equal(view.saved.get('mists').map.flags.yellow.hex, null);
  assert.equal(view.saved.get('mists').map.flags.yellow.visible, true);
  assert.match(view.root.innerHTML, /data-visibility="yellow" checked/);
  await view.tap(2, 3);
  assert.equal(view.saved.get('mists').map.flags.yellow.hex, 'h2:2:3');
  assert.equal(view.saved.get('mists').map.flags.yellow.visible, true);
});

test('Alliance visibility can be enabled before placement, retained on clear, and restored on refresh', async () => {
  const view = setupView(); await view.bind().ready;
  assert.match(view.root.innerHTML, /data-faction-visibility="alliance"[^>]*> The Alliance visible/);
  assert.match(view.root.innerHTML, /data-faction-visibility="royal-guard"[^>]*> Royal Guard visible/);
  await view.event('change', '[data-faction-visibility]', { dataset: { factionVisibility: 'alliance' }, checked: true });
  let factions = view.saved.get('mists').map.factions;
  assert.deepEqual(factions, [{ kind: 'alliance', hex: null, visible: true }]);
  assert.match(view.root.innerHTML, /data-faction-visibility="alliance" checked/);
  await view.select('faction:alliance');
  await view.tap(2, 3);
  factions = view.saved.get('mists').map.factions;
  assert.deepEqual(factions, [{ kind: 'alliance', hex: 'h2:2:3', visible: true }]);
  await view.event('click', '[data-clear]');
  factions = view.saved.get('mists').map.factions;
  assert.deepEqual(factions, [{ kind: 'alliance', hex: null, visible: true }]);
  assert.match(view.root.innerHTML, /data-faction-visibility="alliance" checked/);
  assert.doesNotMatch(view.root.innerHTML, /alt="alliance"/);
  await view.bind().ready;
  assert.match(view.root.innerHTML, /data-faction-visibility="alliance" checked/);
  await view.select('faction:alliance');
  await view.tap(3, 4);
  assert.deepEqual(view.saved.get('mists').map.factions, [
    { kind: 'alliance', hex: 'h2:3:4', visible: true },
  ]);
});

test('Royal Guard retains visibility after clearing, independently of Alliance', async () => {
  const view = setupView(); await view.bind().ready;
  await view.event('change', '[data-faction-visibility]', { dataset: { factionVisibility: 'royal-guard' }, checked: true });
  await view.select('faction:royal-guard');
  await view.tap(1, 2);
  await view.event('click', '[data-clear]');
  assert.deepEqual(view.saved.get('mists').map.factions, [
    { kind: 'royal-guard', hex: null, visible: true },
  ]);
  assert.match(view.root.innerHTML, /data-faction-visibility="royal-guard" checked/);
  assert.match(view.root.innerHTML, /data-faction-visibility="alliance"[^>]*> The Alliance visible/);
});

test('icon selection and tapping work for party and existing enemy without an arm step', async () => {
  const view = setupView(); await view.bind().ready;
  await view.tap(1, 1);
  assert.equal(view.saved.get('mists').map.party, 'h2:1:1');
  await view.select('enemy');
  await view.tap(2, 2);
  const savedEnemy = view.saved.get('mists').map.enemies[0];
  assert.equal(savedEnemy.hex, 'h2:2:2');
  await view.select(savedEnemy.id);
  await view.tap(4, 3);
  assert.equal(view.saved.get('mists').map.enemies.length, 1);
  assert.equal(view.saved.get('mists').map.enemies[0].hex, 'h2:4:3');
  assert.match(view.root.innerHTML, /data-select-marker="enemy-/);
  await view.event('click', '[data-clear]');
  assert.equal(view.saved.get('mists').map.enemies.length, 0);
  assert.match(view.root.innerHTML, /data-select-marker="enemy" aria-pressed="true"/);
});

test('tapping outside image bounds cannot mutate or place a marker', async () => {
  const view = setupView(); await view.bind().ready;
  await view.select('red');
  const count = view.calls.filter(call => call[0] === 'save').length;
  await view.event('click', '[data-place-map]', {
    clientX: -50, clientY: -50,
    parentElement: { getBoundingClientRect: () => ({ left: 7, top: 11, width: 384, height: 256 }) },
  });
  assert.equal(view.calls.filter(call => call[0] === 'save').length, count);
});

test('campaign picker requires a selection for multiple campaigns and keeps saved markers isolated', async () => {
  const view = setupView({ campaigns: [{ campaignId: 'a', displayName: 'One' }, { campaignId: 'b', displayName: 'Two' }] });
  await view.bind().ready;
  assert.match(view.root.innerHTML, /Choose a campaign/);
  assert.equal(view.calls.some(call => call[0] === 'map'), false);
  await view.event('change', '[data-campaign]', { value: 'b' });
  await view.select('red');
  await view.tap(1, 1);
  assert.equal(view.saved.get('b').map.flags.red.hex, 'h2:1:1');
  await view.event('change', '[data-campaign]', { value: 'a' });
  assert.equal(view.saved.get('a').map.flags.red.hex, null);
  assert.doesNotMatch(view.root.innerHTML, /alt="red"/);
  await view.bind().ready;
  assert.match(view.root.innerHTML, /value="a" selected/);
});

test('failed map reads disable all writes until a successful retry loads the canonical state', async () => {
  const view = setupView({ mapFailure: true }); await view.bind().ready;
  assert.match(view.root.innerHTML, /Map could not be loaded/);
  assert.match(view.root.innerHTML, /fieldset class="gm-map-controls" disabled/);
  await view.select('red');
  await view.tap(1, 1);
  await view.event('change', '[data-visibility]', { dataset: { visibility: 'red' }, checked: true });
  assert.equal(view.calls.some(call => call[0] === 'save'), false);
  view.client.getCampaignMap = async () => ({ state: 'ok', data: { campaignMap: { revision: 9, map: emptyCampaignMap() } } });
  await view.event('click', '[data-map-retry]');
  await view.tap(1, 1);
  assert.equal(view.calls.find(call => call[0] === 'save')[2], 9);
});

test('conflicting saves reload current markers instead of reporting a successful write', async () => {
  const view = setupView(); await view.bind().ready;
  view.client.setCampaignMap = async () => ({ state: 'conflict' });
  const latest = emptyCampaignMap(); latest.flags.blue = { hex: 'h2:2:1', visible: true };
  view.saved.set('mists', { revision: 7, map: latest });
  await view.select('red');
  await view.tap(1, 1);
  assert.match(view.root.innerHTML, /Latest markers loaded/);
  assert.match(view.root.innerHTML, /data-revision="7"/);
  assert.match(view.root.innerHTML, /alt="blue"/);
  assert.doesNotMatch(view.root.innerHTML, /alt="red"/);
});

test('obsolete auth failures never request a GM login or private access link', async () => {
  const view = setupView();
  view.client.getCampaigns = async () => ({ state: 'auth-required' });
  await view.bind().ready;
  assert.match(view.root.innerHTML, /Campaigns could not be loaded/);
  assert.match(view.root.innerHTML, /data-map-retry/);
  assert.doesNotMatch(view.root.innerHTML, /login|log.in|password|private.*link|GM access is required/i);
  assert.equal(view.calls.length, 0);
  view.client.getCampaigns = async () => ({ state: 'ok', data: { campaigns: [] } });
  await view.bind().ready;
  assert.match(view.root.innerHTML, /No campaigns are available/);
  assert.equal(view.calls.length, 0);
});

test('transient campaign failure recovers without login or starting a player session', async () => {
  const view = setupView();
  const discover = view.client.getCampaigns;
  let signedIn = false, starts = 0;
  view.client.getCampaigns = async () => signedIn ? discover() : { state: 'auth-required' };
  view.client.start = async () => { starts++; throw new Error('Preparation must not start a player session'); };
  await view.bind().ready;
  assert.doesNotMatch(view.root.innerHTML, /name="password"|name="username"/);
  signedIn = true;
  await view.event('click', '[data-map-retry]');
  assert.match(view.root.innerHTML, /Mists of Zalazar/);
  assert.match(view.root.innerHTML, /data-map/);
  assert.equal(starts, 0);
});

test('malformed map revisions fail closed without letting a blank map overwrite saved markers', async () => {
  const view = setupView();
  view.client.getCampaignMap = async () => ({ state: 'ok', data: { campaignMap: { map: emptyCampaignMap() } } });
  await view.bind().ready;
  assert.match(view.root.innerHTML, /Map could not be loaded/);
  await view.event('click', '[data-place-hex]');
  assert.equal(view.calls.some(call => call[0] === 'save'), false);
});
