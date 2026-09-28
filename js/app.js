// app.js — boot, hash routing, top bar (clock + Ethiopian date), bottom nav,
// and the heartbeat tick that re-checks schedules and time-based alerts for
// every labouring woman — the "who needs me now" engine behind the ward board.

import { h, clear, beep, toast, eatDate, APP_TZ } from './ui.js';
import { t } from './i18n.js';
import { S, initStore, bus, savePatient } from './store.js';
import { getProtocol, dueList, isLabouring } from './protocol.js';
import { evaluateTime, addAlerts } from './alerts.js';
import { formatEthiopic } from './ethiopic.js';
import { renderDashboard } from './views/dashboard.js';
import { renderAdmission } from './views/admission.js';
import { renderPatient } from './views/patient.js';
import { renderReports } from './views/reports.js';
import { renderSettings } from './views/settings.js';

const app = document.getElementById('app');

// ------------------------------------------------------------- routing -----

function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const parts = hash.split('/').filter(Boolean);
  if (parts[0] === 'new') return { view: 'new' };
  if (parts[0] === 'p' && parts[1]) return { view: 'patient', id: parts[1], tab: parts[2] || 'chart' };
  if (parts[0] === 'reports') return { view: 'reports' };
  if (parts[0] === 'settings') return { view: 'settings' };
  return { view: 'dashboard' };
}

function titleFor(r) {
  if (r.view === 'new') return t('new_admission');
  if (r.view === 'patient') {
    const p = S.patients.find(x => x.id === r.id);
    return p ? p.name : t('app_name');
  }
  if (r.view === 'reports') return t('reports');
  if (r.view === 'settings') return t('settings');
  return (S.settings.facilityName || t('app_name'));
}

function render() {
  const r = route();
  clear(app);

  const clockEl = h('div', { class: 'clock' });
  updateClock(clockEl);

  // tapping the logo or the title always returns to the ward board (home) —
  // the starting point where the clinician picks a woman or starts a new one.
  const goHome = () => { if (location.hash.replace(/^#\/?/, '')) location.hash = '#/'; else render(); };

  app.append(h('header', { class: 'topbar no-print' },
    r.view !== 'dashboard'
      ? h('button', { class: 'btn-back', title: t('back'), 'aria-label': t('back'), onclick: () => history.length > 1 ? history.back() : (location.hash = '#/') }, '‹')
      : null,
    h('button', { class: 'btn-home', title: t('dashboard'), 'aria-label': t('dashboard'), onclick: goHome }, '🤰'),
    h('h1', { class: 'brand-title', title: t('dashboard'), onclick: goHome }, titleFor(r)),
    clockEl,
  ));

  let page;
  if (r.view === 'new') page = renderAdmission();
  else if (r.view === 'patient') page = renderPatient(r.id, r.tab);
  else if (r.view === 'reports') page = renderReports();
  else if (r.view === 'settings') page = renderSettings();
  else page = renderDashboard();
  app.append(page);

  const navBtn = (ico, label, target, active) => h('button', {
    class: active ? 'active' : '', onclick: () => { location.hash = target; },
  }, h('span', { class: 'ico' }, ico), label);

  app.append(h('nav', { class: 'bottom-nav no-print' },
    navBtn('🤱', t('dashboard'), '#/', r.view === 'dashboard' || r.view === 'patient'),
    navBtn('➕', t('new_admission'), '#/new', r.view === 'new'),
    navBtn('📊', t('reports'), '#/reports', r.view === 'reports'),
    navBtn('⚙️', t('settings'), '#/settings', r.view === 'settings'),
  ));
}

function updateClock(el) {
  const now = new Date();
  el.innerHTML = '';
  el.append(
    now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: APP_TZ }),
    S.settings.ethiopianDates ? h('span', { class: 'ec' }, formatEthiopic(eatDate(now), S.settings.lang)) : '',
  );
}

// ------------------------------------------------------- heartbeat tick ----

// remember chip states so each transition only beeps once
const lastDueState = new Map(); // patientId:type -> state

async function tick() {
  const now = new Date();
  let dangerBeep = false, dueBeep = false, changed = false;

  for (const p of S.patients) {
    if (!isLabouring(p)) continue;
    const proto = getProtocol(S.settings, p);

    // time-based clinical alerts (progress limits, 2nd-stage duration, ROM…)
    const drafts = evaluateTime(p, S.settings, now);
    const added = addAlerts(p, drafts, 'time');
    if (added.length) {
      changed = true;
      if (added.some(a => a.severity === 'danger')) dangerBeep = true; else dueBeep = true;
      await savePatient(p);
      toast(`${p.name}: ${added[0].title}`, added.some(a => a.severity === 'danger') ? 'danger' : '');
    }

    // observation due/overdue transitions
    for (const d of dueList(p, proto, now)) {
      const key = p.id + ':' + d.type;
      const prev = lastDueState.get(key);
      if (d.state !== prev) {
        lastDueState.set(key, d.state);
        if (d.state === 'overdue' && prev !== undefined) dueBeep = true;
      }
    }
  }

  if (S.settings.sound && dangerBeep) beep('danger');
  else if (S.settings.sound && dueBeep) beep('due');

  // keep countdown chips fresh on time-sensitive screens
  const r = route();
  if (changed || r.view === 'dashboard' || r.view === 'patient') render();
}

// ---------------------------------------------------------------- boot -----

async function boot() {
  await initStore();
  render();
  window.addEventListener('hashchange', render);
  bus.addEventListener('change', render);
  setInterval(tick, 30000);

  // offline support
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* file:// or unsupported — app still works online */ });
  }
}

boot();
