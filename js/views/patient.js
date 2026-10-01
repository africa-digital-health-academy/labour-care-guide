// views/patient.js - one case: header (stage, clocks, due chips, actions),
// alert strip, and the chart, entries, alerts, summary, referral and delivery
// tabs, plus the emergency card.
//
// Live parts (S3): the header, the alert strip and the chart body carry
// data-live, so app.js can refresh them on the heartbeat without re-rendering
// the page and wiping a form in progress. The summary note form carries
// data-form="note" and is marked data-saved while it is empty and before it
// saves.
//
// Corrections are append-only (S5): an entry is voided or corrected with
// initials and a reason, after a confirmation that states what will change -
// labour stage, timers, alerts. Real cases are closed, never deleted; only
// DEMO cases can be deleted. Every record made here carries initials (F3).
// No clinical threshold lives here: the engine decides, this view reports.
//
// Language (M5): every string shown here goes through t() ('pt.' keys in
// js/i18n/patient.js; the Amharic is a draft for clinical review). t() is
// read when a screen is built, never at import, so a language change shows
// on the next render. Alert titles and advice, emergency names and protocol
// names come from the engine and stay English until the clinical panel
// validates translations; text written INTO the record (alert titles, notes)
// stays English too, so a record never depends on the screen language.

import {
  h, clear, openModal, toast, confirmDialog, promptDialog, byField, alertBanner,
  fmtTime, fmtDT, APP_TZ,
} from '../ui.js';
import { t } from '../i18n.js';
import { S, savePatient, removePatient, getBy, setBy, uid } from '../store.js';
import {
  LIMITS, getProtocol, dueList, stageOf, isLabouring, awaitingHandover, monitoringStage,
  inPostpartumWatch, secondStagePushing, birthTime, babyWatched,
} from '../protocol.js';
import { EMERGENCIES, addAlerts, resolveAlert } from '../alerts.js';
import { previewVoid, voidObservation, recordEvent } from '../record.js';
import { auditCase, isAckNote } from '../audit.js';
import { isDemo } from '../indicators.js';
import {
  openRecordWizard, openMedicationModal, showAlertAckModal, WIZARD_TYPES, wizardTypeFor,
} from '../wizard.js';
import {
  renderChart, renderPrintSheets, chartLegend, sheetCount, chartSheet, selectChartSheet, SHEET_HOURS,
} from '../chart.js';
import { renderReferralTab } from './referral.js';
import { renderDeliveryTab } from './delivery.js';
import { downloadFHIR } from '../fhir.js';

// Labour observations offered by "Record now"; oxytocin joins while it runs.
const LABOUR_TYPES = ['baby', 'contractions', 'pulse', 'vitals', 'exam', 'supportive'];
// Postpartum checks offered by "Record check"; blood loss only when measured,
// so it is not pre-selected unless it is due.
const PP_TYPES = ['ppMother', 'ppBaby', 'bloodloss'];
const PP_DEFAULT = ['ppMother', 'ppBaby'];
const ppTitle = () => t('pt.record_check');

const TABS = ['chart', 'entries', 'alerts', 'summary', 'referral', 'delivery'];

export function renderPatient(id, tab = 'chart') {
  const p = S.patients.find(x => x.id === id);
  if (!p) return h('div', { class: 'page' }, h('p', null, t('pt.not_found')));
  const current = TABS.includes(tab) ? tab : 'chart';
  const now = new Date();
  const page = h('div', { class: 'page' }, patientHeader(p, now), alertStrip(p));

  const labels = {
    chart: t('chart'), entries: t('entries'),
    alerts: `${t('alerts')} (${(p.alerts || []).length})`,
    summary: t('pt.tab_summary'), referral: t('referral'), delivery: t('delivery'),
  };
  page.append(h('div', { class: 'tabs' }, TABS.map(key =>
    h('button', { class: key === current ? 'active' : '', onclick: () => { location.hash = `#/p/${p.id}/${key}`; } }, labels[key]),
  )));

  const body = h('div');
  page.append(body);
  if (current === 'chart') body.append(chartTab(p, now));
  else if (current === 'entries') body.append(entriesTab(p));
  else if (current === 'alerts') body.append(alertsTab(p));
  else if (current === 'summary') body.append(summaryTab(p, now));
  else if (current === 'referral') body.append(renderReferralTab(p));
  else if (current === 'delivery') body.append(renderDeliveryTab(p));
  return page;
}

// ----------------------------------------------------------- chart tab ----

/**
 * The chart tab (M4): a sheet picker once the active first stage runs past
 * 12 hours (F6), "Print chart", the live chart and, for paper only, every
 * sheet with its header (css/print.css). The data-live part holds exactly
 * renderChart(p, S.settings): app.js swaps it on the heartbeat and
 * renderChart keeps the sheet picked here.
 */
