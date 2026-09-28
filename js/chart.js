// chart.js — SVG partograph / Labour Care Guide chart.
// Mirrors the paper layout midwives already know: time runs left→right,
// sections stacked: FHR → fetal codes → cervicograph → contractions →
// medication → maternal vitals. The graph is generated automatically from
// wizard entries — the midwife never draws anything by hand.
//
// Protocol-aware: Ethiopian mode draws the classic alert + action lines;
// LCG mode draws per-centimetre "progress limit" windows instead.

import { getProtocol, exams, timeReachedCurrentDilatation, LIMITS } from './protocol.js';
import { APP_TZ } from './ui.js';

const PXH = 64;        // pixels per hour
const LEFT = 118;      // label gutter
const FONT = 'font-family="Segoe UI, sans-serif"';

// section vertical layout
const SEC = {
  header:   { y: 0,   h: 26 },
  fhr:      { y: 30,  h: 112 },  // 200 → 80 bpm
  decel:    { y: 148, h: 18 },
  liquor:   { y: 166, h: 18 },
  position: { y: 184, h: 18 },
  caput:    { y: 202, h: 18 },
  moulding: { y: 220, h: 18 },
  cervix:   { y: 244, h: 220 }, // 10 → 0 cm
  contr:    { y: 474, h: 76 },  // 0–8 per 10 min
  oxy:      { y: 556, h: 20 },
  meds:     { y: 576, h: 20 },
  pulsebp:  { y: 604, h: 120 }, // 180 → 60
  temp:     { y: 730, h: 18 },
  urine:    { y: 748, h: 18 },
  support:  { y: 766, h: 18 },
};
const HEIGHT = 792;

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

