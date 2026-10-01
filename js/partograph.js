// partograph.js - the Ethiopian modified WHO partograph layout (split out of
// chart.js in M5), and the drawing kit both chart layouts share.
//
// The partograph is the v1 layout, kept for the legacy ethiopia2021 protocol
// with its geometry unchanged: one sheet growing from admission, alert and
// action lines anchored by alertLineAnchor (S7), descent sharing the
// cervicograph. chart.js chartSVG() hands that protocol to partographSVG().
//
// The kit both layouts draw with lives here, not in chart.js, so chart.js can
// import it together with the partograph without a circular import:
// escaping and SVG primitives, the alert circles and their acknowledgement
// state (flagState), the FHR values beyond the scale (offScaleStacks), where
// the charted labour ends (chartEnd), the after-birth rule, and the print
// header and notes appendix every printed chart carries.
//
// Pure (no DOM), so it runs in the Node tests. Voided entries are never drawn
// (S5), nothing is drawn after the birth minute (afterBirth), and every
// threshold comes from FLAG and LIMITS (S13).

import {
  getProtocol, alertLineAnchor, activeObs, byTime, toMs, LIMITS, secondStagePushing, birthTime, isLabouring,
} from './protocol.js';
import { FLAG, urineGrade, isSupine } from './alerts.js';
import { APP_TZ, eatDate } from './ui.js';
import { formatEthiopic } from './ethiopic.js';
import { isAckNote } from './audit.js';
import { en as wizardEN } from './i18n/wizard.js';

export const HOUR = 3600000;
const MINUTE = 60000;

export const RED = '#c62828';
const GREY = '#9aa5a2';
export const INK = '#1c2b28';
export const MUTED = '#51635e';

// ------------------------------------------------------------------ kit ----

export function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const n1 = v => Math.round(v * 10) / 10;
export const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
export const live = list => (list || []).filter(e => e && !e.voided);
export const idAttr = id => (id ? ` data-id="${esc(id)}"` : '');
export const finite = list => list.filter(Number.isFinite);

/**
 * A note's plan as the chart writes it. An acknowledgement note stores the
 * action as a code ('senior'); the chart, in English like the paper form,
 * writes it in words ('Senior/colleague called'). Typed plans are unchanged.
 */
export function planText(n) {
  if (!n || n.plan == null || n.plan === '') return '';
  const action = isAckNote(n) ? wizardEN['wz.act_' + n.plan] : null;
  return action || String(n.plan);
}

const CLOCK = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: APP_TZ };
export const hhmm = t => new Date(t).toLocaleTimeString('en-GB', CLOCK);
const fullDate = t => `${new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: APP_TZ })} ${hhmm(t)}`;

/** One SVG text element (the LCG sheet sets the font family once on its root). */
export function txt(x, y, s, o = {}) {
  const { size = 8, anchor = 'middle', weight, fill = INK, cls, id } = o;
  return `<text${cls ? ` class="${cls}"` : ''}${idAttr(id)} x="${n1(x)}" y="${n1(y)}" font-size="${size}"`
    + ` text-anchor="${anchor}"${weight ? ` font-weight="${weight}"` : ''} fill="${fill}">${esc(s)}</text>`;
}
export const ln = (x1, y1, x2, y2, stroke, w = 1, extra = '') =>
  `<line x1="${n1(x1)}" y1="${n1(y1)}" x2="${n1(x2)}" y2="${n1(y2)}" stroke="${stroke}" stroke-width="${w}"${extra}/>`;

/**
 * A dipstick grade as written on the chart: '-' negative, 'tr' trace, '+'
 * to '++++' (whatever notation was stored: '++', 'P++', '2+'), '?' when it
 * cannot be graded (shown, never read as negative). The caller adds P or A.
 */
export const urineText = g => {
  const n = urineGrade(g);
  if (n == null) return '?';
  return n === 0 ? '-' : n === 0.5 ? 'tr' : '+'.repeat(Math.round(n));
};

// ------------------------------------------------ circles and acknowledgement ----

