# WHO alignment audit - Labour Care Guide v2

Audit date: 28 September 2026. Subject: the published Parthograph v1.3.0 (repo DrTemesgen/parthograph, commit ed42d42, live at https://drtemesgen.github.io/parthograph/) compared with the current WHO Labour Care Guide (LCG) document set. This audit is the rationale for version 2, published as the new repository `labour-care-guide`.

## 1. Summary verdict

1. The WHO Labour Care Guide form (2020) and its user's manual have not been revised. Every clinical threshold and monitoring frequency in the v1 engine matches the WHO form exactly (section 5).
2. WHO published two documents after the LCG that v1 does not reflect: the LCG Implementation Resource Package (7 September 2025) and the WHO/FIGO/ICM consolidated postpartum haemorrhage guidelines (5 October 2025). Both change what a digital LCG should do (section 3).
3. Against the WHO form itself, v1 has fourteen fidelity gaps: missing codes, no pushing marker, no initials, no labour-onset mode, one active-stage limit for all parities, no sheet continuation at 12 hours, and thick meconium at a vaginal examination that raises no alert (section 6).
4. Two independent code inventories found thirteen safety-grade defects in v1, the worst being that each alert type fires only once per woman, that the protocol switch in Settings changes women already in labour, and that a background refresh wipes forms being filled (section 8).
5. Conclusion: the standard did not move, the guidance around it did, and the application needs a version 2 regardless. Version 2 keeps the WHO LCG as the default protocol, keeps the Ethiopian 2021 modified partograph as a legacy option, and adds the 2025 WHO indicators, audit tool and PPH rules.

## 2. Sources checked

| Source | Date | Status found |
|---|---|---|
| WHO Labour Care Guide form (PDF, 1 page) | 2020, (c) WHO 2021, CC BY-NC-SA 3.0 IGO | Unchanged; no second edition |
| WHO labour care guide: user's manual, ISBN 9789240017566 | 2020 (IRIS record 20 Aug 2021) | Unchanged; languages EN/AR/ZH/FR/RU/ES/PT |
| WHO recommendations: intrapartum care for a positive childbirth experience, ISBN 9789241550215 | 2018 | Still the clinical basis; consolidated into the 2025 second edition of the WHO maternal-health guideline compendium without revised labour-progress thresholds |
| WHO labour care guide: implementation resource package, ISBN 978-92-4-010934-6, 34 pp | 7 September 2025 | New; not reflected in v1 |
| Consolidated guidelines for the prevention, diagnosis and treatment of postpartum haemorrhage (WHO, FIGO, ICM) | 5 October 2025 | New; not reflected in v1 |
| WHO SMART Guidelines digital adaptation kits (smart.who.int) | checked 28 Sep 2026 | No intrapartum kit; Bull WHO (Sept 2025) says one is under development |
| Ethiopia: National Intrapartum Care Guideline (MoH, launched with ESOG) | 27 June 2024 | Exists; text not available online or on this machine |
| Ethiopia in the WHO implementation package | 2025 | Ethiopia is one of seven pilot countries (Bangladesh, Burkina Faso, Ethiopia, Ghana, India, Mozambique, Pakistan); two MoH contributors named |

Method: the three WHO PDFs were downloaded and text-extracted (kept in `_sources/`, not committed); the engine files were read line by line by two independent inventories; the live site files were fetched and diffed against the local tree (identical).

## 3. What WHO added after the LCG

### 3.1 Implementation resource package (September 2025)

- Seven implementation actions (leadership, situation analysis, roadmap, infrastructure, capability, monitoring, scale-up) and a five-level maturity model. Level 2 explicitly names "use of digital technology supports" as a transformative practice.
- Table 3, facility-level indicators: proportion of women giving birth for whom the LCG was completed; proportion with the baby's fetal heart rate documented on admission; proportion with blood pressure measured on admission; proportion who wanted and had a companion of choice (denominator: women who wanted one); caesarean section rate with Robson classification; institutional stillbirths, disaggregated antepartum/intrapartum and before/after admission.
- Annex 8, clinical audit tool for routine use: for each LCG section, whether the recording frequency was met (every 30 min, hourly, 4-hourly), whether threshold values were circled, whether assessment and plan were recorded, and whether initials are present; plus header completeness (name, parity, labour onset, LCG started at 5 cm or more).
- Annex 2, situation-analysis quick tool, including whether digital systems are used for labour and childbirth data and whether labour-monitoring coverage is captured in the routine health information system.
- Annex 7, a two-day, five-session training outline; the package points to the Jhpiego MOMENTUM "Labor Care Guide Learning Resource Package".
- The package states that in WHO quality-of-care guidance "the partograph has now been replaced with the LCG".

Consequence for v2: a digital LCG should compute the Table 3 indicators from its own records, score each case against Annex 8, carry initials per entry, and record labour onset mode (needed for Robson groups).

### 3.2 Postpartum haemorrhage guidelines (October 2025)

- New action trigger: blood loss of 300 mL or more with any abnormal vital sign, or 500 mL or more.
- Objective blood-loss measurement with a calibrated drape.
- First-response bundle MOTIVE: massage of the uterus, oxytocic drugs, tranexamic acid, intravenous fluids, vaginal and genital tract examination, escalation.
- Prophylaxis with a quality-assured uterotonic, oxytocin or heat-stable carbetocin.

v1 status: alert at 500 mL only; the PPH emergency card omits tranexamic acid; the AMTSL checklist lists routine "uterine massage after placenta", which WHO recommendation 46 (2018) advises against once prophylactic oxytocin has been given.

## 4. Ethiopia

Ethiopia adopted the WHO LCG and MoH-led implementation is under way. Corroboration found: Ethiopia is a pilot country of the WHO implementation package with named MoH contributors. The National Intrapartum Care Guideline (June 2024) could not be obtained, so its adaptations, if any, are unknown. Version 2 therefore encodes the pure WHO LCG as the default, keeps the Ethiopian modified partograph (MoH Obstetrics Management Protocol for Health Centers, 2021) as a legacy option for facilities still audited on it, and leaves a national-adaptation overlay for the MoH text when obtained.

## 5. Threshold conformance, WHO form versus v1 engine

| Parameter | WHO LCG alert | v1 engine (`js/protocol.js`, `js/alerts.js`) | Verdict |
|---|---|---|---|
| Active first stage starts | 5 cm | 5 cm | match |
| Cervical lag alert | 5 cm >= 6 h, 6 cm >= 5 h, 7 cm >= 3 h, 8 cm >= 2.5 h, 9 cm >= 2 h | 360 / 300 / 180 / 150 / 120 min | match |
| Second stage | birth not completed by 3 h (nulliparous) / 2 h (multiparous) from active second stage | 180 / 120 min from full dilatation, plus a warning at 120 / 60 min | match on limits; clock anchor differs (see F2) |
| Baseline FHR | <110, >=160 | <110 or >=160 warning; <100 or >=180 danger | match, extra tier |
| FHR deceleration | L (late) | late and prolonged | match, extra |
| Amniotic fluid | M+++, B | M3 and B (baby step only) | match on values; gap F7 |
| Fetal position | P, T | OP, OT | match |
| Caput, moulding | +++ | +++ (moulding ++ also warns) | match, extra |
| Contractions per 10 min | <=2, >5 | <=2 or >5 | match |
| Duration | <20, >60 s | <20 s; >60 s only when count >= 5 | gap F8 |
| Pulse | <60, >=120 | <60 or >=120 | match |
| Systolic BP | <80, >=140 | <80, >=140 (>=160 danger) | match, extra |
| Diastolic BP | >=90 | >=90 (>=110 danger) | match, extra |
| Temperature | <35.0, >=37.5 | <35.0, >=37.5 (>=38.0 danger) | match, extra |
| Urine | P++, A++ | ++ or +++ | match |
| Companion, pain relief, oral fluid | N | companion N and fluids N silent info; pain relief N nothing | gap F1 |
| Posture | SP | supine silent info | gap F1 |
| FHR frequency | every 30 min first stage, every 5 min second stage | 30 / 5 | match |
| Contractions frequency | every 30 min, every 15 min second stage | 30 / 15 | match |
| Vaginal examination | every 4 h | 240 min | match |
| Pulse, BP, temperature, urine | every 4 h (urine also each void) | 240 min | match |
| Supportive care | every hour | 60 min | match |
| Oxytocin record | every 60 min while running | every 30 min from stage start | stricter, but overdue at once (F10) |

## 6. Form fidelity gaps

| # | WHO LCG | v1 |
|---|---|---|
| F1 | Companion, pain relief and oral fluid coded Y, N, D (declined); all four supportive rows are alert rows | Y/N only; supportive alerts silent; pain relief N raises nothing |
| F2 | Insert P when pushing begins; the second-stage alert runs from the active second stage | clock starts at 10 cm; no pushing marker |
| F3 | Initials per column | one global provider name |
| F4 | Section 1: labour onset spontaneous/induced; rupture of membranes with U = unknown; active-labour diagnosis date | onset mode absent; no unknown flag |
| F5 | Active first stage usually not beyond 12 h in first labours and 10 h in subsequent labours (recommendation 6) | 12 h for all |
| F6 | If labour extends beyond 12 h, continue on a new LCG | one chart grows from admission |
| F7 | Amniotic fluid M+, M++, M+++ | M and M3 only; thick meconium or blood recorded at a vaginal examination raises no alert |
| F8 | Duration >60 s is an alert on its own; verify over another 10 minutes | >60 s alerts only when count >= 5 |
| F9 | Urine Negative, Trace, +, ++, +++, ++++ | nil, +, ++, +++ |
| F10 | Oxytocin recorded every 60 min from infusion start; IV fluids Y/N; medicine name, dose, route | check every 30 min from stage start; no IV Y/N per hour |
| F11 | LCG starts at 5 cm; latent-phase care follows the essential-practice guide | latent schedule and an 8-hour warning also in LCG mode (kept in v2, relabelled as national latent care) |
| F12 | Posture SP / MO | upright, lateral, supine (finer; mapped to SP/MO on the chart and export in v2) |
| F13 | Assessment and plan recorded at every assessment on the sheet | notes exist but are not drawn on the chart |
| F14 | Descent plotted as O on its own row | drawn on the cervix grid |

## 7. New capabilities required by the 2025 documents

| # | Capability | Source |
|---|---|---|
| N1 | Six facility indicators with month selection and Robson group | Implementation package Table 3 |
| N2 | Per-case LCG completeness and audit score | Implementation package Annex 8 |
| N3 | Measured blood loss (calibrated drape), two-level PPH trigger, MOTIVE bundle card, tranexamic acid, carbetocin option, routine massage removed from AMTSL | PPH guidelines 2025; WHO 2018 recommendation 46 |
| N4 | Postpartum watch: bleeding, uterine tone, fundal height, temperature and pulse from the first hour; BP shortly after birth and again within 6 h; urine void within 6 h | WHO 2018 recommendation 55 |
| N5 | Links to the implementation package and the training package from the About screen | Implementation package Annex 7 |

## 8. Safety-grade defects in v1 (verified in source)

| # | Defect | Location |
|---|---|---|
| S1 | Every alert code fires once per woman; `resolved` is never set, so a recurrence is silent | js/alerts.js 270-296 |
| S2 | `protocolOverride` is never written; a Settings switch changes women already in labour | js/views/admission.js 180; js/protocol.js 66-69 |
| S3 | Any save (the 30-second tick, another woman's time alert) re-renders the page and wipes forms in progress | js/app.js 96-131; js/store.js 23-24 |
| S4 | Admission records observations nobody entered (liquor Clear when ruptured, decelerations none, pain relief and fluids Y, posture upright); a temperature without a BP is dropped | js/views/admission.js 185-200 |
| S5 | No edit or void of an observation or birth record; a mistyped 10 cm starts second stage permanently; Delete case is a hard delete | js/wizard.js 296-305; js/views/patient.js 270 |
| S6 | Dilatation and descent are pre-filled from the last exam and saved on Next; the stepper minus on an empty value jumps to the maximum | js/wizard.js 99, 104; js/ui.js 211 |
| S7 | Ethiopian mode anchors the alert and action lines at 4 cm at the active-phase start whatever the admission dilatation, up to (cm - 4) hours late | js/protocol.js 171-179; js/chart.js 116-125 |
| S8 | Monitoring stops when a woman is marked referred while she waits for transport | js/protocol.js 77-79 |
| S9 | Alarms can stay silent after a reload (AudioContext created from a timer under the autoplay policy) | js/ui.js 77-93 |
| S10 | Service worker: no update prompt, an open ward board never updates, mixed old and new modules are possible, no visible version | sw.js; js/app.js 135-148 |
| S11 | Restore overwrites newer data; records carry no schema version; database version 1 with no migrations | js/db.js |
| S12 | Alerts stamped at entry time rather than observation time; missing parity treated as nulliparous | js/alerts.js 288; js/protocol.js 82 |
| S13 | Thresholds duplicated outside the engine | js/views/admission.js 207-219; js/views/delivery.js 139-162; js/views/reports.js 22-23 |

## 9. Other improvements carried into v2

- FHIR export: no birth outcome, liquor, decelerations or supportive care; Encounter status wrong for delivered and closed cases; `urn:uuid` used with non-UUID ids; birth date taken from UTC; patient name in the download filename.
- CSV export without a UTF-8 byte-order mark (Ge'ez names garble in Excel) and without a formula-injection guard.
- Amharic covers about 50 interface keys while about 300 strings are hard-coded in English.
- Print cuts the chart; warn-chip contrast is below 4.5:1; storage is not marked persistent; the screen can sleep during a labour.

## 10. Licence note

The WHO form, manual and implementation package are licensed CC BY-NC-SA 3.0 IGO. Thresholds and codes are facts and are not restricted. Reproduced WHO wording, the form layout and the audit tool are adaptations of WHO material: v2 keeps WHO-derived text minimal and attributed in `NOTICE-WHO.md`, keeps the code under MIT, uses no WHO logo, and describes itself as implementing the WHO Labour Care Guide without suggesting WHO endorsement.

## 11. Gates that v2 does not remove

- Clinical review of every rule by an Ethiopian obstetric and midwifery panel before facility use.
- Verification against the 2024 National Intrapartum Care Guideline once its text is obtained.
- Registration of any pilot with MoH digital-health governance.
- Postpartum-watch intervals and any passive second-stage limit are marked in the code as values for the panel to confirm.
