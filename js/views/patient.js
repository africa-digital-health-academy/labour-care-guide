// views/patient.js - one case: header (stage, clocks, due chips, actions),
// alert strip, and the chart, entries, alerts, summary, referral and delivery
// tabs, plus the emergency card.
//
// Live parts (S3): the header, the alert strip and the chart body carry
// data-live, so app.js can refresh them on the heartbeat without re-rendering
// the page and wiping a form in progress. The summary note form carries
// data-form="note" and is marked data-saved before it saves.
//
// Corrections are append-only (S5): an entry is voided or corrected with
// initials and a reason, after a confirmation that states what will change -
// labour stage, timers, alerts. Real cases are closed, never deleted; only
// DEMO cases can be deleted. Every record made here carries initials (F3).
// No clinical threshold lives here: the engine decides, this view reports.

import {
  h, clear, openModal, toast, confirmDialog, promptDialog, byField, alertBanner,
  fmtTime, fmtDT, durationSince, APP_TZ,
} from '../ui.js';
import { t } from '../i18n.js';
import { S, savePatient, removePatient, getBy, setBy } from '../store.js';
import {
  LIMITS, getProtocol, dueList, stageOf, isLabouring, awaitingHandover, monitoringStage,
  inPostpartumWatch, secondStagePushing, birthTime, fmtMin,
} from '../protocol.js';
import { EMERGENCIES, addAlerts, resolveAlert } from '../alerts.js';
import { previewVoid, voidObservation, recordEvent } from '../record.js';
import { auditCase } from '../audit.js';
import { isDemo } from '../indicators.js';
import {
  openRecordWizard, openMedicationModal, showAlertAckModal, WIZARD_TYPES, wizardTypeFor,
} from '../wizard.js';
import { renderChart } from '../chart.js';
import { renderReferralTab } from './referral.js';
import { renderDeliveryTab } from './delivery.js';
import { downloadFHIR } from '../fhir.js';

// Labour observations offered by "Record now"; oxytocin joins while it runs.
const LABOUR_TYPES = ['baby', 'contractions', 'pulse', 'vitals', 'exam', 'supportive'];
// Postpartum checks offered by "Record check"; blood loss only when measured,
// so it is not pre-selected unless it is due.
const PP_TYPES = ['ppMother', 'ppBaby', 'bloodloss'];
const PP_DEFAULT = ['ppMother', 'ppBaby'];

const TABS = ['chart', 'entries', 'alerts', 'summary', 'referral', 'delivery'];

export function renderPatient(id, tab = 'chart') {
  const p = S.patients.find(x => x.id === id);
  if (!p) return h('div', { class: 'page' }, h('p', null, 'Case not found.'));
  const current = TABS.includes(tab) ? tab : 'chart';
  const now = new Date();
  const page = h('div', { class: 'page' }, patientHeader(p, now), alertStrip(p));

  const labels = {
    chart: t('chart'), entries: t('entries'),
    alerts: `${t('alerts')} (${(p.alerts || []).length})`,
    summary: 'Summary', referral: t('referral'), delivery: t('delivery'),
  };
  page.append(h('div', { class: 'tabs' }, TABS.map(key =>
    h('button', { class: key === current ? 'active' : '', onclick: () => { location.hash = `#/p/${p.id}/${key}`; } }, labels[key]),
  )));

  const body = h('div');
  page.append(body);
  if (current === 'chart') {
    body.append(
      // the live part holds exactly renderChart(p, S.settings), nothing else
      h('div', { 'data-live': 'chart' }, renderChart(p, S.settings)),
      h('p', { class: 'muted', style: 'margin-top:8px' },
        'The chart is drawn automatically from wizard entries. Scroll horizontally for the full timeline.'),
    );
  } else if (current === 'entries') body.append(entriesTab(p));
  else if (current === 'alerts') body.append(alertsTab(p));
  else if (current === 'summary') body.append(summaryTab(p, now));
  else if (current === 'referral') body.append(renderReferralTab(p));
  else if (current === 'delivery') body.append(renderDeliveryTab(p));
  return page;
}

// ------------------------------------------------------------- helpers ----

const errText = err => (err && err.message) || String(err);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const chipRow = kids => h('div', { class: 'chips', style: 'display:flex;flex-wrap:wrap;gap:6px;margin-top:8px' }, kids);
const dayOf = iso => new Date(iso).toLocaleDateString('en-US', { timeZone: APP_TZ });