// The alert codes each charted value can raise (the rules in alerts.js). A
// circle turns grey once every alert its entry raised for that value is
// acknowledged; with no alert behind it (or one still waiting) it stays red.
export const ALERT_CODES = {
  fhr: ['fhr_abn', 'fhr_severe'], decel: ['decel'],
  liquor: ['liquor_thick_mec', 'liquor_blood', 'liquor_mec'],
  position: ['malposition', 'malpresentation'],
  caput: ['caput3', 'moulding_caput'], moulding: ['moulding3', 'moulding2', 'moulding_caput'],
  count: ['tachysystole', 'weak_contractions'], duration: ['contraction_long', 'contraction_short'],
  pulse: ['pulse_abn'], sys: ['htn', 'htn_severe', 'hypotension'], dia: ['htn', 'htn_severe'],
  temp: ['fever', 'temp_high', 'temp_low'], protein: ['proteinuria'], acetone: ['ketonuria'],
  companion: ['no_companion'], painRelief: ['no_pain_relief'], oralFluid: ['no_fluids'], posture: ['supine'],
  dilatation: ['lcg_progress', 'alert_line', 'action_line'],
};
const CONTRACTION_CODES = [...ALERT_CODES.count, ...ALERT_CODES.duration];

/** Alerts by the id of each entry that raised them. */
export function ackIndex(p) {
  const idx = new Map();
  for (const a of p.alerts || []) {
    for (const id of a.obsIds || (a.obsId ? [a.obsId] : [])) {
      if (!idx.has(id)) idx.set(id, []);
      idx.get(id).push(a);
    }
  }
  return idx;
}

/**
 * 'ack' when every alert the entry raised for these fields was acknowledged
 * at or after the entry was made, else 'open'. A new entry re-opens an
 * acknowledged alert (alerts.js addAlerts) and the alert keeps the time of
 * its last acknowledgement, so the entries that acknowledgement covered stay
 * grey and the later ones stay red until the alert is acknowledged again.
 */
export function flagState(idx, o, fields) {
  const codes = [].concat(fields).flatMap(f => ALERT_CODES[f] || []);
  const raised = (idx.get(o.id) || []).filter(a => codes.includes(a.code));
  const made = toMs(o.enteredAt || o.time);
  // an entry is covered when the acknowledgement came after it; while an alert
  // is re-opened, the entry must also predate the re-opening (a tablet clock
  // set back must never grey a value nobody has acknowledged). An older entry
  // judged again after a stage move (record.js restage) can re-open an alert
  // acknowledged before it was made: it stays red. An alert closed in the
  // same save that raised it (an entry corrected after the birth or her
  // departure) asks for nothing (needsAck false), so its value is drawn as
  // handled, never as a red circle no one can ever acknowledge.
  const covered = a => a.needsAck === false || (!!a.actionTime && toMs(a.actionTime) >= made
    && (a.ack || made < toMs(a.reAlertedAt || a.escalatedAt || 0)));
  return raised.length && raised.every(covered) ? 'ack' : 'open';
}

/** The circle: solid red while open, dashed grey once acknowledged (not by colour alone). */
export function ring(idx, o, fields, cx, cy, rx, ry) {
  const ack = flagState(idx, o, fields) === 'ack';
  return `<ellipse class="flag-circle${ack ? ' ack' : ''}"${idAttr(o.id)} cx="${n1(cx)}" cy="${n1(cy)}"`
    + ` rx="${n1(rx)}" ry="${n1(ry)}" fill="none" stroke="${ack ? GREY : RED}" stroke-width="1.3"`
    + `${ack ? ' stroke-dasharray="2 1.5"' : ''}/>`;
}

// ----------------------------------------------- FHR beyond the scale ----

export const FHR_BAND = { top: 200, bottom: 80 };  // display range of the FHR band (not alert values)

/** -1 above the FHR band's scale, 1 below it, 0 on it. */
export const offBand = v => (v > FHR_BAND.top ? -1 : v < FHR_BAND.bottom ? 1 : 0);

/**
 * FHR values beyond the band's scale sit on its edge, so each one is also
 * written out as an arrow pointing off the band and the value: a 65 is never
 * read as 80. One stack per time slot, oldest at the top, rising from the
 * lower edge or hanging from the upper one, so close readings never
 * overprint. marks: [{slot, sx (the slot's centre), edge, dir, v, fill, id}].
 */
