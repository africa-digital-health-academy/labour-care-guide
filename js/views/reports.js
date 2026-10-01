// views/reports.js - the Reports screen: the six WHO LCG facility indicators
// (implementation resource package 2025, Table 3) for a chosen month, the
// monthly HMIS counts, the CSV exports and backup / restore. Computing the
// monthly numbers on the device spares the duplicate reporting that field
// studies flag as the top complaint about digital tools.
//
// Counting rules and CSV rows live in indicators.js (S13); this file only
// lays them out. The month on screen is kept in the link (#/reports/YYYY-MM),
// so a data change that rebuilds the page keeps it, and the bottom navigation
// (#/reports) always opens the current month.
//
// Screen text goes through t() (keys 'rp.*' in js/i18n/reports.js). The
// exported files stay English: their column names and content are read by
// machines (DHIS2 entry, spreadsheets), not by the midwife on this screen.

import { h, toast, confirmDialog } from '../ui.js';
import { t } from '../i18n.js';
import { S, exportBackup, importBackup, initStore, emit } from '../store.js';
import {
  computeIndicators, hmisCounts, MONITORED_MIN_ENTRIES, indicatorExportRows, registerRows, robsonBreakdown,
  toCSV, isDemo, monthOf, shiftMonth, monthRange, monthKey, parseMonthKey, ecMonthSpan, eatStamp,
} from '../indicators.js';
import { LIMITS } from '../protocol.js';

const MONTH_LINK = /^#\/reports\/(\d{4}-\d{2})$/;
const order = m => m.year * 12 + m.month;

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
// English names the exports use).
const MONTH_NAME = [
  'rp.month_1', 'rp.month_2', 'rp.month_3', 'rp.month_4', 'rp.month_5', 'rp.month_6',
  'rp.month_7', 'rp.month_8', 'rp.month_9', 'rp.month_10', 'rp.month_11', 'rp.month_12',
];
const monthText = (year, month) => `${t(MONTH_NAME[month - 1])} ${year}`;

export function renderReports() {
  const now = new Date();
  const current = monthOf(now);
  const sel = selectedMonth(current);
  const range = monthRange(sel.year, sel.month);
  const label = monthText(sel.year, sel.month);

  // counting rules live in indicators.js (S13): births by birth date,
  // admissions by admission date, demo cases excluded
  const ind = computeIndicators(S.patients, { ...range, settings: S.settings, now });
  const sm = hmisCounts(S.patients, range), sa = hmisCounts(S.patients);

  return h('div', { class: 'page' },
    monthBar(sel, current),
    indicatorCard(ind, label),
    h('p', { class: 'muted', style: 'margin:-6px 4px 14px' }, t('rp.device_only')),
    hmisCard(sm, sa, label),
    exportCard(sel),
  );
}

// ---------------------------------------------------------------- month ----

/** The month in the link, or the current month (also for a month still to come). */
function selectedMonth(current) {
  const m = MONTH_LINK.exec(location.hash);
  const picked = m && parseMonthKey(m[1]);
  return picked && order(picked) <= order(current) ? picked : current;
}

function goMonth(ym, current) {
  // replace, not push: stepping through months must not fill the Back history
  location.replace(order(ym) === order(current) ? '#/reports' : '#/reports/' + monthKey(ym.year, ym.month));
}

function monthBar(sel, current) {
  const isCurrent = order(sel) === order(current);
  const prev = shiftMonth(sel.year, sel.month, -1);
  const next = shiftMonth(sel.year, sel.month, 1);
  return h('div', { class: 'card', style: 'display:flex;align-items:center;gap:8px' },
    h('button', {
      class: 'btn secondary', title: t('rp.prev_month'), 'aria-label': t('rp.prev_month'),
      onclick: () => goMonth(prev, current),
    }, '<'),
    h('div', { style: 'flex:1 1 auto;min-width:0;text-align:center' },
      h('div', { style: 'font-weight:700;font-size:1.1rem' }, monthText(sel.year, sel.month)),
      S.settings.ethiopianDates === false ? null
        : h('div', { class: 'muted' }, ecMonthSpan(sel.year, sel.month, S.settings.lang)),
      isCurrent ? null : h('button', {
        class: 'btn ghost', style: 'min-height:40px;padding:4px 10px;font-size:.9rem',
        onclick: () => goMonth(current, current),
      }, t('rp.this_month')),
    ),
    h('button', {
      class: 'btn secondary', title: t('rp.next_month'), 'aria-label': t('rp.next_month'), disabled: isCurrent,
      onclick: () => goMonth(next, current),
    }, '>'),
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
          h('th', null, t('rp.col_count')), h('th', { style: NUM }, label), h('th', { style: NUM }, t('rp.col_all_time')))),
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

function exportCard(sel) {
  return h('div', { class: 'card' },
    h('h2', null, t('rp.export_title')),
    h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
      h('button', { class: 'btn secondary', onclick: () => exportIndicators(sel) }, t('rp.export_ind')),
      h('button', { class: 'btn secondary', onclick: exportRegister }, '⇩ ', t('rp.export_register')),
      h('button', { class: 'btn secondary', onclick: backup }, '⇩ ', t('rp.export_backup')),
      h('button', { class: 'btn secondary', onclick: restore }, '⇧ ', t('rp.restore_backup')),
    ),
    h('p', { class: 'muted' }, t('rp.export_note', { month: monthText(sel.year, sel.month) })),
    h('p', { class: 'muted' }, t('rp.backup_warn')),
  );
}

const csvBlob = rows => new Blob([toCSV(rows)], { type: 'text/csv;charset=utf-8' });
const failed = e => toast(t('rp.export_failed', { error: (e && e.message) || e }), 'danger');

function exportIndicators(sel) {
  try {
    const ind = computeIndicators(S.patients, { ...monthRange(sel.year, sel.month), settings: S.settings, now: new Date() });
    const period = monthKey(sel.year, sel.month);
    download(csvBlob(indicatorExportRows(ind, { period, facility: S.settings.facilityName || '' })),
      `lcg-indicators-${period}.csv`);
    toast(t('rp.ind_exported', { month: monthText(sel.year, sel.month) }));
  } catch (e) {
    failed(e);
  }
}

function exportRegister() {
  try {
    const now = new Date();
    const rows = registerRows(S.patients, S.settings, now);
    const demo = S.patients.filter(isDemo).length;
    // the date only: a file name never carries a patient's name
    download(csvBlob(rows), `lcg-register-${eatStamp(now).slice(0, 10)}.csv`);
    toast(t('rp.register_exported', { cases: cases(rows.length - 1) })
      + (demo ? ' ' + t('rp.demo_left_out', { n: demo }) : ''));
  } catch (e) {
    failed(e);
  }
}

async function backup() {
  const data = await exportBackup();
  download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    `lcg-backup-${new Date().toISOString().slice(0, 10)}.json`);
  toast(t('rp.backup_done') + ' ✓');
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
