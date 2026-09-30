// wizard.js - the guided "record now" flow.
//
// The midwife answers one large-format question per screen (numpad / big
// buttons); the partograph is drawn automatically from the answers. Entries
// can be back-timed up to 60 min (graceful late entry - field studies show
// hard lock-outs fail on busy night shifts).
//
// M3 adds the WHO codes (supportive care Y/N/D, amniotic fluid I, C, M+ to
// M+++ and B, urine Negative to ++++), the postpartum mother and baby checks
// and measured blood loss (N3, N4), initials on every entry (F3), the audit's
// list of values committed without being touched, and the correction of an
// entry (void + re-entry, S5). Every write goes through record.js. The alert
// marks on the buttons and the numpad hints come from FLAG (alerts.js), so no
// threshold is written here (S13).

import {
  h, clear, openModal, numpad, stepper, segmented, toast, beep, alertBanner, byField, fmtTime, minutesAgoISO,
} from './ui.js';
import { t } from './i18n.js';
import { getProtocol, lastObs, birthTime, toMs } from './protocol.js';
import { FLAG, bloodLossTotal } from './alerts.js';
import { applyObservations, correctObservation, normalizeValues } from './record.js';
import { S, savePatient, uid, getBy, setBy } from './store.js';

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const blank = v => v == null || v === '' || Number.isNaN(v);
const errorText = e => (e && e.message) || String(e);
const errorLine = () => h('p', { class: 'muted', style: 'color:var(--c-danger);min-height:1.2em' }, '');

// ------------------------------------------------------------ answers ----
// Options are {value, label, alert}. `alert` marks the values the engine
// alerts on, read from the FLAG predicate wherever one exists.

const marked = (opts, isAlert) => opts.map(o => ({ ...o, alert: !!isAlert(o.value) }));

// manual Table 3: Y, N or D (the woman declines); N is the alert value (F1)
const yesNoDeclined = key => marked(
  [{ value: 'Y', label: 'Yes' }, { value: 'N', label: 'No' }, { value: 'D', label: 'Declined' }],
  v => FLAG.supportive(key, v));

const POSTURE = marked([
  { value: 'upright', label: 'Upright / mobile' }, { value: 'lateral', label: 'Lying on side' },
  { value: 'supine', label: 'Supine (on back)' },
], v => FLAG.supportive('posture', v));

// manual Table 4: I intact, C clear, M+ / M++ / M+++ (non-significant, medium,
// thick meconium), B blood; M+++ and B alert (F7). v1's ungraded 'M' is never offered.
const LIQUOR = marked([
  { value: 'I', label: 'I - intact' }, { value: 'C', label: 'C - clear' },
  { value: 'M1', label: 'M+' }, { value: 'M2', label: 'M++' }, { value: 'M3', label: 'M+++ thick' },
  { value: 'B', label: 'B - blood' },
], FLAG.liquor);
const MECONIUM_HELP = 'M = meconium: + non-significant, ++ medium, +++ thick.';

// manual Table 5: Negative, Trace, + to ++++; ++ and above alert (F9)
const URINE = marked([
  { value: 'neg', label: 'Negative' }, { value: 'trace', label: 'Trace' }, { value: '+', label: '+' },
  { value: '++', label: '++' }, { value: '+++', label: '+++' }, { value: '++++', label: '++++' },
], FLAG.urine);

const DECEL = marked([
  { value: 'none', label: 'None' }, { value: 'early', label: 'Early' }, { value: 'variable', label: 'Variable' },
  { value: 'late', label: 'Late' }, { value: 'prolonged', label: 'Prolonged' },
], FLAG.decel);

// a band is judged by the seconds record.js stores for it
const DURATION = marked([
  { value: 'lt20', label: '< 20 s' }, { value: 'b20_40', label: '20–40 s' },
  { value: 'b40_60', label: '40–60 s' }, { value: 'gt60', label: '> 60 s' },
], band => FLAG.contractionDuration(normalizeValues('contractions', { durBand: band }).duration));

// any presentation other than cephalic raises the malpresentation alert
const PRESENTATION = marked([
  { value: 'cephalic', label: 'Cephalic' }, { value: 'breech', label: 'Breech' },
  { value: 'transverse', label: 'Transverse' }, { value: 'other', label: 'Other' },
], v => v !== 'cephalic');

