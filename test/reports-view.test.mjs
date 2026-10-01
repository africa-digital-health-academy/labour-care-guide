// Reports, Settings and app-shell strings (M5, agent E): the 'rp.' fragment is
// complete in both languages, every key the three files use exists, the
// screen's month names match the exports', and the Amharic-draft notice
// always carries the English original when the UI is in Amharic. M6: the
// Reports labels in each calendar mode, the default mode, the file names.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { en, am } from '../js/i18n/reports.js';
import { EN_KEYS, setLang } from '../js/i18n.js';
import { MONTH_NAMES, DEFAULT_REPORT_CALENDAR, reportCalendar } from '../js/indicators.js';
import { EC_MONTHS, EC_MONTHS_AM, EC_ERA } from '../js/ethiopic.js';
import { DEFAULT_SETTINGS } from '../js/store.js';
import { periodLabel, periodText, exportFileName } from '../js/views/reports.js';

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

// ------------------------------------------------ M6: the report calendar ----

const JUNE = { cal: 'gc', year: 2026, month: 6 };
const SENE = { cal: 'ec', year: 2018, month: 10 }; // 8 June - 7 July 2026

test('M6: the report calendar is Both on a device that never chose (store.js default)', () => {
  assert.equal(DEFAULT_SETTINGS.reportCalendar, 'both');
  assert.equal(DEFAULT_SETTINGS.reportCalendar, DEFAULT_REPORT_CALENDAR, 'store.js and indicators.js agree');
  // initStore() lays the saved settings over the defaults: settings saved before M6 have no reportCalendar
  const savedBeforeM6 = { facilityName: 'HC', lang: 'am', ethiopianDates: false };
  assert.equal(reportCalendar(Object.assign({ ...DEFAULT_SETTINGS }, savedBeforeM6)), 'both');
  assert.equal(reportCalendar(Object.assign({ ...DEFAULT_SETTINGS }, { reportCalendar: 'gregorian' })), 'gregorian', 'a saved choice wins');
});

test('M6: labels per mode in English: Gregorian only, Ethiopian only, or the Ethiopian month over its Gregorian days', () => {
  setLang('en');
  assert.deepEqual(periodLabel(JUNE, 'gregorian'), { main: 'June 2026', sub: null });
  assert.deepEqual(periodLabel(SENE, 'ethiopian'), { main: 'Sene 2018 EC', sub: null });
  assert.deepEqual(periodLabel(SENE, 'both'), { main: 'Sene 2018 EC', sub: 'June 8 - July 7, 2026' });
  assert.equal(periodText(SENE, 'both'), 'Sene 2018 EC (June 8 - July 7, 2026)', 'one line for sentences and the export note');
  assert.equal(periodText(SENE, 'ethiopian'), 'Sene 2018 EC');
  assert.equal(periodText(JUNE, 'gregorian'), 'June 2026');
  assert.equal(periodLabel({ cal: 'ec', year: 2019, month: 1 }, 'both').main, 'Meskerem 2019 EC');
  assert.equal(periodLabel({ cal: 'ec', year: 2018, month: 13 }, 'both').sub, 'September 6 - 10, 2026', 'Pagume, inside one month');
  assert.equal(periodLabel({ cal: 'ec', year: 2019, month: 4 }, 'both').sub, 'December 10, 2026 - January 8, 2027', 'across 1 January');

  // over a whole year, each mode shows only the calendars it promises
  const has = (text, names) => names.some(n => text.includes(n));
  for (let month = 1; month <= 13; month++) {
    const ec = { cal: 'ec', year: 2018, month };
    assert.ok(!has(periodText(ec, 'ethiopian'), MONTH_NAMES), `Ethiopian only, month ${month}: no Gregorian month`);
    assert.ok(!/20(25|26)/.test(periodText(ec, 'ethiopian')), `Ethiopian only, month ${month}: no Gregorian year`);
    assert.ok(has(periodText(ec, 'both'), MONTH_NAMES), `Both, month ${month}: the Gregorian days too`);
  }
  for (let month = 1; month <= 12; month++) {
    const text = periodText({ cal: 'gc', year: 2026, month }, 'gregorian');
    assert.ok(!has(text, EC_MONTHS) && !/\bEC\b/.test(text), `Gregorian, ${text}: no Ethiopian date`);
  }
});

test('M6: labels per mode in Amharic: Amharic month names and era, never EC', () => {
  try {
    setLang('am');
    const sene = `${EC_MONTHS_AM[9]} 2018 ${EC_ERA.am}`;
    assert.deepEqual(periodLabel(SENE, 'ethiopian'), { main: sene, sub: null });
    assert.deepEqual(periodLabel(SENE, 'both'), { main: sene, sub: `${am['rp.month_6']} 8 - ${am['rp.month_7']} 7, 2026` });
    assert.deepEqual(periodLabel(JUNE, 'gregorian'), { main: `${am['rp.month_6']} 2026`, sub: null });
    for (const mode of ['ethiopian', 'both']) {
      const text = periodText(SENE, mode);
      assert.ok(!/\bEC\b/.test(text) && !text.includes('Sene') && !text.includes('June'), `${mode}: ${text}`);
    }
  } finally {
    setLang('en');
  }
});

test('M6: export file names: the month for the period files, the East Africa Time date for the backup', () => {
  assert.equal(exportFileName('indicators', { period: { cal: 'ec', year: 2019, month: 1 } }), 'lcg-indicators-2019-01-EC.csv');
  assert.equal(exportFileName('register', { period: SENE }), 'lcg-register-2018-10-EC.csv');
  assert.equal(exportFileName('indicators', { period: JUNE }), 'lcg-indicators-2026-06.csv');
  // 01:30 in Addis Ababa on 1 July is still 30 June in UTC: the backup is named after the ward's day
  assert.equal(exportFileName('backup', { now: new Date('2026-06-30T22:30:00Z') }), 'lcg-backup-2026-07-01.json');
  assert.equal(exportFileName('backup', { now: new Date('2026-06-30T20:59:00Z') }), 'lcg-backup-2026-06-30.json', '23:59 EAT');
});
