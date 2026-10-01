import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getProtocol, dueList, lineStatus, babyWatched, LIMITS, CLOSE_FHR_CODES, afterBirthEntry, postpartumBPCount,
} from '../js/protocol.js';
import { NOW, iso, mkPatient } from './helpers.mjs';

test('LCG: FHR every 30 min is overdue after 60 min; exam every 4 h is overdue after 5 h', () => {
  const settings = { protocol: 'lcg' };
  const p = mkPatient();
  p.obs.push({ id: '1', type: 'baby', time: iso(1), v: { fhr: 140 } });
  const due = dueList(p, getProtocol(settings, p), NOW);
  assert.equal(due.find(d => d.type === 'baby').state, 'overdue');
  assert.equal(due.find(d => d.type === 'exam').state, 'overdue');
});

test('LCG: nothing is due right after a full set of observations', () => {
  const settings = { protocol: 'lcg' };
  const p = mkPatient();
  for (const type of ['baby', 'contractions', 'pulse', 'vitals', 'exam', 'supportive']) {
    p.obs.push({ id: type, type, time: iso(0), v: {} });
  }
  const due = dueList(p, getProtocol(settings, p), NOW);
  assert.ok(due.every(d => d.state === 'ok'), JSON.stringify(due));
});

test('ethiopia2021: active phase at 4 cm and alert/action line geometry', () => {
  const settings = { protocol: 'ethiopia2021' };
  const p = mkPatient();
  const proto = getProtocol(settings, p);
  assert.equal(proto.activeStartCm, 4);
  assert.equal(lineStatus(proto, p, 9, NOW.toISOString()), 'left');
  assert.equal(lineStatus(proto, p, 6, NOW.toISOString()), 'alert');
  assert.equal(lineStatus(proto, p, 4, NOW.toISOString()), 'action');
});

test('unknown protocol id falls back to LCG', () => {
  assert.equal(getProtocol({ protocol: 'nope' }, mkPatient()).id, 'lcg');
});

test('getProtocol prefers patient.protocolId over the live settings.protocol (S2: a later Settings change must not retroactively change a case already in progress)', () => {
  const settings = { protocol: 'ethiopia2021' };
  const p = mkPatient({ protocolId: 'lcg' });
  assert.equal(getProtocol(settings, p).id, 'lcg');
});

test('getProtocol falls back to protocolOverride when protocolId is absent, then to settings.protocol', () => {
  const settings = { protocol: 'ethiopia2021' };
  assert.equal(getProtocol(settings, mkPatient({ protocolOverride: 'lcg' })).id, 'lcg');
  assert.equal(getProtocol(settings, mkPatient()).id, 'ethiopia2021');
});

// ------------------------------- M6: closer FHR while an alert asks for it ----
// Thick meconium says "monitor FHR every 15 min" and an abnormal FHR or
// decelerations "re-check FHR in 5-15 minutes"; the schedule used to stay at
// 30 min in the active first stage and the header said all was up to date.

/** The FHR item of the due list, 20 min after the last FHR (140), with these alerts. */
function fhrDue(extra = {}, alerts = []) {
  const p = mkPatient({ ...extra, alerts });
  p.obs.push({ id: 'f', type: 'baby', time: iso(20 / 60), v: { fhr: 140 } });
  return dueList(p, getProtocol({ protocol: 'lcg' }, p), NOW).find(d => d.type === 'baby');
}
const open = code => ({ id: code, code, severity: 'danger', resolved: false, ack: false });

test('M6: the FHR is due every 15 min while an alert asks for closer FHR monitoring, every 30 min without', () => {
  assert.equal(LIMITS.fhrCloseMin, 15);
  const calm = fhrDue();
  assert.deepEqual([calm.intervalMin, calm.state], [30, 'ok'], 'no alert: up to date 20 min after the last FHR');
  for (const code of CLOSE_FHR_CODES) {
    const d = fhrDue({}, [open(code)]);
    assert.deepEqual([d.intervalMin, d.state], [LIMITS.fhrCloseMin, 'due'], code);
    assert.equal(fhrDue({}, [{ ...open(code), ack: true }]).intervalMin, LIMITS.fhrCloseMin, `${code}: acknowledged, still open`);
    assert.equal(fhrDue({}, [{ ...open(code), resolved: true }]).intervalMin, 30, `${code}: closed, the stage interval is back`);
  }
  assert.equal(fhrDue({}, [open('liquor_mec'), open('liquor_blood'), open('htn'), open('prom_long')]).intervalMin, 30,
    'other alerts leave the FHR interval alone');
});

test('M6: the second stage keeps its own FHR interval; the latent phase is shortened too', () => {
  assert.equal(fhrDue({ status: 'second', secondStageStart: iso(1) }, [open('fhr_abn')]).intervalMin, 5);
  assert.equal(fhrDue({ status: 'second', secondStageStart: iso(1) }).intervalMin, 5);
  assert.equal(fhrDue({ status: 'latent', activeStartTime: null }).intervalMin, 60);
  assert.equal(fhrDue({ status: 'latent', activeStartTime: null }, [open('liquor_thick_mec')]).intervalMin, LIMITS.fhrCloseMin);
  // after the birth the postpartum watch keeps its own schedule
  const born = mkPatient({ status: 'delivered', delivery: { time: iso(0.5), outcome: 'live', ppVitals: {} }, alerts: [open('decel')] });
  assert.equal(dueList(born, getProtocol({ protocol: 'lcg' }, born), NOW).find(d => d.type === 'baby'), undefined);
});

// ------------------------------- M6: an entry at the birth itself ----
// The birth form stores a birth typed in the minute of the last labour entry
// at that entry's own time: an entry at the birth itself was made in labour.

test('M6: at the birth itself a postpartum check counts as after it, a labour entry does not', () => {
  const birth = iso(1);
  assert.equal(afterBirthEntry({ type: 'ppMother', time: birth }, birth), true);
  assert.equal(afterBirthEntry({ type: 'bloodloss', time: birth }, birth), true);
  assert.equal(afterBirthEntry({ type: 'vitals', time: birth }, birth), false);
  assert.equal(afterBirthEntry({ type: 'event', time: birth }, birth), false);
  assert.equal(afterBirthEntry({ type: 'vitals', time: iso(0.9) }, birth), true, 'later: after it');
  assert.equal(afterBirthEntry({ type: 'ppMother', time: iso(1.1) }, birth), false, 'earlier: never');
  // a labour BP at the birth itself is not the postpartum BP; a mother check then is
  const p = mkPatient({ status: 'delivered', delivery: { time: birth, outcome: 'live', ppVitals: {} } });
  p.obs.push({ id: 'v', type: 'vitals', time: birth, v: { sys: 120, dia: 80 } });
  assert.equal(postpartumBPCount(p), 0);
  p.obs.push({ id: 'm', type: 'ppMother', time: birth, v: { sys: 118, dia: 76 } });
  assert.equal(postpartumBPCount(p), 1);
});

test('babyWatched: the baby is watched unless the birth record says stillbirth', () => {
  assert.equal(babyWatched(mkPatient()), true, 'no birth recorded');
  assert.equal(babyWatched(mkPatient({ delivery: null })), true);
  assert.equal(babyWatched(mkPatient({ delivery: { time: iso(1), outcome: 'live' } })), true);
  assert.equal(babyWatched(mkPatient({ delivery: { time: iso(1), outcome: 'sb_macerated' } })), false);
  assert.equal(babyWatched(mkPatient({ delivery: { time: iso(1), outcome: 'sb_fresh' } })), false);
});