const POSITION = marked([
  { value: 'OA', label: 'OA (anterior)' }, { value: 'OT', label: 'OT (transverse)' },
  { value: 'OP', label: 'OP (posterior)' }, { value: 'unknown', label: 'Unsure' },
], FLAG.position);

const GRADES = [{ value: 0, label: 'None' }, { value: 1, label: '+' }, { value: 2, label: '++' }, { value: 3, label: '+++' }];
const CAPUT = marked(GRADES, FLAG.caput);
const MOULDING = marked(GRADES, FLAG.moulding);

// postpartum (rec 55): the values the ppMother / ppBaby rules alert on are marked
const BLEEDING = [{ value: 'normal', label: 'Normal' }, { value: 'heavy', label: 'Heavy', alert: true }];
const TONE = [{ value: 'firm', label: 'Firm (contracted)' }, { value: 'soft', label: 'Soft', alert: true }];
const FUNDUS = [
  { value: 'below', label: 'Below umbilicus' }, { value: 'at', label: 'At umbilicus' },
  { value: 'above', label: 'Above umbilicus' },
];
const YES_NO = [{ value: 'Y', label: 'Yes' }, { value: 'N', label: 'No' }];
const BREATHING = [
  { value: 'normal', label: 'Normal' }, { value: 'difficult', label: 'Difficult', alert: true },
  { value: 'none', label: 'Not breathing', alert: true },
];
const FEEDING = [{ value: 'good', label: 'Good' }, { value: 'poor', label: 'Poor', alert: true }];
const LOSS_METHOD = [
  { value: 'drape', label: 'Calibrated drape' }, { value: 'weighed', label: 'Weighed pads / linen' },
  { value: 'estimate', label: 'Estimated' },
];

const PULSE = { unit: 'bpm', maxLen: 3, alertFn: FLAG.pulse };
const SYS = { unit: 'mmHg', maxLen: 3, alertFn: FLAG.sys };
const DIA = { unit: 'mmHg', maxLen: 3, alertFn: FLAG.dia };
const TEMP = { unit: '°C', decimal: true, maxLen: 4, alertFn: FLAG.temp };
// the ppBaby rule's range (PANEL-TO-CONFIRM), from the shared alert predicates
const NEWBORN_TEMP = { unit: '°C', decimal: true, maxLen: 4, alertFn: FLAG.newbornTemp };
const Q = {
  pulse: 'Maternal pulse (bpm)?', sys: 'Blood pressure — SYSTOLIC?', dia: 'Blood pressure — DIASTOLIC?',
  temp: 'Temperature (°C)?',
};

// -------------------------------------------------------------- steps ----
// One question per screen. A step has key, q, help, and one control:
// options (segmented), numpad or stepper (hint: previous value shown greyed,
// never committed untouched). required, or requiredIf(values of its type);
// every other step can be skipped. dflt pre-selects an answer: an untouched
// default is reported to the audit as defaulted. note(value, session) adds a
// line under the control.

