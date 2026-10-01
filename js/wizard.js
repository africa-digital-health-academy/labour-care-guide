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
//
// M5: every screen string goes through t() (keys 'wz.*' in js/i18n/wizard.js,
// Amharic drafts awaiting clinical review). Alert titles and advice stay in
// English: they are clinical instructions the panel has not validated in
// Amharic. Text is looked up when a screen is built, never when this module
// loads, because the language is set once the settings are read and can change
// while the app runs. What is stored in the record (note text, medication
// detail) stays English. An alert asked again shows the repeat number and the
// last acknowledgement, and the modal starts on the action taken then.

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

// A label, question, help line or unit is either a string shown as it is
// (codes such as M+ or ++, units such as mmHg) or a function that returns the
// text in the current language.
const say = x => (typeof x === 'function' ? x() : x);
const inLang = opts => opts.map(o => ({ ...o, label: say(o.label) }));

// ------------------------------------------------------------ answers ----
// Options are {value, label, alert}. `alert` marks the values the engine
// alerts on, read from the FLAG predicate wherever one exists.

const marked = (opts, isAlert) => opts.map(o => ({ ...o, alert: !!isAlert(o.value) }));

// manual Table 3: Y, N or D (the woman declines); N is the alert value (F1)
const yesNoDeclined = key => marked([
  { value: 'Y', label: () => t('yes') }, { value: 'N', label: () => t('no') },
  { value: 'D', label: () => t('wz.declined') },
], v => FLAG.supportive(key, v));

const POSTURE = marked([
  { value: 'upright', label: () => t('wz.posture_upright') },
  { value: 'lateral', label: () => t('wz.posture_lateral') },
  { value: 'supine', label: () => t('wz.posture_supine') },
], v => FLAG.supportive('posture', v));

// manual Table 4: I intact, C clear, M+ / M++ / M+++ (non-significant, medium,
// thick meconium), B blood; M+++ and B alert (F7). v1's ungraded 'M' is never offered.
const LIQUOR = marked([
  { value: 'I', label: () => t('wz.liquor_intact') }, { value: 'C', label: () => t('wz.liquor_clear') },
  { value: 'M1', label: 'M+' }, { value: 'M2', label: 'M++' }, { value: 'M3', label: () => t('wz.liquor_thick') },
  { value: 'B', label: () => t('wz.liquor_blood') },
], FLAG.liquor);
const MECONIUM_HELP = () => t('wz.help_meconium');

// manual Table 5: Negative, Trace, + to ++++; ++ and above alert (F9)
const URINE = marked([
  { value: 'neg', label: () => t('wz.urine_neg') }, { value: 'trace', label: () => t('wz.urine_trace') },
  { value: '+', label: '+' }, { value: '++', label: '++' }, { value: '+++', label: '+++' }, { value: '++++', label: '++++' },
], FLAG.urine);

const DECEL = marked([
  { value: 'none', label: () => t('wz.none') }, { value: 'early', label: () => t('wz.decel_early') },
  { value: 'variable', label: () => t('wz.decel_variable') }, { value: 'late', label: () => t('wz.decel_late') },
  { value: 'prolonged', label: () => t('wz.decel_prolonged') },
], FLAG.decel);

// a band is judged by the seconds record.js stores for it
const DURATION = marked([
  { value: 'lt20', label: () => t('wz.dur_lt20') }, { value: 'b20_40', label: () => t('wz.dur_20_40') },
  { value: 'b40_60', label: () => t('wz.dur_40_60') }, { value: 'gt60', label: () => t('wz.dur_gt60') },
], band => FLAG.contractionDuration(normalizeValues('contractions', { durBand: band }).duration));

// any presentation other than cephalic raises the malpresentation alert
const PRESENTATION = marked([
  { value: 'cephalic', label: () => t('wz.pres_cephalic') }, { value: 'breech', label: () => t('wz.pres_breech') },
  { value: 'transverse', label: () => t('wz.pres_transverse') }, { value: 'other', label: () => t('wz.pres_other') },
], v => v !== 'cephalic');

const POSITION = marked([
  { value: 'OA', label: () => t('wz.pos_oa') }, { value: 'OT', label: () => t('wz.pos_ot') },
  { value: 'OP', label: () => t('wz.pos_op') }, { value: 'unknown', label: () => t('wz.pos_unsure') },
], FLAG.position);

