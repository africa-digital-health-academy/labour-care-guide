// ui.js — tiny DOM toolkit (no framework: keeps the app dependency-free,
// auditable, and runnable from any static file host).

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (k === 'disabled') { if (v) el.setAttribute('disabled', ''); }
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}

function append(el, kids) {
  for (const c of kids) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

// ---------------------------------------------------------------- modal ----

export function openModal(content, opts = {}) {
  const root = document.getElementById('modal-root');
  const scrim = h('div', { class: 'modal-scrim' });
  const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, content);
  scrim.append(box);
  if (!opts.locked) {
    scrim.addEventListener('click', e => { if (e.target === scrim) close(); });
  }
  function close() {
    scrim.remove();
    if (opts.onClose) opts.onClose();
  }
  root.append(scrim);
  return close;
}

export function confirmDialog(message, { okLabel = 'OK', danger = false } = {}) {
  return new Promise(resolve => {
    const close = openModal(
      h('div', null,
        h('p', { style: 'font-size:1.1rem' }, message),
        h('div', { class: 'wizard-nav' },
          h('button', { class: 'btn secondary', onclick: () => { close(); resolve(false); } }, 'Cancel'),
          h('button', { class: 'btn' + (danger ? ' danger' : ''), onclick: () => { close(); resolve(true); } }, okLabel),
        ),
      ),
      { locked: true },
    );
  });
}

// ---------------------------------------------------------------- toast ----

export function toast(msg, kind = '') {
  const root = document.getElementById('toast-root');
  const el = h('div', { class: 'toast ' + kind }, msg);
  root.append(el);
  setTimeout(() => el.remove(), 4000);
}

// ---------------------------------------------------------------- sound ----

let audioCtx = null;
export function beep(kind = 'due') {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const seq = kind === 'danger' ? [[880, 0.18], [660, 0.18], [880, 0.18], [660, 0.18]] : [[740, 0.15], [740, 0.15]];
    let t = audioCtx.currentTime;
    for (const [freq, dur] of seq) {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.frequency.value = freq; o.type = 'sine';
      g.gain.setValueAtTime(0.25, t);
      g.gain.exponentialRampToValueAtTime(0.01, t + dur);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(t); o.stop(t + dur);
      t += dur + 0.08;
    }
  } catch { /* audio unavailable — visual alerts still work */ }
}

// ----------------------------------------------------------- formatting ----

// All displayed and entered times are pinned to East Africa Time (Addis Ababa,
// UTC+3, no daylight saving) so the labour record reads the same regardless of
// the tablet's own timezone setting.
export const APP_TZ = 'Africa/Addis_Ababa';
export const APP_TZ_OFFSET = '+03:00';

function eatParts(d) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const g = t => parts.find(x => x.type === t).value;
  let hh = g('hour'); if (hh === '24') hh = '00'; // some engines emit 24 at midnight
  return { y: g('year'), mo: g('month'), d: g('day'), hh, mi: g('minute') };
}

/** A Date whose LOCAL y/m/d equal the Addis-Ababa date — for calendar conversion. */
export function eatDate(d = new Date()) {
  const p = eatParts(d);
  return new Date(+p.y, +p.mo - 1, +p.d);
}

export function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: APP_TZ });
}

export function fmtDT(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: APP_TZ }) + ' ' + fmtTime(iso);
}

export function timeAgo(iso, now = new Date()) {
  const min = Math.round((now - new Date(iso)) / 60000);
  if (min < 1) return 'now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return `${h} h ${min % 60} min ago`;
}

export function durationSince(iso, now = new Date()) {
  const min = Math.max(0, Math.round((now - new Date(iso)) / 60000));
  const hf = Math.floor(min / 60);
  return hf ? `${hf} h ${min % 60} min` : `${min} min`;
}

/** "X minutes ago" time picker value → ISO string. */
export function minutesAgoISO(min) {
  return new Date(Date.now() - min * 60000).toISOString();
}

/** ISO string for a datetime-local input value, and back. */
export function isoToLocalInput(iso) {
  const p = eatParts(iso ? new Date(iso) : new Date());
  return `${p.y}-${p.mo}-${p.d}T${p.hh}:${p.mi}`;
}
export function localInputToISO(v) {
  if (!v) return null;
  const withSecs = v.length === 16 ? v + ':00' : v; // datetime-local has no seconds
  return new Date(withSecs + APP_TZ_OFFSET).toISOString();
}

// ---------------------------------------------------- reusable widgets -----

/** Segmented single-choice buttons. opts: [{value,label,alert?}] */
export function segmented(opts, value, onChange, { big = false } = {}) {
  const wrap = h('div', { class: 'seg' + (big ? ' big' : '') });
  const render = () => {
    clear(wrap);
    for (const o of opts) {
      wrap.append(h('button', {
        type: 'button',
        class: (o.value === value ? 'sel' : '') + (o.value === value && o.alert ? ' alertval' : ''),
        onclick: () => { value = o.value; onChange(value); render(); },
      }, o.label));
    }
  };
  render();
  return wrap;
}

/** Numeric keypad with display. opts: {decimal, max, unit, alertFn} */
export function numpad(initial, onChange, { decimal = false, maxLen = 5, unit = '', alertFn = null } = {}) {
  let val = initial != null ? String(initial) : '';
  const display = h('div', { class: 'num-display' });
  const update = () => {
    display.textContent = (val === '' ? '—' : val) + (unit ? ' ' + unit : '');
    const n = parseFloat(val);
    display.classList.toggle('alertval', !!(alertFn && val !== '' && alertFn(n)));
    onChange(val === '' ? null : parseFloat(val));
  };
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', decimal ? '.' : '', '0', '⌫'];
  const pad = h('div', { class: 'numpad' },
    keys.map(k => k === '' ? h('span') : h('button', {
      type: 'button',
      onclick: () => {
        if (k === '⌫') val = val.slice(0, -1);
        else if (k === '.' && val.includes('.')) return;
        else if (val.length < maxLen) val += k;
        update();
      },
    }, k)),
  );
  update();
  return h('div', null, display, pad);
}

/** +/- stepper for small integer ranges. */
export function stepper(initial, onChange, { min = 0, max = 10, unit = '' } = {}) {
  let val = initial != null ? initial : null;
  const valEl = h('div', { class: 'val' });
  const update = () => { valEl.textContent = val == null ? '—' : val + (unit ? ' ' + unit : ''); onChange(val); };
  const btn = (label, d) => h('button', {
    type: 'button',
    onclick: () => { val = val == null ? (d > 0 ? min : max) : Math.min(max, Math.max(min, val + d)); update(); },
  }, label);
  update();
  return h('div', { class: 'stepper' }, btn('−', -1), valEl, btn('+', +1));
}

export function field(labelText, inputEl) {
  return h('label', { class: 'field' }, h('span', null, labelText), inputEl);
}

export function alertBanner(alert, actions) {
  return h('div', { class: 'alert-banner ' + (alert.severity === 'danger' ? 'danger' : 'warn') },
    h('div', { class: 'ico' }, alert.severity === 'danger' ? '🚨' : '⚠️'),
    h('div', { class: 'body' },
      h('div', { class: 'title' }, alert.title),
      alert.advice && alert.advice.length ? h('ul', { class: 'advice' }, alert.advice.map(a => h('li', null, a))) : null,
      actions || null,
    ),
  );
}
