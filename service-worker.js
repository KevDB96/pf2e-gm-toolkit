// The shell rotates on each release. Reference data intentionally does not: a shell-only
// deploy must not evict several megabytes the GM has already chosen to download.
const SHELL_CACHE = 'pf2e-gm-shell-v73';
const REFERENCE_CACHE = 'pf2e-gm-reference-v1';
const LEGACY_CACHES = ['pf2e-gm-v62'];
const BASE = new URL('./', self.location).pathname;
const METADATA_FILE = 'cache-metadata.json';
const METADATA_URL = new URL('./data/' + METADATA_FILE, self.location).href;

const OFFLINE_URLS = [
  './', './index.html', './styles.css', './manifest.json', './src/app.js', './src/store.js',
  './src/pf2e.js', './src/wake.js', './src/dom.js', './src/data.js', './src/offline.js', './src/pathbuilder.js',
  './src/facets.js', './src/records.js', './src/youtube.js', './src/search.js', './src/library-filter.js', './src/saved-encounters.js', './src/pins.js',
  './src/combat-details.js', './src/backup.js', './src/combat-turn.js', './src/combat-history.js', './src/exploration.js', './src/gm-reference.js',
  './src/views/home.js', './src/views/encounters.js', './src/views/combat.js',
  './src/views/library.js', './src/views/loot.js', './src/views/notes.js',
  './src/views/party.js', './src/views/sound.js', './data/soundtrack.json',
  './player.html', './src/player.js', './src/player-state.js', './src/player-channel.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png'
];

const FONT_ORIGINS = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];
const LIVE_DATA = ['characters.json', 'campaign.json', 'codex.json', 'index.json', 'search.json'];
// Large categories remain on-demand. These small categories become ready after install.
const WARM_REFERENCE_FILES = [
  'conditions.json', 'skills.json', 'classes.json', 'ancestries.json', 'heritages.json',
  'backgrounds.json', 'archetypes.json', 'actions.json', 'rituals.json', 'traits.json',
  'deities.json', 'hazards.json'
];

let referenceMetadata = null;
const downloads = new Map();

function dataUrl(file) { return new URL('./data/' + file, self.location).href; }
function isReferenceUrl(url) {
  return url.origin === self.location.origin && url.pathname.startsWith(BASE + 'data/') &&
    !!referenceMetadata?.files?.[url.pathname.split('/').pop()];
}
function isLive(url) {
  if (url.origin !== self.location.origin) return false;
  return url.pathname.startsWith(BASE + 'src/') || url.pathname.endsWith('.html') ||
    url.pathname.endsWith('styles.css') || url.pathname.endsWith('manifest.json') ||
    LIVE_DATA.some(file => url.pathname.endsWith('/data/' + file));
}
function storableShell(request, response) {
  const origin = new URL(request.url).origin;
  if (FONT_ORIGINS.includes(origin)) return response.ok || response.type === 'opaque';
  return response.ok && origin === self.location.origin;
}
async function putShell(request, response) {
  if (storableShell(request, response)) await (await caches.open(SHELL_CACHE)).put(request, response.clone());
}
function validMetadata(value) {
  return value && value._schema === 1 && value.files &&
    Object.values(value.files).every(file => /^[a-f0-9]{64}$/.test(file?.sha256) &&
      Number.isInteger(file.bytes) && file.bytes >= 0);
}
async function readMetadata(response) {
  try { const value = await response.clone().json(); return validMetadata(value) ? value : null; } catch { return null; }
}
async function loadCachedMetadata() {
  const hit = await (await caches.open(REFERENCE_CACHE)).match(METADATA_URL);
  const metadata = hit && await readMetadata(hit);
  if (metadata) referenceMetadata = metadata;
  return metadata;
}
// A malformed response never replaces the last coherent offline contract.
async function refreshMetadata() {
  try {
    const response = await fetch(METADATA_URL, { cache: 'no-store' });
    const metadata = response.ok && await readMetadata(response);
    if (!metadata) return referenceMetadata || await loadCachedMetadata();
    await (await caches.open(REFERENCE_CACHE)).put(METADATA_URL, response.clone());
    referenceMetadata = metadata;
    return metadata;
  } catch { return referenceMetadata || await loadCachedMetadata(); }
}
async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
function cachedHash(response) { return response.headers.get('X-PF2E-Reference-SHA256'); }
// Buffer and verify before replacement. Interrupted or bad downloads leave older data usable.
async function stageReference(request, response, expected) {
  if (!response.ok || !expected) return false;
  const body = await response.clone().arrayBuffer();
  if (body.byteLength !== expected.bytes || await sha256(body) !== expected.sha256) return false;
  const headers = new Headers(response.headers);
  headers.set('X-PF2E-Reference-SHA256', expected.sha256);
  headers.set('X-PF2E-Reference-Bytes', String(expected.bytes));
  const staged = new Response(body, { status: response.status, statusText: response.statusText, headers });
  await (await caches.open(REFERENCE_CACHE)).put(request, staged);
  return true;
}
async function refreshReference(request, expected) {
  try { return await stageReference(request, await fetch(request, { cache: 'no-store' }), expected); } catch { return false; }
}
async function migrateLegacy(metadata) {
  const target = await caches.open(REFERENCE_CACHE);
  for (const legacyName of LEGACY_CACHES) {
    const legacy = await caches.open(legacyName);
    for (const [file, expected] of Object.entries(metadata.files)) {
      const request = dataUrl(file);
      if (await target.match(request)) continue;
      const old = await legacy.match(request);
      if (old) await stageReference(request, old, expected);
    }
  }
}
async function warmReferences(metadata) {
  const cache = await caches.open(REFERENCE_CACHE);
  for (const file of WARM_REFERENCE_FILES) {
    const expected = metadata.files[file];
    if (!expected) continue;
    const request = dataUrl(file);
    const hit = await cache.match(request);
    if (!hit || cachedHash(hit) !== expected.sha256) await refreshReference(request, expected);
  }
}

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(OFFLINE_URLS)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await loadCachedMetadata();
    const metadata = await refreshMetadata();
    if (metadata) { await migrateLegacy(metadata); await warmReferences(metadata); }
    // GitHub Pages shares an origin: only delete caches this app explicitly owned.
    const keys = await caches.keys();
    await Promise.all(LEGACY_CACHES.filter(name => keys.includes(name)).map(name => caches.delete(name)));
    await self.clients.claim();
  })().catch(() => {}));
});
function keep(event, task) { event.waitUntil(Promise.resolve(task).catch(() => {})); }

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => { keep(event, putShell(request, response)); return response; })
      .catch(() => caches.match('./index.html')));
    return;
  }
  // Metadata is fresh online; the latest coherent version remains offline.
  if (url.href === METADATA_URL) {
    event.respondWith(fetch(request, { cache: 'no-store' }).then(async response => {
      const metadata = response.ok && await readMetadata(response);
      if (metadata) {
        referenceMetadata = metadata;
        keep(event, caches.open(REFERENCE_CACHE).then(cache => cache.put(request, response.clone())));
      }
      return response;
    }).catch(() => caches.open(REFERENCE_CACHE).then(cache => cache.match(request))));
    return;
  }
  if (isLive(url)) {
    event.respondWith(fetch(request).then(response => { keep(event, putShell(request, response)); return response; })
      .catch(() => caches.match(request)));
    return;
  }
  if (isReferenceUrl(url)) {
    event.respondWith((async () => {
      const expected = referenceMetadata.files[url.pathname.split('/').pop()];
      const cache = await caches.open(REFERENCE_CACHE);
      const hit = await cache.match(request);
      if (hit) {
        if (cachedHash(hit) !== expected.sha256) keep(event, refreshReference(request, expected));
        return hit;
      }
      const response = await fetch(request);
      if (response.ok) keep(event, stageReference(request, response, expected));
      return response;
    })());
    return;
  }
  // Icons and the two allowed opaque font origins are cache-first. HTTP errors stay uncached.
  event.respondWith(caches.match(request).then(hit => hit || fetch(request).then(response => {
    keep(event, putShell(request, response));
    return response;
  })));
});