const GRADES = [
  { value: 0, label: () => t('wz.none') }, { value: 1, label: '+' }, { value: 2, label: '++' }, { value: 3, label: '+++' },
];
const CAPUT = marked(GRADES, FLAG.caput);
const MOULDING = marked(GRADES, FLAG.moulding);

// postpartum (rec 55): the values the ppMother / ppBaby rules alert on are marked
const BLEEDING = [{ value: 'normal', label: () => t('wz.normal') }, { value: 'heavy', label: () => t('wz.heavy'), alert: true }];
const TONE = [
  { value: 'firm', label: () => t('wz.tone_firm') }, { value: 'soft', label: () => t('wz.tone_soft'), alert: true },
];
const FUNDUS = [
  { value: 'below', label: () => t('wz.fundus_below') }, { value: 'at', label: () => t('wz.fundus_at') },
  { value: 'above', label: () => t('wz.fundus_above') },
];
const YES_NO = [{ value: 'Y', label: () => t('yes') }, { value: 'N', label: () => t('no') }];
const BREATHING = [
  { value: 'normal', label: () => t('wz.normal') },
  { value: 'difficult', label: () => t('wz.breathing_difficult'), alert: true },
  { value: 'none', label: () => t('wz.breathing_none'), alert: true },
];
const FEEDING = [
  { value: 'good', label: () => t('wz.feeding_good') }, { value: 'poor', label: () => t('wz.feeding_poor'), alert: true },
];
const LOSS_METHOD = [
  { value: 'drape', label: () => t('wz.loss_drape') }, { value: 'weighed', label: () => t('wz.loss_weighed') },
  { value: 'estimate', label: () => t('wz.loss_estimate') },
];

