// Guards the offline shell: a file missing from SHELL makes addAll() fail and
// silently leaves every tablet on the previous release.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = f => readFileSync(join(root, f), 'utf8');

function walk(dir, out = []) {
  for (const name of readdirSync(join(root, dir))) {
    const rel = dir + '/' + name;
    if (statSync(join(root, rel)).isDirectory()) walk(rel, out);
    else out.push('./' + rel);
  }
  return out;
}

function shellList() {
  const src = read('sw.js');
  const m = src.match(/const SHELL = \[([\s\S]*?)\];/);
  assert.ok(m, 'SHELL array found in sw.js');
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
}

test('every js/ and css/ file is pre-cached by the service worker', () => {
  const shell = new Set(shellList());
  const files = [...walk('js'), ...walk('css')];
  const missing = files.filter(f => !shell.has(f));
  assert.deepEqual(missing, []);
});

test('the shell includes the app entry points and icons', () => {
  const shell = new Set(shellList());
  for (const f of ['./', './index.html', './manifest.webmanifest', './icons/icon.svg', './icons/icon-maskable.svg']) {
    assert.ok(shell.has(f), f);
  }
});

test('sw.js and package.json share the single version constant', () => {
  assert.ok(read('sw.js').includes("importScripts('./js/version.js')"));
  const v = read('js/version.js').match(/LCG_VERSION = '([^']+)'/)[1];
  assert.equal(JSON.parse(read('package.json')).version, v);
});
