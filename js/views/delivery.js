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

import {
  h, segmented, field, toast, byField, promptDialog, confirmDialog, alertBanner,
  isoToLocalInput, localInputToISO, fmtDT, fmtTime,
} from '../ui.js';
import { t } from '../i18n.js';
import { S, savePatient, getBy, setBy } from '../store.js';
import {
  LIMITS, POSTPARTUM, getProtocol, dueList, inPostpartumWatch, birthTime, stageOf, hoursBetween,
  activeObs, byTime, fmtMin,
} from '../protocol.js';
import { AMTSL_STEPS, FLAG, PPH_BUNDLE, pphTrigger, bloodLossTotal, haemodynamicSigns } from '../alerts.js';
import { applyBirth, applyObservations, voidDelivery } from '../record.js';
import { showAlertAckModal, openRecordWizard, wizardTypeFor } from '../wizard.js';

const APGAR_ITEMS = [
  ['appearance', 'Appearance (colour)', ['Blue / pale', 'Body pink, limbs blue', 'Completely pink']],
  ['pulse', 'Pulse (heart rate)', ['Absent', '< 100 bpm', '≥ 100 bpm']],
  ['grimace', 'Grimace (reflex)', ['No response', 'Grimace only', 'Cry / cough / sneeze']],
  ['activity', 'Activity (tone)', ['Limp', 'Some flexion', 'Active movement']],
  ['respiration', 'Respiration', ['Absent', 'Weak / irregular', 'Strong cry']],
];

const MODE_LABEL = {
  svd: 'Spontaneous vaginal', assisted: 'Assisted (vacuum)', breech: 'Vaginal breech',
  cs: 'Caesarean section', other: 'Other',
};
const OUTCOME_LABEL = { live: 'Live birth', sb_fresh: 'Stillbirth (fresh)', sb_macerated: 'Stillbirth (macerated)' };

// When a stillborn baby died (IRP Table 3 disaggregation). The appearance
// gives the default answer: fresh = during labour, macerated = before labour.
const SB_TIMING = [
  { value: 'antepartum', label: 'Before labour (antepartum)' },
  { value: 'intrapartum', label: 'During labour (intrapartum)' },
  { value: 'unknown', label: 'Unknown' },
];
const SB_DEFAULT = { sb_fresh: 'intrapartum', sb_macerated: 'antepartum' };

const LOSS_METHODS = [
  { value: 'drape', label: 'Calibrated drape' },
  { value: 'weighed', label: 'Weighed pads / linen' },
  { value: 'estimate', label: 'Visual estimate' },
];

// Facts the birth record holds only once answered: nothing is pre-selected,
// so an untouched form can never record a complete placenta or an intact
// perineum nobody checked.
const BIRTH_ANSWERS = [
  ['mode', 'mode of birth'],
  ['resus', 'resuscitation'],
  ['placentaComplete', 'placenta complete'],
  ['perineum', 'perineum'],
];

// Due chips age with the clock, and the app's tick redraws only the header.
const WATCH_REFRESH_MS = 30000;

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
      h('p', { style: 'margin:0 0 4px;font-weight:600;font-size:.9rem' }, label),
      segmented(opts.map((o, i) => ({ value: i, label: `${i} · ${o}`, alert: i === 0 })), state[key], v => { state[key] = v; update(); onChange(); }),
    )),
    totalEl,
  );
}

