// chart.js - the labour chart, drawn automatically from the entries.
//
// WHO LCG cases (M4) mirror the WHO Labour Care Guide sheet
// (_sources/lcg-form.txt): its sections in order - supportive care, baby,
// woman, labour progress, medication, shared decision-making, initials - an
// ALERT column written from FLAG / LIMITS, a 12-column active first stage and
// a 3-hour second-stage panel. Values are written in the form's codes and any
// value meeting the alert column is circled: solid red until the alert it
// raised is acknowledged after the entry, then dashed grey (flagState). X marks
// dilatation, O descent on its own grid (F14), P the start of pushing (F2);
// the assessment and plan rows carry the notes (F13). An active first stage
// longer than 12 hours continues on further sheets (F6); the second-stage
// panel belongs to the sheet in which the second stage starts. Entries before
// the active first stage sit in a narrow latent / admission panel on sheet 1.
//
// Ethiopian 2021 cases keep the partograph layout (alert and action lines
// anchored by alertLineAnchor, S7): js/partograph.js draws it, and also holds
// the drawing kit both layouts share (text and lines, the alert circles and
// their acknowledgement state, the FHR stacks beyond the scale, the print
// header and notes appendix), so neither module imports the other in a circle.
//
// chartSVG() is pure (no DOM) so it runs in the Node tests; renderChart() and
// renderPrintSheets() wrap it for the page. Voided entries are never drawn
// (S5), nothing is drawn after the birth minute (afterBirth), and every
// threshold comes from FLAG and LIMITS (S13).

import {
  getProtocol, timeReachedCurrentDilatation, activeObs, byTime, toMs, LIMITS,
  secondStagePushing, birthTime, isLabouring, isOxytocinStop,
} from './protocol.js';
import { FLAG, isSupine } from './alerts.js';
import { APP_TZ } from './ui.js';
import {
  HOUR, RED, INK, MUTED, esc, clamp, n1, own, live, idAttr, finite, hhmm, txt, ln, urineText,
  ALERT_CODES, ackIndex, flagState, ring, FHR_BAND, offBand, offScaleStacks, chartEnd, afterBirth,
  partographSVG, PARTO_LEGEND, printHead, notesAppendix,
} from './partograph.js';

export const SHEET_HOURS = 12; // the form: "if labour extends beyond 12h, continue on a new LCG" (F6)
const SECOND_H = 3;            // the form's second-stage panel, in hours

const TEAL = '#0e7a64';
const PURPLE = '#6a3fb5';
const BLUE = '#1565c0';
const GREEN = '#2e7d32';
const EDGE = '#9db8b1';
const FAMILY = 'Segoe UI, Arial, sans-serif';

const dayTime = t => `${new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: APP_TZ })} ${hhmm(t)}`;

// ------------------------------------------------------------------ sheets ----

const sheetOf = ms => Math.max(1, Math.ceil(ms / (SHEET_HOURS * HOUR)));

/**
 * LCG sheets the case needs: max(1, ceil(active first-stage hours / 12)).
 * A partograph case (settings or its stamped protocol) is one growing sheet.
 */
export function sheetCount(p, now = new Date(), settings) {
  if (getProtocol(settings, p).alertActionLines || !p.activeStartTime) return 1;
  const end = p.secondStageStart ? toMs(p.secondStageStart) : chartEnd(p, now);
  return sheetOf(end - toMs(p.activeStartTime));
}

/** The sheet in which the second stage starts (it carries the second-stage panel). */
function secondSheet(p) {
  if (!p.secondStageStart || !p.activeStartTime) return 1;
  return sheetOf(toMs(p.secondStageStart) - toMs(p.activeStartTime));
}

// ---------------------------------------------------------- LCG: layout ----

const G = { sec: 14, label: 112, alert: 56, col: 52, col2: 76, preCol: 40, gap: 6, pad: 6 };
const GX = G.label + G.alert;               // x where the time grid starts
const PRE_COLS = 3;                         // the latent / admission panel is at most 3 columns wide

// The form's rows, top to bottom: [key, label, height, section it opens]
const ROW_SPEC = [
  ['head', '', 16], ['stage', '', 13], ['time', 'Time', 12], ['hours', 'Hours', 12],
  ['companion', 'Companion', 13, 'SUPPORTIVE CARE'], ['painRelief', 'Pain relief', 13],
  ['oralFluid', 'Oral fluid', 13], ['posture', 'Posture', 13],
  ['fhr', 'Baseline FHR', 60, 'BABY'], ['decel', 'FHR deceleration', 13], ['liquor', 'Amniotic fluid', 13],
  ['position', 'Fetal position', 13], ['caput', 'Caput', 13], ['moulding', 'Moulding', 13],
  ['pulse', 'Pulse', 13, 'WOMAN'], ['sys', 'Systolic BP', 13], ['dia', 'Diastolic BP', 13],
  ['temp', 'Temperature C', 13], ['urine', 'Urine', 20],
  ['count', 'Contractions /10 min', 13, 'LABOUR PROGRESS'], ['duration', 'Duration (sec)', 13],
  ['cervix', 'Cervix [plot X]', 72], ['descent', 'Descent [plot O]', 60],
  ['oxytocin', 'Oxytocin U/L, drops', 13, 'MEDICATION'], ['medicine', 'Medicine', 18], ['ivfluid', 'IV fluids', 13],
  ['assessment', 'Assessment', 30, 'SHARED DECISION-MAKING'], ['plan', 'Plan', 30],
  ['initials', 'Initials', 13, 'INITIALS'],
];

function buildLayout() {
  const rows = {}, sections = [];
  let y = 0;
  for (const [key, label, height, section] of ROW_SPEC) {
    if (section) sections.push({ name: section, y0: y, y1: y });
    rows[key] = { key, label, y, h: height };
    y += height;
    if (sections.length) sections[sections.length - 1].y1 = y;
  }
  return { rows, sections, bottom: y, height: y + 4 };
}
const LAYOUT = buildLayout();
const ROW = LAYOUT.rows;

