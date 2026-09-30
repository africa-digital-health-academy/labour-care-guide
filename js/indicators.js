// indicators.js - facility indicators (N1), computed from this device's own
// records: the six indicators of the WHO LCG implementation resource package
// (2025, Table 3) plus the monthly HMIS counts v1 showed on the Reports
// screen (moved out of the view - S13).
//
// Counting rules: births are counted by BIRTH date and admissions by
// admission date; demo cases never count. Pure: no DOM, no I/O.

import { LIMITS, getProtocol, activeObs, toMs, byTime } from './protocol.js';
import { auditCase } from './audit.js';
import { bloodLossTotal } from './alerts.js';

export const MONITORED_MIN_ENTRIES = 4; // v1 reporting definition of a monitored labour

export function isDemo(p) {
  return p.demo === true || /^DEMO\b/i.test(p.mrn || '') || /^DEMO\b/i.test(p.name || '');
}

function inRange(t, range) {
  if (!t) return false;
  if (!range) return true;
  const x = toMs(t);
  if (range.from && x < toMs(range.from)) return false;
  if (range.to && x >= toMs(range.to)) return false;
  return true;
}

const ratio = (n, d) => ({ n, d, rate: d ? n / d : null });

// ------------------------------------------------------------ admission ----

function admissionEntries(p, type) {
  const t = p.admission && p.admission.time;
  return activeObs(p).filter(o => o.type === type && (o.source === 'admission' || (t && toMs(o.time) === toMs(t))));
}

function admissionFHR(p) {
  if (p.admission && p.admission.fhr != null) return Number(p.admission.fhr);
  const o = admissionEntries(p, 'baby').find(x => x.v && x.v.fhr != null);
  return o ? Number(o.v.fhr) : null;
}

/** Table 3: the baby's FHR documented on admission to the labour ward. */
export function fhrOnAdmission(p) {
  return admissionFHR(p) != null;
}

/** Table 3: blood pressure measured on admission to the labour ward. */
export function bpOnAdmission(p) {
  const a = p.admission || {};
  if (a.sys != null && a.dia != null) return true;
  return admissionEntries(p, 'vitals').some(o => o.v && o.v.sys != null && o.v.dia != null);
}

// ------------------------------------------------------------ companion ----

function companionRecords(p) {
  const out = activeObs(p).filter(o => o.type === 'supportive' && o.v && o.v.companion)
    .map(o => ({ time: o.time, value: o.v.companion }));
  const a = p.admission;
  if (a && a.companion && !out.some(r => toMs(r.time) === toMs(a.time))) out.push({ time: a.time, value: a.companion });
  return out;
}

/**
 * Did she want a companion of her choice? The explicit admission answer when
 * recorded; otherwise Y anywhere = wanted, D = declined. Records holding only
 * N are unknown: v1 had no D code, so N also stood for "declined".
 */
export function companionWanted(p) {
  if (typeof p.companionWanted === 'boolean') return p.companionWanted;
  const vals = companionRecords(p).map(r => r.value);
  if (vals.includes('Y')) return true;
  if (vals.includes('D')) return false;
  return null;
}

/** Had a companion (Y) during labour and childbirth, or during one stage. */
export function hadCompanion(p, stage) {
  const split = p.secondStageStart ? toMs(p.secondStageStart) : Infinity;
  return companionRecords(p).some(r => r.value === 'Y'
    && (!stage || (stage === 'first' ? toMs(r.time) < split : toMs(r.time) >= split)));
}

// --------------------------------------------------------------- Robson ----

function fetalPresentation(p) {
  if (p.delivery && p.delivery.mode === 'breech') return 'breech';
  const withPres = activeObs(p).filter(o => o.type === 'exam' && o.v && o.v.presentation).sort(byTime);
  const last = withPres[withPres.length - 1];
  return (last && last.v.presentation) || (p.admission && p.admission.presentation) || null;
}

/**
 * Robson Ten-Group Classification (WHO Robson classification implementation
 * manual, 2017): '1', '2a', '2b', '3', '4a', '4b', '5' ... '10', or null when a
 * variable is missing. 'b' groups are caesareans before labour, which a
 * labour record rarely holds. A presentation recorded as 'other' is left
 * unclassified rather than guessed.
 */
