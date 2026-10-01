// Chart (M2, M4): chartSVG() is pure and never draws voided entries or
// anything after the birth. The LCG layout mirrors the WHO sheet: P when
// pushing began (F2), O descent on its own grid (F14), each value meeting the
// ALERT column circled red until its alert is acknowledged, then grey, and a
// new sheet for every 12 hours of the active first stage (F6). The Ethiopian
// partograph keeps its alert line at the admission dilatation (S7).
import test from 'node:test';
import assert from 'node:assert/strict';
import { chartSVG, sheetCount, printSheetsHTML, chartSheet, selectChartSheet } from '../js/chart.js';
import { LIMITS } from '../js/protocol.js';
import { applyObservations, voidObservation } from '../js/record.js';
import { APP_TZ } from '../js/ui.js';
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
  const entered = hAgo => ({ by: 'TE', enteredAt: iso(hAgo) });
  const { obs: [fast], added: [alert] } = applyObservations(p, iso(2), { baby: { fhr: 172 } }, LCG, entered(2));
  const { obs: [slow] } = applyObservations(p, iso(1), { baby: { fhr: 104 } }, LCG, entered(1));
  applyObservations(p, iso(3), { baby: { fhr: 140 } }, LCG, entered(0.95));
  assert.equal(alert.code, 'fhr_abn');
  let svg = svgOf(p);
  assert.match(svg, new RegExp(`class="flag-circle" data-id="${fast.id}"[^>]*stroke="#c62828"`));
  assert.equal((svg.match(/class="flag-circle/g) || []).length, 2, 'only the two abnormal values are circled');
  Object.assign(alert, { ack: true, action: 'Left lateral, fluids', actionTime: iso(0.9), ackBy: 'TE' });
  svg = svgOf(p);
  assert.match(svg, new RegExp(`class="flag-circle ack" data-id="${fast.id}"[^>]*stroke="#9aa5a2"[^>]*stroke-dasharray`));
  // the 104 joined the same open alert, so it is acknowledged with it
  assert.ok(svg.includes(`class="flag-circle ack" data-id="${slow.id}"`));
  // a finding whose own alert still waits stays red
  const { obs: [late], added: [decel] } = applyObservations(p, iso(0.5), { baby: { fhr: 150, decel: 'late' } }, LCG, entered(0.5));
  assert.equal(decel.code, 'decel');
  assert.ok(svgOf(p).includes(`class="flag-circle" data-id="${late.id}"`));
});

test('after an acknowledgement a new abnormal value stays solid red until acknowledged again; the earlier one stays grey', () => {
  const p = mkPatient();
  const { obs: [first], added: [alert] } = applyObservations(p, iso(2), { baby: { fhr: 172 } }, LCG, { by: 'TE', enteredAt: iso(2) });
  Object.assign(alert, { ack: true, action: 'monitoring', actionTime: iso(1.9), ackBy: 'TE' });
  const r = applyObservations(p, iso(1.5), { baby: { fhr: 170 } }, LCG, { by: 'TE', enteredAt: iso(1.5) });
  assert.deepEqual(r.added, [alert], 'the repeat asks for acknowledgement again');
  const later = r.obs[0];
  let svg = svgOf(p);
  assert.match(svg, new RegExp(`class="flag-circle ack" data-id="${first.id}"[^>]*stroke="#9aa5a2"[^>]*stroke-dasharray`));
  const open = svg.match(new RegExp(`<ellipse class="flag-circle" data-id="${later.id}"[^>]*>`));
  assert.ok(open, 'the later value is circled as open');
  assert.match(open[0], /stroke="#c62828"/);
  assert.ok(!open[0].includes('stroke-dasharray'), 'an open circle is solid, not dashed');
  Object.assign(alert, { ack: true, actionTime: iso(1.4) });
  svg = svgOf(p);
  assert.ok(svg.includes(`class="flag-circle ack" data-id="${later.id}"`), 'grey once acknowledged again');
  assert.ok(svg.includes(`class="flag-circle ack" data-id="${first.id}"`));
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
    `&lt;${L.contractions.durLow}, &gt;${L.contractions.durHigh}`,
    `&lt;${L.temp.low.toFixed(1)}, &gt;=${L.temp.high.toFixed(1)}`,
  ]) assert.ok(crit.includes(want), `${want} in ${crit.join(' | ')}`);
  // the values of this release, so a wrong LIMITS edit shows up here too
  for (const want of ['&lt;20, &gt;60', '&lt;35.0, &gt;=37.5']) assert.ok(crit.includes(want), want);
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

test('every FHR beyond the band is written out with an arrow; readings in one cell stack, never overprint', () => {
  const p = mkPatient();
  p.obs.push(
    { id: 'lo', type: 'baby', time: iso(3), v: { fhr: 65 } },
    { id: 'lo2', type: 'baby', time: iso(2.9), v: { fhr: 70 } }, // same half-hour cell as 65: one cell label would hide it
    { id: 'hi', type: 'baby', time: iso(2), v: { fhr: 215 } },
    { id: 'ok', type: 'baby', time: iso(1), v: { fhr: 140 } },
  );
  const svg = svgOf(p);
  const off = id => {
    const m = svg.match(new RegExp(`class="fhr-off" data-id="${id}"><path d="M[\\d.]+,([\\d.]+)L[\\d.]+,[\\d.]+L[\\d.]+,([\\d.]+)Z"`
      + `[^>]*/><text x="([\\d.]+)" y="([\\d.]+)"[^>]*>([^<]*)<`));
    return m && { dir: Math.sign(Number(m[2]) - Number(m[1])), x: Number(m[3]), y: Number(m[4]), text: m[5] };
  };
  const [lo, lo2, hi] = ['lo', 'lo2', 'hi'].map(off);
  assert.deepEqual([lo.text, lo2.text, hi.text], ['65', '70', '215']);
  assert.deepEqual([lo.dir, lo2.dir, hi.dir], [1, 1, -1], 'the arrow points off the band: down below it, up above it');
  assert.ok(Math.abs(lo.x - lo2.x) < 1 && lo2.y - lo.y >= 7, 'one cell: stacked, the older reading on top');
  const band = rectOf(svg, 'fhr-band');
  assert.ok(lo2.y < band.y + band.h - 5 && hi.y > band.y + 5, 'written inside the band, off its edges');
  assert.equal(off('ok'), null, 'a value on the scale needs no arrow');
  const cellLabels = [...svg.matchAll(/class="fhr-v"[^>]*>([^<]*)</g)].map(m => m[1]);
  assert.deepEqual(cellLabels, ['140'], 'an off-scale value is not written twice');
  assert.ok(svgOf(p, ETH).includes('class="fhr-off" data-id="lo"'), 'the partograph writes it out too');
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

// ------------------------------------------------ M4 review pass 1 + walk --

const clock = t => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: APP_TZ });
const allText = (svg, cls) => [...svg.matchAll(new RegExp(`class="${cls}"[^>]*>([^<]*)<`, 'g'))].map(m => m[1]);

test('latent panel: each column is labelled with the time it spans; a cell merging values shows +n, flagged first', () => {
  // 9 h of latent labour squeezed into three 3-hour columns (90-minute cells)
  const p = mkPatient({ createdAt: iso(10), admission: { time: iso(10) }, activeStartTime: iso(1) });
  p.obs.push(
    { id: 's1', type: 'supportive', time: iso(9.9), v: { companion: 'Y' }, flags: [] },
    { id: 's2', type: 'supportive', time: iso(9.5), v: { companion: 'N' }, flags: ['no_companion'] },
    { id: 's3', type: 'supportive', time: iso(9), v: { companion: 'Y' }, flags: [] },
    // two entries in one half-hour cell of the active stage: the form's own cell, no +n there
    { id: 'a1', type: 'supportive', time: iso(0.9), v: { companion: 'Y' }, flags: [] },
    { id: 'a2', type: 'supportive', time: iso(0.8), v: { companion: 'Y' }, flags: [] },
  );
  const svg = svgOf(p);
  assert.deepEqual(allText(svg, 'pre-from'), [iso(10), iso(7), iso(4)].map(clock));
  assert.deepEqual(allText(svg, 'pre-to'), [iso(7), iso(4), iso(1)].map(t => `to ${clock(t)}`));
  assert.deepEqual(texts(svg, 'v', 's2'), ['N'], 'the flagged value wins its cell');
  assert.deepEqual([texts(svg, 'v', 's1'), texts(svg, 'v', 's3')], [[], []]);
  assert.deepEqual(texts(svg, 'merged', 's2'), ['+2']);
  assert.equal(allText(svg, 'merged').length, 1, 'no +n in the active stage');
});

test('latent dilatation numbers: one per cell, never overprinted', () => {
  const p = mkPatient({ createdAt: iso(40), admission: { time: iso(40) }, activeStartTime: null, status: 'latent' });
  p.obs.push(
    { id: 'x1', type: 'exam', time: iso(39), v: { dilatation: 2 }, flags: [] },
    { id: 'x2', type: 'exam', time: iso(35), v: { dilatation: 3 }, flags: [] }, // 40 h in 6 cells: same cell as x1
  );
  const svg = svgOf(p);
  assert.deepEqual(allText(svg, 'dil-num'), ['3'], 'the latest');
  assert.deepEqual(texts(svg, 'merged', 'x2'), ['+1']);
});

test('pushing and birth in the same minute: the P is drawn; nothing from the minute after the birth is', () => {
  const p = inSecondStage();
  const birth = iso(0.5); // entered to the minute
  Object.assign(p, { status: 'delivered', delivery: { time: birth, mode: 'svd', outcome: 'live' } });
  const at = ms => new Date(Date.parse(birth) + ms).toISOString();
  p.obs.push(
    { id: 'ev1', type: 'event', time: at(25000), v: { event: 'pushing' } },
    { id: 'b59', type: 'baby', time: at(59000), v: { fhr: 150 } },
    { id: 'b60', type: 'baby', time: at(60000), v: { fhr: 150 } },
  );
  const svg = svgOf(p);
  assert.ok(svg.includes('class="p-marker"'), 'P in the birth minute');
  assert.ok(svg.includes('class="birth-marker"'));
  assert.ok(svg.includes('data-id="b59"'));
  assert.ok(!svg.includes('data-id="b60"'), 'the minute after the birth is after it');
  assert.ok(svgOf(p, ETH).includes('class="p-marker"'), 'the partograph draws the P too');
});

test('F6: an entry at exactly active + 12 h is drawn once, at the end of sheet 1', () => {
  const count = svg => (svg.match(/class="fhr-pt" data-id="edge"/g) || []).length;
  const p = mkPatient({ createdAt: iso(13), admission: { time: iso(13) }, activeStartTime: iso(13) });
  p.obs.push({ id: 'edge', type: 'baby', time: iso(1), v: { fhr: 150 } });
  assert.equal(sheetCount(p, NOW), 2);
  const one = svgOf(p, LCG, { sheet: 1 });
  assert.deepEqual([count(one), count(svgOf(p, LCG, { sheet: 2 }))], [1, 0]);
  const panel = one.match(/class="panel panel-first" data-from="[^"]+" x="([\d.]+)" y="[\d.]+" width="([\d.]+)"/);
  assert.equal(num(one, /class="fhr-pt" data-id="edge" cx="([\d.]+)"/), Number(panel[1]) + Number(panel[2]), 'on the last hour line');
  // a stage of exactly 12 h is one sheet, and the entry is on it
  const q = mkPatient({ createdAt: iso(12), admission: { time: iso(12) }, activeStartTime: iso(12) });
  q.obs.push({ id: 'edge', type: 'baby', time: iso(0), v: { fhr: 150 } });
  assert.equal(sheetCount(q, NOW), 1);
  assert.equal(count(svgOf(q)), 1);
});

test('F2/F6: on a continuation sheet the second-stage panel carries the P; sheet 1 has neither', () => {
  const p = mkPatient({
    createdAt: iso(15), admission: { time: iso(15) }, activeStartTime: iso(15),
    status: 'second', secondStageStart: iso(1.5),
  });
  p.obs.push({ id: 'e10', type: 'exam', time: iso(1.5), v: { dilatation: 10 } });
  p.obs.push({ id: 'ev1', type: 'event', time: iso(1), v: { event: 'pushing' } });
  const one = svgOf(p, LCG, { sheet: 1 }), two = svgOf(p, LCG, { sheet: 2 });
  assert.ok(!one.includes('class="p-marker"'));
  const panel = two.match(/class="panel panel-second" data-from="([^"]+)" x="([\d.]+)" y="[\d.]+" width="([\d.]+)"/);
  assert.equal(panel[1], iso(1.5));
  const x = num(two, /class="p-marker"><line x1="([\d.]+)"/);
  assert.ok(x > Number(panel[2]) && x < Number(panel[2]) + Number(panel[3]), 'the P sits in the second-stage panel');
});

