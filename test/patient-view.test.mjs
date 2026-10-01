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
import {
  sinceText, minText, metaLine, admissionExamText, closeFields, riskFactorsText,
  assessmentNotes, standingNote, medVoidLines, recordTypes, waitingAlerts, ackStatus,
} from '../js/views/patient.js';
import { durationSince } from '../js/ui.js';
import { fmtMin } from '../js/protocol.js';
import {
  applyReferral, voidMedication, voidNote, previewVoidMedication, EMERGENCY_NOTE, applyObservations, applyBirth,
} from '../js/record.js';
import { NOW, iso, mkPatient, LCG } from './helpers.mjs';

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

// ------------------------------- M6: void medication and notes from the Entries tab ----

test('the Entries tab lists the notes the midwife wrote, voided ones included; the notes the app writes stay on the Summary tab', () => {
  const p = mkPatient({
    notes: [
      { id: 'n1', time: iso(3), by: 'TE', text: 'Progress normal', plan: 'Reassess in 4 h' },
      { id: 'n2', time: iso(2.5), by: 'TE', text: 'Wrong case', plan: '', voided: { at: iso(2), by: 'AB', reason: 'wrong case' } },
      { id: 'a1', time: iso(2), by: 'TE', kind: 'ack', text: 'Alerts acknowledged: FHR 170 bpm', plan: 'senior' },
      { time: iso(1.9), by: 'TE', text: 'Alerts acknowledged: FHR 165 bpm', plan: 'monitoring' }, // v1: no kind, no id
      { id: 'e1', time: iso(1.8), by: 'TE', text: EMERGENCY_NOTE + 'Cord prolapse', plan: 'emergency management + referral assessment' },
      { time: iso(1.7), by: 'DEMO', text: 'DEMO case for training', plan: 'continue routine monitoring' }, // demo.js: no id
    ],
  });
  applyReferral(p, { time: iso(1), reasons: ['Prolonged labour'], facility: 'Hospital' }, { by: 'TE' });
  assert.deepEqual(assessmentNotes(p).map(n => n.text), ['Progress normal', 'Wrong case', 'DEMO case for training']);
  assert.deepEqual(assessmentNotes({}), []);
});

test('standingNote finds the note a Void button names: by id, else by time, text and plan, also in a case put back after a failed save', () => {
  const demo = { time: iso(1), by: 'DEMO', text: 'DEMO case for training', plan: 'continue routine monitoring' };
  const p = mkPatient({ notes: [{ id: 'n1', time: iso(2), by: 'TE', text: 'Progress normal', plan: '' }, demo] });
  assert.equal(standingNote(p, { id: 'n1' }), p.notes[0]);
  const ref = { id: null, time: demo.time, text: demo.text, plan: demo.plan };
  assert.equal(standingNote(p, ref), demo);
  const restored = structuredClone(p); // commit() puts back a copy when the save fails
  assert.equal(standingNote(restored, ref), restored.notes[1]);
  assert.equal(standingNote(p, { id: 'gone' }), null);
  assert.equal(standingNote(p, { ...ref, text: 'another text' }), null);
  // once given an id with its void, the id-less reference no longer names it
  demo.id = 'given';
  voidNote(p, 'given', { by: 'TE', reason: 'training note' });
  assert.equal(standingNote(p, ref), null);
  assert.equal(demo.voided.reason, 'training note');
});

test('the medication void dialog says when oxytocin stops or runs again, and names the time limits the clock opens', () => {
  const oxy = (id, hAgo, action) => ({ id, time: iso(hAgo), kind: 'oxytocin', action, by: 'TE', oxyDrops: 10 });
  // the void runs the time rules at its own time: pinned to the fixtures' clock
  const at = NOW.toISOString();
  const lines = (p, id) => medVoidLines(p, previewVoidMedication(p, id, LCG, { at }));
  const running = mkPatient({ oxytocinRunning: true, meds: [oxy('s', 3, 'start')] });
  assert.deepEqual(lines(running, 's'), [t('pt.void_oxy_stops')]);
  const stopped = mkPatient({ oxytocinRunning: false, meds: [oxy('s', 3, 'start'), oxy('x', 2, 'stop')] });
  assert.deepEqual(lines(stopped, 'x'), ['Oxytocin will be shown as running again: a check falls due every 60 min.']);
  stopped.protocolId = 'ethiopia2021';
  assert.deepEqual(lines(stopped, 'x'), [t('pt.void_oxy_runs', { n: 30 })], 'the partograph records oxytocin every 30 min');
  const plain = mkPatient({ meds: [{ id: 'm', time: iso(2), kind: 'medicine', detail: 'Ampicillin 2 g IV', by: 'TE' }] });
  assert.deepEqual(lines(plain, 'm'), [t('pt.void_no_change')]);
  assert.deepEqual(medVoidLines(plain, { oxytocin: { before: false, after: false }, added: ['Active first stage > 12 h'], resolved: ['Second stage 1 h'] }),
    ['Alert will close: Second stage 1 h', 'Time limit reached, shown now: Active first stage > 12 h']);
  inLang('am', () => {
    for (const l of [...lines(running, 's'), ...lines(stopped, 'x'), ...lines(plain, 'm')]) assert.match(l, ETHIOPIC);
  });
  // "Record now" offers the oxytocin check only while it runs
  assert.ok(recordTypes(running, 'labour').includes('oxytocin'));
  voidMedication(running, 's', LCG, { by: 'TE', reason: 'never started', at });
  assert.ok(!recordTypes(running, 'labour').includes('oxytocin'));
});

test('an alert closed as it was recorded after labour had ended asks for nothing: not in the strip, its status says so', () => {
  // the birth an hour ago; at 3 h ago an FHR of 170 and late decelerations are entered late: both close at the birth
  const p = mkPatient({ createdAt: iso(8), admission: { time: iso(8) }, activeStartTime: iso(7) });
  applyBirth(p, { time: iso(1), outcome: 'live', placentaComplete: 'Y' }, {}, LCG, { by: 'TE' });
  applyObservations(p, iso(3), { baby: { fhr: 170, decel: 'late' } }, LCG, { by: 'TE' });
  // one shown open in labour, closed at the birth before anyone acknowledged it: it still waits
  p.alerts.push({ id: 'shown', code: 'supine', severity: 'warn', title: 'Lying supine', time: iso(2), ack: false,
    resolved: true, resolvedAt: iso(1), resolvedHow: 'birth' });
  const late = p.alerts.filter(a => a.needsAck === false);
  assert.deepEqual(late.map(a => a.code), ['fhr_abn', 'decel']);
  const w = waitingAlerts(p);
  assert.deepEqual([w.open, w.closed.map(a => a.id)], [[], ['shown']], 'only the one shown open is acknowledged');
  assert.equal(ackStatus(late[0]), 'No acknowledgement needed: it closed as it was recorded, after labour had ended');
  assert.equal(ackStatus(p.alerts.find(a => a.id === 'shown')), t('pt.alert_not_acked'));
  inLang('am', () => assert.match(ackStatus(late[0]), ETHIOPIC));
});

test('the voided line names who voided an entry, when and why, in both languages', () => {
  assert.equal(t('pt.voided_by', { time: '10:42 AM', by: 'TE', reason: 'wrong woman' }), 'Voided 10:42 AM by TE: wrong woman');
  inLang('am', () => {
    const line = t('pt.voided_by', { time: '10:42 AM', by: 'TE', reason: 'wrong woman' });
    for (const part of ['10:42 AM', 'TE', 'wrong woman']) assert.ok(line.includes(part), part);
    assert.match(line, ETHIOPIC);
  });
});