const ENC_CHECKLIST = [
  ['dried', 'Dried and stimulated immediately'],
  ['skin', 'Skin-to-skin contact with mother'],
  ['cord_delay', 'Delayed cord clamping (1–3 min)'],
  ['breastfeed', 'Breastfeeding initiated within 1 h'],
  ['vitk', 'Vitamin K given'],
  ['eye', 'TTC eye ointment applied'],
  ['chx', 'Chlorhexidine cord care'],
  ['weighed', 'Weighed and examined'],
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
    choiceField('When did the baby die?', segmented(SB_TIMING, m.sbTiming, v => { m.sbTiming = v; m.sbChosen = true; })),
  ]));
  const setOutcome = v => {
    m.outcome = v;
    if (v !== 'live' && !m.sbChosen) m.sbTiming = SB_DEFAULT[v] || 'unknown';
    paintTiming();
  };

  const modes = [
    { value: 'svd', label: 'Spontaneous' }, { value: 'assisted', label: 'Assisted (vacuum)' },
    { value: 'breech', label: 'Vaginal breech' },
    ...(S.settings.facilityLevel === 'hospital' ? [{ value: 'cs', label: 'Caesarean section' }] : []),
    { value: 'other', label: 'Other' },
  ];

  const root = h('div', { 'data-form': 'birth' },
    correctedNote(p),
    h('div', { class: 'card' },
      h('h2', null, '👶 Birth'),
      h('div', { class: 'grid2' },
        field('Time of birth', h('input', { type: 'datetime-local', value: m.time, oninput: e => { m.time = e.target.value; } })),
        field('Mode of birth *', segmented(modes, m.mode, v => { m.mode = v; })),
      ),
      field('Outcome', segmented([
        { value: 'live', label: 'Live birth' },
        { value: 'sb_fresh', label: 'Stillbirth (fresh)', alert: true },
        { value: 'sb_macerated', label: 'Stillbirth (macerated)', alert: true },
      ], m.outcome, setOutcome)),
      timingWrap,
      h('div', { class: 'grid2' },
        field('Sex', segmented([{ value: 'M', label: 'Boy' }, { value: 'F', label: 'Girl' }], m.sex, v => { m.sex = v; })),
        field('Birth weight (grams)', numInput('weightG')),
      ),
      field('Resuscitation needed? *', segmented([{ value: 'N', label: t('no') }, { value: 'Y', label: t('yes'), alert: true }], m.resus, v => { m.resus = v; })),
      h('label', { class: 'field' }, h('span', null, 'Resuscitation actions (if any)'),
        h('input', { type: 'text', placeholder: 'e.g. bag & mask ventilation 2 min', oninput: e => { m.resusDetail = e.target.value; } })),
    ),
    apgarBlock(t('apgar') + ' — 1 minute', m.apgar1),
    apgarBlock(t('apgar') + ' — 5 minutes', m.apgar5),
    h('div', { class: 'card' },
      h('h2', null, 'Essential newborn care'),
      checklist(ENC_CHECKLIST, m.enc),
    ),
    h('div', { class: 'card' },
      h('h2', null, 'Third stage — AMTSL'),
      checklist(AMTSL_STEPS, m.amtsl),
      h('div', { class: 'grid2', style: 'margin-top:10px' },
        field('Placenta complete? *', segmented([{ value: 'Y', label: t('yes') }, { value: 'N', label: t('no'), alert: true }], m.placentaComplete, v => { m.placentaComplete = v; })),
        field('Estimated blood loss (ml)', numInput('eblMl')),
        field('Perineum *', segmented([
          { value: 'intact', label: 'Intact' }, { value: 'tear12', label: '1st/2nd° tear' },
          { value: 'tear34', label: '3rd/4th° tear', alert: true }, { value: 'episiotomy', label: 'Episiotomy' },
        ], m.perineum, v => { m.perineum = v; })),
      ),
      h('h3', null, 'Mother — first postpartum check'),
      h('div', { class: 'grid3' },
        field('BP systolic', numInput('ppSys')),
        field('BP diastolic', numInput('ppDia')),
        field('Pulse', numInput('ppPulse')),
      ),
    ),
    byField(getBy(), v => { by = v; }),
    h('button', { class: 'btn big', onclick: save }, '✓ Save birth record'),
  );

  async function save() {
    if (saving) return;
    const time = localInputToISO(m.time);
    const why = birthProblem(m, time, by);
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
    toast('Birth record saved ✓');
    if (result.added.length) showAlertAckModal(p, result.added);
    redraw(root, p);
  }

  return root;
}