test('F6: a birth in hour 14 with no 10 cm exam is marked on sheet 2 only', () => {
  const p = mkPatient({
    createdAt: iso(15), admission: { time: iso(15) }, activeStartTime: iso(15),
    status: 'delivered', delivery: { time: iso(1), mode: 'svd', outcome: 'live' },
  });
  p.obs.push({ id: 'e1', type: 'exam', time: iso(15), v: { dilatation: 5 } });
  assert.equal(sheetCount(p, NOW), 2);
  assert.ok(svgOf(p, LCG, { sheet: 2 }).includes('class="birth-marker"'));
  assert.ok(!svgOf(p, LCG, { sheet: 1 }).includes('class="birth-marker"'));
  assert.ok(svgOf(p).includes('class="birth-marker"'), 'the newest sheet by default');
});

test('LCG limit bar: from reaching the current dilatation to its time limit; none once the second stage starts', () => {
  const p = mkPatient(); // active first stage from iso(5)
  p.obs.push({ id: 'e1', type: 'exam', time: iso(4), v: { dilatation: 5 } });
  let svg = svgOf(p);
  const bar = svg.match(/<line x1="([\d.]+)" y1="[\d.]+" x2="([\d.]+)"[^>]*class="limit-bar"/);
  assert.ok(bar, 'the bar is drawn');
  const panel = svg.match(/class="panel panel-first" data-from="[^"]+" x="([\d.]+)" y="[\d.]+" width="([\d.]+)"/);
  const perHour = Number(panel[2]) / 12;
  assert.equal(Number(bar[1]), Number(panel[1]) + perHour, 'from 5 cm, reached 1 h into the stage');
  assert.equal(Number(bar[2]) - Number(bar[1]), 6 * perHour, 'the 6-hour limit at 5 cm');
  assert.match(svg, />limit 6h at 5 cm</);
  p.obs.push({ id: 'e2', type: 'exam', time: iso(1), v: { dilatation: 7 } });
  svg = svgOf(p);
  assert.match(svg, />limit 3h at 7 cm</);
  assert.ok(!svg.includes('at 5 cm<'), 'only the current dilatation has a limit');
  assert.ok(!svgOf(inSecondStage()).includes('class="limit-bar"'));
});

