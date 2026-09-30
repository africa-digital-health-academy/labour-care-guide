// Chart (M2, M4): chartSVG() is pure and never draws voided entries or
// anything after the birth. The LCG layout mirrors the WHO sheet: P when
// pushing began (F2), O descent on its own grid (F14), each value meeting the
// ALERT column circled red until its alert is acknowledged, then grey, and a
// new sheet for every 12 hours of the active first stage (F6). The Ethiopian
// partograph keeps its alert line at the admission dilatation (S7).
import test from 'node:test';
import assert from 'node:assert/strict';
import { chartSVG, sheetCount, printSheetsHTML } from '../js/chart.js';
import { LIMITS } from '../js/protocol.js';
import { applyObservations } from '../js/record.js';
import { NOW, iso, mkPatient, LCG, ETH } from './helpers.mjs';

const svgOf = (p, settings = LCG, opts = {}) => chartSVG(p, settings, NOW, opts).svg;

/** The first number captured by `re`; fails the test when there is none. */
function num(svg, re) {
  const m = svg.match(re);
  assert.ok(m, `no match for ${re}`);
  return Number(m[1]);
}
const rectOf = (svg, cls) => {
  const m = svg.match(new RegExp(`class="${cls}" x="[\\d.]+" y="([\\d.]+)" width="[\\d.]+" height="([\\d.]+)"`));
  assert.ok(m, `no ${cls} rect`);
  return { y: Number(m[1]), h: Number(m[2]) };
};
const texts = (svg, cls, id) =>
  [...svg.matchAll(new RegExp(`class="${cls}" data-id="${id}"[^>]*>([^<]*)<`, 'g'))].map(m => m[1]);
const hours = svg => [...svg.matchAll(/class="col-hour"[^>]*>(\d+)</g)].map(m => m[1]);

test('chartSVG is pure and renders in Node', () => {
  const p = mkPatient();
  p.obs.push({ id: 'b1', type: 'baby', time: iso(1), v: { fhr: 150 } });
  const { svg, width, height, legend } = chartSVG(p, LCG, NOW);
  assert.match(svg, /^<svg/);
  assert.ok(width > 0 && height > 0);
  assert.match(legend, /LCG progress time-limit/);
  assert.ok(svg.includes('data-id="b1"'));
});

test('voided entries are not drawn: observations, medicines and notes', () => {
  const p = mkPatient();
  const voided = { at: iso(0.4), by: 'TE', reason: 'typo' };
  p.obs.push({ id: 'b1', type: 'baby', time: iso(1), v: { fhr: 150 } });
  p.obs.push({ id: 'b2', type: 'baby', time: iso(0.5), v: { fhr: 175 }, voided });
  p.meds.push({ id: 'm1', time: iso(1), kind: 'medicine', detail: 'Ampicillin 2 g IV', by: 'TE', voided });
  p.notes.push({ id: 'n1', time: iso(1), by: 'TE', text: 'Wrong woman', plan: 'none', voided });
  const svg = svgOf(p);
  assert.ok(!svg.includes('data-id="b2"'));
  assert.ok(!svg.includes('class="flag-circle'), 'the voided 175 is not circled');
  assert.ok(!svg.includes('Ampicillin') && !svg.includes('Wrong woman'));
  delete p.obs[1].voided;
  assert.ok(svgOf(p).includes('class="flag-circle" data-id="b2"'));
});

test('S7: the Ethiopian alert line starts at the admission dilatation (7 cm), not at 4 cm', () => {
  const p = mkPatient({ activeStartTime: iso(6), admission: { time: iso(6), dilatation: 7 } });
  p.obs.push({ id: 'e0', type: 'exam', time: iso(6), v: { dilatation: 7 } });
  const { svg } = chartSVG(p, ETH, NOW);
  // x = the admission column (gutter 118 px); y = the 7 cm row of the cervicograph
  assert.ok(svg.includes('class="alert-line" x1="118" y1="310"'), svg.match(/class="alert-line"[^>]*/)[0]);
});

// ------------------------------------------------------------ M4: LCG sheet --

/** Active first stage from iso(5), full dilatation at iso(1). */
function inSecondStage() {
  const p = mkPatient({ status: 'second', secondStageStart: iso(1) });
  p.obs.push({ id: 'e1', type: 'exam', time: iso(5), v: { dilatation: 5 } });
  p.obs.push({ id: 'e2', type: 'exam', time: iso(1), v: { dilatation: 10 } });
  return p;
}