const cervixRows = proto => 11 - proto.activeStartCm;   // the form's grid: 10 cm down to the active start
const cmY = (proto, cm) => ROW.cervix.y + (10 - cm + 0.5) * ROW.cervix.h / cervixRows(proto);
const descY = f => ROW.descent.y + (5 - f + 0.5) * ROW.descent.h / 6;
const fhrY = v => ROW.fhr.y + 5 + (FHR_BAND.top - clamp(v, FHR_BAND.bottom, FHR_BAND.top))
  * (ROW.fhr.h - 10) / (FHR_BAND.top - FHR_BAND.bottom);

// ------------------------------------------------ LCG: codes and alert column ----

const DECEL_LBL = { none: 'N', early: 'E', variable: 'V', late: 'L', prolonged: 'Pr' };
const LIQUOR_LBL = { I: 'I', C: 'C', M1: 'M+', M2: 'M++', M3: 'M+++', B: 'B', M: 'M' };
const POSITION_LBL = { OA: 'A', OP: 'P', OT: 'T', unknown: '?' };
const PRESENTATION_LBL = { breech: 'Br', transverse: 'Tr', other: 'Oth' };
const DUR_LBL = { lt20: '<20', b20_40: '20-40', b40_60: '40-60', gt60: '>60' };
const ONSET_LBL = { spontaneous: 'spontaneous', induced: 'induced' };
const ynd = v => (v === true ? 'Y' : v === false ? 'N' : String(v));
const plus = n => (Number(n) === 0 ? '0' : '+'.repeat(clamp(Number(n) || 0, 0, 4)));
const listOf = (codes, test, lbl) => codes.filter(test).map(c => (own(lbl, c) ? lbl[c] : String(c))).join(', ');

/** The ALERT column, written from FLAG and LIMITS so it can never disagree with the engine. */
function alertTexts() {
  const L = LIMITS, U = '+'.repeat(L.urineAlertGrade);
  const yn = key => ['Y', 'N', 'D'].filter(v => FLAG.supportive(key, v)).join(', ');
  return {
    companion: yn('companion'), painRelief: yn('painRelief'), oralFluid: yn('oralFluid'),
    posture: ['SP', 'MO'].filter(v => FLAG.supportive('posture', v)).join(', '),
    fhr: `<${L.fhr.low}, >=${L.fhr.high}`,
    decel: listOf(Object.keys(DECEL_LBL), FLAG.decel, DECEL_LBL),
    liquor: listOf(['I', 'C', 'M1', 'M2', 'M3', 'B'], FLAG.liquor, LIQUOR_LBL),
    position: listOf(['OA', 'OP', 'OT'], FLAG.position, POSITION_LBL),
    caput: [0, 1, 2, 3].filter(FLAG.caput).map(plus).join(', '),
    moulding: [0, 1, 2, 3].filter(FLAG.moulding).map(plus).join(', '),
    pulse: `<${L.pulse.low}, >=${L.pulse.high}`,
    sys: `<${L.sys.shock}, >=${L.sys.high}`,
    dia: `>=${L.dia.high}`,
    temp: `<${L.temp.low.toFixed(1)}, >=${L.temp.high.toFixed(1)}`,
    urine: `P${U}, A${U}`,
    count: `<=${L.contractions.low}, >${L.contractions.high}`,
    duration: `<${L.contractions.durLow}, >${L.contractions.durHigh}`,
  };
}

// Rows written as codes, one value per cell like the paper form.
const R = (row, types, field, label, flag, more = {}) =>
  ({ row, types, field, label, flag, line: 0, lines: 1, get: o => o.v[field], ...more });
const supportive = key => R(key, ['supportive'], key, ynd, v => FLAG.supportive(key, v));
const CODE_ROWS = [
  supportive('companion'), supportive('painRelief'), supportive('oralFluid'),
  R('posture', ['supportive'], 'posture', v => (isSupine(v) ? 'SP' : 'MO'), v => FLAG.supportive('posture', v)),
  R('decel', ['baby'], 'decel', v => (own(DECEL_LBL, v) ? DECEL_LBL[v] : v), FLAG.decel),
  R('liquor', ['baby', 'exam'], 'liquor', v => (own(LIQUOR_LBL, v) ? LIQUOR_LBL[v] : v), FLAG.liquor),
  // a non-cephalic presentation takes the position cell: it is the finding that matters
  R('position', ['exam'], 'position',
    v => (own(PRESENTATION_LBL, v) ? PRESENTATION_LBL[v] : own(POSITION_LBL, v) ? POSITION_LBL[v] : v),
    v => own(PRESENTATION_LBL, v) || FLAG.position(v),
    { get: o => (o.v.presentation && o.v.presentation !== 'cephalic' ? o.v.presentation : o.v.position) }),
  R('caput', ['exam'], 'caput', plus, FLAG.caput),
  R('moulding', ['exam'], 'moulding', plus, FLAG.moulding),
  R('pulse', ['pulse'], 'pulse', String, FLAG.pulse),
  R('sys', ['vitals'], 'sys', String, FLAG.sys),
  R('dia', ['vitals'], 'dia', String, FLAG.dia),
  R('temp', ['vitals'], 'temp', v => Number(v).toFixed(1), FLAG.temp),
  R('urine', ['vitals'], 'protein', v => 'P' + urineText(v), FLAG.urine, { lines: 2 }),
  R('urine', ['vitals'], 'acetone', v => 'A' + urineText(v), FLAG.urine, { line: 1, lines: 2 }),
  R('count', ['contractions'], 'count', String, FLAG.contractionCount),
  R('duration', ['contractions'], 'duration', (v, o) => (own(DUR_LBL, o.v.durBand) ? DUR_LBL[o.v.durBand] : String(v)),
    FLAG.contractionDuration, { size: 7, get: o => (o.v.duration != null ? o.v.duration : o.v.durBand) }),
];

// ---------------------------------------------------------- LCG: panels ----