function chartTab(p, now) {
  const n = sheetCount(p, now, S.settings);
  const live = h('div', { 'data-live': 'chart' }, renderChart(p, S.settings));
  const buttons = [];
  const pick = sheet => {
    selectChartSheet(p, sheet, new Date(), S.settings);
    buttons.forEach((b, i) => b.classList.toggle('sel', i + 1 === sheet));
    live.replaceChildren(renderChart(p, S.settings));
  };
  const shown = chartSheet(p, now, S.settings);
  for (let s = 1; n > 1 && s <= n; s++) {
    buttons.push(h('button', { type: 'button', class: s === shown ? 'sel' : '', onclick: () => pick(s) },
      t('pt.sheet', { n: s, from: (s - 1) * SHEET_HOURS, to: s * SHEET_HOURS })));
  }
  const lcg = !getProtocol(S.settings, p).alertActionLines;
  return h('div', { class: 'chart-tab' },
    h('div', { class: 'chart-tools no-print', style: 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px' },
      buttons.length ? h('div', { class: 'seg', role: 'group', 'aria-label': t('pt.sheets_label') }, buttons) : null,
      h('button', { class: 'btn secondary', type: 'button', onclick: () => window.print() }, t('pt.print_chart')),
    ),
    live,
    h('p', { class: 'chart-legend no-print', style: 'margin:0' }, chartLegend(p, S.settings)),
    h('p', { class: 'muted no-print', style: 'margin-top:4px' },
      lcg ? t('pt.chart_note_lcg', { h: SHEET_HOURS }) : t('pt.chart_note_partograph')),
    renderPrintSheets(p, S.settings),
  );
}

// ------------------------------------------------------------- helpers ----

const errText = err => (err && err.message) || String(err);
const chipRow = kids => h('div', { class: 'chips', style: 'display:flex;flex-wrap:wrap;gap:6px;margin-top:8px' }, kids);
const dayOf = iso => new Date(iso).toLocaleDateString('en-US', { timeZone: APP_TZ });

/** Time of day for today's entries, date and time for older ones. */
function when(iso, now = new Date()) {
  if (!iso) return fmtTime(iso);
  return dayOf(iso) === dayOf(now) ? fmtTime(iso) : fmtDT(iso);
}

/**
 * Whole minutes since iso as "2 h 5 min" or "45 min": durationSince (ui.js)
 * through t(), so the units follow the language. Pure: exported for the ward
 * board and the tests.
 */
export function sinceText(iso, now = new Date()) {
  const min = Math.max(0, Math.round((now - new Date(iso)) / 60000));
  const hrs = Math.floor(min / 60);
  return hrs ? t('pt.dur_h_min', { h: hrs, m: min % 60 }) : t('pt.dur_min', { m: min });
}

/** Minutes as "45 min", "2 h" or "2 h 5 min": fmtMin (protocol.js) through t(). Pure: exported like sinceText. */
export function minText(min) {
  if (min < 60) return t('pt.dur_min', { m: Math.round(min) });
  const hrs = Math.floor(min / 60), m = Math.round(min % 60);
  return m ? t('pt.dur_h_min', { h: hrs, m }) : t('pt.dur_h', { h: hrs });
}

/** Age, gravida/para and gestation, e.g. 26 y, G2P1, GA 39 wk on one line. Pure: shared with the ward board. */
export function metaLine(p) {
  return t('pt.meta', { age: p.age || '?', g: p.gravida ?? '?', para: p.para ?? '?', ga: p.gaWeeks || '?' });
}

/**
 * Change the case and save it, all or nothing (the wizard's rule too): if the
 * change throws or the save fails, the case in memory is put back as it was,
 * so a later save never stores a half-made record, and the problem is shown.
 * Returns {result} when saved, null otherwise.
 */
async function commit(p, change) {
  const before = structuredClone(p);
  try {
    const result = change();
    await savePatient(p);
    return { result };
  } catch (err) {
    for (const k of Object.keys(p)) delete p[k];
    Object.assign(p, before);
    toast(t('pt.not_saved', { err: errText(err) }), 'danger');
    return null;
  }
}

function kv(k, v) { return h('div', { class: 'kv' }, h('b', null, k), h('span', null, v)); }

// -------------------------------------------------------------- header ----

/**
 * Stage, clocks, due chips and the case actions. A live part: app.js swaps
 * it on the heartbeat (the root carries data-live="patient-header").
 */
export function patientHeader(p, now = new Date()) {
  const proto = getProtocol(S.settings, p);
  const labouring = isLabouring(p);
  const watch = !labouring && inPostpartumWatch(p, now);
  const stage = monitoringStage(p);
  const due = labouring || watch ? dueList(p, proto, now) : [];
  const pending = due.filter(d => d.state !== 'ok');
  const second = labouring && stage === 'second';
  const pushing = second ? secondStagePushing(p) : null;

  const chips = [h('span', { class: 'chip stage' }, t('stage_' + stageOf(p)))];
  // S8: a referred woman still on the ward keeps her labour stage and clocks
  if (awaitingHandover(p)) chips.push(h('span', { class: 'chip stage' }, t('stage_' + stage)));
  if (labouring && stage === 'active' && p.activeStartTime) {
    chips.push(h('span', { class: 'chip' }, t('pt.chip_active', { d: sinceText(p.activeStartTime, now) })));
  }
  if (second && p.secondStageStart) {
    chips.push(h('span', { class: 'chip stage' }, t('pt.chip_second', { d: sinceText(p.secondStageStart, now) })));
  }
  if (pushing) {
    chips.push(h('span', { class: 'chip stage' }, t('pt.chip_pushing', { time: fmtTime(pushing), d: sinceText(pushing, now) })));
  }
  if (labouring && p.romTime) chips.push(h('span', { class: 'chip' }, t('pt.chip_rom', { d: sinceText(p.romTime, now) })));
  else if (labouring && p.romUnknown) chips.push(h('span', { class: 'chip' }, t('pt.chip_rom_unknown')));
  if (p.oxytocinRunning) chips.push(h('span', { class: 'chip due' }, '⚠ ' + t('pt.chip_oxytocin')));
  if (watch) {
    chips.push(h('span', { class: 'chip pp' },
      `${t('postpartum_watch')} - ${t('pt.since_birth', { d: sinceText(birthTime(p), now) })}`));
  }

  const go = tab => () => { location.hash = `#/p/${p.id}/${tab}`; };

  // app.js keeps this element when a fresh build has the same markup, so the
  // handlers read the case when tapped and never keep lists from build time
  return h('div', { class: 'card' + (watch ? ' pp-watch' : ''), 'data-live': 'patient-header' },
    h('div', { class: 'row1', style: 'display:flex;gap:10px;align-items:baseline;flex-wrap:wrap' },
      h('span', { class: 'name', style: 'font-size:1.3rem;font-weight:800' }, p.name || t('pt.unnamed')),
      h('span', { class: 'meta muted' }, `${metaLine(p)} · ${proto.name}`),
    ),
    chipRow(chips),
    // due chips (labour or postpartum watch): tap to record that item
    labouring || watch ? chipRow([
      ...pending.map(d => dueChip(p, d)),
      pending.length ? null : h('span', { class: 'chip ok' }, '✓ ' + t('all_done')),
    ]) : null,
    h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:12px' },
      second && !pushing ? h('button', { class: 'btn', onclick: () => markPushing(p) }, t('pushing')) : null,
      labouring ? h('button', { class: 'btn', onclick: () => pickAndRecord(p, 'labour') }, '📝 ' + t('record_now')) : null,
      watch ? h('button', { class: 'btn', onclick: () => pickAndRecord(p, 'postpartum') }, ppTitle()) : null,
      labouring || watch ? h('button', { class: 'btn secondary', onclick: () => openMedicationModal(p) }, '💊 ' + t('pt.meds')) : null,
      h('button', { class: 'btn danger', onclick: () => openEmergencyModal(p) }, '🚨 ' + t('emergency')),
      labouring || watch || stageOf(p) === 'third' ? h('button', { class: 'btn warn', onclick: go('referral') }, '🏥 ' + t('referral')) : null,
      h('button', { class: 'btn secondary', onclick: go('delivery') }, '👶 ' + t('delivery')),
    ),
  );
}

function dueChip(p, d) {
  return h('button', {
    type: 'button', class: 'chip ' + (d.state === 'overdue' ? 'overdue' : 'due'), style: 'border:none;cursor:pointer',
    // in the postpartum watch the time screen is titled like its "Record check" button
    onclick: () => openRecordWizard(p, [wizardTypeFor(d.type)], null, isLabouring(p) ? {} : { title: ppTitle() }),
  }, `▶ ${t(d.type)} ${d.state === 'overdue' ? d.overdueMin + '′ ' + t('overdue') : t('due')}`);
}

