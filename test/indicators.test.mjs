// Facility indicators (N1): WHO LCG implementation package Table 3, Robson
// groups, HMIS counts, CSV export. M6: the Ethiopian reporting month and the
// report calendar (Gregorian, Both, Ethiopian).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  robsonGroup, computeIndicators, hmisCounts, toCSV, indicatorRows, companionWanted, countsAsStillbirth,
  stillbirthDetail, isDemo,
  // M4: reporting month, export rows, birth register
  monthRange, shiftMonth, monthOf, monthKey, parseMonthKey, monthLabel, eatStamp,
  indicatorExportRows, robsonBreakdown, registerRows, REGISTER_COLUMNS,
  // M6: Ethiopian month, report calendar, period columns, register of a period
  ecMonthRange, ecMonthOf, shiftEcMonth, ecMonthKey, REPORT_CALENDARS, DEFAULT_REPORT_CALENDAR, reportCalendar,
  periodCalendar, periodOf, shiftPeriod, periodRange, periodCode, periodKey, parsePeriodKey, periodIn, gregorianDays,
  exportPeriod, registerExportRows, inRegisterPeriod,
} from '../js/indicators.js';
import { auditCase } from '../js/audit.js';
import { getProtocol } from '../js/protocol.js';
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
  assert.equal(c.byStage.second.withoutDocumentedSecond, 1, 'the woman left out of the second-stage figure is counted');
  const none = computeIndicators([csFirst], { ...JUNE, settings: LCG, now: NOW }).companion.byStage.second;
  assert.deepEqual([none.n, none.d, none.rate], [0, 0, null], 'nobody reached a second stage: no rate, never 0 %');
  assert.equal(none.withoutDocumentedSecond, 1);
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
  const second = rows.find(r => r[0] === 'Companion of choice in the second stage');
  assert.ok(second && /documented second stage; \d+ who wanted one had none documented/.test(second[4]));
  assert.ok(rows.some(r => r[0] === 'Companion of choice in the first stage'));
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

// -------------------------------------- M6: the Ethiopian reporting month ----
// Ethiopian dates used below (Gregorian day in East Africa Time):
//   Sene 1, 2018 EC = 8 June 2026      Sene 30 = 7 July     Hamle 1 = 8 July 2026
//   Pagume 1, 2018 = 6 September 2026  Pagume 5 = 10 Sept   Meskerem 1, 2019 = 11 Sept 2026
//   Pagume 2015 and 2019 EC have 6 days (Meskerem 1 = 12 September 2023 / 2027)

const DAY_MS = 86400000;
const days = r => (r.to - r.from) / DAY_MS;
const LATER = new Date('2026-10-01T09:00:00Z'); // 12:00 EAT on Meskerem 21, 2019 EC

/** A real birth at the given UTC time, admitted two hours before it. */
function bornAt(id, time) {
  const adm = new Date(Date.parse(time) - 2 * 3600000).toISOString();
  return birthCase(id, {
    createdAt: adm, activeStartTime: adm,
    admission: { time: adm, fhr: 140, sys: 110, dia: 70, presentation: 'cephalic', companion: 'Y' },
    delivery: { time, mode: 'svd', outcome: 'live' },
  });
}