test('F2: P marks when pushing began; no pushing event, no P', () => {
  const p = inSecondStage();
  assert.ok(!svgOf(p).includes('class="p-marker"'));
  p.obs.push({ id: 'ev0', type: 'event', time: iso(5.5), v: { event: 'pushing' } });
  assert.ok(!svgOf(p).includes('class="p-marker"'), 'an urge before the last exam below 10 cm is not the P');
  p.obs.push({ id: 'ev1', type: 'event', time: iso(0.5), v: { event: 'pushing' } });
  assert.ok(svgOf(p).includes('class="p-marker"'));
  assert.ok(svgOf(p, ETH).includes('class="p-marker"'), 'the partograph marks it too');
  p.obs[p.obs.length - 1].voided = { at: iso(0.4), by: 'TE', reason: 'wrong woman' };
  assert.ok(!svgOf(p).includes('class="p-marker"'), 'a voided P is not drawn');
});

test('F14: descent is an O on its own grid below the cervix grid; dilatation an X on the cervix grid', () => {
  const p = mkPatient();
  p.obs.push({ id: 'e1', type: 'exam', time: iso(4), v: { dilatation: 6, descent: 3 } });
  const svg = svgOf(p);
  const cervix = rectOf(svg, 'cervix-grid'), descent = rectOf(svg, 'descent-grid');
  const cy = num(svg, /class="descent-o" data-id="e1" cx="[\d.]+" cy="([\d.]+)"/);
  assert.ok(descent.y >= cervix.y + cervix.h, 'the descent grid is a separate row under the cervix grid');
  assert.ok(cy > descent.y && cy < descent.y + descent.h, `O at ${cy} inside the descent grid`);
  assert.ok(svg.includes('class="dil-x" data-id="e1"'));
});