/** The time panels of one sheet: latent / admission (sheet 1 only), active first stage, second stage. */
function lcgPanels(p, now, sheet) {
  const active = p.activeStartTime ? toMs(p.activeStartTime) : null;
  const second = p.secondStageStart ? toMs(p.secondStageStart) : null;
  const end = chartEnd(p, now);
  let x = GX, pre = null;
  if (sheet === 1) {
    const adm = toMs((p.admission && p.admission.time) || p.createdAt);
    const from = Math.min(...finite([adm, end, ...activeObs(p).map(o => toMs(o.time))]));
    const to = active ?? end;
    if (active == null || from < active) {
      const cols = clamp(Math.ceil((to - from) / HOUR), 1, PRE_COLS);
      pre = { key: 'pre', x0: x, x1: x + cols * G.preCol, from, to: Math.max(to, from + 60000), cols, cells: 2 };
      x = pre.x1 + G.gap;
    }
  }
  const f0 = active == null ? null : active + (sheet - 1) * SHEET_HOURS * HOUR;
  const first = {
    key: 'first', x0: x, x1: x + SHEET_HOURS * G.col, from: f0, to: f0 == null ? null : f0 + SHEET_HOURS * HOUR,
    cols: SHEET_HOURS, cells: 2, base: (sheet - 1) * SHEET_HOURS,
  };
  x = first.x1 + G.gap;
  const here = second != null && secondSheet(p) === sheet;
  const cols2 = here ? Math.max(SECOND_H, Math.ceil((end - second) / HOUR)) : SECOND_H;
  const sec = {
    key: 'second', x0: x, x1: x + cols2 * G.col2, from: here ? second : null,
    to: here ? second + cols2 * HOUR : null, cols: cols2, cells: 4,
  };
  return { active, second, end, pre, first, sec, panels: [pre, first, sec].filter(Boolean), width: sec.x1 + G.pad };
}

const frac = (P, t) => clamp((t - P.from) / (P.to - P.from), 0, 1);
const xAt = (P, t) => P.x0 + frac(P, t) * (P.x1 - P.x0);
// integer arithmetic on the hour grid, so an entry on a boundary lands in the later cell
const slotAt = (P, t, n) => clamp(Math.floor((t - P.from) / ((P.to - P.from) / n)), 0, n - 1);
const cellAt = (P, t) => slotAt(P, t, P.cols * P.cells);
const colAt = (P, t) => slotAt(P, t, P.cols);
const cellX = (P, i) => P.x0 + (i + 0.5) * (P.x1 - P.x0) / (P.cols * P.cells);

/** The panel of this sheet that shows time t, or null (another sheet, or after the birth). */
function panelFor(ctx, t) {
  if (!Number.isFinite(t) || afterBirth(t, ctx.birth)) return null;
  if (ctx.active == null || t < ctx.active) return ctx.pre;
  if (ctx.second != null && t >= ctx.second) return ctx.sec.from == null ? null : ctx.sec;
  return sheetOf(t - ctx.active) === ctx.sheet ? ctx.first : null;
}

function locate(ctx, list) {
  const out = [];
  for (const o of list) {
    const t = toMs(o.time), P = panelFor(ctx, t);
    if (P) out.push({ o, t, P, x: xAt(P, t), cell: cellAt(P, t), col: colAt(P, t) });
  }
  return out;
}

function lcgContext(p, settings, now, opts) {
  const n = sheetCount(p, now, settings);
  const sheet = clamp(Math.floor(Number(opts.sheet) || n), 1, n);
  const birth = birthTime(p) ? toMs(birthTime(p)) : null;
  const ctx = {
    p, proto: getProtocol(settings, p), now, n, sheet, birth, idx: ackIndex(p),
    ...lcgPanels(p, now, sheet), H: LAYOUT.height,
  };
  ctx.W = ctx.width;
  ctx.at = t => panelFor(ctx, t);
  ctx.items = locate(ctx, activeObs(p).filter(o => o.v).sort(byTime));
  ctx.meds = locate(ctx, live(p.meds).sort(byTime));
  ctx.notes = locate(ctx, live(p.notes).filter(x => x.text || x.plan).sort(byTime));
  return ctx;
}

/**
 * Circled when the value meets the ALERT column. Before the active first
 * stage the sheet does not apply yet, so there only a value that actually
 * raised an alert is circled (weak contractions are normal in latent labour).
 */
function meets(it, field, byFlag) {
  if (it.P.key !== 'pre' || !Array.isArray(it.o.flags)) return byFlag;
  const codes = ALERT_CODES[field] || [];
  return it.o.flags.some(c => codes.includes(c));
}

/**
 * One value per cell (manual Table 4: the most significant in the timeframe):
 * flagged first, then the latest. `merged` counts the values not shown.
 */
function perCell(list) {
  const best = new Map(), count = new Map();
  for (const c of list) {
    const k = `${c.it.P.key}:${c.it.cell}`;
    count.set(k, (count.get(k) || 0) + 1);
    const b = best.get(k);
    if (!b || c.rank > b.rank || (c.rank === b.rank && c.it.t >= b.it.t)) best.set(k, c);
  }
  return [...best].map(([k, c]) => ({ ...c, merged: count.get(k) - 1 }));
}

/**
 * "+n" in the top-right corner of a latent / admission cell holding n more
 * values than the one shown: that panel squeezes the whole latent phase into
 * a few columns, so it merges far more than the form's own cells do.
 */
function mergedMark(c, top) {
  const P = c.it.P;
  if (P.key !== 'pre' || !c.merged) return '';
  const cw = (P.x1 - P.x0) / (P.cols * P.cells);
  // in the strip above the value's glyphs, so it never sits on the value
  return txt(cellX(P, c.it.cell) + cw / 2 - 0.6, top + 3.7, `+${c.merged}`,
    { size: 4.4, anchor: 'end', weight: 700, fill: MUTED, cls: 'merged', id: c.it.o.id });
}

// ------------------------------------------------------ LCG: the frame ----