const STEPS = {
  baby: [
    {
      key: 'fhr', q: 'Fetal heart rate (bpm)?', required: true,
      help: 'Listen for at least 1 full minute, through a contraction and 30 s after it.',
      numpad: { unit: 'bpm', maxLen: 3, alertFn: FLAG.fhr },
    },
    { key: 'decel', q: 'Decelerations heard?', dflt: 'none', options: DECEL },
    {
      key: 'liquor', q: 'Amniotic fluid?', options: LIQUOR,
      help: 'Skip if membranes intact and nothing draining. ' + MECONIUM_HELP,
    },
  ],

  contractions: [
    { key: 'count', q: 'Contractions in 10 minutes?', required: true, help: 'Palpate for a full 10 minutes.', stepper: { min: 0, max: 8 } },
    { key: 'durBand', q: 'How long does each contraction last?', options: DURATION },
  ],

  pulse: [
    { key: 'pulse', q: Q.pulse, required: true, numpad: PULSE },
  ],

  vitals: [
    { key: 'sys', q: Q.sys, required: true, numpad: SYS },
    { key: 'dia', q: Q.dia, required: true, numpad: DIA },
    { key: 'temp', q: Q.temp, numpad: TEMP },
    { key: 'protein', q: 'Urine protein (dipstick)?', options: URINE, help: 'Skip if no urine passed / no dipstick available.' },
    { key: 'acetone', q: 'Urine acetone (dipstick)?', options: URINE },
  ],

  exam: [
    {
      key: 'dilatation', q: 'Cervical dilatation (cm)?', required: true,
      stepper: { min: 0, max: 10, unit: 'cm' }, hint: p => lastExamValue(p, 'dilatation'),
    },
    {
      key: 'descent', q: 'Descent — fifths of head palpable above brim?',
      help: '5/5 = floating, 0/5 = fully engaged/on pelvic floor.',
      stepper: { min: 0, max: 5, unit: '/5' }, hint: p => lastExamValue(p, 'descent'),
    },
    { key: 'presentation', q: 'Presentation?', dflt: 'cephalic', options: PRESENTATION },
    { key: 'position', q: 'Fetal position (if cephalic)?', options: POSITION },
    { key: 'caput', q: 'Caput?', dflt: 0, options: CAPUT },
    {
      key: 'moulding', q: 'Moulding?', dflt: 0, options: MOULDING,
      help: '+ sutures apposed · ++ overlapped but reducible · +++ overlapped, NOT reducible',
    },
    { key: 'liquor', q: 'Membranes / amniotic fluid?', options: LIQUOR, help: MECONIUM_HELP },
  ],

  // manual Table 3, recorded hourly
  supportive: [
    { key: 'companion', q: 'Companion of her choice present?', dflt: 'Y', options: yesNoDeclined('companion') },
    {
      key: 'painRelief', q: 'Has she received pain relief?', dflt: 'Y', options: yesNoDeclined('painRelief'),
      help: 'Any form counts: relaxation, breathing, massage or medication.',
    },
    { key: 'oralFluid', q: 'Oral fluid taken since the last check?', dflt: 'Y', options: yesNoDeclined('oralFluid') },
    { key: 'posture', q: 'Current position?', dflt: 'upright', options: POSTURE },
  ],

  oxytocin: [
    { key: 'uL', q: 'Oxytocin concentration (units per litre)?', numpad: { unit: 'U/L', maxLen: 3 } },
    { key: 'dropsMin', q: 'Infusion rate (drops per minute)?', required: true, numpad: { unit: 'drops/min', maxLen: 3 } },
  ],

  // Postpartum mother check (rec 55; N4). Bleeding and tone are always asked;
  // fundal height is recorded, not alerted. A systolic needs its diastolic.
  ppMother: [
    {
      key: 'bleeding', q: 'Vaginal bleeding?', required: true, options: BLEEDING,
      help: 'If heavy, measure it now: calibrated drape, or weigh pads and linen.',
    },
    { key: 'tone', q: 'Uterine tone (abdominal palpation)?', required: true, options: TONE },
    { key: 'fundus', q: 'Fundal height?', options: FUNDUS },
    { key: 'pulse', q: Q.pulse, required: true, numpad: PULSE },
    { key: 'sys', q: Q.sys, numpad: SYS, help: 'Skip if the BP is not taken at this check.' },
    { key: 'dia', q: Q.dia, numpad: DIA, requiredIf: v => !blank(v.sys) },
    { key: 'temp', q: Q.temp, numpad: TEMP },
    { key: 'urinePassed', q: 'Has she passed urine since the birth?', options: YES_NO },
  ],

  // Postpartum baby check (N4)
  ppBaby: [
    { key: 'breathing', q: 'Baby breathing?', required: true, options: BREATHING },
    { key: 'temp', q: 'Baby temperature (axillary)?', numpad: NEWBORN_TEMP },
    { key: 'feeding', q: 'Feeding?', options: FEEDING },
  ],

  // Measured blood loss (PPH 2025; N3). The engine takes the highest reading
  // as the total, so each reading must be the running total.
  bloodloss: [
    {
      key: 'ml', q: 'Total blood loss so far (mL)?', required: true,
      help: 'The running total on the calibrated drape: all blood lost since the birth, not the amount since the last reading.',
      numpad: { unit: 'mL', maxLen: 4, alertFn: FLAG.bloodLoss }, note: bloodLossNote,
    },
    { key: 'method', q: 'How was it measured?', dflt: 'drape', options: LOSS_METHOD },
  ],
};

/** Every wizard type, in the order the step sets are defined. */
export const WIZARD_TYPES = Object.freeze(Object.keys(STEPS));

/** The step definitions of a wizard type (data; [] for an unknown type). */
export function wizardSteps(type) {
  return own(STEPS, type) ? STEPS[type] : [];
}