const PULSE = { unit: 'bpm', maxLen: 3, alertFn: FLAG.pulse };
const SYS = { unit: 'mmHg', maxLen: 3, alertFn: FLAG.sys };
const DIA = { unit: 'mmHg', maxLen: 3, alertFn: FLAG.dia };
const TEMP = { unit: '°C', decimal: true, maxLen: 4, alertFn: FLAG.temp };
// the ppBaby rule's range (PANEL-TO-CONFIRM), from the shared alert predicates
const NEWBORN_TEMP = { unit: '°C', decimal: true, maxLen: 4, alertFn: FLAG.newbornTemp };
const Q = {
  pulse: () => t('wz.q_pulse'), sys: () => t('wz.q_sys'), dia: () => t('wz.q_dia'), temp: () => t('wz.q_temp'),
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
      key: 'fhr', q: () => t('wz.q_fhr'), required: true, help: () => t('wz.help_fhr'),
      numpad: { unit: 'bpm', maxLen: 3, alertFn: FLAG.fhr },
    },
    { key: 'decel', q: () => t('wz.q_decel'), dflt: 'none', options: DECEL },
    {
      key: 'liquor', q: () => t('wz.q_liquor'), options: LIQUOR,
      help: () => t('wz.help_liquor') + ' ' + MECONIUM_HELP(),
    },
  ],

  contractions: [
    {
      key: 'count', q: () => t('wz.q_count'), required: true, help: () => t('wz.help_count'),
      stepper: { min: 0, max: 8 },
    },
    { key: 'durBand', q: () => t('wz.q_duration'), options: DURATION },
  ],

  pulse: [
    { key: 'pulse', q: Q.pulse, required: true, numpad: PULSE },
  ],

  vitals: [
    { key: 'sys', q: Q.sys, required: true, numpad: SYS },
    { key: 'dia', q: Q.dia, required: true, numpad: DIA },
    { key: 'temp', q: Q.temp, numpad: TEMP },
    { key: 'protein', q: () => t('wz.q_protein'), options: URINE, help: () => t('wz.help_protein') },
    { key: 'acetone', q: () => t('wz.q_acetone'), options: URINE },
  ],

  exam: [
    {
      key: 'dilatation', q: () => t('wz.q_dilatation'), required: true,
      stepper: { min: 0, max: 10, unit: 'cm' }, hint: p => lastExamValue(p, 'dilatation'),
    },
    {
      key: 'descent', q: () => t('wz.q_descent'), help: () => t('wz.help_descent'),
      stepper: { min: 0, max: 5, unit: '/5' }, hint: p => lastExamValue(p, 'descent'),
    },
    { key: 'presentation', q: () => t('wz.q_presentation'), dflt: 'cephalic', options: PRESENTATION },
    { key: 'position', q: () => t('wz.q_position'), options: POSITION },
    { key: 'caput', q: () => t('wz.q_caput'), dflt: 0, options: CAPUT },
    { key: 'moulding', q: () => t('wz.q_moulding'), dflt: 0, options: MOULDING, help: () => t('wz.help_moulding') },
    { key: 'liquor', q: () => t('wz.q_membranes'), options: LIQUOR, help: MECONIUM_HELP },
  ],

  // manual Table 3, recorded hourly
  supportive: [
    { key: 'companion', q: () => t('wz.q_companion'), dflt: 'Y', options: yesNoDeclined('companion') },
    {
      key: 'painRelief', q: () => t('wz.q_pain'), dflt: 'Y', options: yesNoDeclined('painRelief'),
      help: () => t('wz.help_pain'),
    },
    { key: 'oralFluid', q: () => t('wz.q_fluid'), dflt: 'Y', options: yesNoDeclined('oralFluid') },
    { key: 'posture', q: () => t('wz.q_posture'), dflt: 'upright', options: POSTURE },
  ],

  oxytocin: [
    { key: 'uL', q: () => t('wz.q_oxy_ul'), numpad: { unit: 'U/L', maxLen: 3 } },
    { key: 'dropsMin', q: () => t('wz.q_oxy_drops'), required: true, numpad: { unit: () => t('wz.unit_drops'), maxLen: 3 } },
  ],

  // Postpartum mother check (rec 55; N4). Bleeding and tone are always asked;
  // fundal height is recorded, not alerted. A systolic needs its diastolic.
  ppMother: [
    { key: 'bleeding', q: () => t('wz.q_bleeding'), required: true, options: BLEEDING, help: () => t('wz.help_bleeding') },
    { key: 'tone', q: () => t('wz.q_tone'), required: true, options: TONE },
    { key: 'fundus', q: () => t('wz.q_fundus'), options: FUNDUS },
    { key: 'pulse', q: Q.pulse, required: true, numpad: PULSE },
    { key: 'sys', q: Q.sys, numpad: SYS, help: () => t('wz.help_pp_bp') },
    { key: 'dia', q: Q.dia, numpad: DIA, requiredIf: v => !blank(v.sys) },
    { key: 'temp', q: Q.temp, numpad: TEMP },
    { key: 'urinePassed', q: () => t('wz.q_urine_passed'), options: YES_NO },
  ],

  // Postpartum baby check (N4)
  ppBaby: [
    { key: 'breathing', q: () => t('wz.q_breathing'), required: true, options: BREATHING },
    { key: 'temp', q: () => t('wz.q_baby_temp'), numpad: NEWBORN_TEMP },
    { key: 'feeding', q: () => t('wz.q_feeding'), options: FEEDING },
  ],

  // Measured blood loss (PPH 2025; N3). The engine takes the highest reading
  // as the total, so each reading must be the running total.
  bloodloss: [
    {
      key: 'ml', q: () => t('wz.q_loss'), required: true, help: () => t('wz.help_loss'),
      numpad: { unit: 'mL', maxLen: 4, alertFn: FLAG.bloodLoss }, note: bloodLossNote,
    },
    { key: 'method', q: () => t('wz.q_loss_method'), dflt: 'drape', options: LOSS_METHOD },
  ],
};

/** Every wizard type, in the order the step sets are defined. */
export const WIZARD_TYPES = Object.freeze(Object.keys(STEPS));

/** A step with its question, help, option labels and unit in the current language. */
function inLangStep(s) {
  const out = { ...s, q: say(s.q) };
  if (s.help) out.help = say(s.help);
  if (s.options) out.options = inLang(s.options);
  if (s.numpad) out.numpad = { ...s.numpad, unit: say(s.numpad.unit) };
  return out;
}

/** The step definitions of a wizard type (data, text in the current language; [] for an unknown type). */
export function wizardSteps(type) {
  return own(STEPS, type) ? STEPS[type].map(inLangStep) : [];
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
  if (!blank(ml) && ml < before) return t('wz.loss_lower', { ml: before });
  return t('wz.loss_so_far', { ml: before });
}

/** The line under a control: an older code kept from the entry being corrected, or the step's note. */
function stepNote(w, step, value) {
  if (step.options && !blank(value) && !step.options.some(o => o.value === value)) {
    return t('wz.old_code', { code: value });
  }
  return step.note ? step.note(value, w) : null;
}

