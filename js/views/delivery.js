// views/delivery.js — birth record, APGAR scoring, immediate newborn care
// (ENC), third stage / AMTSL, postpartum haemorrhage and the postpartum watch.
//
// M3: the birth record carries the initials of whoever records it and can be
// corrected - it moves to the case history, nothing is deleted (S5).
// Caesarean section is offered at hospital level and a stillbirth records
// when the baby died (N1). The PPH card measures blood loss against the WHO
// 2025 two-level trigger and keeps the first-response bundle (N3); the
// postpartum watch shows its checks as due chips, like labour (N4).
// Thresholds and schedules come from protocol.js and alerts.js.
//
// M4: a birth recorded again after a correction may not be later than a
// postpartum check still in the entries - the engine counts those checks only
// from the birth time on, so they would be lost and re-fire as overdue.
//
// M5: every label goes through t() ('fm.' keys in js/i18n/forms.js); the
// stored values stay codes. English on purpose, until the clinical panel
// validates a translation: the AMTSL steps and the PPH bundle (drug doses,
// from alerts.js) and the PPH trigger banner, which is an alert.

import {
  h, segmented, field, toast, byField, promptDialog, confirmDialog, alertBanner,
  isoToLocalInput, localInputToISO, fmtDT, fmtTime,
} from '../ui.js';
import { t } from '../i18n.js';
import { S, savePatient, getBy, setBy } from '../store.js';
import {
  LIMITS, POSTPARTUM, getProtocol, dueList, inPostpartumWatch, birthTime, stageOf, hoursBetween,
  activeObs, byTime, fmtMin, toMs,
} from '../protocol.js';
import { AMTSL_STEPS, FLAG, PPH_BUNDLE, pphTrigger, bloodLossTotal, haemodynamicSigns } from '../alerts.js';
import { applyBirth, applyObservations, voidDelivery } from '../record.js';
import { showAlertAckModal, openRecordWizard, wizardTypeFor } from '../wizard.js';

// [state key, item label key, labels of the scores 0, 1 and 2]
const APGAR_ITEMS = [
  ['appearance', 'fm.apgar.appearance', ['fm.apgar.appearance0', 'fm.apgar.appearance1', 'fm.apgar.appearance2']],
  ['pulse', 'fm.apgar.pulse', ['fm.apgar.pulse0', 'fm.apgar.pulse1', 'fm.apgar.pulse2']],
  ['grimace', 'fm.apgar.grimace', ['fm.apgar.grimace0', 'fm.apgar.grimace1', 'fm.apgar.grimace2']],
  ['activity', 'fm.apgar.activity', ['fm.apgar.activity0', 'fm.apgar.activity1', 'fm.apgar.activity2']],
  ['respiration', 'fm.apgar.respiration', ['fm.apgar.respiration0', 'fm.apgar.respiration1', 'fm.apgar.respiration2']],
];

const MODE_KEY = {
  svd: 'fm.mode.svd', assisted: 'fm.mode.assisted', breech: 'fm.mode.breech',
  cs: 'fm.mode.cs', other: 'fm.other',
};
const OUTCOME_KEY = { live: 'fm.outcome.live', sb_fresh: 'fm.outcome.sb_fresh', sb_macerated: 'fm.outcome.sb_macerated' };

// When a stillborn baby died (IRP Table 3 disaggregation). The appearance
// gives the default answer: fresh = during labour, macerated = before labour.
const SB_TIMING = [
  { value: 'antepartum', key: 'fm.sb.antepartum' },
  { value: 'intrapartum', key: 'fm.sb.intrapartum' },
  { value: 'unknown', key: 'fm.sb.unknown' },
];
const SB_DEFAULT = { sb_fresh: 'intrapartum', sb_macerated: 'antepartum' };

const PERINEUM_OPTIONS = [
  { value: 'intact', key: 'fm.perineum.intact' }, { value: 'tear12', key: 'fm.perineum.tear12' },
  { value: 'tear34', key: 'fm.perineum.tear34', alert: true }, { value: 'episiotomy', key: 'fm.perineum.episiotomy' },
];

const LOSS_METHODS = [
  { value: 'drape', key: 'fm.loss.drape' },
  { value: 'weighed', key: 'fm.loss.weighed' },
  { value: 'estimate', key: 'fm.loss.estimate' },
];