function frame(ctx) {
  const top = ROW.stage.y, data = ROW.companion.y, bottom = LAYOUT.bottom, right = ctx.W - G.pad;
  const c = ROW.cervix, d = ROW.descent, nC = cervixRows(ctx.proto);
  let s = `<rect width="${ctx.W}" height="${ctx.H}" fill="#fff"/>`
    + `<rect x="${G.label}" y="${top}" width="${G.alert}" height="${bottom - top}" fill="#fcefed"/>`;
  for (const P of ctx.panels) {
    const x0 = n1(P.x0), w = n1(P.x1 - P.x0), cells = P.cols * P.cells, cw = (P.x1 - P.x0) / cells;
    s += `<rect class="fhr-band" x="${x0}" y="${ROW.fhr.y}" width="${w}" height="${ROW.fhr.h}" fill="#f5f8fd"/>`
      + `<rect class="cervix-grid" x="${x0}" y="${c.y}" width="${w}" height="${c.h}" fill="#f6fbf9"/>`
      + `<rect class="descent-grid" x="${x0}" y="${d.y}" width="${w}" height="${d.h}" fill="#f9f7fc"/>`;
    for (let i = 1; i < nC; i++) s += ln(P.x0, c.y + i * c.h / nC, P.x1, c.y + i * c.h / nC, '#dbe7e2', 0.7);
    for (let i = 1; i < 6; i++) s += ln(P.x0, d.y + i * d.h / 6, P.x1, d.y + i * d.h / 6, '#e6e0ef', 0.7);
    for (let i = 1; i < cells; i++) {
      const hour = i % P.cells === 0;
      s += ln(P.x0 + i * cw, hour ? top : data, P.x0 + i * cw, bottom, hour ? '#c3d5cf' : '#edf2f0', hour ? 0.9 : 0.6);
    }
    const from = P.from != null ? ` data-from="${new Date(P.from).toISOString()}"` : '';
    s += `<rect class="panel panel-${P.key}"${from} x="${x0}" y="${top}" width="${w}" height="${bottom - top}" fill="none" stroke="${EDGE}"/>`;
  }
  for (const r of Object.values(ROW)) if (r.y > top) s += ln(G.label, r.y, right, r.y, '#e1eae7', 0.8);
  for (const sec of LAYOUT.sections) s += ln(G.label, sec.y0, right, sec.y0, EDGE, 1.1);
  return s + ln(G.label, bottom, right, bottom, EDGE, 1.1);
}

/** A section name written up the side bar, on two lines when it does not fit on one. */
function sectionName(sec) {
  const len = sec.y1 - sec.y0 - 4, cx = G.sec / 2, cy = (sec.y0 + sec.y1) / 2;
  const words = sec.name.split(' ');
  const lines = sec.name.length * 0.62 * 7 <= len || words.length < 2
    ? [sec.name] : [words[0], words.slice(1).join(' ')];
  const size = Math.min(7, len / (Math.max(...lines.map(l => l.length)) * 0.62));
  if (size < 4.5) return '';
  const dy = lines.length === 1 ? [size * 0.35] : [-size * 0.15, size + 0.5];
  return `<text transform="rotate(-90 ${n1(cx)} ${n1(cy)})" x="${n1(cx)}" y="${n1(cy)}" font-size="${n1(size)}"`
    + ` font-weight="700" text-anchor="middle" fill="#33514a">`
    + lines.map((l, i) => `<tspan x="${n1(cx)}" dy="${n1(dy[i])}">${esc(l)}</tspan>`).join('') + '</text>';
}

/** The label column: sections, row names and scales. Also kept in view on a phone (renderChart). */
function gutter(ctx) {
  const bottom = LAYOUT.bottom, data = ROW.companion.y;
  let s = `<rect width="${G.label}" height="${ctx.H}" fill="#fff"/>`
    + txt(4, 11, 'WHO LABOUR CARE GUIDE', { size: 7.6, anchor: 'start', weight: 800, fill: TEAL });
  for (const r of Object.values(ROW)) {
    if (!r.label) continue;
    const head = r.y < data;
    if (!head) s += ln(G.sec, r.y, G.label, r.y, '#e1eae7', 0.8);
    s += txt(head ? 4 : G.sec + 3, r.y + Math.min(r.h, 13) / 2 + 3, r.label,
      { size: head ? 7 : 7.8, anchor: 'start', weight: 600, fill: head ? MUTED : INK });
  }
  for (const sec of LAYOUT.sections) {
    s += `<rect x="0" y="${sec.y0}" width="${G.sec}" height="${sec.y1 - sec.y0}" fill="#e3efeb"/>`
      + sectionName(sec) + ln(0, sec.y0, G.label, sec.y0, EDGE, 1.1);
  }
  const scale = { size: 6.6, anchor: 'end', fill: MUTED, weight: 600 };
  for (let v = 100; v <= 180; v += 20) s += txt(G.label - 3, fhrY(v) + 2.3, String(v), scale);
  for (let cm = 10; cm >= ctx.proto.activeStartCm; cm--) s += txt(G.label - 3, cmY(ctx.proto, cm) + 2.5, String(cm), scale);
  for (let f = 5; f >= 0; f--) s += txt(G.label - 3, descY(f) + 2.5, String(f), scale);
  return s + ln(G.label, ROW.stage.y, G.label, bottom, EDGE, 1.1) + ln(0, bottom, G.label, bottom, EDGE, 1.1);
}

function alertColumn(ctx) {
  const cx = G.label + G.alert / 2, crit = { size: 6.8, fill: '#b3261e', cls: 'alert-crit' };
  let s = txt(cx, ROW.stage.y + 9.5, 'ALERT', { size: 8, weight: 800, fill: RED });
  for (const [key, t] of Object.entries(alertTexts())) {
    if (t) s += txt(cx, ROW[key].y + Math.min(ROW[key].h, 13) / 2 + 2.5, t, crit);
  }
  const lags = ctx.proto.dilatationLagMin || {};
  for (let cm = 10; cm >= ctx.proto.activeStartCm; cm--) {
    if (lags[cm]) s += txt(cx, cmY(ctx.proto, cm) + 2.5, `>=${lags[cm] / 60}h`, crit);
  }
  return s;
}

/** Section 1 of the form, in one line. */
function headLine(p) {
  const rom = p.romUnknown ? 'U (time unknown)' : p.romTime ? dayTime(p.romTime) : 'not recorded';
  const risks = (p.riskFactors || []).map(r => String(r).replace(/_/g, ' ')).join(', ') || 'none recorded';
  const line = [
    `Parity G${p.gravida ?? '?'} P${p.para ?? '?'}`,
    `Labour onset: ${own(ONSET_LBL, p.onsetMode) ? ONSET_LBL[p.onsetMode] : 'not recorded'}`,
    `Active labour diagnosis: ${p.activeStartTime ? dayTime(p.activeStartTime) : 'not yet'}`,
    `Ruptured membranes: ${rom}`, `Risk factors: ${risks}`,
  ].join('  |  ');
  return line.length > 180 ? line.slice(0, 177) + '...' : line;
}