test('M6: an Ethiopian month runs midnight to midnight EAT: 30 days, Pagume 5 or 6, the new year in September', () => {
  const meskerem = ecMonthRange(2019, 1);
  assert.equal(meskerem.from.toISOString(), '2026-09-10T21:00:00.000Z', 'midnight EAT on Meskerem 1, 2019 (11 September 2026)');
  assert.equal(meskerem.to.toISOString(), '2026-10-10T21:00:00.000Z', 'midnight EAT on Tikimt 1 (11 October 2026)');

  const pagume2018 = ecMonthRange(2018, 13);
  assert.equal(pagume2018.from.toISOString(), '2026-09-05T21:00:00.000Z', 'midnight EAT on Pagume 1, 2018 (6 September 2026)');
  assert.equal(days(pagume2018), 5, 'a common year: 5 days');
  assert.equal(pagume2018.to.toISOString(), meskerem.from.toISOString(), 'Pagume ends where the new year begins');

  const pagume2015 = ecMonthRange(2015, 13);
  assert.equal(pagume2015.from.toISOString(), '2023-09-05T21:00:00.000Z');
  assert.equal(pagume2015.to.toISOString(), '2023-09-11T21:00:00.000Z', 'to Meskerem 1, 2016 (12 September 2023)');
  assert.equal(days(pagume2015), 6, 'a leap year: 6 days');
  assert.equal(days(ecMonthRange(2016, 13)), 5);
  assert.equal(days(ecMonthRange(2019, 13)), 6, 'the year this app reports in now ends with 6 Pagume days');

  // the 13 months of a year meet end to end: 365 days, 366 in a leap year
  for (const [year, total] of [[2018, 365], [2019, 366]]) {
    let sum = 0;
    for (let m = 1; m <= 13; m++) {
      const r = ecMonthRange(year, m);
      if (m > 1) assert.equal(r.from.toISOString(), ecMonthRange(year, m - 1).to.toISOString(), `${year}-${m}`);
      assert.equal(days(r), m < 13 ? 30 : total - 360, `${year}-${m}`);
      sum += days(r);
    }
    assert.equal(sum, total, `${year} EC`);
  }
  for (const [y, m] of [[2018, 0], [2018, 14], [2018, 1.5], [18, 1]]) assert.throws(() => ecMonthRange(y, m), RangeError);
});

test('M6: Ethiopian months step 13 to a year; the East Africa Time day decides the month', () => {
  assert.deepEqual(shiftEcMonth(2018, 12, 1), { year: 2018, month: 13 }, 'Nehase -> Pagume');
  assert.deepEqual(shiftEcMonth(2018, 13, 1), { year: 2019, month: 1 }, 'Pagume -> Meskerem of the next year');
  assert.deepEqual(shiftEcMonth(2019, 1, -1), { year: 2018, month: 13 }, 'and back');
  assert.deepEqual(shiftEcMonth(2019, 1, -13), { year: 2018, month: 1 });
  assert.deepEqual(shiftEcMonth(2018, 10, 0), { year: 2018, month: 10 });
  assert.deepEqual(ecMonthOf(new Date('2026-09-10T20:59:59Z')), { year: 2018, month: 13 }, '23:59 EAT on Pagume 5');
  assert.deepEqual(ecMonthOf(new Date('2026-09-10T21:00:00Z')), { year: 2019, month: 1 }, 'midnight EAT: Meskerem 1');
  assert.deepEqual(ecMonthOf(LATER), { year: 2019, month: 1 });
  assert.equal(ecMonthKey(2019, 1), '2019-01 EC');
  assert.equal(ecMonthKey(2018, 13), '2018-13 EC');
});

test('M6: a birth at 23:30 EAT counts in the closing Ethiopian month, one at 00:30 in the next', () => {
  const lateSene = bornAt('S', '2026-07-07T20:30:00.000Z');   // 23:30 EAT on Sene 30, 2018
  const earlyHamle = bornAt('H', '2026-07-07T21:30:00.000Z'); // 00:30 EAT on Hamle 1, 2018
  const latePagume = bornAt('P', '2026-09-10T20:30:00.000Z'); // 23:30 EAT on Pagume 5, 2018
  const newYear = bornAt('M', '2026-09-10T21:30:00.000Z');    // 00:30 EAT on Meskerem 1, 2019
  const counted = (p, y, m) => hmisCounts([p], ecMonthRange(y, m)).births;
  assert.deepEqual([counted(lateSene, 2018, 10), counted(lateSene, 2018, 11)], [1, 0], '23:30 on Sene 30: Sene');
  assert.deepEqual([counted(earlyHamle, 2018, 10), counted(earlyHamle, 2018, 11)], [0, 1], '00:30 on Hamle 1: Hamle');
  assert.deepEqual([counted(latePagume, 2018, 13), counted(latePagume, 2019, 1)], [1, 0], '23:30 on Pagume 5: Pagume');
  assert.deepEqual([counted(newYear, 2018, 13), counted(newYear, 2019, 1)], [0, 1], '00:30 on Meskerem 1: the new year');

  // admissions by admission date: admitted 22:30 on Sene 30, born 00:30 on Hamle 1
  const sene = hmisCounts([earlyHamle], ecMonthRange(2018, 10)), hamle = hmisCounts([earlyHamle], ecMonthRange(2018, 11));
  assert.deepEqual([sene.admissions, sene.births], [1, 0]);
  assert.deepEqual([hamle.admissions, hamle.births], [0, 1]);

  // the WHO indicators and the Robson table count the same month
  const all = [lateSene, earlyHamle, latePagume, newYear];
  const ind = computeIndicators(all, { ...ecMonthRange(2018, 13), settings: LCG, now: LATER });
  assert.equal(ind.births, 1);
  assert.equal(robsonBreakdown(ind.caesarean.robson).reduce((n, r) => n + r.births, 0), 1);
  assert.equal(computeIndicators(all, { ...ecMonthRange(2019, 1), settings: LCG, now: LATER }).births, 1);
});