/**
 * The first missing or impossible answer on the birth form, or null. The
 * unanswered facts are named together. No DOM: exported for the tests.
 */
export function birthProblem(m, time, by) {
  if (!time) return 'Enter the time of birth';
  if (new Date(time) > new Date()) return 'The time of birth is in the future';
  const missing = BIRTH_ANSWERS.filter(([key]) => m[key] == null).map(([, label]) => label);
  if (missing.length) return 'Still to answer: ' + missing.join(', ');
  if (m.outcome === 'live' && (m.apgar1.total == null || m.apgar5.total == null)) return 'Record APGAR at 1 and 5 minutes';
  if (!by) return 'Your initials are required';
  return null;
}

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
    `The previous birth record was moved to the case history on ${fmtDT(v.at)} by ${v.by || '-'}: "${v.reason}". `
    + 'Record the birth again with the correct details.'));
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

  return h('div', { class: 'card' },
    h('h2', null, '👶 Birth record'),
    kv('Born', fmtDT(d.time)),
    kv('Mode', MODE_LABEL[d.mode] || d.mode),
    kv('Outcome', OUTCOME_LABEL[d.outcome] || d.outcome),
    d.outcome && d.outcome !== 'live'
      ? kv('When the baby died', (SB_TIMING.find(x => x.value === d.stillbirthTiming) || { label: 'Not recorded' }).label) : null,
    n.sex ? kv('Baby', `${n.sex === 'M' ? 'Boy' : 'Girl'}${n.weightG ? ' · ' + n.weightG + ' g' : ''}`) : null,
    h('div', { class: 'kv' }, h('b', null, 'APGAR 1′ / 5′ / 10′'),
      h('span', { style: 'display:flex;gap:6px' }, apgarChip(n.apgar1), apgarChip(n.apgar5), apgarChip(n.apgar10))),
    n.resus ? kv('Resuscitation', n.resusDetail || 'Yes') : null,
    kv('Placenta', d.placentaComplete === 'Y' ? 'Complete' : '⚠ Incomplete'),
    d.eblMl != null ? kv('Blood loss at birth', d.eblMl + ' ml' + (FLAG.bloodLoss(d.eblMl) ? ' ⚠' : '')) : null,
    kv('Perineum', d.perineum),
    kv('Recorded by', d.by || '-'),
    earlier ? h('p', { class: 'muted' },
      `${earlier} earlier birth record${earlier > 1 ? 's were' : ' was'} corrected and kept in the case history.`) : null,
    // a closed case stays closed: voiding would put her back into labour monitoring
    stageOf(p) !== 'closed' ? h('div', { class: 'no-print', style: 'margin-top:10px' },
      h('button', { class: 'btn ghost', onclick: () => correctBirth(p, root) }, 'Correct birth record')) : null,
  );
}