// due items that are recorded with another type's steps
const DUE_TO_WIZARD = { ppBP: 'ppMother', ppVoid: 'ppMother' };

/** The wizard type that records a due item: ppBP and ppVoid are parts of the mother check. */
export function wizardTypeFor(dueType) {
  return own(DUE_TO_WIZARD, dueType) ? DUE_TO_WIZARD[dueType] : dueType;
}

/**
 * Values committed without the midwife touching them, for the audit
 * (entry.defaulted): {type: [keys whose committed value is still the step
 * default and that were never touched]}; types with none are omitted.
 * values {type: {key: value}}, defaults {type: {key: default}}, touched
 * {type: Set or array of keys}. Pure.
 */
export function computeDefaulted(values, defaults, touched) {
  const out = {};
  for (const [type, dflts] of Object.entries(defaults || {})) {
    const v = (values || {})[type];
    if (!v) continue;
    const seen = new Set((touched && touched[type]) || []);
    const keys = Object.keys(dflts).filter(k => own(v, k) && v[k] === dflts[k] && !seen.has(k));
    if (keys.length) out[type] = keys;
  }
  return out;
}

function lastExamValue(patient, key) {
  const o = lastObs(patient, 'exam', x => x.v && x.v[key] != null);
  return o ? o.v[key] : null;
}

const isRequired = (step, typeValues) => !!step.required || !!(step.requiredIf && step.requiredIf(typeValues));

const stepDefaults = type => Object.fromEntries(
  wizardSteps(type).filter(s => s.dflt !== undefined).map(s => [s.key, s.dflt]));

/** The committed values without the blanks an untouched numpad leaves; empty types dropped. */
function cleanValues(values) {
  const out = {};
  for (const [type, v] of Object.entries(values)) {
    const kept = Object.fromEntries(Object.entries(v).filter(([, x]) => !blank(x)));
    if (Object.keys(kept).length) out[type] = kept;
  }
  return out;
}

// v1 codes with a current equivalent: urine 'nil' is today's Negative
const LEGACY_CODE = { nil: 'neg' };

/** A recorded answer in the step's current code: v1's 'nil' shows as 'neg'; a code with no equivalent is kept. */
export function currentCode(step, v) {
  if (!step || !step.options || step.options.some(o => o.value === v)) return v;
  const next = typeof v === 'string' && own(LEGACY_CODE, v) ? LEGACY_CODE[v] : v;
  return step.options.some(o => o.value === next) ? next : v;
}

/**
 * The values of the entry being corrected: only the keys it has (no step
 * default is added). Fields record.js derives - a contraction's seconds from
 * its band - are left out so they are derived again from the corrected answer.
 */
export function prefillValues(type, prefill) {
  const steps = wizardSteps(type);
  const stepOf = k => steps.find(s => s.key === k);
  const src = Object.fromEntries(Object.entries(prefill || {}).filter(([k, v]) => v !== undefined && !k.startsWith('_')));
  const answers = Object.fromEntries(Object.entries(src).filter(([k]) => stepOf(k)));
  const derived = Object.keys(normalizeValues(type, answers)).filter(k => !stepOf(k));
  const out = {};
  for (const [k, v] of Object.entries(src)) {
    if (!derived.includes(k)) out[k] = currentCode(stepOf(k), v);
  }
  return out;
}

/** Blood loss is a running total: show what is already recorded and warn when a reading is below it. */
function bloodLossNote(ml, w) {
  const obs = (w.patient.obs || []).filter(o => o.id !== w.opts.replaces);
  const before = bloodLossTotal({ ...w.patient, obs }, w.time);
  if (!before) return null;
  if (!blank(ml) && ml < before) {
    return `Lower than the ${before} mL already recorded - enter the running total, not the amount since the last reading.`;
  }
  return `Already recorded: ${before} mL in total.`;
}

/** The line under a control: an older code kept from the entry being corrected, or the step's note. */
function stepNote(w, step, value) {
  if (step.options && !blank(value) && !step.options.some(o => o.value === value)) {
    return `Recorded earlier as "${value}", a code no longer offered - choose the current code.`;
  }
  return step.note ? step.note(value, w) : null;
}

// --------------------------------------------------------------- wizard ----