export function offScaleStacks(marks, size) {
  const slots = new Map();
  for (const m of marks) {
    const k = `${m.slot}:${m.dir}`;
    if (!slots.has(k)) slots.set(k, []);
    slots.get(k).push(m);
  }
  const lh = size + 1.2;
  let s = '';
  for (const list of slots.values()) {
    list.forEach((m, i) => {
      const y = m.dir > 0 ? m.edge - 3 - (list.length - 1 - i) * lh : m.edge + size + 1.5 + i * lh;
      const x0 = m.sx - (5.4 + String(m.v).length * size * 0.55) / 2, mid = y - size * 0.35;
      const base = mid - m.dir * 1.8, tip = mid + m.dir * 1.8;
      s += `<g class="fhr-off"${idAttr(m.id)}><path d="M${n1(x0)},${n1(base)}L${n1(x0 + 4.4)},${n1(base)}L${n1(x0 + 2.2)},${n1(tip)}Z" fill="${m.fill}"/>`
        + txt(x0 + 5.4, y, String(m.v), { size, anchor: 'start', weight: 700, fill: m.fill }) + '</g>';
    });
  }
  return s;
}

// ---------------------------------------------------- the charted time ----

/** End of the charted labour: birth, handover, now while she is in labour, else the last entry. */
export function chartEnd(p, now) {
  const birth = birthTime(p);
  if (birth) return toMs(birth);
  const handover = p.referral && p.referral.handoverAt;
  if (handover) return toMs(handover);
  if (isLabouring(p)) return +now;
  const times = [...activeObs(p), ...live(p.meds), ...live(p.notes)].map(e => toMs(e.time));
  const start = toMs(p.activeStartTime || (p.admission && p.admission.time) || p.createdAt);
  return Math.max(...finite([start, ...times]), 0);
}

/**
 * After the birth: from the minute after it. The birth time is entered to the
 * minute, so an entry inside that minute (pushing began, then the birth) is
 * not after it and is still charted.
 */
export const afterBirth = (t, birth) => birth != null && t >= birth + MINUTE;

// ------------------------------------------------ Ethiopian partograph ----

const PXH = 64;        // pixels per hour
const LEFT = 118;      // label gutter
const FONT = 'font-family="Segoe UI, sans-serif"';
const SEC = {
  header:   { y: 0,   h: 26 },
  fhr:      { y: 30,  h: 112 },  // 200 -> 80 bpm
  decel:    { y: 148, h: 18 },
  liquor:   { y: 166, h: 18 },
  position: { y: 184, h: 18 },
  caput:    { y: 202, h: 18 },
  moulding: { y: 220, h: 18 },
  cervix:   { y: 244, h: 220 }, // 10 -> 0 cm
  contr:    { y: 474, h: 76 },  // 0-8 per 10 min
  oxy:      { y: 556, h: 20 },
  meds:     { y: 576, h: 20 },
  pulsebp:  { y: 604, h: 120 }, // 180 -> 60
  temp:     { y: 730, h: 18 },
  urine:    { y: 748, h: 18 },
  support:  { y: 766, h: 18 },
};
const HEIGHT = 792;
const P_ROWS = [
  ['fhr', 'FHR (bpm)'], ['decel', 'Decelerations'], ['liquor', 'Amniotic fluid'],
  ['position', 'Position'], ['caput', 'Caput'], ['moulding', 'Moulding'],
  ['cervix', 'Cervix [X] / Descent [O]'], ['contr', 'Contractions /10min'],
  ['oxy', 'Oxytocin'], ['meds', 'Medicine / IV fluids'],
  ['pulsebp', 'Pulse [•] / BP [I]'], ['temp', 'Temp °C'], ['urine', 'Urine'], ['support', 'Supportive care'],
];
const P_LIQUOR = { M1: 'M+', M2: 'M++', M3: 'M+++' };
const P_DECEL = { none: '—', early: 'E', variable: 'V', late: 'L', prolonged: 'P!' };
export const PARTO_LEGEND = `X dilatation (cm) · O descent (fifths above brim) · bars: contractions per 10 min (darker = longer) ·
    I/C/M/B amniotic fluid · E/V/L early-variable-late decelerations ·
    orange ALERT and red ACTION lines per Ethiopian modified WHO partograph ·
    supportive care: ✓ ok, C no companion, PR no pain relief, F no fluids, SP supine; P pushing began;
    circled values meet an alert criterion: solid red until the alert is acknowledged, dashed grey = acknowledged;
    an FHR beyond the scale sits on its edge with an arrow and its value`;