/** S5: the wrong birth record moves to the case history; the birth form returns. */
async function correctBirth(p, root) {
  const res = await promptDialog({
    title: 'Correct birth record',
    message: 'Use this when the birth record is wrong: for example, recorded for the wrong woman or before the birth.',
    lines: [
      'The record moves to the case history with your initials and reason. Nothing is deleted.',
      'Labour monitoring resumes: her stage and timers come back from the labour entries.',
      'Alerts raised by this birth record close. Postpartum checks and blood-loss readings stay in the entries.',
      'Then record the birth again with the correct details.',
    ],
    needReason: true, by: getBy(), okLabel: 'Move to history', danger: true,
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
  toast('Birth record moved to history - record the birth again');
  redraw(root, p);
}

/** 10-minute APGAR after a low 5-minute score. Empty, it holds nothing to lose. */
function apgar10Form(p) {
  const state = {};
  let by = '';
  let saving = false;
  const form = h('div', { 'data-form': 'apgar10', 'data-saved': '1' });
  const card = apgarBlock(t('apgar') + ' — 10 minutes', state, () => { delete form.dataset.saved; });
  card.append(
    byField(getBy(), v => { by = v; }),
    h('button', { class: 'btn big', onclick: save }, 'Save 10-minute APGAR'),
  );
  form.append(card);

  async function save() {
    if (saving) return;
    if (state.total == null) { toast('Complete all five APGAR items', 'danger'); return; }
    if (!by) { toast('Your initials are required', 'danger'); return; }
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
    toast('10-minute APGAR saved ✓');
    // the app keeps the page while another form on it is being filled
    if (form.isConnected) form.replaceWith(h('p', { class: 'muted' }, `10-minute APGAR ${state.total}/10 saved.`));
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
    h('h2', null, 'Blood loss and PPH'),
    status,
    pphForm(p, paintStatus),
    h('h3', null, 'PPH first-response bundle'),
    h('p', { class: 'muted' },
      'Start every step together as soon as the trigger is met, or earlier on clinical judgement. Tick each step when it is done.'),
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
    banner = alertBanner({ severity: 'danger', title: triggerTitle(trig), advice: ['Call for help and start every first-response step below together.'] });
    banner.classList.add('pph-trigger');
    banner.setAttribute('role', 'alert');
  }
  return h('div', null,
    banner,
    h('div', { class: 'pph-total' }, `${bloodLossTotal(p)} mL`),
    h('p', { class: 'muted', style: 'margin:0 0 8px' }, 'Measured blood loss since birth: the highest running total recorded.'),
    h('p', { style: 'margin:0' }, 'WHO 2025 trigger - start the bundle at:'),
    h('ul', { class: 'advice' },
      h('li', null, `${L.volumeWithSigns} mL with an abnormal sign: pulse above ${L.signs.pulseAbove}, systolic below ${L.signs.sbpBelow}, `
        + `diastolic below ${L.signs.dbpBelow} or shock index above ${L.signs.shockIndexAbove}`),
      h('li', null, `${L.volume} mL, with or without signs`),
    ),
    h('p', null, signs.length
      ? `Abnormal signs now: ${signs.join(', ')}`
      : 'No abnormal sign recorded since birth: check pulse and BP with each reading.'),
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

function readingsList(p) {
  const d = p.delivery;
  const rows = activeObs(p).filter(o => o.type === 'bloodloss' && o.v && o.v.ml != null).sort(byTime);
  if (!rows.length && d.eblMl == null) return null;
  const how = code => (LOSS_METHODS.find(x => x.value === code) || { label: code || 'method not recorded' }).label.toLowerCase();
  return h('ul', { class: 'muted', style: 'margin:0 0 8px;padding-left:18px;font-size:.9rem' },
    d.eblMl != null ? h('li', null, `${fmtTime(d.time)} - ${d.eblMl} mL at birth (birth record)`) : null,
    rows.map(o => h('li', null, `${fmtTime(o.time)} - ${o.v.ml} mL, ${how(o.v.method)}${o.by ? ' - ' + o.by : ''}`)),
  );
}

/** A measured reading: the cumulative total, as a calibrated drape shows it. Empty, it holds nothing to lose. */
function pphForm(p, onSaved) {
  let ml = null, method = 'drape', by = '', saving = false;
  const form = h('div', { 'data-form': 'pph', 'data-saved': '1' });
  const mlInput = h('input', {
    type: 'number', inputmode: 'numeric', min: '1', step: '10', placeholder: 'e.g. 350',
    oninput: e => {
      ml = e.target.value === '' ? null : Number(e.target.value);
      if (ml == null) form.dataset.saved = '1'; else delete form.dataset.saved;
    },
  });
  form.append(
    h('h3', null, 'Add a reading'),
    h('div', { class: 'grid2' },
      field('Total blood loss since birth (mL) *', mlInput),
      field('Method', segmented(LOSS_METHODS, method, v => { method = v; })),
    ),
    h('p', { class: 'muted', style: 'margin-top:0' },
      'Enter the running total, not the amount since the last reading: a calibrated drape shows it. '
      + 'Weighed pads and linen: subtract the dry weight (1 g is about 1 mL) and add it to the previous total.'),
    byField(getBy(), v => { by = v; }),
    h('button', { class: 'btn', onclick: save }, 'Save reading'),
  );

  async function save() {
    if (saving) return;
    if (!Number.isInteger(ml) || ml <= 0) { toast('Enter the total blood loss since birth in mL', 'danger'); return; }
    if (!by) { toast('Your initials are required', 'danger'); return; }
    saving = true;
    let r;
    try {
      const recorded = bloodLossTotal(p);
      if (ml < recorded && !(await confirmDialog(
        `${ml} mL is less than the ${recorded} mL already recorded. Readings are running totals since birth. Save ${ml} mL anyway?`,
        { okLabel: 'Save anyway' }))) return;
      form.dataset.saved = '1';
      r = await commit(p, () => applyObservations(p, new Date().toISOString(), { bloodloss: { ml, method } }, S.settings, { by }));
    } catch (e) {
      delete form.dataset.saved;
      toast('Could not save the reading: ' + errText(e), 'danger');
      return;
    } finally {
      saving = false;
    }
    setBy(by);
    toast(`Blood loss ${ml} mL recorded`);
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
    const res = await promptDialog({ title: 'Record bundle step', message: label, okLabel: 'Done' });
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
    toast('Could not save: ' + errText(e), 'danger');
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
  if (!inPostpartumWatch(p, now)) return [h('span', { class: 'chip ok' }, 'Postpartum watch complete')];
  const live = p.delivery.outcome === 'live';
  return dueList(p, getProtocol(S.settings, p), now)
    .filter(d => live || d.type !== 'ppBaby') // no baby checks after a stillbirth
    .map(d => h('button', {
      type: 'button', class: 'chip pp' + (d.state === 'ok' ? '' : ' ' + d.state), style: 'border:none;cursor:pointer',
      onclick: () => openRecordWizard(p, [wizardTypeFor(d.type)], onDone, { title: 'Record check' }),
    }, chipLabel(d)));
}

function chipLabel(d) {
  if (d.state === 'overdue') return `${t(d.type)} - ${d.overdueMin} min ${t('overdue')}`;
  if (d.state === 'due') return `${t(d.type)} - ${t('due')}`;
  return `${t(d.type)} - next ${fmtTime(d.dueAt)}`;
}

/** "Keep watching" advice, worded from the POSTPARTUM schedule so it never drifts from the chips. */
function watchGuidance(p) {
  const P = POSTPARTUM;
  const live = p.delivery.outcome === 'live';
  const cadence = P.phases.map((ph, i) => {
    const gap = !live || ph.mother === ph.baby
      ? `every ${fmtMin(ph.mother)}`
      : `the mother every ${fmtMin(ph.mother)} and the baby every ${fmtMin(ph.baby)}`;
    return `${gap} ${i === 0 ? 'for the first' : 'to'} ${fmtMin(ph.untilMin)}`;
  }).join(', then ');
  return [
    'Most maternal deaths happen in the first 24 hours after birth.',
    `Check ${live ? 'the mother and baby' : 'the mother'} ${cadence}.`,
    'Mother: bleeding, uterine tone, fundus, pulse, BP and temperature.',
    live ? 'Baby: breathing, warmth, colour and feeding.' : null,
    `BP within ${fmtMin(P.bpFirstMin)} of birth and again within ${fmtMin(P.bpSecondByMin)}; she should pass urine within ${fmtMin(P.voidByMin)}.`,
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
