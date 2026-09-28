// demo.js — seeds a realistic practice case (clearly marked DEMO) so
// evaluators and trainees can explore the wizard, chart and alert engine
// without entering data for an hour first.

import { S, savePatient, uid } from './store.js';
import { getProtocol } from './protocol.js';
import { evaluateObs, addAlerts } from './alerts.js';
import { toast } from './ui.js';

export async function seedDemoPatient() {
  const proto = getProtocol(S.settings, null);
  const now = Date.now();
  const hrs = h => new Date(now - h * 3600000).toISOString();

  const p = {
    id: uid(), createdAt: hrs(5),
    name: 'DEMO — Abeba Tesfaye', age: 24, mrn: 'DEMO-001', phone: '', kebele: 'Demo kebele 01',
    gravida: 2, para: 1, gaWeeks: 39, riskFactors: [],
    laborOnsetTime: hrs(9), romTime: hrs(3),
    admission: {
      time: hrs(5), dilatation: proto.activeStartCm, descent: 4, fhr: 138, pulse: 84,
      sys: 110, dia: 70, temp: 36.8, presentation: 'cephalic', companion: 'Y',
    },
    status: 'active', activeStartTime: hrs(5), secondStageStart: null,
    obs: [], meds: [], alerts: [], notes: [],
    protocolOverride: null, oxytocinRunning: false, referral: null, delivery: null, newborn: null,
  };

  const add = (hAgo, type, v) => {
    const obs = { id: uid(), type, time: hrs(hAgo), enteredAt: hrs(hAgo), v };
    p.obs.push(obs);
    const drafts = evaluateObs(p, obs, S.settings);
    obs.flags = drafts.map(d => d.code);
    addAlerts(p, drafts, 'obs');
  };

  // admission baseline
  add(5, 'exam', { dilatation: proto.activeStartCm, descent: 4, presentation: 'cephalic', position: 'OA', caput: 0, moulding: 0, liquor: 'I' });
  add(5, 'baby', { fhr: 138, decel: 'none', liquor: 'I' });
  add(5, 'contractions', { count: 3, durBand: 'b20_40', duration: 30 });
  add(5, 'pulse', { pulse: 84 });
  add(5, 'vitals', { sys: 110, dia: 70, temp: 36.8, protein: 'nil' });
  add(5, 'supportive', { companion: 'Y', painRelief: 'Y', oralFluid: 'Y', posture: 'upright' });

  // ongoing labour — normal progress with one borderline FHR to show alerting
  add(4.5, 'baby', { fhr: 142, decel: 'none' });
  add(4, 'baby', { fhr: 144, decel: 'none' });
  add(4, 'contractions', { count: 3, durBand: 'b20_40', duration: 30 });
  add(3.5, 'baby', { fhr: 150, decel: 'none' });
  add(3, 'baby', { fhr: 156, decel: 'none', liquor: 'C' });
  add(3, 'contractions', { count: 4, durBand: 'b40_60', duration: 50 });
  add(3, 'supportive', { companion: 'Y', painRelief: 'Y', oralFluid: 'Y', posture: 'upright' });
  add(2.5, 'baby', { fhr: 162, decel: 'early' });  // triggers FHR review alert
  add(2, 'baby', { fhr: 148, decel: 'none' });
  add(2, 'contractions', { count: 4, durBand: 'b40_60', duration: 50 });
  add(1, 'exam', { dilatation: proto.activeStartCm + 2, descent: 3, position: 'OA', caput: 0, moulding: 0, liquor: 'C' });
  add(1, 'baby', { fhr: 140, decel: 'none' });
  add(1, 'pulse', { pulse: 88 });
  add(1, 'vitals', { sys: 114, dia: 74, temp: 37.0, protein: 'nil' });
  add(1, 'contractions', { count: 4, durBand: 'b40_60', duration: 50 });
  add(1, 'supportive', { companion: 'Y', painRelief: 'Y', oralFluid: 'Y', posture: 'upright' });

  p.notes.push({ time: hrs(1), text: 'DEMO case for training — progressing well, FHR briefly 162 at 2.5 h (settled).', plan: 'continue routine monitoring' });

  await savePatient(p);
  toast('Demo case loaded — open it from the ward board');
  location.hash = '#/';
}
