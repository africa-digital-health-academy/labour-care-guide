// views/referral.js — referral decision support, pre-referral bundle and the
// referral note that travels with the woman.
//
// Why this module matters: Ethiopian referral-pathway studies show only ~14%
// of health-center referrals can be matched at the hospital, and only ~16% of
// severe pre-eclampsia referrals get MgSO4 before transport. The checklist
// makes the pre-referral bundle explicit, and the printable/shareable note
// gives the hospital the full labour picture.
//
// M3: the referral and her departure carry the initials of whoever records
// them (F3); she stays monitored until the departure is recorded (S8).
//
// M5: the form and the buttons go through t() ('fm.' keys in
// js/i18n/forms.js). Two things stay English whatever the screen language:
// - the referral record: its reasons and checklist labels are stored in
//   English (FHIR reasonCode, the CSV export and the case note read them);
// - the printed / shared referral note: it is a clinical document for the
//   receiving facility, where records are kept in English (and the hospital
//   may not read Amharic). It also quotes the alerts, which stay English.

import { h, field, segmented, toast, fmtDT, fmtTime, byField, promptDialog } from '../ui.js';
import { t, getLang } from '../i18n.js';
import { en as formsEN } from '../i18n/forms.js';
import { en as wizardEN } from '../i18n/wizard.js';
import { S, savePatient, getBy, setBy } from '../store.js';
import { LIMITS, lastObs, exams, stageOf, isLabouring, inPostpartumWatch } from '../protocol.js';
import { recordEvent, applyReferral } from '../record.js';
import { MGSO4_LOADING } from '../alerts.js';

// [code, i18n key]; the record stores the English text of the key
const REASONS = [
  ['prolonged', 'fm.reason.prolonged'],
  ['distress', 'fm.reason.distress'],
  ['malpresentation', 'fm.reason.malpresentation'],
  ['aph', 'fm.reason.aph'],
  ['preeclampsia', 'fm.reason.preeclampsia'],
  ['prom', 'fm.reason.prom'],
  ['preterm', 'fm.reason.preterm'],
  ['prior_cs', 'fm.reason.prior_cs'],
  ['second_stage', 'fm.reason.second_stage'],
  ['pph', 'fm.reason.pph'],
  ['retained', 'fm.reason.retained'],
  ['sepsis', 'fm.reason.sepsis'],
  ['other', 'fm.reason.other'],
];

// map alert codes → suggested referral reasons
const ALERT_TO_REASON = {
  action_line: 'prolonged', lcg_progress: 'prolonged', active_long: 'prolonged', moulding3: 'prolonged',
  fhr_severe: 'distress', decel: 'distress', liquor_thick_mec: 'distress',
  malpresentation: 'malpresentation', malposition: 'malpresentation',
  liquor_blood: 'aph', emg_aph: 'aph',
  htn_severe: 'preeclampsia', emg_eclampsia: 'preeclampsia',
  prom_long: 'prom', fever: 'sepsis', second_long: 'second_stage',
  pph: 'pph', emg_pph: 'pph', retained_products: 'retained',
  admission_risk: 'prior_cs', emg_cord_prolapse: 'distress', emg_rupture: 'aph',
};

// Values for the checklist texts' {placeholders}: the MgSO4 dose (English in
// every language, one source in alerts.js) and the severe-range BP from LIMITS.
const CHECK_VARS = { dose: MGSO4_LOADING, sys: LIMITS.sys.severe, dia: LIMITS.dia.severe };

// [code, i18n key, applies to the selected reasons]
const CHECKLIST = [
  ['iv', 'fm.chk.iv', () => true],
  ['fluids', 'fm.chk.fluids', () => true],
  ['mgso4', 'fm.chk.mgso4', rs => rs.has('preeclampsia')],
  ['antihtn', 'fm.chk.antihtn', rs => rs.has('preeclampsia')],
  ['catheter', 'fm.chk.catheter', rs => rs.has('preeclampsia')],
  ['abx', 'fm.chk.abx', rs => rs.has('sepsis') || rs.has('prom')],
  ['position', 'fm.chk.position', () => true],
  ['resuskit', 'fm.chk.resuskit', rs => rs.has('second_stage') || rs.has('distress')],
  ['called', 'fm.chk.called', () => true],
  ['ambulance', 'fm.chk.ambulance', () => true],
  ['escort', 'fm.chk.escort', () => true],
  ['family', 'fm.chk.family', () => true],
];

/** The English text of an fm. key with its {placeholders} filled: what the record stores. */
function english(key, vars = {}) {
  let s = formsEN[key] || key;
  for (const k of Object.keys(vars)) s = s.replace('{' + k + '}', () => String(vars[k]));
  return s;
}

