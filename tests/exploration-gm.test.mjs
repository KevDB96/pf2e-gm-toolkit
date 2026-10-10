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
  assert.match(html,/Faded markers are GM only/); assert.match(html,/Player view/);
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
