// views/reports.js — facility indicators (HMIS/DHIS2-aligned), CSV register
// export and data backup/restore. Auto-computing the monthly numbers kills
// the duplicate-reporting burden that field studies flag as the top
// complaint about digital tools.

import { h, toast, fmtDT } from '../ui.js';
import { S, exportBackup, importBackup, initStore, emit } from '../store.js';

export function renderReports() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const inMonth = p => new Date(p.createdAt) >= monthStart;

  const all = S.patients;
  const month = all.filter(inMonth);

  const stats = list => {
    const delivered = list.filter(p => p.delivery);
    const live = delivered.filter(p => p.delivery.outcome === 'live');
    const sb = delivered.filter(p => p.delivery.outcome !== 'live');
    const referred = list.filter(p => p.referral);
    const lowApgar = delivered.filter(p => p.newborn && p.newborn.apgar5 && p.newborn.apgar5.total < 7);
    const pph = delivered.filter(p => p.delivery.eblMl != null && p.delivery.eblMl >= 500);
    const monitored = list.filter(p => (p.obs || []).length >= 4);
    return { n: list.length, delivered: delivered.length, live: live.length, sb: sb.length, referred: referred.length, lowApgar: lowApgar.length, pph: pph.length, monitored: monitored.length };
  };

  const sm = stats(month), sa = stats(all);
  const row = (label, m, a) => h('tr', null, h('td', null, label), h('td', null, m), h('td', null, a));

  return h('div', { class: 'page' },
    h('div', { class: 'card' },
      h('h2', null, '📊 Facility indicators'),
      h('table', { class: 'entries' },
        h('thead', null, h('tr', null, h('th', null, 'Indicator'), h('th', null, 'This month'), h('th', null, 'All time'))),
        h('tbody', null,
          row('Admissions in labour', sm.n, sa.n),
          row('Births at facility', sm.delivered, sa.delivered),
          row('Live births', sm.live, sa.live),
          row('Stillbirths', sm.sb, sa.sb),
          row('APGAR < 7 at 5 min', sm.lowApgar, sa.lowApgar),
          row('PPH (EBL ≥ 500 ml)', sm.pph, sa.pph),
          row('Referred out in labour', sm.referred, sa.referred),
          row('Partograph monitored (≥4 entries)', sm.monitored, sa.monitored),
        ),
      ),
      h('p', { class: 'muted' }, 'These map to the monthly HMIS/DHIS2 delivery-care indicators — copy or export below.'),
    ),
    h('div', { class: 'card' },
      h('h2', null, 'Export'),
      h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
        h('button', { class: 'btn secondary', onclick: exportCSV }, '⇩ Birth register (CSV)'),
        h('button', { class: 'btn secondary', onclick: backup }, '⇩ Full backup (JSON)'),
        h('button', { class: 'btn secondary', onclick: restore }, '⇧ Restore backup'),
      ),
      h('p', { class: 'muted' },
        'Back up regularly — all data lives only on this device until a sync server is configured. Keep exported files confidential: they contain patient data.'),
    ),
  );
}

function exportCSV() {
  const head = ['admitted', 'name', 'age', 'mrn', 'gravida', 'para', 'ga_weeks', 'status', 'active_start', 'delivery_time', 'mode', 'outcome', 'sex', 'weight_g', 'apgar1', 'apgar5', 'ebl_ml', 'referred', 'referral_reasons', 'obs_count', 'alerts_danger'];
  const rows = S.patients.map(p => [
    p.admission ? p.admission.time : p.createdAt, p.name, p.age, p.mrn, p.gravida, p.para, p.gaWeeks,
    p.status, p.activeStartTime || '', p.delivery ? p.delivery.time : '',
    p.delivery ? p.delivery.mode : '', p.delivery ? p.delivery.outcome : '',
    p.newborn ? p.newborn.sex : '', p.newborn ? p.newborn.weightG : '',
    p.newborn && p.newborn.apgar1 ? p.newborn.apgar1.total : '',
    p.newborn && p.newborn.apgar5 ? p.newborn.apgar5.total : '',
    p.delivery ? p.delivery.eblMl : '',
    p.referral ? 'yes' : 'no', p.referral ? p.referral.reasons.join('; ') : '',
    (p.obs || []).length, (p.alerts || []).filter(a => a.severity === 'danger').length,
  ]);
  const csv = [head, ...rows].map(r => r.map(x => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  download(new Blob([csv], { type: 'text/csv' }), `parthograph-register-${new Date().toISOString().slice(0, 10)}.csv`);
}

async function backup() {
  const data = await exportBackup();
  download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    `parthograph-backup-${new Date().toISOString().slice(0, 10)}.json`);
  toast('Backup downloaded ✓');
}

function restore() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json';
  input.onchange = async () => {
    try {
      const text = await input.files[0].text();
      const n = await importBackup(JSON.parse(text));
      await initStore();
      emit();
      toast(`Restored ${n} case(s) ✓`);
    } catch (e) {
      toast('Restore failed: ' + e.message, 'danger');
    }
  };
  input.click();
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