function headings(ctx) {
  const { pre, first, sec } = ctx;
  const st = ROW.stage.y + 9.5, tm = ROW.time.y + 8.8, hr = ROW.hours.y + 8.8;
  const time = { size: 7, cls: 'col-time' }, hour = { size: 7.5, weight: 700, cls: 'col-hour', fill: MUTED };
  let s = txt(GX, 11, headLine(ctx.p), { size: 7.4, anchor: 'start' })
    + txt(ctx.W - G.pad, 11, `Sheet ${ctx.sheet} of ${ctx.n}`, { size: 8, anchor: 'end', weight: 700 });
  if (pre) {
    s += txt((pre.x0 + pre.x1) / 2, st, pre.cols > 1 ? 'LATENT / ADMISSION' : 'LATENT', { size: 6.8, weight: 700, fill: MUTED });
    // the panel squeezes the whole latent phase into PRE_COLS columns at most:
    // each column is labelled with the real time it spans, start over end
    const span = (pre.to - pre.from) / pre.cols;
    for (let k = 0; k < pre.cols; k++) {
      const cx = pre.x0 + (k + 0.5) * G.preCol, t0 = pre.from + k * span;
      s += txt(cx, tm, hhmm(t0), { size: 6.6, fill: MUTED, cls: 'pre-from' })
        + txt(cx, hr, `to ${hhmm(t0 + span)}`, { size: 6, fill: MUTED, cls: 'pre-to' });
    }
  }
  const title = ctx.active == null ? `ACTIVE FIRST STAGE - starts at ${ctx.proto.activeStartCm} cm`
    : ctx.sheet > 1 ? `ACTIVE FIRST STAGE - continued, hours ${first.base} to ${first.base + SHEET_HOURS}` : 'ACTIVE FIRST STAGE';
  s += txt((first.x0 + first.x1) / 2, st, title, { size: 7.5, weight: 800, fill: TEAL });
  // clock times run ahead while labour goes on; a stage that has ended gets none after its end
  const going = isLabouring(ctx.p) && ctx.birth == null;
  const stop1 = ctx.second ?? (going ? Infinity : ctx.end), stop2 = going ? Infinity : ctx.end;
  for (let k = 0; k < first.cols; k++) {
    const cx = first.x0 + (k + 0.5) * G.col, t = first.from + k * HOUR;
    if (first.from != null && t < stop1) s += txt(cx, tm, hhmm(t), time);
    s += txt(cx, hr, String(first.base + k + 1), hour);
  }
  s += txt((sec.x0 + sec.x1) / 2, st, sec.from != null ? `SECOND STAGE - 10 cm at ${hhmm(sec.from)}` : 'SECOND STAGE',
    { size: 7.5, weight: 800, fill: PURPLE });
  for (let k = 0; k < sec.cols; k++) {
    const cx = sec.x0 + (k + 0.5) * G.col2, t = sec.from + k * HOUR;
    if (sec.from != null && t <= stop2) s += txt(cx, tm, hhmm(t), time);
    s += txt(cx, hr, String(k + 1), hour);
  }
  return s;
}

// ------------------------------------------------------- LCG: the values ----

function codeRows(ctx) {
  let s = '';
  for (const r of CODE_ROWS) {
    const row = ROW[r.row], cands = [];
    for (const it of ctx.items) {
      if (!r.types.includes(it.o.type)) continue;
      const v = r.get(it.o);
      if (v == null || v === '') continue;
      const flagged = meets(it, r.field, !!r.flag(v, it.o));
      cands.push({ it, label: String(r.label(v, it.o)), flagged, rank: flagged ? 1 : 0 });
    }
    const top = row.y + r.line * row.h / r.lines, cy = top + 0.5 * row.h / r.lines;
    for (const c of perCell(cands)) {
      const x = cellX(c.it.P, c.it.cell);
      const open = c.flagged && flagState(ctx.idx, c.it.o, r.field) !== 'ack';
      s += txt(x, cy + 2.8, c.label, { size: r.size || 8, cls: 'v', id: c.it.o.id, weight: c.flagged ? 700 : null, fill: open ? RED : INK });
      if (c.flagged) s += ring(ctx.idx, c.it.o, r.field, x, cy, Math.max(6, c.label.length * 2.4 + 3), row.h / r.lines / 2 - 0.6);
      s += mergedMark(c, top);
    }
  }
  return s;
}

/**
 * Baseline FHR: plotted in its band, each cell's value written above. A value
 * beyond the band sits on its edge and is written out in its cell's stack
 * (offScaleStacks) instead.
 */
function fhrRow(ctx) {
  const top = ROW.fhr.y + 5;
  let s = '';
  for (const P of ctx.panels) {
    for (const v of [LIMITS.fhr.low, LIMITS.fhr.high]) s += ln(P.x0, fhrY(v), P.x1, fhrY(v), RED, 0.8, ' stroke-dasharray="3 2" opacity="0.55"');
  }
  const pts = ctx.items.filter(it => it.o.type === 'baby' && it.o.v.fhr != null && Number.isFinite(Number(it.o.v.fhr)));
  s += paths(ctx, pts, it => fhrY(Number(it.o.v.fhr)), BLUE, 1.2, '');
  const cands = [], offs = [];
  for (const it of pts) {
    const v = Number(it.o.v.fhr), cy = fhrY(v), flagged = meets(it, 'fhr', FLAG.fhr(v)), dir = offBand(v);
    s += `<circle class="fhr-pt"${idAttr(it.o.id)} cx="${n1(it.x)}" cy="${n1(cy)}" r="2.2" fill="${BLUE}"/>`;
    if (flagged) s += ring(ctx.idx, it.o, 'fhr', it.x, cy, 4.8, 4.8);
    if (dir) {
      const open = flagged && flagState(ctx.idx, it.o, 'fhr') !== 'ack';
      offs.push({ slot: `${it.P.key}:${it.cell}`, sx: cellX(it.P, it.cell), edge: cy, dir, v, fill: open ? RED : MUTED, id: it.o.id });
    }
    cands.push({ it, cy, off: dir, label: String(v), flagged, rank: flagged ? (FLAG.fhrSevere(v) ? 2 : 1) : 0 });
  }
  for (const c of perCell(cands)) {
    const open = c.flagged && flagState(ctx.idx, c.it.o, 'fhr') !== 'ack';
    // an off-scale value is written in its cell's stack
    if (!c.off) {
      s += txt(cellX(c.it.P, c.it.cell), c.cy - 5 < top + 3 ? c.cy + 10 : c.cy - 5, c.label,
        { size: 7, cls: 'fhr-v', weight: c.flagged ? 700 : null, fill: open ? RED : MUTED });
    }
    s += mergedMark(c, ROW.fhr.y);
  }
  return s + offScaleStacks(offs, 6.5);
}

