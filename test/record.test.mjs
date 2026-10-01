// Record layer (S5): entries with author and source, void and correct with a
// reason, stage re-derivation, pushing and handover events, birth record.
// M6: medication entries and notes are voided the same way; her departure
// closes her open labour findings, and no later void leaves one open.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyObservations, voidObservation, previewVoid, correctObservation, recordEvent, applyBirth, voidDelivery,
  createCase, applyReferral, admissionEntries,
  voidMedication, previewVoidMedication, oxytocinRunningFrom, voidNote, noteAction, EMERGENCY_NOTE,
} from '../js/record.js';
import { addAlerts, evaluateObs, refreshTimeAlerts } from '../js/alerts.js';
import {
  PROTOCOLS, pushingStart, secondStageClockStart, isLabouring, deriveStage, awaitingHandover, dueList,
} from '../js/protocol.js';
import { CASE_SCHEMA, migrateCase, migrateAll } from '../js/migrate.js';
import { chartSVG, sheetCount } from '../js/chart.js';
import { ackIndex, flagState, ALERT_CODES, planText } from '../js/partograph.js';
import { waitingAlerts } from '../js/views/patient.js';
import { alertsToAcknowledge } from '../js/wizard.js';
import { NOW, iso, mkPatient, LCG, ETH, codes } from './helpers.mjs';

const latent = () => mkPatient({ status: 'latent', activeStartTime: null });

test('an entry carries author, source, defaulted keys and flags; fluid seen sets ROM; the stage follows', () => {
  const p = latent();
  const r = applyObservations(p, iso(3), { exam: { dilatation: 5, liquor: 'C' } }, LCG,
    { by: 'TE', defaulted: { exam: ['moulding'] } });
  const o = r.obs[0];
  assert.equal(o.by, 'TE');
  assert.equal(o.source, 'entry');
  assert.deepEqual(o.defaulted, ['moulding']);
  assert.deepEqual(o.flags, []);
  assert.equal(p.romTime, iso(3));
  assert.deepEqual(r.transitions, ['active']);
  assert.equal(p.status, 'active');
  assert.equal(p.activeStartTime, iso(3));
});

test('an entry needs a valid time', () => {
  assert.throws(() => applyObservations(latent(), 'not a time', { baby: { fhr: 140 } }, LCG), /valid observation time/);
});

test('ROM recorded with an unknown time (form code U) is not overwritten by a later fluid finding', () => {
  const p = mkPatient({ romUnknown: true, romTime: null });
  applyObservations(p, iso(1), { baby: { fhr: 140, liquor: 'C' } }, LCG);
  assert.equal(p.romTime, null);
});

test('a contraction-duration band becomes seconds', () => {
  const p = mkPatient();
  const r = applyObservations(p, iso(0), { contractions: { count: 3, durBand: 'gt60' } }, LCG);
  assert.equal(r.obs[0].v.duration, 70);
});

test('S5: voiding a mistyped 10 cm entry reverts the second stage; a reason is required; nothing is deleted', () => {
  const p = latent();
  applyObservations(p, iso(4), { exam: { dilatation: 6 } }, LCG);
  const ten = applyObservations(p, iso(1), { exam: { dilatation: 10 } }, LCG).obs[0];
  assert.equal(p.status, 'second');
  assert.throws(() => voidObservation(p, ten.id, LCG, { by: 'TE' }), /reason is required/);
  const preview = previewVoid(p, ten.id, LCG);
  assert.deepEqual(preview.transitions, ['second_reverted']);
  assert.equal(p.status, 'second', 'the preview changes nothing');
  const r = voidObservation(p, ten.id, LCG, { by: 'TE', reason: 'typed 10 for 7' });
  assert.deepEqual(r.transitions, ['second_reverted']);
  assert.equal(p.status, 'active');
  assert.equal(p.secondStageStart, null);
  assert.equal(p.obs.length, 2);
  assert.deepEqual({ by: ten.voided.by, reason: ten.voided.reason }, { by: 'TE', reason: 'typed 10 for 7' });
  assert.throws(() => voidObservation(p, ten.id, LCG, { reason: 'again' }), /already voided/);
});

test('void then re-derive: voiding the normal reading re-opens the finding it had cleared', () => {
  const p = mkPatient();
  const abnormal = applyObservations(p, iso(2), { baby: { fhr: 170 } }, LCG).obs[0];
  const normal = applyObservations(p, iso(1.5), { baby: { fhr: 140 } }, LCG).obs[0];
  const alert = p.alerts.find(a => a.code === 'fhr_abn');
  assert.equal(alert.resolved, true);
  const r = voidObservation(p, normal.id, LCG, { reason: 'reading from another woman' });
  assert.equal(alert.resolved, false);
  assert.deepEqual(r.reopened.map(a => a.code), ['fhr_abn']);
  // voiding the abnormal entry itself resolves the alert it alone raised
  voidObservation(p, abnormal.id, LCG, { reason: 'mistyped' });
  assert.equal(alert.resolved, true);
  assert.equal(alert.resolvedHow, 'void');
});

test('correcting an entry voids it and records the new values at the same time, naming the one replaced', () => {
  const p = latent();
  applyObservations(p, iso(4), { exam: { dilatation: 6 } }, LCG);
  const bad = applyObservations(p, iso(1), { exam: { dilatation: 10 } }, LCG).obs[0];
  const c = correctObservation(p, bad.id, { dilatation: 7 }, LCG, { by: 'TE', reason: 'typo' });
  const fixed = c.obs[0];
  assert.equal(fixed.replaces, bad.id);
  assert.equal(fixed.time, bad.time);
  assert.equal(fixed.v.dilatation, 7);
  assert.equal(p.status, 'active');
  assert.equal(bad.voided.reason, 'typo');
});

test('F2: the pushing event starts the LCG second-stage clock', () => {
  const p = mkPatient({ status: 'second', secondStageStart: iso(2) });
  const r = recordEvent(p, 'pushing', iso(1), LCG, { by: 'TE' });
  assert.equal(r.event.type, 'event');
  assert.equal(pushingStart(p), iso(1));
  assert.equal(secondStageClockStart(p, PROTOCOLS.lcg), iso(1));
  assert.equal(secondStageClockStart(p, PROTOCOLS.ethiopia2021), iso(2));
});

test('S8: handover needs a referral, ends monitoring and closes the time alerts', () => {
  assert.throws(() => recordEvent(mkPatient(), 'handover', iso(0), LCG), /No referral/);
  const p = mkPatient({ status: 'referred', referral: { time: iso(1) } });
  assert.equal(isLabouring(p), true);
  addAlerts(p, [{ code: 'prom_long', severity: 'warn', title: 'ROM', advice: [] }], 'time');
  const r = recordEvent(p, 'handover', iso(0.5), LCG, { by: 'TE' });
  assert.equal(isLabouring(p), false);
  assert.deepEqual(r.resolved.map(a => a.resolvedHow), ['handover']);
  assert.throws(() => recordEvent(p, 'handover', iso(0), LCG), /already recorded/);
});

test('a birth needs a valid time, stops the labour clocks and runs the birth rules once', () => {
  const p = mkPatient({ status: 'second', secondStageStart: iso(3) });
  addAlerts(p, [{ code: 'second_long', severity: 'danger', title: 't', advice: [] }], 'time');
  assert.throws(() => applyBirth(p, { time: null }, null, LCG), /valid time of birth/);
  const r = applyBirth(p, { time: iso(0.5), outcome: 'live', placentaComplete: 'N' }, { apgar5: { total: 8 } }, LCG, { by: 'TE' });
  assert.equal(p.status, 'delivered');
  assert.equal(p.delivery.by, 'TE');
  assert.deepEqual(r.resolved.map(a => a.code), ['second_long']);
  assert.deepEqual(r.added.map(a => a.code), ['retained_products']);
  assert.equal(r.added[0].source, 'birth');
  assert.throws(() => applyBirth(p, { time: iso(0) }, null, LCG), /already recorded/);
});

test('voiding a birth record keeps it in history with a reason, resolves its alerts and restores the labour stage', () => {
  const p = latent();
  applyObservations(p, iso(4), { exam: { dilatation: 6 } }, LCG);
  applyObservations(p, iso(2), { exam: { dilatation: 10 } }, LCG);
  applyBirth(p, { time: iso(1), outcome: 'live', placentaComplete: 'N' }, {}, LCG);
  assert.throws(() => voidDelivery(p, LCG, {}), /reason is required/);
  const r = voidDelivery(p, LCG, { by: 'TE', reason: 'recorded on the wrong woman' });
  assert.equal(p.delivery, null);
  assert.equal(p.deliveryHistory.length, 1);
  assert.equal(p.deliveryHistory[0].voided.reason, 'recorded on the wrong woman');
  assert.equal(p.status, 'second');
  assert.deepEqual(r.resolved.map(a => a.code), ['retained_products']);
});

test('deriveStage keeps a v1 record that stored the admission dilatation but no exam entry', () => {
  const p = mkPatient({ status: 'latent', activeStartTime: null, admission: { time: iso(6), dilatation: 7 } });
  deriveStage(p, PROTOCOLS.lcg);
  assert.equal(p.activeStartTime, iso(6));
  assert.equal(p.status, 'active');
});

// ------------------------------------------ review pass 1 regressions ----

test('a new case is created in the current schema, so a reload does not migrate it again', () => {
  const p = createCase({ id: 'n1', createdAt: iso(1), protocolId: 'lcg', name: 'New' });
  assert.equal(p.schemaVersion, CASE_SCHEMA);
  assert.equal(migrateCase(p, LCG).changed, false);
  assert.equal(migrateAll([p], LCG).changed, false, 'no pre-migration snapshot on every load');
});

test('S8 regression: a woman referred on this version is still monitored after a reload', () => {
  const p = createCase({
    id: 'r1', createdAt: iso(3), protocolId: 'lcg', para: 1,
    admission: { time: iso(3) }, status: 'active', activeStartTime: iso(3),
  });
  applyReferral(p, { time: iso(1), reasons: ['Prolonged labour'], checklist: [], facility: 'Hospital' }, { by: 'TE' });
  assert.equal(p.referral.handoverAt, null);
  assert.equal(p.notes[p.notes.length - 1].by, 'TE');
  const reloaded = migrateCase(JSON.parse(JSON.stringify(p)), LCG).p;
  assert.equal(awaitingHandover(reloaded), true);
  assert.equal(isLabouring(reloaded), true);
  // even a copy saved without a schema stamp keeps the explicit "not yet left"
  const unstamped = JSON.parse(JSON.stringify(p));
  delete unstamped.schemaVersion;
  assert.equal(awaitingHandover(migrateCase(unstamped, LCG).p), true);
  assert.throws(() => applyReferral(p, { time: iso(0), reasons: [] }), /already recorded/);
});

