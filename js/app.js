// app.js - boot, hash routing, top bar (clock + Ethiopian date), bottom nav,
// the heartbeat tick that re-checks schedules and time-based alerts for every
// labouring woman and every mother in postpartum watch (the "who needs me
// now" engine behind the ward board), render safety (S3: a data change never
// wipes a form in progress), and the release plumbing: service-worker update
// chip, audio unlock, wake lock. Screen text goes through t() (keys 'rp.*' in
// js/i18n/reports.js); alert titles stay English (see i18n/reports.js).

import './version.js';
import { h, clear, beep, toast, openModal, eatDate, APP_TZ, unlockAudio } from './ui.js';
import { t, getLang } from './i18n.js';
import { S, initStore, bus, savePatient, patientById } from './store.js';
import { getProtocol, dueList, isLabouring, inPostpartumWatch } from './protocol.js';
import { refreshTimeAlerts } from './alerts.js';
import { renderChart } from './chart.js';
import { formatEthiopic } from './ethiopic.js';
import { renderDashboard } from './views/dashboard.js';
import { renderAdmission } from './views/admission.js';
import { renderPatient, patientHeader, alertStrip } from './views/patient.js';
import { renderReports } from './views/reports.js';
import { renderSettings, amharicDraftNotice } from './views/settings.js';

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
  render('data');
}

function updateChip() {
  return h('button', { class: 'update-chip', title: t('rp.update_ready_title'), onclick: () => activateUpdate() }, t('rp.update_ready'));
}

// -------------------------------------------------------- Amharic draft ----
// While the UI is in Amharic, a small marker sits in the top bar on every
// screen: the Amharic text is an unreviewed draft and alerts stay in English.
// A tap opens the full notice in a dialog; it never navigates, so a form in
// progress is kept. Inline style: the marker needs no stylesheet change.

const DRAFT_CHIP_STYLE = 'flex:none;background:var(--c-warn-bg);color:var(--c-ink);border:0;'
  + 'border-radius:999px;padding:4px 10px;font-weight:700;font-size:.8rem;min-height:32px;cursor:pointer';

function draftChip() {
  if (getLang() !== 'am') return null;
  return h('button', {
    type: 'button', class: 'draft-chip', style: DRAFT_CHIP_STYLE,
    title: amharicDraftNotice().join(' '), 'aria-haspopup': 'dialog', onclick: showDraftNotice,
  }, t('rp.am_draft_chip'));
}

function showDraftNotice() {
  const close = openModal(h('div', null,
    h('h2', null, t('rp.am_draft_title')),
    amharicDraftNotice().map(line => h('p', null, line)),
    h('div', { class: 'wizard-nav' },
      h('button', { type: 'button', class: 'btn', onclick: () => close() }, t('rp.close'))),
  ));
}

// -------------------------------------------------------------- render -----
// Render safety (S3). A full render rebuilds the whole page, and every form on
// it. Navigation ('navigate') always rebuilds. A data change ('data': any
// savePatient - the tick's, another woman's - or a release notice) rebuilds
// only when no form is in progress; otherwise refreshLive() swaps just the
// live parts. A form in progress is an element carrying data-form without
// data-saved; its save handler sets data-saved just before savePatient, so
// the save that completes a form does rebuild the page.

const OPEN_FORM = '[data-form]:not([data-saved])';
let shown = null; // the route the page on screen was built for

function formInProgress(root = app) {
  return !!root.querySelector(OPEN_FORM);
}

