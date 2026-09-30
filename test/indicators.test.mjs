// Facility indicators (N1): WHO LCG implementation package Table 3, Robson
// groups, HMIS counts, CSV export.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  robsonGroup, computeIndicators, hmisCounts, toCSV, indicatorRows, companionWanted, countsAsStillbirth,
  stillbirthDetail, isDemo,
} from '../js/indicators.js';
import { NOW, iso, mkPatient, LCG } from './helpers.mjs';

// ------------------------------------------------------------- Robson ----

const cephalic = { time: iso(6), presentation: 'cephalic' };
const ROBSON = [
  ['1', {}],
  ['2a', { onsetMode: 'induced' }],
  ['2b', { onsetMode: 'cs_before_labour' }],
  ['3', { para: 2 }],
  ['4a', { para: 2, onsetMode: 'induced' }],
  ['4b', { para: 2, onsetMode: 'cs_before_labour' }],
  ['5', { para: 1, riskFactors: ['prior_cs'] }],
  ['6', { admission: { time: iso(6), presentation: 'breech' } }],
  ['7', { para: 1, riskFactors: ['prior_cs'], admission: { time: iso(6), presentation: 'breech' } }],
  ['8', { riskFactors: ['multiple', 'prior_cs'] }],
  ['9', { admission: { time: iso(6), presentation: 'transverse' } }],
  ['10', { para: 1, riskFactors: ['prior_cs'], gaWeeks: 34 }],
];
for (const [group, extra] of ROBSON) {
  test(`Robson group ${group}`, () => {
    const p = mkPatient({ para: 0, gaWeeks: 39, onsetMode: 'spontaneous', riskFactors: [], admission: cephalic, ...extra });
    assert.equal(robsonGroup(p), group);
  });
}

test('Robson: a vaginal breech birth is classed by the breech; missing data stays unclassified', () => {
  const base = { para: 0, gaWeeks: 39, onsetMode: 'spontaneous', riskFactors: [], admission: cephalic };
  assert.equal(robsonGroup(mkPatient({ ...base, delivery: { time: iso(1), mode: 'breech' } })), '6');
  assert.equal(robsonGroup(mkPatient({ ...base, para: null })), null);
  assert.equal(robsonGroup(mkPatient({ ...base, gaWeeks: null })), null);
  assert.equal(robsonGroup(mkPatient({ ...base, onsetMode: 'unknown' })), null);
  assert.equal(robsonGroup(mkPatient({ ...base, admission: { time: iso(6), presentation: 'other' } })), null);
});

// --------------------------------------------------------- indicators ----

const JUNE = { from: new Date(2026, 5, 1), to: new Date(2026, 6, 1) };

function birthCase(id, extra = {}) {
  return mkPatient({
    id, name: id, para: 0, gaWeeks: 39, onsetMode: 'spontaneous', protocolId: 'lcg', riskFactors: [],
    status: 'delivered', activeStartTime: iso(8),
    admission: { time: iso(8), fhr: 140, sys: 110, dia: 70, presentation: 'cephalic', companion: 'Y' },
    delivery: { time: iso(1), mode: 'svd', outcome: 'live' }, ...extra,
  });
}
function withSections(p, types = ['supportive', 'baby', 'pulse', 'contractions']) {
  const V = { supportive: { companion: p.admission.companion }, baby: { fhr: 140 }, pulse: { pulse: 84 }, contractions: { count: 3 } };
  for (const t of types) p.obs.push({ id: p.id + t, type: t, time: iso(7), v: V[t], by: 'TE', flags: [] });
  return p;
}
function fixture() {
  return [
    withSections(birthCase('A', { delivery: { time: iso(1), mode: 'svd', outcome: 'live', eblMl: 600 } })),
    withSections(birthCase('B', {
      para: 2, admission: { time: iso(8), fhr: 140, presentation: 'cephalic', companion: 'D' },
      delivery: { time: iso(1), mode: 'cs', outcome: 'live' },
    }), ['baby', 'pulse', 'contractions']),
    withSections(birthCase('C', {
      protocolId: 'ethiopia2021',
      admission: { time: iso(8), fhr: 140, sys: 120, dia: 80, presentation: 'cephalic', companion: 'N' },
      delivery: { time: iso(1), mode: 'svd', outcome: 'sb_fresh' },
    })),
    withSections(birthCase('D', {
      admission: { time: '2026-05-20T01:00:00.000Z', fhr: 140, sys: 110, dia: 70, presentation: 'cephalic', companion: 'Y' },
      delivery: { time: '2026-05-20T08:00:00.000Z', mode: 'svd', outcome: 'live' },
    })),
    withSections(birthCase('E', { demo: true })),
    mkPatient({ id: 'F', status: 'referred', referral: { time: iso(3) } }),
  ];
}

