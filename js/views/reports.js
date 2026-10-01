// views/reports.js - the Reports screen: the six WHO LCG facility indicators
// (implementation resource package 2025, Table 3) for a chosen month, the
// monthly HMIS counts, the CSV exports and backup / restore. Computing the
// monthly numbers on the device spares the duplicate reporting that field
// studies flag as the top complaint about digital tools.
//
// Counting rules and CSV rows live in indicators.js (S13); this file only
// lays them out. The month on screen is kept in the link (#/reports/2026-06
// for a Gregorian month, #/reports/2019-01-EC for an Ethiopian one), so a
// data change that rebuilds the page keeps it, and the bottom navigation
// (#/reports) always opens the current month.
//
// M6, the owner's decision of 1 Oct 2026: a three-way calendar choice at the
// top, remembered per device (S.settings.reportCalendar). Gregorian counts
// Gregorian months and shows Gregorian dates only; Ethiopian counts Ethiopian
// months (the HMIS period, Meskerem to Pagume) and shows Ethiopian dates
// only; Both, the default, counts Ethiopian months and shows every date in
// both calendars. The Settings choice "Show Ethiopian calendar dates" does
// not apply here: this choice decides the Reports page.
//
// Screen text goes through t() (keys 'rp.*' in js/i18n/reports.js). The
// exported files stay English: their column names and content are read by
// machines (DHIS2 entry, spreadsheets), not by the midwife on this screen.

import { h, toast, confirmDialog, field, segmented } from '../ui.js';
import { t, getLang } from '../i18n.js';
import { S, exportBackup, importBackup, initStore, emit, saveSettings } from '../store.js';
import {
  computeIndicators, hmisCounts, MONITORED_MIN_ENTRIES, indicatorExportRows, registerExportRows, robsonBreakdown,
  toCSV, isDemo, eatStamp, inRegisterPeriod, reportCalendar, periodCalendar, periodOf, shiftPeriod, periodRange,
  periodKey, parsePeriodKey, periodIn, gregorianDays, exportPeriod,
} from '../indicators.js';
import { EC_MONTHS, EC_MONTHS_AM, ecEra } from '../ethiopic.js';
import { LIMITS } from '../protocol.js';

// Robson Ten-Group Classification (WHO 2017): short readings of the groups
// robsonGroup() assigns. Display text only; the rules are in indicators.js.
const ROBSON_LABEL = {
  1: 'rp.robson_1',
  '2a': 'rp.robson_2a',
  '2b': 'rp.robson_2b',
  3: 'rp.robson_3',
  '4a': 'rp.robson_4a',
  '4b': 'rp.robson_4b',
  5: 'rp.robson_5',
  6: 'rp.robson_6',
  7: 'rp.robson_7',
  8: 'rp.robson_8',
  9: 'rp.robson_9',
  10: 'rp.robson_10',
  unclassified: 'rp.robson_unclassified',
};

// Gregorian month names for the screen (indicators.js monthLabel() keeps the
// English names the exports use). Ethiopian month names come from
// ethiopic.js, in Amharic on an Amharic screen.
const MONTH_NAME = [
  'rp.month_1', 'rp.month_2', 'rp.month_3', 'rp.month_4', 'rp.month_5', 'rp.month_6',
  'rp.month_7', 'rp.month_8', 'rp.month_9', 'rp.month_10', 'rp.month_11', 'rp.month_12',
];
const gcName = month => t(MONTH_NAME[month - 1]);
const ecName = month => (getLang() === 'am' ? EC_MONTHS_AM : EC_MONTHS)[month - 1];

// the three calendar choices, in the order of the button
const CALENDAR_CHOICES = [
  { value: 'gregorian', label: 'rp.cal_gregorian' },
  { value: 'both', label: 'rp.cal_both' },
  { value: 'ethiopian', label: 'rp.cal_ethiopian' },
];

export function renderReports() {
  const now = new Date();
  const mode = reportCalendar(S.settings);
  const current = periodOf(periodCalendar(mode), now);
  const sel = selectedPeriod(current);
  const range = periodRange(sel);

  // counting rules live in indicators.js (S13): births by birth date,
  // admissions by admission date, demo cases excluded - in either calendar
  const ind = computeIndicators(S.patients, { ...range, settings: S.settings, now });
  const sm = hmisCounts(S.patients, range), sa = hmisCounts(S.patients);

  return h('div', { class: 'page' },
    periodBar(sel, current, mode),
    indicatorCard(ind, periodText(sel, mode)),
    h('p', { class: 'muted', style: 'margin:-6px 4px 14px' }, t('rp.device_only')),
    hmisCard(sm, sa, periodLabel(sel, mode)),
    exportCard(sel, mode),
  );
}

