// test/helpers.mjs - shared fixtures for the Node test suite (no browser).
export const NOW = new Date('2026-06-12T10:00:00');
export const iso = hAgo => new Date(+NOW - hAgo * 3600000).toISOString();

export function mkPatient(extra = {}) {
  return Object.assign({
    id: 'tst', createdAt: iso(6), name: 'Test', gravida: 1, para: 0,
    admission: { time: iso(6) },
    status: 'active', activeStartTime: iso(5), secondStageStart: null,
    obs: [], meds: [], alerts: [], notes: [], oxytocinRunning: false,
  }, extra);
}