/** The partograph of one case: {svg, width, height, legend, sheet, sheets, gutter, focusX} (chart.js chartSVG). */
export function partographSVG(p, settings, now, opts) {
  const anchor = new Date((p.admission && p.admission.time) || p.createdAt);
  const birth = birthTime(p) ? toMs(birthTime(p)) : null;
  const shown = e => !afterBirth(toMs(e.time), birth); // nothing after the birth (minute)
  const obsAll = activeObs(p).filter(o => o.v && shown(o)).sort(byTime);
  const meds = live(p.meds).filter(shown);
  const end = chartEnd(p, now);
  const lastT = Math.max(...finite([...obsAll.map(o => toMs(o.time)), ...meds.map(m => toMs(m.time)), end, +anchor]));
  const hours = Math.max(12, Math.ceil((lastT - anchor) / HOUR) + 1);
  const width = LEFT + hours * PXH + 20;
  const c = {
    p, proto: getProtocol(settings, p), now, anchor, hours, width, obsAll, meds, birth, idx: ackIndex(p),
    x: t => LEFT + ((toMs(t) - anchor) / HOUR) * PXH,
    fhrY: v => SEC.fhr.y + (200 - clamp(v, 80, 200)) * (SEC.fhr.h / 120), // clamped inside its band
    cmY: v => SEC.cervix.y + (10 - v) * (SEC.cervix.h / 10),
    bpY: v => SEC.pulsebp.y + (180 - clamp(v, 60, 180)) * (SEC.pulsebp.h / 120),
  };
  const grid = partoGrid(c);
  const s = grid.s + partoLines(c) + partoBaby(c) + partoMother(c);
  const k = opts.scale || 1;
  const svg = `<svg class="chart-svg" xmlns="http://www.w3.org/2000/svg" width="${width * k}" height="${HEIGHT * k}" viewBox="0 0 ${width} ${HEIGHT}" role="img" aria-label="Partograph">${s}</svg>`;
  const gut = `<svg class="chart-gutter-svg" xmlns="http://www.w3.org/2000/svg" width="${LEFT * k}" height="${HEIGHT * k}" viewBox="0 0 ${LEFT} ${HEIGHT}" style="display:block">${grid.gut}</svg>`;
  return { svg, width, height: HEIGHT, legend: PARTO_LEGEND, sheet: 1, sheets: 1, gutter: { width: LEFT, svg: gut }, focusX: c.x(end) };
}

/** Hour grid, section labels and scales; `gut` repeats the label column for the phone overlay. */
function partoGrid(c) {
  const { width, hours, anchor } = c;
  const bottom = SEC.support.y + SEC.support.h;
  let s = `<rect x="0" y="0" width="${width}" height="${HEIGHT}" fill="#fff"/>`;
  let gut = `<rect x="0" y="0" width="${LEFT}" height="${HEIGHT}" fill="#fff"/>`;
  for (let hr = 0; hr <= hours; hr++) {
    const gx = LEFT + hr * PXH;
    s += `<line x1="${gx}" y1="${SEC.header.y + 14}" x2="${gx}" y2="${bottom}" stroke="${hr % 4 === 0 ? '#b9cfc9' : '#e3edea'}" stroke-width="1"/>`;
    if (hr < hours) {
      const half = gx + PXH / 2;
      s += `<line x1="${half}" y1="${SEC.fhr.y}" x2="${half}" y2="${bottom}" stroke="#f0f5f3" stroke-width="1"/>`;
    }
    const hh = hhmm(+anchor + hr * HOUR);
    s += `<text x="${gx + 2}" y="${SEC.header.y + 10}" font-size="9" fill="#51635e" ${FONT}>${hr}h</text>`;
    s += `<text x="${gx + 2}" y="${SEC.header.y + 21}" font-size="8" fill="#8aa19a" ${FONT}>${hh}</text>`;
  }
  for (const [key, label] of P_ROWS) {
    const sec = SEC[key];
    const lbl = `<text x="6" y="${sec.h > 30 ? sec.y + 12 : sec.y + 13}" font-size="10" font-weight="600" fill="#33514a" ${FONT}>${esc(label)}</text>`;
    s += `<line x1="0" y1="${sec.y}" x2="${width}" y2="${sec.y}" stroke="#c5d6d1" stroke-width="1"/>` + lbl;
    gut += `<line x1="0" y1="${sec.y}" x2="${LEFT}" y2="${sec.y}" stroke="#c5d6d1" stroke-width="1"/>` + lbl;
  }
  s += `<line x1="0" y1="${bottom}" x2="${width}" y2="${bottom}" stroke="#c5d6d1"/>`;
  s += `<line x1="${LEFT}" y1="0" x2="${LEFT}" y2="${HEIGHT}" stroke="#9db8b1" stroke-width="1.5"/>`;
  gut += `<line x1="0" y1="${bottom}" x2="${LEFT}" y2="${bottom}" stroke="#c5d6d1"/>`
    + `<line x1="${LEFT}" y1="0" x2="${LEFT}" y2="${HEIGHT}" stroke="#9db8b1" stroke-width="1.5"/>`;
  const scale = (y, v, dx) => `<text x="${LEFT - dx}" y="${y + 3}" font-size="8" fill="#8aa19a" ${FONT}>${v}</text>`;
  for (let v = 80; v <= 200; v += 20) {
    s += `<line x1="${LEFT}" y1="${c.fhrY(v)}" x2="${width}" y2="${c.fhrY(v)}" stroke="#eef4f2"/>` + scale(c.fhrY(v), v, 26);
    gut += scale(c.fhrY(v), v, 26);
  }
  for (const v of [LIMITS.fhr.low, LIMITS.fhr.high]) {
    s += `<line x1="${LEFT}" y1="${c.fhrY(v)}" x2="${width}" y2="${c.fhrY(v)}" stroke="#c62828" stroke-dasharray="4 3" stroke-width="1"/>`;
  }
  for (let v = 0; v <= 10; v++) {
    s += `<line x1="${LEFT}" y1="${c.cmY(v)}" x2="${width}" y2="${c.cmY(v)}" stroke="#eef4f2"/>` + scale(c.cmY(v), v, 18);
    gut += scale(c.cmY(v), v, 18);
  }
  for (let v = 60; v <= 180; v += 20) {
    s += `<line x1="${LEFT}" y1="${c.bpY(v)}" x2="${width}" y2="${c.bpY(v)}" stroke="#eef4f2"/>` + scale(c.bpY(v), v, 26);
    gut += scale(c.bpY(v), v, 26);
  }
  return { s, gut };
}

