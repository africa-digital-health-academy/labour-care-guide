// Record layer (S5): entries with author and source, void and correct with a
// reason, stage re-derivation, pushing and handover events, birth record.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyObservations, voidObservation, previewVoid, correctObservation, recordEvent, applyBirth, voidDelivery,
} from '../js/record.js';
import { addAlerts } from '../js/alerts.js';
import { PROTOCOLS, pushingStart, secondStageClockStart, isLabouring, deriveStage } from '../js/protocol.js';
import { iso, mkPatient, LCG } from './helpers.mjs';

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