// --------------------------------------------------------------- labels ----

/** 'June 8 - July 7, 2026'; 'September 6 - 10, 2026' inside one month; both years across 1 January. */
function gregorianSpan(p) {
  const { first: a, last: b } = gregorianDays(p);
  if (a.year !== b.year) return `${gcName(a.month)} ${a.day}, ${a.year} - ${gcName(b.month)} ${b.day}, ${b.year}`;
  if (a.month !== b.month) return `${gcName(a.month)} ${a.day} - ${gcName(b.month)} ${b.day}, ${b.year}`;
  return `${gcName(a.month)} ${a.day} - ${b.day}, ${b.year}`;
}

/**
 * The screen label of a period, {main, sub}: 'June 2026' (Gregorian),
 * 'Sene 2018 EC' (Ethiopian only), or 'Sene 2018 EC' over its Gregorian days
 * 'June 8 - July 7, 2026' (Both). Month names and the era follow the screen
 * language: an Amharic screen writes the Amharic month names and era.
 */
export function periodLabel(p, mode) {
  if (p.cal !== 'ec') return { main: `${gcName(p.month)} ${p.year}`, sub: null };
  return {
    main: `${ecName(p.month)} ${p.year} ${ecEra(getLang())}`,
    sub: mode === 'both' ? gregorianSpan(p) : null,
  };
}

/** The label on one line, for sentences: 'Sene 2018 EC (June 8 - July 7, 2026)' in Both. */
export function periodText(p, mode) {
  const { main, sub } = periodLabel(p, mode);
  return sub ? `${main} (${sub})` : main;
}

// --------------------------------------------------------------- period ----

const REPORT_LINK = /^#\/reports\/([\w-]+)$/;
// months of one calendar in order (13 to a year serves both calendars)
const order = p => p.year * 13 + p.month;
const same = (a, b) => a.cal === b.cal && order(a) === order(b);

/**
 * The month in the link, or the current month (also for a month still to
 * come). A link in the other calendar - an old bookmark, or one from before
 * the calendar was switched - shows the month holding its middle.
 */
function selectedPeriod(current) {
  const m = REPORT_LINK.exec(location.hash);
  const linked = m && parsePeriodKey(m[1]);
  const picked = linked && periodIn(current.cal, linked);
  return picked && order(picked) <= order(current) ? picked : current;
}

function goPeriod(p, current) {
  const link = same(p, current) ? '#/reports' : '#/reports/' + periodKey(p);
  // replace, not push: stepping through months must not fill the Back history
  if (location.hash !== link) location.replace(link);
}

/**
 * A new report calendar. The choice is saved for this device, and the save
 * rebuilds the page. This month stays this month; an earlier month moves to
 * the month of the new calendar that holds its middle (June 2026 -> Sene
 * 2018 EC), never past the current one.
 */
function setCalendar(mode, sel) {
  if (mode === reportCalendar(S.settings)) return;
  const now = new Date();
  const current = periodOf(periodCalendar(mode), now);
  const target = same(sel, periodOf(sel.cal, now)) ? current : periodIn(current.cal, sel);
  // saveSettings() changes S.settings at once, so the link change below
  // already renders the new calendar
  saveSettings({ reportCalendar: mode }).catch(e => {
    toast(t('rp.calendar_not_saved', { error: (e && e.message) || e }), 'danger');
    emit(); // not remembered on the device, but this session shows the choice made
  });
  goPeriod(order(target) <= order(current) ? target : current, current);
}

function periodBar(sel, current, mode) {
  const isCurrent = same(sel, current);
  const prev = shiftPeriod(sel, -1);
  const next = shiftPeriod(sel, 1);
  const label = periodLabel(sel, mode);
  return h('div', { class: 'card' },
    field(t('rp.calendar'), segmented(
      CALENDAR_CHOICES.map(c => ({ value: c.value, label: t(c.label) })), mode, v => setCalendar(v, sel))),
    h('p', { class: 'muted', style: 'margin:-6px 0 10px' }, t('rp.calendar_note')),
    h('div', { style: 'display:flex;align-items:center;gap:8px' },
      h('button', {
        class: 'btn secondary', title: t('rp.prev_month'), 'aria-label': t('rp.prev_month'),
        onclick: () => goPeriod(prev, current),
      }, '<'),
      h('div', { style: 'flex:1 1 auto;min-width:0;text-align:center' },
        h('div', { style: 'font-weight:700;font-size:1.1rem' }, label.main),
        label.sub ? h('div', { class: 'muted' }, label.sub) : null,
        isCurrent ? null : h('button', {
          class: 'btn ghost', style: 'min-height:40px;padding:4px 10px;font-size:.9rem',
          onclick: () => goPeriod(current, current),
        }, t('rp.this_month')),
      ),
      h('button', {
        class: 'btn secondary', title: t('rp.next_month'), 'aria-label': t('rp.next_month'), disabled: isCurrent,
        onclick: () => goPeriod(next, current),
      }, '>'),
    ),
  );
}

