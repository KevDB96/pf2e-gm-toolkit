const CACHE_NAME = 'pf2e-gm-v48';

// Where this worker is served from: '/' locally, '/pf2e-gm-toolkit/' on GitHub Pages.
// Every path test below is relative to it. An absolute '/src/' test passed locally and
// silently failed under a subpath, which flipped the whole shell to cache-first — the
// one thing it must never be.
const BASE = new URL('./', self.location).pathname;

// The app shell: small, and precached so the first offline load always works.
const OFFLINE_URLS = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './src/app.js',
  './src/store.js',
  './src/pf2e.js',
  './src/wake.js',
  './src/dom.js',
  './src/data.js',
  './src/pathbuilder.js',
  './src/facets.js',
  './src/records.js',
  './src/youtube.js',
  './src/search.js',
  './src/views/home.js',
  './src/views/encounters.js',
  './src/views/combat.js',
  './src/views/library.js',
  './src/views/loot.js',
  './src/views/notes.js',
  './src/views/party.js',
  './src/views/sound.js',
  './data/soundtrack.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png'
];

// Google Fonts. Cinzel and Inter are the only cross-origin assets the app loads, and
// they were never cached: cachePut() refuses anything cross-origin, so offline the app
// silently fell back to system-ui and Georgia. They cannot be precached — the woff2 URLs
// live inside the stylesheet and vary by browser — so they are cached on first use
// instead, which is fine because installing already requires one online load.
const FONT_ORIGINS = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];

// Small data files, warmed in the background after activation. Together about 4 MB,
// so pulling them costs little and makes the Campaign screen and most of the Library
// work offline straight after install. search.json is what lets the Library's global
// search work offline before any one category has been opened.
const WARM_URLS = [
  './data/index.json',
  './data/search.json',
  './data/campaign.json',
  './data/characters.json',
  './data/codex.json',
  './data/conditions.json',
  './data/skills.json',
  './data/classes.json',
  './data/ancestries.json',
  './data/heritages.json',
  './data/backgrounds.json',
  './data/archetypes.json',
  './data/actions.json',
  './data/rituals.json',
  './data/traits.json',
  './data/deities.json',
  './data/hazards.json'
];

// Files that change between deploys and must never be served from a stale cache.
// Declared here because the activate handler below uses it.
const LIVE_DATA = ['characters.json', 'campaign.json', 'codex.json', 'index.json', 'search.json'];

// creatures (2.4 MB), equipment (3.0 MB), feats (2.3 MB) and spells (0.8 MB) are left
// out on purpose — 8 MB of background download on mobile data is not a decision the app
// should make for you. The fetch handler caches each one the first time a screen opens
// it, so whatever you actually use goes offline by itself.

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(OFFLINE_URLS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
    // Best effort, one file at a time so the warm never starves the app. The live files
    // are re-fetched unconditionally: they change between deploys, and a skipped refresh
    // is what left an imported character invisible in the app.
    const cache = await caches.open(CACHE_NAME);
    for (const url of WARM_URLS) {
      const live = LIVE_DATA.some(f => url.endsWith('/' + f));
      if (!live && await cache.match(url)) continue;
      try { await cache.add(url); } catch { /* picked up on first use instead */ }
    }
  })());
});

/**
 * Everything small and mutable is served network-first, with the cache only as an
 * offline fallback. Two separate bugs came from getting this wrong:
 *
 *  - The shell must update as one unit. Cache-first left a new index.html paired with a
 *    stale app.js, so a newly added tab rendered while its route did not exist.
 *  - data/characters.json and data/campaign.json are hand-edited or written by an import
 *    tool between deploys. Cache-first pinned them to whatever copy was cached first, so
 *    PCs imported afterwards never appeared until CACHE_NAME happened to be bumped.
 *
 * The shell is ~60 KB and revalidates on every load. codex.json is the one large member
 * at ~0.9 MB, but it is fetched only when a character sheet is opened, and it is
 * regenerated every time a PC changes — exactly the case cache-first gets wrong. Only
 * the multi-megabyte reference files, which change only on a full data rebuild, stay
 * cache-first.
 */
function isLive(url) {
  if (url.origin !== self.location.origin) return false;
  return url.pathname.startsWith(BASE + 'src/') ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('styles.css') ||
    url.pathname.endsWith('manifest.json') ||
    LIVE_DATA.some(f => url.pathname.endsWith('/data/' + f));
}

/**
 * A cross-origin stylesheet or font is requested no-cors, so what comes back is an
 * opaque response: `ok` is false and `status` is 0 even on success. `cache.put()` stores
 * one anyway — unlike `cache.add()`, which rejects it — and it replays fine, so the
 * fonts survive offline. Nothing else cross-origin is stored: an opaque response hides
 * its own failures, and that is only an acceptable trade for two known font hosts.
 */
function storable(request, response) {
  const origin = new URL(request.url).origin;
  if (FONT_ORIGINS.includes(origin)) return response.ok || response.type === 'opaque';
  return response.ok && origin === self.location.origin;
}

function cachePut(request, response) {
  if (storable(request, response)) {
    const copy = response.clone();
    caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // Network-first for navigations so a deploy is picked up immediately.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then(resp => cachePut(request, resp))
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Network-first for the rest of the shell and the small live data files.
  if (isLive(new URL(request.url))) {
    event.respondWith(
      fetch(request).then(resp => cachePut(request, resp))
        .catch(() => caches.match(request))
    );
    return;
  }

  // Cache-first for reference data, icons and the Google Fonts files — multi-megabyte
  // and effectively immutable between regenerations, and stored on first use so whatever
  // you open goes offline. Fonts land here because isLive() is false for cross-origin.
  event.respondWith(caches.match(request).then(hit =>
    hit || fetch(request).then(resp => cachePut(request, resp))));
});