const TIME_CHOICES = [
  { value: 0, label: 'Just now' }, { value: 5, label: '5 min ago' }, { value: 10, label: '10 min ago' },
  { value: 15, label: '15 min ago' }, { value: 30, label: '30 min ago' }, { value: 60, label: '60 min ago' },
];

/**
 * The "when" choices for a new entry. Once a birth is recorded, a time before
 * it is not offered; "Just now" always is. Pure.
 */
export function timeChoices(birthISO, now = new Date()) {
  if (!birthISO) return TIME_CHOICES;
  const birth = toMs(birthISO);
  return TIME_CHOICES.filter(c => c.value === 0 || toMs(now) - c.value * 60000 >= birth);
}

/**
 * Open the guided recording flow.
 * types: wizard types to collect, in order (due types are mapped through
 * wizardTypeFor; repeats and unknown types are dropped). onComplete(added
 * alerts) runs after a successful save.
 * Correction mode, opts = {replaces: id of the entry, prefill: its values,
 * time: its observation time, by, reason} (initials and reason collected by
 * the caller): the entry's own type only, no time screen, and the finish
 * voids the entry and records the corrected values in its place (S5).
 * opts.title names the time screen (default "Record now").
 */
export function openRecordWizard(patient, types, onComplete, opts = {}) {
  const problem = opts.replaces ? correctionProblem(patient, opts.replaces) : null;
  if (problem) { toast(problem, 'danger'); return; }
  const w = createSession(patient, types, onComplete, opts);
  if (!w) return;
  w.body = h('div');
  w.close = openModal(w.body, { locked: true });
  if (w.correcting) showStep(w); else showTimeScreen(w);
}

function correctionProblem(patient, id) {
  const old = (patient.obs || []).find(o => o.id === id);
  if (!old) return 'Entry not found';
  if (old.voided) return 'This entry is already voided';
  if (!WIZARD_TYPES.includes(old.type)) return 'This entry cannot be corrected here - void it and record it again.';
  return null;
}

function createSession(patient, types, onComplete, opts) {
  const correcting = !!opts.replaces;
  const old = correcting ? patient.obs.find(o => o.id === opts.replaces) : null;
  const list = correcting ? [old.type]
    : [...new Set((types || []).map(wizardTypeFor))].filter(type => WIZARD_TYPES.includes(type));
  if (!list.length) return null;
  const w = {
    patient, onComplete, opts, correcting, list,
    plan: list.flatMap(type => wizardSteps(type).map(step => ({ type, step }))),
    values: {}, touched: {}, defaults: {},
    idx: 0, offsetMin: 0, saving: false, error: null,
    by: correcting ? String(opts.by || '') : getBy(),
    time: correcting ? (opts.time || old.time) : null,
  };
  for (const type of list) {
    w.values[type] = correcting ? prefillValues(type, opts.prefill || old.v) : {};
    w.touched[type] = new Set();
    w.defaults[type] = stepDefaults(type);
  }
  return w;
}

function showTimeScreen(w) {
  clear(w.body);
  const err = errorLine();
  const birth = birthTime(w.patient);
  const choices = timeChoices(birth);
  if (!choices.some(c => c.value === w.offsetMin)) w.offsetMin = 0;
  w.body.append(
    h('h2', null, w.opts.title || t('record_now')),
    h('p', { class: 'wizard-q' }, 'When were these observations made?'),
    segmented(choices, w.offsetMin, v => { w.offsetMin = v; }, { big: true }),
    choices.length < TIME_CHOICES.length ? h('p', { class: 'muted' },
      `Earlier times are not offered: they are before the recorded birth time (${fmtTime(birth)}).`) : null,
    byField(w.by, v => { w.by = v; err.textContent = ''; }),
    err,
    h('div', { class: 'wizard-nav' },
      h('button', { class: 'btn secondary', onclick: () => w.close() }, t('cancel')),
      h('button', {
        class: 'btn', onclick: () => {
          if (!w.by) { err.textContent = 'Your initials are required.'; return; }
          w.time = minutesAgoISO(w.offsetMin);
          showStep(w);
        },
      }, t('next')),
    ),
  );
}

function control(step, value, onChange, patient) {
  if (step.options) return segmented(step.options, value, onChange, { big: true });
  if (step.numpad) return numpad(value, onChange, step.numpad);
  return stepper(value, onChange, { ...step.stepper, hint: step.hint ? step.hint(patient) : null });
}