test('the sheet picked on the chart tab is kept; picking the newest follows labour', () => {
  const p = mkPatient({ id: 'pick', createdAt: iso(30), admission: { time: iso(30) }, activeStartTime: iso(30) });
  const later = new Date(+NOW + 7 * 3600000);
  assert.deepEqual([sheetCount(p, NOW), sheetCount(p, later)], [3, 4]);
  assert.equal(chartSheet(p, NOW), 3, 'the newest by default');
  selectChartSheet(p, 1, NOW);
  assert.deepEqual([chartSheet(p, NOW), chartSheet(p, later)], [1, 1], 'a picked sheet stays');
  selectChartSheet(p, 3, NOW);
  assert.equal(chartSheet(p, later), 4, 'the newest follows labour onto a new sheet');
  selectChartSheet(p, 2, NOW);
  const shorter = { ...p, activeStartTime: iso(10) }; // e.g. a mistyped active start corrected
  assert.equal(chartSheet(shorter, NOW), 1, 'a pick past the last sheet shows the last one');
});

test('print: after the last sheet, every note and medication entry that stands is written out in full', () => {
  const long = 'Contractions weaker, 2 in 10 minutes lasting 20 seconds; bladder emptied; mobilised; reassess in one hour <b>';
  const p = mkPatient({ name: 'Almaz', mrn: 'MRN-7' });
  p.notes.push(
    { id: 'n1', time: iso(2), by: 'TE', text: long, plan: 'Augment with oxytocin if no change & call senior' },
    { id: 'n2', time: iso(1), by: 'TE', text: 'Wrong woman', plan: 'x', voided: { at: iso(0.5), by: 'TE', reason: 'wrong case' } },
  );
  p.meds.push(
    { id: 'm1', time: iso(1.5), kind: 'oxytocin', detail: '', oxyUL: 2.5, oxyDrops: 10, by: 'AB', action: 'start' },
    { id: 'm2', time: iso(3), kind: 'medicine', detail: 'Ampicillin 2 g IV stat, then 1 g IV every 6 hours', by: 'TE', action: 'given' },
  );
  const html = printSheetsHTML(p, LCG, NOW);
  const at = html.indexOf('<section class="print-notes">');
  assert.ok(at > html.lastIndexOf('<section class="print-sheet'), 'after the last sheet');
  const appendix = html.slice(at);
  assert.ok(appendix.includes('Almaz') && appendix.includes('MRN-7'), 'headed with the woman');
  assert.ok(appendix.includes(long.replace('<b>', '&lt;b&gt;')), 'the whole assessment, escaped');
  assert.ok(appendix.includes('Augment with oxytocin if no change &amp; call senior'));
  assert.ok(!appendix.includes('Wrong woman'), 'a voided note is left out');
  assert.ok(appendix.includes('<td>AB</td><td>Oxytocin</td><td>2.5 U/L, 10 drops/min</td>'));
  assert.ok(appendix.includes('Ampicillin 2 g IV stat, then 1 g IV every 6 hours'));
  assert.ok(appendix.indexOf('Ampicillin') < appendix.indexOf('2.5 U/L'), 'oldest first');
  assert.ok(!printSheetsHTML(mkPatient(), LCG, NOW).includes('print-notes'), 'no appendix without notes or medication');
});

