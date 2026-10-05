# Evidence brief: the research behind the Labour Care Guide app

*First compiled in June 2026 for Parthograph v1 from WHO source documents, peer-reviewed implementation studies and a survey of open-source projects. Updated in October 2026 for version 2 with the two WHO documents published in 2025 (sections 2 and 3). This brief is the rationale for most design decisions (see [DESIGN.md](DESIGN.md)). WHO material is summarised and cited, not reproduced; numeric thresholds and codes are facts. The audit that compares the app with the WHO documents is [WHO_ALIGNMENT_2026.md](WHO_ALIGNMENT_2026.md).*

---

## 1. WHO Labour Care Guide (LCG, 2020): the clinical model

The LCG is WHO's next-generation partograph, built on the WHO 2018 recommendations on intrapartum care for a positive childbirth experience. The form and the user's manual have not been revised since 2020 (checked 28 September 2026). Key changes from the 1994/2009 modified partograph:

- The active first stage starts at **5 cm** (not 4 cm).
- **No alert or action lines.** Instead, per-centimetre time limits, reflecting evidence that many normal labours progress slower than 1 cm/h: alert when there is no progress at **5 cm for 6 h or more, 6 cm 5 h, 7 cm 3 h, 8 cm 2.5 h, 9 cm 2 h**.
- The active first stage usually does not extend beyond **12 h in first labours and 10 h in later labours** (2018 recommendation 6).
- New sections for **supportive care** (companion, pain relief, oral fluid, posture; coded Y, N or D for declined) and **shared decision-making** (assessment and plan).
- One **Alert column**: circle any value that meets it, alert the senior midwife or doctor, record the assessment and the action.
- Second stage: **P** marks when pushing begins; birth is expected within **3 h (nulliparous) or 2 h (multiparous)** of the start of the active second stage.
- Initials for every column; a new LCG when labour extends beyond 12 h.

