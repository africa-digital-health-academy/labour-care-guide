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

import { h, toast, confirmDialog } from '../ui.js';
import { S, exportBackup, importBackup, initStore, emit } from '../store.js';
import {
  computeIndicators, hmisCounts, MONITORED_MIN_ENTRIES, indicatorExportRows, registerRows, robsonBreakdown,
  toCSV, isDemo, monthOf, shiftMonth, monthRange, monthKey, parseMonthKey, monthLabel, ecMonthSpan, eatStamp,
} from '../indicators.js';
import { LIMITS } from '../protocol.js';

const MONTH_LINK = /^#\/reports\/(\d{4}-\d{2})$/;
const order = m => m.year * 12 + m.month;

// Robson Ten-Group Classification (WHO 2017): short readings of the groups
// robsonGroup() assigns. Display text only; the rules are in indicators.js.
const ROBSON_LABEL = {
  1: 'Nullipara, term cephalic, spontaneous labour',
  '2a': 'Nullipara, term cephalic, induced',
  '2b': 'Nullipara, term cephalic, caesarean before labour',
  3: 'Multipara, no previous caesarean, term cephalic, spontaneous labour',
  '4a': 'Multipara, no previous caesarean, term cephalic, induced',
  '4b': 'Multipara, no previous caesarean, term cephalic, caesarean before labour',
  5: 'Previous caesarean, term cephalic',
  6: 'Nullipara, breech',
  7: 'Multipara, breech',
  8: 'Multiple pregnancy',
  9: 'Transverse or oblique lie',
  10: 'Preterm cephalic',
  unclassified: 'Parity, gestation, labour onset or presentation not recorded',
};

export function renderReports() {
  const now = new Date();
  const current = monthOf(now);
  const sel = selectedMonth(current);
  const range = monthRange(sel.year, sel.month);
  const label = monthLabel(sel.year, sel.month);

  // counting rules live in indicators.js (S13): births by birth date,
  // admissions by admission date, demo cases excluded
  const ind = computeIndicators(S.patients, { ...range, settings: S.settings, now });
  const sm = hmisCounts(S.patients, range), sa = hmisCounts(S.patients);

  return h('div', { class: 'page' },
    monthBar(sel, current),
    indicatorCard(ind, label),
    h('p', { class: 'muted', style: 'margin:-6px 4px 14px' },
      'Counts come from this device only: women recorded on another device are not included.'),
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
      class: 'btn secondary', title: 'Previous month', 'aria-label': 'Previous month',
      onclick: () => goMonth(prev, current),
    }, '<'),
    h('div', { style: 'flex:1 1 auto;min-width:0;text-align:center' },
      h('div', { style: 'font-weight:700;font-size:1.1rem' }, monthLabel(sel.year, sel.month)),
      S.settings.ethiopianDates === false ? null
        : h('div', { class: 'muted' }, ecMonthSpan(sel.year, sel.month, S.settings.lang)),
      isCurrent ? null : h('button', {
        class: 'btn ghost', style: 'min-height:40px;padding:4px 10px;font-size:.9rem',
        onclick: () => goMonth(current, current),
      }, 'Back to this month'),
    ),
    h('button', {
      class: 'btn secondary', title: 'Next month', 'aria-label': 'Next month', disabled: isCurrent,
      onclick: () => goMonth(next, current),
    }, '>'),
  );
}

// ----------------------------------------------------------- indicators ----

const pct = r => (r.rate == null ? '-' : `${(100 * r.rate).toFixed(1)}%`);
const rateText = r => `${pct(r)} (${r.n} / ${r.d})`;
const row = (name, value) => h('div', { class: 'audit-row' }, h('span', null, name), h('b', null, value));
const note = text => h('p', { class: 'muted', style: 'margin:2px 0 8px' }, text);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const NUM = 'text-align:right;font-variant-numeric:tabular-nums';

function indicatorCard(ind, label) {
  const s = ind.stillbirths;
  return h('div', { class: 'card audit-card' },
    h('h2', null, 'WHO LCG indicators'),
    h('p', { class: 'muted', style: 'margin:0 0 6px' },
      'WHO labour care guide implementation resource package (2025), Table 3. Percent (numerator / denominator); - when there is nothing to count.'),
    row(`Births in ${label}`, String(ind.births)),
    row('LCG completed for the birth', rateText(ind.lcgUse)),
    row('FHR documented on admission', rateText(ind.fhrOnAdmission)),
    row('BP measured on admission', rateText(ind.bpOnAdmission)),
    row('Wanted and had a companion of choice', rateText(ind.companion)),
    note(`Wish not recorded for ${ind.companion.unknown} of ${plural(ind.births, 'birth', 'births')}.`),
    row('Caesarean section rate', rateText(ind.caesarean)),
    robsonTable(ind.caesarean.robson),
    row('Institutional stillbirths', rateText(s)),
    note(`Antepartum ${s.antepartum}, intrapartum ${s.intrapartum}, timing not recorded ${s.timingUnknown}.`),
    note(`Before admission ${s.beforeAdmission}, after admission ${s.afterAdmission}, not known ${s.admissionUnknown}.`),
  );
}