function render(reason = 'navigate') {
  if (reason !== 'navigate' && formInProgress()) {
    refreshLive();
    return;
  }
  const r = route();
  shown = r;
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
    draftChip(),
    activateUpdate ? updateChip() : null,
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

// --------------------------------------------------------- live parts ------

/**
 * Refresh what time and data change without touching anything typed: the
 * clock and the update chip everywhere; on a case view the header, the alert
 * strip and, on the chart tab, the chart. The ward board holds no forms, so
 * it is simply rebuilt. Other views: clock only.
 */
function refreshLive() {
  const r = shown || route();
  if (r.view === 'dashboard' && !formInProgress()) {
    render('navigate');
    return;
  }
  refreshTopbar();
  if (r.view !== 'patient') return;
  const p = patientById(r.id);
  if (!p) return;
  const now = new Date();
  swapLive('patient-header', () => patientHeader(p, now));
  swapLive('alert-strip', () => alertStrip(p));
  refreshChart(p);
}

function refreshTopbar() {
  const bar = app.querySelector('.topbar');
  if (!bar) return;
  const clock = bar.querySelector('.clock');
  if (clock) updateClock(clock);
  const chip = bar.querySelector('.update-chip');
  if (activateUpdate && !chip) bar.insertBefore(updateChip(), clock);
}

/** A live region must never hold, or sit inside, a form in progress. */
function touchesForm(el) {
  return !!el.closest(OPEN_FORM) || formInProgress(el);
}

/** Replace one [data-live] region with a fresh build; identical markup is left alone. */
function swapLive(name, build) {
  const old = app.querySelector(`[data-live="${name}"]`);
  if (!old || touchesForm(old)) return;
  const fresh = build() || h('div');
  if (!fresh.dataset.live) fresh.dataset.live = name; // keep it findable next time
  if (fresh.outerHTML !== old.outerHTML) old.replaceWith(fresh);
}

/**
 * Fresh chart inside the [data-live="chart"] wrapper the case view built
 * (present only on the chart tab). Only the renderChart() output is replaced,
 * so the wrapper and anything else the view put in it stay as built. A
 * midwife reviewing earlier hours keeps her scroll position; one at the
 * newest data follows it (renderChart scrolls to the end).
 */
function refreshChart(p) {
  const wrap = app.querySelector('[data-live="chart"]');
  if (!wrap || touchesForm(wrap)) return;
  const old = wrap.matches('.chart-scroll') ? wrap : wrap.querySelector('.chart-scroll');
  const fresh = renderChart(p, S.settings);
  if (!old) {
    wrap.replaceChildren(fresh);
    return;
  }
  if (old === wrap) fresh.dataset.live = 'chart';
  if (fresh.outerHTML === old.outerHTML) return;
  const atNewest = old.scrollLeft + old.clientWidth >= old.scrollWidth - 4;
  const left = old.scrollLeft;
  old.replaceWith(fresh);
  if (!atNewest) requestAnimationFrame(() => { fresh.scrollLeft = left; });
}

// ------------------------------------------------------- heartbeat tick ----

// remember chip states so each transition only beeps once
const lastDueState = new Map(); // patientId:type -> state
const tickFailed = new Set();   // case ids whose current failure was already shown

/** One case's heartbeat. Returns which beeps it asks for: { danger, due }. */
async function tickCase(p, now) {
  let danger = false, due = false;
  const proto = getProtocol(S.settings, p);

  // time-based clinical alerts (progress limits, 2nd-stage duration, ROM...)
  // run in labour only: new ones are raised, cleared ones resolve so a
  // recurrence alerts again (S1). The save re-renders through the store bus.
  if (isLabouring(p)) {
    const { added, resolved } = refreshTimeAlerts(p, S.settings, now);
    if (added.length || resolved.length) await savePatient(p);
    if (added.length) {
      danger = added.some(a => a.severity === 'danger');
      due = !danger;
      toast(`${p.name}: ${added[0].title}`, danger ? 'danger' : '');
    }
  }

  // due/overdue transitions: labour observations, or the postpartum mother,
  // baby, BP and urine checks (N4)
  for (const d of dueList(p, proto, now)) {
    const key = p.id + ':' + d.type;
    const prev = lastDueState.get(key);
    if (d.state !== prev) {
      lastDueState.set(key, d.state);
      if (d.state === 'overdue' && prev !== undefined) due = true;
    }
  }
  return { danger, due };
}

async function tick() {
  const now = new Date();
  let dangerBeep = false, dueBeep = false;

  for (const p of S.patients) {
    if (patientById(p.id) !== p) continue; // removed while an earlier save was pending
    if (!isLabouring(p) && !inPostpartumWatch(p, now)) continue;
    try {
      const r = await tickCase(p, now);
      if (r.danger) dangerBeep = true;
      if (r.due) dueBeep = true;
      tickFailed.delete(p.id); // recovered: a later failure is announced again
    } catch (err) {
      // one malformed case must not silence the heartbeat for every other woman
      console.error('Heartbeat check failed for case ' + p.id, err);
      if (!tickFailed.has(p.id)) {
        tickFailed.add(p.id);
        toast(t('rp.tick_failed', { name: p.name }), 'danger');
      }
    }
  }

  if (S.settings.sound && dangerBeep) beep('danger');
  else if (S.settings.sound && dueBeep) beep('due');

  // keep clocks, countdown chips and timers fresh; never a full render (S3)
  refreshLive();
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
      h('h2', null, t('rp.db_failed')),
      h('p', null, String((err && err.message) || err)),
      h('p', { class: 'muted' }, t('rp.db_failed_help')),
      h('button', { class: 'btn', onclick: () => location.reload() }, t('rp.retry')),
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
  render('navigate');
  window.addEventListener('hashchange', () => render('navigate'));
  bus.addEventListener('change', () => render('data'));
  setInterval(tick, 30000);

  keepAwake();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) keepAwake(); });

  // offline support + update chip
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(setupUpdates).catch(() => { /* file:// or unsupported: app still works online */ });
  }
}

boot();