test('ROM follows the entries: voiding the only fluid finding clears it; a later finding sets it again', () => {
  const p = latent();
  const clear = applyObservations(p, iso(3), { baby: { fhr: 140, liquor: 'C' } }, LCG).obs[0];
  assert.equal(p.romTime, iso(3));
  voidObservation(p, clear.id, LCG, { reason: 'membranes intact - mis-tap' });
  assert.equal(p.romTime, null);
  applyObservations(p, iso(1), { exam: { dilatation: 6, liquor: 'C' } }, LCG);
  assert.equal(p.romTime, iso(1));
});

test('ROM moves to the next surviving fluid finding when the earliest is voided', () => {
  const p = latent();
  const early = applyObservations(p, iso(3), { baby: { fhr: 140, liquor: 'C' } }, LCG).obs[0];
  applyObservations(p, iso(2), { exam: { dilatation: 6, liquor: 'C' } }, LCG);
  assert.equal(p.romTime, iso(3));
  voidObservation(p, early.id, LCG, { reason: 'wrong woman' });
  assert.equal(p.romTime, iso(2));
});

test('ROM reported at admission is never re-derived from entries', () => {
  const p = mkPatient({ romTime: iso(10) });
  const clear = applyObservations(p, iso(3), { baby: { fhr: 140, liquor: 'C' } }, LCG).obs[0];
  voidObservation(p, clear.id, LCG, { reason: 'wrong woman' });
  assert.equal(p.romTime, iso(10));
});

test('at birth the labour findings close and the maternal ones stay; voiding the birth re-opens them', () => {
  const p = mkPatient({ status: 'second', secondStageStart: iso(3) });
  applyObservations(p, iso(2.5), { baby: { fhr: 170 }, vitals: { sys: 150, dia: 95 } }, LCG);
  const r = applyBirth(p, { time: iso(1), outcome: 'live', placentaComplete: 'Y' }, {}, LCG);
  const fhr = p.alerts.find(a => a.code === 'fhr_abn');
  assert.equal(fhr.resolvedHow, 'birth');
  assert.ok(r.resolved.includes(fhr));
  assert.equal(p.alerts.find(a => a.code === 'htn').resolved, false, 'raised BP stays open after birth');
  const v = voidDelivery(p, LCG, { reason: 'recorded on the wrong woman' });
  assert.equal(fhr.resolved, false);
  assert.ok(v.reopened.includes(fhr));
});

// ------------------------------------------------------------- M3 (S4) ----

test('S4: admission records only what was examined or asked', () => {
  const e = admissionEntries({ fhr: 140, dilatation: 6, presentation: 'cephalic', membranes: 'ruptured', temp: 37.9 });
  assert.deepEqual(e.baby, { fhr: 140 }, 'no invented decelerations or fluid on the FHR entry');
  assert.deepEqual(e.vitals, { temp: 37.9 }, 'a temperature without a BP is kept');
  assert.deepEqual(e.exam, { dilatation: 6, presentation: 'cephalic' }, 'ruptured with no colour chosen records no fluid');
  assert.equal(e.supportive, undefined, 'no companion answer, no supportive entry');
  assert.equal(e.contractions, undefined);
  assert.equal(e.pulse, undefined);
});

test('S4: intact membranes, a chosen fluid colour and a companion answer are recorded as given', () => {
  assert.equal(admissionEntries({ fhr: 140, dilatation: 4, membranes: 'intact' }).exam.liquor, 'I');
  assert.equal(admissionEntries({ fhr: 140, dilatation: 4, membranes: 'ruptured', liquor: 'M2' }).exam.liquor, 'M2');
  const e = admissionEntries({ fhr: 140, dilatation: 4, membranes: 'intact', companion: 'D', sys: 120, dia: 80, pulse: 88 });
  assert.deepEqual(e.supportive, { companion: 'D' }, 'companion only - pain relief, fluid and posture are not assumed');
  assert.deepEqual(e.vitals, { sys: 120, dia: 80 });
  assert.deepEqual(e.pulse, { pulse: 88 });
});

test('correcting a mistyped 10 cm exam reports the net stage change of the whole correction', () => {
  const p = latent();
  applyObservations(p, iso(4), { exam: { dilatation: 6 } }, LCG);
  const ten = applyObservations(p, iso(1), { exam: { dilatation: 10 } }, LCG).obs[0];
  const r = correctObservation(p, ten.id, { dilatation: 9 }, LCG, { by: 'TE', reason: 'typed 10 for 9' });
  assert.deepEqual(r.transitions, ['second_reverted']);
  assert.equal(p.status, 'active');
  const q = latent();
  const eight = applyObservations(q, iso(1), { exam: { dilatation: 8 } }, LCG).obs[0];
  assert.deepEqual(correctObservation(q, eight.id, { dilatation: 10 }, LCG, { reason: 'typo' }).transitions, ['second']);
});

// ------------------------------------------ M3 review pass 1 regressions ----

test('correcting 10 cm to 10 cm with another field changed reports no stage change', () => {
  const p = latent();
  applyObservations(p, iso(4), { exam: { dilatation: 6 } }, LCG);
  const ten = applyObservations(p, iso(1), { exam: { dilatation: 10, descent: 1 } }, LCG).obs[0];
  const r = correctObservation(p, ten.id, { dilatation: 10, descent: 0 }, LCG, { by: 'TE', reason: 'descent mistyped' });
  assert.deepEqual(r.transitions, []);
  assert.equal(p.secondStageStart, iso(1));
  assert.equal(p.status, 'second');
});

test('a correction that moves the entry in time reports the stage start it moves', () => {
  const p = latent();
  applyObservations(p, iso(4), { exam: { dilatation: 6 } }, LCG);
  const ten = applyObservations(p, iso(1), { exam: { dilatation: 10 } }, LCG).obs[0];
  const r = correctObservation(p, ten.id, { dilatation: 10 }, LCG, { reason: 'wrong time', time: iso(2) });
  assert.deepEqual(r.transitions, ['second_moved']);
  assert.equal(p.secondStageStart, iso(2));
  const q = latent();
  const five = applyObservations(q, iso(4), { exam: { dilatation: 5 } }, LCG).obs[0];
  const s = correctObservation(q, five.id, { dilatation: 5 }, LCG, { reason: 'wrong time', time: iso(3) });
  assert.deepEqual(s.transitions, ['active_moved']);
  assert.equal(q.activeStartTime, iso(3));
});

test('a corrected entry keeps its source and names the entry it replaces, also when corrected again', () => {
  const p = latent();
  const adm = applyObservations(p, iso(6), { baby: { fhr: 104 } }, LCG, { by: 'AB', source: 'admission' }).obs[0];
  const first = correctObservation(p, adm.id, { fhr: 140 }, LCG, { by: 'TE', reason: 'typo' }).obs[0];
  assert.deepEqual([first.source, first.replaces, first.time, first.by], ['admission', adm.id, adm.time, 'TE']);
  const second = correctObservation(p, first.id, { fhr: 142 }, LCG, { by: 'TE', reason: 'typo again' }).obs[0];
  assert.deepEqual([second.source, second.replaces], ['admission', first.id]);
  const routine = applyObservations(p, iso(2), { baby: { fhr: 150 } }, LCG).obs[0];
  assert.equal(correctObservation(p, routine.id, { fhr: 151 }, LCG, { reason: 'typo' }).obs[0].source, 'entry');
});

test('correcting an admission entry mirrors the corrected values into p.admission', () => {
  const p = createCase({
    id: 'a1', createdAt: iso(6), protocolId: 'lcg', para: 0, status: 'latent', companionWanted: false,
    admission: {
      time: iso(6), dilatation: 4, descent: 3, fhr: 104, pulse: 88, sys: 120, dia: 80, temp: null,
      presentation: 'breech', companion: 'D', by: 'AB',
    },
  });
  const baseline = admissionEntries({
    fhr: 104, pulse: 88, sys: 120, dia: 80, dilatation: 4, descent: 3, presentation: 'breech',
    membranes: 'intact', companion: 'D',
  });
  applyObservations(p, iso(6), baseline, LCG, { by: 'AB', source: 'admission' });
  const entry = type => p.obs.find(o => o.type === type && !o.voided);
  const fix = (type, v) => correctObservation(p, entry(type).id, v, LCG, { by: 'TE', reason: 'typo' });
  fix('baby', { fhr: 140 });
  fix('exam', { dilatation: 5, presentation: 'cephalic', liquor: 'I' });
  fix('pulse', { pulse: 92 });
  fix('vitals', { sys: 124, dia: 82, temp: 37.1 });
  fix('supportive', { companion: 'Y' });
  assert.deepEqual(p.admission, {
    time: iso(6), dilatation: 5, descent: null, fhr: 140, pulse: 92, sys: 124, dia: 82, temp: 37.1,
    presentation: 'cephalic', companion: 'Y', by: 'AB',
  }, 'a descent the correction no longer records is cleared');
  assert.equal(p.companionWanted, true);
  fix('supportive', { painRelief: 'Y' });
  assert.equal(p.admission.companion, null);
  assert.equal(p.companionWanted, undefined, 'no companion answer left: her wish is not recorded');
  // a routine entry is not an admission value
  const later = applyObservations(p, iso(2), { baby: { fhr: 150 } }, LCG).obs[0];
  correctObservation(p, later.id, { fhr: 170 }, LCG, { reason: 'typo' });
  assert.equal(p.admission.fhr, 140);
});

test('S4: a contraction count of 0 is kept; an unexamined descent or presentation is left out', () => {
  assert.deepEqual(admissionEntries({ fhr: 140, dilatation: 4, contractions: 0 }).contractions, { count: 0 });
  const e = admissionEntries({ fhr: 140, dilatation: 4, descent: null, membranes: 'intact' });
  assert.deepEqual(e.exam, { dilatation: 4, liquor: 'I' }, 'no descent, no presentation');
  assert.equal(admissionEntries({ fhr: 140, dilatation: 4, descent: 0 }).exam.descent, 0, 'descent 0/5 is a finding');
});

test('voiding an admission entry clears what it said on the admission record; other voids leave it alone', () => {
  const p = latent();
  p.admission = { time: iso(4), dilatation: 6, presentation: 'breech', fhr: 140 };
  const exam = applyObservations(p, iso(4), { exam: { dilatation: 6, presentation: 'breech' } }, LCG, { source: 'admission' }).obs[0];
  const later = applyObservations(p, iso(2), { baby: { fhr: 150 } }, LCG).obs[0];
  voidObservation(p, later.id, LCG, { reason: 'duplicate' });
  assert.equal(p.admission.fhr, 140, 'a routine entry is not the admission');
  voidObservation(p, exam.id, LCG, { reason: 'examined the wrong woman' });
  assert.equal(p.admission.dilatation, null);
  assert.equal(p.admission.presentation, null);
  assert.equal(p.admission.fhr, 140, 'only the voided entry type is cleared');
});