/** The form's P (F2): initials only, then the event is recorded now. */
async function markPushing(p) {
  const proto = getProtocol(S.settings, p);
  const r = await promptDialog({
    title: t('pushing'),
    message: proto.secondStageClock === 'pushing' ? t('pt.pushing_msg_lcg') : t('pt.pushing_msg_partograph'),
    by: getBy(), okLabel: t('pt.record'),
  });
  if (!r) return;
  // the case may have changed while the dialog was open
  if (!isLabouring(p) || monitoringStage(p) !== 'second') {
    toast(t('pt.pushing_not_second'), 'danger');
    return;
  }
  const already = secondStagePushing(p);
  if (already) {
    toast(t('pt.pushing_already', { time: fmtTime(already) }));
    return;
  }
  const at = new Date().toISOString();
  const done = await commit(p, () => recordEvent(p, 'pushing', at, S.settings, { by: r.by }));
  if (!done) return;
  setBy(r.by);
  toast(t('pt.pushing_recorded', { time: fmtTime(at) }));
  if (done.result.added && done.result.added.length) showAlertAckModal(p, done.result.added);
}

/**
 * The types "Record now" ('labour') or "Record check" ('postpartum') offers:
 * oxytocin while it runs; no baby check after a stillbirth. Pure: exported
 * for the tests.
 */
export function recordTypes(p, kind) {
  if (kind === 'labour') return p.oxytocinRunning ? [...LABOUR_TYPES, 'oxytocin'] : LABOUR_TYPES;
  return PP_TYPES.filter(type => type !== 'ppBaby' || babyWatched(p));
}

/**
 * Choose what to record now ('labour' or 'postpartum'). Items due now are
 * pre-selected (postpartum BP and urine belong to the mother check);
 * otherwise every labour item, or the mother (and baby) checks.
 */
function pickAndRecord(p, kind) {
  const labour = kind === 'labour';
  const all = recordTypes(p, kind);
  const fallback = labour ? all : PP_DEFAULT.filter(type => all.includes(type));
  const title = labour ? t('record_now') : ppTitle();
  const pending = dueList(p, getProtocol(S.settings, p), new Date()).filter(d => d.state !== 'ok');
  const dueFor = type => pending.find(d => wizardTypeFor(d.type) === type); // most urgent first
  const dueTypes = all.filter(dueFor);
  const selected = new Set(dueTypes.length ? dueTypes : fallback);

  const list = h('div', { class: 'checklist' }, all.map(type => {
    const cb = h('input', {
      type: 'checkbox', checked: selected.has(type),
      onchange: e => { if (e.target.checked) selected.add(type); else selected.delete(type); },
    });
    const d = dueFor(type);
    return h('label', null, cb, h('span', { style: 'flex:1' }, t(type)),
      d ? h('span', { class: 'chip ' + (d.state === 'overdue' ? 'overdue' : 'due') }, d.state === 'overdue' ? `${d.overdueMin}′` : t('due')) : null);
  }));

  const close = openModal(h('div', null,
    h('h2', null, title),
    h('p', { class: 'muted' }, t('pt.pick_help')),
    list,
    h('div', { class: 'wizard-nav' },
      h('button', { class: 'btn secondary', onclick: () => close() }, t('cancel')),
      h('button', {
        class: 'btn', onclick: () => {
          close();
          const order = all.filter(x => selected.has(x));
          if (order.length) openRecordWizard(p, order, null, { title });
        },
      }, t('next') + ' →'),
    ),
  ));
}

// --------------------------------------------------------- alert strip ----

const urgentFirst = (a, b) => (b.severity === 'danger') - (a.severity === 'danger')
  || String(b.time).localeCompare(String(a.time));

/**
 * Alerts waiting for acknowledgement. A live part: always returns an element
 * (data-live="alert-strip"), empty when nothing is waiting. Open alerts get
 * the red card; alerts that closed before anyone acknowledged them are
 * acknowledged with them, or on their own muted card when none is open.
 */
export function alertStrip(p) {
  const root = h('div', { 'data-live': 'alert-strip' });
  const { open, closed } = waitingAlerts(p);
  const nClosed = closed.length;
  // the buttons re-read the case when tapped (app.js may keep this element),
  // so an alert acknowledged meanwhile is never acknowledged again
  if (open.length) {
    root.append(h('div', { class: 'card', style: 'border:2px solid var(--c-danger)' },
      h('h2', null, '⚠ ' + (open.length === 1
        ? t('pt.unacked_one', { n: 1 }) : t('pt.unacked_other', { n: open.length }))),
      open.slice(0, 3).map(a => alertBanner(a)),
      open.length > 3 ? h('p', { class: 'muted' }, t('pt.more_on_alerts_tab', { n: open.length - 3 })) : null,
      nClosed ? h('p', { class: 'muted' }, nClosed === 1
        ? t('pt.closed_ack_with_one', { n: 1 }) : t('pt.closed_ack_with_other', { n: nClosed })) : null,
      h('button', {
        class: 'btn danger', onclick: () => { const w = waitingAlerts(p); showAlertAckModal(p, [...w.open, ...w.closed]); },
      }, t('pt.review_ack')),
    ));
  } else if (nClosed) {
    root.append(h('div', { class: 'alert-closed' },
      h('p', { style: 'margin:0 0 8px' }, nClosed === 1
        ? t('pt.closed_unacked_one', { n: 1 }) : t('pt.closed_unacked_other', { n: nClosed })),
      h('button', { class: 'btn secondary', onclick: () => showAlertAckModal(p, waitingAlerts(p).closed) }, t('pt.acknowledge')),
    ));
  }
  return root;
}

/** Unacknowledged alerts: open ones most urgent first, and those already closed. */
function waitingAlerts(p) {
  const waiting = (p.alerts || []).filter(a => !a.ack && a.severity !== 'info');
  return { open: waiting.filter(a => !a.resolved).sort(urgentFirst), closed: waiting.filter(a => a.resolved) };
}

// ------------------------------------------------------------- entries ----