// Facts the birth record holds only once answered: nothing is pre-selected,
// so an untouched form can never record a complete placenta or an intact
// perineum nobody checked.
const BIRTH_ANSWERS = [
  ['mode', 'fm.birth.ans.mode'],
  ['resus', 'fm.birth.ans.resus'],
  ['placentaComplete', 'fm.birth.ans.placenta'],
  ['perineum', 'fm.birth.ans.perineum'],
];

// Postpartum entries a corrected birth record leaves in the entries. dueList,
// postpartumBPCount and urinePassedSinceBirth count them only at or after the
// birth time, so a birth recorded again may not be later than any of them.
const PP_ENTRY_TYPES = ['ppMother', 'ppBaby', 'bloodloss'];

// Due chips age with the clock, and the app's tick redraws only the header.
const WATCH_REFRESH_MS = 30000;

// Choice lists hold i18n keys; labelled() turns them into segmented() options
// when the form is drawn, so the labels follow the current language.
const labelled = opts => opts.map(({ key, ...o }) => ({ ...o, label: t(key) }));

/** The label of a stored code, or the code itself when it has none. */
const labelOf = (keys, code) => (keys[code] ? t(keys[code]) : code);

function apgarBlock(title, state, onChange = () => {}) {
  const totalEl = h('div', { class: 'apgar-score' }, '—');
  const update = () => {
    const vals = APGAR_ITEMS.map(([k]) => state[k]);
    if (vals.some(v => v == null)) { totalEl.textContent = '—'; totalEl.className = 'apgar-score'; return; }
    const total = vals.reduce((a, b) => a + b, 0);
    state.total = total;
    totalEl.textContent = total + ' / 10';
    totalEl.className = 'apgar-score ' + (total >= LIMITS.apgarLow ? 'ok' : total >= LIMITS.apgarSevere ? 'warn' : 'bad');
  };
  return h('div', { class: 'card' },
    h('h2', null, title),
    APGAR_ITEMS.map(([key, label, opts]) => h('div', { style: 'margin-bottom:10px' },
      h('p', { style: 'margin:0 0 4px;font-weight:600;font-size:.9rem' }, t(label)),
      segmented(opts.map((o, i) => ({ value: i, label: `${i} · ${t(o)}`, alert: i === 0 })), state[key], v => { state[key] = v; update(); onChange(); }),
    )),
    totalEl,
  );
}

const ENC_CHECKLIST = [
  ['dried', 'fm.enc.dried'],
  ['skin', 'fm.enc.skin'],
  ['cord_delay', 'fm.enc.cord_delay'],
  ['breastfeed', 'fm.enc.breastfeed'],
  ['vitk', 'fm.enc.vitk'],
  ['eye', 'fm.enc.eye'],
  ['chx', 'fm.enc.chx'],
  ['weighed', 'fm.enc.weighed'],
];

export function renderDeliveryTab(p) {
  return p.delivery ? deliverySummary(p) : birthForm(p);
}

/**
 * Every save marks the forms on the tab saved, so the app redraws the page
 * from the case. If the view was kept anyway, redraw the tab in place.
 */
function redraw(root, p) {
  if (root.isConnected) root.replaceWith(renderDeliveryTab(p));
}

const errText = e => (e && e.message) || String(e);

/**
 * Apply a record-layer change to the live case and save it. If either step
 * fails the case is put back as it was, so the screen never shows a change
 * that was not stored and a retry starts clean.
 */
async function commit(p, change) {
  const before = structuredClone(p);
  try {
    const out = change();
    await savePatient(p);
    return out;
  } catch (e) {
    for (const k of Object.keys(p)) delete p[k];
    Object.assign(p, before);
    throw e;
  }
}

// ---------------------------------------------------------- birth form -----

