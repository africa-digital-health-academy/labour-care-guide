// Record layer (S5): entries with author and source, void and correct with a
// reason, stage re-derivation, pushing and handover events, birth record.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyObservations, voidObservation, previewVoid, correctObservation, recordEvent, applyBirth, voidDelivery,
  createCase, applyReferral, admissionEntries,
} from '../js/record.js';
import { addAlerts, evaluateObs, refreshTimeAlerts } from '../js/alerts.js';
import {
  PROTOCOLS, pushingStart, secondStageClockStart, isLabouring, deriveStage, awaitingHandover,
} from '../js/protocol.js';
import { CASE_SCHEMA, migrateCase, migrateAll } from '../js/migrate.js';
import { chartSVG, sheetCount } from '../js/chart.js';
import { ackIndex, flagState, ALERT_CODES } from '../js/partograph.js';
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
  chartAgrees(p, LCG);
});