// Entry values in words. Each map is a function, so its labels are read in
// the language of the moment. Codes (M+, OA, +) and units (cm, mL, U/L, deg C)
// are shown as they are; a value missing from a map is shown as stored.
const LIQUOR = () => ({
  I: t('pt.liquor_I'), C: t('pt.liquor_C'), M1: 'M+', M2: 'M++', M3: t('pt.liquor_M3'), B: t('pt.liquor_B'),
  M: t('pt.liquor_M'),
});
const DUR_BAND = { lt20: '<20', b20_40: '20–40', b40_60: '40–60', gt60: '>60' }; // seconds, see bandText
const URINE = () => {
  const neg = t('pt.urine_neg');
  return { nil: neg, neg, negative: neg, '-': neg, trace: t('pt.urine_trace') };
};
const YND = () => ({ Y: t('pt.ynd_Y'), N: t('pt.ynd_N'), D: t('pt.ynd_D') });
const POSTURE = () => ({
  upright: t('pt.posture_upright'), lateral: t('pt.posture_lateral'), supine: t('pt.posture_supine'),
  SP: t('pt.posture_SP'), MO: t('pt.posture_MO'),
});
const POSITION = () => ({ unknown: t('pt.position_unknown') });
const PRESENTATION = () => ({
  cephalic: t('pt.pres_cephalic'), breech: t('pt.pres_breech'), transverse: t('pt.pres_transverse'), other: t('pt.pres_other'),
});
const DECEL = () => ({
  early: t('pt.decel_early'), variable: t('pt.decel_variable'), late: t('pt.decel_late'), prolonged: t('pt.decel_prolonged'),
});
const BLEEDING = () => ({ normal: t('pt.bleeding_normal') });
const TONE = () => ({ firm: t('pt.tone_firm'), soft: t('pt.tone_soft') });
const FUNDUS = () => ({ below: t('pt.fundus_below'), at: t('pt.fundus_at'), above: t('pt.fundus_above') });
const BREATHING = () => ({
  normal: t('pt.breathing_normal'), difficult: t('pt.breathing_difficult'), none: t('pt.breathing_none'),
});
const FEEDING = () => ({ good: t('pt.feeding_good'), poor: t('pt.feeding_poor') });
const LOSS_METHOD = () => ({ drape: t('pt.loss_drape'), weighed: t('pt.loss_weighed'), estimate: t('pt.loss_estimate') });
const MED_KIND = () => ({ medicine: t('pt.med_medicine'), ivfluid: t('pt.med_ivfluid'), oxytocin: t('pt.med_oxytocin') });

const has = x => x != null && x !== '';
const join = parts => parts.filter(Boolean).join(' · ');
const label = (map, x) => (has(x) ? map()[x] || String(x) : null);
const tempText = x => (has(x) ? x + ' °C' : null);
const bpText = v => (has(v.sys) || has(v.dia) ? t('pt.s_bp', { sys: v.sys ?? '—', dia: v.dia ?? '—' }) : null);
/** A contraction-duration band in seconds; a band the map does not know is shown as stored. */
const bandText = band => (DUR_BAND[band] ? t('pt.seconds', { n: DUR_BAND[band] }) : String(band));
const fluidText = x => (has(x) ? t('pt.s_fluid', { v: label(LIQUOR, x) }) : null);

/** One entry's values in plain words, for the entries table and the dialogs. */
function obsSummary(o) {
  const v = o.v || {};
  switch (o.type) {
    case 'baby':
      return join([t('pt.s_fhr', { v: v.fhr ?? '—' }),
        has(v.decel) && v.decel !== 'none' ? t('pt.s_decel', { v: label(DECEL, v.decel) }) : null, fluidText(v.liquor)]);
    case 'contractions':
      return join([t('pt.s_per10min', { n: v.count ?? '—' }),
        has(v.durBand) ? bandText(v.durBand) : has(v.duration) ? t('pt.seconds', { n: v.duration }) : null]);
    case 'pulse': return t('pt.s_bpm', { v: v.pulse ?? '—' });
    case 'vitals':
      return join([bpText(v), tempText(v.temp),
        has(v.protein) ? t('pt.s_protein', { v: label(URINE, v.protein) }) : null,
        has(v.acetone) ? t('pt.s_acetone', { v: label(URINE, v.acetone) }) : null]);
    case 'exam':
      return join([`${v.dilatation ?? '—'} cm`, has(v.descent) ? v.descent + '/5' : null,
        has(v.presentation) && v.presentation !== 'cephalic' ? label(PRESENTATION, v.presentation) : null,
        label(POSITION, v.position),
        v.caput ? t('pt.s_caput', { v: '+'.repeat(v.caput) }) : null,
        v.moulding ? t('pt.s_moulding', { v: '+'.repeat(v.moulding) }) : null,
        fluidText(v.liquor)]);
    case 'supportive':
      return join([has(v.companion) ? t('pt.s_companion', { v: label(YND, v.companion) }) : null,
        has(v.painRelief) ? t('pt.s_pain_relief', { v: label(YND, v.painRelief) }) : null,
        has(v.oralFluid) ? t('pt.s_oral_fluid', { v: label(YND, v.oralFluid) }) : null, label(POSTURE, v.posture)]);
    case 'oxytocin':
      return join([has(v.uL) ? v.uL + ' U/L' : null, has(v.dropsMin) ? t('pt.s_drops', { n: v.dropsMin }) : null]);
    case 'ppMother':
      return join([
        has(v.bleeding) ? (v.bleeding === 'heavy' ? t('pt.s_bleeding_heavy') : t('pt.s_bleeding', { v: label(BLEEDING, v.bleeding) })) : null,
        has(v.tone) ? t('pt.s_uterus', { v: label(TONE, v.tone) }) : null, label(FUNDUS, v.fundus),
        has(v.pulse) ? t('pt.s_pulse', { v: v.pulse }) : null, bpText(v), tempText(v.temp),
        has(v.urinePassed) ? (v.urinePassed === 'Y' ? t('pt.s_urine_passed') : t('pt.s_urine_not_passed')) : null]);
    case 'ppBaby':
      return join([label(BREATHING, v.breathing), tempText(v.temp),
        has(v.feeding) ? t('pt.s_feeding', { v: label(FEEDING, v.feeding) }) : null]);
    case 'bloodloss':
      return join([has(v.ml) ? t('pt.s_loss_total', { n: v.ml }) : null, label(LOSS_METHOD, v.method)]);
    case 'event':
      return v.event === 'pushing' ? `${t('pushing')} (P)` : String(v.event || t('event'));
    default:
      return join(Object.entries(v).filter(([, x]) => has(x) && typeof x !== 'object').map(([k, x]) => `${k} ${x}`));
  }
}

const newestFirst = (a, b) => String(b.time).localeCompare(String(a.time))
  || String(b.enteredAt || '').localeCompare(String(a.enteredAt || ''));

