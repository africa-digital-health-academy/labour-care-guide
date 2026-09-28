// version.js - the single source of the application version.
//
// Loaded by the service worker (importScripts) AND by the app (ES import), so a
// release is exactly one edit here: the offline cache key and the About screen
// follow automatically. Classic-script compatible on purpose (no `export`):
// importScripts() cannot load ES modules.
self.LCG_VERSION = '2.0.0-dev';