/** Active phase, alert and action lines (S7), second stage, P and birth. */
function partoLines(c) {
  const { p, proto, x, cmY } = c;
  const top = SEC.header.y + 14, bottom = SEC.support.y + SEC.support.h;
  let s = '';
  if (p.activeStartTime) {
    const ax = x(p.activeStartTime);
    s += `<line x1="${ax}" y1="${top}" x2="${ax}" y2="${bottom}" stroke="#0e7a64" stroke-width="2"/>`;
    s += `<text x="${ax + 3}" y="${SEC.cervix.y - 6}" font-size="9" fill="#0e7a64" font-weight="700" ${FONT}>Active phase</text>`;
    const line = alertLineAnchor(proto, p);
    if (line) {
      // alert line: 1 cm/h from the first active dilatation (S7) to 10 cm
      const x1 = x(line.time), y1 = cmY(line.cm);
      const x2 = x(new Date(toMs(line.time) + (10 - line.cm) * HOUR)), y2 = cmY(10);
      s += `<line class="alert-line" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#f2a922" stroke-width="2"/>`;
      s += `<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 5}" font-size="9" fill="#b26a00" font-weight="700" ${FONT}>ALERT</text>`;
      const off = proto.actionLineOffsetHours * PXH;
      s += `<line class="action-line" x1="${x1 + off}" y1="${y1}" x2="${x2 + off}" y2="${y2}" stroke="#c62828" stroke-width="2"/>`;
      s += `<text x="${(x1 + x2) / 2 + off}" y="${(y1 + y2) / 2 - 5}" font-size="9" fill="#c62828" font-weight="700" ${FONT}>ACTION</text>`;
    }
  }
  if (p.secondStageStart) {
    const sx = x(p.secondStageStart);
    s += `<line x1="${sx}" y1="${top}" x2="${sx}" y2="${bottom}" stroke="#6a3fb5" stroke-width="2"/>`;
    s += `<text x="${sx + 3}" y="${SEC.cervix.y - 18}" font-size="9" fill="#6a3fb5" font-weight="700" ${FONT}>2nd stage</text>`;
  }
  const push = secondStagePushing(p);
  if (push && !afterBirth(toMs(push), c.birth)) {
    const px = x(push);
    s += `<g class="p-marker"><line x1="${px}" y1="${SEC.cervix.y}" x2="${px}" y2="${SEC.cervix.y + SEC.cervix.h}" stroke="#6a3fb5" stroke-width="1.5" stroke-dasharray="3 2"/>`
      + `<text x="${px + 3}" y="${cmY(10) + 13}" font-size="12" font-weight="800" fill="#6a3fb5" ${FONT}>P</text></g>`;
  }
  if (c.birth != null) {
    const dx = x(c.birth);
    s += `<line x1="${dx}" y1="${top}" x2="${dx}" y2="${bottom}" stroke="#2e7d32" stroke-width="2.5"/>`;
    s += `<text x="${dx + 3}" y="${SEC.fhr.y + 10}" font-size="10" fill="#2e7d32" font-weight="700" ${FONT}>BIRTH</text>`;
  }
  return s;
}