/** A line through the points of each panel (never across panels or sheets). */
function paths(ctx, list, yOf, stroke, w, extra) {
  let s = '';
  for (const P of ctx.panels) {
    const pts = list.filter(it => it.P === P);
    if (pts.length > 1) {
      s += `<polyline points="${pts.map(it => `${n1(it.x)},${n1(yOf(it))}`).join(' ')}" fill="none" stroke="${stroke}" stroke-width="${w}"${extra}/>`;
    }
  }
  return s;
}

/** Cervix X on its grid, descent O on its own grid (F14), the progress time limit and P (F2). */
function progressRows(ctx) {
  const { proto } = ctx, c = ROW.cervix, min = proto.activeStartCm;
  const exams = ctx.items.filter(it => it.o.type === 'exam');
  const dil = exams.filter(it => it.o.v.dilatation != null && Number.isFinite(Number(it.o.v.dilatation)));
  const plotted = dil.filter(it => Number(it.o.v.dilatation) >= min);
  const desc = exams.filter(it => it.o.v.descent != null && Number.isFinite(Number(it.o.v.descent)));
  const dy = it => descY(clamp(Number(it.o.v.descent), 0, 5));
  let s = limitBar(ctx)
    + paths(ctx, plotted, it => cmY(proto, Math.min(10, Number(it.o.v.dilatation))), TEAL, 1.6, '')
    + paths(ctx, desc, dy, PURPLE, 1.2, ' stroke-dasharray="4 2"');
  // latent: below the form's grid, written as a number - one per cell (the latest), never overprinted
  const low = dil.filter(it => Number(it.o.v.dilatation) < min).map(it => ({ it, rank: 0 }));
  for (const m of perCell(low)) {
    s += txt(cellX(m.it.P, m.it.cell), c.y + c.h - 3, String(Number(m.it.o.v.dilatation)),
      { size: 7, cls: 'dil-num', id: m.it.o.id, fill: MUTED, weight: 700 }) + mergedMark(m, c.y + c.h - 11);
  }
  for (const it of plotted) {
    const cm = Number(it.o.v.dilatation);
    const x = n1(it.x), y = n1(cmY(proto, Math.min(10, cm))), r = 3.4;
    s += `<path class="dil-x"${idAttr(it.o.id)} d="M${n1(x - r)},${n1(y - r)}L${n1(x + r)},${n1(y + r)}M${n1(x - r)},${n1(y + r)}L${n1(x + r)},${n1(y - r)}" stroke="${TEAL}" stroke-width="2" fill="none"/>`;
    if ((it.o.flags || []).some(code => ALERT_CODES.dilatation.includes(code))) s += ring(ctx.idx, it.o, 'dilatation', x, y, 6.5, 6.5);
  }
  for (const it of desc) {
    s += `<circle class="descent-o"${idAttr(it.o.id)} cx="${n1(it.x)}" cy="${n1(dy(it))}" r="3.4" fill="#fff" stroke="${PURPLE}" stroke-width="1.7"/>`;
  }
  return s + pushMarker(ctx);
}

/** LCG: how long the current dilatation may last (the lag times of the alert column). */
function limitBar(ctx) {
  const lags = ctx.proto.dilatationLagMin, P = ctx.first;
  if (!lags || ctx.birth != null || ctx.second != null || P.from == null) return '';
  const reach = timeReachedCurrentDilatation(ctx.p);
  const lim = reach && lags[reach.cm];
  if (!lim) return '';
  const t0 = toMs(reach.since), t1 = t0 + lim * 60000;
  const a = Math.max(t0, P.from), b = Math.min(t1, P.to);
  if (!(b > a)) return '';
  const y = cmY(ctx.proto, reach.cm);
  let s = ln(xAt(P, a), y, xAt(P, b), y, RED, 2.5, ' stroke-dasharray="6 4" opacity="0.5" class="limit-bar"');
  if (t1 <= P.to) {
    const x = xAt(P, t1);
    s += ln(x, y - 6, x, y + 6, RED, 2) + txt(x + 3, y - 3, `limit ${lim / 60}h at ${reach.cm} cm`, { size: 7, anchor: 'start', weight: 700, fill: RED });
  }
  return s;
}

function pushMarker(ctx) {
  const t = secondStagePushing(ctx.p);
  const P = t ? ctx.at(toMs(t)) : null;
  if (!P) return '';
  const x = xAt(P, toMs(t)), c = ROW.cervix, d = ROW.descent, h = c.h / cervixRows(ctx.proto);
  return `<g class="p-marker">${ln(x, c.y, x, d.y + d.h, PURPLE, 1, ' stroke-dasharray="3 2"')}`
    + `<rect x="${n1(x - 5.5)}" y="${n1(c.y + 0.5)}" width="11" height="${n1(h - 1)}" fill="#fff" stroke="${PURPLE}"/>`
    + txt(x, c.y + h - 2.6, 'P', { size: 8.5, weight: 800, fill: PURPLE }) + '</g>';
}

function oxytocinRow(ctx) {
  const cands = [];
  for (const it of ctx.items) {
    if (it.o.type === 'oxytocin') cands.push({ it, label: `${it.o.v.uL ?? '-'}/${it.o.v.dropsMin ?? '-'}`, rank: 0 });
  }
  for (const it of ctx.meds) {
    if (it.o.kind !== 'oxytocin') continue;
    cands.push({ it, label: isOxytocinStop(it.o) ? 'stop' : `${it.o.oxyUL ?? '-'}/${it.o.oxyDrops ?? '-'}`, rank: 0 });
  }
  return perCell(cands).map(c => txt(cellX(c.it.P, c.it.cell), ROW.oxytocin.y + 9.3, c.label, { size: 7, cls: 'oxy' })
    + mergedMark(c, ROW.oxytocin.y)).join('');
}

