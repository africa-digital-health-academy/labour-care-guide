// views/dashboard.js - multi-patient labour ward board.
// One midwife often covers several labouring women (especially at night);
// this board answers "who needs me right now?" at a glance. Women in the
// postpartum watch after birth (N4) have their own section with the same due
// chips. Alert badges count only alerts that are open AND unacknowledged.

import { h, durationSince } from '../ui.js';
import { t } from '../i18n.js';
import { S } from '../store.js';
import {
  getProtocol, dueList, stageOf, isLabouring, awaitingHandover, monitoringStage, inPostpartumWatch, birthTime, fmtMin,
} from '../protocol.js';
import { seedDemoPatient } from '../demo.js';

const RECENT_MS = 48 * 3600000; // "Recent" list window (display only)

export function renderDashboard() {
  const now = new Date();
  const labouring = S.patients.filter(isLabouring);
  const watch = S.patients.filter(p => !isLabouring(p) && inPostpartumWatch(p, now));
  const recent = S.patients.filter(p => !isLabouring(p) && !inPostpartumWatch(p, now)
    && (now - new Date(p.updatedAt || p.createdAt)) < RECENT_MS);

  const page = h('div', { class: 'page' });

  if (!labouring.length && !watch.length && !recent.length) {
    page.append(h('div', { class: 'empty-state' },
      h('div', { class: 'ico' }, '🤱'),
      h('p', null, 'No women in labour are being monitored.'),
      h('button', { class: 'btn big', onclick: () => { location.hash = '#/new'; } }, '＋ ' + t('new_admission')),
      h('button', { class: 'btn ghost', style: 'margin-top:10px', onclick: () => seedDemoPatient() }, 'Load a demo case (for training/evaluation)'),
    ));
    page.append(supportFooter());
    return page;
  }

  if (labouring.length) {
    page.append(h('h2', { style: 'margin:4px 0 10px' }, `${t('dashboard')} — ${labouring.length} in labour`));
    for (const p of sortByUrgency(labouring, now)) page.append(patientCard(p, now));
  }
  if (watch.length) {
    page.append(h('section', { class: 'pp-watch' },
      h('h2', { style: `margin:${labouring.length ? 18 : 4}px 0 10px` }, `${t('postpartum_watch')} - ${watch.length}`),
      sortByUrgency(watch, now).map(p => patientCard(p, now)),
    ));
  }
  if (recent.length) {
    page.append(h('h2', { style: 'margin:18px 0 10px' }, 'Recent (48 h)'));
    for (const p of recent) page.append(patientCard(p, now));
  }
  page.append(supportFooter());
  page.append(h('button', { class: 'fab', title: t('new_admission'), onclick: () => { location.hash = '#/new'; } }, '＋'));
  return page;
}

// Hard-coded support / implementation contact, shown on the home (ward board).
function supportFooter() {
  return h('div', { class: 'support-note no-print' },
    h('span', null, '🤝 For support or implementation, reach out to '),
    h('a', {
      href: 'https://www.linkedin.com/in/dr-temesgen-endalew/',
      target: '_blank', rel: 'noopener noreferrer',
    }, 'Dr Temesgen Endalew'),
    h('span', null, ' (LinkedIn)'),
  );
}

/** Labour or postpartum watch: the women whose checks are scheduled. */
const watched = (p, now) => isLabouring(p) || inPostpartumWatch(p, now);

/** Alerts that still need someone: open (not resolved) and not acknowledged. */
const pendingAlerts = p => (p.alerts || []).filter(a => !a.ack && !a.resolved);

function urgencyScore(p, now) {
  if (!watched(p, now)) return -1;
  const danger = pendingAlerts(p).filter(a => a.severity === 'danger').length;
  const due = dueList(p, getProtocol(S.settings, p), now);
  const overdue = due.filter(d => d.state === 'overdue').reduce((s, d) => s + d.overdueMin, 0);
  return danger * 10000 + overdue * 10 + due.filter(d => d.state === 'due').length;
}

function sortByUrgency(list, now) {
  return list.slice().sort((a, b) => urgencyScore(b, now) - urgencyScore(a, now));
}

export function patientCard(p, now = new Date()) {
  const proto = getProtocol(S.settings, p);
  const labouring = isLabouring(p);
  const watch = !labouring && inPostpartumWatch(p, now);
  const stage = monitoringStage(p);
  const due = labouring || watch ? dueList(p, proto, now) : [];
  const pending = pendingAlerts(p);
  const unackDanger = pending.filter(a => a.severity === 'danger');
  const unackWarn = pending.filter(a => a.severity === 'warn');

  const cls = unackDanger.length || due.some(d => d.state === 'overdue') ? 'has-danger'
    : unackWarn.length || due.some(d => d.state === 'due') ? 'has-warn' : '';

  const chips = [];
  chips.push(h('span', { class: 'chip stage' }, t('stage_' + stageOf(p))));
  // S8: a referred woman still on the ward keeps her labour stage and clocks
  if (awaitingHandover(p)) chips.push(h('span', { class: 'chip stage' }, t('stage_' + stage)));
  if (labouring && stage === 'active' && p.activeStartTime) chips.push(h('span', { class: 'chip' }, '⏱ active ' + durationSince(p.activeStartTime, now)));
  if (labouring && stage === 'second' && p.secondStageStart) chips.push(h('span', { class: 'chip stage' }, '⏱ 2nd ' + durationSince(p.secondStageStart, now)));
  if (watch) chips.push(h('span', { class: 'chip pp' }, `${t('postpartum_watch')} - ${durationSince(birthTime(p), now)} since birth`));
  if (unackDanger.length) chips.push(h('span', { class: 'chip overdue' }, `🚨 ${unackDanger.length} ${t('alert_act')}`));
  else if (unackWarn.length) chips.push(h('span', { class: 'chip due' }, `⚠ ${unackWarn.length} ${t('alert_review')}`));

  for (const d of due.slice(0, 3)) {
    if (d.state === 'overdue') chips.push(h('span', { class: 'chip overdue' }, `${t(d.type)} ${d.overdueMin}′ ${t('overdue')}`));
    else if (d.state === 'due') chips.push(h('span', { class: 'chip due' }, `${t(d.type)} ${t('due')}`));
  }
  if ((labouring || watch) && !due.some(d => d.state !== 'ok') && !unackDanger.length && !unackWarn.length) {
    const nextDue = due.length ? due.reduce((a, b) => (a.dueAt < b.dueAt ? a : b)) : null;
    chips.push(h('span', { class: 'chip ok' }, '✓ ' + t('all_done') + (nextDue ? ` · next: ${t(nextDue.type)} ${fmtMin(Math.max(0, (new Date(nextDue.dueAt) - now) / 60000))}` : '')));
  }

  return h('button', { class: ['pt-card', cls, watch ? 'pp-watch' : ''].filter(Boolean).join(' '), onclick: () => { location.hash = '#/p/' + p.id; } },
    h('div', { class: 'row1' },
      h('span', { class: 'name' }, p.name || 'Unnamed'),
      h('span', { class: 'meta' }, `${p.age || '?'} y · G${p.gravida ?? '?'}P${p.para ?? '?'} · GA ${p.gaWeeks || '?'} wk${p.mrn ? ' · MRN ' + p.mrn : ''}`),
    ),
    h('div', { class: 'chips' }, chips),
  );
}