/** A code in a one-line row, circled (ack-aware) when it meets an alert criterion. */
function partoCode(c, secKey, o, fields, label, bad) {
  const sec = SEC[secKey], cx = c.x(o.time);
  const open = bad && flagState(c.idx, o, fields) !== 'ack';
  return `<text x="${cx}" y="${sec.y + 13}" font-size="10" text-anchor="middle" font-weight="${bad ? '800' : '600'}" fill="${open ? RED : INK}" ${FONT}>${esc(label)}</text>`
    + (bad ? ring(c.idx, o, fields, cx, sec.y + 9.5, Math.max(7, String(label).length * 3.2 + 4), 8) : '');
}

/** FHR, fetal codes and the cervicograph (descent shares it on the partograph). */
function partoBaby(c) {
  const by = type => c.obsAll.filter(o => o.type === type);
  let s = '';
  const fhrPts = by('baby').filter(o => o.v.fhr != null);
  if (fhrPts.length > 1) {
    s += `<polyline points="${fhrPts.map(o => `${c.x(o.time)},${c.fhrY(o.v.fhr)}`).join(' ')}" fill="none" stroke="#1565c0" stroke-width="1.5"/>`;
  }
  const offs = []; // beyond the scale: written out per half hour (offScaleStacks)
  for (const o of fhrPts) {
    const cx = c.x(o.time), cy = c.fhrY(o.v.fhr), dir = offBand(Number(o.v.fhr));
    s += `<circle cx="${cx}" cy="${cy}" r="3.2" fill="#1565c0"/>`;
    if (FLAG.fhr(o.v.fhr)) s += ring(c.idx, o, 'fhr', cx, cy, 6, 6);
    if (dir) {
      const slot = Math.floor((toMs(o.time) - +c.anchor) / (HOUR / 2));
      const fill = flagState(c.idx, o, 'fhr') === 'ack' ? MUTED : RED;
      offs.push({ slot, sx: LEFT + (slot + 0.5) * PXH / 2, edge: cy, dir, v: o.v.fhr, fill, id: o.id });
    }
  }
  s += offScaleStacks(offs, 9);
  for (const o of by('baby')) {
    if (o.v.decel) s += partoCode(c, 'decel', o, 'decel', P_DECEL[o.v.decel] || o.v.decel, FLAG.decel(o.v.decel));
    if (o.v.liquor) s += partoCode(c, 'liquor', o, 'liquor', P_LIQUOR[o.v.liquor] || o.v.liquor, FLAG.liquor(o.v.liquor));
  }
  for (const o of by('exam')) {
    if (o.v.liquor) s += partoCode(c, 'liquor', o, 'liquor', P_LIQUOR[o.v.liquor] || o.v.liquor, FLAG.liquor(o.v.liquor));
    if (o.v.position) s += partoCode(c, 'position', o, 'position', o.v.position, FLAG.position(o.v.position));
    if (o.v.caput != null) s += partoCode(c, 'caput', o, 'caput', o.v.caput === 0 ? '0' : '+'.repeat(o.v.caput), FLAG.caput(o.v.caput));
    if (o.v.moulding != null) s += partoCode(c, 'moulding', o, 'moulding', o.v.moulding === 0 ? '0' : '+'.repeat(o.v.moulding), FLAG.moulding(o.v.moulding));
  }
  const dil = by('exam').filter(o => o.v.dilatation != null);
  if (dil.length > 1) {
    s += `<polyline points="${dil.map(o => `${c.x(o.time)},${c.cmY(o.v.dilatation)}`).join(' ')}" fill="none" stroke="#0e7a64" stroke-width="2"/>`;
  }
  for (const o of dil) {
    const cx = c.x(o.time), cy = c.cmY(o.v.dilatation);
    s += `<path d="M${cx - 5},${cy - 5} L${cx + 5},${cy + 5} M${cx - 5},${cy + 5} L${cx + 5},${cy - 5}" stroke="#0e7a64" stroke-width="2.5" fill="none"/>`;
  }
  const desc = by('exam').filter(o => o.v.descent != null);
  if (desc.length > 1) {
    s += `<polyline points="${desc.map(o => `${c.x(o.time)},${c.cmY(o.v.descent)}`).join(' ')}" fill="none" stroke="#6a3fb5" stroke-width="1.5" stroke-dasharray="5 3"/>`;
  }
  for (const o of desc) s += `<circle cx="${c.x(o.time)}" cy="${c.cmY(o.v.descent)}" r="5" fill="none" stroke="#6a3fb5" stroke-width="2"/>`;
  return s;
}