function birthForm(p) {
  // mode, resus, placentaComplete and perineum stay unset until answered (BIRTH_ANSWERS)
  const m = {
    time: isoToLocalInput(), mode: null, outcome: 'live', sbTiming: null, sbChosen: false,
    sex: null, weightG: null, resus: null, resusDetail: '',
    apgar1: {}, apgar5: {}, enc: {}, amtsl: {}, placentaComplete: null,
    eblMl: null, perineum: null, ppSys: null, ppDia: null, ppPulse: null,
  };
  let by = '';
  let saving = false;

  const numInput = key => h('input', { type: 'number', oninput: e => { m[key] = e.target.value === '' ? null : +e.target.value; } });
  const checklist = (items, target) => h('div', { class: 'checklist' }, items.map(([code, label]) =>
    h('label', null, h('input', { type: 'checkbox', onchange: e => { target[code] = e.target.checked; } }), label)));

  // a stillbirth asks when the baby died; an explicit answer outlives outcome changes
  const timingWrap = h('div');
  const paintTiming = () => timingWrap.replaceChildren(...(m.outcome === 'live' ? [] : [
    choiceField(t('fm.birth.sbWhen'), segmented(labelled(SB_TIMING), m.sbTiming, v => { m.sbTiming = v; m.sbChosen = true; })),
  ]));
  const setOutcome = v => {
    m.outcome = v;
    if (v !== 'live' && !m.sbChosen) m.sbTiming = SB_DEFAULT[v] || 'unknown';
    paintTiming();
  };

  const modes = [
    { value: 'svd', key: 'fm.mode.svdShort' }, { value: 'assisted', key: 'fm.mode.assisted' },
    { value: 'breech', key: 'fm.mode.breech' },
    ...(S.settings.facilityLevel === 'hospital' ? [{ value: 'cs', key: 'fm.mode.cs' }] : []),
    { value: 'other', key: 'fm.other' },
  ];

  const root = h('div', { 'data-form': 'birth' },
    correctedNote(p),
    h('div', { class: 'card' },
      h('h2', null, '👶 ' + t('fm.birth.title')),
      h('div', { class: 'grid2' },
        field(t('fm.birth.time'),
          h('input', { type: 'datetime-local', value: m.time, oninput: e => { m.time = e.target.value; } })),
        field(t('fm.birth.mode') + ' *', segmented(labelled(modes), m.mode, v => { m.mode = v; })),
      ),
      field(t('fm.birth.outcome'), segmented(labelled([
        { value: 'live', key: OUTCOME_KEY.live },
        { value: 'sb_fresh', key: OUTCOME_KEY.sb_fresh, alert: true },
        { value: 'sb_macerated', key: OUTCOME_KEY.sb_macerated, alert: true },
      ]), m.outcome, setOutcome)),
      timingWrap,
      h('div', { class: 'grid2' },
        field(t('fm.birth.sex'), segmented(labelled([{ value: 'M', key: 'fm.birth.boy' }, { value: 'F', key: 'fm.birth.girl' }]), m.sex, v => { m.sex = v; })),
        field(t('fm.birth.weight'), numInput('weightG')),
      ),
      field(t('fm.birth.resus') + ' *', segmented([{ value: 'N', label: t('no') }, { value: 'Y', label: t('yes'), alert: true }], m.resus, v => { m.resus = v; })),
      h('label', { class: 'field' }, h('span', null, t('fm.birth.resusActions')),
        h('input', { type: 'text', placeholder: t('fm.birth.resusPlaceholder'), oninput: e => { m.resusDetail = e.target.value; } })),
    ),
    apgarBlock(t('apgar') + ' — ' + t('fm.apgar.min1'), m.apgar1),
    apgarBlock(t('apgar') + ' — ' + t('fm.apgar.min5'), m.apgar5),
    h('div', { class: 'card' },
      h('h2', null, t('fm.birth.enc')),
      checklist(ENC_CHECKLIST.map(([code, key]) => [code, t(key)]), m.enc),
    ),
    h('div', { class: 'card' },
      h('h2', null, t('fm.birth.amtsl')),
      checklist(AMTSL_STEPS, m.amtsl),
      h('div', { class: 'grid2', style: 'margin-top:10px' },
        field(t('fm.birth.placenta') + ' *', segmented([{ value: 'Y', label: t('yes') }, { value: 'N', label: t('no'), alert: true }], m.placentaComplete, v => { m.placentaComplete = v; })),
        field(t('fm.birth.ebl'), numInput('eblMl')),
        field(t('fm.birth.perineum') + ' *', segmented(labelled(PERINEUM_OPTIONS), m.perineum, v => { m.perineum = v; })),
      ),
      h('h3', null, t('fm.birth.ppCheck')),
      h('div', { class: 'grid3' },
        field(t('fm.sys'), numInput('ppSys')),
        field(t('fm.dia'), numInput('ppDia')),
        field(t('fm.birth.pulse'), numInput('ppPulse')),
      ),
    ),
    byField(getBy(), v => { by = v; }),
    h('button', { class: 'btn big', onclick: save }, '✓ ' + t('fm.birth.save')),
  );

  async function save() {
    if (saving) return;
    const time = localInputToISO(m.time);
    const why = birthProblem(m, time, by, p);
    if (why) { toast(why, 'danger'); return; }
    saving = true; // stays set once saved: the tab is redrawn as the birth summary
    let result;
    try {
      const { delivery, newborn } = birthRecord(m, time);
      root.dataset.saved = '1';
      // the birth rules (APGAR, retained placenta, stillbirth, PPH trigger) live in the engine (S13)
      result = await commit(p, () => applyBirth(p, delivery, newborn, S.settings, { by }));
    } catch (e) {
      saving = false;
      delete root.dataset.saved;
      toast(errText(e), 'danger');
      return;
    }
    setBy(by);
    toast(t('fm.birth.saved'));
    if (result.added.length) showAlertAckModal(p, result.added);
    redraw(root, p);
  }

  return root;
}