// --------------------------------------------------------------- wizard ----

// how many minutes back a new entry can be timed (0 = just now)
const TIME_OFFSETS = [0, 5, 10, 15, 30, 60];

/**
 * The "when" choices for a new entry. Once a birth is recorded, a time before
 * it is not offered; "Just now" always is. Pure.
 */
export function timeChoices(birthISO, now = new Date()) {
  const birth = birthISO ? toMs(birthISO) : null;
  return TIME_OFFSETS
    .filter(min => birth === null || min === 0 || toMs(now) - min * 60000 >= birth)
    .map(min => ({ value: min, label: min ? t('wz.time_ago', { n: min }) : t('wz.time_now') }));
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
  if (!old) return t('wz.entry_not_found');
  if (old.voided) return t('wz.already_voided');
  if (!WIZARD_TYPES.includes(old.type)) return t('wz.cannot_correct');
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
  // the DOM's append() writes a null child as the text "null": leave it out
  w.body.append(...[
    h('h2', null, w.opts.title || t('record_now')),
    h('p', { class: 'wizard-q' }, t('wz.when')),
    segmented(choices, w.offsetMin, v => { w.offsetMin = v; }, { big: true }),
    // names the Delivery tab's own button (js/views/delivery.js), so both languages match the screen
    choices.length < TIME_OFFSETS.length ? h('p', { class: 'muted' },
      t('wz.earlier_hidden', { time: fmtTime(birth), button: t('fm.birth.correct'), tab: t('delivery') })) : null,
    byField(w.by, v => { w.by = v; err.textContent = ''; }),
    err,
    h('div', { class: 'wizard-nav' },
      h('button', { class: 'btn secondary', onclick: () => w.close() }, t('cancel')),
      h('button', {
        class: 'btn', onclick: () => {
          if (!w.by) { err.textContent = t('wz.initials_required'); return; }
          w.time = minutesAgoISO(w.offsetMin);
          showStep(w);
        },
      }, t('next')),
    ),
  ].filter(Boolean));
}

function control(step, value, onChange, patient) {
  if (step.options) return segmented(step.options, value, onChange, { big: true });
  if (step.numpad) return numpad(value, onChange, step.numpad);
  return stepper(value, onChange, { ...step.stepper, hint: step.hint ? step.hint(patient) : null });
}