function stepHeader(w, type) {
  return [
    h('h2', null, t(type)),
    w.correcting ? h('p', null, h('span', { class: 'chip due' }, 'Correcting the entry at ' + fmtTime(w.time))) : null,
    w.correcting && w.idx === 0 ? byField(w.by, v => { w.by = v; }) : null,
    h('div', { class: 'wizard-progress' }, w.plan.map((_, i) => h('span', { class: i < w.idx ? 'done' : '' }))),
  ];
}

function showStep(w) {
  const { type, step } = w.plan[w.idx];
  const tv = w.values[type];
  if (!w.correcting && tv[step.key] == null && step.dflt !== undefined) tv[step.key] = step.dflt;
  const err = errorLine();
  const note = h('p', { class: 'muted' });
  const paintNote = () => {
    const text = stepNote(w, step, tv[step.key]);
    note.textContent = text || '';
    note.style.display = text ? '' : 'none';
  };
  let rendered = false;
  const input = control(step, tv[step.key], v => {
    tv[step.key] = v;
    if (rendered) w.touched[type].add(step.key); // numpad and stepper also call this while being built
    err.textContent = '';
    paintNote();
  }, w.patient);
  paintNote();
  if (w.error) { err.textContent = w.error; w.error = null; }
  clear(w.body);
  w.body.append(...[
    ...stepHeader(w, type),
    h('p', { class: 'wizard-q' }, step.q),
    step.help ? h('p', { class: 'wizard-help' }, step.help) : null,
    input, note, err,
    stepNav(w, step, tv, err),
  ].filter(Boolean));
  rendered = true;
}

function stepNav(w, step, tv, err) {
  const last = w.idx === w.plan.length - 1;
  const required = isRequired(step, tv);
  const advance = () => {
    if (last) { finishWizard(w); return; }
    w.idx++;
    showStep(w);
  };
  const back = () => {
    if (w.idx > 0) { w.idx--; showStep(w); } else if (w.correcting) w.close(); else showTimeScreen(w);
  };
  const next = () => {
    if (required && blank(tv[step.key])) { err.textContent = 'This value is required.'; return; }
    advance();
  };
  return h('div', { class: 'wizard-nav' },
    h('button', { class: 'btn secondary', onclick: back }, w.correcting && w.idx === 0 ? t('cancel') : t('back')),
    required ? null : h('button', { class: 'btn ghost', onclick: () => { delete tv[step.key]; advance(); } }, t('skip')),
    h('button', { class: 'btn', onclick: next }, last ? (w.correcting ? 'Save correction' : t('finish')) : t('next')),
  );
}

/** Back to a step with a message (the screen is rebuilt, so its buttons work again). */
function showAgain(w, message, idx = w.idx) {
  w.idx = idx;
  w.error = message;
  showStep(w);
}

async function finishWizard(w) {
  if (w.saving) return;
  const clean = cleanValues(w.values);
  if (w.correcting && !w.by) { showAgain(w, 'Your initials are required.', 0); return; }
  if (w.correcting && !clean[w.list[0]]) {
    showAgain(w, 'Nothing to record - enter a value, or void the entry instead.');
    return;
  }
  if (!Object.keys(clean).length) { w.close(); toast('Nothing recorded - every question was skipped'); return; }
  w.saving = true;
  for (const b of w.body.querySelectorAll('button')) b.disabled = true;
  let done;
  try {
    done = w.correcting ? await saveCorrection(w, clean) : await saveEntry(w, clean);
  } catch (e) {
    w.saving = false;
    showAgain(w, 'Not saved: ' + errorText(e));
    return;
  }
  w.close();
  toast(done.message);
  toastTransitions(w.patient, done.transitions);
  if (done.added.length) showAlertAckModal(w.patient, done.added);
  if (w.onComplete) w.onComplete(done.added);
}

async function saveEntry(w, clean) {
  const defaulted = computeDefaulted(clean, w.defaults, w.touched);
  const r = await recordObservations(w.patient, w.time, clean, { by: w.by, defaulted });
  return { added: r.added, transitions: r.transitions, message: 'Saved — chart updated ✓' };
}

async function saveCorrection(w, clean) {
  const { patient, opts } = w;
  const r = await commit(patient, () => correctObservation(patient, opts.replaces, clean[w.list[0]], S.settings,
    { by: w.by, reason: opts.reason, time: w.time }));
  setBy(w.by);
  // r.transitions is the net stage change of the void and the re-entry together
  return { added: r.added, transitions: r.transitions, message: 'Entry corrected' };
}

