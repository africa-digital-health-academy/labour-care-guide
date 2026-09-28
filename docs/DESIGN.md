# Design decisions

## 1. Why an offline-first PWA (and not a native app or platform fork)

**Constraints** (from the Ethiopian context, see RESEARCH.md):
- Only ~23% of facilities have power with <2 h/day interruption; ~44% of the population has 4G. Connectivity is a bonus, never a requirement.
- Health centres have no EMR today (EMRs exist in only ~70+ high-caseload facilities nationally). There is no server to talk to yet.
- Budget ≈ 0. Hosting must be free (GitHub Pages); devices are shared Android tablets.

**Options considered:**
| Option | Verdict |
|---|---|
| OpenSRP 2 / fhircore (Kotlin, FHIR-native) | Strongest *platform*, but heavy: requires Android dev toolchain, server infrastructure, and configuration expertise. Right choice for a national-scale rollout — wrong for a zero-infrastructure pilot. Documented as the scale-up path in ROADMAP.md. |
| Flutter / React Native | App-store or APK distribution friction; build toolchain; no benefit at this stage. |
| **Vanilla-JS PWA (chosen)** | No build step, no dependencies, auditable by any developer, serves from GitHub Pages, installs to home screen, full offline via service worker + IndexedDB. The entire clinical logic is ~2 files a clinician-programmer can read. |

A deliberate consequence: **no patient data ever leaves the device** in v1. That sidesteps Ethiopia's unsettled health-data-hosting questions for a pilot, but means backup discipline matters (built-in JSON backup/restore + CSV export).

## 2. Dual-protocol engine

Ethiopia's operative standard is still the **modified WHO partograph** (MOH Obstetrics Management Protocol for Health Centers, 2021): active phase at 4 cm, alert line 1 cm/h, action line +4 h. WHO's **Labour Care Guide (2020)** replaces alert/action lines with per-centimetre time limits and starts active phase at 5 cm. A new National Intrapartum Care Guideline was launched in June 2024 whose full text we could not verify; facilities may be audited against either standard during the transition.

Therefore `protocol.js` implements **both** as data (schedules, thresholds, line geometry), selected in Settings. Cases keep their protocol; the chart renderer draws alert/action lines (Ethiopian mode) or progress-limit windows (LCG mode) from the same data.

**Action item before facility use:** obtain the 2024 National Intrapartum Care Guideline (MOH/ESOG) and reconcile `protocol.js` thresholds with it.

## 3. The wizard (why not a form?)

Field evidence: real-time data capture collapses under workload (DAKSH: only 29–55% of points captured in real time; worst for contractions). Forms demand literacy in the form; wizards demand only the answer to one question. Decisions:

- **One question per screen**, huge touch targets, numpad/steppers/segments — usable with one hand standing at a bedside.
- **Back-timing up to 60 min** ("when were these observations made?") — the Kenya ePartogram's 30-min lock-window improved compliance but broke at >4 mothers/midwife. We remind loudly but never block late entry.
- **Due-chip → one tap → wizard pre-scoped** to exactly what is due.
- Defaults are committed (decelerations "none", supportive care "yes") so skipping through normal findings still documents them — absence of data and normal findings are different things on a partograph.

## 4. Alert philosophy

- **Two real tiers** (`warn` = review, `danger` = act now) + silent `info` for supportive-care nudges. Sounds differ; info never sounds.
- **De-duplication**: an unresolved alert of the same code escalates rather than stacks (alert fatigue was a consistent failure mode in the literature).
- **Every alert demands an acknowledged decision** (continue monitoring / senior called / intervention / referral started) which is written to the notes — this implements the LCG's *shared decision-making* row and creates an audit trail.
- **Time-based checks run on a 30 s heartbeat** independent of data entry: progress-limit reached, second-stage duration, prolonged ROM, projected alert/action-line crossing. A midwife who is too busy to chart still gets warned.
- Advice text is **health-centre (BEmONC) scoped**: stabilise + refer for anything needing surgery/transfusion; explicit pre-referral bundles (MgSO₄ dosing spelled out).

## 5. Chart

SVG, drawn from the observation list every render — no chart state to corrupt. Layout mirrors the paper LCG (FHR → fetal codes → cervicograph → contractions → medication → maternal vitals) because midwives are trained on the paper form; the digital version must be instantly recognisable to them and to the hospital receiving a printed referral.

## 6. Data model

One JSON document per labour case (IndexedDB `patients` store): identity + admission + `obs[]` (typed observations) + `meds[]` + `alerts[]` + `notes[]` + delivery/newborn/referral objects. Documents are small (a long labour ≈ tens of KB); a whole month of cases exports as one backup file. The FHIR exporter (`fhir.js`) maps this to standard resources at export time rather than storing FHIR natively — simpler now, swappable later.

## 7. Internationalisation & calendar

- Chart and clinical alert text: **English** (Ethiopian clinical training and the paper partograph are in English).
- UI labels: `i18n.js` with English + draft Amharic; structure ready for Afaan Oromo, Tigrinya, Somali, Afar.
- **Ethiopian calendar** (Beyene–Kudlek JDN conversion, unit-tested) shown beside Gregorian everywhere a date appears — facilities document in EC dates.

## 8. Testing

`test/smoke.mjs` (plain Node, no framework) covers: EC calendar conversions and roundtrips, schedule due/overdue computation, alert/action-line geometry, LCG stagnation alerts (obs- and time-triggered), second-stage duration by parity, prolonged ROM, FHIR bundle structure and codes. UI was manually verified in Chrome (wizard flow, alert chain, referral pre-selection, chart rendering).