function robsonTable(robson) {
  const rows = robsonBreakdown(robson);
  if (!rows.length) return null;
  // the table scrolls inside the card, never the page (360 px phones)
  return h('div', { style: 'overflow-x:auto;margin:2px 0 10px' },
    h('table', { class: 'entries' },
      h('thead', null, h('tr', null,
        h('th', null, 'Robson group'), h('th', { style: NUM }, 'Births'),
        h('th', { style: NUM }, 'Caesareans'), h('th', { style: NUM }, 'Rate'))),
      h('tbody', null, rows.map(r => h('tr', null,
        h('td', null,
          h('b', null, r.group === 'unclassified' ? 'Not classified' : r.group),
          ROBSON_LABEL[r.group] ? h('div', { class: 'muted', style: 'font-size:.8rem' }, ROBSON_LABEL[r.group]) : null),
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
    h('h2', null, 'HMIS delivery counts'),
    h('div', { style: 'overflow-x:auto' },
      h('table', { class: 'entries' },
        h('thead', null, h('tr', null,
          h('th', null, 'Count'), h('th', { style: NUM }, label), h('th', { style: NUM }, 'All time'))),
        h('tbody', null,
          line('Admissions in labour', sm.admissions, sa.admissions),
          line('Births at facility', sm.births, sa.births),
          line('Live births', sm.live, sa.live),
          line('Stillbirths', sm.stillbirths, sa.stillbirths),
          line(`APGAR < ${LIMITS.apgarLow} at 5 min`, sm.lowApgar, sa.lowApgar),
          line(`PPH (${LIMITS.pph.volume} mL, or ${LIMITS.pph.volumeWithSigns} mL with abnormal signs)`, sm.pph, sa.pph),
          line('Referred out in labour', sm.referred, sa.referred),
          line(`Monitored (${MONITORED_MIN_ENTRIES} or more entries)`, sm.monitored, sa.monitored),
        ),
      ),
    ),
    h('p', { class: 'muted' }, 'These map to the monthly HMIS/DHIS2 delivery-care indicators. Births are counted by date of birth; demo cases are not counted.'),
  );
}

// --------------------------------------------------------------- export ----

function exportCard(sel) {
  return h('div', { class: 'card' },
    h('h2', null, 'Export'),
    h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
      h('button', { class: 'btn secondary', onclick: () => exportIndicators(sel) }, 'Export indicators (CSV)'),
      h('button', { class: 'btn secondary', onclick: exportRegister }, '⇩ Birth register (CSV)'),
      h('button', { class: 'btn secondary', onclick: backup }, '⇩ Full backup (JSON)'),
      h('button', { class: 'btn secondary', onclick: restore }, '⇧ Restore backup'),
    ),
    h('p', { class: 'muted' },
      `The indicators file covers ${monthLabel(sel.year, sel.month)}. The birth register lists every case on this device except demo cases.`),
    h('p', { class: 'muted' },
      'Back up regularly — all data lives only on this device until a sync server is configured. Keep exported files confidential: they contain patient data.'),
  );
}

const csvBlob = rows => new Blob([toCSV(rows)], { type: 'text/csv;charset=utf-8' });
const failed = e => toast('Export failed: ' + ((e && e.message) || e), 'danger');

function exportIndicators(sel) {
  try {
    const ind = computeIndicators(S.patients, { ...monthRange(sel.year, sel.month), settings: S.settings, now: new Date() });
    const period = monthKey(sel.year, sel.month);
    download(csvBlob(indicatorExportRows(ind, { period, facility: S.settings.facilityName || '' })),
      `lcg-indicators-${period}.csv`);
    toast(`Indicators for ${monthLabel(sel.year, sel.month)} exported`);
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
    toast(`Birth register exported: ${plural(rows.length - 1, 'case', 'cases')}${demo ? ` (${demo} demo left out)` : ''}`);
  } catch (e) {
    failed(e);
  }
}

async function backup() {
  const data = await exportBackup();
  download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    `lcg-backup-${new Date().toISOString().slice(0, 10)}.json`);
  toast('Backup downloaded ✓');
}

function restore() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json';
  input.onchange = async () => {
    try {
      const data = JSON.parse(await input.files[0].text());
      const preview = await importBackup(data, { dryRun: true });
      const summary = `${preview.added} new, ${preview.updated} updated, ${preview.skipped} unchanged (kept local). `
        + 'A safety snapshot of what is on this device is taken first.';
      const ok = await confirmDialog(summary, { okLabel: 'Restore' });
      if (!ok) return;
      const result = await importBackup(data);
      await initStore();
      emit();
      toast(`Restored: ${result.added} new, ${result.updated} updated, ${result.skipped} unchanged ✓`);
    } catch (e) {
      toast('Restore failed: ' + e.message, 'danger');
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
