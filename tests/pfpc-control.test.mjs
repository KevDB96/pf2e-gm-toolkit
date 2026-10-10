import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPfpcClient, normalizePfpcBaseUrl, PFPC_BASE_URL_KEY } from '../src/pfpc-control.js';

function storage() {
  const values = new Map();
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
}
function response(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}
function fixture(handler = async () => response(200, { state: 'offline' })) {
  const localStore = storage();
  const sessionStore = storage();
  const calls = [];
  const client = createPfpcClient({
    localStore, sessionStore,
    fetchImpl: async (url, options = {}) => { calls.push({ url, options }); return handler(url, options); }
  });
  return { client, localStore, sessionStore, calls };
}
const active = { state: 'active', startedAt: '2026-09-27T10:00:00.000Z', activeUntil: '2026-09-27T16:00:00.000Z', remainingSeconds: 21600 };

test('old credentials are cleared; GM campaign discovery needs no login', async () => {
  const localStore = storage();
  const sessionStore = storage();
  localStore.setItem(PFPC_BASE_URL_KEY, 'https://pfpc.example');
  localStore.setItem('pf2e-gm-toolkit/pfpc-device-access', 'a'.repeat(43));
  sessionStore.setItem('pf2e-gm-toolkit/pfpc-session-token', 'session-secret');
  const client = createPfpcClient({ localStore, sessionStore, fetchImpl: async () => response(200, { campaigns: [] }) });
  assert.equal(localStore.getItem('pf2e-gm-toolkit/pfpc-device-access'), null);
  assert.equal(sessionStore.getItem('pf2e-gm-toolkit/pfpc-session-token'), null);
  assert.deepEqual(await client.getCampaigns(), { state: 'ok', data: { campaigns: [] } });
});

test('base URL validation allows HTTPS and explicit local development only', () => {
  assert.equal(normalizePfpcBaseUrl('https://companion.example/'), 'https://companion.example');
  assert.equal(normalizePfpcBaseUrl('http://localhost:8787', { production: false }), 'http://localhost:8787');
  for (const url of ['', 'not a url', 'javascript:alert(1)', 'data:text/plain,x', 'file:///tmp/x',
    'https://user:pass@example.com', 'https://example.com/path', 'https://example.com/?x=1', 'https://example.com/#x',
    'http://example.com', 'http://127.0.0.1:8787', 'https://example.com/./', 'https://example.com/foo/..']) {
    assert.throws(() => normalizePfpcBaseUrl(url, { production: true }));
  }
});

test('configuration persists separately and status reads anonymous offline or active states', async () => {
  const offline = fixture();
  assert.equal(offline.client.configureBaseUrl('https://pfpc.example/'), 'https://pfpc.example');
  assert.equal(offline.localStore.getItem(PFPC_BASE_URL_KEY), 'https://pfpc.example');
  assert.deepEqual(await offline.client.getStatus(), { state: 'offline' });
  assert.equal(offline.calls[0].url, 'https://pfpc.example/companion/status');
  assert.deepEqual(offline.calls[0].options, {});

  const online = fixture(async () => response(200, active));
  online.client.configureBaseUrl('https://pfpc.example');
  const observed = await online.client.getStatus();
  assert.deepEqual(observed, active);
  assert.equal(observed.activeUntil, active.activeUntil);
  assert.deepEqual(online.calls[0].options, {});
});

test('Start requires no GM credential and accepts successful status', async () => {
  const f = fixture(async () => response(200, active));
  f.client.configureBaseUrl('https://pfpc.example');
  assert.deepEqual(await f.client.start(), active);
  assert.equal(f.calls[0].url, 'https://pfpc.example/admin/companion/start');
  assert.deepEqual(f.calls[0].options, { method: 'POST' });
  assert.equal(Object.hasOwn(f.calls[0].options, 'body'), false);
});

test('active conflict returns the exact existing deadline without retry or mutation', async () => {
  const f = fixture(async () => response(409, { code: 'lease_active', ...active }));
  f.client.configureBaseUrl('https://pfpc.example');
  const result = await f.client.start();
  assert.equal(result.state, 'active-start-conflict');
  assert.equal(result.lease.activeUntil, active.activeUntil);
  assert.equal(f.calls.length, 1);
});

test('Stop requires no GM credential and uses the exact route', async () => {
  const f = fixture(async () => response(200, { state: 'offline' }));
  f.client.configureBaseUrl('https://pfpc.example');
  assert.deepEqual(await f.client.stop(), { state: 'offline' });
  assert.equal(f.calls[0].url, 'https://pfpc.example/admin/companion/stop');
  assert.deepEqual(f.calls[0].options, { method: 'POST' });
});

test('backend access errors show unavailable, not a login prompt', async () => {
  const unauthorized = fixture(async () => response(401, {}));
  unauthorized.client.configureBaseUrl('https://pfpc.example');
  assert.deepEqual(await unauthorized.client.stop(), { state: 'unreachable' });
  const forbidden = fixture(async () => response(403, {}));
  forbidden.client.configureBaseUrl('https://pfpc.example');
  assert.deepEqual(await forbidden.client.start(), { state: 'unreachable' });
});

test('unconfigured and network failures are represented without writes', async () => {
  const empty = fixture();
  assert.deepEqual(await empty.client.getStatus(), { state: 'unconfigured' });
  assert.deepEqual(await empty.client.start(), { state: 'unconfigured' });
  assert.equal(empty.calls.length, 0);

  const failed = fixture(async () => { throw new Error('offline'); });
  failed.client.configureBaseUrl('https://pfpc.example');
  assert.deepEqual(await failed.client.getStatus(), { state: 'unreachable' });
  assert.equal(failed.calls.every(call => call.url.endsWith('/companion/status')), true);
});

