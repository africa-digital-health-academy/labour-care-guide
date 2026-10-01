// views/dashboard.js - multi-patient labour ward board.
// One midwife often covers several labouring women (especially at night);
// this board answers "who needs me right now?" at a glance. Women in the
// postpartum watch after birth (N4) have their own section with the same due
// chips. Alert badges count only alerts that are open AND unacknowledged.
// Every string shown goes through t() ('pt.' keys, js/i18n/patient.js). The
// public-preview notice (2.0.2, js/preview.js) opens the board: a card on
// first run, when the device holds no case; otherwise one dismissible line.

import { h } from '../ui.js';
import { t } from '../i18n.js';
import { S } from '../store.js';
import { previewNotice, previewNoticeMode, previewDismissed } from '../preview.js';
import {
  getProtocol, dueList, stageOf, isLabouring, awaitingHandover, monitoringStage, inPostpartumWatch, birthTime,
} from '../protocol.js';
import { seedDemoPatient } from '../demo.js';
import { sinceText, minText, metaLine } from './patient.js';

const RECENT_MS = 48 * 3600000; // "Recent" list window (display only)

export function renderDashboard() {
  const now = new Date();
  const labouring = S.patients.filter(isLabouring);
  const watch = S.patients.filter(p => !isLabouring(p) && inPostpartumWatch(p, now));
  const recent = S.patients.filter(p => !isLabouring(p) && !inPostpartumWatch(p, now)
    && (now - new Date(p.updatedAt || p.createdAt)) < RECENT_MS);

  const page = h('div', { class: 'page' },
    previewNotice(previewNoticeMode({ cases: S.patients.length, dismissed: previewDismissed() })));

  if (!labouring.length && !watch.length && !recent.length) {
    page.append(h('div', { class: 'empty-state' },
      h('div', { class: 'ico' }, '🤱'),
      h('p', null, t('pt.board_empty')),
      h('button', { class: 'btn big', onclick: () => { location.hash = '#/new'; } }, '＋ ' + t('new_admission')),
      h('button', { class: 'btn ghost', style: 'margin-top:10px', onclick: () => seedDemoPatient() }, t('pt.load_demo')),
    ));
    page.append(supportFooter());
    return page;
  }

  if (labouring.length) {
    page.append(h('h2', { style: 'margin:4px 0 10px' }, `${t('dashboard')} — ${t('pt.board_in_labour', { n: labouring.length })}`));
    for (const p of sortByUrgency(labouring, now)) page.append(patientCard(p, now));
  }
  if (watch.length) {
    page.append(h('section', { class: 'pp-watch' },
      h('h2', { style: `margin:${labouring.length ? 18 : 4}px 0 10px` }, `${t('postpartum_watch')} - ${watch.length}`),
      sortByUrgency(watch, now).map(p => patientCard(p, now)),
    ));
  }
  if (recent.length) {
    page.append(h('h2', { style: 'margin:18px 0 10px' }, t('pt.board_recent', { h: RECENT_MS / 3600000 })));
    for (const p of recent) page.append(patientCard(p, now));
  }
  page.append(supportFooter());
  page.append(h('button', { class: 'fab', title: t('new_admission'), onclick: () => { location.hash = '#/new'; } }, '＋'));
  return page;
}

// Hard-coded support / implementation contact, shown on the home (ward board).
// The name is the link, between the words before and after it.
function supportFooter() {
  return h('div', { class: 'support-note no-print' },
    h('span', null, `🤝 ${t('pt.support_before')} `),
    h('a', {
      href: 'https://www.linkedin.com/in/dr-temesgen-endalew/',
      target: '_blank', rel: 'noopener noreferrer',
    }, t('pt.support_name')),
    h('span', null, ` ${t('pt.support_after')}`),
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
  if (labouring && stage === 'active' && p.activeStartTime) {
    chips.push(h('span', { class: 'chip' }, '⏱ ' + t('pt.card_active', { d: sinceText(p.activeStartTime, now) })));
  }
  if (labouring && stage === 'second' && p.secondStageStart) {
    chips.push(h('span', { class: 'chip stage' }, '⏱ ' + t('pt.card_second', { d: sinceText(p.secondStageStart, now) })));
  }
  if (watch) chips.push(h('span', { class: 'chip pp' }, `${t('postpartum_watch')} - ${t('pt.since_birth', { d: sinceText(birthTime(p), now) })}`));
  if (unackDanger.length) chips.push(h('span', { class: 'chip overdue' }, `🚨 ${unackDanger.length} ${t('alert_act')}`));
  else if (unackWarn.length) chips.push(h('span', { class: 'chip due' }, `⚠ ${unackWarn.length} ${t('alert_review')}`));

  for (const d of due.slice(0, 3)) {
    if (d.state === 'overdue') chips.push(h('span', { class: 'chip overdue' }, `${t(d.type)} ${d.overdueMin}′ ${t('overdue')}`));
    else if (d.state === 'due') chips.push(h('span', { class: 'chip due' }, `${t(d.type)} ${t('due')}`));
  }
  if ((labouring || watch) && !due.some(d => d.state !== 'ok') && !unackDanger.length && !unackWarn.length) {
    const nextDue = due.length ? due.reduce((a, b) => (a.dueAt < b.dueAt ? a : b)) : null;
    const next = nextDue
      ? ' · ' + t('pt.card_next', { what: t(nextDue.type), d: minText(Math.max(0, (new Date(nextDue.dueAt) - now) / 60000)) })
      : '';
    chips.push(h('span', { class: 'chip ok' }, '✓ ' + t('all_done') + next));
  }

  return h('button', { class: ['pt-card', cls, watch ? 'pp-watch' : ''].filter(Boolean).join(' '), onclick: () => { location.hash = '#/p/' + p.id; } },
    h('div', { class: 'row1' },
      h('span', { class: 'name' }, p.name || t('pt.unnamed')),
      h('span', { class: 'meta' }, metaLine(p) + (p.mrn ? ' · ' + t('pt.mrn', { mrn: p.mrn }) : '')),
    ),
    h('div', { class: 'chips' }, chips),
  );
}
