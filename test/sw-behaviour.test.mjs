// sw-behaviour.test.mjs - the service worker on an origin shared with other
// apps (M6). Every GitHub Pages site of one account is one origin and Cache
// Storage is per origin: v2 must delete only its own old caches, and must
// refill its whole shell in one step when another app's worker deleted it.
// sw.js runs in a node:vm sandbox with a fake Cache Storage and fetch.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const BASE = 'https://example.github.io/labour-care-guide/';
const SRC = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

function loadWorker({ caches: names = [], online = true } = {}) {
  const store = new Map(names.map(n => [n, new Map()]));
  const log = { deleted: [], addAll: 0, fetched: [] };
  const abs = k => (typeof k === 'string' ? new URL(k, BASE).href : k.url);
  const response = url => ({ ok: true, url, clone() { return this; } });
  const cacheStorage = {
    keys: async () => [...store.keys()],
    delete: async n => { log.deleted.push(n); return store.delete(n); },
    open: async n => {
      if (!store.has(n)) store.set(n, new Map());
      const m = store.get(n);
      return {
        match: async k => m.get(abs(k)),
        put: async (k, r) => { m.set(abs(k), r); },
        addAll: async reqs => {
          log.addAll++;
          if (!online) throw new TypeError('offline');
          for (const r of reqs) m.set(r.url, response(r.url));
        },
      };
    },
  };
  const listeners = {};
  const self = {
    location: { href: BASE + 'sw.js', origin: new URL(BASE).origin },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  };
  class Request { constructor(u, o = {}) { this.url = new URL(u, BASE).href; this.cache = o.cache; } }
  const sandbox = {
    self, caches: cacheStorage, Request, URL, Set, Promise, TypeError,
    Response: { error: () => ({ error: true }) },
    fetch: async req => {
      log.fetched.push(abs(req));
      if (!online) throw new TypeError('offline');
      return response(abs(req));
    },
    importScripts: () => { self.LCG_VERSION = '9.9.9-test'; },
  };
  vm.runInNewContext(SRC, sandbox);
  const fire = async (type, extra = {}) => {
    let p = null;
    const ev = { ...extra, waitUntil: x => { p = x; }, respondWith: x => { p = x; } };
    listeners[type](ev);
    return p;
  };
  return { store, log, fire, setOnline: v => { online = v; } };
}

const get = (url, mode = 'no-cors') => ({ request: { method: 'GET', url, mode } });

test('activate deletes only our own old caches: other apps on the origin keep theirs', async () => {
  const w = loadWorker({ caches: ['lcg-2.0.0-dev', 'lcg-9.9.9-test', 'parthograph-v1.3.0', 'bbi-v37', 'workbox-precache'] });
  await w.fire('activate');
  assert.deepEqual(w.log.deleted, ['lcg-2.0.0-dev']);
  assert.deepEqual([...w.store.keys()].sort(), ['bbi-v37', 'lcg-9.9.9-test', 'parthograph-v1.3.0', 'workbox-precache']);
});

test('install fills the whole shell in one all-or-nothing step, bypassing the HTTP cache', async () => {
  const w = loadWorker();
  await w.fire('install');
  assert.equal(w.log.addAll, 1);
  const cache = w.store.get('lcg-9.9.9-test');
  assert.ok(cache.has(BASE + 'js/app.js') && cache.has(BASE + 'index.html') && cache.has(BASE + 'sw.js') === false);
});

test('a shell file whose cache another app deleted: the whole shell is fetched again, once', async () => {
  const w = loadWorker();
  await w.fire('install');
  w.store.delete('lcg-9.9.9-test'); // another app's worker wiped our cache
  const [a, b] = await Promise.all([w.fire('fetch', get(BASE + 'js/app.js')), w.fire('fetch', get(BASE + 'js/alerts.js'))]);
  assert.equal((await a).url, BASE + 'js/app.js');
  assert.equal((await b).url, BASE + 'js/alerts.js');
  assert.equal(w.log.addAll, 2, 'install plus one shared refill, not one per file');
  assert.equal(w.log.fetched.length, 0, 'no single-file fetch: files never mix between releases');
  assert.ok(w.store.get('lcg-9.9.9-test').has(BASE + 'js/record.js'), 'the refill restored the whole shell');
});

test('a navigation is served from the cached index.html', async () => {
  const w = loadWorker();
  await w.fire('install');
  const res = await w.fire('fetch', get(BASE + 'some/deep/route', 'navigate'));
  assert.equal(res.url, BASE + 'index.html');
});

test('offline with our cache wiped: the shell cannot be refilled and the request fails cleanly', async () => {
  const w = loadWorker();
  await w.fire('install');
  w.store.delete('lcg-9.9.9-test');
  w.setOnline(false);
  const res = await w.fire('fetch', get(BASE + 'js/app.js'));
  assert.deepEqual(res, { error: true });
});
