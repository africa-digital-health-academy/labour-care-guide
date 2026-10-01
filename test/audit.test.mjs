// Per-case LCG audit (N2, WHO LCG implementation package Annex 8).
import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCase, isAckNote } from '../js/audit.js';
import { PROTOCOLS } from '../js/protocol.js';
import { NOW, mkPatient } from './helpers.mjs';

const MIN = 60000;
const start = +NOW - 5 * 3600000;               // active first stage began 5 h ago
const at = m => new Date(start + m * MIN).toISOString();

// A 4-hour active first stage ending in birth, recorded at the chosen cadence.
function lcgCase({ fhrEvery = 30, supportiveEvery = 60, notesEvery = 60, unsigned = false, extra = {} } = {}) {
  const p = mkPatient({
    name: 'Audit case', para: 0, onsetMode: 'spontaneous', protocolId: 'lcg',
    admission: { time: at(0), dilatation: 5, fhr: 140, sys: 110, dia: 70 },
    status: 'delivered', activeStartTime: at(0), secondStageStart: null,
    delivery: { time: at(240), outcome: 'live', mode: 'svd' }, ...extra,
  });
  const add = (type, m, v) => p.obs.push({ id: `${type}-${m}`, type, time: at(m), v, by: 'TE', flags: [] });
  for (let m = 0; m <= 240; m += fhrEvery) add('baby', m, { fhr: 140 });
  for (let m = 0; m <= 240; m += 30) add('contractions', m, { count: 3 });
  for (let m = 0; m <= 240; m += supportiveEvery) add('supportive', m, { companion: 'Y', painRelief: 'Y', oralFluid: 'Y', posture: 'MO' });
  add('pulse', 0, { pulse: 84 });
  add('vitals', 0, { sys: 110, dia: 70 });
  add('exam', 0, { dilatation: 5 });
  for (let m = 0; m < 240; m += notesEvery) p.notes.push({ time: at(m), text: 'Normal progress', plan: 'Routine monitoring', by: 'TE' });
  if (unsigned) p.obs.find(o => o.id === 'baby-60').by = null;
  return p;
}

test('a fully recorded LCG scores 100 and counts as completed', () => {
  const a = auditCase(lcgCase(), PROTOCOLS.lcg, NOW);
  assert.equal(a.applicable, true);
  assert.equal(a.score, 100);
  assert.equal(a.completed, true);
  // 4 h ended by birth: eight 30-min cells, the last one (the 30 min before birth) included
  assert.deepEqual([a.sections.baby.met, a.sections.baby.windows], [8, 8]);
  assert.deepEqual([a.sections.supportive.met, a.sections.supportive.windows], [4, 4]);
  assert.equal(a.sections.medication, null, 'no oxytocin: not applicable');
  assert.equal(a.durations.activeMin, 240);
  assert.equal(a.durations.activeOver12h, false);
  assert.deepEqual(a.startedAt, { stage: 'active', cm: 5 });
});

test('hourly FHR, two-hourly supportive care and notes, and one unsigned entry lower the score', () => {
  const a = auditCase(lcgCase({ fhrEvery: 60, supportiveEvery: 120, notesEvery: 120, unsigned: true }), PROTOCOLS.lcg, NOW);
  assert.deepEqual([a.sections.baby.met, a.sections.baby.windows], [4, 8]);
  assert.deepEqual([a.sections.supportive.met, a.sections.supportive.windows], [2, 4]);
  assert.deepEqual([a.sections.decisions.met, a.sections.decisions.windows], [2, 4]);
  assert.deepEqual([a.sections.initials.met, a.sections.initials.windows], [4, 5]);
  assert.ok(a.score < 100);
});

test('while the stage is still running, a cell due within the grace is not yet charged', () => {
  // active stage started 2 h 35 min ago, still running; FHR every 30 min up to 2 h 30 min
  const s = +NOW - 155 * MIN;
  const t = m => new Date(s + m * MIN).toISOString();
  const p = mkPatient({ name: 'Running', para: 0, onsetMode: 'spontaneous', activeStartTime: t(0), status: 'active' });
  for (let m = 0; m <= 120; m += 30) p.obs.push({ id: 'b' + m, type: 'baby', time: t(m), v: { fhr: 140 }, by: 'TE', flags: [] });
  const a = auditCase(p, PROTOCOLS.lcg, NOW);
  // cells 0..120 are charged (all met); the 120-150 cell ended 5 min ago, inside the grace
  assert.deepEqual([a.sections.baby.met, a.sections.baby.windows], [4, 4]);
});