export function renderChart(patient, settings) {
  const proto = getProtocol(settings, patient);
  const anchorISO = (patient.admission && patient.admission.time) || patient.createdAt;
  const anchor = new Date(anchorISO);
  const now = new Date();

  const allTimes = (patient.obs || []).map(o => +new Date(o.time))
    .concat((patient.meds || []).map(m => +new Date(m.time)), [+now]);
  const lastT = Math.max(...allTimes, +anchor);
  const hours = Math.max(12, Math.ceil((lastT - anchor) / 3600000) + 1);
  const width = LEFT + hours * PXH + 20;

  const x = t => LEFT + ((new Date(t) - anchor) / 3600000) * PXH;
  const fhrY = v => SEC.fhr.y + (200 - v) * (SEC.fhr.h / 120);
  const cmY = v => SEC.cervix.y + (10 - v) * (SEC.cervix.h / 10);
  const bpY = v => SEC.pulsebp.y + (180 - Math.min(180, Math.max(60, v))) * (SEC.pulsebp.h / 120);

  let s = '';

  // ---------- background grid ----------
  s += `<rect x="0" y="0" width="${width}" height="${HEIGHT}" fill="#fff"/>`;
  for (let hr = 0; hr <= hours; hr++) {
    const gx = LEFT + hr * PXH;
    s += `<line x1="${gx}" y1="${SEC.header.y + 14}" x2="${gx}" y2="${SEC.support.y + SEC.support.h}" stroke="${hr % 4 === 0 ? '#b9cfc9' : '#e3edea'}" stroke-width="1"/>`;
    if (hr < hours) {
      const half = gx + PXH / 2;
      s += `<line x1="${half}" y1="${SEC.fhr.y}" x2="${half}" y2="${SEC.support.y + SEC.support.h}" stroke="#f0f5f3" stroke-width="1"/>`;
    }
    const clock = new Date(+anchor + hr * 3600000);
    const hh = clock.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: APP_TZ });
    s += `<text x="${gx + 2}" y="${SEC.header.y + 10}" font-size="9" fill="#51635e" ${FONT}>${hr}h</text>`;
    s += `<text x="${gx + 2}" y="${SEC.header.y + 21}" font-size="8" fill="#8aa19a" ${FONT}>${hh}</text>`;
  }

  // section separators + gutter labels
  const gutterRows = [
    ['fhr', 'FHR (bpm)'], ['decel', 'Decelerations'], ['liquor', 'Amniotic fluid'],
    ['position', 'Position'], ['caput', 'Caput'], ['moulding', 'Moulding'],
    ['cervix', 'Cervix [X] / Descent [O]'], ['contr', 'Contractions /10min'],
    ['oxy', 'Oxytocin'], ['meds', 'Medicine / IV fluids'],
    ['pulsebp', 'Pulse [•] / BP [I]'], ['temp', 'Temp °C'], ['urine', 'Urine'], ['support', 'Supportive care'],
  ];
  for (const [key, label] of gutterRows) {
    const sec = SEC[key];
    s += `<line x1="0" y1="${sec.y}" x2="${width}" y2="${sec.y}" stroke="#c5d6d1" stroke-width="1"/>`;
    const ty = sec.h > 30 ? sec.y + 12 : sec.y + 13;
    s += `<text x="6" y="${ty}" font-size="10" font-weight="600" fill="#33514a" ${FONT}>${esc(label)}</text>`;
  }
  s += `<line x1="0" y1="${SEC.support.y + SEC.support.h}" x2="${width}" y2="${SEC.support.y + SEC.support.h}" stroke="#c5d6d1"/>`;
  s += `<line x1="${LEFT}" y1="0" x2="${LEFT}" y2="${HEIGHT}" stroke="#9db8b1" stroke-width="1.5"/>`;

  // ---------- FHR scale + normal band ----------
  for (let v = 80; v <= 200; v += 20) {
    s += `<line x1="${LEFT}" y1="${fhrY(v)}" x2="${width}" y2="${fhrY(v)}" stroke="#eef4f2"/>`;
    s += `<text x="${LEFT - 26}" y="${fhrY(v) + 3}" font-size="8" fill="#8aa19a" ${FONT}>${v}</text>`;
  }
  s += `<line x1="${LEFT}" y1="${fhrY(LIMITS.fhr.low)}" x2="${width}" y2="${fhrY(LIMITS.fhr.low)}" stroke="#c62828" stroke-dasharray="4 3" stroke-width="1"/>`;
  s += `<line x1="${LEFT}" y1="${fhrY(LIMITS.fhr.high)}" x2="${width}" y2="${fhrY(LIMITS.fhr.high)}" stroke="#c62828" stroke-dasharray="4 3" stroke-width="1"/>`;

  // ---------- cervix scale ----------
  for (let v = 0; v <= 10; v++) {
    s += `<line x1="${LEFT}" y1="${cmY(v)}" x2="${width}" y2="${cmY(v)}" stroke="#eef4f2"/>`;
    s += `<text x="${LEFT - 18}" y="${cmY(v) + 3}" font-size="8" fill="#8aa19a" ${FONT}>${v}</text>`;
  }

  // ---------- pulse/BP scale ----------
  for (let v = 60; v <= 180; v += 20) {
    s += `<line x1="${LEFT}" y1="${bpY(v)}" x2="${width}" y2="${bpY(v)}" stroke="#eef4f2"/>`;
    s += `<text x="${LEFT - 26}" y="${bpY(v) + 3}" font-size="8" fill="#8aa19a" ${FONT}>${v}</text>`;
  }

  // ---------- protocol lines ----------
  if (patient.activeStartTime) {
    const ax = x(patient.activeStartTime);
    s += `<line x1="${ax}" y1="${SEC.header.y + 14}" x2="${ax}" y2="${SEC.support.y + SEC.support.h}" stroke="#0e7a64" stroke-width="2"/>`;
    s += `<text x="${ax + 3}" y="${SEC.cervix.y - 6}" font-size="9" fill="#0e7a64" font-weight="700" ${FONT}>Active phase</text>`;

    if (proto.alertActionLines) {
      // alert line: 1 cm/h from activeStartCm → 10 cm
      const dur = (10 - proto.activeStartCm) * 3600000;
      const x1 = ax, y1 = cmY(proto.activeStartCm);
      const x2 = x(new Date(+new Date(patient.activeStartTime) + dur)), y2 = cmY(10);
      s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#f2a922" stroke-width="2"/>`;
      s += `<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 5}" font-size="9" fill="#b26a00" font-weight="700" ${FONT}>ALERT</text>`;
      const off = proto.actionLineOffsetHours * PXH;
      s += `<line x1="${x1 + off}" y1="${y1}" x2="${x2 + off}" y2="${y2}" stroke="#c62828" stroke-width="2"/>`;
      s += `<text x="${(x1 + x2) / 2 + off}" y="${(y1 + y2) / 2 - 5}" font-size="9" fill="#c62828" font-weight="700" ${FONT}>ACTION</text>`;
    } else if (proto.dilatationLagMin) {
      // LCG: show the current "no-progress window" for the latest dilatation
      const reach = timeReachedCurrentDilatation(patient);
      if (reach && proto.dilatationLagMin[reach.cm] && !patient.delivery) {
        const limMin = proto.dilatationLagMin[reach.cm];
        const lx1 = x(reach.since), lx2 = x(new Date(+new Date(reach.since) + limMin * 60000));
        const ly = cmY(reach.cm);
        s += `<line x1="${lx1}" y1="${ly}" x2="${lx2}" y2="${ly}" stroke="#c62828" stroke-width="3" stroke-dasharray="6 4" opacity="0.55"/>`;
        s += `<line x1="${lx2}" y1="${ly - 7}" x2="${lx2}" y2="${ly + 7}" stroke="#c62828" stroke-width="2.5"/>`;
        s += `<text x="${lx2 + 3}" y="${ly - 4}" font-size="9" fill="#c62828" font-weight="700" ${FONT}>limit ${limMin / 60}h @ ${reach.cm}cm</text>`;
      }
    }
  }
  if (patient.secondStageStart) {
    const sx = x(patient.secondStageStart);
    s += `<line x1="${sx}" y1="${SEC.header.y + 14}" x2="${sx}" y2="${SEC.support.y + SEC.support.h}" stroke="#6a3fb5" stroke-width="2"/>`;
    s += `<text x="${sx + 3}" y="${SEC.cervix.y - 18}" font-size="9" fill="#6a3fb5" font-weight="700" ${FONT}>2nd stage</text>`;
  }
  if (patient.delivery && patient.delivery.time) {
    const dx = x(patient.delivery.time);
    s += `<line x1="${dx}" y1="${SEC.header.y + 14}" x2="${dx}" y2="${SEC.support.y + SEC.support.h}" stroke="#2e7d32" stroke-width="2.5"/>`;
    s += `<text x="${dx + 3}" y="${SEC.fhr.y + 10}" font-size="10" fill="#2e7d32" font-weight="700" ${FONT}>BIRTH</text>`;
  }

  // ---------- plot observations ----------
  const obs = (patient.obs || []).slice().sort((a, b) => a.time.localeCompare(b.time));
  const by = type => obs.filter(o => o.type === type);

  // FHR polyline + dots
  const fhrPts = by('baby').filter(o => o.v.fhr != null);
  if (fhrPts.length > 1) {
    s += `<polyline points="${fhrPts.map(o => `${x(o.time)},${fhrY(o.v.fhr)}`).join(' ')}" fill="none" stroke="#1565c0" stroke-width="1.5"/>`;
  }
  for (const o of fhrPts) {
    const bad = o.v.fhr < LIMITS.fhr.low || o.v.fhr >= LIMITS.fhr.high;
    s += `<circle cx="${x(o.time)}" cy="${fhrY(o.v.fhr)}" r="${bad ? 5 : 3.2}" fill="${bad ? '#fff' : '#1565c0'}" stroke="${bad ? '#c62828' : '#1565c0'}" stroke-width="${bad ? 2.5 : 1}"/>`;
  }

  // code rows
  const code = (secKey, t, label, bad) => {
    const sec = SEC[secKey];
    return `<text x="${x(t)}" y="${sec.y + 13}" font-size="10" text-anchor="middle" font-weight="${bad ? '800' : '600'}" fill="${bad ? '#c62828' : '#1c2b28'}" ${FONT}>${esc(label)}</text>`;
  };
  const DECEL_LBL = { none: '—', early: 'E', variable: 'V', late: 'L', prolonged: 'P!' };
  for (const o of by('baby')) {
    if (o.v.decel) s += code('decel', o.time, DECEL_LBL[o.v.decel] || o.v.decel, o.v.decel === 'late' || o.v.decel === 'prolonged');
    if (o.v.liquor) s += code('liquor', o.time, o.v.liquor === 'M3' ? 'M+++' : o.v.liquor, o.v.liquor === 'M3' || o.v.liquor === 'B');
  }
  for (const o of by('exam')) {
    if (o.v.liquor) s += code('liquor', o.time, o.v.liquor === 'M3' ? 'M+++' : o.v.liquor, o.v.liquor === 'M3' || o.v.liquor === 'B');
    if (o.v.position) s += code('position', o.time, o.v.position, o.v.position === 'OP' || o.v.position === 'OT');
    if (o.v.caput != null) s += code('caput', o.time, o.v.caput === 0 ? '0' : '+'.repeat(o.v.caput), o.v.caput >= 3);
    if (o.v.moulding != null) s += code('moulding', o.time, o.v.moulding === 0 ? '0' : '+'.repeat(o.v.moulding), o.v.moulding >= 3);
  }

  // cervicograph: dilatation X, descent O
  const dil = by('exam').filter(o => o.v.dilatation != null);
  if (dil.length > 1) {
    s += `<polyline points="${dil.map(o => `${x(o.time)},${cmY(o.v.dilatation)}`).join(' ')}" fill="none" stroke="#0e7a64" stroke-width="2"/>`;
  }
  for (const o of dil) {
    const cx = x(o.time), cy = cmY(o.v.dilatation);
    s += `<path d="M${cx - 5},${cy - 5} L${cx + 5},${cy + 5} M${cx - 5},${cy + 5} L${cx + 5},${cy - 5}" stroke="#0e7a64" stroke-width="2.5" fill="none"/>`;
  }
  const desc = by('exam').filter(o => o.v.descent != null);
  if (desc.length > 1) {
    s += `<polyline points="${desc.map(o => `${x(o.time)},${cmY(o.v.descent)}`).join(' ')}" fill="none" stroke="#6a3fb5" stroke-width="1.5" stroke-dasharray="5 3"/>`;
  }
  for (const o of desc) {
    s += `<circle cx="${x(o.time)}" cy="${cmY(o.v.descent)}" r="5" fill="none" stroke="#6a3fb5" stroke-width="2"/>`;
  }

  // contractions bars (shade = duration band)
  const SHADE = { lt20: '#ffffff', b20_40: '#9cc8bd', b40_60: '#4d9982', gt60: '#0e7a64' };
  for (const o of by('contractions')) {
    if (o.v.count == null) continue;
    const bx = x(o.time) - 6;
    const hgt = Math.min(8, o.v.count) * (SEC.contr.h - 8) / 8;
    const byTop = SEC.contr.y + SEC.contr.h - hgt;
    const bad = o.v.count > LIMITS.contractions.high || o.v.count <= LIMITS.contractions.low;
    s += `<rect x="${bx}" y="${byTop}" width="12" height="${hgt}" fill="${SHADE[o.v.durBand] || '#9cc8bd'}" stroke="${bad ? '#c62828' : '#33514a'}" stroke-width="${bad ? 2 : 0.8}"/>`;
  }

  // oxytocin + meds
  for (const o of by('oxytocin')) {
    s += code('oxy', o.time, `${o.v.uL != null ? o.v.uL + 'U' : ''}${o.v.dropsMin != null ? '@' + o.v.dropsMin : ''}`, false);
  }
  for (const m of (patient.meds || [])) {
    const row = m.kind === 'oxytocin' ? 'oxy' : 'meds';
    s += code(row, m.time, m.detail ? m.detail.slice(0, 14) : m.kind, false);
  }

  // pulse + BP
  const pulsePts = by('pulse').filter(o => o.v.pulse != null);
  if (pulsePts.length > 1) {
    s += `<polyline points="${pulsePts.map(o => `${x(o.time)},${bpY(o.v.pulse)}`).join(' ')}" fill="none" stroke="#b26a00" stroke-width="1.2"/>`;
  }
  for (const o of pulsePts) {
    const bad = o.v.pulse < LIMITS.pulse.low || o.v.pulse >= LIMITS.pulse.high;
    s += `<circle cx="${x(o.time)}" cy="${bpY(o.v.pulse)}" r="3" fill="${bad ? '#c62828' : '#b26a00'}"/>`;
  }
  for (const o of by('vitals')) {
    if (o.v.sys != null && o.v.dia != null) {
      const cx = x(o.time);
      const bad = o.v.sys >= LIMITS.sys.high || o.v.dia >= LIMITS.dia.high || o.v.sys < LIMITS.sys.shock;
      const col = bad ? '#c62828' : '#1c2b28';
      s += `<line x1="${cx}" y1="${bpY(o.v.sys)}" x2="${cx}" y2="${bpY(o.v.dia)}" stroke="${col}" stroke-width="2"/>`;
      s += `<path d="M${cx - 4},${bpY(o.v.sys) + 4} L${cx},${bpY(o.v.sys)} L${cx + 4},${bpY(o.v.sys) + 4}" fill="none" stroke="${col}" stroke-width="1.5"/>`;
      s += `<path d="M${cx - 4},${bpY(o.v.dia) - 4} L${cx},${bpY(o.v.dia)} L${cx + 4},${bpY(o.v.dia) - 4}" fill="none" stroke="${col}" stroke-width="1.5"/>`;
    }
    if (o.v.temp != null) s += code('temp', o.time, o.v.temp.toFixed(1), o.v.temp >= LIMITS.temp.high || o.v.temp < LIMITS.temp.low);
    const ur = [o.v.protein && o.v.protein !== 'nil' ? 'P' + o.v.protein : '', o.v.acetone && o.v.acetone !== 'nil' ? 'A' + o.v.acetone : ''].filter(Boolean).join(' ');
    if (ur || o.v.urineVoided) s += code('urine', o.time, ur || '✓', /\+\+/.test(ur));
  }

  // supportive care row: ✓ all good, letter of what is missing
  for (const o of by('supportive')) {
    const miss = [];
    if (o.v.companion === 'N') miss.push('C');
    if (o.v.oralFluid === 'N') miss.push('F');
    if (o.v.posture === 'supine') miss.push('SP');
    s += code('support', o.time, miss.length ? miss.join('·') : '✓', miss.length > 0);
  }

  // "now" marker
  if (!patient.delivery && +now > +anchor) {
    const nx = x(now);
    s += `<line x1="${nx}" y1="${SEC.header.y + 14}" x2="${nx}" y2="${SEC.support.y + SEC.support.h}" stroke="#1565c0" stroke-width="1" stroke-dasharray="3 3" opacity="0.7"/>`;
  }

  const svg = `<svg class="chart-svg" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${HEIGHT}" viewBox="0 0 ${width} ${HEIGHT}">${s}</svg>`;

  const wrap = document.createElement('div');
  wrap.className = 'chart-scroll';
  wrap.innerHTML = svg + `<div class="chart-legend">
    X dilatation (cm) · O descent (fifths above brim) · bars: contractions per 10 min (darker = longer) ·
    I/C/M/B amniotic fluid · E/V/L early-variable-late decelerations ·
    ${proto.alertActionLines ? 'orange ALERT and red ACTION lines per Ethiopian modified WHO partograph' : 'red dashed bar = WHO LCG progress time-limit at current dilatation'} ·
    supportive care: ✓ ok, C no companion, F no fluids, SP supine</div>`;
  // auto-scroll to the most recent data
  requestAnimationFrame(() => { wrap.scrollLeft = wrap.scrollWidth; });
  return wrap;
}