function entriesTab(p) {
  const rows = (p.obs || []).slice().sort(newestFirst);
  const meds = (p.meds || []).slice().sort(newestFirst);
  const voided = rows.filter(o => o.voided).length;
  return h('div', { class: 'card' },
    h('h2', null, `${t('entries')} (${rows.length - voided}${voided ? ', ' + t('pt.n_voided', { n: voided }) : ''})`),
    rows.length ? h('table', { class: 'entries' },
      h('thead', null, h('tr', null,
        h('th', null, t('pt.col_time')), h('th', null, t('pt.col_type')), h('th', null, t('pt.col_values')), h('th', null, ''))),
      h('tbody', null, rows.map(o => entryRow(p, o))),
    ) : h('p', { class: 'muted' }, t('pt.no_entries')),
    meds.length ? [h('h3', null, t('pt.meds_title')), h('table', { class: 'entries' },
      h('tbody', null, meds.map(m => h('tr', { class: m.voided ? 'voided' : null },
        h('td', null, when(m.time)), h('td', null, label(MED_KIND, m.kind)),
        h('td', null, [m.detail, m.oxyUL ? m.oxyUL + ' U/L' : null, m.oxyDrops ? t('pt.s_drops', { n: m.oxyDrops }) : null].filter(Boolean).join(' · ')),
        h('td', null, h('span', { class: 'entry-by' }, m.by || '-')),
      ))),
    )] : null,
  );
}

function entryRow(p, o) {
  const voided = !!o.voided;
  const flagged = !voided && o.flags && o.flags.length;
  return h('tr', { class: voided ? 'voided' : null },
    h('td', null, when(o.time)),
    h('td', null, t(o.type), o.source === 'admission' ? h('div', { class: 'muted' }, t('pt.at_admission')) : null),
    h('td', { class: flagged ? 'flagged' : null },
      obsSummary(o),
      // initials sit under the values: a fifth column overflows a 360 px phone
      h('div', null, h('span', { class: 'entry-by' }, t('pt.by', { by: o.by || '-' }))),
      o.replaces ? h('div', { class: 'muted' }, t('pt.corrected_entry')) : null,
      // .entry-by is inline-block in a voided row (css), so the reason is not struck through
      voided ? h('div', null, h('span', { class: 'entry-by void-note' },
        t('pt.voided_by', { by: o.voided.by || '?', reason: o.voided.reason }))) : null,
    ),
    h('td', null, voided ? null : h('span', { class: 'entry-actions' },
      // an event (pushing) has no values to correct: void it and record again
      WIZARD_TYPES.includes(o.type) && o.type !== 'event'
        ? h('button', { type: 'button', class: 'btn secondary', onclick: () => correctEntry(p, o) }, t('pt.correct')) : null,
      h('button', { type: 'button', class: 'btn ghost', style: 'color:var(--c-danger)', onclick: () => voidEntry(p, o) }, t('pt.void')),
    )),
  );
}

/**
 * What voiding an entry changes, in plain words, from previewVoid (nothing is
 * written until the midwife confirms).
 */
function consequenceLines(p, o, pv) {
  const proto = getProtocol(S.settings, p);
  const tr = pv.transitions || [];
  const lines = [];
  const secondBack = tr.includes('second_reverted');
  const activeBack = tr.includes('active_reverted');
  if (secondBack && activeBack) lines.push(t('pt.void_both_revert', { cm: proto.activeStartCm }));
  else if (secondBack) lines.push(t('pt.void_second_reverts'));
  else if (activeBack) lines.push(t('pt.void_active_reverts', { cm: proto.activeStartCm }));
  if (tr.includes('active_moved')) {
    lines.push(t('pt.void_active_moved', { after: fmtDT(pv.after.activeStartTime), before: fmtDT(pv.before.activeStartTime) }));
  }
  if (tr.includes('second_moved')) {
    lines.push(t('pt.void_second_moved', { after: fmtDT(pv.after.secondStageStart), before: fmtDT(pv.before.secondStageStart) }));
  }
  if (tr.includes('active')) lines.push(t('pt.void_active_starts', { at: fmtDT(pv.after.activeStartTime) }));
  if (tr.includes('second')) lines.push(t('pt.void_second_starts', { at: fmtDT(pv.after.secondStageStart) }));
  const clock = pushingClockLine(p, o, proto, secondBack);
  if (clock) lines.push(clock);
  // alert titles come from the engine and stay English (not machine-translated)
  for (const title of pv.resolved || []) lines.push(t('pt.void_alert_closes', { title }));
  for (const title of pv.reopened || []) lines.push(t('pt.void_alert_reopens', { title }));
  // entries judged again when a stage start moves can raise an alert (record.js restaging)
  for (const title of pv.added || []) lines.push(t('pt.void_alert_opens', { title }));
  if (!lines.length) lines.push(t('pt.void_no_change'));
  return lines;
}

/**
 * LCG: the second-stage limit counts from pushing (F2). Voiding a pushing
 * mark, or an exam that decides which mark counts, moves that clock.
 */
function pushingClockLine(p, o, proto, secondBack) {
  if (proto.secondStageClock !== 'pushing' || !p.secondStageStart || secondBack) return null;
  const before = secondStagePushing(p);
  let copy;
  try {
    copy = structuredClone(p);
    voidObservation(copy, o.id, S.settings, { reason: 'preview' });
  } catch (err) {
    // previewVoid already succeeded; this extra line is only informative
    console.warn('Pushing-clock preview failed', err);
    return null;
  }
  const after = secondStagePushing(copy);
  if (after === before) return null;
  if (after) {
    return before
      ? t('pt.push_clock_moved', { after: fmtTime(after), before: fmtTime(before) })
      : t('pt.push_clock_from_push', { after: fmtTime(after) });
  }
  return t('pt.push_clock_from_full', { time: fmtTime(copy.secondStageStart) });
}

async function voidEntry(p, o) {
  let pv;
  try {
    pv = previewVoid(p, o.id, S.settings);
  } catch (err) {
    toast(errText(err), 'danger');
    return;
  }
  const r = await promptDialog({
    title: t('pt.void_title', { type: t(o.type), time: when(o.time) }),
    message: t('pt.void_message', { summary: obsSummary(o) }),
    lines: consequenceLines(p, o, pv),
    needReason: true, danger: true, by: getBy(), okLabel: t('pt.void_ok'),
  });
  if (!r) return;
  const done = await commit(p, () => voidObservation(p, o.id, S.settings, { by: r.by, reason: r.reason }));
  if (!done) return;
  setBy(r.by);
  toast(t('pt.voided_toast'));
  const reopened = (done.result.reopened || []).length;
  if (reopened) toast(reopened === 1 ? t('pt.reopened_one', { n: 1 }) : t('pt.reopened_other', { n: reopened }), 'danger');
  const opened = (done.result.added || []).length;
  if (opened) toast(opened === 1 ? t('pt.opened_one', { n: 1 }) : t('pt.opened_other', { n: opened }), 'danger');
  // alerts the void opened (restaging, time rules) are acknowledged now, as after recording an entry
  if (opened) showAlertAckModal(p, done.result.added);
}