async function offlineSnapshot() {
  const metadata = referenceMetadata || await loadCachedMetadata();
  const reference = await caches.open(REFERENCE_CACHE);
  const shell = await caches.open(SHELL_CACHE);
  const categories = await Promise.all(Object.entries(metadata?.files || {}).map(async ([file, expected]) => {
    const hit = await reference.match(dataUrl(file));
    return { file, bytes: expected.bytes,
      status: !hit ? 'missing' : cachedHash(hit) === expected.sha256 ? 'ready' : 'older' };
  }));
  const coreFiles = ['index.html', ...LIVE_DATA];
  const core = await Promise.all(coreFiles.map(async file => ({
    file, status: await shell.match(file === 'index.html' ? new URL('./index.html', self.location).href : dataUrl(file))
      ? 'ready' : 'missing'
  })));
  return { type: 'PF2E_OFFLINE', action: 'status', supported: !!metadata, categories, core };
}

function tell(client, message) { client?.postMessage({ type: 'PF2E_OFFLINE', ...message }); }

async function downloadReferences(client, id, files) {
  const metadata = referenceMetadata || await refreshMetadata();
  const wanted = [...new Set(files || [])].filter(file => metadata?.files?.[file]);
  const job = { cancelled: false };
  downloads.set(id, job);
  let next = 0;
  let completed = 0;
  const failed = [];
  const report = phase => tell(client, { action: 'progress', id, phase, total: wanted.length, completed, failed });
  report('downloading');
  const one = async () => {
    while (!job.cancelled) {
      const file = wanted[next++];
      if (!file) return;
      const expected = metadata.files[file];
      try {
        const hit = await (await caches.open(REFERENCE_CACHE)).match(dataUrl(file));
        if (!hit || cachedHash(hit) !== expected.sha256) {
          if (!await refreshReference(dataUrl(file), expected)) throw new Error('Could not verify download');
        }
        completed++;
      } catch { failed.push(file); }
      report('downloading');
    }
  };
  await Promise.all([one(), one()]); // bounded queue: two responses at a time
  downloads.delete(id);
  report(job.cancelled ? 'cancelled' : failed.length ? 'failed' : 'complete');
}

self.addEventListener('message', event => {
  const message = event.data;
  if (message?.type !== 'PF2E_OFFLINE') return;
  if (message.action === 'status') {
    event.waitUntil(offlineSnapshot().then(snapshot => event.ports[0]?.postMessage(snapshot))
      .catch(() => event.ports[0]?.postMessage({ type: 'PF2E_OFFLINE', action: 'status', supported: false, categories: [], core: [] })));
  }
  if (message.action === 'cancel') downloads.get(message.id) && (downloads.get(message.id).cancelled = true);
  if (message.action === 'download') event.waitUntil(downloadReferences(event.source, message.id, message.files).catch(() => {}));
});