const errText = e => (e && e.message) || String(e);

// The note is read at the receiving hospital: stored codes are written as
// their English labels, never as "prior_cs" or "private".
const TRANSPORT_KEY = { ambulance: 'fm.ref.ambulance', private: 'fm.ref.private', other: 'fm.other' };
export const transportText = code => (TRANSPORT_KEY[code] && formsEN[TRANSPORT_KEY[code]]) || code || '—';
export const riskText = codes => (codes || []).map(c => formsEN['fm.risk.' + c] || c).join(', ');
// a medication entry voided as recorded in error was never given
export const givenMeds = p => (p.meds || []).filter(m => m && !m.voided);

/** One medication line of the note, in English: the kind in words, and an oxytocin rate when recorded. */
export function medLine(m) {
  const label = wizardEN['wz.med_' + m.kind] || m.kind || wizardEN['wz.med_medicine'];
  const parts = [];
  if (m.detail) parts.push(String(m.detail));
  if (m.kind === 'oxytocin' && m.action !== 'stop') {
    const rate = [m.oxyUL != null ? `${m.oxyUL} U/L` : '', m.oxyDrops != null ? `${m.oxyDrops} drops/min` : ''].filter(Boolean).join(', ');
    if (rate) parts.push(rate);
  }
  return `${label}: ${parts.join(' - ') || '-'}`;
}

/**
 * The referral record built from the form. form: { selected (Set of reason
 * codes), checks ({ code: true }), otherReason, facility, phone, transport }.
 * Reasons and checklist labels are ENGLISH whatever the screen language: the
 * FHIR export, the CSV export, the case note and the receiving hospital read
 * them. No DOM: exported for the tests.
 */
export function referralRecord(form, { by, referredBy = '', time = new Date().toISOString() }) {
  const { selected, checks } = form;
  return {
    time,
    reasons: [...selected].map(code => {
      const r = REASONS.find(x => x[0] === code);
      return r ? english(r[1]) : code;
    }),
    otherReason: form.otherReason,
    checklist: CHECKLIST.filter(([, , show]) => show(selected))
      .map(([code, key]) => ({ code, label: english(key, CHECK_VARS), done: !!checks[code] })),
    facility: form.facility, phone: form.phone, transport: form.transport,
    referredBy,
    by,
  };
}

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

/**
 * Every save marks the form saved, so the app redraws the page from the
 * case. If the view was kept anyway, redraw the tab in place.
 */
function redraw(root, p) {
  if (root.isConnected) root.replaceWith(renderReferralTab(p));
}

export function renderReferralTab(p) {
  if (p.referral) return referralNote(p);

  const suggested = new Set(
    (p.alerts || []).filter(a => !a.resolved && a.severity === 'danger')
      .map(a => ALERT_TO_REASON[a.code]).filter(Boolean),
  );
  const selected = new Set(suggested);
  const checks = {};
  const m = { facility: '', phone: '', transport: 'ambulance', otherReason: '' };
  let by = '';
  let saving = false;

  const checklistWrap = h('div', { class: 'checklist' });
  const renderChecklist = () => {
    checklistWrap.replaceChildren(...CHECKLIST
      .filter(([, , show]) => show(selected))
      .map(([code, key]) => h('label', null,
        h('input', { type: 'checkbox', checked: !!checks[code], onchange: e => { checks[code] = e.target.checked; } }),
        t(key, CHECK_VARS))));
  };
  renderChecklist();

  const root = h('div', { 'data-form': 'referral' },
    h('div', { class: 'card' },
      h('h2', null, '🏥 ' + t('fm.ref.start')),
      suggested.size ? h('p', { class: 'muted' }, '⚠ ' + t('fm.ref.preselected')) : null,
      h('h3', null, t('fm.ref.reasons')),
      h('div', { class: 'checklist' }, REASONS.map(([code, key]) => h('label', null,
        h('input', {
          type: 'checkbox', checked: selected.has(code),
          onchange: e => { e.target.checked ? selected.add(code) : selected.delete(code); renderChecklist(); },
        }),
        t(key),
      ))),
      h('label', { class: 'field', style: 'margin-top:8px' }, h('span', null, t('fm.ref.otherDetails')),
        h('input', { type: 'text', oninput: e => { m.otherReason = e.target.value; } })),
    ),
    h('div', { class: 'card' },
      h('h2', null, t('fm.ref.bundle')),
      checklistWrap,
    ),
    h('div', { class: 'card' },
      h('h2', null, t('fm.ref.destination')),
      h('div', { class: 'grid2' },
        field(t('fm.ref.facility'), h('input', { type: 'text', placeholder: t('fm.ref.facilityPlaceholder'), oninput: e => { m.facility = e.target.value; } })),
        field(t('fm.ref.facilityPhone'), h('input', { type: 'tel', oninput: e => { m.phone = e.target.value; } })),
      ),
      field(t('fm.ref.transport'), segmented([
        { value: 'ambulance', label: t('fm.ref.ambulance') }, { value: 'private', label: t('fm.ref.private') }, { value: 'other', label: t('fm.other') },
      ], m.transport, v => { m.transport = v; })),
    ),
    byField(getBy(), v => { by = v; }),
    h('button', { class: 'btn big danger', onclick: save }, '🚑 ' + t('fm.ref.confirm')),
  );

  async function save() {
    if (saving) return;
    if (!selected.size && !m.otherReason.trim()) { toast(t('fm.ref.needReason'), 'danger'); return; }
    if (!by) { toast(t('fm.needInitials'), 'danger'); return; }
    const missing = CHECKLIST.filter(([code, , show]) => show(selected) && !checks[code]);
    if (missing.length) {
      // warn but never block — transport must not wait for paperwork
      toast(t('fm.ref.missing', { n: missing.length }), 'danger');
    }
    saving = true; // stays set once saved: the tab is redrawn as the referral note
    const referral = referralRecord({ ...m, selected, checks }, { by, referredBy: S.settings.midwifeName || '' });
    try {
      root.dataset.saved = '1';
      // the record layer marks her "not yet left", so monitoring continues (S8)
      await commit(p, () => applyReferral(p, referral, { by }));
    } catch (e) {
      saving = false;
      delete root.dataset.saved;
      toast(errText(e), 'danger');
      return;
    }
    setBy(by);
    toast(t('fm.ref.saved'));
    redraw(root, p);
  }

  return root;
}

