// i18n-core.test.mjs - the t() placeholder fill, the shared ui.js helpers in
// both languages, the Ethiopian-date era and the single MgSO4 dose source (M5).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { t, setLang, EN_KEYS } from '../js/i18n.js';
import { timeAgo, durationSince } from '../js/ui.js';
import { formatEthiopic } from '../js/ethiopic.js';
import { MGSO4_LOADING, EMERGENCIES, evaluateObs } from '../js/alerts.js';
import { readFileSync } from 'node:fs';
import { mkPatient, iso, LCG } from './helpers.mjs';

const inLang = (l, fn) => { setLang(l); try { return fn(); } finally { setLang('en'); } };
const MIN = 60000;
const NOW = new Date('2026-10-01T09:00:00Z');
const ago = min => new Date(NOW.getTime() - min * MIN).toISOString();

test('t(): replacement patterns inside a value are kept as typed', () => {
  assert.equal(t('ui_recording_as', { by: "$&$'$$" }), "Recording as $&$'$$");
  assert.equal(t('ui_recording_as', { by: '$1' }), 'Recording as $1');
});

test('t(): every copy of a placeholder is filled, in one pass', () => {
  // a missing key falls back to the key itself, which lets the test use any text
  assert.equal(t('{a} and {a}', { a: 7 }), '7 and 7');
  assert.equal(t('{a}{b}', { a: '{b}', b: 'B' }), '{b}B', 'a value is never re-expanded');
});

test('t(): an unknown placeholder stays visible; no vars returns the text as is', () => {
  assert.equal(t('x {b}', { a: 1 }), 'x {b}');
  assert.equal(t('ui_recording_as'), 'Recording as {by}');
});

test('every placeholder in every string is a plain {name} in both languages', () => {
  for (const l of ['en', 'am']) {
    inLang(l, () => {
      for (const k of EN_KEYS) {
        const rest = t(k).replace(/\{\w+\}/g, '');
        assert.ok(!/[{}]/.test(rest), `${l} ${k}: stray brace in "${t(k)}"`);
      }
    });
  }
});

test('ui.js time helpers: English text unchanged', () => {
  assert.equal(timeAgo(ago(0), NOW), 'now');
  assert.equal(timeAgo(ago(30), NOW), '30 min ago');
  assert.equal(timeAgo(ago(125), NOW), '2 h 5 min ago');
  assert.equal(durationSince(ago(45), NOW), '45 min');
  assert.equal(durationSince(ago(125), NOW), '2 h 5 min');
  assert.equal(durationSince(ago(-5), NOW), '0 min', 'a future time never shows a negative duration');
});

test('ui.js time helpers follow the screen language', () => {
  inLang('am', () => {
    const d = durationSince(ago(125), NOW);
    assert.ok(d.includes('ደቂቃ'), d); // "minute" in Amharic
    assert.ok(d.includes('2') && d.includes('5'), d);
    assert.ok(!/min/.test(d), d);
  });
});

test('Ethiopian dates: EC in English, the Amharic era abbreviation in Amharic', () => {
  const d = new Date(2026, 9, 1);
  assert.ok(formatEthiopic(d, 'en').endsWith(' EC'), formatEthiopic(d, 'en'));
  const am = formatEthiopic(d, 'am');
  assert.ok(am.endsWith(' ዓ.ም.'), am);
  assert.ok(!am.includes('EC'), am);
});

test('the MgSO4 loading dose has one source, used by the eclampsia card and the severe BP alert', () => {
  assert.equal(MGSO4_LOADING, '4 g IV (20%) slowly over 5–20 min + 10 g IM (50%: 5 g each buttock with 1 ml lidocaine 2%)');
  const ecl = EMERGENCIES.find(e => e.code === 'eclampsia');
  assert.ok(ecl.advice.some(a => a.includes(MGSO4_LOADING)));
  const alerts = evaluateObs(mkPatient(), { type: 'vitals', time: iso(0), v: { sys: 170, dia: 115 } }, LCG);
  const htn = alerts.find(a => (a.advice || []).some(x => x.includes('MgSO')));
  assert.ok(htn, 'a severe BP raises an alert that carries the MgSO4 dose');
  assert.ok(htn.advice.some(x => x.includes(MGSO4_LOADING)));
  // no other copy of the dose anywhere in the engine
  const src = readFileSync(new URL('../js/alerts.js', import.meta.url), 'utf8');
  assert.equal(src.split('10 g IM').length - 1, 1, 'the IM dose is written once');
});