async function correctEntry(p, o) {
  let pv;
  try {
    pv = previewVoid(p, o.id, S.settings);
  } catch (err) {
    toast(errText(err), 'danger');
    return;
  }
  const r = await promptDialog({
    title: t('pt.correct_title', { type: t(o.type), time: when(o.time) }),
    message: t('pt.correct_message', { summary: obsSummary(o) }),
    lines: [...consequenceLines(p, o, pv), t('pt.correct_recheck')],
    needReason: true, by: getBy(), okLabel: t('pt.correct_ok'),
  });
  if (!r) return;
  setBy(r.by);
  openRecordWizard(p, [o.type], null, { prefill: { ...o.v }, time: o.time, replaces: o.id, reason: r.reason, by: r.by });
}

// -------------------------------------------------------------- alerts ----

const HOW = () => ({
  evidence: t('pt.how_evidence'),
  cleared: t('pt.how_cleared'),
  void: t('pt.how_void'),
  birth: t('pt.how_birth'),
  manual: t('pt.how_manual'),
  handover: t('pt.how_handover'),
  restaged: t('pt.how_restaged'),
});
const ACTION = () => ({
  monitoring: t('pt.action_monitoring'), senior: t('pt.action_senior'),
  intervention: t('pt.action_intervention'), referral: t('pt.action_referral'),
});

function alertsTab(p) {
  // open and unacknowledged first, then closed unacknowledged, open, closed
  const rank = a => (a.ack ? 2 : 0) + (a.resolved ? 1 : 0);
  const list = (p.alerts || []).slice().sort((a, b) => rank(a) - rank(b) || String(b.time).localeCompare(String(a.time)));
  const wrap = h('div');
  if (!list.length) wrap.append(h('div', { class: 'empty-state' }, h('div', { class: 'ico' }, '✅'), h('p', null, t('pt.no_alerts'))));
  for (const a of list) {
    if (a.severity === 'info') {
      wrap.append(h('div', { class: 'card', style: 'padding:10px 14px' },
        h('span', { class: 'muted' }, `${fmtDT(a.time)} · ℹ ${a.title}`)));
      continue;
    }
    wrap.append(alertItem(p, a));
  }
  return wrap;
}

const entryBy = (p, id) => (id && ((p.obs || []).find(o => o.id === id) || {}).by) || null;

/** Who raised an alert: the emergency's author, or the author of the entry behind it. */
const raisedBy = (p, a) => a.by || entryBy(p, a.obsId);

/** Who closed an alert: by hand or by a void, else the author of what closed it. */
function closedBy(p, a) {
  if (a.resolvedBy) return a.resolvedBy;
  if (a.resolvedHow === 'evidence') return entryBy(p, a.resolvedByObs);
  if (a.resolvedHow === 'birth') return (p.delivery && p.delivery.by) || null;
  if (a.resolvedHow === 'handover') return (p.referral && p.referral.handoverBy) || null;
  return null; // 'cleared': the time rule stopped firing on its own
}

/** Closed or open, by whom and how; a typed resolve reason is appended as written. */
function alertStatus(p, a) {
  if (!a.resolved) return t('pt.alert_open') + (a.escalatedAt ? ' - ' + t('pt.alert_escalated', { time: when(a.escalatedAt) }) : '');
  const closer = closedBy(p, a);
  const time = when(a.resolvedAt);
  const how = HOW()[a.resolvedHow] || a.resolvedHow || t('pt.how_closed');
  return (closer ? t('pt.alert_closed_by', { time, how, by: closer }) : t('pt.alert_closed', { time, how }))
    + (a.resolveReason ? ` - ${a.resolveReason}` : '');
}

/** Acknowledged when, by whom, with which action; or not yet. */
function ackStatus(a) {
  if (!a.ack) return t('pt.alert_not_acked');
  const time = when(a.actionTime);
  return (a.ackBy ? t('pt.alert_acked_by', { time, by: a.ackBy }) : t('pt.alert_acked', { time }))
    + (a.action ? ` - ${ACTION()[a.action] || a.action}` : '');
}

function alertItem(p, a) {
  const raiser = raisedBy(p, a);
  const meta = [fmtDT(a.time), a.episode > 1 ? t('pt.alert_episode', { n: a.episode }) : null,
    a.count > 1 ? t('pt.alert_seen', { n: a.count }) : null,
    raiser ? t('pt.alert_raised_by', { by: raiser }) : null].filter(Boolean).join(' - ');
  const buttons = [
    a.ack ? null : h('button', {
      class: 'btn secondary', onclick: () => { if (a.ack) toast(t('pt.already_acked')); else showAlertAckModal(p, [a]); },
    }, t('pt.acknowledge')),
    a.resolved ? null : h('button', { class: 'btn ghost', onclick: () => resolveFlow(p, a) }, t('pt.resolve')),
  ].filter(Boolean);
  const details = h('div', { style: 'margin-top:6px' },
    h('p', { class: 'muted', style: 'margin:0' }, alertStatus(p, a)),
    h('p', { class: 'muted', style: 'margin:0' }, ackStatus(a)),
    buttons.length ? h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px' }, buttons) : null,
  );
  return h('div', { style: 'margin-bottom:4px' + (a.resolved ? ';opacity:.8' : '') },
    h('p', { class: 'muted', style: 'margin:0 0 2px;font-size:.8rem' }, meta),
    alertBanner(a, details));
}

async function resolveFlow(p, a) {
  const r = await promptDialog({
    title: t('pt.resolve_title'),
    message: t('pt.resolve_message', { title: a.title }) + (a.source === 'time' ? ' ' + t('pt.resolve_message_time') : ''),
    needReason: true, by: getBy(), okLabel: t('pt.resolve'),
  });
  if (!r) return;
  const done = await commit(p, () => {
    const res = resolveAlert(p, a.id, { by: r.by, reason: r.reason });
    if (!res) throw new Error(t('pt.alert_already_closed'));
    return res;
  });
  if (!done) return;
  setBy(r.by);
  toast(done.result.ack ? t('pt.resolved_toast') : t('pt.resolved_toast_unacked'));
}

// ---------------------------------------------------------- emergencies ---