// --------------------------------------------------------------- saving ----

/**
 * Apply a record-layer change and persist it, all or nothing: if the change
 * or the save fails, the case in memory is put back as it was, so the screen
 * never shows - and a later save never stores - a half-applied entry.
 */
async function commit(patient, change) {
  const before = structuredClone(patient);
  try {
    const result = change();
    await savePatient(patient);
    return result;
  } catch (e) {
    for (const k of Object.keys(patient)) delete patient[k];
    Object.assign(patient, before);
    throw e;
  }
}

async function recordObservations(patient, timeISO, values, { by = null, defaulted = {} } = {}) {
  const r = await commit(patient, () => applyObservations(patient, timeISO, values, S.settings, { by, defaulted }));
  if (by) setBy(by);
  return r;
}

const TRANSITION_TOAST = {
  active: (proto) => `Active labour - chart started (${proto.activeStartCm} cm reached)`,
  second: () => 'Fully dilated - second stage timer started',
  second_reverted: () => 'Second stage reverted - its timer stopped',
  active_reverted: () => 'Back to the latent phase',
  active_moved: (proto, p) => `Active labour start moved to ${fmtTime(p.activeStartTime)}`,
  second_moved: (proto, p) => `Second stage start moved to ${fmtTime(p.secondStageStart)}`,
};

function toastTransitions(patient, transitions) {
  const proto = getProtocol(S.settings, patient);
  for (const tr of transitions || []) {
    if (own(TRANSITION_TOAST, tr)) toast(TRANSITION_TOAST[tr](proto, patient));
  }
}

/**
 * Record one round of observations through record.js (author, source,
 * stage, alert engine), save the case and toast any stage change. opts: by
 * (initials), defaulted ({type: [keys]} - see computeDefaulted). Returns the
 * alerts it added. Throws if nothing could be saved; the case is then as it
 * was before the call.
 */
export async function saveObservations(patient, timeISO, values, { by = null, defaulted = {} } = {}) {
  const r = await recordObservations(patient, timeISO, values, { by, defaulted });
  toastTransitions(patient, r.transitions);
  return r.added;
}

// ------------------------------------------------- alert acknowledgement ----

const ACK_ACTIONS = [
  { value: 'monitoring', label: 'Continue close monitoring' },
  { value: 'senior', label: 'Senior/colleague called' },
  { value: 'intervention', label: 'Intervention given' },
  { value: 'referral', label: 'Referral started', alert: true },
];

/** Mark the alerts acknowledged by `by` and write the decision note. Mutates p. */
function acknowledgeAlerts(p, alerts, action, by) {
  const now = new Date().toISOString();
  // matched by id as well: after a failed save the case holds restored copies
  const picked = a => alerts.some(x => x === a || (x.id != null && x.id === a.id));
  for (const a of (p.alerts || []).filter(picked)) {
    Object.assign(a, { ack: true, action, actionTime: now, ackBy: by });
  }
  p.notes = [...(p.notes || []), {
    id: uid(), time: now, by, text: `Alerts acknowledged: ${alerts.map(a => a.title).join('; ')}`, plan: action,
  }];
}

export function showAlertAckModal(patient, alerts) {
  const real = (alerts || []).filter(a => a.severity !== 'info');
  if (!real.length) return;
  if (S.settings.sound) beep(real.some(a => a.severity === 'danger') ? 'danger' : 'due');

  let action = 'monitoring', by = getBy(), busy = false;
  const err = errorLine();
  const acknowledge = async () => {
    if (!by) { err.textContent = 'Your initials are required.'; return; }
    if (busy) return;
    busy = true;
    try {
      await commit(patient, () => acknowledgeAlerts(patient, real, action, by));
    } catch (e) {
      busy = false;
      err.textContent = 'Not saved: ' + errorText(e);
      return;
    }
    setBy(by);
    closeFn();
    if (action === 'referral') location.hash = `#/p/${patient.id}/referral`;
  };
  const body = h('div', null,
    h('h2', null, '⚠ ' + (real.length === 1 ? real[0].title : `${real.length} alerts`)),
    real.map(a => alertBanner(a)),
    h('h3', null, 'Action taken / decision (recorded on the chart):'),
    segmented(ACK_ACTIONS, action, v => { action = v; }),
    byField(by, v => { by = v; err.textContent = ''; }),
    err,
    h('div', { class: 'wizard-nav' },
      h('button', { class: 'btn', onclick: acknowledge }, 'Acknowledge & record'),
    ),
  );
  const closeFn = openModal(body, { locked: true });
}

