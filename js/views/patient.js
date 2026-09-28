// views/patient.js — single case view: chart, entries, alerts, summary,
// plus entry points to the record wizard, medication, emergencies,
// referral and delivery.

import { h, clear, openModal, segmented, toast, confirmDialog, fmtTime, fmtDT, durationSince, alertBanner } from '../ui.js';
import { t } from '../i18n.js';
import { S, savePatient, removePatient, uid } from '../store.js';
import { getProtocol, dueList, stageOf, isLabouring, fmtMin } from '../protocol.js';
import { EMERGENCIES, addAlerts } from '../alerts.js';
import { openRecordWizard, openMedicationModal, showAlertAckModal } from '../wizard.js';
import { renderChart } from '../chart.js';
import { renderReferralTab } from './referral.js';
import { renderDeliveryTab } from './delivery.js';
import { downloadFHIR } from '../fhir.js';

export function renderPatient(id, tab = 'chart') {
  const p = S.patients.find(x => x.id === id);
  if (!p) return h('div', { class: 'page' }, h('p', null, 'Case not found.'));
  const now = new Date();
  const proto = getProtocol(S.settings, p);
  const due = isLabouring(p) ? dueList(p, proto, now) : [];
  const unack = (p.alerts || []).filter(a => !a.ack && a.severity !== 'info');

  const page = h('div', { class: 'page' });

  // ---- header ----
  const timers = [];
  timers.push(h('span', { class: 'chip stage' }, t('stage_' + stageOf(p))));
  if (p.activeStartTime && isLabouring(p)) timers.push(h('span', { class: 'chip' }, 'Active: ' + durationSince(p.activeStartTime, now)));
  if (p.secondStageStart && stageOf(p) === 'second') timers.push(h('span', { class: 'chip stage' }, '2nd stage: ' + durationSince(p.secondStageStart, now)));
  if (p.romTime && isLabouring(p)) timers.push(h('span', { class: 'chip' }, 'ROM: ' + durationSince(p.romTime, now)));
  if (p.oxytocinRunning) timers.push(h('span', { class: 'chip due' }, '⚠ oxytocin running'));

  page.append(h('div', { class: 'card' },
    h('div', { class: 'row1', style: 'display:flex;gap:10px;align-items:baseline;flex-wrap:wrap' },
      h('span', { class: 'name', style: 'font-size:1.3rem;font-weight:800' }, p.name),
      h('span', { class: 'meta muted' }, `${p.age || '?'} y · G${p.gravida ?? '?'}P${p.para ?? '?'} · GA ${p.gaWeeks || '?'} wk · ${proto.name}`),
    ),
    h('div', { class: 'chips', style: 'margin-top:8px' }, timers),
    // due chips → tap to record
    isLabouring(p) ? h('div', { class: 'chips', style: 'margin-top:8px' },
      due.filter(d => d.state !== 'ok').map(d =>
        h('button', {
          class: 'chip ' + (d.state === 'overdue' ? 'overdue' : 'due'), style: 'border:none;cursor:pointer',
          onclick: () => openRecordWizard(p, [d.type]),
        }, `▶ ${t(d.type)} ${d.state === 'overdue' ? d.overdueMin + '′ ' + t('overdue') : t('due')}`),
      ),
      due.every(d => d.state === 'ok') ? h('span', { class: 'chip ok' }, '✓ ' + t('all_done')) : null,
    ) : null,
    // action row
    h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:12px' },
      isLabouring(p) ? h('button', { class: 'btn', onclick: () => pickAndRecord(p, due) }, '📝 ' + t('record_now')) : null,
      isLabouring(p) ? h('button', { class: 'btn secondary', onclick: () => openMedicationModal(p) }, '💊 Meds') : null,
      h('button', { class: 'btn danger', onclick: () => openEmergencyModal(p) }, '🚨 ' + t('emergency')),
      isLabouring(p) || stageOf(p) === 'third' ? h('button', { class: 'btn warn', onclick: () => { location.hash = `#/p/${p.id}/referral`; } }, '🏥 ' + t('referral')) : null,
      h('button', { class: 'btn secondary', onclick: () => { location.hash = `#/p/${p.id}/delivery`; } }, '👶 ' + t('delivery')),
    ),
  ));

  // unacknowledged alert strip
  if (unack.length) {
    page.append(h('div', { class: 'card', style: 'border:2px solid var(--c-danger)' },
      h('h2', null, `⚠ ${unack.length} unacknowledged alert${unack.length > 1 ? 's' : ''}`),
      unack.slice(0, 3).map(a => alertBanner(a)),
      h('button', { class: 'btn danger', onclick: () => showAlertAckModal(p, unack) }, 'Review & acknowledge'),
    ));
  }

  // ---- tabs ----
  const tabs = [
    ['chart', t('chart')], ['entries', t('entries')],
    ['alerts', `${t('alerts')} (${(p.alerts || []).length})`],
    ['summary', 'Summary'], ['referral', t('referral')], ['delivery', t('delivery')],
  ];
  page.append(h('div', { class: 'tabs' }, tabs.map(([key, label]) =>
    h('button', { class: key === tab ? 'active' : '', onclick: () => { location.hash = `#/p/${p.id}/${key}`; } }, label),
  )));

  const body = h('div');
  page.append(body);
  if (tab === 'chart') {
    body.append(renderChart(p, S.settings));
    body.append(h('p', { class: 'muted', style: 'margin-top:8px' },
      'The chart is drawn automatically from wizard entries. Scroll horizontally for the full timeline.'));
  } else if (tab === 'entries') body.append(entriesTab(p));
  else if (tab === 'alerts') body.append(alertsTab(p));
  else if (tab === 'summary') body.append(summaryTab(p));
  else if (tab === 'referral') body.append(renderReferralTab(p));
  else if (tab === 'delivery') body.append(renderDeliveryTab(p));

  return page;
}

