// views/referral.js — referral decision support, pre-referral bundle and the
// referral note that travels with the woman.
//
// Why this module matters: Ethiopian referral-pathway studies show only ~14%
// of health-center referrals can be matched at the hospital, and only ~16% of
// severe pre-eclampsia referrals get MgSO4 before transport. The checklist
// makes the pre-referral bundle explicit, and the printable/shareable note
// gives the hospital the full labour picture.

import { h, field, segmented, toast, fmtDT, fmtTime } from '../ui.js';
import { t } from '../i18n.js';
import { S, savePatient } from '../store.js';
import { lastObs, exams } from '../protocol.js';

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

export function renderReferralTab(p) {
  if (p.referral) return referralNote(p);

  const suggested = new Set(
    (p.alerts || []).filter(a => !a.resolved && a.severity === 'danger')
      .map(a => ALERT_TO_REASON[a.code]).filter(Boolean),
  );
  const selected = new Set(suggested);
  const checks = {};
  const m = { facility: '', phone: '', transport: 'ambulance', otherReason: '' };

  const checklistWrap = h('div', { class: 'checklist' });
  const renderChecklist = () => {
    checklistWrap.replaceChildren(...CHECKLIST
      .filter(([, , show]) => show(selected))
      .map(([code, label]) => h('label', null,
        h('input', { type: 'checkbox', checked: !!checks[code], onchange: e => { checks[code] = e.target.checked; } }),
        label)));
  };
  renderChecklist();

  return h('div', null,
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
    h('button', { class: 'btn big danger', onclick: save }, '🚑 Confirm referral & generate note'),
  );

  async function save() {
    if (!selected.size && !m.otherReason) { toast('Select at least one reason', 'danger'); return; }
    const missing = CHECKLIST.filter(([code, , show]) => show(selected) && !checks[code]);
    if (missing.length) {
      // warn but never block — transport must not wait for paperwork
      toast(`Note: ${missing.length} pre-referral item(s) not ticked`, 'danger');
    }
    p.referral = {
      time: new Date().toISOString(),
      reasons: [...selected].map(code => (REASONS.find(r => r[0] === code) || [code, code])[1]),
      otherReason: m.otherReason,
      checklist: CHECKLIST.filter(([, , show]) => show(selected)).map(([code, label]) => ({ code, label, done: !!checks[code] })),
      facility: m.facility, phone: m.phone, transport: m.transport,
      referredBy: S.settings.midwifeName || '',
    };
    p.status = 'referred';
    p.notes = p.notes || [];
    p.notes.push({ time: p.referral.time, text: 'REFERRED to ' + (m.facility || 'hospital') + ': ' + p.referral.reasons.join(', '), plan: 'referral' });
    await savePatient(p);
    toast('Referral recorded — note ready ✓');
    location.hash = `#/p/${p.id}/referral`;
  }
}

// ------------------------------------------------------- printable note ----

function referralNote(p) {
  const r = p.referral;
  const lastExam = exams(p).slice(-1)[0];
  const lastBaby = lastObs(p, 'baby');
  const lastVitals = lastObs(p, 'vitals');
  const lastPulse = lastObs(p, 'pulse');
  const lastContr = lastObs(p, 'contractions');

  const noteText = buildShareText(p);

  return h('div', null,
    h('div', { class: 'card', id: 'referral-note' },
      h('h2', null, '🚑 Referral note'),
      kv('From', S.settings.facilityName || 'Health centre'),
      kv('To', `${r.facility || '—'}${r.phone ? ' · ' + r.phone : ''}`),
      kv('Time of referral', fmtDT(r.time)),
      kv('Transport', r.transport),
      h('hr'),
      kv('Patient', `${p.name} · ${p.age || '?'} y · MRN ${p.mrn || '—'}`),
      kv('Obstetric', `G${p.gravida}P${p.para} · GA ${p.gaWeeks || '?'} wk`),
      kv('Risk factors', (p.riskFactors || []).join(', ') || 'None recorded'),
      h('hr'),
      h('h3', null, 'Reason(s) for referral'),
      h('ul', null, r.reasons.map(x => h('li', null, x)), r.otherReason ? h('li', null, r.otherReason) : null),
      h('h3', null, 'Labour status at referral'),
      kv('Labour onset', fmtDT(p.laborOnsetTime)),
      kv('Membranes', p.romTime ? 'Ruptured ' + fmtDT(p.romTime) : 'Intact'),
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
      kv('Referred by', r.referredBy || '________________'),
      kv('Receiving feedback', '________________ (please return outcome to the health centre)'),
    ),
    h('div', { class: 'no-print', style: 'display:flex;gap:8px;flex-wrap:wrap' },
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
    `By: ${r.referredBy || ''} ${r.transport}`,
  ].filter(Boolean).join('\n');
}

function kv(k, v) { return h('div', { class: 'kv' }, h('b', null, k), h('span', null, v)); }