// ------------------------------------------------------- printable note ----

/** Referring provider for the note: the Settings name and the recorder's initials. */
function referrer(r) {
  return [r.referredBy, r.by ? `(${r.by})` : null].filter(Boolean).join(' ');
}

/**
 * S8: departure closes monitoring on this device. A woman referred after
 * the birth leaves too, so this does not depend on labour still running.
 */
async function recordDeparture(p, root) {
  const res = await promptDialog({
    title: t('fm.ref.left'),
    message: t('fm.ref.leftMsg'),
    by: getBy(), okLabel: t('fm.ref.recordDeparture'),
  });
  if (!res) return;
  try {
    await commit(p, () => recordEvent(p, 'handover', new Date().toISOString(), S.settings, { by: res.by }));
  } catch (e) {
    toast(errText(e), 'danger');
    return;
  }
  setBy(res.by);
  toast(t('fm.ref.departed'));
  redraw(root, p);
}

// The note card and the shared text are English on purpose (see the top of
// this file); only the controls around them follow the screen language.
function referralNote(p) {
  const r = p.referral;
  const lastExam = exams(p).slice(-1)[0];
  const lastBaby = lastObs(p, 'baby');
  const lastVitals = lastObs(p, 'vitals');
  const lastPulse = lastObs(p, 'pulse');
  const lastContr = lastObs(p, 'contractions');
  const waiting = !r.handoverAt && stageOf(p) !== 'closed';

  const noteText = buildShareText(p);

  const root = h('div', null,
    getLang() !== 'en' ? h('p', { class: 'muted no-print' }, t('fm.ref.noteInEnglish')) : null,
    h('div', { class: 'card', id: 'referral-note' },
      h('h2', null, '🚑 Referral note'),
      kv('From', S.settings.facilityName || 'Health centre'),
      kv('To', `${r.facility || '—'}${r.phone ? ' · ' + r.phone : ''}`),
      kv('Time of referral', fmtDT(r.time)),
      kv('Transport', transportText(r.transport)),
      r.handoverAt ? kv('Left the facility', fmtDT(r.handoverAt) + (r.handoverBy ? ' - ' + r.handoverBy : '')) : null,
      h('hr'),
      kv('Patient', `${p.name} · ${p.age || '?'} y · MRN ${p.mrn || '—'}`),
      kv('Obstetric', `G${p.gravida}P${p.para} · GA ${p.gaWeeks || '?'} wk`),
      kv('Risk factors', riskText(p.riskFactors) || 'None recorded'),
      h('hr'),
      h('h3', null, 'Reason(s) for referral'),
      h('ul', null, r.reasons.map(x => h('li', null, x)), r.otherReason ? h('li', null, r.otherReason) : null),
      h('h3', null, 'Labour status at referral'),
      kv('Labour onset', fmtDT(p.laborOnsetTime)),
      kv('Membranes', p.romTime ? 'Ruptured ' + fmtDT(p.romTime) : p.romUnknown ? 'Ruptured, time unknown' : 'Intact'),
      lastExam ? kv('Last exam ' + fmtTime(lastExam.time), `${lastExam.v.dilatation} cm · descent ${lastExam.v.descent ?? '—'}/5 · moulding ${lastExam.v.moulding ?? 0} · ${lastExam.v.liquor || ''}`) : null,
      lastBaby ? kv('Last FHR ' + fmtTime(lastBaby.time), `${lastBaby.v.fhr} bpm${lastBaby.v.decel && lastBaby.v.decel !== 'none' ? ' · decel ' + lastBaby.v.decel : ''}`) : null,
      lastContr ? kv('Contractions', `${lastContr.v.count}/10 min`) : null,
      lastVitals ? kv('BP / Temp', `${lastVitals.v.sys}/${lastVitals.v.dia}${lastVitals.v.temp != null ? ' · ' + lastVitals.v.temp + ' °C' : ''}`) : null,
      lastPulse ? kv('Pulse', lastPulse.v.pulse + ' bpm') : null,
      h('h3', null, 'Active alerts'),
      h('ul', null, (p.alerts || []).filter(a => a.severity === 'danger' && !a.resolved).map(a => h('li', null, `${fmtTime(a.time)} — ${a.title}`))),
      h('h3', null, 'Pre-referral treatment given'),
      h('ul', null, r.checklist.map(c => h('li', null, (c.done ? '☑ ' : '☐ NOT DONE — ') + c.label))),
      h('h3', null, 'Medication in labour'),
      // with the date: a labour crosses midnight, a time alone is ambiguous
      h('ul', null, givenMeds(p).map(mm => h('li', null, `${fmtDT(mm.time)} — ${medLine(mm)}`)),
        givenMeds(p).length ? null : h('li', null, 'None recorded')),
      h('hr'),
      kv('Referred by', referrer(r) || '________________'),
      kv('Receiving feedback', '________________ (please return outcome to the health centre)'),
    ),
    waiting && (isLabouring(p) || inPostpartumWatch(p)) ? h('p', { class: 'muted no-print' }, t('fm.ref.monitoring')) : null,
    h('div', { class: 'no-print', style: 'display:flex;gap:8px;flex-wrap:wrap' },
      waiting ? h('button', { class: 'btn warn', onclick: () => recordDeparture(p, root) }, '🚑 ' + t('fm.ref.left')) : null,
      h('button', { class: 'btn', onclick: () => window.print() }, '🖨 ' + t('fm.ref.print')),
      h('button', {
        class: 'btn secondary', onclick: async () => {
          try {
            if (navigator.share) await navigator.share({ title: 'Referral note', text: noteText });
            else { await navigator.clipboard.writeText(noteText); toast(t('fm.ref.copied')); }
          } catch { /* user cancelled */ }
        },
      }, '📤 ' + t('fm.ref.share')),
    ),
  );
  return root;
}