test('M6: the same cases counted by Gregorian month and by Ethiopian month', () => {
  // births at 10:00 EAT on 5 June (Ginbot 28), 20 June (Sene 13), 3 July (Sene 26) and 10 July 2026 (Hamle 3)
  const cases = [
    bornAt('a', '2026-06-05T07:00:00.000Z'), bornAt('b', '2026-06-20T07:00:00.000Z'),
    bornAt('c', '2026-07-03T07:00:00.000Z'), bornAt('d', '2026-07-10T07:00:00.000Z'),
    { ...bornAt('demo', '2026-06-20T08:00:00.000Z'), demo: true },
  ];
  const hmis = p => hmisCounts(cases, periodRange(p)).births;
  const who = p => computeIndicators(cases, { ...periodRange(p), settings: LCG, now: LATER }).births;
  const expected = [
    [{ cal: 'gc', year: 2026, month: 6 }, 2, 'June: a, b'],
    [{ cal: 'gc', year: 2026, month: 7 }, 2, 'July: c, d'],
    [{ cal: 'ec', year: 2018, month: 9 }, 1, 'Ginbot: a'],
    [{ cal: 'ec', year: 2018, month: 10 }, 2, 'Sene: b, c'],
    [{ cal: 'ec', year: 2018, month: 11 }, 1, 'Hamle: d'],
  ];
  for (const [period, n, what] of expected) {
    assert.equal(hmis(period), n, `HMIS ${what}`);
    assert.equal(who(period), n, `WHO indicators ${what}; the demo case never counts`);
  }
});

test('M6: the report calendar is Both unless the device chose Gregorian or Ethiopian', () => {
  assert.equal(DEFAULT_REPORT_CALENDAR, 'both');
  assert.deepEqual([...REPORT_CALENDARS], ['gregorian', 'both', 'ethiopian']);
  assert.equal(reportCalendar({}), 'both', 'a device that never chose');
  assert.equal(reportCalendar(undefined), 'both');
  assert.equal(reportCalendar({ reportCalendar: 'julian' }), 'both', 'an unknown value reads as the default');
  for (const mode of REPORT_CALENDARS) assert.equal(reportCalendar({ reportCalendar: mode }), mode);
  assert.deepEqual(REPORT_CALENDARS.map(periodCalendar), ['gc', 'ec', 'ec'], 'Both and Ethiopian count Ethiopian months');
});