/** Contractions, medication, maternal vitals, supportive care and the "now" line. */
function partoMother(c) {
  const by = type => c.obsAll.filter(o => o.type === type);
  const note = (key, t, label) => `<text x="${c.x(t)}" y="${SEC[key].y + 13}" font-size="10" text-anchor="middle" font-weight="600" fill="#1c2b28" ${FONT}>${esc(label)}</text>`;
  let s = '';
  const SHADE = { lt20: '#ffffff', b20_40: '#9cc8bd', b40_60: '#4d9982', gt60: '#0e7a64' };
  for (const o of by('contractions')) {
    if (o.v.count == null) continue;
    const hgt = Math.min(8, o.v.count) * (SEC.contr.h - 8) / 8;
    // red only where the engine raised a contraction alert (none in the latent
    // phase); a v1 entry without stored flags falls back to the value tests
    const bad = Array.isArray(o.flags)
      ? o.flags.some(code => CONTRACTION_CODES.includes(code))
      : FLAG.contractionCount(o.v.count) || FLAG.contractionDuration(o.v.duration);
    s += `<rect x="${c.x(o.time) - 6}" y="${SEC.contr.y + SEC.contr.h - hgt}" width="12" height="${hgt}" fill="${SHADE[o.v.durBand] || '#9cc8bd'}" stroke="${bad ? '#c62828' : '#33514a'}" stroke-width="${bad ? 2 : 0.8}"/>`;
  }
  for (const o of by('oxytocin')) s += note('oxy', o.time, `${o.v.uL != null ? o.v.uL + 'U' : ''}${o.v.dropsMin != null ? '@' + o.v.dropsMin : ''}`);
  for (const m of c.meds) s += note(m.kind === 'oxytocin' ? 'oxy' : 'meds', m.time, m.detail ? m.detail.slice(0, 14) : m.kind);
  const pulsePts = by('pulse').filter(o => o.v.pulse != null);
  if (pulsePts.length > 1) {
    s += `<polyline points="${pulsePts.map(o => `${c.x(o.time)},${c.bpY(o.v.pulse)}`).join(' ')}" fill="none" stroke="#b26a00" stroke-width="1.2"/>`;
  }
  for (const o of pulsePts) {
    const cx = c.x(o.time), cy = c.bpY(o.v.pulse), bad = FLAG.pulse(o.v.pulse);
    s += `<circle cx="${cx}" cy="${cy}" r="3" fill="${bad ? '#c62828' : '#b26a00'}"/>`;
    if (bad) s += ring(c.idx, o, 'pulse', cx, cy, 6, 6);
  }
  for (const o of by('vitals')) {
    if (o.v.sys != null && o.v.dia != null) {
      const cx = c.x(o.time), col = FLAG.sys(o.v.sys) || FLAG.dia(o.v.dia) ? '#c62828' : '#1c2b28';
      s += `<line x1="${cx}" y1="${c.bpY(o.v.sys)}" x2="${cx}" y2="${c.bpY(o.v.dia)}" stroke="${col}" stroke-width="2"/>`;
      s += `<path d="M${cx - 4},${c.bpY(o.v.sys) + 4} L${cx},${c.bpY(o.v.sys)} L${cx + 4},${c.bpY(o.v.sys) + 4}" fill="none" stroke="${col}" stroke-width="1.5"/>`;
      s += `<path d="M${cx - 4},${c.bpY(o.v.dia) - 4} L${cx},${c.bpY(o.v.dia)} L${cx + 4},${c.bpY(o.v.dia) - 4}" fill="none" stroke="${col}" stroke-width="1.5"/>`;
    }
    if (o.v.temp != null) s += partoCode(c, 'temp', o, 'temp', Number(o.v.temp).toFixed(1), FLAG.temp(o.v.temp));
    const graded = key => (urineGrade(o.v[key]) > 0 ? (key === 'protein' ? 'P' : 'A') + urineText(o.v[key]) : '');
    const ur = [graded('protein'), graded('acetone')].filter(Boolean).join(' ');
    if (ur || o.v.urineVoided) s += partoCode(c, 'urine', o, ['protein', 'acetone'], ur || '✓', FLAG.urine(o.v.protein) || FLAG.urine(o.v.acetone));
  }
  // supportive care: a tick when all is well, else the codes that are alert values
  for (const o of by('supportive')) {
    const miss = [];
    if (o.v.companion === 'N') miss.push(['C', 'companion']);
    if (o.v.painRelief === 'N') miss.push(['PR', 'painRelief']);
    if (o.v.oralFluid === 'N') miss.push(['F', 'oralFluid']);
    if (isSupine(o.v.posture)) miss.push(['SP', 'posture']);
    s += partoCode(c, 'support', o, miss.map(m => m[1]), miss.length ? miss.map(m => m[0]).join('·') : '✓', miss.length > 0);
  }
  if (c.birth == null && isLabouring(c.p) && +c.now > +c.anchor) {
    const nx = c.x(c.now);
    s += `<line x1="${nx}" y1="${SEC.header.y + 14}" x2="${nx}" y2="${SEC.support.y + SEC.support.h}" stroke="#1565c0" stroke-width="1" stroke-dasharray="3 3" opacity="0.7"/>`;
  }
  return s;
}

