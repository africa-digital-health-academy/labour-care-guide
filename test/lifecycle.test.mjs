// Alert lifecycle (S1, S12): re-arm by episode, evidence-based resolution,
// time-rule clearing, sticky findings, manual resolution.
import test from 'node:test';
import assert from 'node:assert/strict';
import { addAlerts, refreshTimeAlerts, resolveAlert } from '../js/alerts.js';
import { applyObservations } from '../js/record.js';
import { NOW, iso, mkPatient, LCG, codes } from './helpers.mjs';

const find = (p, code) => p.alerts.filter(a => a.code === code);

test('S1: an alert resolves on a normal reading and a recurrence opens episode 2, unacknowledged', () => {
  const p = mkPatient();
  applyObservations(p, iso(2), { baby: { fhr: 165 } }, LCG);
  const first = find(p, 'fhr_abn')[0];
  Object.assign(first, { ack: true, action: 'monitoring', actionTime: iso(1.9) });
  applyObservations(p, iso(1.5), { baby: { fhr: 140 } }, LCG);
  assert.equal(first.resolved, true);
  assert.equal(first.resolvedHow, 'evidence');
  const r = applyObservations(p, iso(1), { baby: { fhr: 168 } }, LCG);
  const second = r.added.find(a => a.code === 'fhr_abn');
  assert.ok(second && second !== first);
  assert.equal(second.episode, 2);
  assert.equal(second.ack, false);
});

test('while open, a repeat finding updates the alert instead of stacking a new one', () => {
  const p = mkPatient();
  applyObservations(p, iso(2), { baby: { fhr: 165 } }, LCG);
  const r = applyObservations(p, iso(1.5), { baby: { fhr: 166 } }, LCG);
  assert.deepEqual(r.added, []);
  const list = find(p, 'fhr_abn');
  assert.equal(list.length, 1);
  assert.equal(list[0].count, 2);
  assert.equal(list[0].lastSeen, iso(1.5));
  assert.equal(list[0].obsIds.length, 2);
});

test('a new abnormal reading re-opens an acknowledged open alert: unacknowledged, in added, stamped reAlertedAt', () => {
  const p = mkPatient();
  applyObservations(p, iso(2), { baby: { fhr: 165 } }, LCG, { enteredAt: iso(2) });
  const a = find(p, 'fhr_abn')[0];
  Object.assign(a, { ack: true, action: 'monitoring', actionTime: iso(1.9) });
  const r = applyObservations(p, iso(1.5), { baby: { fhr: 166 } }, LCG, { enteredAt: iso(1.4) });
  assert.deepEqual(r.added, [a]);
  assert.equal(a.ack, false);
  assert.equal(a.reAlertedAt, iso(1.4), 'when the new entry was made');
  assert.equal(a.actionTime, iso(1.9), 'the last acknowledgement is kept');
  assert.deepEqual([find(p, 'fhr_abn').length, a.count, a.episode], [1, 2, 1], 'the same alert, not a new episode');
  // not acknowledged again yet: a further repeat only counts, it is not asked twice
  const again = applyObservations(p, iso(1), { baby: { fhr: 167 } }, LCG, { enteredAt: iso(0.9) });
  assert.deepEqual(again.added, []);
  assert.deepEqual([a.count, a.reAlertedAt], [3, iso(1.4)]);
});

test('a time rule firing again on an acknowledged alert stays silent', () => {
  const p = mkPatient({ activeStartTime: iso(6) });
  p.obs.push({ id: 'e1', type: 'exam', time: iso(5.5), v: { dilatation: 6 }, flags: [] });
  const [a] = refreshTimeAlerts(p, LCG, NOW).added;
  Object.assign(a, { ack: true, action: 'monitoring', actionTime: NOW.toISOString() });
  assert.deepEqual(refreshTimeAlerts(p, LCG, new Date(+NOW + 60000)).added, []);
  assert.equal(a.ack, true);
  assert.equal(a.reAlertedAt, undefined);
});

test('a worse severity of the same code re-opens it for acknowledgement', () => {
  const p = mkPatient();
  applyObservations(p, iso(2), { pulse: { pulse: 125 } }, LCG);
  const a = find(p, 'pulse_abn')[0];
  a.ack = true;
  const r = applyObservations(p, iso(1), { pulse: { pulse: 145 } }, LCG);
  assert.deepEqual(r.added, [a]);
  assert.equal(a.severity, 'danger');
  assert.equal(a.ack, false);
});

test('S12: an alert carries the observation time, and the entry time separately', () => {
  const p = mkPatient();
  const r = applyObservations(p, iso(1), { baby: { fhr: 170 } }, LCG, { enteredAt: iso(0) });
  assert.equal(r.added[0].time, iso(1));
  assert.equal(r.added[0].raisedAt, iso(0));
});

