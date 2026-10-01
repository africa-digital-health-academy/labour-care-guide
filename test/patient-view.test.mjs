// The case view and the ward board in two languages (M5). Their strings live
// in js/i18n/patient.js ('pt.' keys): every key there is used by the two
// screens and every key they use is there; each Amharic draft is written in
// Ethiopic script unless it is an abbreviation kept in Latin on purpose. The
// pure helpers read exactly as before in English - durations like
// durationSince and fmtMin - and switch language when t() does, because the
// text is built when it is shown, never at import.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { setLang, t } from '../js/i18n.js';
import { en, am } from '../js/i18n/patient.js';
import { sinceText, minText, metaLine, admissionExamText, closeFields, riskFactorsText } from '../js/views/patient.js';
import { durationSince } from '../js/ui.js';
import { fmtMin } from '../js/protocol.js';
import { iso, mkPatient } from './helpers.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const VIEWS = ['js/views/patient.js', 'js/views/dashboard.js'];
const ETHIOPIC = /[ሀ-፿]/;
// drafts that are Latin abbreviations only, as Ethiopian clinicians write them
const LATIN_KEPT = ['pt.s_fhr', 'pt.s_fhr_short', 'pt.s_bpm', 'pt.s_bp', 'pt.support_after'];

/** Run fn with the screen language set to lang, then back to English. */
function inLang(lang, fn) {
  setLang(lang);
  try {
    return fn();
  } finally {
    setLang('en');
  }
}

test('the two screens use exactly the pt. keys of their fragment: none missing, none unused', () => {
  const used = new Set(VIEWS.flatMap(f => [...readFileSync(join(ROOT, f), 'utf8').matchAll(/'(pt\.[\w.]+)'/g)].map(m => m[1])));
  const defined = Object.keys(en);
  assert.deepEqual([...used].filter(k => !defined.includes(k)), [], 'used but not defined');
  assert.deepEqual(defined.filter(k => !used.has(k)), [], 'defined but never used');
  assert.deepEqual(Object.keys(am).sort(), [...defined].sort(), 'an Amharic draft for every key');
});

test('every Amharic draft is in Ethiopic script, except the Latin abbreviations kept on purpose', () => {
  const latin = Object.keys(am).filter(k => !ETHIOPIC.test(am[k]));
  assert.deepEqual(latin.sort(), [...LATIN_KEPT].sort());
  for (const k of LATIN_KEPT) assert.equal(am[k], en[k], k);
});

test('durations read exactly like durationSince and fmtMin in English, with Amharic units in Amharic', () => {
  const now = new Date('2026-06-12T09:00:00Z');
  for (const min of [0, 1, 59, 60, 61, 119, 120, 125, 600, 1439]) {
    const at = new Date(+now - min * 60000).toISOString();
    assert.equal(sinceText(at, now), durationSince(at, now), `${min} min ago`);
  }
  assert.equal(sinceText(new Date(+now + 600000).toISOString(), now), '0 min', 'a future time counts as 0');
  for (const min of [0, 0.4, 0.6, 45, 59.4, 59.6, 60, 61, 119.6, 120, 125.2, 600]) assert.equal(minText(min), fmtMin(min), String(min));
  inLang('am', () => {
    assert.equal(sinceText(new Date(+now - 125 * 60000).toISOString(), now), '2 ሰዓት 5 ደቂቃ');
    assert.equal(sinceText(new Date(+now - 45 * 60000).toISOString(), now), '45 ደቂቃ');
    assert.equal(minText(120), '2 ሰዓት');
    assert.equal(minText(135), '2 ሰዓት 15 ደቂቃ');
  });
});

test('the age, parity and gestation line: unknowns shown as ?, a zero parity kept', () => {
  assert.equal(metaLine({ age: 26, gravida: 2, para: 1, gaWeeks: 39 }), '26 y · G2P1 · GA 39 wk');
  assert.equal(metaLine({}), '? y · G?P? · GA ? wk');
  assert.equal(metaLine({ age: 19, gravida: 1, para: 0, gaWeeks: 41 }), '19 y · G1P0 · GA 41 wk');
  assert.equal(inLang('am', () => metaLine({ age: 26, gravida: 2, para: 1, gaWeeks: 39 })), '26 ዓመት · G2P1 · GA 39 ሳምንት');
});

test('the admission summary follows the language of the moment; an unknown presentation is shown as stored', () => {
  const exam = { dilatation: 6, descent: 3, fhr: 150, presentation: 'breech' };
  assert.equal(admissionExamText(exam), '6 cm · descent 3/5 · FHR 150 · breech');
  assert.equal(inLang('am', () => admissionExamText(exam)), '6 cm · የራስ መውረድ 3/5 · FHR 150 · በመቀመጫ');
  assert.equal(admissionExamText(exam), '6 cm · descent 3/5 · FHR 150 · breech', 'English again after the switch');
  assert.equal(inLang('am', () => admissionExamText({ dilatation: 4, fhr: 140, presentation: 'face' })), '4 cm · FHR 140 · face');
});

test('the summary names risk factors in words in the screen language; an unknown code is shown as stored', () => {
  assert.equal(riskFactorsText(['prior_cs', 'anaemia']), 'Previous caesarean section, Anaemia');
  assert.equal(inLang('am', () => riskFactorsText(['prior_cs', 'anaemia'])),
    inLang('am', () => `${t('fm.risk.prior_cs')}, ${t('fm.risk.anaemia')}`));
  assert.ok(inLang('am', () => ETHIOPIC.test(riskFactorsText(['anaemia']))), 'the Amharic draft, not the code');
  assert.equal(riskFactorsText(['prior_cs', 'sickle_cell']), 'Previous caesarean section, sickle_cell');
  assert.equal(riskFactorsText([]), '');
  assert.equal(riskFactorsText(undefined), '');
});

test('closing refusals are shown in the screen language', () => {
  inLang('am', () => {
    const cases = [
      [mkPatient({ status: 'closed' }), 'TE', 'pt.close_err_closed'],
      [mkPatient({ status: 'active' }), 'TE', 'pt.close_err_labour'],
      [mkPatient({ status: 'delivered', delivery: { time: iso(1) } }), ' ', 'pt.close_err_initials'],
    ];
    for (const [p, by, key] of cases) {
      assert.throws(() => closeFields(p, by, iso(0)), err => err.message === t(key) && ETHIOPIC.test(err.message), key);
    }
  });
});