test('M6: periods: the current one in each calendar, steps, and the month kept when the calendar is switched', () => {
  assert.deepEqual(periodOf('gc', LATER), { cal: 'gc', year: 2026, month: 10 });
  assert.deepEqual(periodOf('ec', LATER), { cal: 'ec', year: 2019, month: 1 });
  assert.deepEqual(shiftPeriod({ cal: 'ec', year: 2019, month: 1 }, -1), { cal: 'ec', year: 2018, month: 13 });
  assert.deepEqual(shiftPeriod({ cal: 'gc', year: 2026, month: 1 }, -1), { cal: 'gc', year: 2025, month: 12 });
  assert.deepEqual(periodIn('ec', { cal: 'gc', year: 2026, month: 6 }), { cal: 'ec', year: 2018, month: 10 }, 'June -> Sene');
  assert.deepEqual(periodIn('gc', { cal: 'ec', year: 2018, month: 10 }), { cal: 'gc', year: 2026, month: 6 }, 'Sene -> June');
  assert.deepEqual(periodIn('gc', { cal: 'ec', year: 2018, month: 13 }), { cal: 'gc', year: 2026, month: 9 }, 'Pagume -> September');
  assert.deepEqual(periodIn('ec', { cal: 'gc', year: 2026, month: 9 }), { cal: 'ec', year: 2019, month: 1 }, 'September -> Meskerem');
  assert.deepEqual(periodIn('ec', { cal: 'gc', year: 2027, month: 1 }), { cal: 'ec', year: 2019, month: 5 }, 'January 2027 -> Tir');
  const sene = { cal: 'ec', year: 2018, month: 10 };
  assert.equal(periodIn('ec', sene), sene, 'the same calendar: unchanged');
  assert.deepEqual(gregorianDays(sene), { first: { year: 2026, month: 6, day: 8 }, last: { year: 2026, month: 7, day: 7 } });
  assert.deepEqual(gregorianDays({ cal: 'gc', year: 2028, month: 2 }).last, { year: 2028, month: 2, day: 29 });
});

test('M6: link keys carry the calendar; anything else is not a period', () => {
  assert.equal(periodKey({ cal: 'gc', year: 2026, month: 6 }), '2026-06');
  assert.equal(periodKey({ cal: 'ec', year: 2019, month: 1 }), '2019-01-EC', 'no space in a link or a file name');
  assert.equal(periodCode({ cal: 'ec', year: 2019, month: 1 }), '2019-01 EC');
  for (const p of [{ cal: 'gc', year: 2026, month: 12 }, { cal: 'ec', year: 2018, month: 13 }, { cal: 'ec', year: 2019, month: 1 }]) {
    assert.deepEqual(parsePeriodKey(periodKey(p)), p);
  }
  for (const bad of ['2018-14-EC', '2018-00-EC', '2026-13', '2019-01 EC', '2019-01-ec', 'EC', '', null, undefined]) {
    assert.equal(parsePeriodKey(bad), null, String(bad));
  }
});

test('M6: CSV period columns per mode: YYYY-MM, YYYY-MM EC, and in Both the Gregorian first and last day', () => {
  const june = { cal: 'gc', year: 2026, month: 6 }, meskerem = { cal: 'ec', year: 2019, month: 1 };
  assert.deepEqual(exportPeriod(june, 'gregorian'), { period: '2026-06', bounds: null });
  assert.deepEqual(exportPeriod(meskerem, 'ethiopian'), { period: '2019-01 EC', bounds: null });
  assert.deepEqual(exportPeriod(meskerem, 'both'), { period: '2019-01 EC', bounds: { start: '2026-09-11', end: '2026-10-10' } });
  assert.deepEqual(exportPeriod({ cal: 'ec', year: 2018, month: 13 }, 'both').bounds, { start: '2026-09-06', end: '2026-09-10' });
  assert.deepEqual(exportPeriod({ cal: 'ec', year: 2019, month: 13 }, 'both').bounds, { start: '2027-09-06', end: '2027-09-11' });
  assert.deepEqual(exportPeriod({ cal: 'ec', year: 2019, month: 4 }, 'both').bounds, { start: '2026-12-10', end: '2027-01-08' },
    'Tahsas crosses 1 January');

  const ind = computeIndicators(fixture(), { ...JUNE, settings: LCG, now: NOW });
  const plain = indicatorRows(ind);
  const both = indicatorExportRows(ind, { ...exportPeriod(meskerem, 'both'), facility: 'Test HC' });
  assert.deepEqual(both[0], ['period', 'facility', 'gregorian_start', 'gregorian_end', ...plain[0]]);
  for (let i = 1; i < both.length; i++) assert.deepEqual(both[i], ['2019-01 EC', 'Test HC', '2026-09-11', '2026-10-10', ...plain[i]]);
  const ethiopian = indicatorExportRows(ind, { ...exportPeriod(meskerem, 'ethiopian'), facility: 'Test HC' });
  assert.deepEqual(ethiopian[0], ['period', 'facility', ...plain[0]], 'Ethiopian only: no Gregorian date');
  assert.deepEqual(ethiopian[1], ['2019-01 EC', 'Test HC', ...plain[1]]);
  const gregorian = indicatorExportRows(ind, { ...exportPeriod(june, 'gregorian'), facility: 'Test HC' });
  assert.deepEqual(gregorian[1], ['2026-06', 'Test HC', ...plain[1]], 'Gregorian: as before M6');
  assert.ok(toCSV(both).includes('"2019-01 EC","Test HC","2026-09-11","2026-10-10"'));
});