/** Time of day for today's entries, date and time for older ones. */
function when(iso, now = new Date()) {
  if (!iso) return fmtTime(iso);
  return dayOf(iso) === dayOf(now) ? fmtTime(iso) : fmtDT(iso);
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
    toast('Not saved: ' + errText(err), 'danger');
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
    chips.push(h('span', { class: 'chip' }, 'Active: ' + durationSince(p.activeStartTime, now)));
  }
  if (second && p.secondStageStart) {
    chips.push(h('span', { class: 'chip stage' }, '2nd stage: ' + durationSince(p.secondStageStart, now)));
  }
  if (pushing) {
    chips.push(h('span', { class: 'chip stage' }, `Pushing since ${fmtTime(pushing)} (${durationSince(pushing, now)})`));
  }
  if (labouring && p.romTime) chips.push(h('span', { class: 'chip' }, 'ROM: ' + durationSince(p.romTime, now)));
  else if (labouring && p.romUnknown) chips.push(h('span', { class: 'chip' }, 'ROM: time unknown'));
  if (p.oxytocinRunning) chips.push(h('span', { class: 'chip due' }, '⚠ oxytocin running'));
  if (watch) {
    chips.push(h('span', { class: 'chip pp' },
      `${t('postpartum_watch')} - ${durationSince(birthTime(p), now)} since birth`));
  }

  const go = tab => () => { location.hash = `#/p/${p.id}/${tab}`; };

  // app.js keeps this element when a fresh build has the same markup, so the
  // handlers read the case when tapped and never keep lists from build time
  return h('div', { class: 'card' + (watch ? ' pp-watch' : ''), 'data-live': 'patient-header' },
    h('div', { class: 'row1', style: 'display:flex;gap:10px;align-items:baseline;flex-wrap:wrap' },
      h('span', { class: 'name', style: 'font-size:1.3rem;font-weight:800' }, p.name || 'Unnamed'),
      h('span', { class: 'meta muted' }, `${p.age || '?'} y · G${p.gravida ?? '?'}P${p.para ?? '?'} · GA ${p.gaWeeks || '?'} wk · ${proto.name}`),
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
      watch ? h('button', { class: 'btn', onclick: () => pickAndRecord(p, 'postpartum') }, 'Record check') : null,
      labouring || watch ? h('button', { class: 'btn secondary', onclick: () => openMedicationModal(p) }, '💊 Meds') : null,
      h('button', { class: 'btn danger', onclick: () => openEmergencyModal(p) }, '🚨 ' + t('emergency')),
      labouring || watch || stageOf(p) === 'third' ? h('button', { class: 'btn warn', onclick: go('referral') }, '🏥 ' + t('referral')) : null,
      h('button', { class: 'btn secondary', onclick: go('delivery') }, '👶 ' + t('delivery')),
    ),
  );
}

function dueChip(p, d) {
  return h('button', {
    type: 'button', class: 'chip ' + (d.state === 'overdue' ? 'overdue' : 'due'), style: 'border:none;cursor:pointer',
    onclick: () => openRecordWizard(p, [wizardTypeFor(d.type)]),
  }, `▶ ${t(d.type)} ${d.state === 'overdue' ? d.overdueMin + '′ ' + t('overdue') : t('due')}`);
}

/** The form's P (F2): initials only, then the event is recorded now. */
async function markPushing(p) {
  const proto = getProtocol(S.settings, p);
  const r = await promptDialog({
    title: t('pushing'),
    message: proto.secondStageClock === 'pushing'
      ? 'Record that pushing began now. This is the P on the LCG form: the WHO second-stage time limit counts from this time.'
      : 'Record that pushing began now. It is marked on the chart; this partograph times the second stage from full dilatation.',
    by: getBy(), okLabel: 'Record',
  });
  if (!r) return;
  // the case may have changed while the dialog was open
  if (!isLabouring(p) || monitoringStage(p) !== 'second') {
    toast('She is no longer in the second stage - nothing recorded', 'danger');
    return;
  }
  const already = secondStagePushing(p);
  if (already) {
    toast(`Pushing is already recorded at ${fmtTime(already)}`);
    return;
  }
  const at = new Date().toISOString();
  const done = await commit(p, () => recordEvent(p, 'pushing', at, S.settings, { by: r.by }));
  if (!done) return;
  setBy(r.by);
  toast(`Pushing began ${fmtTime(at)} - recorded`);
  if (done.result.added && done.result.added.length) showAlertAckModal(p, done.result.added);
}

