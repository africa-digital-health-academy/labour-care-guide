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
//  * The origin may be shared with other apps (every GitHub Pages site of one
//    account is one origin, and Cache Storage is per origin): this worker
//    deletes only its own old caches (prefix 'lcg-'), and if another app's
//    worker deleted ours, the whole shell is fetched again in one
//    all-or-nothing step, never file by file.
importScripts('./js/version.js');

const CACHE_PREFIX = 'lcg-';
const CACHE_VERSION = CACHE_PREFIX + self.LCG_VERSION;

const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './css/app.css', './css/print.css',
  './icons/icon.svg', './icons/icon-maskable.svg',
  './js/version.js',
  './js/app.js', './js/store.js', './js/db.js', './js/migrate.js', './js/ui.js', './js/i18n.js',
  './js/i18n/wizard.js', './js/i18n/patient.js', './js/i18n/forms.js', './js/i18n/reports.js', './js/partograph.js',
  './js/ethiopic.js', './js/protocol.js', './js/alerts.js', './js/record.js', './js/audit.js',
  './js/indicators.js', './js/wizard.js',
  './js/chart.js', './js/fhir.js', './js/demo.js', './js/preview.js',
  './js/views/dashboard.js', './js/views/admission.js', './js/views/patient.js',
  './js/views/delivery.js', './js/views/referral.js', './js/views/reports.js',
  './js/views/settings.js',
];
const SHELL_URLS = new Set(SHELL.map(u => new URL(u, self.location.href).href));

// cache: 'reload' bypasses the HTTP cache so a release is fetched fresh, and
// addAll is all-or-nothing, so a half-downloaded shell is never used.
const fillShell = () => caches.open(CACHE_VERSION)
  .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))));
let refilling = null; // one shared refill when another app wiped our cache

self.addEventListener('install', e => {
  e.waitUntil(fillShell());
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      // only our own old releases: other apps on this origin keep their caches
      .then(keys => Promise.all(keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE_VERSION).map(k => caches.delete(k))))
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
      let hit = await cache.match(key);
      if (!hit) {
        // our shell is gone (another app's worker on this origin deleted it):
        // fetch the whole shell again in one step so files never mix
        refilling = refilling || fillShell().finally(() => { refilling = null; });
        await refilling.catch(() => {});
        hit = await cache.match(key);
      }
      if (hit) return hit;
      try {
        return await fetch(e.request);
      } catch {
        return Response.error();
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
