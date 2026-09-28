// sw.js — service worker: offline support with automatic updates.
//
// Strategy: stale-while-revalidate for same-origin GETs. We serve the cached
// copy instantly (fast, works offline — essential for low-connectivity wards)
// AND fetch a fresh copy in the background to update the cache, so the NEXT
// load picks up new code without any manual cache-busting. CACHE_VERSION is
// still bumped each release so a new service worker fully refreshes the shell
// on activation; the background revalidation is the safety net if it isn't.

const CACHE_VERSION = 'parthograph-v1.3.0';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './icons/icon.svg',
  './js/app.js', './js/store.js', './js/db.js', './js/ui.js', './js/i18n.js',
  './js/ethiopic.js', './js/protocol.js', './js/alerts.js', './js/wizard.js',
  './js/chart.js', './js/fhir.js', './js/demo.js',
  './js/views/dashboard.js', './js/views/admission.js', './js/views/patient.js',
  './js/views/delivery.js', './js/views/referral.js', './js/views/reports.js',
  './js/views/settings.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // let cross-origin requests go straight to network

  e.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(e.request);

    // background revalidation: fetch fresh, update cache for next time
    const networkUpdate = fetch(e.request).then(res => {
      if (res && res.ok) cache.put(e.request, res.clone());
      return res;
    }).catch(() => null);

    if (cached) {
      e.waitUntil(networkUpdate); // keep the SW alive while it refreshes the cache
      return cached;
    }
    // not cached yet → wait for network; offline fallback to the app shell
    const res = await networkUpdate;
    return res || (await cache.match('./index.html'));
  })());
});
