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
function authenticate(f) { f.sessionStore.setItem('pf2e-gm-toolkit/pfpc-session-token', 'session-secret'); }
const active = { state: 'active', startedAt: '2026-09-27T10:00:00.000Z', activeUntil: '2026-09-27T16:00:00.000Z', remainingSeconds: 21600 };

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

test('login has exact route and body, retains only the token in session storage', async () => {
  const f = fixture(async () => response(200, { accessToken: 'session-secret' }));
  f.client.configureBaseUrl('https://pfpc.example');
  assert.deepEqual(await f.client.login('gm', 'password-secret'), { state: 'authenticated' });
  assert.equal(f.calls[0].url, 'https://pfpc.example/auth/login');
  assert.deepEqual(f.calls[0].options, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'gm', password: 'password-secret' }) });
  assert.equal(f.sessionStore.values.get('pf2e-gm-toolkit/pfpc-session-token'), 'session-secret');
  assert.equal([...f.localStore.values.values()].some(value => /password-secret|session-secret/.test(value)), false);
  assert.equal([...f.sessionStore.values.values()].some(value => value.includes('password-secret')), false);
  f.client.clearSession();
  assert.equal(f.sessionStore.values.size, 0);
});

test('Start sends only bearer authorization and accepts successful status', async () => {
  const f = fixture(async () => response(200, active));
  f.client.configureBaseUrl('https://pfpc.example');
  authenticate(f);
  assert.deepEqual(await f.client.start(), active);
  assert.equal(f.calls[0].url, 'https://pfpc.example/admin/companion/start');
  assert.deepEqual(f.calls[0].options, { method: 'POST', headers: { Authorization: 'Bearer session-secret' } });
  assert.equal(Object.hasOwn(f.calls[0].options, 'body'), false);
});

test('active conflict returns the exact existing deadline without retry or mutation', async () => {
  const f = fixture(async () => response(409, { code: 'lease_active', ...active }));
  f.client.configureBaseUrl('https://pfpc.example');
  authenticate(f);
  const result = await f.client.start();
  assert.equal(result.state, 'active-start-conflict');
  assert.equal(result.lease.activeUntil, active.activeUntil);
  assert.equal(f.calls.length, 1);
});

test('Stop uses the administrator bearer token and exact route', async () => {
  const f = fixture(async () => response(200, { state: 'offline' }));
  f.client.configureBaseUrl('https://pfpc.example');
  authenticate(f);
  assert.deepEqual(await f.client.stop(), { state: 'offline' });
  assert.equal(f.calls[0].url, 'https://pfpc.example/admin/companion/stop');
  assert.deepEqual(f.calls[0].options, { method: 'POST', headers: { Authorization: 'Bearer session-secret' } });
});

test('401 clears token; 403 reports administrator requirement', async () => {
  const unauthorized = fixture(async () => response(401, {}));
  unauthorized.client.configureBaseUrl('https://pfpc.example');
  authenticate(unauthorized);
  assert.deepEqual(await unauthorized.client.stop(), { state: 'auth-required' });
  assert.equal(unauthorized.sessionStore.values.size, 0);

  const forbidden = fixture(async () => response(403, {}));
  forbidden.client.configureBaseUrl('https://pfpc.example');
  authenticate(forbidden);
  assert.deepEqual(await forbidden.client.start(), { state: 'admin-required' });
});

test('unconfigured and network failures are represented without writes', async () => {
  const empty = fixture();
  assert.deepEqual(await empty.client.getStatus(), { state: 'unconfigured' });
  assert.deepEqual(await empty.client.start(), { state: 'unconfigured' });
  assert.equal(empty.calls.length, 0);

  const failed = fixture(async () => { throw new Error('offline'); });
  failed.client.configureBaseUrl('https://pfpc.example');
  assert.deepEqual(await failed.client.getStatus(), { state: 'unreachable' });
  assert.deepEqual(await failed.client.login('gm', 'pw'), { state: 'unreachable' });
  assert.equal(failed.calls.every(call => call.url.endsWith('/companion/status') || call.url.endsWith('/auth/login')), true);
});

test('status retries are GET-only and never invoke Start or Stop', async () => {
  const f = fixture(async () => { throw new Error('offline'); });
  f.client.configureBaseUrl('https://pfpc.example');
  assert.deepEqual(await f.client.getStatus({ retries: 2 }), { state: 'unreachable' });
  assert.equal(f.calls.length, 3);
  assert.ok(f.calls.every(call => call.url.endsWith('/companion/status') && Object.keys(call.options).length === 0));
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
  assert.doesNotMatch(clientSource, /railway|keepalive|extend/i);
  assert.equal(f.calls.length, before);
});