export function robsonGroup(p) {
  if (p.para == null || p.para === '' || !Number.isFinite(Number(p.para))) return null;
  const nulli = Number(p.para) === 0;
  const risks = p.riskFactors || [];
  if (risks.includes('multiple')) return '8';
  const pres = fetalPresentation(p);
  if (pres === 'transverse') return '9';
  if (pres === 'breech') return nulli ? '6' : '7';
  if (pres !== 'cephalic') return null;
  const ga = Number(p.gaWeeks);
  if (p.gaWeeks == null || p.gaWeeks === '' || !Number.isFinite(ga)) return null;
  if (ga < 37) return '10';
  if (!nulli && risks.includes('prior_cs')) return '5';
  if (p.onsetMode === 'spontaneous') return nulli ? '1' : '3';
  if (p.onsetMode === 'induced') return nulli ? '2a' : '4a';
  if (p.onsetMode === 'cs_before_labour') return nulli ? '2b' : '4b';
  return null;
}

// ------------------------------------------------------------ stillbirth ----

/** Table 3 definition: no signs of life, born after 28 weeks or weighing at least 1000 g. */
export function countsAsStillbirth(p) {
  const d = p.delivery;
  if (!d || !d.outcome || d.outcome === 'live') return false;
  const ga = Number(p.gaWeeks);
  const gaKnown = p.gaWeeks != null && p.gaWeeks !== '' && Number.isFinite(ga);
  const w = p.newborn ? Number(p.newborn.weightG) : NaN;
  const wKnown = !!p.newborn && p.newborn.weightG != null && Number.isFinite(w);
  if (!gaKnown && !wKnown) return true;
  return (gaKnown && ga >= 28) || (wKnown && w >= 1000);
}

/**
 * Table 3 disaggregations: antepartum/intrapartum (explicit, else macerated =
 * antepartum and fresh = intrapartum, the usual proxy) and before/after
 * admission (explicit, else FHR heard on admission = death after admission).
 */
export function stillbirthDetail(p) {
  const d = p.delivery;
  if (!d || !d.outcome || d.outcome === 'live') return null;
  const timing = d.stillbirthTiming
    || (d.outcome === 'sb_macerated' ? 'antepartum' : d.outcome === 'sb_fresh' ? 'intrapartum' : 'unknown');
  let admission = d.stillbirthAdmission || 'unknown';
  if (!d.stillbirthAdmission) {
    const fhr = admissionFHR(p);
    if (fhr != null) admission = fhr > 0 ? 'after' : 'before';
  }
  return { timing, admission };
}

// ------------------------------------------------------------ indicators ----

/**
 * The six WHO LCG implementation indicators (IRP Table 3) for births in
 * [from, to). Each is {n, d, rate}; rate is null when the denominator is 0.
 */
export function computeIndicators(cases, { from = null, to = null, settings = {}, now = new Date() } = {}) {
  const range = from || to ? { from, to } : null;
  const births = (cases || []).filter(p => !isDemo(p) && p.delivery && inRange(p.delivery.time, range));
  const D = births.length;

  const lcgDone = births.filter(p => auditCase(p, getProtocol(settings, p), now).completed).length;

  let wanted = 0, had = 0, unknown = 0, hadFirst = 0, hadSecond = 0;
  for (const p of births) {
    const w = companionWanted(p);
    if (w === null) { unknown++; continue; }
    if (!w) continue;
    wanted++;
    if (hadCompanion(p)) had++;
    if (hadCompanion(p, 'first')) hadFirst++;
    if (hadCompanion(p, 'second')) hadSecond++;
  }

  const robson = {};
  for (const p of births) {
    const g = robsonGroup(p) || 'unclassified';
    const r = robson[g] || (robson[g] = { births: 0, cs: 0 });
    r.births++;
    if (p.delivery.mode === 'cs') r.cs++;
  }

  const counted = births.filter(p => p.delivery.outcome === 'live' || countsAsStillbirth(p));
  const sb = counted.filter(countsAsStillbirth);
  const split = { antepartum: 0, intrapartum: 0, timingUnknown: 0, beforeAdmission: 0, afterAdmission: 0, admissionUnknown: 0 };
  for (const p of sb) {
    const s = stillbirthDetail(p);
    if (s.timing === 'antepartum') split.antepartum++;
    else if (s.timing === 'intrapartum') split.intrapartum++;
    else split.timingUnknown++;
    if (s.admission === 'before') split.beforeAdmission++;
    else if (s.admission === 'after') split.afterAdmission++;
    else split.admissionUnknown++;
  }

  return {
    range: { from, to },
    births: D,
    lcgUse: ratio(lcgDone, D),
    fhrOnAdmission: ratio(births.filter(fhrOnAdmission).length, D),
    bpOnAdmission: ratio(births.filter(bpOnAdmission).length, D),
    companion: { ...ratio(had, wanted), unknown, byStage: { first: ratio(hadFirst, wanted), second: ratio(hadSecond, wanted) } },
    caesarean: { ...ratio(births.filter(p => p.delivery.mode === 'cs').length, D), robson },
    stillbirths: { ...ratio(sb.length, counted.length), ...split },
  };
}