// ----------------------------------------------------- medication modal ----

const MED_KINDS = [
  { value: 'medicine', label: 'Medicine' }, { value: 'ivfluid', label: 'IV fluids' },
  { value: 'oxytocin', label: 'Oxytocin', alert: true },
];

/** Append a medication entry; an oxytocin start, rate or stop keeps oxytocinRunning in step. Mutates p. */
function addMedication(p, entry) {
  p.meds = [...(p.meds || []), { id: uid(), time: new Date().toISOString(), ...entry }];
  if (entry.kind === 'oxytocin') p.oxytocinRunning = entry.action !== 'stop';
}

function oxytocinInputs(onUL, onDrops) {
  return h('div', { style: 'display:none' },
    h('p', { class: 'muted' }, '⚠ Oxytocin augmentation in labour is a hospital-level decision in Ethiopia. At health-centre level use oxytocin for AMTSL/PPH only, per MOH protocol.'),
    h('div', { class: 'grid2' },
      h('label', { class: 'field' }, h('span', null, 'Units per litre'), h('input', { type: 'number', oninput: e => onUL(+e.target.value || null) })),
      h('label', { class: 'field' }, h('span', null, 'Drops/min'), h('input', { type: 'number', oninput: e => onDrops(+e.target.value || null) })),
    ),
  );
}

/**
 * Medicine, IV fluids and oxytocin (manual Table 7). Every entry carries the
 * initials (required) and an action: oxytocin 'start' | 'rate' | 'stop',
 * anything else 'given'.
 */
export function openMedicationModal(patient) {
  let kind = 'medicine', detail = '', oxyUL = null, oxyDrops = null, by = getBy(), busy = false;
  const err = errorLine();
  const record = async (entry, message) => {
    if (!by) { err.textContent = 'Your initials are required.'; return; }
    if (busy) return;
    busy = true;
    try {
      await commit(patient, () => addMedication(patient, { ...entry, by }));
    } catch (e) {
      busy = false;
      err.textContent = 'Not saved: ' + errorText(e);
      return;
    }
    setBy(by);
    toast(message);
    closeFn();
  };
  const save = () => {
    const text = detail.trim();
    if (kind === 'medicine' && !text) { err.textContent = 'Enter the medicine, dose and route.'; return; }
    if (kind === 'oxytocin' && oxyDrops == null) { err.textContent = 'Enter the infusion rate (drops/min).'; return; }
    record(kind === 'oxytocin'
      ? { kind, detail: text, oxyUL, oxyDrops, action: patient.oxytocinRunning ? 'rate' : 'start' }
      : { kind, detail: text, action: 'given' }, 'Recorded ✓');
  };
  const oxySection = oxytocinInputs(v => { oxyUL = v; }, v => { oxyDrops = v; });
  const body = h('div', null,
    h('h2', null, 'Medication / IV fluids'),
    segmented(MED_KINDS, kind, v => {
      kind = v; err.textContent = '';
      oxySection.style.display = v === 'oxytocin' ? '' : 'none';
    }, { big: true }),
    h('div', { style: 'margin-top:12px' }, h('label', { class: 'field' }, h('span', null, 'Details (drug, dose, route)'),
      h('input', { type: 'text', placeholder: 'e.g. Ampicillin 2 g IV', oninput: e => { detail = e.target.value; } }))),
    oxySection,
    byField(by, v => { by = v; err.textContent = ''; }),
    err,
    h('div', { class: 'wizard-nav' },
      h('button', { class: 'btn secondary', onclick: () => closeFn() }, t('cancel')),
      h('button', { class: 'btn', onclick: save }, t('save')),
    ),
    patient.oxytocinRunning ? h('button', {
      class: 'btn ghost', style: 'margin-top:8px',
      onclick: () => record({ kind: 'oxytocin', detail: 'Oxytocin STOPPED', action: 'stop' }, 'Oxytocin marked as stopped'),
    }, '■ Stop oxytocin infusion') : null,
  );
  const closeFn = openModal(body);
}