test('voided entries never count; defaulted values are reported, not penalised', () => {
  const p = lcgCase();
  for (const id of ['baby-30', 'baby-90']) p.obs.find(o => o.id === id).voided = { at: at(100), by: 'TE', reason: 'typo' };
  for (const o of p.obs.filter(x => x.type === 'supportive')) o.defaulted = ['companion'];
  const a = auditCase(p, PROTOCOLS.lcg, NOW);
  assert.deepEqual([a.sections.baby.met, a.sections.baby.windows], [6, 8]);
  assert.equal(a.voided, 2);
  assert.deepEqual(a.defaulted, { entries: 5, values: 5 });
  assert.equal(a.sections.supportive.rate, 1);
});

test('alert handling: acknowledged with an action within 15 minutes is timely', () => {
  const p = lcgCase();
  p.alerts = [
    { code: 'fhr_abn', severity: 'warn', time: at(60), raisedAt: at(60), ack: true, actionTime: at(70), action: 'monitoring' },
    { code: 'no_fluids', severity: 'warn', time: at(100), raisedAt: at(100), ack: true, actionTime: at(160), action: 'intervention' },
    { code: 'supine', severity: 'warn', time: at(130), raisedAt: at(130), ack: false },
    { code: 'note', severity: 'info', time: at(140), raisedAt: at(140), ack: false },
  ];
  const a = auditCase(p, PROTOCOLS.lcg, NOW);
  assert.deepEqual([a.alerts.raised, a.alerts.acknowledged, a.alerts.ackedInTime, a.alerts.actioned], [3, 2, 1, 2]);
  assert.ok(a.score < 100);
});

test('alert timeliness runs from the latest prompt: raised again by a new entry, or severity raised', () => {
  const p = lcgCase();
  p.alerts = [
    // raised at 60, acknowledged, raised again at 120 and acknowledged at 125: timely
    { code: 'fhr_abn', severity: 'warn', time: at(60), raisedAt: at(60), reAlertedAt: at(120), ack: true, actionTime: at(125), action: 'monitoring' },
    // severity raised at 100, acknowledged at 110: timely although 50 min after it was first raised
    { code: 'htn', severity: 'danger', time: at(60), raisedAt: at(60), escalatedAt: at(100), ack: true, actionTime: at(110), action: 'senior' },
    // severity raised at 100, raised again at 150, acknowledged at 180: 30 min after the latest prompt
    { code: 'pulse_abn', severity: 'danger', time: at(60), raisedAt: at(60), escalatedAt: at(100), reAlertedAt: at(150), ack: true, actionTime: at(180), action: 'senior' },
    // raised again at 200 and not acknowledged since: raised, not acknowledged
    { code: 'supine', severity: 'warn', time: at(90), raisedAt: at(90), reAlertedAt: at(200), ack: false, actionTime: at(95), action: 'monitoring' },
  ];
  const a = auditCase(p, PROTOCOLS.lcg, NOW);
  assert.deepEqual([a.alerts.raised, a.alerts.acknowledged, a.alerts.ackedInTime], [4, 3, 2]);
});

test('oxytocin records are audited hourly while the infusion runs', () => {
  const p = lcgCase({ extra: { meds: [{ id: 'ox', kind: 'oxytocin', time: at(0), action: 'start', by: 'TE' }] } });
  p.obs.push({ id: 'ox-60', type: 'oxytocin', time: at(60), v: { dropsMin: 20 }, by: 'TE', flags: [] });
  const a = auditCase(p, PROTOCOLS.lcg, NOW);
  assert.deepEqual([a.sections.medication.met, a.sections.medication.windows], [2, 4]);
});

test('header items: labour onset not recorded costs a third of the header score', () => {
  const a = auditCase(lcgCase({ extra: { onsetMode: 'unknown' } }), PROTOCOLS.lcg, NOW);
  assert.equal(a.header.onset, false);
  assert.ok(Math.abs(a.header.score - 2 / 3) < 1e-9);
});