/** PPH for reporting: the trigger volume was reached, or a PPH alert or emergency was recorded. */
function pphRecorded(p) {
  return bloodLossTotal(p) >= LIMITS.pph.volume || (p.alerts || []).some(a => a.code === 'pph' || a.code === 'emg_pph');
}

/** The monthly HMIS counts of the v1 Reports screen, with the counting rules above. */
export function hmisCounts(cases, { from = null, to = null } = {}) {
  const range = from || to ? { from, to } : null;
  const real = (cases || []).filter(p => !isDemo(p));
  const admitted = real.filter(p => inRange((p.admission && p.admission.time) || p.createdAt, range));
  const births = real.filter(p => p.delivery && inRange(p.delivery.time, range));
  const live = births.filter(p => p.delivery.outcome === 'live');
  return {
    admissions: admitted.length,
    births: births.length,
    live: live.length,
    stillbirths: births.length - live.length,
    lowApgar: live.filter(p => p.newborn && p.newborn.apgar5 && p.newborn.apgar5.total != null
      && p.newborn.apgar5.total < LIMITS.apgarLow).length,
    pph: births.filter(pphRecorded).length,
    referred: real.filter(p => p.referral && inRange(p.referral.time, range)).length,
    monitored: admitted.filter(p => activeObs(p).length >= MONITORED_MIN_ENTRIES).length,
  };
}

// ------------------------------------------------------------------- CSV ----

const BOM = String.fromCharCode(0xfeff); // UTF-8 byte-order mark
const FORMULA_START = /^[=+\-@\t\r]/;

/** One CSV cell: quoted, with a guard against spreadsheet formula injection. */
export function csvCell(x) {
  if (x === null || x === undefined) return '""';
  let s = String(x);
  if (typeof x === 'string' && FORMULA_START.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

/** CSV text with a UTF-8 byte-order mark, so Excel reads Ge'ez names correctly. */
export function toCSV(rows) {
  return BOM + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** Indicator table rows for export. */
export function indicatorRows(ind) {
  const pct = r => (r.rate == null ? '' : (100 * r.rate).toFixed(1));
  const src = 'WHO LCG implementation resource package 2025, Table 3';
  const rows = [['indicator', 'numerator', 'denominator', 'percent', 'note']];
  rows.push(['LCG completed for the birth', ind.lcgUse.n, ind.lcgUse.d, pct(ind.lcgUse), src]);
  rows.push(['FHR documented on admission', ind.fhrOnAdmission.n, ind.fhrOnAdmission.d, pct(ind.fhrOnAdmission), src]);
  rows.push(['BP measured on admission', ind.bpOnAdmission.n, ind.bpOnAdmission.d, pct(ind.bpOnAdmission), src]);
  rows.push(['Wanted and had a companion of choice', ind.companion.n, ind.companion.d, pct(ind.companion),
    `wish not recorded for ${ind.companion.unknown}`]);
  rows.push(['Caesarean section rate', ind.caesarean.n, ind.caesarean.d, pct(ind.caesarean), src]);
  for (const g of Object.keys(ind.caesarean.robson).sort((a, b) => (parseInt(a, 10) || 99) - (parseInt(b, 10) || 99) || a.localeCompare(b))) {
    const r = ind.caesarean.robson[g];
    rows.push([`Caesarean rate, Robson group ${g}`, r.cs, r.births, pct(ratio(r.cs, r.births)), '']);
  }
  const s = ind.stillbirths;
  rows.push(['Institutional stillbirths', s.n, s.d, pct(s),
    `antepartum ${s.antepartum}, intrapartum ${s.intrapartum}; before admission ${s.beforeAdmission}, after admission ${s.afterAdmission}`]);
  return rows;
}
