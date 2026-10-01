// Facility indicators (N1): WHO LCG implementation package Table 3, Robson
// groups, HMIS counts, CSV export.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  robsonGroup, computeIndicators, hmisCounts, toCSV, indicatorRows, companionWanted, countsAsStillbirth,
  stillbirthDetail, isDemo,
  // M4: reporting month, export rows, birth register
  monthRange, shiftMonth, monthOf, monthKey, parseMonthKey, monthLabel, ecMonthSpan, eatStamp,
  indicatorExportRows, robsonBreakdown, registerRows, REGISTER_COLUMNS,
} from '../js/indicators.js';
import { auditCase } from '../js/audit.js';
import { getProtocol } from '../js/protocol.js';
import { EC_MONTHS_AM } from '../js/ethiopic.js';
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

test('M5: second-stage companion figure: the denominator is the women who wanted one AND reached the second stage', () => {
  const sup = (p, hAgo, companion) => p.obs.push({ id: `${p.id}-${hAgo}`, type: 'supportive', time: iso(hAgo), v: { companion }, by: 'TE', flags: [] });
  const both = birthCase('S1', { secondStageStart: iso(2) });       // a companion in both stages
  sup(both, 6, 'Y'); sup(both, 1.5, 'Y');
  const firstOnly = birthCase('S2', { secondStageStart: iso(2) });  // none in the second stage
  sup(firstOnly, 6, 'Y'); sup(firstOnly, 1.5, 'N');
  // caesarean in the first stage: wanted and had a companion, never had a second stage
  const csFirst = birthCase('S3', { delivery: { time: iso(1), mode: 'cs', outcome: 'live' } });
  sup(csFirst, 6, 'Y');
  const c = computeIndicators([both, firstOnly, csFirst], { ...JUNE, settings: LCG, now: NOW }).companion;
  assert.deepEqual([c.n, c.d], [3, 3], 'all three wanted and had a companion');
  assert.deepEqual([c.byStage.first.n, c.byStage.first.d], [3, 3]);
  assert.deepEqual([c.byStage.second.n, c.byStage.second.d], [1, 2], 'the first-stage caesarean is in neither part of the figure');
  assert.equal(c.byStage.second.rate, 0.5);
  const none = computeIndicators([csFirst], { ...JUNE, settings: LCG, now: NOW }).companion.byStage.second;
  assert.deepEqual([none.n, none.d, none.rate], [0, 0, null], 'nobody reached a second stage: no rate, never 0 %');
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

test('indicator export rows: the period and the facility in front of every row', () => {
  const ind = computeIndicators(fixture(), { ...JUNE, settings: LCG, now: NOW });
  const plain = indicatorRows(ind);
  const rows = indicatorExportRows(ind, { period: '2026-06', facility: 'Test HC' });
  assert.equal(rows.length, plain.length);
  assert.deepEqual(rows[0], ['period', 'facility', ...plain[0]]);
  for (let i = 1; i < rows.length; i++) assert.deepEqual(rows[i], ['2026-06', 'Test HC', ...plain[i]]);
  const csv = toCSV(indicatorExportRows(ind, { period: '2026-06', facility: '=cmd' }));
  assert.equal(csv.charCodeAt(0), 0xFEFF);
  assert.ok(csv.includes(`"'=cmd"`), 'formula guard on the facility name');
});

test('the Robson breakdown accounts for every birth and every caesarean, unclassified included', () => {
  const cases = [...fixture(), birthCase('U', { para: null, delivery: { time: iso(1), mode: 'cs', outcome: 'live' } })];
  const ind = computeIndicators(cases, { ...JUNE, settings: LCG, now: NOW });
  const rows = robsonBreakdown(ind.caesarean.robson);
  assert.equal(ind.births, 4);
  assert.equal(rows.reduce((n, r) => n + r.births, 0), ind.births);
  assert.equal(rows.reduce((n, r) => n + r.cs, 0), ind.caesarean.n);
  assert.deepEqual(rows[rows.length - 1], { group: 'unclassified', births: 1, cs: 1, rate: 1 });
});

test('Robson breakdown: reading order 1, 2a, 2b ... 10, unclassified last, with each group rate', () => {
  const rows = robsonBreakdown({
    10: { births: 2, cs: 1 }, unclassified: { births: 1, cs: 0 }, '2b': { births: 1, cs: 1 },
    1: { births: 4, cs: 1 }, '2a': { births: 2, cs: 0 }, 3: { births: 0, cs: 0 },
  });
  assert.deepEqual(rows.map(r => r.group), ['1', '2a', '2b', '3', '10', 'unclassified']);
  assert.deepEqual(rows[0], { group: '1', births: 4, cs: 1, rate: 0.25 });
  assert.equal(rows.find(r => r.group === '3').rate, null, 'no births: no rate, never a division by zero');
  assert.deepEqual(robsonBreakdown({}), []);
});

// ---------------------------------------------------- reporting month ----

test('monthRange: a month in East Africa Time; December runs to 1 January of the next year', () => {
  const june = monthRange(2026, 6);
  assert.equal(june.from.toISOString(), '2026-05-31T21:00:00.000Z', 'midnight EAT on 1 June');
  assert.equal(june.to.toISOString(), '2026-06-30T21:00:00.000Z', 'midnight EAT on 1 July');
  const dec = monthRange(2026, 12);
  assert.equal(dec.from.toISOString(), '2026-11-30T21:00:00.000Z');
  assert.equal(dec.to.toISOString(), '2026-12-31T21:00:00.000Z', 'midnight EAT on 1 January 2027');
  assert.equal(monthRange(2027, 1).from.toISOString(), dec.to.toISOString(), 'consecutive months meet exactly');
  for (const [y, m] of [[2026, 0], [2026, 13], [2026, 1.5], [26, 6]]) assert.throws(() => monthRange(y, m), RangeError);
});

test('shiftMonth and monthOf: year boundaries both ways; midnight EAT decides the month', () => {
  assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(shiftMonth(2027, 1, -1), { year: 2026, month: 12 });
  assert.deepEqual(shiftMonth(2026, 6, -18), { year: 2024, month: 12 });
  assert.deepEqual(shiftMonth(2026, 6, 0), { year: 2026, month: 6 });
  assert.deepEqual(monthOf(new Date('2026-06-30T21:30:00Z')), { year: 2026, month: 7 }, '00:30 EAT on 1 July');
  assert.deepEqual(monthOf(new Date('2026-06-30T20:59:59Z')), { year: 2026, month: 6 }, '23:59 EAT on 30 June');
  assert.deepEqual(monthOf('2026-12-31T21:00:00.000Z'), { year: 2027, month: 1 });
});

test('month keys: YYYY-MM both ways; anything else is not a month', () => {
  assert.equal(monthKey(2026, 6), '2026-06');
  assert.deepEqual(parseMonthKey(monthKey(2026, 12)), { year: 2026, month: 12 });
  for (const bad of ['2026-13', '2026-00', '2026-6', '26-06', 'June', '', null, undefined]) {
    assert.equal(parseMonthKey(bad), null, String(bad));
  }
  assert.equal(monthLabel(2026, 6), 'June 2026');
});

test('the Ethiopian calendar span of a Gregorian month, also across the EC new year', () => {
  assert.equal(ecMonthSpan(2026, 6), 'Ginbot 24 - Sene 23, 2018 EC');
  assert.equal(ecMonthSpan(2026, 9), 'Nehase 26, 2018 - Meskerem 20, 2019 EC', 'Pagume falls inside September');
  assert.equal(ecMonthSpan(2026, 12), 'Hidar 22 - Tahsas 22, 2019 EC');
  assert.equal(ecMonthSpan(2026, 6, 'am'), `${EC_MONTHS_AM[8]} 24 - ${EC_MONTHS_AM[9]} 23, 2018 EC`);
});

test('a birth at 01:30 EAT on 1 July counts in July, not in June', () => {
  const late = birthCase('L', { delivery: { time: '2026-06-30T22:30:00.000Z', mode: 'svd', outcome: 'live' } });
  const june = monthRange(2026, 6), july = monthRange(2026, 7);
  assert.equal(hmisCounts([late], june).births, 0);
  assert.equal(hmisCounts([late], july).births, 1);
  assert.equal(computeIndicators([late], { ...july, settings: LCG, now: NOW }).births, 1);
  assert.equal(computeIndicators(fixture(), { ...june, settings: LCG, now: NOW }).births, 3, 'the fixture month through monthRange');
});

test('register times read as the ward clock: East Africa Time with the offset', () => {
  assert.equal(eatStamp('2026-06-12T07:00:00.000Z'), '2026-06-12T10:00+03:00');
  assert.equal(eatStamp(new Date('2026-12-31T22:00:00Z')), '2027-01-01T01:00+03:00');
  assert.equal(eatStamp(null), '');
  assert.equal(eatStamp(''), '');
  assert.equal(eatStamp('not a time'), 'not a time', 'passed through, never dropped');
});

// ------------------------------------------------------------ register ----

const col = (row, name) => row[REGISTER_COLUMNS.indexOf(name)];

function registerFixture() {
  const a = withSections(birthCase('A', {
    name: 'Almaz',
    admission: { time: iso(8), fhr: 140, sys: 110, dia: 70, presentation: 'cephalic', companion: 'Y', by: 'TE' },
    delivery: { time: iso(1), mode: 'svd', outcome: 'live', eblMl: 300 },
  }));
  a.obs.push(
    { id: 'bl1', type: 'bloodloss', time: iso(0.5), v: { ml: 650, method: 'drape' }, by: 'TE', flags: [] },
    { id: 'bl2', type: 'bloodloss', time: iso(0.4), v: { ml: 2000, method: 'drape' }, by: 'TE', flags: [],
      voided: { at: iso(0.3), by: 'TE', reason: 'mistyped' } },
    { id: 'x1', type: 'pulse', time: iso(6), v: { pulse: 88 }, by: 'TE', flags: [],
      voided: { at: iso(5), by: 'TE', reason: 'wrong woman' } },
  );
  const b = withSections(birthCase('B', {
    name: 'Bethlehem', para: 2,
    admission: { time: iso(9), fhr: 140, presentation: 'cephalic', companion: 'D' },
    delivery: { time: iso(2), mode: 'cs', outcome: 'live', eblMl: 700 },
  }));
  b.obs.push(
    { id: 'bl3', type: 'bloodloss', time: iso(1.5), v: { ml: 400, method: 'drape' }, by: 'MK', flags: [], source: 'entry' },
    { id: 'adm', type: 'baby', time: iso(9), v: { fhr: 140 }, by: 'MK', flags: [], source: 'admission' },
  );
  const c = mkPatient({ id: 'C', name: 'Chaltu', para: null, protocolId: 'ethiopia2021', admission: { time: iso(3) } });
  const demo = withSections(birthCase('Dm', { demo: true, admission: { time: iso(10), fhr: 140, presentation: 'cephalic', companion: 'Y' } }));
  return { a, b, c, demo, all: [c, demo, a, b] };
}

test('birth register: the v1 columns first, then admitted_by, protocol, robson, lcg_score, voided_count, blood loss', () => {
  const rows = registerRows([], LCG, NOW);
  assert.deepEqual(rows, [REGISTER_COLUMNS]);
  assert.deepEqual(REGISTER_COLUMNS.slice(0, 3), ['admitted', 'name', 'age']);
  assert.deepEqual(REGISTER_COLUMNS.slice(-6),
    ['admitted_by', 'protocol', 'robson', 'lcg_score', 'voided_count', 'blood_loss_total_ml']);
  rows[0].push('changed');
  assert.equal(REGISTER_COLUMNS.includes('changed'), false, 'the header row is a copy');
});

test('birth register rows: admission order, demo cases left out, names kept, audit values per case', () => {
  const { a, b, c, all } = registerFixture();
  const rows = registerRows(all, LCG, NOW);
  assert.equal(rows.length, 4, 'header + three real cases; the demo case is left out');
  assert.deepEqual(rows.slice(1).map(r => col(r, 'name')), ['Bethlehem', 'Almaz', 'Chaltu'], 'oldest admission first');
  const [, rb, ra, rc] = rows;

  assert.equal(col(ra, 'admitted'), eatStamp(a.admission.time));
  assert.match(col(ra, 'admitted'), /\+03:00$/);
  assert.equal(col(ra, 'admitted_by'), 'TE', 'the admission record');
  assert.equal(col(rb, 'admitted_by'), 'MK', 'else the first admission entry');
  assert.equal(col(ra, 'protocol'), 'lcg');
  assert.equal(col(rc, 'protocol'), 'ethiopia2021', 'the case protocol, not the Settings one');
  assert.equal(col(ra, 'robson'), '1');
  assert.equal(col(rb, 'robson'), '3');
  assert.equal(col(rc, 'robson'), 'unclassified', 'parity not recorded');
  assert.equal(col(rb, 'mode'), 'cs');

  const score = p => auditCase(p, getProtocol(LCG, p), NOW).score;
  assert.equal(typeof col(ra, 'lcg_score'), 'number');
  assert.equal(col(ra, 'lcg_score'), score(a));
  assert.equal(col(rb, 'lcg_score'), score(b));
  assert.equal(col(rc, 'lcg_score'), score(c));

  assert.equal(col(ra, 'voided_count'), 2);
  assert.equal(col(ra, 'obs_count'), a.obs.length - 2, 'entries that stand');
  assert.equal(col(rb, 'voided_count'), 0);
});

test('birth register: lcg_score is empty for a case that never reached the active first stage', () => {
  const latent = mkPatient({
    id: 'L', name: 'Latent', status: 'referred', activeStartTime: null, secondStageStart: null,
    referral: { time: iso(2), reasons: [], handoverAt: iso(1.5) },
  });
  const rows = registerRows([latent], LCG, NOW);
  assert.equal(col(rows[1], 'lcg_score'), null);
  const cells = toCSV(rows).slice(1).split('\r\n')[1].split(',');
  assert.equal(cells[REGISTER_COLUMNS.indexOf('lcg_score')], '""', 'an empty CSV cell, not 0');
});

test('birth register blood loss: the larger of the measured total and the estimate; voided readings never count', () => {
  const { all } = registerFixture();
  const [, rb, ra, rc] = registerRows(all, LCG, NOW);
  assert.equal(col(ra, 'blood_loss_total_ml'), 650, 'drape 650 over an estimate of 300; the voided 2000 is ignored');
  assert.equal(col(ra, 'ebl_ml'), 300, 'the estimate column stays the estimate');
  assert.equal(col(rb, 'blood_loss_total_ml'), 700, 'estimate 700 over a drape reading of 400');
  assert.equal(col(rc, 'blood_loss_total_ml'), '', 'no birth: empty, not 0 mL');
  assert.equal(col(rc, 'delivery_time'), '');
  assert.equal(col(rc, 'referred'), 'no');
  const csv = toCSV(registerRows(all, LCG, NOW));
  assert.equal(csv.charCodeAt(0), 0xFEFF);
  assert.ok(csv.includes('"Almaz"'), 'the facility register keeps the names');
  assert.ok(!csv.includes('"Dm"'), 'no demo row');
});