// ------------------------------------- M5: flags after a stage move ----
// Weak and short contractions are alert values only in active labour, and the
// progress rules apply in the active first stage only. When a back-timed exam,
// a void or a correction moves a stage start, the entries it moves across one
// of those gates are judged again at their own time (record.js restage).

test('M5: a back-timed exam that starts active labour earlier judges the contractions after it again', () => {
  const p = latent();
  const c = applyObservations(p, iso(3), { contractions: { count: 2, duration: 70 } }, LCG, { by: 'TE' }).obs[0];
  assert.deepEqual(c.flags, ['contraction_long'], 'latent: two contractions in 10 minutes are not an alert value');
  const r = applyObservations(p, iso(4), { exam: { dilatation: 5 } }, LCG, { by: 'AB' });
  assert.deepEqual(r.transitions, ['active']);
  assert.deepEqual(c.flags, ['contraction_long', 'weak_contractions'], 'active labour at its time: now an alert value');
  const weak = p.alerts.find(a => a.code === 'weak_contractions');
  assert.deepEqual([weak.resolved, weak.ack, weak.time, weak.obsIds], [false, false, c.time, [c.id]]);
  assert.ok(r.added.includes(weak), 'asked for acknowledgement with the exam that moved the stage');
});

test('M5: voiding the exam that began active labour takes back the weak and short contraction alerts; other findings stay', () => {
  const p = latent();
  const exam = applyObservations(p, iso(4), { exam: { dilatation: 5 } }, LCG, { by: 'TE' }).obs[0];
  const round = applyObservations(p, iso(3), { contractions: { count: 2, duration: 15 }, baby: { fhr: 170 } }, LCG, { by: 'TE' });
  const c = round.obs.find(o => o.type === 'contractions');
  assert.deepEqual(c.flags, ['weak_contractions', 'contraction_short']);
  // the void runs the time rules at its own time: pinned to the fixtures' clock
  const at = NOW.toISOString();
  const pv = previewVoid(p, exam.id, LCG, { at });
  assert.equal(pv.resolved.length, 2);
  assert.ok(pv.resolved.some(t => /Weak contractions/.test(t)) && pv.resolved.some(t => /shorter than/.test(t)), 'the confirm dialog says so');
  const r = voidObservation(p, exam.id, LCG, { by: 'AB', reason: 'examined the wrong woman', at });
  assert.deepEqual(r.transitions, ['active_reverted']);
  assert.deepEqual(c.flags, [], 'latent at its time: not alert values');
  for (const code of ['weak_contractions', 'contraction_short']) {
    const a = p.alerts.find(x => x.code === code);
    assert.deepEqual([a.resolved, a.resolvedHow, a.resolvedBy, a.obsIds], [true, 'restaged', 'AB', []], code);
    assert.ok(r.resolved.includes(a));
  }
  assert.equal(p.alerts.find(a => a.code === 'fhr_abn').resolved, false, 'a finding that does not depend on the stage stays');
  assert.deepEqual(r.added, []);
});

test('M5: voiding a mistyped 10 cm exam judges the exam after it as an active-stage exam at its own time', () => {
  const p = latent();
  applyObservations(p, iso(10), { exam: { dilatation: 7 } }, LCG);
  const ten = applyObservations(p, iso(6), { exam: { dilatation: 10 } }, LCG).obs[0];
  const seven = applyObservations(p, iso(5), { exam: { dilatation: 7 } }, LCG).obs[0];
  assert.deepEqual(seven.flags, [], 'in the second stage the progress limits do not apply');
  // review fix: the void also runs the time rules (7 cm since 10 h ago) and the preview lists them
  const at = NOW.toISOString();
  const pv = previewVoid(p, ten.id, LCG, { at });
  assert.equal(pv.added.length, 2);
  assert.match(pv.added[0], /No progress: 7 cm/);
  assert.match(pv.added[1], /7 cm for 10 h .* progress limit reached/);
  const r = voidObservation(p, ten.id, LCG, { by: 'TE', reason: 'typed 10 for 7', at });
  assert.deepEqual(r.transitions, ['second_reverted']);
  assert.deepEqual(seven.flags, ['lcg_progress'], '7 cm for 5 h: over the 3-hour limit');
  const a = p.alerts.find(x => x.code === 'lcg_progress');
  assert.deepEqual([a.resolved, a.ack, a.time, a.obsIds], [false, false, seven.time, [seven.id]]);
  assert.deepEqual(r.added, [a, p.alerts.find(x => x.code === 'lcg_progress_due')], 'the time rule opens in the same save');
});

test('M5: Ethiopian partograph: a second stage taken back judges the alert line for the exams after it', () => {
  const p = mkPatient({ status: 'latent', activeStartTime: null, protocolId: 'ethiopia2021' });
  applyObservations(p, iso(10), { exam: { dilatation: 4 } }, ETH);
  const ten = applyObservations(p, iso(8), { exam: { dilatation: 10 } }, ETH).obs[0];
  const six = applyObservations(p, iso(5), { exam: { dilatation: 6 } }, ETH).obs[0];
  assert.deepEqual(six.flags, []);
  voidObservation(p, ten.id, ETH, { by: 'TE', reason: 'typed 10 for 6' });
  assert.deepEqual(six.flags, ['alert_line'], '6 cm 5 h after 4 cm: right of the alert line, left of the action line');
});

test('M5: a correction that leaves the stage start where it was leaves the other alerts alone', () => {
  const p = latent();
  const exam = applyObservations(p, iso(4), { exam: { dilatation: 5, descent: 4 } }, LCG).obs[0];
  applyObservations(p, iso(3), { contractions: { count: 2 } }, LCG);
  const weak = p.alerts.find(a => a.code === 'weak_contractions');
  Object.assign(weak, { ack: true, action: 'monitoring', actionTime: iso(2.9), ackBy: 'TE' });
  const r = correctObservation(p, exam.id, { dilatation: 5, descent: 3 }, LCG,
    { by: 'TE', reason: 'descent mistyped', at: NOW.toISOString() }); // the time rules run at the fixtures' clock
  assert.deepEqual(r.transitions, []);
  assert.deepEqual([weak.resolved, weak.ack], [false, true], 'not closed by the void half and asked again by the re-entry');
  assert.equal(p.alerts.filter(a => a.code === 'weak_contractions').length, 1, 'no new episode');
  assert.deepEqual(r.added, []);
});

test('M5: an entry judged again joins an alert acknowledged after it was made, without asking again', () => {
  const p = latent();
  const first = applyObservations(p, iso(6), { exam: { dilatation: 4 } }, LCG, { enteredAt: iso(6) }).obs[0];
  const early = applyObservations(p, iso(3), { contractions: { count: 2 } }, LCG, { enteredAt: iso(3) }).obs[0];
  applyObservations(p, iso(2), { exam: { dilatation: 5 } }, LCG, { enteredAt: iso(2) });
  applyObservations(p, iso(1.5), { contractions: { count: 2 } }, LCG, { enteredAt: iso(1.5) });
  const weak = p.alerts.find(a => a.code === 'weak_contractions');
  Object.assign(weak, { ack: true, action: 'monitoring', actionTime: iso(1.4), ackBy: 'TE' });
  // the first exam was 5 cm, not 4: active labour began before the early count
  const r = correctObservation(p, first.id, { dilatation: 5 }, LCG,
    { by: 'TE', reason: 'typed 4 for 5', at: iso(1.3) }); // made just after the acknowledgement; time rules run then
  assert.deepEqual(r.transitions, ['active_moved']);
  assert.deepEqual(early.flags, ['weak_contractions']);
  assert.ok(weak.obsIds.includes(early.id));
  assert.equal(weak.ack, true, 'acknowledged after the early count was made: covered, not asked again');
  assert.deepEqual(r.added, []);
});

test('M5: after the birth, a labour finding raised by a stage move is closed at the birth', () => {
  const p = latent();
  applyObservations(p, iso(10), { exam: { dilatation: 7 } }, LCG);
  const ten = applyObservations(p, iso(6), { exam: { dilatation: 10 } }, LCG).obs[0];
  const seven = applyObservations(p, iso(5), { exam: { dilatation: 7 } }, LCG).obs[0];
  applyBirth(p, { time: iso(1), outcome: 'live', mode: 'svd', placentaComplete: 'Y' }, {}, LCG, { by: 'TE' });
  const r = voidObservation(p, ten.id, LCG, { by: 'TE', reason: 'typed 10 for 7' });
  assert.deepEqual(seven.flags, ['lcg_progress']);
  const a = p.alerts.find(x => x.code === 'lcg_progress');
  assert.deepEqual([a.resolved, a.resolvedHow, a.resolvedAt, a.obsIds], [true, 'birth', iso(1), [seven.id]]);
  assert.deepEqual(r.added, [], 'nothing left to act on after the birth');
});

// ------------------------------------------------ M5 review: one judge ----
// Every entry, new or judged again, is judged as the case stood at its own
// time (record.js judge); an exam added, voided or corrected is read by the
// exams after it; a void or a correction runs the time rules in the same save.

/**
 * The chart's promise (flagState, js/partograph.js) on every sheet of a case
 * in labour: a value is circled solid red only when an open alert links it,
 * and every open alert raised by entries has its circle on each of them -
 * red exactly when no acknowledgement covers the entry, else grey.
 * `uncircled`: alert codes the layout does not circle.
 */
function chartAgrees(p, settings, { uncircled = [] } = {}) {
  const sheets = Array.from({ length: sheetCount(p, NOW, settings) }, (_, i) => chartSVG(p, settings, NOW, { sheet: i + 1 }).svg);
  const ringed = cls => new Set(sheets.flatMap(svg =>
    [...svg.matchAll(new RegExp(`<ellipse class="flag-circle${cls}" data-id="([^"]+)"`, 'g'))].map(m => m[1])));
  const red = ringed(''), grey = ringed(' ack');
  const open = p.alerts.filter(a => !a.resolved && a.source === 'obs');
  for (const id of red) assert.ok(open.some(a => a.obsIds.includes(id)), `solid red circle on ${id} with no open alert behind it`);
  const idx = ackIndex(p);
  for (const a of open.filter(x => !uncircled.includes(x.code))) {
    const fields = Object.keys(ALERT_CODES).filter(f => ALERT_CODES[f].includes(a.code));
    for (const id of a.obsIds) {
      const state = flagState(idx, p.obs.find(o => o.id === id), fields);
      assert.ok((state === 'open' ? red : grey).has(id), `open ${a.code} alert without its ${state === 'open' ? 'red' : 'grey'} circle on ${id}`);
    }
  }
}

/** A latent case admitted `h` hours ago, with no exam yet. */
const admitted = h => mkPatient({ status: 'latent', activeStartTime: null, createdAt: iso(h), admission: { time: iso(h) } });