/**
 * The first missing or impossible answer on the birth form, or null. The
 * unanswered facts are named together. Given the case p, a birth time later
 * than a postpartum check that survived a corrected birth record is refused
 * (PP_ENTRY_TYPES). No DOM: exported for the tests.
 */
export function birthProblem(m, time, by, p = null) {
  if (!time) return t('fm.birth.needTime');
  if (new Date(time) > new Date()) return t('fm.birth.timeFuture');
  const check = p ? firstPostpartumEntry(p) : null;
  if (check && toMs(time) > toMs(check.time)) {
    return t('fm.birth.afterCheck', { time: checkTime(check.time, time) });
  }
  const missing = BIRTH_ANSWERS.filter(([key]) => m[key] == null).map(([, label]) => t(label));
  if (missing.length) return t('fm.birth.stillToAnswer', { list: missing.join(t('fm.listSep')) });
  if (m.outcome === 'live' && (m.apgar1.total == null || m.apgar5.total == null)) return t('fm.birth.needApgar');
  if (!by) return t('fm.needInitials');
  return null;
}

/** The earliest postpartum entry that is not voided, or null. */
function firstPostpartumEntry(p) {
  let first = null;
  for (const o of activeObs(p)) {
    if (!PP_ENTRY_TYPES.includes(o.type) || !Number.isFinite(toMs(o.time))) continue;
    if (!first || toMs(o.time) < toMs(first.time)) first = o;
  }
  return first;
}

// Calendar day in Addis Ababa time (YYYY-MM-DD), as the time input shows it.
const eatDay = iso => isoToLocalInput(iso).slice(0, 10);

/** The check's time; with its date when that is not the day typed for the birth (labour runs past midnight). */
const checkTime = (at, birth) => (eatDay(at) === eatDay(birth) ? fmtTime(at) : fmtDT(at));

function birthRecord(m, time) {
  const delivery = {
    time, mode: m.mode, outcome: m.outcome,
    placentaComplete: m.placentaComplete, eblMl: m.eblMl, perineum: m.perineum,
    amtsl: m.amtsl, ppVitals: { sys: m.ppSys, dia: m.ppDia, pulse: m.ppPulse },
  };
  if (m.outcome !== 'live') delivery.stillbirthTiming = m.sbTiming || 'unknown';
  const newborn = {
    sex: m.sex, weightG: m.weightG, resus: m.resus === 'Y', resusDetail: m.resusDetail,
    apgar1: m.apgar1.total != null ? m.apgar1 : null,
    apgar5: m.apgar5.total != null ? m.apgar5 : null,
    apgar10: null, enc: m.enc,
  };
  return { delivery, newborn };
}

/** After a correction: why the form is empty again. */
function correctedNote(p) {
  const last = (p.deliveryHistory || []).slice(-1)[0];
  if (!last || !last.voided) return null;
  const v = last.voided;
  return h('div', { class: 'card' }, h('p', { class: 'muted', style: 'margin:0' },
    t('fm.birth.correctedNote', { at: fmtDT(v.at), by: v.by || '-', reason: v.reason })));
}