// ------------------------------------------------------------------- M5 --

test('print: a voided medication entry is left out of the notes appendix, on both layouts', () => {
  const p = mkPatient({ name: 'Almaz', mrn: 'MRN-7' });
  const voided = { at: iso(0.5), by: 'TE', reason: 'recorded on the wrong woman' };
  p.meds.push(
    { id: 'm1', time: iso(2), kind: 'medicine', detail: 'Ampicillin 2 g IV', by: 'TE', action: 'given' },
    { id: 'm2', time: iso(1.5), kind: 'medicine', detail: 'Gentamicin 80 mg IV', by: 'TE', action: 'given', voided },
    { id: 'm3', time: iso(1), kind: 'oxytocin', detail: '', oxyUL: 5, oxyDrops: 20, by: 'AB', action: 'start', voided },
  );
  for (const settings of [LCG, ETH]) {
    const html = printSheetsHTML(p, settings, NOW);
    const at = html.indexOf('<section class="print-notes">');
    assert.ok(at > 0, 'the appendix is printed after the sheets');
    const appendix = html.slice(at);
    assert.ok(appendix.includes('<td>Ampicillin 2 g IV</td>'), 'the entry that stands is written out');
    assert.ok(!html.includes('Gentamicin') && !html.includes('5 U/L'), 'a voided medicine or oxytocin entry is printed nowhere');
    assert.equal((appendix.match(/<tr>/g) || []).length, 2, 'the header row and the one entry that stands');
  }
  const onlyVoided = mkPatient();
  onlyVoided.meds.push({ ...p.meds[1] });
  assert.ok(!printSheetsHTML(onlyVoided, LCG, NOW).includes('print-notes'), 'only voided medication: no appendix');
});