test('M5 review: a back-timed count is judged in the stage it was taken in; the same values in active labour alert', () => {
  // NOW is 12:00; a 5 cm exam at 10:00 began active labour; the midwife now enters the 09:30 count she forgot
  const p = admitted(6);
  applyObservations(p, iso(2), { exam: { dilatation: 5 } }, LCG, { by: 'TE', enteredAt: iso(2) });
  const late = applyObservations(p, iso(2.5), { contractions: { count: 2, duration: 15 } }, LCG,
    { by: 'TE', enteredAt: NOW.toISOString() });
  assert.deepEqual(late.obs[0].flags, [], 'latent at 09:30: 2 in 10 min of 15 s are not alert values');
  assert.deepEqual([late.added, p.alerts], [[], []]);
  const onTime = applyObservations(p, iso(1.5), { contractions: { count: 2, duration: 15 } }, LCG,
    { by: 'TE', enteredAt: NOW.toISOString() });
  assert.deepEqual(onTime.obs[0].flags, ['weak_contractions', 'contraction_short'], 'active at 10:30: both are');
  assert.deepEqual(codes(onTime.added), ['weak_contractions', 'contraction_short']);
  assert.deepEqual(p.alerts.map(a => a.obsIds), [[onTime.obs[0].id], [onTime.obs[0].id]]);
  chartAgrees(p, LCG);
});

test('M5 review: an entry made now is judged exactly as the live case, in every stage and status', () => {
  const opened = () => {
    const p = admitted(8);
    applyObservations(p, iso(7), { exam: { dilatation: 5 } }, LCG, { enteredAt: iso(7) });
    return p;
  };
  const full = () => {
    const p = opened();
    applyObservations(p, iso(1), { exam: { dilatation: 10 } }, LCG, { enteredAt: iso(1) });
    return p;
  };
  const delivered = full();
  applyBirth(delivered, { time: iso(0.5), outcome: 'live', placentaComplete: 'Y' }, {}, LCG);
  const referred = opened();
  applyReferral(referred, { time: iso(1), reasons: ['Prolonged labour'] });
  const departed = opened();
  applyReferral(departed, { time: iso(1), reasons: ['Prolonged labour'] });
  recordEvent(departed, 'handover', iso(0.5), LCG);
  const states = { latent: admitted(8), active: opened(), second: full(), delivered, referred, departed };
  const flags = {};
  for (const [name, p] of Object.entries(states)) {
    const r = applyObservations(p, NOW.toISOString(), { contractions: { count: 2, duration: 15 }, exam: { dilatation: 5 } }, LCG);
    for (const o of r.obs) assert.deepEqual(o.flags, evaluateObs(p, o, LCG).map(d => d.code), `${name}: ${o.type}`);
    flags[name] = r.obs.map(o => o.flags);
  }
  // the stage was read: 5 cm for 7 h is a progress alert in the active first stage only
  assert.deepEqual(flags.active, [['weak_contractions', 'contraction_short'], ['lcg_progress']]);
  assert.deepEqual(flags.referred, flags.active, 'still in labour until she leaves');
  assert.deepEqual(flags.second[1], []);
  assert.deepEqual(flags.delivered[1], [], 'no progress rule after the birth');
  // after the birth an entry back-timed into labour is judged in the stage it was taken in
  const before = applyObservations(delivered, iso(7.5), { contractions: { count: 2 } }, LCG).obs[0];
  const during = applyObservations(delivered, iso(3), { contractions: { count: 2 } }, LCG).obs[0];
  assert.deepEqual([before.flags, during.flags], [[], ['weak_contractions']]);
});

test('M5 review: LCG: a forgotten earlier exam is read by the exam after it - 5 cm since 04:00 is the 6-hour limit at 10:00', () => {
  // the 10:00 exam at 5 cm opened the active stage; at 10:30 the forgotten 04:00 exam of 5 cm is entered
  const p = admitted(7);
  const ten = applyObservations(p, iso(0.5), { exam: { dilatation: 5 } }, LCG, { by: 'TE', enteredAt: iso(0.5) }).obs[0];
  assert.deepEqual(ten.flags, [], 'first exam at 5 cm: no time spent at 5 cm yet');
  const r = applyObservations(p, iso(6.5), { exam: { dilatation: 5 } }, LCG, { by: 'AB' });
  assert.deepEqual(r.transitions, ['active_moved']);
  assert.deepEqual(r.obs[0].flags, [], 'the 04:00 exam itself is the first at 5 cm');
  assert.deepEqual(ten.flags, ['lcg_progress'], 'now 6 h at 5 cm');
  const a = p.alerts.find(x => x.code === 'lcg_progress');
  assert.deepEqual([a.severity, a.resolved, a.ack, a.time, a.obsIds], ['danger', false, false, ten.time, [ten.id]]);
  assert.match(a.title, /5 cm for 6 h/);
  assert.deepEqual(r.added, [a], 'asked with the entry that revealed it');
  chartAgrees(p, LCG);
});

test('M5 review: Ethiopian partograph: a back-timed exam that moves the alert-line anchor judges the exams after it', () => {
  // 10:00 4 cm and 14:00 8 cm sit on the alert line; at 14:30 a forgotten 08:00 exam of 4 cm moves it 2 h earlier
  const p = admitted(7);
  p.protocolId = 'ethiopia2021';
  const four = applyObservations(p, iso(4.5), { exam: { dilatation: 4 } }, ETH, { enteredAt: iso(4.5) }).obs[0];
  const eight = applyObservations(p, iso(0.5), { exam: { dilatation: 8 } }, ETH, { enteredAt: iso(0.5) }).obs[0];
  assert.deepEqual([four.flags, eight.flags], [[], []], '8 cm 4 h after 4 cm: on the alert line');
  const r = applyObservations(p, iso(6.5), { exam: { dilatation: 4 } }, ETH, { by: 'TE' });
  assert.deepEqual(r.transitions, ['active_moved']);
  assert.deepEqual(eight.flags, ['alert_line'], '8 cm 6 h after 4 cm: right of the alert line, left of the action line');
  assert.deepEqual(four.flags, ['alert_line'], 'still 4 cm 2 h after 4 cm: right of the alert line as well');
  const a = p.alerts.find(x => x.code === 'alert_line');
  assert.deepEqual([a.resolved, a.ack, a.time, a.obsIds], [false, false, four.time, [four.id, eight.id]]);
  assert.deepEqual(r.added, [a]);
  // the partograph does not circle the X (lead: js/partograph.js); every other circle is checked
  chartAgrees(p, ETH, { uncircled: ['alert_line', 'action_line'] });
});

test('M5 review: voiding the exam that opened the active stage closes a later progress alert whose interval is gone', () => {
  const p = admitted(7);
  const opening = applyObservations(p, iso(6.5), { exam: { dilatation: 5 } }, LCG, { enteredAt: iso(6.5) }).obs[0];
  const later = applyObservations(p, iso(0.5), { exam: { dilatation: 5 } }, LCG, { enteredAt: iso(0.5) }).obs[0];
  assert.deepEqual(later.flags, ['lcg_progress'], '5 cm from 04:00 to 10:00');
  const a = p.alerts.find(x => x.code === 'lcg_progress');
  const at = NOW.toISOString();
  const pv = previewVoid(p, opening.id, LCG, { at });
  assert.deepEqual([pv.resolved, pv.added], [[a.title], []], 'the void dialog says it closes');
  const r = voidObservation(p, opening.id, LCG, { by: 'AB', reason: 'examined the wrong woman', at });
  assert.deepEqual(r.transitions, ['active_moved']);
  assert.deepEqual(later.flags, [], 'the first exam at 5 cm now');
  assert.deepEqual([a.resolved, a.resolvedHow, a.resolvedBy, a.obsIds], [true, 'restaged', 'AB', []]);
  assert.deepEqual([r.resolved, r.added], [[a], []]);
  chartAgrees(p, LCG);
});

test('M5 review: correcting an exam judges the exams after it again, in both directions', () => {
  const p = admitted(7);
  const first = applyObservations(p, iso(6.5), { exam: { dilatation: 4 } }, LCG, { enteredAt: iso(6.5) }).obs[0];
  const later = applyObservations(p, iso(0.5), { exam: { dilatation: 5 } }, LCG, { enteredAt: iso(0.5) }).obs[0];
  assert.deepEqual(later.flags, []);
  const at = NOW.toISOString();
  const c = correctObservation(p, first.id, { dilatation: 5 }, LCG, { by: 'TE', reason: 'typed 4 for 5', at });
  assert.deepEqual(c.transitions, ['active_moved']);
  assert.deepEqual(later.flags, ['lcg_progress'], '5 cm since 04:00');
  const a = p.alerts.find(x => x.code === 'lcg_progress');
  assert.ok(c.added.includes(a));
  chartAgrees(p, LCG);
  correctObservation(p, c.obs[0].id, { dilatation: 5 }, LCG, { by: 'TE', reason: 'wrong time', time: iso(2.5), at });
  assert.deepEqual(later.flags, [], '5 cm since 08:00: 2 h');
  assert.deepEqual([a.resolved, a.resolvedHow], [true, 'restaged']);
  chartAgrees(p, LCG);
});

test('M5 review: a void runs the time rules in the same save, and its preview lists every alert it opens or closes', () => {
  // 14 h of active first stage, then a mistyped 10 cm; the second stage has been running long on the heartbeat
  const p = admitted(15);
  const rec = (hAgo, values) => applyObservations(p, iso(hAgo), values, LCG, { by: 'TE', enteredAt: iso(hAgo) }).obs[0];
  rec(14, { exam: { dilatation: 5 } });
  rec(10, { exam: { dilatation: 7 } });
  const ten = rec(6, { exam: { dilatation: 10 } });
  const seven = rec(5, { exam: { dilatation: 7 } });
  const fhr = rec(1, { baby: { fhr: 140 } });
  const at = NOW.toISOString();
  refreshTimeAlerts(p, LCG, NOW);
  const second = p.alerts.find(a => a.code === 'second_long');
  assert.equal(second.resolved, false, 'second stage for 6 h');
  // a void that does not move the stage leaves the time alerts as they are
  const other = voidObservation(p, fhr.id, LCG, { by: 'TE', reason: 'duplicate', at });
  assert.deepEqual([other.added, other.resolved, second.resolved], [[], [], false]);
  const kept = structuredClone(p);
  const pv = previewVoid(p, ten.id, LCG, { at });
  assert.deepEqual(p, kept, 'the preview changes nothing');
  const r = voidObservation(p, ten.id, LCG, { by: 'TE', reason: 'typed 10 for 7', at });
  assert.deepEqual([second.resolved, second.resolvedHow, second.resolvedAt], [true, 'cleared', at], 'closed in the same call');
  assert.deepEqual(codes(r.added), ['lcg_progress', 'active_long', 'lcg_progress_due'], 'and the limits that now apply open in it');
  assert.deepEqual(codes(r.resolved), ['second_long']);
  assert.deepEqual([pv.added, pv.resolved], [r.added.map(a => a.title), r.resolved.map(a => a.title)], 'the dialog listed exactly these');
  assert.match(pv.added[1], /Active first stage > 12 h/);
  const tick = refreshTimeAlerts(p, LCG, NOW);
  assert.deepEqual([tick.added, tick.resolved], [[], []], 'nothing left for the heartbeat to open or close');
  assert.deepEqual(seven.flags, ['lcg_progress']);
  chartAgrees(p, LCG);
});

