// indicators.js - facility indicators (N1), computed from this device's own
// records: the six indicators of the WHO LCG implementation resource package
// (2025, Table 3) plus the monthly HMIS counts v1 showed on the Reports
// screen (moved out of the view - S13).
//
// Counting rules: births are counted by BIRTH date and admissions by
// admission date; demo cases never count. Pure: no DOM, no I/O (ui.js is
// imported for its timezone constant only).
//
// M4 additions for the Reports screen: the reporting month (Gregorian, East
// Africa Time), the indicator export rows and the birth register rows.
// M6: the Ethiopian reporting month (the HMIS period) and the report
// calendar choice - Gregorian, Both or Ethiopian - with the period columns
// of the exports and the register of one period.

import { LIMITS, getProtocol, activeObs, toMs, byTime } from './protocol.js';
import { auditCase } from './audit.js';
import { bloodLossTotal } from './alerts.js';
import { gregorianToEthiopic, ethiopicToGregorian, ecMonthDays } from './ethiopic.js';
import { APP_TZ_OFFSET } from './ui.js';

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

/**
 * Her second stage is on the record (full dilatation documented). A woman
 * delivered by caesarean in the first stage never had one, and without the
 * start of the second stage no companion record can be placed in it, so
 * only these women make the denominator of the second-stage figure: it reads
 * "women with a documented second stage". A vaginal birth that came before
 * any 10 cm exam is left out too; the figure reports how many women who
 * wanted a companion were left out (withoutDocumentedSecond).
 */