export function openEmergencyModal(p) {
  const body = h('div');
  const close = openModal(body, { locked: false });

  // emergency names and actions (EMERGENCIES, alerts.js) stay English until
  // the clinical panel validates translations: they become the alert itself
  function menu() {
    clear(body);
    body.append(
      h('h2', null, '🚨 ' + t('emergency')),
      h('p', { class: 'muted' }, t('pt.emergency_help')),
      ...EMERGENCIES.map(e => h('button', { class: 'btn big danger', style: 'margin-bottom:8px', onclick: () => detail(e) }, e.label)),
      h('button', { class: 'btn ghost big', onclick: () => close() }, t('cancel')),
    );
  }

  function detail(e) {
    let by = '', busy = false;
    const err = h('p', { class: 'muted', style: 'color:var(--c-danger);min-height:1.2em' }, '');
    clear(body);
    body.append(
      h('h2', null, '🚨 ' + e.label),
      h('ul', { class: 'advice', style: 'font-size:1.05rem;line-height:1.5' }, e.advice.map(a => h('li', null, a))),
      byField(getBy(), v => { by = v; }),
      err,
      h('div', { class: 'wizard-nav' },
        h('button', { class: 'btn secondary', onclick: () => menu() }, t('back')),
        h('button', {
          class: 'btn danger', onclick: async () => {
            if (!by) {
              err.textContent = t('pt.initials_required');
              return;
            }
            if (busy) return; // a double tap must not declare the emergency twice
            busy = true;
            const at = new Date().toISOString();
            // the alert and the note are written into the record: English, whatever the screen language
            const done = await commit(p, () => {
              const added = addAlerts(p, [{ code: 'emg_' + e.code, severity: 'danger', title: 'EMERGENCY: ' + e.label, advice: e.advice }],
                'manual', { time: at, raisedAt: at });
              for (const a of added) if (!a.by) a.by = by;
              p.notes = [...(p.notes || []),
                { id: uid(), time: at, by, text: 'Emergency declared: ' + e.label, plan: 'emergency management + referral assessment' }];
            });
            if (!done) {
              busy = false;
              return;
            }
            setBy(by);
            close();
            toast(t('pt.emergency_recorded'), 'danger');
            location.hash = `#/p/${p.id}/referral`;
          },
        }, t('pt.emergency_record')),
      ),
    );
  }
  menu();
}

// -------------------------------------------------------------- summary ----

const ONSET = () => ({ spontaneous: t('pt.onset_spontaneous'), induced: t('pt.onset_induced'), unknown: t('pt.not_recorded') });

function summaryTab(p, now) {
  return h('div', null,
    admissionCard(p),
    auditCard(p, now),
    h('div', { class: 'card' },
      h('h2', null, t('pt.notes_title')),
      (p.notes || []).slice().sort((a, b) => String(b.time).localeCompare(String(a.time))).map(n =>
        h('div', { style: 'border-bottom:1px solid var(--c-line);padding:8px 0' },
          h('p', { class: 'muted', style: 'margin:0;font-size:.8rem' }, fmtDT(n.time) + (n.by ? ' - ' + t('pt.by', { by: n.by }) : '')),
          n.text ? h('p', { style: 'margin:2px 0' }, n.text) : null,
          // an acknowledgement note stores its action as a code: show it in words
          n.plan ? h('p', { class: 'muted', style: 'margin:0' }, t('pt.plan', { plan: (isAckNote(n) && ACTION()[n.plan]) || n.plan })) : null,
        )),
      noteForm(p),
    ),
    caseActions(p),
  );
}

function admissionCard(p) {
  const a = p.admission || {};
  const onsets = ONSET();
  const onset = [onsets[p.onsetMode] || p.onsetMode || onsets.unknown,
    p.laborOnsetTime ? t('pt.onset_began', { time: fmtDT(p.laborOnsetTime) }) : null].filter(Boolean).join(' - ');
  const rom = p.romUnknown ? t('pt.rom_ruptured_unknown')
    : p.romTime ? t('pt.rom_ruptured_at', { time: fmtDT(p.romTime) }) : t('pt.rom_intact');
  const wanted = p.companionWanted === true ? t('yes') : p.companionWanted === false ? t('no') : t('pt.not_recorded');
  const pushing = secondStagePushing(p);
  return h('div', { class: 'card' },
    h('h2', null, t('pt.admission_title')),
    kv(t('pt.adm_admitted'), fmtDT(a.time)),
    kv(t('pt.adm_onset'), onset),
    kv(t('pt.adm_rom'), rom),
    kv(t('pt.adm_exam'), admissionExamText(a)),
    kv(t('pt.adm_active_from'), p.activeStartTime ? fmtDT(p.activeStartTime) : t('pt.not_reached')),
    p.secondStageStart ? kv(t('pt.adm_second_from'), fmtDT(p.secondStageStart)) : null,
    pushing ? kv(t('pushing'), fmtDT(pushing)) : null,
    kv(t('pt.adm_companion'), wanted),
    kv(t('pt.adm_risk'), riskFactorsText(p.riskFactors) || t('pt.none_recorded')),
    kv(t('pt.adm_contact'), [p.phone, p.kebele].filter(Boolean).join(' · ') || '—'),
    kv(t('pt.adm_protocol'), getProtocol(S.settings, p).name),
  );
}

/**
 * Risk factor codes in words in the screen language, with the admission
 * form's labels (fm.risk.*, js/i18n/forms.js); a code with no label is shown
 * as stored. '' for none. Pure: exported for the tests.
 */
export function riskFactorsText(codes) {
  return (codes || []).map(code => {
    const key = 'fm.risk.' + code;
    const words = t(key);
    return words === key ? String(code) : words; // t() returns the key itself when no language has it
  }).join(', ');
}

/** The admission exam in one line; descent and presentation only when recorded. Pure: exported for the tests. */
export function admissionExamText(a) {
  return join([`${a.dilatation ?? '—'} cm`, has(a.descent) ? t('pt.s_descent', { v: a.descent }) : null,
    t('pt.s_fhr_short', { v: a.fhr ?? '—' }), label(PRESENTATION, a.presentation)]);
}

const pct = r => (r == null ? '-' : `${Math.round(r * 100)}%`);
const rateText = x => (!x || x.rate == null ? t('pt.audit_nothing_due') : `${pct(x.rate)} (${x.met}/${x.windows})`);
const auditRow = (name, value) => h('div', { class: 'audit-row' }, h('span', null, name), h('b', null, value));