/** Words into lines of at most `width` characters; the last kept line ends in "..." when cut. */
function wrapText(text, width, maxLines) {
  const lines = [];
  let cur = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    let w = word;
    while (w.length > width) { // a word longer than a line is cut
      if (cur) { lines.push(cur); cur = ''; }
      lines.push(w.slice(0, width));
      w = w.slice(width);
    }
    if (!w) continue;
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= width) cur = next;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = kept[maxLines - 1].slice(0, Math.max(1, width - 3)) + '...';
  return kept;
}

/** Free text per hour column, running on over empty columns (at most 3); the full text is the tooltip. */
function spanRow(row, list, textOf, cls) {
  const groups = new Map();
  for (const it of list) {
    const t = String(textOf(it.o) || '').trim();
    if (!t) continue;
    const k = `${it.P.key}:${it.col}`;
    if (!groups.has(k)) groups.set(k, { P: it.P, col: it.col, parts: [] });
    groups.get(k).parts.push(t);
  }
  const size = 6.8, lh = 7.4, maxLines = Math.max(1, Math.floor((row.h - 3) / lh));
  const all = [...groups.values()];
  return all.map((g, i) => {
    const colW = (g.P.x1 - g.P.x0) / g.P.cols, next = all[i + 1];
    const cols = Math.min(3, (next && next.P === g.P ? next.col : g.P.cols) - g.col);
    const x = n1(g.P.x0 + g.col * colW + 2), full = g.parts.join('; ');
    const lines = wrapText(full, Math.max(4, Math.floor((cols * colW - 4) / (size * 0.5))), maxLines);
    return `<text class="${cls}" x="${x}" y="${n1(row.y + lh)}" font-size="${size}" fill="${INK}"><title>${esc(full)}</title>`
      + lines.map((l, k) => `<tspan x="${x}" dy="${k ? lh : 0}">${esc(l)}</tspan>`).join('') + '</text>';
  }).join('');
}

function textRows(ctx) {
  const kind = k => ctx.meds.filter(it => it.o.kind === k);
  return spanRow(ROW.medicine, kind('medicine'), m => m.detail, 'med-text')
    + spanRow(ROW.ivfluid, kind('ivfluid'), m => m.detail || 'Y', 'iv-text')
    + spanRow(ROW.assessment, ctx.notes, n => n.text, 'note-text')
    + spanRow(ROW.plan, ctx.notes, n => n.plan, 'plan-text');
}

/** Initials per hour column (F3); "?" marks an entry recorded without initials. */
function initialsRow(ctx) {
  const groups = new Map();
  for (const it of [...ctx.items, ...ctx.meds, ...ctx.notes]) {
    const k = `${it.P.key}:${it.col}`;
    if (!groups.has(k)) groups.set(k, { P: it.P, col: it.col, by: new Set(), missing: false });
    const g = groups.get(k);
    if (it.o.by && String(it.o.by).trim()) g.by.add(String(it.o.by).trim().toUpperCase());
    else g.missing = true;
  }
  let s = '';
  for (const g of groups.values()) {
    const colW = (g.P.x1 - g.P.x0) / g.P.cols;
    const label = [...g.by, ...(g.missing ? ['?'] : [])].join('/');
    const size = n1(clamp((colW - 4) / (label.length * 0.55), 5, 7.5));
    s += txt(g.P.x0 + (g.col + 0.5) * colW, ROW.initials.y + 9.3, label, { size, cls: 'initials', weight: 600, fill: g.missing ? RED : INK });
  }
  return s;
}

/** The moment the chart runs to: the birth, or now while she is in labour. */
function markTime(ctx) {
  if (ctx.birth != null) return ctx.birth;
  return isLabouring(ctx.p) ? +ctx.now : null;
}

function markers(ctx) {
  const t = markTime(ctx), P = t != null ? ctx.at(t) : null;
  if (!P) return '';
  const x = xAt(P, t), top = ROW.companion.y, bottom = LAYOUT.bottom;
  if (ctx.birth == null) return `<g class="now-marker">${ln(x, top, x, bottom, BLUE, 1, ' stroke-dasharray="3 3" opacity="0.7"')}</g>`;
  const left = x > ctx.W - 70;
  return `<g class="birth-marker">${ln(x, top, x, bottom, GREEN, 2)}`
    + txt(left ? x - 3 : x + 3, ROW.fhr.y + 9, `Birth ${hhmm(t)}`, { size: 8, anchor: left ? 'end' : 'start', weight: 800, fill: GREEN }) + '</g>';
}

function focusX(ctx) {
  const t = markTime(ctx), P = t != null ? ctx.at(t) : null;
  if (P) return xAt(P, t);
  const xs = [...ctx.items, ...ctx.meds, ...ctx.notes].map(it => it.x);
  return xs.length ? Math.max(...xs) : GX;
}

const LCG_LEGEND = 'X cervical dilatation (cm); O descent (fifths palpable above the brim); P pushing began. '
  + 'Values meeting the ALERT column are circled: solid red until the alert is acknowledged; dashed grey = acknowledged. '
  + 'An FHR beyond the scale sits on its edge with an arrow and its value. '
  + 'Red dashed bar = WHO LCG progress time-limit at current dilatation. '
  + 'Latent / admission columns are labelled with the time each spans; +n = n more entries in that cell than the one shown. '
  + 'Y yes, N no, D declined; SP supine, MO mobile; decelerations N none, E early, L late, V variable, Pr prolonged; '
  + 'fluid I intact, C clear, M+ to M+++ meconium, B blood; position A anterior, P posterior, T transverse; '
  + 'urine P protein, A acetone (- negative, tr trace); ? = an entry without initials. '
  + 'Each sheet covers 12 hours of the active first stage; the second stage is on the sheet where it began.';