test('a value meeting the ALERT column is circled red, and grey once the alert it raised is acknowledged', () => {
  const p = mkPatient();
  const { obs: [fast], added: [alert] } = applyObservations(p, iso(2), { baby: { fhr: 172 } }, LCG, { by: 'TE' });
  const { obs: [slow] } = applyObservations(p, iso(1), { baby: { fhr: 104 } }, LCG, { by: 'TE' });
  applyObservations(p, iso(3), { baby: { fhr: 140 } }, LCG, { by: 'TE' });
  assert.equal(alert.code, 'fhr_abn');
  let svg = svgOf(p);
  assert.match(svg, new RegExp(`class="flag-circle" data-id="${fast.id}"[^>]*stroke="#c62828"`));
  assert.equal((svg.match(/class="flag-circle/g) || []).length, 2, 'only the two abnormal values are circled');
  Object.assign(alert, { ack: true, action: 'Left lateral, fluids', ackBy: 'TE' });
  svg = svgOf(p);
  assert.match(svg, new RegExp(`class="flag-circle ack" data-id="${fast.id}"[^>]*stroke="#9aa5a2"`));
  // the 104 joined the same open alert, so it is acknowledged with it
  assert.ok(svg.includes(`class="flag-circle ack" data-id="${slow.id}"`));
  // a finding whose own alert still waits stays red
  const { obs: [late], added: [decel] } = applyObservations(p, iso(0.5), { baby: { fhr: 150, decel: 'late' } }, LCG, { by: 'TE' });
  assert.equal(decel.code, 'decel');
  assert.ok(svgOf(p).includes(`class="flag-circle" data-id="${late.id}"`));
});

test('F6: a 13-hour active first stage needs two sheets; sheet 2 starts at hour 12', () => {
  const p = mkPatient({ createdAt: iso(13), admission: { time: iso(13) }, activeStartTime: iso(13) });
  p.obs.push({ id: 'early', type: 'baby', time: iso(12.5), v: { fhr: 140 } });
  p.obs.push({ id: 'late', type: 'baby', time: iso(0.5), v: { fhr: 150 } });
  assert.equal(sheetCount(p, NOW), 2);
  const two = svgOf(p, LCG, { sheet: 2 });
  assert.ok(two.includes('class="sheet-2"'));
  assert.ok(two.includes(`class="panel panel-first" data-from="${iso(1)}"`), 'hour 12 of the active stage');
  assert.equal(hours(two)[0], '13');
  assert.ok(two.includes('data-id="late"') && !two.includes('data-id="early"'));
  const one = svgOf(p, LCG, { sheet: 1 });
  assert.ok(one.includes('class="sheet-1"') && one.includes(`class="panel panel-first" data-from="${iso(13)}"`));
  assert.equal(hours(one)[0], '1');
  assert.ok(one.includes('data-id="early"') && !one.includes('data-id="late"'));
  assert.ok(svgOf(p).includes('class="sheet-2"'), 'the newest sheet is shown by default');
  assert.ok(svgOf(p, LCG, { sheet: 9 }).includes('class="sheet-2"'), 'a sheet past the last one is the last one');
});

test('F6: sheetCount is max(1, ceil(active hours / 12)); the partograph is one sheet', () => {
  assert.equal(sheetCount(mkPatient({ activeStartTime: iso(12) }), NOW), 1, 'exactly 12 h fits one sheet');
  assert.equal(sheetCount(mkPatient({ activeStartTime: iso(30) }), NOW), 3);
  assert.equal(sheetCount(mkPatient({ activeStartTime: null, status: 'latent' }), NOW), 1);
  assert.equal(sheetCount(mkPatient({ activeStartTime: iso(30) }), NOW, ETH), 1);
  // the first stage ends at full dilatation: a long second stage adds no sheet
  assert.equal(sheetCount(mkPatient({ activeStartTime: iso(15), secondStageStart: iso(4) }), NOW), 1);
});

test('F6: the second-stage panel belongs to the sheet in which the second stage starts', () => {
  const p = mkPatient({
    createdAt: iso(15), admission: { time: iso(15) }, activeStartTime: iso(15),
    status: 'second', secondStageStart: iso(1.5),
  });
  p.obs.push({ id: 'b2', type: 'baby', time: iso(1), v: { fhr: 150 } });
  assert.equal(sheetCount(p, NOW), 2);
  const one = svgOf(p, LCG, { sheet: 1 }), two = svgOf(p, LCG, { sheet: 2 });
  assert.ok(two.includes(`class="panel panel-second" data-from="${iso(1.5)}"`));
  assert.ok(one.includes('class="panel panel-second" x='), 'sheet 1 keeps an empty second-stage panel');
  assert.ok(two.includes('data-id="b2"') && !one.includes('data-id="b2"'));
});

test('nothing is drawn after the birth', () => {
  const p = mkPatient({ status: 'delivered', delivery: { time: iso(2), mode: 'svd', outcome: 'live' } });
  p.obs.push({ id: 'before', type: 'baby', time: iso(3), v: { fhr: 140 } });
  p.obs.push({ id: 'after', type: 'pulse', time: iso(1), v: { pulse: 130 } });
  p.meds.push({ id: 'm1', time: iso(1.9), kind: 'medicine', detail: 'Oxytocin 10 IU IM', by: 'TE', action: 'given' });
  p.notes.push({ id: 'n1', time: iso(1), by: 'TE', text: 'Placenta complete', plan: '' });
  const svg = svgOf(p);
  assert.ok(svg.includes('data-id="before"') && !svg.includes('data-id="after"'));
  assert.ok(!svg.includes('Oxytocin 10 IU') && !svg.includes('Placenta complete'));
  assert.ok(svg.includes('class="birth-marker"') && !svg.includes('class="now-marker"'));
  // the partograph stops growing at the birth
  const later = new Date(+NOW + 20 * 3600000);
  assert.equal(chartSVG(p, ETH, later).width, chartSVG(p, ETH, NOW).width);
  // pulse 130 would sit at y = 604 + (180 - 130) on the partograph's pulse scale
  assert.ok(!chartSVG(p, ETH, NOW).svg.includes('cy="654" r="3"'), 'no pulse after the birth');
});

test('the ALERT column is written from LIMITS and FLAG', () => {
  const svg = svgOf(mkPatient());
  const crit = [...svg.matchAll(/class="alert-crit"[^>]*>([^<]*)</g)].map(m => m[1]);
  const L = LIMITS;
  for (const want of [
    `&lt;${L.fhr.low}, &gt;=${L.fhr.high}`, `&lt;${L.pulse.low}, &gt;=${L.pulse.high}`,
    `&lt;${L.sys.shock}, &gt;=${L.sys.high}`, `&gt;=${L.dia.high}`,
    `&lt;=${L.contractions.low}, &gt;${L.contractions.high}`, 'M+++, B', 'P, T', 'SP', 'N', '&gt;=6h', '&gt;=2h',
  ]) assert.ok(crit.includes(want), `${want} in ${crit.join(' | ')}`);
});

test('WHO codes: supportive Y / N / D, posture SP / MO, urine grades, fluid M+ to M+++', () => {
  const p = mkPatient();
  p.obs.push({ id: 's1', type: 'supportive', time: iso(4), v: { companion: 'D', painRelief: 'N', oralFluid: 'Y', posture: 'supine' } });
  p.obs.push({ id: 's2', type: 'supportive', time: iso(2), v: { companion: 'Y', painRelief: 'Y', oralFluid: 'Y', posture: 'lateral' } });
  p.obs.push({ id: 'v1', type: 'vitals', time: iso(3), v: { sys: 120, dia: 80, protein: '++', acetone: 'trace' } });
  p.obs.push({ id: 'x1', type: 'exam', time: iso(3), v: { dilatation: 6, liquor: 'M2', position: 'OP' } });
  const svg = svgOf(p);
  assert.deepEqual(texts(svg, 'v', 's1'), ['D', 'N', 'Y', 'SP']);
  assert.deepEqual(texts(svg, 'v', 's2'), ['Y', 'Y', 'Y', 'MO']);
  assert.deepEqual(texts(svg, 'v', 'v1'), ['120', '80', 'P++', 'Atr']);
  assert.deepEqual(texts(svg, 'v', 'x1'), ['M++', 'P']);
  const circled = [...svg.matchAll(/class="flag-circle" data-id="(\w+)"/g)].map(m => m[1]);
  assert.deepEqual(circled.sort(), ['s1', 's1', 'v1', 'x1'], 'N, SP, P++ and OP; never D, MO, trace or M++');
});

test('FHR is clamped inside its band', () => {
  const p = mkPatient();
  p.obs.push({ id: 'lo', type: 'baby', time: iso(3), v: { fhr: 40 } }, { id: 'hi', type: 'baby', time: iso(2), v: { fhr: 260 } });
  const svg = svgOf(p), band = rectOf(svg, 'fhr-band');
  for (const id of ['lo', 'hi']) {
    const cy = num(svg, new RegExp(`class="fhr-pt" data-id="${id}" cx="[\\d.]+" cy="([\\d.]+)"`));
    assert.ok(cy >= band.y && cy <= band.y + band.h, `${id} at ${cy} inside ${band.y}-${band.y + band.h}`);
  }
});

test('shared decision-making rows carry the notes (F13); initials per hour, ? when missing', () => {
  const p = mkPatient();
  p.notes.push({ id: 'n1', time: iso(3), by: 'TE', text: 'Progress normal', plan: 'Reassess in 4 h' });
  p.obs.push({ id: 'b1', type: 'baby', time: iso(3), v: { fhr: 140 }, by: 'AB' });
  p.obs.push({ id: 'b2', type: 'baby', time: iso(2), v: { fhr: 142 } });
  const svg = svgOf(p);
  assert.match(svg, /class="note-text"[^>]*><title>Progress normal<\/title>/);
  assert.match(svg, /class="plan-text"[^>]*><title>Reassess in 4 h<\/title>/);
  const initials = [...svg.matchAll(/class="initials"[^>]*>([^<]*)</g)].map(m => m[1]);
  assert.ok(initials.includes('AB/TE'), initials.join(' '));
  assert.ok(initials.includes('?'), 'an hour holding an entry without initials');
});

test('before the active first stage entries sit in the latent panel; only real alerts are circled there', () => {
  const p = mkPatient({ activeStartTime: null, status: 'latent' });
  applyObservations(p, iso(4), { exam: { dilatation: 3, descent: 4 }, contractions: { count: 2 } }, LCG, { by: 'TE' });
  const svg = svgOf(p);
  assert.ok(svg.includes('class="panel panel-pre"'));
  assert.match(svg, /class="dil-num" data-id="[^"]+"[^>]*>3</);
  assert.match(svg, /ACTIVE FIRST STAGE - starts at 5 cm/);
  assert.ok(!svg.includes('class="flag-circle'), 'two contractions in latent labour raise no alert');
});

test('print: one sheet section per sheet, each headed with the name and MRN', () => {
  const p = mkPatient({ createdAt: iso(13), admission: { time: iso(13) }, activeStartTime: iso(13), name: 'Almaz <B>', mrn: 'MRN-7' });
  const html = printSheetsHTML(p, { ...LCG, facilityName: 'Kebele 04 HC' }, NOW);
  assert.equal((html.match(/<section class="print-sheet/g) || []).length, 2);
  assert.equal((html.match(/Almaz &lt;B&gt;/g) || []).length, 2, 'the name is escaped and on every sheet');
  assert.ok(html.includes('MRN-7') && html.includes('Kebele 04 HC') && html.includes('WHO Labour Care Guide (2020)'));
  assert.ok(html.includes('class="sheet-1"') && html.includes('class="sheet-2"'));
});