// ------------------------------------------------------------- summary -----

function deliverySummary(p) {
  const now = new Date();
  const n = p.newborn || {};
  const root = h('div');
  const add10 = n.apgar5 && n.apgar5.total < LIMITS.apgarLow && !n.apgar10;
  const pph = pphOpen(p, now) ? pphCard(p) : null;
  root.append(...[
    birthCard(p, root),
    add10 ? apgar10Form(p) : null,
    pph ? pph.card : null,
    inPostpartumWatch(p, now) ? watchCard(p, pph ? pph.paintStatus : null) : null,
  ].filter(Boolean));
  return root;
}

function birthCard(p, root) {
  const d = p.delivery, n = p.newborn || {};
  const apgarChip = a => a ? h('span', {
    class: 'chip ' + (a.total >= LIMITS.apgarLow ? 'ok' : a.total >= LIMITS.apgarSevere ? 'due' : 'overdue'),
  }, a.total + '/10') : '—';
  const earlier = (p.deliveryHistory || []).length;
  const sbTiming = SB_TIMING.find(x => x.value === d.stillbirthTiming);
  const perineum = PERINEUM_OPTIONS.find(x => x.value === d.perineum);

  return h('div', { class: 'card' },
    h('h2', null, '👶 ' + t('fm.birth.record')),
    kv(t('fm.birth.born'), fmtDT(d.time)),
    kv(t('fm.birth.modeLabel'), labelOf(MODE_KEY, d.mode)),
    kv(t('fm.birth.outcome'), labelOf(OUTCOME_KEY, d.outcome)),
    d.outcome && d.outcome !== 'live'
      ? kv(t('fm.birth.sbWhenLabel'), t(sbTiming ? sbTiming.key : 'fm.birth.notRecorded')) : null,
    n.sex ? kv(t('baby'), `${n.sex === 'M' ? t('fm.birth.boy') : t('fm.birth.girl')}${n.weightG ? ' · ' + n.weightG + ' g' : ''}`) : null,
    h('div', { class: 'kv' }, h('b', null, 'APGAR 1′ / 5′ / 10′'),
      h('span', { style: 'display:flex;gap:6px' }, apgarChip(n.apgar1), apgarChip(n.apgar5), apgarChip(n.apgar10))),
    n.resus ? kv(t('fm.birth.resusLabel'), n.resusDetail || t('yes')) : null,
    kv(t('fm.birth.placentaLabel'), d.placentaComplete === 'Y' ? t('fm.birth.complete') : '⚠ ' + t('fm.birth.incomplete')),
    d.eblMl != null ? kv(t('fm.birth.eblLabel'), d.eblMl + ' ml' + (FLAG.bloodLoss(d.eblMl) ? ' ⚠' : '')) : null,
    kv(t('fm.birth.perineum'), perineum ? t(perineum.key) : d.perineum),
    kv(t('fm.birth.recordedBy'), d.by || '-'),
    earlier ? h('p', { class: 'muted' }, t(earlier > 1 ? 'fm.birth.earlierN' : 'fm.birth.earlier1', { n: earlier })) : null,
    // a closed case stays closed: voiding would put her back into labour monitoring
    stageOf(p) !== 'closed' ? h('div', { class: 'no-print', style: 'margin-top:10px' },
      h('button', { class: 'btn ghost', onclick: () => correctBirth(p, root) }, t('fm.birth.correct'))) : null,
  );
}

/** S5: the wrong birth record moves to the case history; the birth form returns. */
async function correctBirth(p, root) {
  const res = await promptDialog({
    title: t('fm.birth.correct'),
    message: t('fm.birth.correctMsg'),
    lines: [t('fm.birth.correctLine1'), t('fm.birth.correctLine2'), t('fm.birth.correctLine3'), t('fm.birth.correctLine4')],
    needReason: true, by: getBy(), okLabel: t('fm.birth.moveToHistory'), danger: true,
  });
  if (!res) return;
  // the record behind every form on this tab goes: let the app redraw it
  const open = root.querySelectorAll('[data-form]:not([data-saved])');
  for (const f of open) f.dataset.saved = '1';
  try {
    await commit(p, () => voidDelivery(p, S.settings, { by: res.by, reason: res.reason }));
  } catch (e) {
    for (const f of open) delete f.dataset.saved;
    toast(errText(e), 'danger');
    return;
  }
  setBy(res.by);
  toast(t('fm.birth.moved'));
  redraw(root, p);
}