**Monitoring frequencies and alert values implemented in `js/protocol.js` and `js/alerts.js`** (WHO LCG user's manual, Tables 3 to 7):

| Parameter | Alert value | Frequency (first stage / second stage) |
|---|---|---|
| Baseline FHR | < 110 or >= 160 bpm | every 30 min / every 5 min (listen at least 1 min, through a contraction and 30 s after) |
| Decelerations | L (late) | with the FHR |
| Amniotic fluid | M+++ (thick meconium), B (blood) | at each vaginal examination |
| Fetal position | P (posterior), T (transverse) | every 4 h, with the vaginal examination |
| Caput, moulding | +++ | every 4 h, with the vaginal examination |
| Pulse | < 60 or >= 120 | every 4 h |
| Systolic BP | < 80 or >= 140 mmHg | every 4 h |
| Diastolic BP | >= 90 mmHg | every 4 h |
| Temperature | < 35.0 or >= 37.5 C | every 4 h |
| Urine protein, acetone | P++, A++ | every 4 h, or each time she voids |
| Contractions | <= 2 or > 5 per 10 min; duration < 20 or > 60 s | every 30 min / at least every 15 min |
| Cervix | the per-centimetre limits above | vaginal examination every 4 h unless indicated |
| Supportive care | N (companion, pain relief, oral fluid); SP (supine) | every hour |
| Oxytocin | recorded, with medicines and IV fluids | every 60 min while it runs |

Sources:
- LCG form: https://cdn.who.int/media/docs/default-source/reproductive-health/maternal-health/who-labour-care-guide.pdf
- WHO labour care guide: user's manual (2020), ISBN 9789240017566: https://www.who.int/publications/i/item/9789240017566 (PDF: https://iris.who.int/server/api/core/bitstreams/94326918-1f91-49a2-a857-12831cd51b91/content)
- WHO recommendations: intrapartum care for a positive childbirth experience (2018), ISBN 9789241550215; reproduced in the manual's annex and cited in the code as "rec N".
- Multicountry usability evaluation: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8246537/
- FIGO endorsement: https://www.figo.org/news/who-labour-care-guide-new-global-standard-monitoring-childbirth

## 2. WHO LCG implementation resource package (2025)

*WHO labour care guide: implementation resource package.* Geneva: World Health Organization; 2025 (published 7 September 2025; 34 pages; ISBN 978-92-4-010934-6; CC BY-NC-SA 3.0 IGO). https://www.who.int/publications/i/item/9789240109346

**What it adds** (summarised):

- **Context.** The package builds on WHO's 2016 standards for improving the quality of maternal and newborn care in health facilities; it records that, within that quality-of-care guidance, the LCG has replaced the partograph.
- **Seven implementation actions:** (1) leadership support under the Ministry of Health, with an LCG steering group; (2) a situation analysis of intrapartum care; (3) ownership and an implementation roadmap; (4) essential infrastructure, including national policy and the adaptation of the LCG to the national context; (5) capability building and implementation, with training and Plan-Do-Study-Act cycles; (6) continuous monitoring and evaluation; (7) refined strategies for scale-up and sustainability.
- **A five-level maturity model:** awareness, adaptation and adoption (level 1); transformative practices and optimal LCG use, with training, where the package names digital technology support among those practices (level 2); consolidated and sustained use, with LCG data used for audit, review and response (level 3); sustained use with wider quality measures (level 4); continuous quality improvement (level 5).
- **Table 3, six facility-level indicators:** LCG use (the LCG completed for women giving birth in the facility); fetal heart rate documented on admission; blood pressure measured on admission; companion of choice (women who wanted and had one, among those who wanted one, by stage); caesarean section rate with the Robson classification; institutional stillbirths (no signs of life, born after 28 weeks of gestation or weighing at least 1000 g), disaggregated antepartum or intrapartum and before or after admission.
- **Annex 8, a clinical audit tool for routine use**, labelled as a draft and adapted from the MOMENTUM Country and Global Leadership (MCGL) LCG learning resource package: for each section of the LCG, whether the recording frequency was met, alert values were circled, an assessment and plan were recorded and initials are present; plus identification, parity, labour onset, whether the LCG was started in the active first stage, and the lengths of the first and second stages.
- **Annex 2**, a situation-analysis quick tool, asks among other things whether digital systems are used at facility level for labour and childbirth data. **Annex 7** outlines a two-day, five-session training that uses the MCGL learning resource package (MCGL is a USAID-funded project led by Jhpiego).
- **Ethiopia** is one of the seven countries where the package was piloted (Bangladesh, Burkina Faso, Ethiopia, Ghana, India, Mozambique, Pakistan), and two Ethiopian contributors are named.

**How the app uses it:**
- `js/indicators.js` computes the six Table 3 indicators from the device's own records for a chosen month, with the Robson table and the stillbirth split, and exports them as CSV (gap N1).
- `js/audit.js` scores each case against Annex 8 (N2). Where the annex leaves a choice open (what counts as a "completed" LCG, a timely acknowledgement, the section weights), the operational definition is marked `PANEL-TO-CONFIRM` (DESIGN.md section 9).
- Initials on every entry (F3) and labour onset at admission (F4) exist because Annex 8 audits them and the Robson groups need the onset.

## 3. WHO/FIGO/ICM consolidated postpartum haemorrhage guidelines (2025)

*Consolidated guidelines for the prevention, diagnosis and treatment of postpartum haemorrhage.* Geneva: World Health Organization, International Federation of Gynecology and Obstetrics (FIGO), International Confederation of Midwives (ICM); 2025 (published 5 October 2025; ISBN 978-92-4-011563-7). https://www.who.int/publications/i/item/9789240115637. Implementation guide (ISBN 978-92-4-011611-5): https://www.who.int/publications/i/item/9789240116115

**What it changes, and where the app implements it:**

- **Diagnosis and action trigger.** Objectively measured blood loss of 300 mL or more with any abnormal haemodynamic sign, or 500 mL or more, whichever comes first, within 24 h of birth. The values used in `js/protocol.js` (`LIMITS.pph`):

  | Item | Value |
  |---|---|
  | Volume alone | 500 mL |
  | Volume with an abnormal sign | 300 mL |
  | Abnormal signs | pulse above 100/min; shock index (pulse divided by systolic BP) above 1; systolic below 100 mmHg; diastolic below 60 mmHg |
  | Window | 24 h after birth |

  `pphTrigger()` in `js/alerts.js` applies them. Milestone M2 replaced the plan's placeholder signs (pulse 120, systolic 90) with these values. v1 alerted at 500 mL only.
- **Measurement.** Blood loss is measured objectively, for example with a calibrated drape. The PPH card records drape readings (or weighed pads and linen, or an estimate, with the method); the running total is the highest drape reading or the birth record's estimate, whichever is higher.
- **First-response bundle, MOTIVE**, started together as soon as the trigger is met: **M**assage of the uterus, **O**xytocic drugs, **T**ranexamic acid, **I**ntravenous fluids, **V**aginal and genital-tract examination, **E**scalation of care. Its evidence is the E-MOTIVE trial (early detection with a calibrated drape plus the bundle): about 60% lower risk of the composite of severe PPH, laparotomy for bleeding or death from bleeding than usual care after vaginal birth (Gallos et al., N Engl J Med 2023;389:11-21; ClinicalTrials.gov NCT04341662). The app's PPH alert and emergency card carry the bundle (`PPH_BUNDLE`), and the PPH card records each step with time and initials. v1's PPH card had no tranexamic acid.
- **Tranexamic acid timing.** 1 g IV over 10 min, as soon as possible and within 3 h of birth; a second 1 g if bleeding continues after 30 min or restarts within 24 h (the WHO 2017 recommendation on tranexamic acid for PPH, carried into the consolidated guidelines).
- **Carbetocin.** Prevention needs a quality-assured uterotonic for every birth: oxytocin, or heat-stable carbetocin, which matters where the oxytocin cold chain cannot be assured. The third-stage checklist offers heat-stable carbetocin 100 micrograms IM as the alternative to oxytocin 10 IU IM, within 1 minute of birth, with controlled cord traction and an abdominal uterine tone check (2018 recommendation 52).
- **Recommendation 46 on massage.** The WHO 2018 intrapartum recommendations (reproduced in the LCG manual's annex) do not recommend sustained uterine massage to prevent PPH in women who have received prophylactic oxytocin. v1's AMTSL checklist listed routine uterine massage after the placenta; v2 removed it. Massage remains the first step of the treatment bundle once PPH is diagnosed.

*Checked against:* the WHO publication pages, the LCG manual's annex (recommendation 46) and published summaries of the guidelines. The full guideline text is not among the local sources (`_sources/`), so the clinical panel should confirm the trigger values, the tranexamic acid and carbetocin wording against it (section 7).

## 4. What digital partograph field trials taught us

| Project | Where | Outcome | Lesson applied |
|---|---|---|---|
| **ePartogram** (Jhpiego, Android tablet, 77 WHO rules) | Kenya | **56% lower odds of a suboptimal fetal outcome** (842 vs 1,042 births); pulse documentation 72% vs 42% | Timed reminders and automatic thresholds work. Its 30-minute lock-out **failed at more than 4 women per midwife**, so the app allows back-timed entry and never blocks. 8 of the 77 hard-coded rules went stale, so thresholds live in one reviewable place (`protocol.js`, `alerts.js`). |
| **ePartogram feasibility** | Zanzibar | 87-91% of midwives completed the core tasks on their first shift, 100% by the fifth | Short training suffices if the interface guides: hence the wizard. |
| **PartoMa** | Zanzibar, then Dar es Salaam; **Ethiopia trial NCT06273007 (Haramaya / Hiwot Fana)** | Stillbirths fell from 59 to 39 per 1,000, sustained over 4 years | The gains came from **context-tailored guidelines and training**, not from the artefact: embedded advice text, a demo case for training, a supervision view on the roadmap. |
| **mLabour** (Ona / Dimagi) | Tanzania | Nurses more punctual; they found the tablet lighter to carry than paper registers | Stage-based prioritisation and exam reminders were the loved features: hence the urgency-sorted ward board. |
| **DAKSH** (WISH) | India | Real-time capture only **29-55%**, worst for contractions | Contractions carry the highest entry burden: a stepper and duration bands, two taps in total. |
| Bangladesh e-partograph RCT (NCT03509103) | Bangladesh | District-hospital trial on prolonged-labour detection | Confirms the niche. |

Systematic review of partograph practice (Ollerhead and Osrin, BMC Pregnancy Childbirth 2014): chronic under-use across low- and middle-income countries; the barriers span skills, leadership, supplies and staffing, so a tool alone is not enough.

## 5. Ethiopia specifics

**Compliance.** Pooled partograph utilisation was **59.95%** (19 studies; Ayenew and Zewdu 2020), falling to **54.92%** in the 2025 meta-analysis of 23 studies (Ayele et al. 2025); the range runs from 6.9% (Oromia) to 92.6% (Dire Dawa). Only **21.5%** of charts in the 2016 national EmONC census met the WHO completeness standard; the worst-documented items were **moulding 50.1%, temperature 53% and descent 63.2%** (the wizard makes these one tap each). Strongest enablers: refresher training OR 5.7, form availability OR 3.9, the midwife profession OR 3.1-4.0, **the health-centre setting OR 3.5**, supervision OR 3.2. Night shifts degrade documentation about 3.5-fold.

**Policy.** MoH-led implementation of the WHO LCG is under way; corroboration: Ethiopia is a pilot country of the 2025 implementation package (section 2). The MOH **Obstetrics Management Protocol for Health Centers (May 2021)**, with the modified WHO partograph (active phase at 4 cm, alert and action lines, a latent-phase chart, admission of low-risk women at 4 cm or more), is the standard some facilities are still audited on, hence the legacy protocol. A **National Intrapartum Care Guideline** was launched on 27 June 2024 (MoH with ESOG); its text could not be obtained, so any national adaptation of the LCG is unknown, hence the national adaptation slot on the roadmap. No Ethiopian LCG study was found in the June 2026 search.

**Referral reality.** Common intrapartum referral reasons from health centres: prolonged or obstructed labour, fetal distress, malpresentation, antepartum haemorrhage, severe pre-eclampsia or eclampsia, PROM or preterm labour, previous caesarean section. Only **13.9%** of health-centre referrals were matched at the receiving hospitals, feedback loops were empty, and only **15.7%** of severe pre-eclampsia referrals received MgSO4 before transport: hence the referral module with a pre-referral bundle checklist and a portable note.

**Digital landscape.** The Digital Health Blueprint 2021-2030 calls for offline-capable point-of-service tools, referral coordination systems, and the **HL7 FHIR, LOINC, SNOMED and ICD-11** standards. DHIS2 is the national HMIS (more than 30,000 facilities); eCHIS (CommCare-based, about 25,000 health extension workers) proves national-scale offline Android workflows; EMRs (SmartCare legacy, moving toward Bahmni and OpenMRS) exist only in about 70 high-caseload facilities, so **health centres have no EMR today**. Power: only 23% of facilities had less than 2 h/day of interruption (SARA 2016). Languages: five federal working languages; clinical training in English.

Key sources:
- https://pmc.ncbi.nlm.nih.gov/articles/PMC7640697/ (Ayenew and Zewdu 2020, Systematic Reviews, meta-analysis of 19 studies)
- https://pmc.ncbi.nlm.nih.gov/articles/PMC11808142/ (Ayele et al. 2025, Frontiers in Global Women's Health, 23 studies)
- https://pmc.ncbi.nlm.nih.gov/articles/PMC7585173/ (2016 EmONC chart audit)
- https://pmc.ncbi.nlm.nih.gov/articles/PMC9409580/ (referral pathways)
- https://pmc.ncbi.nlm.nih.gov/articles/PMC11320596/ (pre-referral MgSO4)
- https://extranet.who.int/countryplanningcycles/sites/default/files/public_file_rep/ETH_Ethiopia_Digital-Health-Blueprint_2021.pdf
- https://www.gavi.org/sites/default/files/programmes-impact/our-impact/eCHIS-Ethiopia-Case-Study-EN---final.pdf
- https://esog-eth.org/new-maternal-health-policy-documents-launched-at-national-workshop/

## 6. Open-source landscape (why greenfield)

GitHub survey (June 2026): about 40 partograph-related repositories; **all** are prototypes, hackathon artefacts, abandoned student projects, or unlicensed or closed-backend apps. The two genuinely LCG-shaped projects (SanStart/mamacare; israfil-hossain/labour_care_guide, a client of the closed Bangladesh LCG backend) are unlicensed. **No WHO SMART Guidelines digital adaptation kit (DAK) or HL7 FHIR implementation guide exists for intrapartum care** (checked against smart.who.int and the WHO GitHub organisation; rechecked on 28 September 2026: the Bulletin of the WHO reported in September 2025 that an intrapartum kit is under development). The smart-anc implementation guide is the closest architectural template. OpenMRS deliberately waited for the LCG and has shipped nothing public; Bahmni and DHIS2 Tracker have no labour time-series module; OpenSRP 2 (fhircore) is the best scale-up platform but is configuration-heavy.

Conclusion: **build greenfield, license the code openly (MIT), document the FHIR mapping** so it can seed a future standard. Borrow design evidence (not code) from mLabour, ePartogram and DigiPartogram.

## 7. Verification still owed (before facility use)

1. Obtain the **2024 National Intrapartum Care Guideline** (MoH/ESOG) and reconcile `js/protocol.js` with it (the national adaptation slot).
2. Obtain a clean copy of the **2021 Health Center Obstetrics Protocol** (the mirror used for v1 was down) to verify the legacy partograph's latent-phase chart and the referral wording.
3. Clinical review, by an Ethiopian obstetric and midwifery panel, of every rule in `js/protocol.js` and `js/alerts.js`, every value marked `PANEL-TO-CONFIRM`, and the acknowledgement load of the re-asking rule (DESIGN.md section 6).
4. Check the PPH 2025 trigger values and the tranexamic acid and carbetocin wording against the full guideline text (section 3).
5. Professional review of the draft Amharic strings; alert titles and advice are translated only after the panel validates them.
6. Register the pilot with MoH digital-health governance (a Blueprint requirement).
7. Settle with the MoH HMIS team, through an HMIS focal person: which DHIS2 period Pagume's five or six days are reported in, whether some facilities close the month on a fixed day, and how the counts map to DHIS2 data elements. The Reports screen already counts by Ethiopian month (a Gregorian | Both | Ethiopian button, Both by default, Pagume as the 13th month; DESIGN.md section 9).