test('M6: the register of a period lists the cases behind its counts, with the period columns at the end', () => {
  const cross = bornAt('X', '2026-07-07T21:30:00.000Z'); // admitted 22:30 EAT on Sene 30, born 00:30 on Hamle 1
  const inSene = bornAt('Y', '2026-06-20T07:00:00.000Z');
  const ginbot = bornAt('Z', '2026-06-05T07:00:00.000Z');
  const referred = mkPatient({
    id: 'R', name: 'R', createdAt: '2026-06-01T07:00:00.000Z', admission: { time: '2026-06-01T07:00:00.000Z' },
    status: 'referred', referral: { time: '2026-06-09T07:00:00.000Z', reasons: [] }, // admitted in Ginbot, referred in Sene
  });
  const demo = { ...bornAt('D', '2026-06-21T07:00:00.000Z'), demo: true };
  const all = [cross, inSene, ginbot, referred, demo];
  const sene = ecMonthRange(2018, 10);
  const name = r => r[REGISTER_COLUMNS.indexOf('name')];

  const rows = registerExportRows(all, { range: sene, ...exportPeriod({ cal: 'ec', year: 2018, month: 10 }, 'both'), settings: LCG, now: NOW });
  assert.deepEqual(rows[0], [...REGISTER_COLUMNS, 'period', 'gregorian_start', 'gregorian_end']);
  assert.deepEqual(rows.slice(1).map(name), ['R', 'Y', 'X'], 'admission order; the Ginbot birth and the demo case are not in it');
  for (const r of rows.slice(1)) assert.deepEqual(r.slice(-3), ['2018-10 EC', '2026-06-08', '2026-07-07']);
  assert.deepEqual(rows[1].slice(0, REGISTER_COLUMNS.length), registerRows([referred], LCG, NOW)[1], 'the v1 and v2 columns keep their places');

  const hamle = registerExportRows(all, { range: ecMonthRange(2018, 11), ...exportPeriod({ cal: 'ec', year: 2018, month: 11 }, 'ethiopian'), settings: LCG, now: NOW });
  assert.deepEqual(hamle[0].slice(REGISTER_COLUMNS.length), ['period'], 'Ethiopian only: the period alone');
  assert.deepEqual(hamle.slice(1).map(name), ['X'], 'born in Hamle: in the Hamle register too');
  assert.deepEqual(hamle[1].slice(REGISTER_COLUMNS.length), ['2018-11 EC']);

  const july = registerExportRows(all, { range: periodRange({ cal: 'gc', year: 2026, month: 7 }), ...exportPeriod({ cal: 'gc', year: 2026, month: 7 }, 'gregorian'), settings: LCG, now: NOW });
  assert.deepEqual(july.slice(1).map(name), ['X']);
  assert.deepEqual(july[1].slice(REGISTER_COLUMNS.length), ['2026-07']);

  assert.equal(registerRows(all, LCG, NOW).length, 5, 'without a range: every real case, as before');
  assert.equal(inRegisterPeriod(demo, sene), true, 'the screen counts the demo cases it leaves out by the same rule');
  assert.equal(inRegisterPeriod(ginbot, sene), false);
  assert.throws(() => registerExportRows(all, { period: '2018-10 EC' }), TypeError, 'a period file never holds every case');
});