/** 10-minute APGAR after a low 5-minute score. Empty, it holds nothing to lose. */
function apgar10Form(p) {
  const state = {};
  let by = '';
  let saving = false;
  const form = h('div', { 'data-form': 'apgar10', 'data-saved': '1' });
  const card = apgarBlock(t('apgar') + ' — ' + t('fm.apgar.min10'), state, () => { delete form.dataset.saved; });
  card.append(
    byField(getBy(), v => { by = v; }),
    h('button', { class: 'btn big', onclick: save }, t('fm.apgar.save10')),
  );
  form.append(card);

  async function save() {
    if (saving) return;
    if (state.total == null) { toast(t('fm.apgar.needAll'), 'danger'); return; }
    if (!by) { toast(t('fm.needInitials'), 'danger'); return; }
    saving = true;
    try {
      form.dataset.saved = '1';
      await commit(p, () => { p.newborn = { ...(p.newborn || {}), apgar10: { ...state, by } }; });
    } catch (e) {
      delete form.dataset.saved;
      toast(errText(e), 'danger');
      return;
    } finally {
      saving = false;
    }
    setBy(by);
    toast(t('fm.apgar.saved10'));
    // the app keeps the page while another form on it is being filled
    if (form.isConnected) form.replaceWith(h('p', { class: 'muted' }, t('fm.apgar.savedNote', { total: state.total })));
  }
  return form;
}

// ----------------------------------------------------------------- PPH -----

/** The PPH card shows during the 24 h after birth (LIMITS.pph.windowHours). */
function pphOpen(p, now) {
  return inPostpartumWatch(p, now) && hoursBetween(birthTime(p), now) <= LIMITS.pph.windowHours;
}

function pphCard(p) {
  const status = h('div');
  const bundle = h('div', { class: 'checklist bundle' });
  const paintStatus = () => status.replaceChildren(pphStatus(p));
  const paintBundle = () => bundle.replaceChildren(...bundleRows(p, paintBundle));
  paintStatus();
  paintBundle();
  const card = h('div', { class: 'card pph-card' },
    h('h2', null, t('fm.pph.title')),
    status,
    pphForm(p, paintStatus),
    h('h3', null, t('fm.pph.bundleTitle')),
    h('p', { class: 'muted' }, t('fm.pph.bundleHelp')),
    bundle,
  );
  return { card, paintStatus };
}

/** Running measured total against the WHO 2025 trigger, plus the trigger banner when met. */
function pphStatus(p) {
  const L = LIMITS.pph;
  const trig = pphTrigger(p);
  const signs = haemodynamicSigns(p);
  let banner = null;
  if (trig) {
    // an alert: its title and advice stay English, like the engine's alerts (M5)
    banner = alertBanner({ severity: 'danger', title: triggerTitle(trig), advice: ['Call for help and start every first-response step below together.'] });
    banner.classList.add('pph-trigger');
    banner.setAttribute('role', 'alert');
  }
  return h('div', null,
    banner,
    h('div', { class: 'pph-total' }, `${bloodLossTotal(p)} mL`),
    h('p', { class: 'muted', style: 'margin:0 0 8px' }, t('fm.pph.totalHelp')),
    h('p', { style: 'margin:0' }, t('fm.pph.triggerIntro')),
    h('ul', { class: 'advice' },
      h('li', null, t('fm.pph.levelSigns', {
        ml: L.volumeWithSigns, pulse: L.signs.pulseAbove, sbp: L.signs.sbpBelow,
        dbp: L.signs.dbpBelow, si: L.signs.shockIndexAbove,
      })),
      h('li', null, t('fm.pph.levelVolume', { ml: L.volume })),
    ),
    // the signs themselves are the engine's English words (haemodynamicSigns)
    h('p', null, signs.length ? t('fm.pph.signsNow', { signs: signs.join(', ') }) : t('fm.pph.noSigns')),
    readingsList(p),
  );
}