function reachedSecondStage(p) {
  return !!p.secondStageStart;
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

  // byStage.second counts only the women who reached a second stage (reachedSecondStage)
  let wanted = 0, had = 0, unknown = 0, hadFirst = 0, wantedSecond = 0, hadSecond = 0;
  for (const p of births) {
    const w = companionWanted(p);
    if (w === null) { unknown++; continue; }
    if (!w) continue;
    wanted++;
    if (hadCompanion(p)) had++;
    if (hadCompanion(p, 'first')) hadFirst++;
    if (!reachedSecondStage(p)) continue;
    wantedSecond++;
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
    companion: {
      ...ratio(had, wanted), unknown,
      byStage: {
        first: ratio(hadFirst, wanted),
        second: { ...ratio(hadSecond, wantedSecond), withoutDocumentedSecond: wanted - wantedSecond },
      },
    },
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
  const st = ind.companion.byStage;
  rows.push(['Companion of choice in the first stage', st.first.n, st.first.d, pct(st.first), 'women who wanted a companion']);
  rows.push(['Companion of choice in the second stage', st.second.n, st.second.d, pct(st.second),
    `women with a documented second stage; ${st.second.withoutDocumentedSecond} who wanted one had none documented`]);
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

// the Gregorian first and last day (inclusive) of an Ethiopian period, Both mode
const BOUND_COLUMNS = ['gregorian_start', 'gregorian_end'];
const boundValues = bounds => (bounds ? [bounds.start, bounds.end] : []);

/**
 * indicatorRows() for one reporting period with the period (periodCode():
 * '2026-06' or '2019-01 EC') and the facility name in front of every row, so
 * files from several months or facilities can be stacked in one sheet
 * without losing where each number came from. With bounds ({start, end},
 * Both mode: exportPeriod()), the Gregorian first and last day of the period
 * follow the facility.
 */
export function indicatorExportRows(ind, { period = '', facility = '', bounds = null } = {}) {
  const head = ['period', 'facility', ...(bounds ? BOUND_COLUMNS : [])];
  const lead = [period, facility, ...boundValues(bounds)];
  return indicatorRows(ind).map((r, i) => [...(i === 0 ? head : lead), ...r]);
}

const robsonRank = g => parseInt(g, 10) || 99; // '2a' -> 2, 'unclassified' -> last

/**
 * The Robson breakdown of computeIndicators().caesarean.robson as rows in
 * reading order (1, 2a, 2b, 3 ... 10, then unclassified): {group, births,
 * cs, rate}, rate null when the group has no births.
 */
export function robsonBreakdown(robson) {
  return Object.keys(robson || {})
    .sort((a, b) => robsonRank(a) - robsonRank(b) || a.localeCompare(b))
    .map(group => {
      const { births, cs } = robson[group];
      return { group, births, cs, rate: births ? cs / births : null };
    });
}

// ----------------------------------------------------- reporting month ----
// A reporting month is a calendar month in East Africa Time, the zone every
// time in the app is shown and entered in (ui.js APP_TZ_OFFSET): a birth
// shown as 30 June 23:30 counts in June whatever the tablet's own timezone
// setting. Months are 1-12 here, not JavaScript's 0-11. This section is the
// Gregorian month; the Ethiopian month (M6) follows it.

const MIN_MS = 60000;
// '+03:00' -> 180 (East Africa Time keeps one offset all year)
const OFFSET_MIN = (s => (s[0] === '-' ? -1 : 1) * (60 * Number(s.slice(1, 3)) + Number(s.slice(4, 6))))(APP_TZ_OFFSET);

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const isMonth = (year, month) => Number.isInteger(year) && year >= 1000 && year <= 9999
  && Number.isInteger(month) && month >= 1 && month <= 12;

/** The reporting month {year, month} that a time falls in. */
export function monthOf(date = new Date()) {
  const e = new Date(toMs(date) + OFFSET_MIN * MIN_MS);
  return { year: e.getUTCFullYear(), month: e.getUTCMonth() + 1 };
}

/** The month `delta` months away: December + 1 is January of the next year. */
export function shiftMonth(year, month, delta) {
  const i = year * 12 + (month - 1) + delta;
  const y = Math.floor(i / 12);
  return { year: y, month: i - 12 * y + 1 };
}

/**
 * {from, to} of a reporting month for computeIndicators() and hmisCounts():
 * midnight East Africa Time on the 1st, to midnight on the 1st of the next
 * month (exclusive), so December runs to 1 January of the next year.
 */
export function monthRange(year, month) {
  if (!isMonth(year, month)) throw new RangeError(`Not a reporting month: ${year}-${month}`);
  const startOf = (y, m) => new Date(Date.UTC(y, m - 1, 1) - OFFSET_MIN * MIN_MS);
  const next = shiftMonth(year, month, 1);
  return { from: startOf(year, month), to: startOf(next.year, next.month) };
}

/** 'YYYY-MM': file names and the Reports link (#/reports/YYYY-MM). */
export function monthKey(year, month) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

/** {year, month} from 'YYYY-MM', or null when it is not a month. */
export function parseMonthKey(s) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(s == null ? '' : s));
  if (!m) return null;
  const year = Number(m[1]), month = Number(m[2]);
  return isMonth(year, month) ? { year, month } : null;
}