test('M5 review: a correction runs the time rules in the same save', () => {
  const p = admitted(11);
  applyObservations(p, iso(10), { exam: { dilatation: 6 } }, LCG, { enteredAt: iso(10) });
  const ten = applyObservations(p, iso(4.5), { exam: { dilatation: 10 } }, LCG, { enteredAt: iso(4.5) }).obs[0];
  refreshTimeAlerts(p, LCG, NOW);
  const second = p.alerts.find(a => a.code === 'second_long');
  assert.equal(second.resolved, false, 'second stage for 4.5 h');
  const r = correctObservation(p, ten.id, { dilatation: 6 }, LCG, { by: 'TE', reason: 'typed 10 for 6', at: NOW.toISOString() });
  assert.deepEqual(r.transitions, ['second_reverted']);
  assert.deepEqual([second.resolved, second.resolvedHow], [true, 'cleared'], 'closed in the same call');
  assert.ok(r.resolved.includes(second));
  assert.deepEqual(codes(r.added), ['lcg_progress', 'lcg_progress_due'], '6 cm for 5.5 h at the corrected exam, 10 h by now (limit 5 h)');
  assert.deepEqual(r.addedByClock, [r.added[1].title], 'only the time limit is put down to the clock');
  chartAgrees(p, LCG);
});

// ------------------------------- M5 final review: after labour, by clock ----

test('M5 review: after the birth, correcting a labour entry closes its labour finding at the birth, unasked', () => {
  // twin of 'M5: after the birth, a labour finding raised by a stage move is closed at the birth':
  // birth at 18:00; at 19:00 the midwife corrects the descent on the 14:00 exam (6 cm since 09:00)
  const p = admitted(11);
  applyObservations(p, iso(10), { exam: { dilatation: 6 } }, LCG, { enteredAt: iso(10) });
  const exam = applyObservations(p, iso(5), { exam: { dilatation: 6, descent: 3 } }, LCG, { enteredAt: iso(5) }).obs[0];
  const first = p.alerts.find(a => a.code === 'lcg_progress');
  applyBirth(p, { time: iso(1), outcome: 'live', mode: 'svd', placentaComplete: 'Y' }, {}, LCG, { by: 'TE' });
  assert.equal(first.resolvedHow, 'birth');
  const r = correctObservation(p, exam.id, { dilatation: 6, descent: 2 }, LCG,
    { by: 'TE', reason: 'descent mistyped', at: NOW.toISOString() });
  const fresh = r.obs[0];
  assert.deepEqual(fresh.flags, ['lcg_progress'], 'the chart still circles 6 cm for 5 h as it stood');
  const again = p.alerts.find(a => a.code === 'lcg_progress' && a !== first);
  assert.match(again.title, /No progress: 6 cm for 5 h/);
  assert.deepEqual([again.severity, again.episode, again.resolved, again.resolvedHow, again.resolvedAt, again.obsIds],
    ['danger', 2, true, 'birth', iso(1), [fresh.id]]);
  assert.deepEqual(r.added, [], 'no acknowledgement asked of a delivered woman');
  assert.ok(r.resolved.includes(again));
  assert.deepEqual(p.alerts.filter(a => !a.resolved), []);
});

test('M5 review: after her departure on referral, correcting a labour entry closes its labour finding at the departure', () => {
  const p = admitted(11);
  applyObservations(p, iso(10), { exam: { dilatation: 6 } }, LCG, { enteredAt: iso(10) });
  const exam = applyObservations(p, iso(5), { exam: { dilatation: 6, descent: 3 } }, LCG, { enteredAt: iso(5) }).obs[0];
  applyReferral(p, { time: iso(2), reasons: ['Prolonged labour'], facility: 'Hospital' }, { by: 'TE' });
  recordEvent(p, 'handover', iso(1.5), LCG, { by: 'TE' });
  const r = correctObservation(p, exam.id, { dilatation: 6, descent: 2 }, LCG,
    { by: 'TE', reason: 'descent mistyped', at: NOW.toISOString() });
  assert.deepEqual(r.obs[0].flags, ['lcg_progress']);
  const again = p.alerts.find(a => a.code === 'lcg_progress' && (a.obsIds || []).includes(r.obs[0].id));
  assert.deepEqual([again.resolved, again.resolvedHow, again.resolvedAt], [true, 'handover', iso(1.5)]);
  assert.deepEqual(r.added, [], 'she has left: nothing to acknowledge on this device');
  assert.deepEqual(p.alerts.filter(a => !a.resolved), []);
});

test('M5 review: after the birth, a back-timed labour finding closes at the birth; a maternal one and a later entry are asked', () => {
  const p = admitted(8);
  applyObservations(p, iso(7), { exam: { dilatation: 6 } }, LCG, { enteredAt: iso(7) });
  applyBirth(p, { time: iso(1), outcome: 'live', placentaComplete: 'Y' }, {}, LCG, { by: 'TE' });
  const r = applyObservations(p, iso(3), { baby: { fhr: 170 }, vitals: { sys: 150, dia: 95 } }, LCG, { by: 'TE' });
  assert.deepEqual(r.obs.map(o => o.flags), [['fhr_abn'], ['htn']], 'both values are circled as they stood');
  const fhr = p.alerts.find(a => a.code === 'fhr_abn');
  assert.deepEqual([fhr.resolved, fhr.resolvedHow, fhr.resolvedAt], [true, 'birth', iso(1)]);
  assert.ok(r.resolved.includes(fhr));
  assert.deepEqual(codes(r.added), ['htn'], 'raised BP carries into the postpartum watch');
  // an infusion still running after the birth: timed after it, its rate alert is asked as usual
  const pp = applyObservations(p, iso(0.5), { oxytocin: { dropsMin: 70 } }, LCG, { by: 'TE' });
  assert.deepEqual(codes(pp.added), ['oxy_rate']);
});

test('M5 review: a void reports the alerts the time rules opened apart (addedByClock)', () => {
  // a mistyped 10 cm put the 7 cm exam after it in the second stage; the second-stage limit has
  // just passed and the heartbeat has not run yet
  const p = admitted(11);
  const rec = (hAgo, values) => applyObservations(p, iso(hAgo), values, LCG, { by: 'TE', enteredAt: iso(hAgo) }).obs[0];
  rec(10, { exam: { dilatation: 7 } });
  const ten = rec(6, { exam: { dilatation: 10 } });
  rec(5, { exam: { dilatation: 7 } });
  const care = rec(2, { supportive: { companion: 'Y', painRelief: 'Y', oralFluid: 'Y', posture: 'upright' } });
  const at = NOW.toISOString();
  // an unrelated supportive-care entry: the void itself changes nothing; the clock opens the limit in its save
  const pv = previewVoid(p, care.id, LCG, { at });
  const r = voidObservation(p, care.id, LCG, { by: 'TE', reason: 'recorded on the wrong woman', at });
  assert.deepEqual(codes(r.added), ['second_long']);
  assert.deepEqual(r.addedByClock, [r.added[0].title]);
  assert.deepEqual([pv.added, pv.addedByClock], [r.addedByClock, r.addedByClock], 'the dialog can label it a time limit');
  // the mistyped 10 cm: the exam after it raises its own progress alert; the clock opens the progress limit
  const v = voidObservation(p, ten.id, LCG, { by: 'TE', reason: 'typed 10 for 7', at });
  assert.deepEqual(codes(v.added), ['lcg_progress', 'lcg_progress_due']);
  assert.deepEqual(v.addedByClock, [v.added[1].title], 'the alert raised by an entry is not put down to the clock');
});

// ------------------------------------- M6: void medication entries and notes ----
// A drug recorded in error used to stay "given" on the chart, the print, the
// referral note and the FHIR export: only observations could be voided.

// a void runs the time rules at its own time: pinned to the fixtures' clock
const AT = NOW.toISOString();
const med = (id, hAgo, kind, extra = {}) => ({ id, time: iso(hAgo), kind, action: 'given', by: 'TE', ...extra });
/** An oxytocin medication record: 'start' and 'rate' carry a rate, 'stop' the modal's stop text. */
const oxy = (id, hAgo, action) => ({
  id, time: iso(hAgo), kind: 'oxytocin', action, by: 'TE',
  ...(action === 'stop' ? { detail: 'Oxytocin STOPPED' } : { detail: '', oxyUL: 2.5, oxyDrops: 10 }),
});

test('M6: voidMedication keeps the entry struck through; an unknown or voided id, no reason or no initials is refused', () => {
  const p = mkPatient({ meds: [med('gen', 2, 'medicine', { detail: 'Gentamicin 80 mg IV' })] });
  const kept = structuredClone(p);
  assert.throws(() => voidMedication(p, 'nope', LCG, { by: 'TE', reason: 'wrong woman' }), /Medication entry not found/);
  assert.throws(() => voidMedication(p, 'gen', LCG, { by: 'TE', reason: '  ' }), /reason is required/);
  assert.throws(() => voidMedication(p, 'gen', LCG, { by: ' ', reason: 'wrong woman' }), /Initials are required/);
  assert.throws(() => voidMedication(p, 'gen', LCG, { reason: 'wrong woman' }), /Initials are required/);
  assert.deepEqual(p, kept, 'a refused void changes nothing');
  const r = voidMedication(p, 'gen', LCG, { by: 'TE', reason: 'given to another woman', at: iso(1) });
  assert.equal(p.meds.length, 1, 'nothing is deleted');
  assert.deepEqual(p.meds[0].voided, { at: iso(1), by: 'TE', reason: 'given to another woman' });
  assert.equal(p.meds[0].detail, 'Gentamicin 80 mg IV', 'the values stay');
  assert.deepEqual([r.entry, r.oxytocin, r.added, r.resolved], [p.meds[0], { before: false, after: false }, [], []]);
  assert.throws(() => voidMedication(p, 'gen', LCG, { by: 'TE', reason: 'again' }), /already voided/);
  // a medicine or IV fluid voided while oxytocin runs leaves the infusion alone
  const q = mkPatient({ oxytocinRunning: true, meds: [oxy('s', 3, 'start'), med('rl', 2, 'ivfluid', { detail: 'RL 1 L' })] });
  assert.deepEqual(voidMedication(q, 'rl', LCG, { by: 'TE', reason: 'duplicate', at: AT }).oxytocin, { before: true, after: true });
});

