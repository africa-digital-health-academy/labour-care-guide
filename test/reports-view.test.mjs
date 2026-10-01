// Reports, Settings and app-shell strings (M5, agent E): the 'rp.' fragment is
// complete in both languages, every key the three files use exists, the
// screen's month names match the exports', and the Amharic-draft notice
// always carries the English original when the UI is in Amharic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { en, am } from '../js/i18n/reports.js';
import { EN_KEYS, setLang } from '../js/i18n.js';
import { MONTH_NAMES } from '../js/indicators.js';

// settings.js loads version.js, which writes self.LCG_VERSION (a browser global)
globalThis.self ??= globalThis;
const { amharicDraftNotice } = await import('../js/views/settings.js');

const FILES = ['js/views/reports.js', 'js/views/settings.js', 'js/app.js'];
const source = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const placeholders = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

test('rp fragment: every key is prefixed, and English and Amharic have the same keys', () => {
  for (const k of Object.keys(en)) assert.match(k, /^rp\.[a-z0-9_]+$/, k);
  assert.deepEqual(Object.keys(am).sort(), Object.keys(en).sort());
  for (const [k, v] of Object.entries(am)) assert.ok(typeof v === 'string' && v.trim(), `empty Amharic draft for ${k}`);
});

test('rp fragment: each Amharic draft keeps exactly the placeholders of its English string', () => {
  for (const k of Object.keys(en)) assert.deepEqual(placeholders(am[k]), placeholders(en[k]), k);
});

test('every key the Reports, Settings and app-shell code names exists, and no rp key is unused', () => {
  const known = new Set(EN_KEYS);
  const used = new Set();
  for (const f of FILES) {
    const src = source(f);
    for (const m of src.matchAll(/\bt\(\s*'([^']+)'/g)) assert.ok(known.has(m[1]), `${f}: t('${m[1]}') has no English string`);
    for (const m of src.matchAll(/'(rp\.[a-z0-9_]+)'/g)) {
      assert.ok(m[1] in en, `${f}: '${m[1]}' is not in i18n/reports.js`);
      used.add(m[1]);
    }
  }
  assert.deepEqual(Object.keys(en).filter(k => !used.has(k)), [], 'keys nobody uses');
});

test('the screen month names are the ones the exports use', () => {
  MONTH_NAMES.forEach((name, i) => assert.equal(en['rp.month_' + (i + 1)], name));
});

test('Amharic draft notice: English UI shows one line, Amharic UI adds the English original', () => {
  try {
    setLang('en');
    assert.deepEqual(amharicDraftNotice(), [en['rp.am_draft_note']]);
    setLang('am');
    assert.deepEqual(amharicDraftNotice(), [am['rp.am_draft_note'], en['rp.am_draft_note']]);
    assert.match(en['rp.am_draft_note'], /draft/i);
    assert.match(en['rp.am_draft_note'], /English/);
  } finally {
    setLang('en');
  }
});

test('About links (N5) open in a new tab without an opener and point to the verified pages', () => {
  const src = source('js/views/settings.js');
  assert.match(src, /'https:\/\/www\.who\.int\/publications\/i\/item\/9789240109346'/);
  assert.match(src, /'https:\/\/jhpiego\.org\/areas-of-expertise\/helping-mothers-survive\/'/);
  assert.match(src, /target: '_blank', rel: 'noopener noreferrer'/);
  assert.match(en['rp.res_irp_note'], /978-92-4-010934-6/);
});