// --------------------------------------------------------- record picker ---

function pickAndRecord(p, due) {
  const dueTypes = due.filter(d => d.state !== 'ok').map(d => d.type);
  const all = ['baby', 'contractions', 'pulse', 'vitals', 'exam', 'supportive'];
  if (p.oxytocinRunning) all.push('oxytocin');
  const selected = new Set(dueTypes.length ? dueTypes : all);

  const list = h('div', { class: 'checklist' }, all.map(type => {
    const cb = h('input', { type: 'checkbox', checked: selected.has(type), onchange: e => { e.target.checked ? selected.add(type) : selected.delete(type); } });
    const d = due.find(x => x.type === type);
    return h('label', null, cb, h('span', { style: 'flex:1' }, t(type)),
      d && d.state !== 'ok' ? h('span', { class: 'chip ' + (d.state === 'overdue' ? 'overdue' : 'due') }, d.state === 'overdue' ? `${d.overdueMin}′` : t('due')) : null);
  }));

  const close = openModal(h('div', null,
    h('h2', null, t('record_now')),
    h('p', { class: 'muted' }, 'Due observations are pre-selected. Add or remove as needed.'),
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

// ------------------------------------------------------------- entries -----

function obsSummary(o) {
  const v = o.v;
  switch (o.type) {
    case 'baby': return `FHR ${v.fhr ?? '—'} bpm${v.decel && v.decel !== 'none' ? ', decel: ' + v.decel : ''}${v.liquor ? ', fluid ' + v.liquor : ''}`;
    case 'contractions': return `${v.count ?? '—'}/10 min${v.durBand ? ', ' + { lt20: '<20 s', b20_40: '20–40 s', b40_60: '40–60 s', gt60: '>60 s' }[v.durBand] : ''}`;
    case 'pulse': return `${v.pulse} bpm`;
    case 'vitals': return [`BP ${v.sys ?? '—'}/${v.dia ?? '—'}`, v.temp != null ? v.temp + ' °C' : null, v.protein && v.protein !== 'nil' ? 'protein ' + v.protein : null, v.acetone && v.acetone !== 'nil' ? 'acetone ' + v.acetone : null].filter(Boolean).join(' · ');
    case 'exam': return [`${v.dilatation ?? '—'} cm`, v.descent != null ? v.descent + '/5' : null, v.position, v.caput ? 'caput ' + '+'.repeat(v.caput) : null, v.moulding ? 'moulding ' + '+'.repeat(v.moulding) : null, v.liquor ? 'fluid ' + v.liquor : null].filter(Boolean).join(' · ');
    case 'supportive': return [`companion ${v.companion}`, `pain relief ${v.painRelief}`, `fluids ${v.oralFluid}`, v.posture].join(' · ');
    case 'oxytocin': return `${v.uL != null ? v.uL + ' U/L' : ''} ${v.dropsMin != null ? '@ ' + v.dropsMin + ' drops/min' : ''}`;
    default: return JSON.stringify(v);
  }
}

function entriesTab(p) {
  const rows = (p.obs || []).slice().sort((a, b) => b.time.localeCompare(a.time));
  const medRows = (p.meds || []).slice().sort((a, b) => b.time.localeCompare(a.time));
  return h('div', { class: 'card' },
    h('h2', null, `${t('entries')} (${rows.length})`),
    h('table', { class: 'entries' },
      h('thead', null, h('tr', null, h('th', null, 'Time'), h('th', null, 'Type'), h('th', null, 'Values'))),
      h('tbody', null, rows.map(o => h('tr', null,
        h('td', null, fmtTime(o.time)),
        h('td', null, t(o.type)),
        h('td', { class: o.flags && o.flags.length ? 'flagged' : '' }, obsSummary(o)),
      ))),
    ),
    medRows.length ? [h('h3', null, 'Medication / fluids'), h('table', { class: 'entries' },
      h('tbody', null, medRows.map(m => h('tr', null,
        h('td', null, fmtTime(m.time)), h('td', null, m.kind),
        h('td', null, [m.detail, m.oxyUL ? m.oxyUL + ' U/L' : null, m.oxyDrops ? m.oxyDrops + ' drops/min' : null].filter(Boolean).join(' · ')),
      ))),
    )] : null,
  );
}

// -------------------------------------------------------------- alerts -----

function alertsTab(p) {
  const list = (p.alerts || []).slice().sort((a, b) => (a.ack === b.ack ? b.time.localeCompare(a.time) : a.ack ? 1 : -1));
  const wrap = h('div');
  if (!list.length) wrap.append(h('div', { class: 'empty-state' }, h('div', { class: 'ico' }, '✅'), h('p', null, 'No alerts so far.')));
  for (const a of list) {
    if (a.severity === 'info') {
      wrap.append(h('div', { class: 'card', style: 'padding:10px 14px' },
        h('span', { class: 'muted' }, `${fmtDT(a.time)} · ℹ ${a.title}`)));
      continue;
    }
    const actions = a.ack
      ? h('p', { class: 'muted', style: 'margin:6px 0 0' }, `✓ acknowledged ${fmtDT(a.actionTime)} — ${a.action || ''}`)
      : h('button', { class: 'btn secondary', style: 'margin-top:8px', onclick: () => showAlertAckModal(p, [a]) }, 'Acknowledge…');
    const banner = alertBanner(a, actions);
    wrap.append(h('div', { style: 'margin-bottom:4px' },
      h('p', { class: 'muted', style: 'margin:0 0 2px;font-size:.8rem' }, fmtDT(a.time)), banner));
  }
  return wrap;
}

// ----------------------------------------------------------- emergencies ---

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
    clear(body);
    body.append(
      h('h2', null, '🚨 ' + e.label),
      h('ul', { class: 'advice', style: 'font-size:1.05rem;line-height:1.5' }, e.advice.map(a => h('li', null, a))),
      h('div', { class: 'wizard-nav' },
        h('button', { class: 'btn secondary', onclick: () => menu() }, t('back')),
        h('button', {
          class: 'btn danger', onclick: async () => {
            addAlerts(p, [{ code: 'emg_' + e.code, severity: 'danger', title: 'EMERGENCY: ' + e.label, advice: e.advice }], 'manual');
            p.notes = p.notes || [];
            p.notes.push({ time: new Date().toISOString(), text: 'Emergency declared: ' + e.label, plan: 'emergency management + referral assessment' });
            await savePatient(p);
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

function summaryTab(p) {
  const a = p.admission || {};
  const noteText = h('textarea', { placeholder: 'Assessment / findings…' });
  const notePlan = h('textarea', { placeholder: 'Plan (shared with the woman)…' });

  return h('div', null,
    h('div', { class: 'card' },
      h('h2', null, 'Admission'),
      kv('Admitted', fmtDT(a.time)),
      kv('Labour onset', fmtDT(p.laborOnsetTime)),
      kv('Membranes / ROM', p.romTime ? 'Ruptured ' + fmtDT(p.romTime) : 'Intact at admission'),
      kv('Admission exam', `${a.dilatation ?? '—'} cm · descent ${a.descent ?? '—'}/5 · FHR ${a.fhr ?? '—'} · ${a.presentation || ''}`),
      kv('Risk factors', (p.riskFactors || []).join(', ') || 'None recorded'),
      kv('Contact', [p.phone, p.kebele].filter(Boolean).join(' · ') || '—'),
    ),
    h('div', { class: 'card' },
      h('h2', null, 'Notes — shared decision-making'),
      (p.notes || []).slice().reverse().map(n => h('div', { style: 'border-bottom:1px solid var(--c-line);padding:8px 0' },
        h('p', { class: 'muted', style: 'margin:0;font-size:.8rem' }, fmtDT(n.time)),
        h('p', { style: 'margin:2px 0' }, n.text),
        n.plan ? h('p', { class: 'muted', style: 'margin:0' }, 'Plan: ' + n.plan) : null,
      )),
      h('h3', null, 'Add note'),
      noteText, notePlan,
      h('button', {
        class: 'btn', style: 'margin-top:8px', onclick: async () => {
          if (!noteText.value.trim()) return;
          p.notes = p.notes || [];
          p.notes.push({ time: new Date().toISOString(), text: noteText.value.trim(), plan: notePlan.value.trim() });
          await savePatient(p);
          toast('Note saved ✓');
        },
      }, t('save')),
    ),
    h('div', { class: 'card no-print' },
      h('h2', null, 'Case actions'),
      h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
        h('button', { class: 'btn secondary', onclick: () => downloadFHIR(p, S.settings) }, '⇩ Export FHIR R4 (JSON)'),
        h('button', { class: 'btn secondary', onclick: () => window.print() }, '🖨 Print summary'),
        !isLabouring(p) && p.status !== 'closed' ? h('button', {
          class: 'btn secondary', onclick: async () => {
            if (await confirmDialog('Close this case? It moves out of the active list but stays in records/reports.')) {
              p.status = 'closed'; await savePatient(p); location.hash = '#/';
            }
          },
        }, 'Close case') : null,
        h('button', {
          class: 'btn ghost', style: 'color:var(--c-danger)', onclick: async () => {
            if (await confirmDialog('Delete this case permanently? This cannot be undone.', { okLabel: 'Delete', danger: true })) {
              await removePatient(p.id); location.hash = '#/';
            }
          },
        }, 'Delete case'),
      ),
    ),
  );
}

function kv(k, v) { return h('div', { class: 'kv' }, h('b', null, k), h('span', null, v)); }