export function buildShareText(p, settings = S.settings) {
  const r = p.referral;
  const lastExam = exams(p).slice(-1)[0];
  const lastBaby = lastObs(p, 'baby');
  return [
    `REFERRAL ${fmtDT(r.time)} from ${(settings && settings.facilityName) || 'health centre'}`,
    `${p.name}, ${p.age || '?'}y, G${p.gravida}P${p.para}, GA ${p.gaWeeks || '?'}wk`,
    `Risk factors: ${riskText(p.riskFactors) || 'none recorded'}`,
    `Reason: ${r.reasons.join('; ')}${r.otherReason ? '; ' + r.otherReason : ''}`,
    lastExam ? `Exam ${fmtTime(lastExam.time)}: ${lastExam.v.dilatation}cm, descent ${lastExam.v.descent ?? '—'}/5` : '',
    lastBaby ? `FHR ${lastBaby.v.fhr}bpm` : '',
    `Given / done: ${r.checklist.filter(c => c.done).map(c => c.label || c.code).join('; ') || 'see note'}`,
    medsShareLine(p),
    `By: ${referrer(r) || '-'}, transport: ${transportText(r.transport)}`,
  ].filter(Boolean).join('\n');
}

/**
 * The medication in labour for the shared text, latest last, with the date,
 * and whether oxytocin is still running: the receiving team must know.
 */
export function medsShareLine(p) {
  const meds = givenMeds(p).slice().sort((a, b) => String(a.time).localeCompare(String(b.time)));
  if (!meds.length) return 'Medication in labour: none recorded';
  const items = meds.map(m => `${fmtDT(m.time)} ${medLine(m)}`).join('; ');
  return `Medication in labour: ${items}${p.oxytocinRunning ? ' - OXYTOCIN STILL RUNNING' : ''}`;
}

function kv(k, v) { return h('div', { class: 'kv' }, h('b', null, k), h('span', null, v)); }