test('status retries are GET-only and never invoke Start or Stop', async () => {
  const f = fixture(async () => { throw new Error('offline'); });
  f.client.configureBaseUrl('https://pfpc.example');
  assert.deepEqual(await f.client.getStatus({ retries: 2 }), { state: 'unreachable' });
  assert.equal(f.calls.length, 3);
  assert.ok(f.calls.every(call => call.url.endsWith('/companion/status') && Object.keys(call.options).length === 0));
});

test('workflow client serializes typed session, workflow, map and narrow condition mutations', async () => {
  const f = fixture(async () => response(200, { workflow: { revision: 4 } }));
  f.client.configureBaseUrl('https://pfpc.example');
  await f.client.getSessionState('campaign/a');
  await f.client.setSessionState('campaign/a', 2, { phase: 'combat' });
  await f.client.getWorkflow('campaign/a');
  await f.client.setCondition('campaign/a', 4, 'hero', { id: 'frightened', name: 'Frightened', value: 2 });
  await f.client.removeCondition('campaign/a', 5, 'hero', 'frightened');
  await f.client.setExploration('campaign/a', 6, 'hero', 'scout');
  await f.client.setExploration('campaign/a', 7, 'hero', null);
  await f.client.setDowntime('campaign/a', 7, 'hero', null);
  await f.client.advanceMonth('campaign/a', 3, 'advance-0001');
  await f.client.getCampaignMap('campaign/a');
  await f.client.setCampaignMap('campaign/a', 8, { party: null, flags: {}, enemies: [] });
  assert.equal(f.calls[0].url, 'https://pfpc.example/gm/campaigns/campaign%2Fa/session-state');
  assert.deepEqual(f.calls[0].options.headers, {});
  assert.deepEqual(JSON.parse(f.calls[1].options.body), { revision: 2, state: { phase: 'combat' } });
  assert.deepEqual(JSON.parse(f.calls[3].options.body), { revision: 4, action: 'condition-set', characterId: 'hero', condition: { id: 'frightened', name: 'Frightened', value: 2 } });
  assert.deepEqual(JSON.parse(f.calls[4].options.body), { revision: 5, action: 'condition-remove', characterId: 'hero', conditionId: 'frightened' });
  assert.deepEqual(JSON.parse(f.calls[5].options.body), { revision: 6, action: 'exploration-set', characterId: 'hero', activityId: 'scout' });
  assert.deepEqual(JSON.parse(f.calls[6].options.body), { revision: 7, action: 'exploration-set', characterId: 'hero', activityId: null });
  assert.deepEqual(JSON.parse(f.calls[7].options.body), { revision: 7, action: 'downtime-set', characterId: 'hero', choice: null });
  assert.deepEqual(JSON.parse(f.calls[8].options.body), { action: 'advance-month', expectedMonth: 3, operationId: 'advance-0001' });
  assert.deepEqual(JSON.parse(f.calls[10].options.body), { revision: 8, map: { party: null, flags: {}, enemies: [] } });
});

test('workflow auth expiry and stale writes are explicit; read retry never starts PFPC', async () => {
  const expired = fixture(async () => response(401, {}));
  expired.client.configureBaseUrl('https://pfpc.example');
  assert.deepEqual(await expired.client.getWorkflow('campaign'), { state: 'unreachable' });

  const conflict = fixture(async () => response(409, { code: 'revision_conflict', details: { currentRevision: 12 } }));
  conflict.client.configureBaseUrl('https://pfpc.example');
  assert.deepEqual(await conflict.client.setCondition('campaign', 4, 'hero', { id: 'frightened', name: 'Frightened' }), { state: 'conflict', currentRevision: 12, current: null });

  const retry = fixture(async () => { throw new Error('offline'); });
  retry.client.configureBaseUrl('https://pfpc.example');
  assert.deepEqual(await retry.client.getWorkflow('campaign', { retries: 2 }), { state: 'unreachable' });
  assert.equal(retry.calls.length, 3);
  assert.ok(retry.calls.every(call => call.url.endsWith('/workflow') && call.options.method === 'GET'));
  assert.equal(retry.calls.some(call => call.url.endsWith('/start')), false);
});

test('GM campaign discovery uses anonymous GET and never starts a session', async () => {
  const f = fixture(async () => response(200, { campaigns: [{ campaignId: 'mists', displayName: 'Mists of Zalazar' }] }));
  f.client.configureBaseUrl('https://pfpc.example');
  const result = await f.client.getCampaigns();
  assert.equal(result.data.campaigns[0].campaignId, 'mists');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, 'https://pfpc.example/gm/campaigns');
  assert.deepEqual(f.calls[0].options, { method: 'GET', headers: {} });
  assert.ok(!f.calls.some(call => call.url.includes('/auth/login') || call.url.includes('/start')));
});

test('module import and app lifecycle have no path to a control write', async () => {
  const f = fixture(async () => response(200, { state: 'offline' }));
  f.client.configureBaseUrl('https://pfpc.example');
  const before = f.calls.length;
  await import(`../src/pfpc-control.js?side-effect-check=${Date.now()}`);
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const store = await readFile(new URL('../src/store.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const clientSource = await readFile(new URL('../src/pfpc-control.js', import.meta.url), 'utf8');
  assert.match(app, /bindPfpcControl/);
  assert.doesNotMatch(app, /\.start\(|\.stop\(/);
  assert.doesNotMatch(store, /pfpc-control|\.start\(|\.stop\(/);
  assert.match(html, /src\/app\.js/);
  assert.doesNotMatch(clientSource, /keepalive|extend|auth\/login|Bearer/i);
  assert.equal(f.calls.length, before);
});
