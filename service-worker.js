const CACHE_NAME = 'pf2e-gm-v1';
const OFFLINE_URLS = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './src/app.js',
  './src/store.js',
  './src/pf2e.js',
  './src/views/encounters.js',
  './src/views/combat.js',
  './src/views/bestiary.js',
  './src/views/loot.js',
  './src/dom.js',
  './src/data.js',
  './data/creatures.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(OFFLINE_URLS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
  )));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // network-first for navigations so a deploy is picked up immediately
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).then(resp => {
        const copy = resp.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        return resp;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }
  // cache-first for assets and data
  event.respondWith(caches.match(event.request).then(resp => resp || fetch(event.request)));
});