test('M6: voiding an oxytocin record re-derives whether the infusion runs: the latest record that stands decides', () => {
  // a start recorded in error: nothing else stands, nothing runs
  const a = mkPatient({ oxytocinRunning: true, meds: [oxy('s', 3, 'start')] });
  assert.deepEqual(voidMedication(a, 's', LCG, { by: 'TE', reason: 'wrong woman', at: AT }).oxytocin, { before: true, after: false });
  assert.equal(a.oxytocinRunning, false);
  // a stop recorded in error: the rate before it stands, so it runs again
  const b = mkPatient({ oxytocinRunning: false, meds: [oxy('s', 3, 'start'), oxy('r', 2, 'rate'), oxy('x', 1, 'stop')] });
  assert.deepEqual(voidMedication(b, 'x', LCG, { by: 'TE', reason: 'not stopped', at: AT }).oxytocin, { before: false, after: true });
  // a restart voided: the stop before it is the latest that stands
  const c = mkPatient({ oxytocinRunning: true, meds: [oxy('s', 3, 'start'), oxy('x', 2, 'stop'), oxy('s2', 1, 'start')] });
  voidMedication(c, 's2', LCG, { by: 'TE', reason: 'wrong woman', at: AT });
  assert.equal(c.oxytocinRunning, false);
  // the first start voided while a later rate stands: still running
  const d = mkPatient({ oxytocinRunning: true, meds: [oxy('s', 3, 'start'), oxy('r', 2, 'rate')] });
  voidMedication(d, 's', LCG, { by: 'TE', reason: 'duplicate', at: AT });
  assert.equal(d.oxytocinRunning, true);
  // by time, not by the order of the list; a v1 stop (no action) is known by its text
  const e = mkPatient({
    oxytocinRunning: true,
    meds: [oxy('late', 1, 'rate'), { id: 'v1', time: iso(2), kind: 'oxytocin', detail: 'Oxytocin STOPPED', by: null }, oxy('s', 3, 'start')],
  });
  voidMedication(e, 'late', LCG, { by: 'TE', reason: 'wrong woman', at: AT });
  assert.equal(e.oxytocinRunning, false, 'the v1 stop is now the latest record');
  // two records at the same time: the one entered later wins
  assert.equal(oxytocinRunningFrom({ meds: [oxy('a', 1, 'start'), oxy('b', 1, 'stop')] }), false);
  assert.equal(oxytocinRunningFrom({ meds: [oxy('b', 1, 'stop'), oxy('a', 1, 'start')] }), true);
  assert.equal(oxytocinRunningFrom({}), false);
});

test('M6: the oxytocin due chip follows a voided oxytocin record', () => {
  // LCG: an oxytocin record is due every 60 min while the infusion runs (F10)
  const p = mkPatient({ oxytocinRunning: false, meds: [oxy('s', 3, 'start'), oxy('x', 2, 'stop')] });
  const due = () => dueList(p, PROTOCOLS.lcg, NOW).find(d => d.type === 'oxytocin');
  assert.equal(due(), undefined, 'stopped: no oxytocin check is due');
  voidMedication(p, 'x', LCG, { by: 'TE', reason: 'stop recorded on the wrong woman', at: NOW.toISOString() });
  const item = due();
  assert.deepEqual([item.last, item.dueAt, item.state], [iso(3), iso(2), 'overdue'], 'running again: due 60 min after its last record');
  voidMedication(p, 's', LCG, { by: 'TE', reason: 'never started', at: NOW.toISOString() });
  assert.equal(due(), undefined, 'no record stands: no check is due');
});

test('M6: a medication void runs the time rules in the same save; its preview lists exactly what they open and close', () => {
  // 13 h of active first stage (limit 12 h) and a time alert left over from a second stage taken back
  const p = mkPatient({ createdAt: iso(14), admission: { time: iso(14) }, activeStartTime: iso(13), meds: [med('amp', 2, 'medicine', { detail: 'Ampicillin 2 g IV' })] });
  const [stale] = addAlerts(p, [{ code: 'second_warn', severity: 'warn', title: 'Second stage 1 h', advice: [] }], 'time', { time: iso(1) });
  const at = NOW.toISOString();
  const kept = structuredClone(p);
  const pv = previewVoidMedication(p, 'amp', LCG, { at });
  assert.deepEqual(p, kept, 'the preview changes nothing');
  const r = voidMedication(p, 'amp', LCG, { by: 'TE', reason: 'recorded on the wrong woman', at });
  assert.deepEqual(codes(r.added), ['active_long']);
  assert.deepEqual(r.addedByClock, [r.added[0].title]);
  assert.deepEqual([r.resolved, stale.resolvedHow], [[stale], 'cleared']);
  assert.deepEqual([pv.added, pv.addedByClock, pv.resolved, pv.oxytocin],
    [r.addedByClock, r.addedByClock, [stale.title], { before: false, after: false }], 'the dialog listed exactly these');
  const tick = refreshTimeAlerts(p, LCG, NOW);
  assert.deepEqual([tick.added, tick.resolved], [[], []], 'nothing left for the heartbeat');
});

test('M6: voidNote keeps the note struck through; refuses an unknown or voided id, no reason, no initials, and the notes the app writes', () => {
  const p = mkPatient({
    notes: [
      { id: 'n1', time: iso(2), by: 'TE', text: 'Cervix 7 cm, progressing', plan: 'Reassess in 4 h' },
      { id: 'ack', time: iso(1.5), by: 'TE', kind: 'ack', text: 'Alerts acknowledged: FHR 170 bpm', plan: 'senior' },
      { id: 'v1ack', time: iso(1.4), by: 'TE', text: 'Alerts acknowledged: FHR 165 bpm', plan: 'monitoring' },
      { id: 'emg', time: iso(1.2), by: 'TE', text: EMERGENCY_NOTE + 'Cord prolapse', plan: 'emergency management + referral assessment' },
    ],
  });
  applyReferral(p, { time: iso(1), reasons: ['Prolonged labour'], facility: 'Hospital' }, { by: 'TE' });
  const referral = p.notes.at(-1);
  assert.deepEqual(p.notes.map(noteAction), [null, 'ack', 'ack', 'emergency', 'referral']);
  assert.equal(noteAction({ text: 'Plan agreed with her', plan: 'referral' }), null, 'a typed plan is not the referral note');
  const kept = structuredClone(p);
  assert.throws(() => voidNote(p, 'nope', { by: 'TE', reason: 'x' }), /Note not found/);
  assert.throws(() => voidNote(p, 'n1', { by: 'TE', reason: '' }), /reason is required/);
  assert.throws(() => voidNote(p, 'n1', { by: '', reason: 'wrong case' }), /Initials are required/);
  for (const id of ['ack', 'v1ack', 'emg', referral.id]) {
    assert.throws(() => voidNote(p, id, { by: 'TE', reason: 'x' }), /is the record of .+ and cannot be voided/, id);
  }
  assert.deepEqual(p, kept, 'a refused void changes nothing');
  const r = voidNote(p, 'n1', { by: 'AB', reason: 'written on the wrong case', at: iso(0.5) });
  assert.equal(r.entry, p.notes[0]);
  assert.deepEqual(p.notes[0].voided, { at: iso(0.5), by: 'AB', reason: 'written on the wrong case' });
  assert.deepEqual([p.notes[0].text, p.notes.length], ['Cervix 7 cm, progressing', 5], 'kept, nothing deleted');
  assert.throws(() => voidNote(p, 'n1', { by: 'AB', reason: 'again' }), /already voided/);
});

// ---------------------------- M6: her departure closes her labour findings ----

/** In active labour from 7 h ago (5 cm); FHR 170 at 3 h ago; FHR 140 at 2.5 h ago cleared it. */
function clearedFinding() {
  const p = admitted(8);
  applyObservations(p, iso(7), { exam: { dilatation: 5 } }, LCG, { by: 'TE', enteredAt: iso(7) });
  applyObservations(p, iso(3), { baby: { fhr: 170 } }, LCG, { by: 'TE', enteredAt: iso(3) });
  const normal = applyObservations(p, iso(2.5), { baby: { fhr: 140 } }, LCG, { by: 'TE', enteredAt: iso(2.5) }).obs[0];
  const fhr = p.alerts.find(a => a.code === 'fhr_abn');
  assert.deepEqual([fhr.resolved, fhr.resolvedHow], [true, 'evidence']);
  return { p, normal, fhr };
}

/** clearedFinding, referred 1 h ago and gone 30 min ago. */
function departed() {
  const c = clearedFinding();
  applyReferral(c.p, { time: iso(1), reasons: ['Prolonged labour'], facility: 'Hospital' }, { by: 'TE' });
  recordEvent(c.p, 'handover', iso(0.5), LCG, { by: 'AB' });
  return c;
}

test('M6: at her departure her open labour findings close at the departure time; maternal findings stay open', () => {
  const p = admitted(8);
  applyObservations(p, iso(7), { exam: { dilatation: 5 } }, LCG, { by: 'TE', enteredAt: iso(7) });
  applyObservations(p, iso(2), { baby: { fhr: 170 }, vitals: { sys: 150, dia: 95 }, supportive: { companion: 'N' } }, LCG,
    { by: 'TE', enteredAt: iso(2) });
  refreshTimeAlerts(p, LCG, new Date(iso(0.75))); // 5 cm for 6.25 h: the progress limit, on the heartbeat
  assert.deepEqual(codes(p.alerts), ['fhr_abn', 'htn', 'no_companion', 'lcg_progress_due']);
  applyReferral(p, { time: iso(1), reasons: ['Abnormal FHR'], facility: 'Hospital' }, { by: 'TE' });
  assert.deepEqual(p.alerts.filter(a => a.resolved), [], 'still here: every finding stays open');
  const r = recordEvent(p, 'handover', iso(0.5), LCG, { by: 'AB' });
  const alert = code => p.alerts.find(a => a.code === code);
  assert.deepEqual(codes(r.resolved), ['lcg_progress_due', 'fhr_abn', 'no_companion']);
  for (const code of ['fhr_abn', 'no_companion', 'lcg_progress_due']) {
    const a = alert(code);
    assert.deepEqual([a.resolved, a.resolvedHow, a.resolvedAt, a.resolvedBy], [true, 'handover', iso(0.5), null], code);
  }
  assert.equal(alert('htn').resolved, false, 'raised BP is a maternal finding: it stays as it is');
  assert.equal(alert('fhr_abn').ack, false, 'closed, still awaiting acknowledgement like an alert closed at the birth');
  assert.equal(isLabouring(p), false);
  // a departure is recorded once and is never voided: recording it again is refused and changes nothing
  const kept = structuredClone(p);
  assert.throws(() => recordEvent(p, 'handover', iso(0.2), LCG, { by: 'TE' }), /already recorded/);
  assert.deepEqual(p, kept);
});