// ------------------------------------------------- print, both layouts ----

/** The header of every printed page; `part` is [label, value], e.g. ['Sheet', '1 of 2']. */
export function printHead(p, settings, part, now) {
  const proto = getProtocol(settings, p);
  const adm = (p.admission && p.admission.time) || p.createdAt;
  const ec = settings && settings.ethiopianDates && adm ? ` (${formatEthiopic(eatDate(new Date(adm)), settings.lang)})` : '';
  const items = [
    ['Name', p.name || '-'], ['MRN', p.mrn || '-'], ['Admitted', adm ? fullDate(adm) + ec : '-'],
    ['Protocol', proto.name], ['Facility', (settings && settings.facilityName) || '-'],
    part, ['Printed', fullDate(now)],
  ];
  return `<header class="print-head"><strong>${proto.alertActionLines ? 'Partograph' : 'WHO Labour Care Guide'}</strong>`
    + items.map(([k, v]) => `<span><b>${k}:</b> ${esc(v)}</span>`).join('') + '</header>';
}

const MED_KIND = { medicine: 'Medicine', ivfluid: 'IV fluids', oxytocin: 'Oxytocin' };

/** A medication entry in words: its detail, and for oxytocin the concentration and rate. */
function medText(m) {
  const parts = [m.detail, m.oxyUL != null ? `${m.oxyUL} U/L` : '', m.oxyDrops != null ? `${m.oxyDrops} drops/min` : ''];
  return parts.map(x => String(x ?? '').trim()).filter(Boolean).join(', ');
}

/**
 * The appendix after the last sheet: the sheet cuts long assessment, plan and
 * medicine text with "...", so every note and medication entry that stands
 * (never a voided one) is written out in full, oldest first. '' when none.
 */
export function notesAppendix(p, settings, now) {
  const notes = live(p.notes).filter(x => x.text || x.plan).sort(byTime);
  const meds = live(p.meds).sort(byTime);
  if (!notes.length && !meds.length) return '';
  const td = v => `<td>${esc(v == null || String(v).trim() === '' ? '-' : v)}</td>`;
  const table = (cls, head, rows) => `<table class="${cls}"><thead><tr>${head.map(x => `<th>${x}</th>`).join('')}</tr></thead>`
    + `<tbody>${rows.join('')}</tbody></table>`;
  let html = `<section class="print-notes">${printHead(p, settings, ['Appendix', 'notes and medication in full'], now)}`;
  if (notes.length) {
    html += '<h3>Assessment and plan</h3>' + table('print-notes-list', ['Time', 'Initials', 'Assessment', 'Plan'],
      notes.map(x => `<tr>${td(fullDate(x.time))}${td(x.by)}${td(x.text)}${td(planText(x))}</tr>`));
  }
  if (meds.length) {
    html += '<h3>Medication</h3>' + table('print-meds-list', ['Time', 'Initials', 'Kind', 'Detail'],
      meds.map(m => `<tr>${td(fullDate(m.time))}${td(m.by)}${td(own(MED_KIND, m.kind) ? MED_KIND[m.kind] : m.kind)}${td(medText(m))}</tr>`));
  }
  return html + '</section>';
}
