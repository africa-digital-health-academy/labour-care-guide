// sw.js - service worker: offline-first app shell with safe, atomic updates.
//
// Strategy (v2):
//  * The app shell (every file in SHELL) is pre-cached under a cache keyed by
//    LCG_VERSION and served CACHE-FIRST from that cache. A running worker never
//    mixes files from two releases: a new worker downloads the whole new shell
//    (bypassing the browser HTTP cache) before it can take over.
//  * The new worker WAITS until the app asks it to activate (a SKIP_WAITING
//    message sent when the midwife taps the "Update ready" chip), so an open
//    ward board is never swapped under her hands.
//  * Everything else same-origin stays stale-while-revalidate. Cross-origin
//    requests go straight to the network.
importScripts('./js/version.js');

const CACHE_VERSION = 'lcg-' + self.LCG_VERSION;

const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './css/app.css',
  './icons/icon.svg', './icons/icon-maskable.svg',
  './js/version.js',
  './js/app.js', './js/store.js', './js/db.js', './js/ui.js', './js/i18n.js',
  './js/ethiopic.js', './js/protocol.js', './js/alerts.js', './js/wizard.js',
  './js/chart.js', './js/fhir.js', './js/demo.js',
  './js/views/dashboard.js', './js/views/admission.js', './js/views/patient.js',
  './js/views/delivery.js', './js/views/referral.js', './js/views/reports.js',
  './js/views/settings.js',
];
const SHELL_URLS = new Set(SHELL.map(u => new URL(u, self.location.href).href));

self.addEventListener('install', e => {
  // cache: 'reload' bypasses the HTTP cache so a release is fetched fresh, and
  // addAll is all-or-nothing, so a half-downloaded shell never activates.
  e.waitUntil(
    caches.open(CACHE_VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  url.search = ''; url.hash = '';
  const isNav = e.request.mode === 'navigate';
  const isShell = isNav || SHELL_URLS.has(url.href);

  e.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);

    if (isShell) {
      const key = isNav ? './index.html' : url.href;
      const cached = await cache.match(key);
      if (cached) return cached;
      try {
        const res = await fetch(e.request);
        if (res && res.ok) cache.put(key, res.clone());
        return res;
      } catch {
        return (await cache.match('./index.html')) || Response.error();
      }
    }

    const cached = await cache.match(e.request);
    const networkUpdate = fetch(e.request).then(res => {
      if (res && res.ok) cache.put(e.request, res.clone());
      return res;
    }).catch(() => null);
    if (cached) { e.waitUntil(networkUpdate); return cached; }
    const res = await networkUpdate;
    return res || Response.error();
  })());
});