test('M6: after her departure (or the birth) a void that takes away what had cleared a labour finding closes it at that end', () => {
  const { p, normal, fhr } = departed();
  const at = NOW.toISOString();
  const pv = previewVoid(p, normal.id, LCG, { at });
  assert.deepEqual([pv.reopened, pv.resolved], [[], [fhr.title]], 'the dialog never says it re-opens');
  const r = voidObservation(p, normal.id, LCG, { by: 'TE', reason: 'reading of another woman', at });
  assert.deepEqual([fhr.resolved, fhr.resolvedHow, fhr.resolvedAt], [true, 'handover', iso(0.5)]);
  assert.deepEqual([r.reopened, r.resolved], [[], [fhr]]);
  assert.deepEqual(p.alerts.filter(a => !a.resolved), [], 'she has left: no labour alert stays open');
  // the same after the birth: it closes at the birth
  const b = clearedFinding();
  applyBirth(b.p, { time: iso(0.5), outcome: 'live', placentaComplete: 'Y' }, {}, LCG, { by: 'TE' });
  voidObservation(b.p, b.normal.id, LCG, { by: 'TE', reason: 'reading of another woman', at });
  assert.deepEqual([b.fhr.resolved, b.fhr.resolvedHow, b.fhr.resolvedAt], [true, 'birth', iso(0.5)]);
  // still in labour, it re-opens as before
  const l = clearedFinding();
  assert.deepEqual(voidObservation(l.p, l.normal.id, LCG, { by: 'TE', reason: 'x', at }).reopened, [l.fhr]);
});

test('M6: after her departure a correction re-clears a labour finding when the value stays normal, else closes it at the departure', () => {
  const at = NOW.toISOString();
  const one = departed();
  const c = correctObservation(one.p, one.normal.id, { fhr: 142 }, LCG, { by: 'TE', reason: 'typed 140 for 142', at });
  assert.deepEqual([one.fhr.resolved, one.fhr.resolvedHow, one.fhr.resolvedAt, one.fhr.resolvedByObs],
    [true, 'evidence', iso(2.5), c.obs[0].id], 'the corrected reading clears it as the old one did');
  assert.deepEqual([c.added, c.voided.reopened], [[], []]);
  // corrected to an abnormal value: it joins the re-opened finding, which closes at her departure, unasked
  const two = departed();
  const d = correctObservation(two.p, two.normal.id, { fhr: 175 }, LCG, { by: 'TE', reason: 'typed 140 for 175', at });
  assert.deepEqual([two.fhr.resolved, two.fhr.resolvedHow, two.fhr.resolvedAt], [true, 'handover', iso(0.5)]);
  assert.ok(two.fhr.obsIds.includes(d.obs[0].id));
  assert.deepEqual(d.added, [], 'she has left: nothing to acknowledge on this device');
  assert.deepEqual(two.p.alerts.filter(a => !a.resolved), []);
});

test('M6: after a birth, a labour finding made after it closes at her later departure; a postpartum finding stays', () => {
  const p = admitted(8);
  applyObservations(p, iso(7), { exam: { dilatation: 6 } }, LCG, { enteredAt: iso(7) });
  applyBirth(p, { time: iso(3), outcome: 'live', placentaComplete: 'Y' }, {}, LCG, { by: 'TE' });
  // an infusion still running after the birth, and a soft uterus
  const pp = applyObservations(p, iso(2), { oxytocin: { dropsMin: 70 }, ppMother: { bleeding: 'normal', tone: 'soft', pulse: 88 } }, LCG, { by: 'TE' });
  assert.deepEqual(codes(pp.added), ['oxy_rate', 'pp_atony']);
  applyReferral(p, { time: iso(1.5), reasons: ['Uterine atony'], facility: 'Hospital' }, { by: 'TE' });
  recordEvent(p, 'handover', iso(1), LCG, { by: 'TE' });
  const rate = p.alerts.find(a => a.code === 'oxy_rate');
  assert.deepEqual([rate.resolved, rate.resolvedHow, rate.resolvedAt], [true, 'handover', iso(1)]);
  assert.equal(p.alerts.find(a => a.code === 'pp_atony').resolved, false, 'not a labour finding: it stays as it is');
  // that oxytocin check corrected after she left: its finding closes at the departure, unasked
  const c = correctObservation(p, pp.obs[0].id, { dropsMin: 72 }, LCG, { by: 'TE', reason: 'typo', at: NOW.toISOString() });
  assert.deepEqual(c.added, []);
  assert.deepEqual(p.alerts.filter(a => a.code === 'oxy_rate' && !a.resolved), []);
});

test('M6: voiding the birth record of a woman who has left keeps her referred, off the ward board, her labour findings closed', () => {
  const born = () => {
    const p = admitted(8);
    applyObservations(p, iso(7), { exam: { dilatation: 5 } }, LCG, { enteredAt: iso(7) });
    applyObservations(p, iso(3), { baby: { fhr: 170 } }, LCG, { by: 'TE', enteredAt: iso(3) });
    applyObservations(p, iso(2.5), { exam: { dilatation: 10 } }, LCG, { by: 'TE', enteredAt: iso(2.5) });
    applyBirth(p, { time: iso(2), outcome: 'live', placentaComplete: 'N' }, {}, LCG, { by: 'TE' });
    applyReferral(p, { time: iso(1.5), reasons: ['Retained placenta'], facility: 'Hospital' }, { by: 'TE' });
    const fhr = p.alerts.find(a => a.code === 'fhr_abn');
    assert.equal(fhr.resolvedHow, 'birth');
    return { p, fhr };
  };
  const { p, fhr } = born();
  recordEvent(p, 'handover', iso(1), LCG, { by: 'TE' });
  const r = voidDelivery(p, LCG, { by: 'TE', reason: 'wrong birth time', at: iso(0.5) });
  assert.equal(p.status, 'referred');
  assert.equal(isLabouring(p), false, 'she has left: never back in labour on the ward board');
  assert.deepEqual([fhr.resolved, fhr.resolvedHow, fhr.resolvedAt], [true, 'handover', iso(1)]);
  assert.deepEqual(codes(r.resolved), ['retained_products', 'fhr_abn']);
  assert.deepEqual([r.reopened, p.alerts.filter(a => !a.resolved)], [[], []]);
  // referred but not yet gone: she is monitored in labour again (S8), the finding open
  const stay = born();
  const s = voidDelivery(stay.p, LCG, { by: 'TE', reason: 'wrong birth time', at: iso(0.5) });
  assert.deepEqual([stay.p.status, awaitingHandover(stay.p), stay.fhr.resolved], ['referred', true, false]);
  assert.deepEqual(s.reopened, [stay.fhr]);
});

// ------------------- M6: an alert closed in the save that raised it asks for nothing ----

test('M6: a labour finding closed in the save that raised it, after the birth or her departure, is marked needsAck false', () => {
  // back-timed after the birth: the FHR closes at the birth as it is recorded; the raised BP still asks
  const p = admitted(8);
  applyObservations(p, iso(7), { exam: { dilatation: 6 } }, LCG, { enteredAt: iso(7) });
  applyBirth(p, { time: iso(1), outcome: 'live', placentaComplete: 'Y' }, {}, LCG, { by: 'TE' });
  const r = applyObservations(p, iso(3), { baby: { fhr: 170 }, vitals: { sys: 150, dia: 95 } }, LCG, { by: 'TE' });
  const fhr = p.alerts.find(a => a.code === 'fhr_abn'), htn = p.alerts.find(a => a.code === 'htn');
  assert.deepEqual([fhr.resolved, fhr.resolvedHow, fhr.ack, fhr.needsAck], [true, 'birth', false, false]);
  assert.deepEqual([htn.resolved, htn.needsAck, codes(r.added)], [false, undefined, ['htn']], 'a maternal finding asks as usual');
  // restaging after the birth: a voided 10 cm puts the exam after it back in active labour; its progress alert closes at the birth
  const q = latent();
  applyObservations(q, iso(10), { exam: { dilatation: 7 } }, LCG);
  const ten = applyObservations(q, iso(6), { exam: { dilatation: 10 } }, LCG).obs[0];
  applyObservations(q, iso(5), { exam: { dilatation: 7 } }, LCG);
  applyBirth(q, { time: iso(1), outcome: 'live', mode: 'svd', placentaComplete: 'Y' }, {}, LCG, { by: 'TE' });
  voidObservation(q, ten.id, LCG, { by: 'TE', reason: 'typed 10 for 7', at: AT });
  const progress = q.alerts.find(a => a.code === 'lcg_progress');
  assert.deepEqual([progress.resolvedHow, progress.needsAck], ['birth', false]);
  // a correction after her departure: the new episode closes at the departure needing nothing; the one shown open in labour still waits
  const d = admitted(11);
  applyObservations(d, iso(10), { exam: { dilatation: 6 } }, LCG, { enteredAt: iso(10) });
  const exam = applyObservations(d, iso(5), { exam: { dilatation: 6, descent: 3 } }, LCG, { enteredAt: iso(5) }).obs[0];
  const first = d.alerts.find(a => a.code === 'lcg_progress');
  applyReferral(d, { time: iso(2), reasons: ['Prolonged labour'], facility: 'Hospital' }, { by: 'TE' });
  recordEvent(d, 'handover', iso(1.5), LCG, { by: 'TE' });
  correctObservation(d, exam.id, { dilatation: 6, descent: 2 }, LCG, { by: 'TE', reason: 'descent mistyped', at: AT });
  const again = d.alerts.find(a => a.code === 'lcg_progress' && a !== first);
  assert.deepEqual([again.resolvedHow, again.needsAck], ['handover', false]);
  assert.deepEqual([first.resolvedHow, first.ack, first.needsAck], ['handover', false, undefined], 'shown open in labour: it still asks');
});

test('M6: an alert acknowledged in labour is not asked again by a correction after her departure that closes as it is recorded', () => {
  const { p, normal, fhr } = departed();
  Object.assign(fhr, { ack: true, action: 'senior', actionTime: iso(2.9), ackBy: 'TE', ackCount: 1 });
  const c = correctObservation(p, normal.id, { fhr: 175 }, LCG, { by: 'TE', reason: 'typed 140 for 175', at: AT });
  assert.deepEqual([fhr.resolved, fhr.resolvedHow, fhr.resolvedAt], [true, 'handover', iso(0.5)]);
  assert.deepEqual([fhr.ack, fhr.actionTime, fhr.reAlertedAt, fhr.needsAck], [true, iso(2.9), undefined, undefined],
    'its acknowledgement stands: the re-asking was never shown');
  assert.deepEqual(c.added, []);
});

