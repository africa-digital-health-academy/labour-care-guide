// Per-case LCG audit (N2, WHO LCG implementation package Annex 8).
import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCase } from '../js/audit.js';
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
  assert.deepEqual([a.sections.baby.met, a.sections.baby.windows], [7, 7]);
  assert.deepEqual([a.sections.supportive.met, a.sections.supportive.windows], [3, 3]);
  assert.equal(a.sections.medication, null, 'no oxytocin: not applicable');
  assert.equal(a.durations.activeMin, 240);
  assert.equal(a.durations.activeOver12h, false);
  assert.deepEqual(a.startedAt, { stage: 'active', cm: 5 });
});

test('hourly FHR, two-hourly supportive care and notes, and one unsigned entry lower the score', () => {
  const a = auditCase(lcgCase({ fhrEvery: 60, supportiveEvery: 120, notesEvery: 120, unsigned: true }), PROTOCOLS.lcg, NOW);
  assert.deepEqual([a.sections.baby.met, a.sections.baby.windows], [4, 7]);
  assert.deepEqual([a.sections.supportive.met, a.sections.supportive.windows], [2, 3]);
  assert.deepEqual([a.sections.decisions.met, a.sections.decisions.windows], [2, 3]);
  assert.deepEqual([a.sections.initials.met, a.sections.initials.windows], [4, 5]);
  assert.ok(a.score < 100);
});

test('voided entries never count; defaulted values are reported, not penalised', () => {
  const p = lcgCase();
  for (const id of ['baby-30', 'baby-90']) p.obs.find(o => o.id === id).voided = { at: at(100), by: 'TE', reason: 'typo' };
  for (const o of p.obs.filter(x => x.type === 'supportive')) o.defaulted = ['companion'];
  const a = auditCase(p, PROTOCOLS.lcg, NOW);
  assert.deepEqual([a.sections.baby.met, a.sections.baby.windows], [5, 7]);
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

test('oxytocin records are audited hourly while the infusion runs', () => {
  const p = lcgCase({ extra: { meds: [{ id: 'ox', kind: 'oxytocin', time: at(0), action: 'start', by: 'TE' }] } });
  p.obs.push({ id: 'ox-60', type: 'oxytocin', time: at(60), v: { dropsMin: 20 }, by: 'TE', flags: [] });
  const a = auditCase(p, PROTOCOLS.lcg, NOW);
  assert.deepEqual([a.sections.medication.met, a.sections.medication.windows], [2, 3]);
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