/** Per-case completeness from the WHO LCG audit tool (N2, IRP Annex 8), computed by audit.js. */
function auditCard(p, now) {
  const a = auditCase(p, getProtocol(S.settings, p), now);
  const card = h('div', { class: 'card audit-card' },
    h('h2', null, a.tool === 'lcg' ? t('pt.audit_title_lcg') : t('pt.audit_title_partograph')));
  if (!a.applicable) {
    card.append(h('p', { class: 'muted', style: 'margin:0' }, t('pt.audit_not_applicable')));
    if (a.voided) card.append(auditRow(t('pt.audit_voided'), String(a.voided)));
    return card;
  }
  const s = a.sections;
  const d = a.defaulted;
  // native append() would print "null": optional rows are filtered out first
  card.append(...[
    auditRow(t('pt.audit_score'), a.score == null ? t('pt.audit_not_scored') : `${a.score} / 100`),
    auditRow(t('pt.audit_header'), pct(a.header.score)),
    auditRow(t('supportive'), rateText(s.supportive)),
    auditRow(t('baby'), rateText(s.baby)),
    auditRow(t('pt.audit_woman'), rateText(s.woman)),
    auditRow(t('pt.audit_progress'), rateText(s.progress)),
    auditRow(t('pt.audit_medication'), s.medication ? rateText(s.medication) : t('pt.audit_na')),
    auditRow(t('pt.audit_decisions'), rateText(s.decisions)),
    auditRow(t('pt.audit_initials'), rateText(s.initials)),
    auditRow(t('pt.audit_alerts_acked', { n: LIMITS.audit.ackWithinMin }),
      a.alerts.raised ? `${pct(a.alerts.rate)} (${a.alerts.ackedInTime}/${a.alerts.raised})` : t('pt.audit_no_alerts')),
    auditRow(t('pt.audit_defaulted'), d.entries === 1
      ? t('pt.audit_defaulted_one', { v: d.values, n: 1 }) : t('pt.audit_defaulted_other', { v: d.values, n: d.entries })),
    auditRow(t('pt.audit_voided'), String(a.voided)),
    a.durations.activeMin != null ? auditRow(t('pt.audit_active'), minText(a.durations.activeMin)) : null,
    a.durations.secondMin != null ? auditRow(t('pt.audit_second'), minText(a.durations.secondMin)) : null,
  ].filter(Boolean));
  if (a.tool === 'lcg') {
    card.append(h('p', { class: 'muted', style: 'margin:8px 0 0' },
      a.completed ? t('pt.audit_completed') : t('pt.audit_not_completed')));
  }
  return card;
}

/**
 * Add-note form (data-form="note"), initials required (F3). Empty, it holds
 * nothing to lose: it is marked saved until something is typed, so the
 * Summary tab keeps refreshing.
 */
function noteForm(p) {
  let by = '', busy = false;
  const typed = () => {
    if (noteText.value.trim() || notePlan.value.trim()) delete form.dataset.saved;
    else form.dataset.saved = '1';
  };
  const noteText = h('textarea', { placeholder: t('pt.note_placeholder'), oninput: typed });
  const notePlan = h('textarea', { placeholder: t('pt.plan_placeholder'), oninput: typed });
  const err = h('p', { class: 'muted', style: 'color:var(--c-danger);min-height:1.2em' }, '');
  const form = h('div', { 'data-form': 'note', 'data-saved': '1' },
    h('h3', null, t('pt.add_note')),
    noteText, notePlan,
    byField(getBy(), v => { by = v; }),
    err,
    h('button', {
      class: 'btn', style: 'margin-top:8px', onclick: async () => {
        const text = noteText.value.trim(), plan = notePlan.value.trim();
        if (!text && !plan) {
          err.textContent = t('pt.note_empty');
          return;
        }
        if (!by) {
          err.textContent = t('pt.initials_required');
          return;
        }
        if (busy) return; // a double tap must not save the note twice
        busy = true;
        form.dataset.saved = '1'; // before the save: the re-render it triggers may replace this form
        const done = await commit(p, () => {
          p.notes = [...(p.notes || []), { id: uid(), time: new Date().toISOString(), by, text, plan }];
        });
        busy = false;
        if (!done) {
          delete form.dataset.saved; // not saved: the typed note stays protected
          return;
        }
        // if the page is kept, the saved note is not offered for saving again
        noteText.value = '';
        notePlan.value = '';
        err.textContent = '';
        setBy(by);
        toast(t('pt.note_saved') + ' ✓');
      },
    }, t('save')),
  );
  return form;
}

/**
 * The rule behind "Close case": never while she is in labour (or referred in
 * labour with no handover recorded), and never twice. Closing during the
 * postpartum watch is allowed: the dialog warns that its checks stop.
 */
export function canClose(p) {
  return !isLabouring(p) && stageOf(p) !== 'closed';
}

/**
 * The fields closing writes: status, time and initials (F3). Refuses a case
 * canClose rejects and a close without initials. Pure: it returns new fields
 * and never changes p; the caller applies them.
 */
export function closeFields(p, by, at) {
  if (!canClose(p)) {
    throw new Error(stageOf(p) === 'closed' ? t('pt.close_err_closed') : t('pt.close_err_labour'));
  }
  if (!String(by || '').trim()) throw new Error(t('pt.close_err_initials'));
  return { status: 'closed', closedAt: at, closedBy: by };
}

/** Close the case with initials (F3): it leaves the active list; the record stays. */
async function closeCase(p) {
  const watching = inPostpartumWatch(p, new Date());
  const r = await promptDialog({
    title: t('pt.close_case'),
    message: t('pt.close_message') + (watching ? ' ' + t('pt.close_message_watch') : ''),
    by: getBy(), okLabel: t('pt.close_case'),
  });
  if (!r) return;
  // closeFields re-checks canClose at the write: a page drawn before the case
  // changed cannot close it, and commit shows why
  const done = await commit(p, () => {
    Object.assign(p, closeFields(p, r.by, new Date().toISOString()));
  });
  if (!done) return;
  setBy(r.by);
  location.hash = '#/';
}

function caseActions(p) {
  const demo = isDemo(p);
  return h('div', { class: 'card no-print' },
    h('h2', null, t('pt.case_actions')),
    h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
      h('button', { class: 'btn secondary', onclick: () => downloadFHIR(p, S.settings) }, '⇩ ' + t('pt.export_fhir')),
      h('button', { class: 'btn secondary', onclick: () => window.print() }, '🖨 ' + t('pt.print_summary')),
      canClose(p)
        ? h('button', { class: 'btn secondary', onclick: () => closeCase(p) }, t('pt.close_case')) : null,
      // S5: only a DEMO case can be deleted; a real case is closed, never deleted
      demo ? h('button', {
        class: 'btn ghost', style: 'color:var(--c-danger)', onclick: async () => {
          if (await confirmDialog(t('pt.delete_confirm'), { okLabel: t('pt.delete'), danger: true })) {
            try {
              await removePatient(p.id);
            } catch (err) {
              toast(t('pt.not_deleted', { err: errText(err) }), 'danger');
              return;
            }
            location.hash = '#/';
          }
        },
      }, t('pt.delete_case')) : null,
    ),
    demo ? null : h('p', { class: 'muted', style: 'margin:8px 0 0' }, t('pt.real_cases_note')),
  );
}