test('an FHR warning stays open while the FHR worsens to the severe band, and both close on a normal reading', () => {
  const p = mkPatient();
  applyObservations(p, iso(2), { baby: { fhr: 165 } }, LCG);
  applyObservations(p, iso(1.5), { baby: { fhr: 185 } }, LCG);
  assert.equal(find(p, 'fhr_abn')[0].resolved, false);
  assert.equal(find(p, 'fhr_severe')[0].resolved, false);
  applyObservations(p, iso(1), { baby: { fhr: 140 } }, LCG);
  assert.equal(find(p, 'fhr_abn')[0].resolved, true);
  assert.equal(find(p, 'fhr_severe')[0].resolved, true);
});

test('thick meconium is sticky: a later clear reading does not resolve it', () => {
  const p = mkPatient();
  applyObservations(p, iso(2), { exam: { dilatation: 6, liquor: 'M3' } }, LCG);
  applyObservations(p, iso(1), { baby: { fhr: 140, liquor: 'C' } }, LCG);
  assert.equal(find(p, 'liquor_thick_mec')[0].resolved, false);
});

test('a back-timed abnormal entry older than a later normal one is raised and resolved at once', () => {
  const p = mkPatient();
  applyObservations(p, iso(1), { baby: { fhr: 140 } }, LCG);
  const r = applyObservations(p, iso(2), { baby: { fhr: 170 } }, LCG);
  const a = r.added.find(x => x.code === 'fhr_abn');
  assert.equal(a.resolved, true);
  assert.equal(a.resolvedAt, iso(1));
});

test('supportive-care alerts clear when she has a companion or declines one (Y or D)', () => {
  const p = mkPatient();
  applyObservations(p, iso(2), { supportive: { companion: 'N', painRelief: 'N', oralFluid: 'Y', posture: 'MO' } }, LCG);
  applyObservations(p, iso(1), { supportive: { companion: 'D', painRelief: 'Y', oralFluid: 'Y', posture: 'MO' } }, LCG);
  assert.equal(find(p, 'no_companion')[0].resolved, true);
  assert.equal(find(p, 'no_pain_relief')[0].resolved, true);
});

test('time alerts: a cleared condition resolves on the tick and a recurrence is a new episode', () => {
  const p = mkPatient({ activeStartTime: iso(6) });
  p.obs.push({ id: 'e1', type: 'exam', time: iso(5.5), v: { dilatation: 6 }, flags: [] });
  const t1 = refreshTimeAlerts(p, LCG, NOW);
  assert.deepEqual(codes(t1.added), ['lcg_progress_due']);
  const again = refreshTimeAlerts(p, LCG, NOW);
  assert.deepEqual(again.added, []);
  assert.equal(find(p, 'lcg_progress_due')[0].count, 1, 'a re-firing time rule does not inflate the count');
  p.obs.push({ id: 'e2', type: 'exam', time: iso(0.2), v: { dilatation: 7 }, flags: [] });
  const t2 = refreshTimeAlerts(p, LCG, NOW);
  assert.deepEqual(codes(t2.resolved), ['lcg_progress_due']);
  const t3 = refreshTimeAlerts(p, LCG, new Date(+NOW + 3.5 * 3600000));
  assert.equal(t3.added.find(a => a.code === 'lcg_progress_due').episode, 2);
});

test('manual and emergency alerts never auto-resolve; the Resolve button closes them once', () => {
  const p = mkPatient();
  const [a] = addAlerts(p, [{ code: 'emg_pph', severity: 'danger', title: 'EMERGENCY', advice: [] }], 'manual');
  refreshTimeAlerts(p, LCG, NOW);
  applyObservations(p, iso(0), { baby: { fhr: 140 } }, LCG);
  assert.equal(a.resolved, false);
  const r = resolveAlert(p, a.id, { by: 'TE', reason: 'bleeding controlled' });
  assert.equal(r, a);
  assert.equal(a.resolvedHow, 'manual');
  assert.equal(a.resolvedBy, 'TE');
  assert.equal(resolveAlert(p, a.id, { by: 'TE' }), null);
});

test('a re-asked alert shows the new value in its title', () => {
  const p = mkPatient();
  applyObservations(p, iso(2), { baby: { fhr: 165 } }, LCG);
  const a = p.alerts.find(x => x.code === 'fhr_abn');
  Object.assign(a, { ack: true, action: 'monitoring', actionTime: new Date().toISOString() });
  const r = applyObservations(p, iso(1), { baby: { fhr: 168 } }, LCG);
  assert.ok(r.added.includes(a));
  assert.match(a.title, /168/);
});