// ----------------------- M6: an entry at the birth itself was made in labour ----
// The birth form stores a birth typed in the minute of the last labour entry at
// that entry's own time (views/delivery.js birthStoredTime).

test('M6: an entry at the birth itself is judged in its labour stage, and its labour finding closes at the birth', () => {
  // a caesarean section in the active first stage: 6 cm since 7 h ago, the birth at the time of the last exam
  const p = admitted(8);
  applyObservations(p, iso(7), { exam: { dilatation: 6 } }, LCG, { enteredAt: iso(7) });
  const exam = applyObservations(p, iso(1), { exam: { dilatation: 6, descent: 3 } }, LCG, { by: 'TE', enteredAt: iso(1) }).obs[0];
  assert.deepEqual(exam.flags, ['lcg_progress']);
  const first = p.alerts.find(a => a.code === 'lcg_progress');
  applyBirth(p, { time: exam.time, mode: 'cs', outcome: 'live', placentaComplete: 'Y' }, {}, LCG, { by: 'TE' });
  assert.deepEqual([first.resolvedHow, first.resolvedAt], ['birth', exam.time]);
  const c = correctObservation(p, exam.id, { dilatation: 6, descent: 2 }, LCG, { by: 'TE', reason: 'descent mistyped', at: AT });
  assert.deepEqual(c.obs[0].flags, ['lcg_progress'], 'judged in the active first stage it was taken in, not as after the birth');
  const again = p.alerts.find(a => a.code === 'lcg_progress' && a !== first);
  assert.deepEqual([again.resolved, again.resolvedHow, again.resolvedAt, again.needsAck], [true, 'birth', exam.time, false]);
  assert.deepEqual([c.added, p.alerts.filter(a => !a.resolved)], [[], []], 'nothing asked, nothing left open');
  // after the birth itself an entry stands as before: an oxytocin rate is asked as usual
  const later = applyObservations(p, iso(0.9), { oxytocin: { dropsMin: 70 } }, LCG, { by: 'TE' });
  assert.deepEqual([codes(later.added), later.added[0].resolved], [['oxy_rate'], false]);
});

// ------------------ M6 review: a re-opened alert always asks; settle by the alert's own time ----

/** In active labour (5 cm 7 h ago), FHR 140 3 h ago; a birth recorded on her by mistake 2 h ago. */
function wrongBirth() {
  const p = admitted(8);
  applyObservations(p, iso(7), { exam: { dilatation: 5 } }, LCG, { by: 'TE', enteredAt: iso(7) });
  const fhr = applyObservations(p, iso(3), { baby: { fhr: 140 } }, LCG, { by: 'TE', enteredAt: iso(3) }).obs[0];
  applyBirth(p, { time: iso(2), outcome: 'live', placentaComplete: 'Y' }, {}, LCG, { by: 'TE', enteredAt: iso(2) });
  return { p, fhr };
}

test('M6 review: the birth voided, a finding closed unasked at it re-opens asking - strip, dialog, chart; a repeat joins it, still asking', () => {
  const { p, fhr } = wrongBirth();
  // the FHR corrected to 95 after the birth: fhr_severe opens and closes at the birth in the same save
  const c = correctObservation(p, fhr.id, { fhr: 95 }, LCG, { by: 'TE', reason: 'typed 140 for 95', at: iso(1.5) });
  const severe = p.alerts.find(a => a.code === 'fhr_severe');
  assert.deepEqual([severe.resolvedHow, severe.needsAck, c.added], ['birth', false, []]);
  const v = voidDelivery(p, LCG, { by: 'TE', reason: 'recorded on the wrong woman', at: iso(1) });
  assert.equal(isLabouring(p), true, 'back in labour');
  assert.deepEqual([v.reopened, severe.resolved, severe.ack, severe.needsAck], [[severe], false, false, undefined]);
  assert.deepEqual(waitingAlerts(p).open, [severe], 'the alert strip and its Acknowledge button ask');
  assert.deepEqual(alertsToAcknowledge(v.reopened), [severe], 'the acknowledgement dialog asks');
  assert.equal(flagState(ackIndex(p), c.obs[0], 'fhr'), 'open', 'the chart circles 95 in red, not grey');
  chartAgrees(p, LCG);
  // a repeat FHR 95 joins the open alert, which still waits for its acknowledgement
  const again = applyObservations(p, iso(0.5), { baby: { fhr: 95 } }, LCG, { by: 'TE', enteredAt: iso(0.5) });
  assert.deepEqual([severe.count, severe.obsIds, severe.ack], [2, [c.obs[0].id, again.obs[0].id], false]);
  assert.deepEqual(waitingAlerts(p).open, [severe]);
  assert.equal(flagState(ackIndex(p), again.obs[0], 'fhr'), 'open');
});

test('M6 review: the birth voided after her departure, a finding closed unasked closes again at the departure, still unasked', () => {
  const left = q => {
    applyReferral(q, { time: iso(1.8), reasons: ['Abnormal FHR'], facility: 'Hospital' }, { by: 'TE' });
    recordEvent(q, 'handover', iso(1.6), LCG, { by: 'TE' });
  };
  const { p, fhr } = wrongBirth();
  left(p);
  correctObservation(p, fhr.id, { fhr: 95 }, LCG, { by: 'TE', reason: 'typed 140 for 95', at: iso(1.5) });
  const severe = p.alerts.find(a => a.code === 'fhr_severe');
  const v = voidDelivery(p, LCG, { by: 'TE', reason: 'recorded on the wrong woman', at: iso(1) });
  assert.deepEqual([severe.resolved, severe.resolvedHow, severe.resolvedAt, severe.needsAck], [true, 'handover', iso(1.6), false]);
  assert.deepEqual([v.reopened, waitingAlerts(p).closed], [[], []]);
  // as if the birth had never been recorded: the correction after her departure closes it there, unasked
  const twin = admitted(8);
  applyObservations(twin, iso(7), { exam: { dilatation: 5 } }, LCG, { by: 'TE', enteredAt: iso(7) });
  const f = applyObservations(twin, iso(3), { baby: { fhr: 140 } }, LCG, { by: 'TE', enteredAt: iso(3) }).obs[0];
  left(twin);
  correctObservation(twin, f.id, { fhr: 95 }, LCG, { by: 'TE', reason: 'typed 140 for 95', at: iso(1.5) });
  const t = twin.alerts.find(a => a.code === 'fhr_severe');
  assert.deepEqual([t.resolvedHow, t.resolvedAt, t.needsAck], [severe.resolvedHow, severe.resolvedAt, severe.needsAck]);
});

test('M6 review: a labour entry back-timed after the birth joins the live rate alert of an infusion still running; it stays open', () => {
  const p = admitted(8);
  applyObservations(p, iso(7), { exam: { dilatation: 6 } }, LCG, { enteredAt: iso(7) });
  applyBirth(p, { time: iso(3), outcome: 'live', placentaComplete: 'Y' }, {}, LCG, { by: 'TE', enteredAt: iso(3) });
  // the infusion runs on after the birth at 70 drops/min: a live alert, acknowledged
  const rate = applyObservations(p, iso(2), { oxytocin: { dropsMin: 70 } }, LCG, { by: 'TE', enteredAt: iso(2) }).added[0];
  Object.assign(rate, { ack: true, action: 'monitoring', actionTime: iso(1.9), ackBy: 'TE' });
  // its labour record, timed before the birth, entered now
  const back = applyObservations(p, iso(4), { oxytocin: { dropsMin: 70 } }, LCG, { by: 'TE' });
  assert.deepEqual([rate.code, rate.resolved, rate.resolvedAt, back.resolved], ['oxy_rate', false, undefined, []],
    'never closed at the birth, before it was raised');
  assert.deepEqual([rate.obsIds.includes(back.obs[0].id), p.alerts.filter(a => a.code === 'oxy_rate')], [true, [rate]], 'joined');
  // a labour entry of its own after the birth still closes at the birth, unasked, as before
  const own = applyObservations(p, iso(5), { contractions: { count: 6 } }, LCG, { by: 'TE' });
  const tachy = p.alerts.find(a => a.code === 'tachysystole');
  assert.deepEqual([tachy.resolvedHow, tachy.resolvedAt, tachy.needsAck, own.added], ['birth', iso(3), false, []]);
});

test('M6: the referral note states its plan in words, as the summary and the chart plan row show it', () => {
  const p = mkPatient();
  applyReferral(p, { time: iso(1), reasons: ['Prolonged labour'], facility: 'Hospital' }, { by: 'TE' });
  const note = p.notes.at(-1);
  assert.equal(note.plan, 'Referred - see the referral note');
  assert.equal(planText(note), 'Referred - see the referral note', 'not "referral"');
  assert.deepEqual([noteAction(note), noteAction({ ...note, plan: 'referral' })], ['referral', 'referral'], 'a v1 referral note too');
});

// ---------- M6 review pass 2: a default re-tapped while correcting is her answer ----

test('M6 review pass 2: a correction drops the defaulted mark of a value touched while correcting; a changed value is never marked', () => {
  const p = mkPatient();
  applyObservations(p, iso(3), { supportive: { companion: 'N', painRelief: 'Y', oralFluid: 'Y', posture: 'upright' } }, LCG, { by: 'TE' });
  const alone = p.alerts.find(a => a.code === 'no_companion');
  const all = ['companion', 'painRelief', 'oralFluid', 'posture'];
  const tapped = applyObservations(p, iso(2), { supportive: { companion: 'Y', painRelief: 'Y', oralFluid: 'Y', posture: 'upright' } }, LCG,
    { by: 'TE', defaulted: { supportive: all } }).obs[0];
  assert.equal(alone.resolved, false, 'the defaults are no evidence');
  // correcting the entry she re-taps Y for the companion and changes pain relief;
  // the posture is changed with no touch reported, oral fluid left as it was
  const fixed = correctObservation(p, tapped.id, { companion: 'Y', painRelief: 'N', oralFluid: 'Y', posture: 'lateral' }, LCG,
    { by: 'TE', reason: 'wrong posture', at: iso(1.9), touched: ['companion', 'painRelief'] }).obs[0];
  assert.deepEqual(fixed.defaulted, ['oralFluid'], 'only the value nobody touched or changed stays a default');
  assert.deepEqual([alone.resolved, alone.resolvedHow, alone.resolvedByObs], [true, 'evidence', fixed.id], 'her Y is evidence');
  // nothing touched: the unchanged defaults keep their mark, as before
  const again = correctObservation(p, fixed.id, { companion: 'Y', painRelief: 'N', oralFluid: 'Y', posture: 'MO' }, LCG,
    { by: 'TE', reason: 'posture code', at: iso(1.8) }).obs[0];
  assert.deepEqual(again.defaulted, ['oralFluid']);
});