test('not applicable before the active first stage; a partograph case is never "LCG completed"', () => {
  const latentOnly = mkPatient({ status: 'referred', activeStartTime: null, secondStageStart: null });
  const a = auditCase(latentOnly, PROTOCOLS.lcg, NOW);
  assert.equal(a.applicable, false);
  assert.equal(a.score, null);
  const eth = auditCase(lcgCase({ extra: { protocolId: 'ethiopia2021' } }), PROTOCOLS.ethiopia2021, NOW);
  assert.equal(eth.tool, 'partograph');
  assert.equal(eth.completed, false);
});

test('an LCG missing a core section is not completed', () => {
  const p = lcgCase();
  p.obs = p.obs.filter(o => o.type !== 'supportive');
  assert.equal(auditCase(p, PROTOCOLS.lcg, NOW).completed, false);
});

// ------------------------------------------------------------------- M5 --

test('acknowledgement notes (kind ack) never fill a shared decision-making column', () => {
  const p = lcgCase();
  // no assessment and plan at all: only the notes the alert acknowledgements wrote, one in every hour
  p.notes = [10, 70, 130, 190].map(m => ({
    time: at(m), kind: 'ack', by: 'TE', text: 'Alerts acknowledged: FHR 165 bpm - outside normal range', plan: 'monitoring',
  }));
  let a = auditCase(p, PROTOCOLS.lcg, NOW);
  assert.deepEqual([a.sections.decisions.met, a.sections.decisions.windows], [0, 4]);
  assert.ok(a.score < 100);
  // one assessment and plan recorded in the second hour fills that column only
  p.notes.push({ time: at(75), by: 'TE', text: 'Progress normal', plan: 'Reassess in 4 h' });
  a = auditCase(p, PROTOCOLS.lcg, NOW);
  assert.deepEqual([a.sections.decisions.met, a.sections.decisions.windows], [1, 4]);
  assert.deepEqual([a.sections.initials.met, a.sections.initials.windows], [5, 5], 'signed acknowledgement notes still count as signed entries');
});

test('acknowledgement notes saved before M5 (no kind) are recognised by their opening words', () => {
  const p = lcgCase();
  p.notes = [10, 70].map(m => ({ time: at(m), by: 'TE', text: 'Alerts acknowledged: FHR 165 bpm - outside normal range', plan: 'monitoring' }));
  p.notes.push({ time: at(130), by: 'TE', text: 'Assessment: alerts acknowledged earlier, progress now normal', plan: 'Reassess' });
  const a = auditCase(p, PROTOCOLS.lcg, NOW);
  assert.deepEqual([a.sections.decisions.met, a.sections.decisions.windows], [1, 4], 'only the real assessment counts');
  assert.equal(isAckNote({ text: 'Alerts acknowledged: x' }), true);
  assert.equal(isAckNote({ kind: 'ack', text: '' }), true);
  assert.equal(isAckNote({ text: 'Progress normal' }), false);
  assert.equal(isAckNote(null), false);
});

test('an alert closed in the same save that raised it (needsAck false) is not counted in alert handling', () => {
  const p = lcgCase();
  const t0 = at(30);
  p.alerts = [
    { id: 'a1', code: 'fhr_abn', severity: 'warn', time: t0, raisedAt: t0, ack: true, action: 'monitoring', actionTime: at(35) },
    { id: 'a2', code: 'weak_contractions', severity: 'warn', time: t0, raisedAt: t0, resolved: true, needsAck: false },
  ];
  const a = auditCase(p, PROTOCOLS.lcg, NOW);
  assert.equal(a.alerts.raised, 1, 'only the alert the midwife could handle');
  assert.equal(a.alerts.ackedInTime, 1);
});

test('the voided count covers observations, medication and notes', () => {
  const p = lcgCase();
  p.meds = [{ id: 'm1', kind: 'medicine', time: at(20), voided: { by: 'TE', reason: 'typo' } }];
  p.notes = [{ id: 'n1', time: at(25), text: 'x', voided: { by: 'TE', reason: 'typo' } }];
  const before = auditCase(p, PROTOCOLS.lcg, NOW).voided;
  p.obs[0].voided = { by: 'TE', reason: 'typo' };
  assert.equal(auditCase(p, PROTOCOLS.lcg, NOW).voided, before + 1);
  assert.ok(before >= 2, 'the voided medicine and note are counted');
});
