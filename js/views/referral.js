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

import { h, field, segmented, toast, fmtDT, fmtTime, byField, promptDialog } from '../ui.js';
import { S, savePatient, getBy, setBy } from '../store.js';
import { lastObs, exams, stageOf, isLabouring, inPostpartumWatch } from '../protocol.js';
import { recordEvent, applyReferral } from '../record.js';

const REASONS = [
  ['prolonged', 'Prolonged / obstructed labour'],
  ['distress', 'Fetal distress (FHR abnormality)'],
  ['malpresentation', 'Malpresentation / malposition'],
  ['aph', 'Antepartum haemorrhage'],
  ['preeclampsia', 'Severe pre-eclampsia / eclampsia'],
  ['prom', 'PROM / prolonged ROM'],
  ['preterm', 'Preterm labour'],
  ['prior_cs', 'Previous caesarean section'],
  ['second_stage', 'Prolonged second stage'],
  ['pph', 'Postpartum haemorrhage'],
  ['retained', 'Retained placenta / products'],
  ['sepsis', 'Fever / suspected sepsis'],
  ['other', 'Other'],
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

const CHECKLIST = [
  ['iv', 'IV line secured (16–18G)', () => true],
  ['fluids', 'IV fluids running (NS / Ringer’s)', () => true],
  ['mgso4', 'MgSO₄ loading dose given — 4 g IV (20%) over 5–20 min + 10 g IM (5 g each buttock + lidocaine)', rs => rs.has('preeclampsia')],
  ['antihtn', 'Antihypertensive given (if BP ≥ 160/110)', rs => rs.has('preeclampsia')],
  ['catheter', 'Urinary catheter inserted', rs => rs.has('preeclampsia')],
  ['abx', 'First-dose antibiotics given', rs => rs.has('sepsis') || rs.has('prom')],
  ['position', 'Left-lateral position for transport', () => true],
  ['resuskit', 'Newborn resuscitation kit in the ambulance', rs => rs.has('second_stage') || rs.has('distress')],
  ['called', 'Receiving hospital called (they expect her)', () => true],
  ['ambulance', 'Ambulance called / transport arranged', () => true],
  ['escort', 'Skilled escort accompanies the woman', () => true],
  ['family', 'Woman & family informed and consented', () => true],
];

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
      .map(([code, label]) => h('label', null,
        h('input', { type: 'checkbox', checked: !!checks[code], onchange: e => { checks[code] = e.target.checked; } }),
        label)));
  };
  renderChecklist();

  const root = h('div', { 'data-form': 'referral' },
    h('div', { class: 'card' },
      h('h2', null, '🏥 Start referral'),
      suggested.size ? h('p', { class: 'muted' }, '⚠ Reasons below were pre-selected from active alerts.') : null,
      h('h3', null, 'Reason(s) for referral'),
      h('div', { class: 'checklist' }, REASONS.map(([code, label]) => h('label', null,
        h('input', {
          type: 'checkbox', checked: selected.has(code),
          onchange: e => { e.target.checked ? selected.add(code) : selected.delete(code); renderChecklist(); },
        }),
        label,
      ))),
      h('label', { class: 'field', style: 'margin-top:8px' }, h('span', null, 'Other / details'),
        h('input', { type: 'text', oninput: e => { m.otherReason = e.target.value; } })),
    ),
    h('div', { class: 'card' },
      h('h2', null, 'Pre-referral bundle — complete before she leaves'),
      checklistWrap,
    ),
    h('div', { class: 'card' },
      h('h2', null, 'Destination'),
      h('div', { class: 'grid2' },
        field('Receiving facility', h('input', { type: 'text', placeholder: 'e.g. Primary Hospital', oninput: e => { m.facility = e.target.value; } })),
        field('Facility phone', h('input', { type: 'tel', oninput: e => { m.phone = e.target.value; } })),
      ),
      field('Transport', segmented([
        { value: 'ambulance', label: 'Ambulance' }, { value: 'private', label: 'Private vehicle' }, { value: 'other', label: 'Other' },
      ], m.transport, v => { m.transport = v; })),
    ),
    byField(getBy(), v => { by = v; }),
    h('button', { class: 'btn big danger', onclick: save }, '🚑 Confirm referral & generate note'),
  );

  async function save() {
    if (saving) return;
    if (!selected.size && !m.otherReason.trim()) { toast('Select at least one reason', 'danger'); return; }
    if (!by) { toast('Your initials are required', 'danger'); return; }
    const missing = CHECKLIST.filter(([code, , show]) => show(selected) && !checks[code]);
    if (missing.length) {
      // warn but never block — transport must not wait for paperwork
      toast(`Note: ${missing.length} pre-referral item(s) not ticked`, 'danger');
    }
    saving = true; // stays set once saved: the tab is redrawn as the referral note
    const referral = {
      time: new Date().toISOString(),
      reasons: [...selected].map(code => (REASONS.find(r => r[0] === code) || [code, code])[1]),
      otherReason: m.otherReason,
      checklist: CHECKLIST.filter(([, , show]) => show(selected)).map(([code, label]) => ({ code, label, done: !!checks[code] })),
      facility: m.facility, phone: m.phone, transport: m.transport,
      referredBy: S.settings.midwifeName || '',
      by,
    };
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
    toast('Referral recorded — note ready ✓');
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
    title: 'She has left the facility',
    message: 'Record that she has left with her escort? Monitoring on this device stops.',
    by: getBy(), okLabel: 'Record departure',
  });
  if (!res) return;
  try {
    await commit(p, () => recordEvent(p, 'handover', new Date().toISOString(), S.settings, { by: res.by }));
  } catch (e) {
    toast(errText(e), 'danger');
    return;
  }
  setBy(res.by);
  toast('Departure recorded');
  redraw(root, p);
}

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
    h('div', { class: 'card', id: 'referral-note' },
      h('h2', null, '🚑 Referral note'),
      kv('From', S.settings.facilityName || 'Health centre'),
      kv('To', `${r.facility || '—'}${r.phone ? ' · ' + r.phone : ''}`),
      kv('Time of referral', fmtDT(r.time)),
      kv('Transport', r.transport),
      r.handoverAt ? kv('Left the facility', fmtDT(r.handoverAt) + (r.handoverBy ? ' - ' + r.handoverBy : '')) : null,
      h('hr'),
      kv('Patient', `${p.name} · ${p.age || '?'} y · MRN ${p.mrn || '—'}`),
      kv('Obstetric', `G${p.gravida}P${p.para} · GA ${p.gaWeeks || '?'} wk`),
      kv('Risk factors', (p.riskFactors || []).join(', ') || 'None recorded'),
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
      h('ul', null, (p.meds || []).map(mm => h('li', null, `${fmtTime(mm.time)} — ${mm.kind}: ${mm.detail || ''}`)),
        (p.meds || []).length ? null : h('li', null, 'None recorded')),
      h('hr'),
      kv('Referred by', referrer(r) || '________________'),
      kv('Receiving feedback', '________________ (please return outcome to the health centre)'),
    ),
    waiting && (isLabouring(p) || inPostpartumWatch(p)) ? h('p', { class: 'muted no-print' },
      'Monitoring continues on the ward board until her departure is recorded.') : null,
    h('div', { class: 'no-print', style: 'display:flex;gap:8px;flex-wrap:wrap' },
      waiting ? h('button', { class: 'btn warn', onclick: () => recordDeparture(p, root) }, '🚑 She has left the facility') : null,
      h('button', { class: 'btn', onclick: () => window.print() }, '🖨 Print note'),
      h('button', {
        class: 'btn secondary', onclick: async () => {
          try {
            if (navigator.share) await navigator.share({ title: 'Referral note', text: noteText });
            else { await navigator.clipboard.writeText(noteText); toast('Note copied — paste into SMS/Telegram'); }
          } catch { /* user cancelled */ }
        },
      }, '📤 Share as text'),
    ),
  );
  return root;
}

function buildShareText(p) {
  const r = p.referral;
  const lastExam = exams(p).slice(-1)[0];
  const lastBaby = lastObs(p, 'baby');
  return [
    `REFERRAL ${fmtDT(r.time)} from ${S.settings.facilityName || 'health centre'}`,
    `${p.name}, ${p.age || '?'}y, G${p.gravida}P${p.para}, GA ${p.gaWeeks || '?'}wk`,
    `Reason: ${r.reasons.join('; ')}${r.otherReason ? '; ' + r.otherReason : ''}`,
    lastExam ? `Exam ${fmtTime(lastExam.time)}: ${lastExam.v.dilatation}cm, descent ${lastExam.v.descent ?? '—'}/5` : '',
    lastBaby ? `FHR ${lastBaby.v.fhr}bpm` : '',
    `Given: ${r.checklist.filter(c => c.done).map(c => c.code).join(', ') || 'see note'}`,
    `By: ${referrer(r) || '-'}, transport: ${r.transport}`,
  ].filter(Boolean).join('\n');
}

function kv(k, v) { return h('div', { class: 'kv' }, h('b', null, k), h('span', null, v)); }