test('after a stage move every solid red circle has its alert behind it, and none is missing', () => {
  const behind = (p, svg) => [...svg.matchAll(/class="flag-circle" data-id="([^"]+)"/g)]
    .every(m => p.alerts.some(a => (a.obsIds || []).includes(m[1])));
  // two contractions in 10 minutes in latent labour, then a back-timed 5 cm exam starts active labour before them
  const p = mkPatient({ activeStartTime: null, status: 'latent' });
  const { obs: [weak] } = applyObservations(p, iso(3), { contractions: { count: 2 } }, LCG, { by: 'TE' });
  assert.ok(!svgOf(p).includes('flag-circle'));
  const { obs: [exam] } = applyObservations(p, iso(4), { exam: { dilatation: 5 } }, LCG, { by: 'TE' });
  let svg = svgOf(p);
  assert.ok(svg.includes(`class="flag-circle" data-id="${weak.id}"`), 'circled in the active first stage');
  assert.ok(behind(p, svg), 'with the weak-contraction alert behind the circle');
  voidObservation(p, exam.id, LCG, { by: 'TE', reason: 'examined the wrong woman' });
  svg = svgOf(p);
  assert.ok(!svg.includes('flag-circle'), 'latent again: not circled');
  // a mistyped 10 cm exam put a later 7 cm exam in the second stage; voiding it brings the progress limit back
  const q = mkPatient({ activeStartTime: null, status: 'latent' });
  applyObservations(q, iso(10), { exam: { dilatation: 7 } }, LCG);
  const { obs: [ten] } = applyObservations(q, iso(6), { exam: { dilatation: 10 } }, LCG);
  const { obs: [seven] } = applyObservations(q, iso(5), { exam: { dilatation: 7 } }, LCG);
  voidObservation(q, ten.id, LCG, { by: 'TE', reason: 'typed 10 for 7' });
  svg = svgOf(q);
  assert.ok(svg.includes(`class="flag-circle" data-id="${seven.id}"`), '7 cm for 5 hours is circled on its X');
  assert.ok(behind(q, svg));
});