function stepHeader(w, type) {
  return [
    h('h2', null, t(type)),
    w.correcting ? h('p', null, h('span', { class: 'chip due' }, t('wz.correcting', { time: fmtTime(w.time) }))) : null,
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
    if (required && blank(tv[step.key])) { err.textContent = t('wz.required'); return; }
    advance();
  };
  return h('div', { class: 'wizard-nav' },
    h('button', { class: 'btn secondary', onclick: back }, w.correcting && w.idx === 0 ? t('cancel') : t('back')),
    required ? null : h('button', { class: 'btn ghost', onclick: () => { delete tv[step.key]; advance(); } }, t('skip')),
    h('button', { class: 'btn', onclick: next }, last ? (w.correcting ? t('wz.save_correction') : t('finish')) : t('next')),
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
  if (w.correcting && !w.by) { showAgain(w, t('wz.initials_required'), 0); return; }
  if (w.correcting && !clean[w.list[0]]) {
    showAgain(w, t('wz.nothing_to_correct'));
    return;
  }
  if (!Object.keys(clean).length) { w.close(); toast(t('wz.nothing_recorded')); return; }
  w.saving = true;
  for (const b of w.body.querySelectorAll('button')) b.disabled = true;
  let done;
  try {
    done = w.correcting ? await saveCorrection(w, clean) : await saveEntry(w, clean);
  } catch (e) {
    w.saving = false;
    showAgain(w, t('wz.not_saved', { error: errorText(e) }));
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
  return { added: r.added, transitions: r.transitions, message: t('wz.saved') };
}

async function saveCorrection(w, clean) {
  const { patient, opts } = w;
  const r = await commit(patient, () => correctObservation(patient, opts.replaces, clean[w.list[0]], S.settings,
    { by: w.by, reason: opts.reason, time: w.time }));
  setBy(w.by);
  // r.transitions is the net stage change of the void and the re-entry together
  return { added: r.added, transitions: r.transitions, message: t('wz.corrected') };
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
  active: (proto) => t('wz.to_active', { cm: proto.activeStartCm }),
  second: () => t('wz.to_second'),
  second_reverted: () => t('wz.second_reverted'),
  active_reverted: () => t('wz.active_reverted'),
  active_moved: (proto, p) => t('wz.active_moved', { time: fmtTime(p.activeStartTime) }),
  second_moved: (proto, p) => t('wz.second_moved', { time: fmtTime(p.secondStageStart) }),
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

// from the least to the most escalated response
const ACK_ACTIONS = [
  { value: 'monitoring', label: () => t('wz.act_monitoring') },
  { value: 'senior', label: () => t('wz.act_senior') },
  { value: 'intervention', label: () => t('wz.act_intervention') },
  { value: 'referral', label: () => t('wz.act_referral'), alert: true },
];
const ACK_RANK = Object.fromEntries(ACK_ACTIONS.map((o, i) => [o.value, i]));

/** Acknowledgements an alert has had. Alerts saved before M5 kept no count: an earlier action counts as one. */
const acksOf = a => a.ackCount || (a.action ? 1 : 0);

/**
 * An alert waiting for acknowledgement again - asked again by a new entry
 * (reAlertedAt) or raised in severity (escalatedAt) after it was acknowledged:
 * {n, at, action}, n the repeat number (the acknowledgements it has had), at
 * and action those of the last one. null for an alert never acknowledged, or
 * acknowledged since it was asked again. Pure.
 */
export function ackRepeat(a) {
  if (!a || a.ack || !a.action || !(a.reAlertedAt || a.escalatedAt)) return null;
  return { n: acksOf(a), at: a.actionTime || null, action: a.action };
}

/**
 * The action the acknowledgement modal starts on: the earlier action of the
 * alerts asked again - the most escalated one when they differ, so the choice
 * offered never steps down from what was already done - else 'monitoring'.
 * An earlier action that is no longer offered is ignored. Pure.
 */
export function ackPreselect(alerts) {
  return (alerts || []).map(ackRepeat)
    .filter(r => r && own(ACK_RANK, r.action))
    .reduce((best, r) => (ACK_RANK[r.action] > ACK_RANK[best] ? r.action : best), 'monitoring');
}

function actionLabel(value) {
  const o = ACK_ACTIONS.find(x => x.value === value);
  return o ? say(o.label) : String(value);
}

/** "Repeat n - last acknowledged HH:MM: action" under an alert asked again; null otherwise. */
function repeatLine(a) {
  const r = ackRepeat(a);
  if (!r) return null;
  return h('p', { class: 'ack-repeat', style: 'margin:6px 0 0;font-weight:600' },
    t('wz.ack_repeat', { n: r.n, time: fmtTime(r.at), action: actionLabel(r.action) }));
}

/**
 * Mark the alerts acknowledged by `by` at `at` (counting the acknowledgement
 * in ackCount) and write the decision note. The note is tagged kind 'ack' (the
 * audit leaves acknowledgements out of the hourly assessment and plan); its
 * text is record data and stays English. Mutates p and does not save it:
 * showAlertAckModal persists it through commit().
 */
export function acknowledgeAlerts(p, alerts, action, by, at = new Date().toISOString()) {
  // matched by id as well: after a failed save the case holds restored copies
  const picked = a => alerts.some(x => x === a || (x.id != null && x.id === a.id));
  for (const a of (p.alerts || []).filter(picked)) {
    Object.assign(a, { ack: true, action, actionTime: at, ackBy: by, ackCount: acksOf(a) + 1 });
  }
  p.notes = [...(p.notes || []), {
    id: uid(), time: at, by, kind: 'ack', text: `Alerts acknowledged: ${alerts.map(a => a.title).join('; ')}`, plan: action,
  }];
}

export function showAlertAckModal(patient, alerts) {
  const real = (alerts || []).filter(a => a.severity !== 'info');
  if (!real.length) return;
  if (S.settings.sound) beep(real.some(a => a.severity === 'danger') ? 'danger' : 'due');

  let action = ackPreselect(real), by = getBy(), busy = false;
  const err = errorLine();
  const acknowledge = async () => {
    if (!by) { err.textContent = t('wz.initials_required'); return; }
    if (busy) return;
    busy = true;
    try {
      await commit(patient, () => acknowledgeAlerts(patient, real, action, by));
    } catch (e) {
      busy = false;
      err.textContent = t('wz.not_saved', { error: errorText(e) });
      return;
    }
    setBy(by);
    closeFn();
    if (action === 'referral') location.hash = `#/p/${patient.id}/referral`;
  };
  // alert titles and advice are shown as alerts.js wrote them (English)
  const body = h('div', null,
    h('h2', null, '⚠ ' + (real.length === 1 ? real[0].title : t('wz.n_alerts', { n: real.length }))),
    real.map(a => alertBanner(a, repeatLine(a))),
    h('h3', null, t('wz.ack_action')),
    segmented(inLang(ACK_ACTIONS), action, v => { action = v; }),
    byField(by, v => { by = v; err.textContent = ''; }),
    err,
    h('div', { class: 'wizard-nav' },
      h('button', { class: 'btn', onclick: acknowledge }, t('wz.ack_record')),
    ),
  );
  const closeFn = openModal(body, { locked: true });
}

// ----------------------------------------------------- medication modal ----

const MED_KINDS = [
  { value: 'medicine', label: () => t('wz.med_medicine') }, { value: 'ivfluid', label: () => t('wz.med_ivfluid') },
  { value: 'oxytocin', label: () => t('wz.med_oxytocin'), alert: true },
];

/** Append a medication entry; an oxytocin start, rate or stop keeps oxytocinRunning in step. Mutates p. */
function addMedication(p, entry) {
  p.meds = [...(p.meds || []), { id: uid(), time: new Date().toISOString(), ...entry }];
  if (entry.kind === 'oxytocin') p.oxytocinRunning = entry.action !== 'stop';
}

function oxytocinInputs(onUL, onDrops) {
  return h('div', { style: 'display:none' },
    h('p', { class: 'muted' }, '⚠ ' + t('wz.oxy_scope')),
    h('div', { class: 'grid2' },
      h('label', { class: 'field' }, h('span', null, t('wz.oxy_ul')), h('input', { type: 'number', oninput: e => onUL(+e.target.value || null) })),
      h('label', { class: 'field' }, h('span', null, t('wz.oxy_drops')), h('input', { type: 'number', oninput: e => onDrops(+e.target.value || null) })),
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
    if (!by) { err.textContent = t('wz.initials_required'); return; }
    if (busy) return;
    busy = true;
    try {
      await commit(patient, () => addMedication(patient, { ...entry, by }));
    } catch (e) {
      busy = false;
      err.textContent = t('wz.not_saved', { error: errorText(e) });
      return;
    }
    setBy(by);
    toast(message);
    closeFn();
  };
  const save = () => {
    const text = detail.trim();
    if (kind === 'medicine' && !text) { err.textContent = t('wz.med_need_detail'); return; }
    if (kind === 'oxytocin' && oxyDrops == null) { err.textContent = t('wz.med_need_rate'); return; }
    record(kind === 'oxytocin'
      ? { kind, detail: text, oxyUL, oxyDrops, action: patient.oxytocinRunning ? 'rate' : 'start' }
      : { kind, detail: text, action: 'given' }, t('wz.recorded'));
  };
  const oxySection = oxytocinInputs(v => { oxyUL = v; }, v => { oxyDrops = v; });
  const body = h('div', null,
    h('h2', null, t('wz.med_title')),
    segmented(inLang(MED_KINDS), kind, v => {
      kind = v; err.textContent = '';
      oxySection.style.display = v === 'oxytocin' ? '' : 'none';
    }, { big: true }),
    h('div', { style: 'margin-top:12px' }, h('label', { class: 'field' }, h('span', null, t('wz.med_details')),
      h('input', { type: 'text', placeholder: t('wz.med_placeholder'), oninput: e => { detail = e.target.value; } }))),
    oxySection,
    byField(by, v => { by = v; err.textContent = ''; }),
    err,
    h('div', { class: 'wizard-nav' },
      h('button', { class: 'btn secondary', onclick: () => closeFn() }, t('cancel')),
      h('button', { class: 'btn', onclick: save }, t('save')),
    ),
    // the stop entry's detail is record data and stays English (older entries are read by its text)
    patient.oxytocinRunning ? h('button', {
      class: 'btn ghost', style: 'margin-top:8px',
      onclick: () => record({ kind: 'oxytocin', detail: 'Oxytocin STOPPED', action: 'stop' }, t('wz.oxy_stopped')),
    }, '■ ' + t('wz.oxy_stop')) : null,
  );
  const closeFn = openModal(body);
}
