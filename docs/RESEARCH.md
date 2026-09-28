# Evidence brief — global & Ethiopian research behind Parthograph

*Compiled June 2026 from WHO source documents, peer-reviewed implementation studies, and a survey of existing open-source projects. This document is the rationale for nearly every design decision in the app.*

---

## 1. WHO Labour Care Guide (LCG, 2020) — the clinical model

The LCG is WHO's "next-generation partograph". Key changes from the 1994/2009 modified partograph:

- Active first stage starts at **5 cm** (not 4 cm).
- **No alert/action lines.** Instead, per-centimetre time limits reflecting evidence that many normal labours progress slower than 1 cm/h: alert if no progress at **5 cm ≥ 6 h, 6 cm ≥ 5 h, 7 cm ≥ 3 h, 8 cm ≥ 2.5 h, 9 cm ≥ 2 h**.
- New explicit sections for **supportive care** (companion, pain relief, oral fluids, posture) and **shared decision-making** (assessment + plan).
- A single **Alert column**: circle any threshold value → alert senior → record assessment and action.
- Second stage: birth expected within **3 h (nullipara) / 2 h (multipara)** of active second stage.

**Monitoring frequencies & alert thresholds implemented in `protocol.js`/`alerts.js`** (WHO LCG User's Manual, Tables 3–7):

| Parameter | Alert | Frequency (1st / 2nd stage) |
|---|---|---|
| Baseline FHR | <110 or ≥160 bpm | q30min / **q5min** (listen ≥1 min, through a contraction + 30 s) |
| Decelerations | Late or prolonged | with FHR |
| Amniotic fluid | M+++ (thick meconium), Blood | each VE (~q4h) |
| Fetal position | OP / OT | q4h |
| Caput / Moulding | +++ | q4h |
| Pulse | <60 or ≥120 | q4h |
| BP | <80 or ≥140 systolic; ≥90 diastolic | q4h |
| Temperature | <35.0 or ≥37.5 °C | q4h |
| Urine protein/acetone | ++ | q4h / each void |
| Contractions | ≤2 or >5 per 10 min; <20 s or >60 s | q30min / q15min |
| Cervix | per-cm limits above | VE q4h unless indicated |

Sources:
- LCG form: https://cdn.who.int/media/docs/default-source/reproductive-health/maternal-health/who-labour-care-guide.pdf
- User's Manual: https://iris.who.int/server/api/core/bitstreams/94326918-1f91-49a2-a857-12831cd51b91/content
- Multicountry usability evaluation: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8246537/
- FIGO endorsement: https://www.figo.org/news/who-labour-care-guide-new-global-standard-monitoring-childbirth

## 2. What digital partograph field trials taught us

| Project | Where | Outcome | Lesson we applied |
|---|---|---|---|
| **ePartogram** (Jhpiego, Android tablet, 77 WHO rules) | Kenya | **56% lower odds of suboptimal fetal outcome** (842 vs 1,042 births); pulse documentation 72% vs 42% | Timed reminders + auto-thresholds work. Its 30-min lock-out **failed at >4 mothers/midwife** → we allow back-timed entry, never block. 8/77 hard-coded rules went stale → our thresholds live in one reviewable config file. |
| **ePartogram feasibility** | Zanzibar | 87–91% of midwives completed core tasks on shift 1, 100% by shift 5 | Short training suffices if UI is guided → wizard design. |
| **PartoMa** | Zanzibar → Dar es Salaam; **Ethiopia trial NCT06273007 (Haramaya/Hiwot Fana)** | Stillbirths 59→39/1,000; sustained 4 years | Gains came from **context-tailored guidelines + training**, not the artefact → embedded advice text, demo case for training, supervision view on roadmap. |
| **mLabour** (Ona/Dimagi) | Tanzania | Nurses more punctual; tablet "lighter than paper registers" | Stage-based prioritization & exam reminders were the loved features → urgency-sorted ward board. |
| **DAKSH** (WISH) | India | Real-time capture only **29–55%**; worst for contractions | Contractions = highest entry burden → stepper + duration bands, two taps total. |
| Bangladesh e-partograph RCT (NCT03509103) | Bangladesh | District-hospital trial on prolonged-labour detection | Confirms the niche. |

Systematic review of partograph practice (Ollerhead & Osrin, BMC Pregnancy Childbirth 2014): chronic under-use across LMICs; barriers span skills, leadership, supplies, staffing — a tool alone is insufficient.

## 3. Ethiopia specifics

**Compliance:** pooled utilization **59.95%** (19 studies; Hailu 2020) falling to **54.92%** in the 2025 update; range 6.9% (Oromia) to 92.6% (Dire Dawa). Only **21.5%** of charts in the 2016 national EmONC census met the WHO completeness standard; worst-documented: **moulding 50.1%, temperature 53%, descent 63.2%** (→ the wizard makes these one-tap and default-committed). Strongest enablers: refresher training OR 5.7, form availability OR 3.9, midwife profession OR 3.1–4.0, **health-centre setting OR 3.5**, supervision OR 3.2. Night shifts degrade documentation ~3.5×.

**Policy:** the operative standard is the MOH **Obstetrics Management Protocol for Health Centers (May 2021)** with the modified WHO partograph (4 cm active phase, alert/action lines, latent-phase chart; admission of low-risk women at ≥4 cm). A **National Intrapartum Care Guideline** was launched June 2024 (ESOG announcement) — full text unverified; LCG adoption status unknown → dual-protocol engine. No Ethiopian LCG study exists yet (empty evidence niche).

**Referral reality:** common intrapartum referral reasons from health centres — prolonged/obstructed labour, fetal distress, malpresentation, APH, severe pre-eclampsia/eclampsia, PROM/preterm, prior CS. Only **13.9%** of health-centre referrals matched at receiving hospitals; feedback loops empty; only **15.7%** of severe pre-eclampsia referrals got MgSO₄ pre-transport → referral module with bundle checklist + portable note.

**Digital landscape:** Digital Health Blueprint 2021–2030 mandates offline-capable point-of-service tools, referral coordination systems, and **HL7 FHIR / LOINC / SNOMED / ICD-11** standards. DHIS2 is the national HMIS (>30,000 facilities); eCHIS (CommCare-based, ~25,000 HEWs) proves national-scale offline Android workflows; EMRs (SmartCare legacy → Bahmni/OpenMRS direction) exist only in ~70+ high-caseload facilities — **health centres have no EMR today**. Power: only 23% of facilities had <2 h/day interruption (SARA 2016). Languages: 5 federal working languages; clinical training in English.

Key sources:
- https://pmc.ncbi.nlm.nih.gov/articles/PMC7640697/ (Hailu 2020 meta-analysis)
- https://pmc.ncbi.nlm.nih.gov/articles/PMC11808142/ (2025 update)
- https://pmc.ncbi.nlm.nih.gov/articles/PMC7585173/ (2016 EmONC chart audit)
- https://pmc.ncbi.nlm.nih.gov/articles/PMC9409580/ (referral pathways)
- https://pmc.ncbi.nlm.nih.gov/articles/PMC11320596/ (pre-referral MgSO₄)
- https://extranet.who.int/countryplanningcycles/sites/default/files/public_file_rep/ETH_Ethiopia_Digital-Health-Blueprint_2021.pdf
- https://www.gavi.org/sites/default/files/programmes-impact/our-impact/eCHIS-Ethiopia-Case-Study-EN---final.pdf
- https://esog-eth.org/new-maternal-health-policy-documents-launched-at-national-workshop/

## 4. Open-source landscape (why greenfield)

GitHub survey (June 2026): ~40 partograph-related repos; **all** are prototypes, hackathon artifacts, abandoned student projects, or unlicensed/closed-backend apps. The two genuinely LCG-shaped projects (SanStart/mamacare; israfil-hossain/labour_care_guide — client of the closed Bangladesh LCG backend) are unlicensed. **No WHO SMART Guidelines DAK or HL7 FHIR IG exists for intrapartum care** (verified against smart.who.int and the WHO GitHub org) — the smart-anc IG is the closest architectural template. OpenMRS deliberately waited for the LCG and has shipped nothing public; Bahmni and DHIS2 Tracker have no labour time-series module; OpenSRP2/fhircore is the best scale-up platform but is configuration-heavy.

Conclusion: **build greenfield, license it openly (MIT), document the FHIR mapping** so it can seed a future standard. Borrow design evidence (not code) from mLabour, ePartogram, DigiPartogram.

## 5. Verification still owed (before facility use)

1. Obtain the **2024 National Intrapartum Care Guideline** full text (MOH/ESOG) → reconcile `protocol.js`.
2. Obtain a clean copy of the **2021 Health Center Obstetrics Protocol** (hakimethio mirror was down) → verify referral wording & latent-phase chart.
3. Clinical review of every threshold in `alerts.js` by an Ethiopian OBGYN/midwifery panel.
4. Professional review of the draft Amharic strings.
5. Register the pilot with MOH digital-health governance (Blueprint requirement).