test('an exam judged again after a stage move re-asks an alert acknowledged before it was made: red, not grey', () => {
  const p = mkPatient({ activeStartTime: null, status: 'latent' });
  const rec = (hAgo, values) => applyObservations(p, iso(hAgo), values, LCG, { by: 'TE', enteredAt: iso(hAgo) }).obs[0];
  rec(10, { exam: { dilatation: 7 } });
  const slow = rec(6.5, { exam: { dilatation: 7 } }); // 7 cm for 3.5 h: the progress alert
  const alert = p.alerts.find(a => a.code === 'lcg_progress');
  Object.assign(alert, { ack: true, action: 'senior', actionTime: iso(6.4), ackBy: 'TE' });
  const ten = rec(6, { exam: { dilatation: 10 } });    // mistyped: a second stage
  const later = rec(5, { exam: { dilatation: 7 } });   // no progress limit in the second stage
  const r = voidObservation(p, ten.id, LCG, { by: 'TE', reason: 'typed 10 for 7', at: iso(4) });
  assert.ok(r.added.includes(alert), 'asked again');
  const svg = svgOf(p);
  assert.match(svg, new RegExp(`<ellipse class="flag-circle" data-id="${later.id}"[^>]*stroke="#c62828"`), 'made after the acknowledgement');
  assert.ok(svg.includes(`class="flag-circle ack" data-id="${slow.id}"`), 'covered by the acknowledgement');
});