function lcgChart(p, settings, now, opts) {
  const ctx = lcgContext(p, settings, now, opts);
  const gut = gutter(ctx);
  const body = frame(ctx) + gut + alertColumn(ctx) + headings(ctx) + codeRows(ctx) + fhrRow(ctx)
    + progressRows(ctx) + oxytocinRow(ctx) + textRows(ctx) + initialsRow(ctx) + markers(ctx);
  const k = opts.scale || 1;
  const label = `WHO Labour Care Guide, sheet ${ctx.sheet} of ${ctx.n}`;
  const root = (cls, w, extra, content) => `<svg class="${cls}" xmlns="http://www.w3.org/2000/svg" width="${n1(w * k)}"`
    + ` height="${n1(ctx.H * k)}" viewBox="0 0 ${w} ${ctx.H}" font-family="${FAMILY}"${extra}>${content}</svg>`;
  return {
    svg: root('chart-svg lcg', ctx.W, ` role="img" aria-label="${label}"`, `<g class="sheet-${ctx.sheet}">${body}</g>`),
    width: ctx.W, height: ctx.H, legend: LCG_LEGEND, sheet: ctx.sheet, sheets: ctx.n,
    gutter: { width: G.label, svg: root('chart-gutter-svg', G.label, ' style="display:block"', gut) },
    focusX: focusX(ctx),
  };
}

// ------------------------------------------------------------------ public ----

/**
 * Pure SVG chart for one case: {svg, width, height, legend, sheet, sheets,
 * gutter, focusX}. opts.sheet (1-based) picks the 12-hour LCG sheet (default:
 * the newest); opts.scale enlarges the drawn size, never the geometry.
 */
export function chartSVG(patient, settings, now = new Date(), opts = {}) {
  return getProtocol(settings, patient).alertActionLines
    ? partographSVG(patient, settings, now, opts)
    : lcgChart(patient, settings, now, opts);
}

/** The key to the chart's codes, for the case's protocol (shown under the scroll box, not inside it). */
export function chartLegend(patient, settings) {
  return getProtocol(settings, patient).alertActionLines ? PARTO_LEGEND : LCG_LEGEND;
}

// --------------------------------------------------------------- the page ----

const SCREEN_SCALE = 1.25;      // drawn a quarter larger on screen than on paper, for reading on a phone
const sheetChoice = new Map();  // case id -> the sheet picked on the chart tab (absent: follow the newest)

/** The sheet shown on screen: the one picked, else the newest. */
export function chartSheet(patient, now = new Date(), settings) {
  const n = sheetCount(patient, now, settings);
  const pick = sheetChoice.get(patient.id);
  return pick && pick < n ? pick : n;
}

/** Remember the sheet picked; picking the newest follows it as labour goes on. */
export function selectChartSheet(patient, sheet, now = new Date(), settings) {
  if (sheet >= sheetCount(patient, now, settings)) sheetChoice.delete(patient.id);
  else sheetChoice.set(patient.id, sheet);
}

/**
 * The chart for the page: a box that scrolls sideways on its own (the page
 * never does), with the row labels kept in view while it scrolls. app.js
 * swaps this element on the heartbeat; the sheet picked is kept. The legend
 * (chartLegend) goes under the box, where scrolling never cuts it.
 */
export function renderChart(patient, settings, opts = {}) {
  const now = opts.now || new Date();
  const sheet = opts.sheet || chartSheet(patient, now, settings);
  const c = chartSVG(patient, settings, now, { sheet, scale: SCREEN_SCALE });
  const wrap = document.createElement('div');
  wrap.className = 'chart-scroll';
  const gutter = c.gutter
    ? `<div class="chart-gutter" aria-hidden="true" style="position:sticky;left:0;z-index:1;`
      + `width:${n1(c.gutter.width * SCREEN_SCALE)}px;height:0;overflow:visible">${c.gutter.svg}</div>`
    : '';
  wrap.innerHTML = `<div class="chart-inner" style="width:${n1(c.width * SCREEN_SCALE)}px">${gutter}${c.svg}</div>`;
  // show the newest data (the birth or "now") near the right edge
  requestAnimationFrame(() => {
    wrap.scrollLeft = Math.max(0, c.focusX * SCREEN_SCALE - wrap.clientWidth + 64);
  });
  return wrap;
}

let printTarget = null;
let printHooked = false;

/**
 * Every sheet of the case as print markup (pure): one section.print-sheet
 * per sheet, each headed with the woman's name, MRN, admission date,
 * protocol and facility (printHead), so a continuation sheet never loses its
 * case; then the notes appendix (notesAppendix: section.print-notes) with
 * the text the sheets cut.
 */
export function printSheetsHTML(patient, settings, now = new Date()) {
  const n = sheetCount(patient, now, settings);
  let html = '';
  for (let sheet = 1; sheet <= n; sheet++) {
    const c = chartSVG(patient, settings, now, { sheet });
    html += `<section class="print-sheet sheet-${sheet}">${printHead(patient, settings, ['Sheet', `${sheet} of ${n}`], now)}${c.svg}`
      + `<p class="print-legend">${esc(c.legend)}</p></section>`;
  }
  return html + notesAppendix(patient, settings, now);
}

// css/print.css prints only the sheets from the chart tab with :has(). For
// browsers without it, while the chart tab prints <body> carries
// .print-sheets-only and every ancestor of the sheets .print-path, so the
// stylesheet can hide everything off that path.
function markPrintPath(box) {
  document.body.classList.add('print-sheets-only');
  for (let el = box.parentElement; el && el !== document.body; el = el.parentElement) el.classList.add('print-path');
}

function clearPrintPath() {
  document.body.classList.remove('print-sheets-only');
  for (const el of document.querySelectorAll('.print-path')) el.classList.remove('print-path');
}

/**
 * The print container for the chart tab (css/print.css shows it only on
 * paper). Redrawn just before printing, so the paper copy carries the latest
 * entries whether printing starts from "Print chart" or the browser menu.
 */
export function renderPrintSheets(patient, settings) {
  const box = document.createElement('div');
  box.className = 'print-only print-sheets';
  box.innerHTML = printSheetsHTML(patient, settings);
  printTarget = { box, patient, settings };
  if (!printHooked && typeof window !== 'undefined') {
    printHooked = true;
    window.addEventListener('beforeprint', () => {
      clearPrintPath(); // a print whose afterprint never came must not hide the next one
      const t = printTarget;
      if (!t || !t.box.isConnected) return;
      t.box.innerHTML = printSheetsHTML(t.patient, t.settings);
      markPrintPath(t.box);
    });
    window.addEventListener('afterprint', clearPrintPath);
  }
  return box;
}
