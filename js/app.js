// app.js - boot, hash routing, top bar (clock + Ethiopian date), bottom nav,
// the heartbeat tick that re-checks schedules and time-based alerts for every
// labouring woman (the "who needs me now" engine behind the ward board), and
// the release plumbing: service-worker update chip, audio unlock, wake lock.

import './version.js';
import { h, clear, beep, toast, eatDate, APP_TZ, unlockAudio } from './ui.js';
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

// ------------------------------------------------------ update handling ----
// A new release is downloaded by the service worker in the background and then
// WAITS. We show a chip; the midwife reloads when it suits her.

let activateUpdate = null;   // set once a new worker is installed and waiting
let reloadRequested = false;

function setupUpdates(reg) {
  const watch = worker => {
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(reg);
    });
  };
  if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg);
  watch(reg.installing);
  reg.addEventListener('updatefound', () => watch(reg.installing));
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadRequested) location.reload();
  });
  // a ward board left open for days still learns about a release
  const check = () => reg.update().catch(() => {});
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  setInterval(check, 60 * 60 * 1000);
}

function offerUpdate(reg) {
  activateUpdate = () => {
    reloadRequested = true;
    if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    else location.reload();
  };
  render();
}

// -------------------------------------------------------------- render -----

function render() {
  const r = route();
  clear(app);

  const clockEl = h('div', { class: 'clock' });
  updateClock(clockEl);

  // tapping the logo or the title always returns to the ward board (home) -
  // the starting point where the clinician picks a woman or starts a new one.
  const goHome = () => { if (location.hash.replace(/^#\/?/, '')) location.hash = '#/'; else render(); };

  app.append(h('header', { class: 'topbar no-print' },
    r.view !== 'dashboard'
      ? h('button', { class: 'btn-back', title: t('back'), 'aria-label': t('back'), onclick: () => history.length > 1 ? history.back() : (location.hash = '#/') }, '‹')
      : null,
    h('button', { class: 'btn-home', title: t('dashboard'), 'aria-label': t('dashboard'), onclick: goHome }, '🤰'),
    h('h1', { class: 'brand-title', title: t('dashboard'), onclick: goHome }, titleFor(r)),
    activateUpdate
      ? h('button', { class: 'update-chip', title: 'A new version is ready. Tap to reload.', onclick: () => activateUpdate() }, 'Update ready')
      : null,
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

    // time-based clinical alerts (progress limits, 2nd-stage duration, ROM...)
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

// ------------------------------------------------------------ wake lock ----
// Keep the screen on while the app is in the foreground: a sleeping tablet
// beeps to nobody. Silently unsupported on older WebViews and on battery saver.

let wakeLock = null;
async function keepAwake() {
  try {
    if (!('wakeLock' in navigator) || wakeLock) return;
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch { /* not supported, not visible, or battery saver: the app still works */ }
}

// ---------------------------------------------------------------- boot -----

function bootError(err) {
  clear(app);
  app.append(h('div', { class: 'page' },
    h('div', { class: 'card' },
      h('h2', null, 'Could not open the local database'),
      h('p', null, String((err && err.message) || err)),
      h('p', { class: 'muted' }, 'Private browsing, a full disk, or an older browser can cause this. Labour records live only in this browser profile; nothing has been deleted.'),
      h('button', { class: 'btn', onclick: () => location.reload() }, 'Retry'),
    ),
  ));
}

async function boot() {
  // Ask the browser not to evict our data under storage pressure (best effort).
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch { /* ignore */ }
  // Alarms are only allowed after a user gesture: unlock on the first tap/key.
  document.addEventListener('pointerdown', unlockAudio, { once: true, passive: true });
  document.addEventListener('keydown', unlockAudio, { once: true });

  try {
    await initStore();
  } catch (err) {
    bootError(err);
    return;
  }
  render();
  window.addEventListener('hashchange', render);
  bus.addEventListener('change', render);
  setInterval(tick, 30000);

  keepAwake();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) keepAwake(); });

  // offline support + update chip
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(setupUpdates).catch(() => { /* file:// or unsupported: app still works online */ });
  }
}

boot();