// ----------------------------------------------------------- indicators ----

const pct = r => (r.rate == null ? '-' : `${(100 * r.rate).toFixed(1)}%`);
const rateText = r => `${pct(r)} (${r.n} / ${r.d})`;
const row = (name, value) => h('div', { class: 'audit-row' }, h('span', null, name), h('b', null, value));
const note = text => h('p', { class: 'muted', style: 'margin:2px 0 8px' }, text);
const births = n => (n === 1 ? t('rp.n_birth', { n }) : t('rp.n_births', { n }));
const cases = n => (n === 1 ? t('rp.n_case', { n }) : t('rp.n_cases', { n }));
const NUM = 'text-align:right;font-variant-numeric:tabular-nums';

function indicatorCard(ind, label) {
  const s = ind.stillbirths;
  return h('div', { class: 'card audit-card' },
    h('h2', null, t('rp.ind_title')),
    h('p', { class: 'muted', style: 'margin:0 0 6px' }, t('rp.ind_source')),
    row(t('rp.births_in', { month: label }), String(ind.births)),
    row(t('rp.ind_lcg'), rateText(ind.lcgUse)),
    row(t('rp.ind_fhr'), rateText(ind.fhrOnAdmission)),
    row(t('rp.ind_bp'), rateText(ind.bpOnAdmission)),
    row(t('rp.ind_companion'), rateText(ind.companion)),
    note(t('rp.wish_unknown', { n: ind.companion.unknown, births: births(ind.births) })),
    row(t('rp.ind_companion_first'), rateText(ind.companion.byStage.first)),
    row(t('rp.ind_companion_second'), rateText(ind.companion.byStage.second)),
    note(t('rp.companion_second_note', { n: ind.companion.byStage.second.withoutDocumentedSecond })),
    row(t('rp.ind_cs'), rateText(ind.caesarean)),
    robsonTable(ind.caesarean.robson),
    row(t('rp.ind_sb'), rateText(s)),
    note(t('rp.sb_timing', { ante: s.antepartum, intra: s.intrapartum, unknown: s.timingUnknown })),
    note(t('rp.sb_admission', { before: s.beforeAdmission, after: s.afterAdmission, unknown: s.admissionUnknown })),
  );
}

function robsonTable(robson) {
  const rows = robsonBreakdown(robson);
  if (!rows.length) return null;
  // the table scrolls inside the card, never the page (360 px phones)
  return h('div', { style: 'overflow-x:auto;margin:2px 0 10px' },
    h('table', { class: 'entries' },
      h('thead', null, h('tr', null,
        h('th', null, t('rp.robson_group')), h('th', { style: NUM }, t('rp.col_births')),
        h('th', { style: NUM }, t('rp.col_cs')), h('th', { style: NUM }, t('rp.col_rate')))),
      h('tbody', null, rows.map(r => h('tr', null,
        h('td', null,
          h('b', null, r.group === 'unclassified' ? t('rp.not_classified') : r.group),
          ROBSON_LABEL[r.group] ? h('div', { class: 'muted', style: 'font-size:.8rem' }, t(ROBSON_LABEL[r.group])) : null),
        h('td', { style: NUM }, String(r.births)),
        h('td', { style: NUM }, String(r.cs)),
        h('td', { style: NUM }, pct(r)),
      ))),
    ),
  );
}

// ----------------------------------------------------------------- HMIS ----