/** 'June 2026'. */
export function monthLabel(year, month) {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

// ------------------------------------------- Ethiopian reporting month ----
// The HMIS reports by Ethiopian month: twelve months of 30 days, then Pagume
// of 5 days, or 6 (ethiopic.js ecMonthDays); the year begins on Meskerem 1,
// 11 or 12 September. Its days run midnight to midnight East Africa Time,
// like the Gregorian months above. Months are 1-13 (13 = Pagume).

const isEcMonth = (year, month) => Number.isInteger(year) && year >= 1000 && year <= 9999
  && Number.isInteger(month) && month >= 1 && month <= 13;

/** The East Africa Time calendar day {year, month, day} (Gregorian) that a time falls on. */
function eatDay(t) {
  const e = new Date(toMs(t) + OFFSET_MIN * MIN_MS);
  return { year: e.getUTCFullYear(), month: e.getUTCMonth() + 1, day: e.getUTCDate() };
}

/** Midnight East Africa Time at the start of a Gregorian calendar day {year, month, day}. */
const eatMidnight = ({ year, month, day }) => new Date(Date.UTC(year, month - 1, day) - OFFSET_MIN * MIN_MS);

/** The Ethiopian month {year, month} that a time falls in: the East Africa Time day decides. */
export function ecMonthOf(date = new Date()) {
  const d = eatDay(date);
  const { year, month } = gregorianToEthiopic(d.year, d.month, d.day);
  return { year, month };
}

/** The Ethiopian month `delta` months away, 13 to a year: Pagume + 1 is Meskerem of the next year. */
export function shiftEcMonth(year, month, delta) {
  const i = year * 13 + (month - 1) + delta;
  const y = Math.floor(i / 13);
  return { year: y, month: i - 13 * y + 1 };
}

/**
 * {from, to} of an Ethiopian month for computeIndicators() and hmisCounts():
 * midnight East Africa Time on day 1, to midnight on day 1 of the next
 * Ethiopian month (exclusive), so Pagume runs to Meskerem 1 of the next year.
 */
export function ecMonthRange(year, month) {
  if (!isEcMonth(year, month)) throw new RangeError(`Not an Ethiopian reporting month: ${year}-${month}`);
  const next = shiftEcMonth(year, month, 1);
  return {
    from: eatMidnight(ethiopicToGregorian(year, month, 1)),
    to: eatMidnight(ethiopicToGregorian(next.year, next.month, 1)),
  };
}

/** '2019-01 EC': an Ethiopian month in the period column of the exports. */
export function ecMonthKey(year, month) {
  return `${monthKey(year, month)} EC`;
}

// ----------------------------------------------------- report calendar ----
// The owner's decision (1 Oct 2026): Reports has a three-way calendar choice,
// remembered per device in S.settings.reportCalendar (store.js):
//   'gregorian'  Gregorian months, Gregorian dates only (WHO or partner reports)
//   'both'       Ethiopian months, every date in both calendars (the default)
//   'ethiopian'  Ethiopian months, Ethiopian dates only (the HMIS period)
// A period is {cal: 'gc', year, month}, a Gregorian month, or {cal: 'ec',
// year, month}, an Ethiopian month. The counting rules are the same for both.

export const REPORT_CALENDARS = Object.freeze(['gregorian', 'both', 'ethiopian']);
export const DEFAULT_REPORT_CALENDAR = 'both';

/** The device's report calendar; a missing or unknown value reads as the default. */
export function reportCalendar(settings) {
  const v = settings ? settings.reportCalendar : undefined;
  return REPORT_CALENDARS.includes(v) ? v : DEFAULT_REPORT_CALENDAR;
}

/** The calendar a mode counts by: 'gc' (Gregorian months) or 'ec' (Ethiopian months). */
export const periodCalendar = mode => (mode === 'gregorian' ? 'gc' : 'ec');

/** The period of calendar cal ('gc' or 'ec') that a time falls in. */
export function periodOf(cal, date = new Date()) {
  return cal === 'ec' ? { cal: 'ec', ...ecMonthOf(date) } : { cal: 'gc', ...monthOf(date) };
}

/** The period `delta` months away in its own calendar. */
export function shiftPeriod(p, delta) {
  return p.cal === 'ec'
    ? { cal: 'ec', ...shiftEcMonth(p.year, p.month, delta) }
    : { cal: 'gc', ...shiftMonth(p.year, p.month, delta) };
}

/** {from, to} of a period: monthRange() or ecMonthRange(). */
export function periodRange(p) {
  return p.cal === 'ec' ? ecMonthRange(p.year, p.month) : monthRange(p.year, p.month);
}

/** The period column of the exports: '2026-06', or '2019-01 EC' for an Ethiopian month. */
export function periodCode(p) {
  return p.cal === 'ec' ? ecMonthKey(p.year, p.month) : monthKey(p.year, p.month);
}

/** The period in the Reports link (#/reports/<key>) and in file names: '2026-06' or '2019-01-EC'. */
export function periodKey(p) {
  return periodCode(p).replace(' ', '-');
}

/** The period of a link key, or null when it is not one. */
export function parsePeriodKey(s) {
  const text = String(s == null ? '' : s);
  const ec = /^(\d{4})-(\d{2})-EC$/.exec(text);
  if (ec) {
    const year = Number(ec[1]), month = Number(ec[2]);
    return isEcMonth(year, month) ? { cal: 'ec', year, month } : null;
  }
  const gc = parseMonthKey(text);
  return gc && { cal: 'gc', ...gc };
}

/**
 * The period of calendar cal that holds the middle of period p (its 15th
 * day; Pagume's 3rd): June 2026 <-> Sene 2018 EC, Pagume 2018 EC ->
 * September 2026. Reports uses it when the calendar is switched, so the
 * screen stays on about the same weeks.
 */
export function periodIn(cal, p) {
  if (p.cal === cal) return p;
  if (p.cal === 'ec') {
    const g = ethiopicToGregorian(p.year, p.month, p.month === 13 ? 3 : 15);
    return { cal: 'gc', year: g.year, month: g.month };
  }
  const e = gregorianToEthiopic(p.year, p.month, 15);
  return { cal: 'ec', year: e.year, month: e.month };
}

/** The Gregorian first and last day of a period, {first, last}, each {year, month, day}. */
export function gregorianDays(p) {
  if (p.cal === 'ec') {
    return {
      first: ethiopicToGregorian(p.year, p.month, 1),
      last: ethiopicToGregorian(p.year, p.month, ecMonthDays(p.year, p.month)),
    };
  }
  const days = new Date(Date.UTC(p.year, p.month, 0)).getUTCDate(); // day 0 of the next month
  return { first: { year: p.year, month: p.month, day: 1 }, last: { year: p.year, month: p.month, day: days } };
}

const isoDay = ({ year, month, day }) => `${monthKey(year, month)}-${String(day).padStart(2, '0')}`;

/**
 * What an export says about its period: {period, bounds}. period is
 * periodCode(); bounds, in Both mode only, the Gregorian first and last day
 * of the Ethiopian month ('YYYY-MM-DD', inclusive), so a reader of either
 * calendar can place the file. Gregorian and Ethiopian-only exports carry the
 * period alone, in their own calendar.
 */
export function exportPeriod(p, mode) {
  if (p.cal !== 'ec' || mode !== 'both') return { period: periodCode(p), bounds: null };
  const { first, last } = gregorianDays(p);
  return { period: periodCode(p), bounds: { start: isoDay(first), end: isoDay(last) } };
}

/**
 * A time as the ward clock read it, with the offset:
 * '2026-06-12T07:00:00.000Z' -> '2026-06-12T10:00+03:00'. Still ISO 8601,
 * so a spreadsheet can parse it, but no reader has to add three hours.
 * Empty for no time; an unreadable value is passed through as it is.
 */
export function eatStamp(t) {
  if (t == null || t === '') return '';
  const ms = toMs(t);
  if (Number.isNaN(ms)) return String(t);
  return new Date(ms + OFFSET_MIN * MIN_MS).toISOString().slice(0, 16) + APP_TZ_OFFSET;
}

// ------------------------------------------------------------ register ----

/**
 * Birth register columns. The first 21 are the v1 register in the v1 order;
 * the rest were added in v2 (plan 6.5).
 * - obs_count counts the entries that stand; voided_count the struck-out
 *   ones (the "Voided entries" line of the case's completeness card).
 * - lcg_score is the audit score (audit.js, 0-100; empty before the active
 *   first stage).
 * - blood_loss_total_ml is bloodLossTotal(): the higher of the measured
 *   (drape) total and the birth record's estimate, the figure the PPH
 *   trigger uses; empty when neither was recorded. ebl_ml stays the estimate.
 * - Times are East Africa Time with the offset (eatStamp).
 */
export const REGISTER_COLUMNS = [
  'admitted', 'name', 'age', 'mrn', 'gravida', 'para', 'ga_weeks', 'status', 'active_start', 'delivery_time',
  'mode', 'outcome', 'sex', 'weight_g', 'apgar1', 'apgar5', 'ebl_ml', 'referred', 'referral_reasons',
  'obs_count', 'alerts_danger',
  'admitted_by', 'protocol', 'robson', 'lcg_score', 'voided_count', 'blood_loss_total_ml',
];

const admittedAt = p => (p.admission && p.admission.time) || p.createdAt;

/** Initials of whoever admitted her: the admission record, else her first admission entry. */
function admittedBy(p) {
  if (p.admission && p.admission.by) return p.admission.by;
  const first = (p.obs || []).find(o => o.source === 'admission' && o.by);
  return first ? first.by : '';
}

function bloodLossColumn(p) {
  const d = p.delivery;
  const estimate = !!d && d.eblMl != null && d.eblMl !== '';
  const measured = activeObs(p).some(o => o.type === 'bloodloss' && o.v && o.v.ml != null);
  return estimate || measured ? bloodLossTotal(p) : '';
}

function registerRow(p, settings, now) {
  const proto = getProtocol(settings, p);
  const audit = auditCase(p, proto, now);
  const d = p.delivery, nb = p.newborn, r = p.referral;
  return [
    eatStamp(admittedAt(p)), p.name, p.age, p.mrn, p.gravida, p.para, p.gaWeeks,
    p.status, eatStamp(p.activeStartTime), eatStamp(d && d.time),
    d ? d.mode : '', d ? d.outcome : '',
    nb ? nb.sex : '', nb ? nb.weightG : '',
    nb && nb.apgar1 ? nb.apgar1.total : '', nb && nb.apgar5 ? nb.apgar5.total : '',
    d ? d.eblMl : '',
    r ? 'yes' : 'no', r ? (r.reasons || []).join('; ') : '',
    activeObs(p).length, (p.alerts || []).filter(a => a.severity === 'danger').length,
    admittedBy(p), proto.id, robsonGroup(p) || 'unclassified', audit.score, audit.voided, bloodLossColumn(p),
  ];
}

/**
 * A case is in a period's register when it is behind one of the period's
 * counts: admitted (admission date), gave birth (birth date) or referred out
 * (referral date) in [from, to). A woman admitted before midnight on the
 * last day of a month and delivered after it is in both months' registers,
 * as she is in both months' counts.
 */
export function inRegisterPeriod(p, range) {
  return inRange(admittedAt(p), range) || inRange(p.delivery && p.delivery.time, range)
    || inRange(p.referral && p.referral.time, range);
}

/**
 * The facility birth register: the header row, then one row per case in
 * admission order (oldest first), ready for toCSV(). Patient names stay in -
 * this is the facility's own register - so the file is confidential and its
 * name must never carry one. Demo cases are left out: they are practice
 * records, not women, and the register must match the indicators, which
 * never count them. With a range ({from, to}), only the cases of that period
 * (inRegisterPeriod); without one, every case.
 */
export function registerRows(cases, settings = {}, now = new Date(), range = null) {
  const real = (cases || []).filter(p => !isDemo(p) && (!range || inRegisterPeriod(p, range)))
    .sort((a, b) => (toMs(admittedAt(a)) || 0) - (toMs(admittedAt(b)) || 0));
  return [REGISTER_COLUMNS.slice(), ...real.map(p => registerRow(p, settings, now))];
}

/**
 * The register file of one reporting period: registerRows() for the period
 * (range), with the period columns of exportPeriod() - period, and in Both
 * mode gregorian_start and gregorian_end - at the END of every row, so the
 * v1 columns keep their places. The range is required: a file labelled with
 * a period must never hold every case.
 */
export function registerExportRows(cases, { range, period = '', bounds = null, settings = {}, now = new Date() } = {}) {
  if (!range || !range.from || !range.to) throw new TypeError('registerExportRows: the period range {from, to} is required');
  const head = ['period', ...(bounds ? BOUND_COLUMNS : [])];
  const tail = [period, ...boundValues(bounds)];
  return registerRows(cases, settings, now, range).map((r, i) => [...r, ...(i === 0 ? head : tail)]);
}