test('the six WHO Table 3 indicators on a fixture month', () => {
  const ind = computeIndicators(fixture(), { ...JUNE, settings: LCG, now: NOW });
  assert.equal(ind.births, 3, 'May birth, demo case and referral out are not counted');
  assert.deepEqual([ind.lcgUse.n, ind.lcgUse.d], [1, 3]);
  assert.deepEqual([ind.fhrOnAdmission.n, ind.fhrOnAdmission.d], [3, 3]);
  assert.deepEqual([ind.bpOnAdmission.n, ind.bpOnAdmission.d], [2, 3]);
  assert.deepEqual([ind.companion.n, ind.companion.d, ind.companion.unknown], [1, 1, 1]);
  assert.deepEqual([ind.caesarean.n, ind.caesarean.d], [1, 3]);
  assert.deepEqual(ind.caesarean.robson, { 1: { births: 2, cs: 0 }, 3: { births: 1, cs: 1 } });
  assert.deepEqual([ind.stillbirths.n, ind.stillbirths.d], [1, 3]);
  assert.equal(ind.stillbirths.intrapartum, 1);
  assert.equal(ind.stillbirths.afterAdmission, 1);
  assert.ok(Math.abs(ind.lcgUse.rate - 1 / 3) < 1e-9);
});

test('an empty month gives zero counts and null rates, never a division by zero', () => {
  const ind = computeIndicators([], { ...JUNE, settings: LCG, now: NOW });
  assert.equal(ind.births, 0);
  assert.equal(ind.lcgUse.rate, null);
  assert.equal(ind.stillbirths.rate, null);
});

test('HMIS counts: births by birth date, admissions by admission date, demo excluded', () => {
  const month = hmisCounts(fixture(), JUNE);
  assert.deepEqual(month, { admissions: 4, births: 3, live: 2, stillbirths: 1, lowApgar: 0, pph: 1, referred: 1, monitored: 2 });
  const all = hmisCounts(fixture());
  assert.equal(all.admissions, 5);
  assert.equal(all.births, 4);
});

test('companion wish: the explicit answer wins; Y = wanted, D = declined, N alone = unknown', () => {
  assert.equal(companionWanted(mkPatient({ companionWanted: false, admission: { time: iso(6), companion: 'Y' } })), false);
  assert.equal(companionWanted(mkPatient({ admission: { time: iso(6), companion: 'Y' } })), true);
  assert.equal(companionWanted(mkPatient({ admission: { time: iso(6), companion: 'D' } })), false);
  assert.equal(companionWanted(mkPatient({ admission: { time: iso(6), companion: 'N' } })), null);
});

test('stillbirth definition (28 weeks or 1000 g) and disaggregation', () => {
  const sb = extra => mkPatient({ delivery: { time: iso(1), outcome: 'sb_macerated' }, ...extra });
  assert.equal(countsAsStillbirth(sb({ gaWeeks: 26, newborn: { weightG: 800 } })), false);
  assert.equal(countsAsStillbirth(sb({ gaWeeks: 30 })), true);
  assert.equal(countsAsStillbirth(sb({ gaWeeks: 26, newborn: { weightG: 1100 } })), true);
  assert.equal(countsAsStillbirth(sb({ gaWeeks: null })), true, 'no data: counted');
  assert.deepEqual(stillbirthDetail(sb({ admission: { time: iso(6), fhr: 0 } })), { timing: 'antepartum', admission: 'before' });
  const explicit = sb({ delivery: { time: iso(1), outcome: 'sb_fresh', stillbirthTiming: 'antepartum', stillbirthAdmission: 'before' } });
  assert.deepEqual(stillbirthDetail(explicit), { timing: 'antepartum', admission: 'before' });
  assert.equal(stillbirthDetail(mkPatient({ delivery: { time: iso(1), outcome: 'live' } })), null);
});

test('demo cases are recognised by flag, MRN or name', () => {
  assert.equal(isDemo({ demo: true }), true);
  assert.equal(isDemo({ mrn: 'DEMO-001' }), true);
  assert.equal(isDemo({ name: 'DEMO - Abeba' }), true);
  assert.equal(isDemo({ name: 'Demelash' }), false);
});

// ---------------------------------------------------------------- CSV ----

const GEEZ = String.fromCharCode(0x12a0, 0x1260, 0x1260); // a Ge'ez name

test('CSV: UTF-8 byte-order mark, doubled quotes and a guard against formula injection', () => {
  const csv = toCSV([['name', 'value'], ['=HYPERLINK("x")', -5], [`${GEEZ} "A"`, null]]);
  assert.equal(csv.charCodeAt(0), 0xFEFF);
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`));
  assert.ok(csv.includes('"-5"'), 'numbers are not altered');
  assert.ok(csv.includes(`"${GEEZ} ""A"""`));
  assert.ok(csv.endsWith('""\r\n'));
});

test('indicator rows carry a header, the Robson breakdown and the stillbirth split', () => {
  const rows = indicatorRows(computeIndicators(fixture(), { ...JUNE, settings: LCG, now: NOW }));
  assert.deepEqual(rows[0], ['indicator', 'numerator', 'denominator', 'percent', 'note']);
  assert.ok(rows.some(r => r[0] === 'Caesarean rate, Robson group 3' && r[1] === 1 && r[2] === 1));
  assert.ok(rows.some(r => r[0] === 'Institutional stillbirths' && /intrapartum 1/.test(r[4])));
});