function triggerTitle(tr) {
  const L = LIMITS.pph;
  if (tr.level === 'volume') {
    return `PPH trigger met: ${tr.totalMl} mL measured (${L.volume} mL level)${tr.signs.length ? ' with ' + tr.signs.join(', ') : ''}`;
  }
  return `PPH trigger met: ${tr.totalMl} mL with ${tr.signs.join(', ')} (${L.volumeWithSigns} mL + abnormal sign level)`;
}

/** How a reading was measured, in lower case; an unknown code is shown as it is. */
function lossMethod(code) {
  const method = LOSS_METHODS.find(x => x.value === code);
  return (method ? t(method.key) : code || t('fm.loss.none')).toLowerCase();
}

function readingsList(p) {
  const d = p.delivery;
  const rows = activeObs(p).filter(o => o.type === 'bloodloss' && o.v && o.v.ml != null).sort(byTime);
  if (!rows.length && d.eblMl == null) return null;
  return h('ul', { class: 'muted', style: 'margin:0 0 8px;padding-left:18px;font-size:.9rem' },
    d.eblMl != null ? h('li', null, t('fm.pph.atBirth', { time: fmtTime(d.time), ml: d.eblMl })) : null,
    rows.map(o => h('li', null,
      t('fm.pph.reading', { time: fmtTime(o.time), ml: o.v.ml, method: lossMethod(o.v.method) }) + (o.by ? ' - ' + o.by : ''))),
  );
}

/** A measured reading: the cumulative total, as a calibrated drape shows it. Empty, it holds nothing to lose. */
function pphForm(p, onSaved) {
  let ml = null, method = 'drape', by = '', saving = false;
  const form = h('div', { 'data-form': 'pph', 'data-saved': '1' });
  const mlInput = h('input', {
    type: 'number', inputmode: 'numeric', min: '1', step: '10', placeholder: t('fm.pph.placeholder'),
    oninput: e => {
      ml = e.target.value === '' ? null : Number(e.target.value);
      if (ml == null) form.dataset.saved = '1'; else delete form.dataset.saved;
    },
  });
  form.append(
    h('h3', null, t('fm.pph.addReading')),
    h('div', { class: 'grid2' },
      field(t('fm.pph.totalField') + ' *', mlInput),
      field(t('fm.pph.method'), segmented(labelled(LOSS_METHODS), method, v => { method = v; })),
    ),
    h('p', { class: 'muted', style: 'margin-top:0' }, t('fm.pph.readingHelp')),
    byField(getBy(), v => { by = v; }),
    h('button', { class: 'btn', onclick: save }, t('fm.pph.saveReading')),
  );

  async function save() {
    if (saving) return;
    if (!Number.isInteger(ml) || ml <= 0) { toast(t('fm.pph.needMl'), 'danger'); return; }
    if (!by) { toast(t('fm.needInitials'), 'danger'); return; }
    saving = true;
    let r;
    try {
      const recorded = bloodLossTotal(p);
      if (ml < recorded && !(await confirmDialog(
        t('fm.pph.lower', { ml, recorded, mlAgain: ml }),
        { okLabel: t('fm.pph.saveAnyway') }))) return;
      form.dataset.saved = '1';
      r = await commit(p, () => applyObservations(p, new Date().toISOString(), { bloodloss: { ml, method } }, S.settings, { by }));
    } catch (e) {
      delete form.dataset.saved;
      toast(t('fm.pph.saveFailed', { error: errText(e) }), 'danger');
      return;
    } finally {
      saving = false;
    }
    setBy(by);
    toast(t('fm.pph.recorded', { ml }));
    mlInput.value = '';
    ml = null;
    onSaved();
    if (r.added.length) showAlertAckModal(p, r.added);
  }
  return form;
}

/** PPH_BUNDLE as a checklist; a ticked step shows when it was done and by whom. */
function bundleRows(p, repaint) {
  const done = (p.pph && p.pph.bundle) || {};
  return PPH_BUNDLE.map(({ code, label }) => {
    const tick = done[code];
    return h('label', null,
      h('input', {
        type: 'checkbox', checked: !!tick, disabled: !!tick,
        onchange: e => { if (e.target.checked) tickStep(p, code, label, e.target, repaint); },
      }),
      h('span', { style: 'flex:1' }, label),
      tick ? h('span', { class: 'entry-by' }, `${fmtTime(tick.at)} ${tick.by || ''}`.trim()) : null,
    );
  });
}