function hmisCard(sm, sa, label) {
  const line = (name, m, a) => h('tr', null, h('td', null, name), h('td', { style: NUM }, m), h('td', { style: NUM }, a));
  return h('div', { class: 'card' },
    h('h2', null, t('rp.hmis_title')),
    h('div', { style: 'overflow-x:auto' },
      h('table', { class: 'entries' },
        h('thead', null, h('tr', null,
          h('th', null, t('rp.col_count')),
          // in Both, the Gregorian days go under the Ethiopian month
          h('th', { style: NUM }, label.main,
            label.sub ? h('div', { class: 'muted', style: 'font-weight:400;font-size:.8rem' }, label.sub) : null),
          h('th', { style: NUM }, t('rp.col_all_time')))),
        h('tbody', null,
          line(t('rp.hmis_admissions'), sm.admissions, sa.admissions),
          line(t('rp.hmis_births'), sm.births, sa.births),
          line(t('rp.hmis_live'), sm.live, sa.live),
          line(t('rp.hmis_sb'), sm.stillbirths, sa.stillbirths),
          line(t('rp.hmis_low_apgar', { n: LIMITS.apgarLow }), sm.lowApgar, sa.lowApgar),
          line(t('rp.hmis_pph', { ml: LIMITS.pph.volume, mlSigns: LIMITS.pph.volumeWithSigns }), sm.pph, sa.pph),
          line(t('rp.hmis_referred'), sm.referred, sa.referred),
          line(t('rp.hmis_monitored', { n: MONITORED_MIN_ENTRIES }), sm.monitored, sa.monitored),
        ),
      ),
    ),
    h('p', { class: 'muted' }, t('rp.hmis_note')),
  );
}

// --------------------------------------------------------------- export ----

/**
 * Export file names. The indicator and register files carry their month
 * (periodKey: 'lcg-register-2019-01-EC.csv'); the backup carries the East
 * Africa Time date, so one taken at 01:00 in Addis Ababa is named after that
 * day, not the UTC one. A file name never carries a patient's name.
 */
export function exportFileName(kind, { period = null, now = new Date() } = {}) {
  if (kind === 'backup') return `lcg-backup-${eatStamp(now).slice(0, 10)}.json`;
  return `lcg-${kind}-${periodKey(period)}.csv`;
}

function exportCard(sel, mode) {
  return h('div', { class: 'card' },
    h('h2', null, t('rp.export_title')),
    h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
      h('button', { class: 'btn secondary', onclick: () => exportIndicators(sel, mode) }, t('rp.export_ind')),
      h('button', { class: 'btn secondary', onclick: () => exportRegister(sel, mode) }, '⇩ ', t('rp.export_register')),
      h('button', { class: 'btn secondary', onclick: backup }, '⇩ ', t('rp.export_backup')),
      h('button', { class: 'btn secondary', onclick: restore }, '⇧ ', t('rp.restore_backup')),
    ),
    h('p', { class: 'muted' }, t('rp.export_note', { month: periodText(sel, mode) })),
    h('p', { class: 'muted' }, t('rp.backup_warn')),
  );
}

const csvBlob = rows => new Blob([toCSV(rows)], { type: 'text/csv;charset=utf-8' });
const failed = e => toast(t('rp.export_failed', { error: (e && e.message) || e }), 'danger');

function exportIndicators(sel, mode) {
  try {
    const ind = computeIndicators(S.patients, { ...periodRange(sel), settings: S.settings, now: new Date() });
    const { period, bounds } = exportPeriod(sel, mode);
    download(csvBlob(indicatorExportRows(ind, { period, facility: S.settings.facilityName || '', bounds })),
      exportFileName('indicators', { period: sel }));
    toast(t('rp.ind_exported', { month: periodText(sel, mode) }));
  } catch (e) {
    failed(e);
  }
}

function exportRegister(sel, mode) {
  try {
    const range = periodRange(sel);
    const rows = registerExportRows(S.patients, { range, ...exportPeriod(sel, mode), settings: S.settings, now: new Date() });
    const demo = S.patients.filter(p => isDemo(p) && inRegisterPeriod(p, range)).length;
    download(csvBlob(rows), exportFileName('register', { period: sel }));
    toast(t('rp.register_exported', { month: periodText(sel, mode), cases: cases(rows.length - 1) })
      + (demo ? ' ' + t('rp.demo_left_out', { n: demo }) : ''));
  } catch (e) {
    failed(e);
  }
}

async function backup() {
  try {
    const data = await exportBackup();
    download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), exportFileName('backup'));
    toast(t('rp.backup_done') + ' ✓');
  } catch (e) {
    failed(e);
  }
}

function restore() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json';
  input.onchange = async () => {
    try {
      const data = JSON.parse(await input.files[0].text());
      const preview = await importBackup(data, { dryRun: true });
      const summary = t('rp.restore_preview', { added: preview.added, updated: preview.updated, skipped: preview.skipped });
      const ok = await confirmDialog(summary, { okLabel: t('rp.restore') });
      if (!ok) return;
      const result = await importBackup(data);
      await initStore();
      emit();
      toast(t('rp.restored', { added: result.added, updated: result.updated, skipped: result.skipped }) + ' ✓');
    } catch (e) {
      toast(t('rp.restore_failed', { error: e.message }), 'danger');
    }
  };
  input.click();
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