/**
 * Choose what to record now ('labour' or 'postpartum'). Items due now are
 * pre-selected (postpartum BP and urine belong to the mother check);
 * otherwise every labour item, or the mother and baby checks.
 */
function pickAndRecord(p, kind) {
  const labour = kind === 'labour';
  const all = !labour ? PP_TYPES : p.oxytocinRunning ? [...LABOUR_TYPES, 'oxytocin'] : LABOUR_TYPES;
  const fallback = labour ? all : PP_DEFAULT;
  const title = labour ? t('record_now') : 'Record check';
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
    h('p', { class: 'muted' }, 'Due items are pre-selected. Add or remove as needed.'),
    list,
    h('div', { class: 'wizard-nav' },
      h('button', { class: 'btn secondary', onclick: () => close() }, t('cancel')),
      h('button', {
        class: 'btn', onclick: () => {
          close();
          const order = all.filter(x => selected.has(x));
          if (order.length) openRecordWizard(p, order);
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
  // the buttons re-read the case when tapped (app.js may keep this element),
  // so an alert acknowledged meanwhile is never acknowledged again
  if (open.length) {
    root.append(h('div', { class: 'card', style: 'border:2px solid var(--c-danger)' },
      h('h2', null, `⚠ ${open.length} unacknowledged alert${open.length > 1 ? 's' : ''}`),
      open.slice(0, 3).map(a => alertBanner(a)),
      open.length > 3 ? h('p', { class: 'muted' }, `${open.length - 3} more on the Alerts tab.`) : null,
      closed.length ? h('p', { class: 'muted' },
        `${plural(closed.length, 'closed alert')} not yet acknowledged will be acknowledged with them.`) : null,
      h('button', {
        class: 'btn danger', onclick: () => { const w = waitingAlerts(p); showAlertAckModal(p, [...w.open, ...w.closed]); },
      }, 'Review & acknowledge'),
    ));
  } else if (closed.length) {
    root.append(h('div', { class: 'alert-closed' },
      h('p', { style: 'margin:0 0 8px' }, `${plural(closed.length, 'closed alert')} not yet acknowledged`),
      h('button', { class: 'btn secondary', onclick: () => showAlertAckModal(p, waitingAlerts(p).closed) }, 'Acknowledge'),
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

const LIQUOR = { I: 'I (intact)', C: 'C (clear)', M1: 'M+', M2: 'M++', M3: 'M+++ thick', B: 'B (blood)', M: 'M (grade not recorded)' };
const DUR_BAND = { lt20: '<20 s', b20_40: '20–40 s', b40_60: '40–60 s', gt60: '>60 s' };
const URINE = { nil: 'neg', neg: 'neg', negative: 'neg', '-': 'neg', trace: 'trace' };
const YND = { Y: 'yes', N: 'no', D: 'declined' };
const POSTURE = { upright: 'upright', lateral: 'lateral', supine: 'supine', SP: 'supine (SP)', MO: 'mobile (MO)' };
const POSITION = { unknown: 'position unsure' };
const FUNDUS = { below: 'fundus below umbilicus', at: 'fundus at umbilicus', above: 'fundus above umbilicus' };
const BREATHING = { normal: 'breathing normally', difficult: 'breathing with difficulty', none: 'NOT breathing' };
const LOSS_METHOD = { drape: 'calibrated drape', weighed: 'weighed', estimate: 'estimated' };
const MED_KIND = { medicine: 'Medicine', ivfluid: 'IV fluids', oxytocin: 'Oxytocin' };

const has = x => x != null && x !== '';
const join = parts => parts.filter(Boolean).join(' · ');
const label = (map, x) => (has(x) ? map[x] || String(x) : null);
const tempText = x => (has(x) ? x + ' °C' : null);
const bpText = v => (has(v.sys) || has(v.dia) ? `BP ${v.sys ?? '—'}/${v.dia ?? '—'}` : null);
const urineText = (name, g) => (has(g) ? `${name} ${label(URINE, g)}` : null);
const plusText = (name, n) => (n ? `${name} ${'+'.repeat(n)}` : null);

/** One entry's values in plain words, for the entries table and the dialogs. */
function obsSummary(o) {
  const v = o.v || {};
  switch (o.type) {
    case 'baby':
      return join([`FHR ${v.fhr ?? '—'} bpm`, has(v.decel) && v.decel !== 'none' ? 'decel: ' + v.decel : null,
        has(v.liquor) ? 'fluid ' + label(LIQUOR, v.liquor) : null]);
    case 'contractions':
      return join([`${v.count ?? '—'}/10 min`, has(v.durBand) ? label(DUR_BAND, v.durBand) : has(v.duration) ? v.duration + ' s' : null]);
    case 'pulse': return `${v.pulse ?? '—'} bpm`;
    case 'vitals':
      return join([bpText(v), tempText(v.temp), urineText('protein', v.protein), urineText('acetone', v.acetone)]);
    case 'exam':
      return join([`${v.dilatation ?? '—'} cm`, has(v.descent) ? v.descent + '/5' : null,
        has(v.presentation) && v.presentation !== 'cephalic' ? v.presentation : null,
        label(POSITION, v.position), plusText('caput', v.caput), plusText('moulding', v.moulding),
        has(v.liquor) ? 'fluid ' + label(LIQUOR, v.liquor) : null]);
    case 'supportive':
      return join([has(v.companion) ? 'companion ' + label(YND, v.companion) : null,
        has(v.painRelief) ? 'pain relief ' + label(YND, v.painRelief) : null,
        has(v.oralFluid) ? 'oral fluid ' + label(YND, v.oralFluid) : null, label(POSTURE, v.posture)]);
    case 'oxytocin':
      return join([has(v.uL) ? v.uL + ' U/L' : null, has(v.dropsMin) ? v.dropsMin + ' drops/min' : null]);
    case 'ppMother':
      return join([has(v.bleeding) ? (v.bleeding === 'heavy' ? 'HEAVY bleeding' : 'bleeding ' + v.bleeding) : null,
        has(v.tone) ? 'uterus ' + v.tone : null, label(FUNDUS, v.fundus), has(v.pulse) ? `pulse ${v.pulse}` : null,
        bpText(v), tempText(v.temp), has(v.urinePassed) ? (v.urinePassed === 'Y' ? 'urine passed' : 'no urine passed yet') : null]);
    case 'ppBaby':
      return join([label(BREATHING, v.breathing), tempText(v.temp), has(v.feeding) ? 'feeding ' + v.feeding : null]);
    case 'bloodloss':
      return join([has(v.ml) ? `${v.ml} mL in total so far` : null, label(LOSS_METHOD, v.method)]);
    case 'event':
      return v.event === 'pushing' ? `${t('pushing')} (P)` : String(v.event || 'event');
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
    h('h2', null, `${t('entries')} (${rows.length - voided}${voided ? `, ${voided} voided` : ''})`),
    rows.length ? h('table', { class: 'entries' },
      h('thead', null, h('tr', null,
        h('th', null, 'Time'), h('th', null, 'Type'), h('th', null, 'Values'), h('th', null, ''))),
      h('tbody', null, rows.map(o => entryRow(p, o))),
    ) : h('p', { class: 'muted' }, 'No entries yet.'),
    meds.length ? [h('h3', null, 'Medication / fluids'), h('table', { class: 'entries' },
      h('tbody', null, meds.map(m => h('tr', { class: m.voided ? 'voided' : null },
        h('td', null, when(m.time)), h('td', null, label(MED_KIND, m.kind)),
        h('td', null, [m.detail, m.oxyUL ? m.oxyUL + ' U/L' : null, m.oxyDrops ? m.oxyDrops + ' drops/min' : null].filter(Boolean).join(' · ')),
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
    h('td', null, t(o.type), o.source === 'admission' ? h('div', { class: 'muted' }, 'admission') : null),
    h('td', { class: flagged ? 'flagged' : null },
      obsSummary(o),
      // initials sit under the values: a fifth column overflows a 360 px phone
      h('div', null, h('span', { class: 'entry-by' }, 'by ' + (o.by || '-'))),
      o.replaces ? h('div', { class: 'muted' }, 'Corrected entry') : null,
      // .entry-by is inline-block in a voided row (css), so the reason is not struck through
      voided ? h('div', null, h('span', { class: 'entry-by void-note' },
        `Voided by ${o.voided.by || '?'}: ${o.voided.reason}`)) : null,
    ),
    h('td', null, voided ? null : h('span', { class: 'entry-actions' },
      // an event (pushing) has no values to correct: void it and record again
      WIZARD_TYPES.includes(o.type) && o.type !== 'event'
        ? h('button', { type: 'button', class: 'btn secondary', onclick: () => correctEntry(p, o) }, 'Correct') : null,
      h('button', { type: 'button', class: 'btn ghost', style: 'color:var(--c-danger)', onclick: () => voidEntry(p, o) }, 'Void'),
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
  if (secondBack && activeBack) {
    lines.push('The second stage and active labour revert to the latent phase. Their timers restart from the next exams '
      + `at ${proto.activeStartCm} cm or more and at full dilatation (10 cm).`);
  } else if (secondBack) {
    lines.push('The second stage reverts to the active first stage. Its timer restarts from the next exam at full dilatation (10 cm).');
  } else if (activeBack) {
    lines.push(`Active labour reverts to the latent phase. The active-stage timer restarts from the next exam at ${proto.activeStartCm} cm or more.`);
  }
  if (tr.includes('active_moved')) {
    lines.push(`The active first stage will start at ${fmtDT(pv.after.activeStartTime)} instead of ${fmtDT(pv.before.activeStartTime)}.`);
  }
  if (tr.includes('second_moved')) {
    lines.push(`The second stage will start at ${fmtDT(pv.after.secondStageStart)} instead of ${fmtDT(pv.before.secondStageStart)}.`);
  }
  if (tr.includes('active')) lines.push(`Active labour will start at ${fmtDT(pv.after.activeStartTime)}.`);
  if (tr.includes('second')) lines.push(`The second stage will start at ${fmtDT(pv.after.secondStageStart)}.`);
  const clock = pushingClockLine(p, o, proto, secondBack);
  if (clock) lines.push(clock);
  for (const title of pv.resolved || []) lines.push('Alert will close: ' + title);
  for (const title of pv.reopened || []) lines.push('Alert will re-open: ' + title);
  if (!lines.length) lines.push('No change to the labour stage or to any alert.');
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
    return `The second-stage limit will count from pushing at ${fmtTime(after)} instead of `
      + (before ? fmtTime(before) + '.' : 'from full dilatation.');
  }
  return `The second-stage limit will count from full dilatation (${fmtTime(copy.secondStageStart)}) until pushing is recorded again.`;
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
    title: `Void entry: ${t(o.type)} at ${when(o.time)}`,
    message: `${obsSummary(o)}. The entry stays on the record, struck through, with your initials and the reason. What changes:`,
    lines: consequenceLines(p, o, pv),
    needReason: true, danger: true, by: getBy(), okLabel: 'Void entry',
  });
  if (!r) return;
  const done = await commit(p, () => voidObservation(p, o.id, S.settings, { by: r.by, reason: r.reason }));
  if (!done) return;
  setBy(r.by);
  toast('Entry voided - kept on the record, struck through');
  const reopened = done.result.reopened || [];
  if (reopened.length) toast(`${plural(reopened.length, 'alert')} re-opened - see Alerts`, 'danger');
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
    title: `Correct entry: ${t(o.type)} at ${when(o.time)}`,
    message: `${obsSummary(o)}. This entry is voided (kept on the record, struck through) and your corrected values `
      + 'are recorded for the same time. Taking the old values out:',
    lines: [...consequenceLines(p, o, pv), 'The corrected values are then checked again, so a stage or an alert can return.'],
    needReason: true, by: getBy(), okLabel: 'Enter corrected values',
  });
  if (!r) return;
  setBy(r.by);
  openRecordWizard(p, [o.type], null, { prefill: { ...o.v }, time: o.time, replaces: o.id, reason: r.reason, by: r.by });
}

// -------------------------------------------------------------- alerts ----

const HOW = {
  evidence: 'a later reading was normal',
  cleared: 'the time condition cleared',
  void: 'the entry behind it was voided',
  birth: 'closed at birth',
  manual: 'resolved by hand',
  handover: 'closed at departure',
};
const ACTION = {
  monitoring: 'continue close monitoring', senior: 'senior or colleague called',
  intervention: 'intervention given', referral: 'referral started',
};

function alertsTab(p) {
  // open and unacknowledged first, then closed unacknowledged, open, closed
  const rank = a => (a.ack ? 2 : 0) + (a.resolved ? 1 : 0);
  const list = (p.alerts || []).slice().sort((a, b) => rank(a) - rank(b) || String(b.time).localeCompare(String(a.time)));
  const wrap = h('div');
  if (!list.length) wrap.append(h('div', { class: 'empty-state' }, h('div', { class: 'ico' }, '✅'), h('p', null, 'No alerts so far.')));
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

function alertItem(p, a) {
  const raiser = raisedBy(p, a);
  const meta = [fmtDT(a.time), a.episode > 1 ? `episode ${a.episode}` : null, a.count > 1 ? `seen ${a.count} times` : null,
    raiser ? `raised by ${raiser}` : null].filter(Boolean).join(' - ');
  const closer = a.resolved ? closedBy(p, a) : null;
  const status = a.resolved
    ? `Closed ${when(a.resolvedAt)}: ${HOW[a.resolvedHow] || a.resolvedHow || 'closed'}`
      + (closer ? ` by ${closer}` : '') + (a.resolveReason ? ` - ${a.resolveReason}` : '')
    : 'Open' + (a.escalatedAt ? ` - severity raised ${when(a.escalatedAt)}` : '');
  const ack = a.ack
    ? `Acknowledged ${when(a.actionTime)}` + (a.ackBy ? ` by ${a.ackBy}` : '') + (a.action ? ` - ${ACTION[a.action] || a.action}` : '')
    : 'Not yet acknowledged';
  const buttons = [
    a.ack ? null : h('button', {
      class: 'btn secondary', onclick: () => { if (a.ack) toast('Already acknowledged'); else showAlertAckModal(p, [a]); },
    }, 'Acknowledge'),
    a.resolved ? null : h('button', { class: 'btn ghost', onclick: () => resolveFlow(p, a) }, 'Resolve'),
  ].filter(Boolean);
  const details = h('div', { style: 'margin-top:6px' },
    h('p', { class: 'muted', style: 'margin:0' }, status),
    h('p', { class: 'muted', style: 'margin:0' }, ack),
    buttons.length ? h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px' }, buttons) : null,
  );
  return h('div', { style: 'margin-bottom:4px' + (a.resolved ? ';opacity:.8' : '') },
    h('p', { class: 'muted', style: 'margin:0 0 2px;font-size:.8rem' }, meta),
    alertBanner(a, details));
}

async function resolveFlow(p, a) {
  const r = await promptDialog({
    title: 'Resolve alert',
    message: `${a.title}. Resolve by hand only when the finding no longer applies; a new finding later opens a new alert.`
      + (a.source === 'time' ? ' A time alert opens again at the next check while its condition still holds.' : ''),
    needReason: true, by: getBy(), okLabel: 'Resolve',
  });
  if (!r) return;
  const done = await commit(p, () => {
    const res = resolveAlert(p, a.id, { by: r.by, reason: r.reason });
    if (!res) throw new Error('this alert is already closed');
    return res;
  });
  if (!done) return;
  setBy(r.by);
  toast('Alert resolved' + (done.result.ack ? '' : ' - it still needs acknowledging'));
}

// ---------------------------------------------------------- emergencies ---

export function openEmergencyModal(p) {
  const body = h('div');
  const close = openModal(body, { locked: false });

  function menu() {
    clear(body);
    body.append(
      h('h2', null, '🚨 ' + t('emergency')),
      h('p', { class: 'muted' }, 'Tap the emergency — immediate actions will be shown and recorded.'),
      ...EMERGENCIES.map(e => h('button', { class: 'btn big danger', style: 'margin-bottom:8px', onclick: () => detail(e) }, e.label)),
      h('button', { class: 'btn ghost big', onclick: () => close() }, t('cancel')),
    );
  }

  function detail(e) {
    let by = '';
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
              err.textContent = 'Your initials are required.';
              return;
            }
            const at = new Date().toISOString();
            const done = await commit(p, () => {
              const added = addAlerts(p, [{ code: 'emg_' + e.code, severity: 'danger', title: 'EMERGENCY: ' + e.label, advice: e.advice }],
                'manual', { time: at, raisedAt: at });
              for (const a of added) if (!a.by) a.by = by;
              p.notes = [...(p.notes || []),
                { time: at, by, text: 'Emergency declared: ' + e.label, plan: 'emergency management + referral assessment' }];
            });
            if (!done) return;
            setBy(by);
            close();
            toast('Emergency recorded', 'danger');
            location.hash = `#/p/${p.id}/referral`;
          },
        }, 'Record & open referral'),
      ),
    );
  }
  menu();
}

// -------------------------------------------------------------- summary ----

const ONSET = { spontaneous: 'Spontaneous', induced: 'Induced', unknown: 'Not recorded' };

function summaryTab(p, now) {
  return h('div', null,
    admissionCard(p),
    auditCard(p, now),
    h('div', { class: 'card' },
      h('h2', null, 'Notes — shared decision-making'),
      (p.notes || []).slice().sort((a, b) => String(b.time).localeCompare(String(a.time))).map(n =>
        h('div', { style: 'border-bottom:1px solid var(--c-line);padding:8px 0' },
          h('p', { class: 'muted', style: 'margin:0;font-size:.8rem' }, fmtDT(n.time) + (n.by ? ` - by ${n.by}` : '')),
          n.text ? h('p', { style: 'margin:2px 0' }, n.text) : null,
          n.plan ? h('p', { class: 'muted', style: 'margin:0' }, 'Plan: ' + n.plan) : null,
        )),
      noteForm(p),
    ),
    caseActions(p),
  );
}

function admissionCard(p) {
  const a = p.admission || {};
  const onset = [ONSET[p.onsetMode] || p.onsetMode || ONSET.unknown,
    p.laborOnsetTime ? 'began ' + fmtDT(p.laborOnsetTime) : null].filter(Boolean).join(' - ');
  const rom = p.romUnknown ? 'Ruptured - ROM time unknown'
    : p.romTime ? 'Ruptured ' + fmtDT(p.romTime) : 'Intact (no rupture recorded)';
  const wanted = p.companionWanted === true ? 'Yes' : p.companionWanted === false ? 'No' : 'Not recorded';
  const pushing = secondStagePushing(p);
  return h('div', { class: 'card' },
    h('h2', null, 'Admission'),
    kv('Admitted', fmtDT(a.time)),
    kv('Labour onset', onset),
    kv('Membranes / ROM', rom),
    kv('Admission exam', `${a.dilatation ?? '—'} cm · descent ${a.descent ?? '—'}/5 · FHR ${a.fhr ?? '—'} · ${a.presentation || ''}`),
    kv('Active first stage from', p.activeStartTime ? fmtDT(p.activeStartTime) : 'Not reached'),
    p.secondStageStart ? kv('Second stage from', fmtDT(p.secondStageStart)) : null,
    pushing ? kv('Pushing began', fmtDT(pushing)) : null,
    kv('Companion of choice wanted', wanted),
    kv('Risk factors', (p.riskFactors || []).join(', ') || 'None recorded'),
    kv('Contact', [p.phone, p.kebele].filter(Boolean).join(' · ') || '—'),
    kv('Protocol', getProtocol(S.settings, p).name),
  );
}

const pct = r => (r == null ? '-' : `${Math.round(r * 100)}%`);
const rateText = x => (!x || x.rate == null ? 'nothing due yet' : `${pct(x.rate)} (${x.met}/${x.windows})`);
const auditRow = (name, value) => h('div', { class: 'audit-row' }, h('span', null, name), h('b', null, value));

/** Per-case completeness from the WHO LCG audit tool (N2, IRP Annex 8), computed by audit.js. */
function auditCard(p, now) {
  const a = auditCase(p, getProtocol(S.settings, p), now);
  const card = h('div', { class: 'card audit-card' },
    h('h2', null, a.tool === 'lcg' ? 'LCG completeness' : 'Partograph completeness'));
  if (!a.applicable) {
    card.append(h('p', { class: 'muted', style: 'margin:0' }, 'Not applicable - the active first stage has not started.'));
    if (a.voided) card.append(auditRow('Voided entries', String(a.voided)));
    return card;
  }
  const s = a.sections;
  // native append() would print "null": optional rows are filtered out first
  card.append(...[
    auditRow('Score', a.score == null ? 'not scored yet' : `${a.score} / 100`),
    auditRow('Header: name, parity, labour onset', pct(a.header.score)),
    auditRow('Supportive care', rateText(s.supportive)),
    auditRow('Baby', rateText(s.baby)),
    auditRow('Woman', rateText(s.woman)),
    auditRow('Labour progress', rateText(s.progress)),
    auditRow('Medication (oxytocin)', s.medication ? rateText(s.medication) : 'not applicable'),
    auditRow('Assessment and plan, hourly', rateText(s.decisions)),
    auditRow('Initials, hourly', rateText(s.initials)),
    auditRow(`Alerts acknowledged within ${LIMITS.audit.ackWithinMin} min`,
      a.alerts.raised ? `${pct(a.alerts.rate)} (${a.alerts.ackedInTime}/${a.alerts.raised})` : 'no alerts'),
    auditRow('Values kept at the default', `${a.defaulted.values} in ${a.defaulted.entries} ${a.defaulted.entries === 1 ? 'entry' : 'entries'}`),
    auditRow('Voided entries', String(a.voided)),
    a.durations.activeMin != null ? auditRow('Active first stage', fmtMin(a.durations.activeMin)) : null,
    a.durations.secondMin != null ? auditRow('Second stage', fmtMin(a.durations.secondMin)) : null,
  ].filter(Boolean));
  if (a.tool === 'lcg') {
    card.append(h('p', { class: 'muted', style: 'margin:8px 0 0' }, a.completed
      ? 'Meets the "LCG completed" indicator definition.'
      : 'Does not meet the "LCG completed" indicator definition yet.'));
  }
  return card;
}

/** Add-note form: a form in progress (data-form="note"), initials required (F3). */
function noteForm(p) {
  let by = '';
  const noteText = h('textarea', { placeholder: 'Assessment / findings…' });
  const notePlan = h('textarea', { placeholder: 'Plan (shared with the woman)…' });
  const err = h('p', { class: 'muted', style: 'color:var(--c-danger);min-height:1.2em' }, '');
  const form = h('div', { 'data-form': 'note' },
    h('h3', null, 'Add note'),
    noteText, notePlan,
    byField(getBy(), v => { by = v; }),
    err,
    h('button', {
      class: 'btn', style: 'margin-top:8px', onclick: async () => {
        const text = noteText.value.trim(), plan = notePlan.value.trim();
        if (!text && !plan) {
          err.textContent = 'Write the assessment or the plan.';
          return;
        }
        if (!by) {
          err.textContent = 'Your initials are required.';
          return;
        }
        form.dataset.saved = '1'; // before the save: the re-render it triggers may replace this form
        const done = await commit(p, () => {
          p.notes = [...(p.notes || []), { time: new Date().toISOString(), by, text, plan }];
        });
        if (!done) {
          delete form.dataset.saved; // not saved: the typed note stays protected
          return;
        }
        setBy(by);
        toast('Note saved ✓');
      },
    }, t('save')),
  );
  return form;
}

function caseActions(p) {
  const demo = isDemo(p);
  return h('div', { class: 'card no-print' },
    h('h2', null, 'Case actions'),
    h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
      h('button', { class: 'btn secondary', onclick: () => downloadFHIR(p, S.settings) }, '⇩ Export FHIR R4 (JSON)'),
      h('button', { class: 'btn secondary', onclick: () => window.print() }, '🖨 Print summary'),
      !isLabouring(p) && p.status !== 'closed' ? h('button', {
        class: 'btn secondary', onclick: async () => {
          const watching = inPostpartumWatch(p, new Date());
          const msg = 'Close this case? It moves out of the active list but stays in records/reports.'
            + (watching ? ' She is still in the postpartum watch: closing stops its checks and reminders.' : '');
          if (await confirmDialog(msg) && await commit(p, () => { p.status = 'closed'; })) location.hash = '#/';
        },
      }, 'Close case') : null,
      // S5: only a DEMO case can be deleted; a real case is closed, never deleted
      demo ? h('button', {
        class: 'btn ghost', style: 'color:var(--c-danger)', onclick: async () => {
          if (await confirmDialog('Delete this DEMO case permanently? This cannot be undone.', { okLabel: 'Delete', danger: true })) {
            try {
              await removePatient(p.id);
            } catch (err) {
              toast('Not deleted: ' + errText(err), 'danger');
              return;
            }
            location.hash = '#/';
          }
        },
      }, 'Delete case') : null,
    ),
    demo ? null : h('p', { class: 'muted', style: 'margin:8px 0 0' },
      'Real cases are closed, never deleted: the record is kept for audit and reports.'),
  );
}