async function tickStep(p, code, label, box, repaint) {
  let by = getBy();
  const asked = !by;
  if (asked) {
    const res = await promptDialog({ title: t('fm.pph.recordStep'), message: label, okLabel: t('fm.pph.done') });
    if (!res) { box.checked = false; return; }
    by = res.by;
  }
  try {
    await commit(p, () => {
      const pph = p.pph || {};
      p.pph = { ...pph, bundle: { ...(pph.bundle || {}), [code]: { at: new Date().toISOString(), by } } };
    });
    if (asked) setBy(by);
  } catch (e) {
    toast(t('fm.couldNotSave', { error: errText(e) }), 'danger');
  }
  repaint();
}

// ------------------------------------------------------ postpartum watch ---

function watchCard(p, onRecorded) {
  const chips = h('div', { class: 'chips', style: 'display:flex;flex-wrap:wrap;gap:6px' });
  const paint = () => chips.replaceChildren(...watchChips(p, () => { paint(); if (onRecorded) onRecorded(); }));
  paint();
  const timer = setInterval(() => { if (chips.isConnected) paint(); else clearInterval(timer); }, WATCH_REFRESH_MS);
  return h('div', { class: 'card pp-watch' },
    h('h2', null, t('postpartum_watch')),
    chips,
    h('p', { class: 'muted', style: 'margin-bottom:0' }, watchGuidance(p)),
  );
}

/** Every watch item as a chip (due, overdue or next); a tap opens its check. */
function watchChips(p, onDone) {
  const now = new Date();
  if (!inPostpartumWatch(p, now)) return [h('span', { class: 'chip ok' }, t('fm.watch.complete'))];
  const live = p.delivery.outcome === 'live';
  return dueList(p, getProtocol(S.settings, p), now)
    .filter(d => live || d.type !== 'ppBaby') // no baby checks after a stillbirth
    .map(d => h('button', {
      type: 'button', class: 'chip pp' + (d.state === 'ok' ? '' : ' ' + d.state), style: 'border:none;cursor:pointer',
      onclick: () => openRecordWizard(p, [wizardTypeFor(d.type)], onDone, { title: t('fm.watch.recordCheck') }),
    }, chipLabel(d)));
}

function chipLabel(d) {
  const item = t(d.type);
  if (d.state === 'overdue') return t('fm.watch.chipOverdue', { item, min: d.overdueMin, overdue: t('overdue') });
  if (d.state === 'due') return `${item} - ${t('due')}`;
  return t('fm.watch.chipNext', { item, time: fmtTime(d.dueAt) });
}

/** "Keep watching" advice, worded from the POSTPARTUM schedule so it never drifts from the chips. */
function watchGuidance(p) {
  const P = POSTPARTUM;
  const live = p.delivery.outcome === 'live';
  const cadence = P.phases.map((ph, i) => {
    const gap = !live || ph.mother === ph.baby
      ? t('fm.watch.every', { gap: fmtMin(ph.mother) })
      : t('fm.watch.everySplit', { mother: fmtMin(ph.mother), baby: fmtMin(ph.baby) });
    return t(i === 0 ? 'fm.watch.phaseFirst' : 'fm.watch.phaseNext', { gap, until: fmtMin(ph.untilMin) });
  }).join(t('fm.watch.then'));
  return [
    t('fm.watch.why'),
    t(live ? 'fm.watch.checkBoth' : 'fm.watch.checkMother', { cadence }),
    t('fm.watch.motherItems'),
    live ? t('fm.watch.babyItems') : null,
    t('fm.watch.bpUrine', { first: fmtMin(P.bpFirstMin), second: fmtMin(P.bpSecondByMin), urine: fmtMin(P.voidByMin) }),
  ].filter(Boolean).join(' ');
}

// -------------------------------------------------------------- helpers ----

/**
 * A labelled question. A <label> forwards a tap on its text to its first
 * button, which would silently pick the first answer.
 */
function choiceField(labelText, control) {
  return h('label', {
    class: 'field',
    onclick: e => { if (!e.target.closest('button, input, select, textarea')) e.preventDefault(); },
  }, h('span', null, labelText), control);
}

function kv(k, v) { return h('div', { class: 'kv' }, h('b', null, k), h('span', null, v)); }
