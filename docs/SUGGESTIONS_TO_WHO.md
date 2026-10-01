# Suggestions for the next revision of the WHO Labour Care Guide

Offered to the WHO Labour Care Guide team and to the LCG implementation community, from the experience of building, auditing and rebuilding an open-source digital implementation of the Labour Care Guide (this repository), and from the published evidence on digital partographs in Kenya, Zanzibar, Tanzania, India, Bangladesh and Ethiopia.

Author: Dr Temesgen Endalew, MD, MSc HPE, PMP - Board Chairman, Africa Digital Health Academy; Addis Ababa, Ethiopia. Date: 28 September 2026. Comments and corrections: open an issue on this repository.

Documents referred to: the WHO Labour Care Guide form (2020); WHO labour care guide: user's manual (2020); WHO labour care guide: implementation resource package (2025, "the package"); WHO recommendations: intrapartum care for a positive childbirth experience (2018, "rec N" = recommendation number in the manual's Annex 4); WHO/FIGO/ICM consolidated guidelines for the prevention, diagnosis and treatment of postpartum haemorrhage (2025).

## The sixteen suggestions in one page

Making the LCG computable
1. Publish a WHO digital adaptation kit and FHIR implementation guide for the LCG.
2. Publish a minimum specification for digital LCG tools.

Closing ambiguities on the form and in the manual
3. Define the second-stage clock: a full-dilatation time cell, the pushing marker as the anchor, and guidance for the passive phase.
4. Define persistence, escalation and resolution of alerts, and the expected time to action.
5. Add a second alert tier for the observations that need immediate action.
6. Add the admission items the package's own indicators need: companion wanted, presentation, previous caesarean, number of fetuses, gestational age.
7. State the rationale for a single set of per-centimetre lag times across parities, or publish parity-specific reference values.
8. Give explicit guidance for combining arrest of descent with moulding and caput.
9. Provide a companion monitoring schedule for the latent phase and define the continuation sheet.
10. Provide a visual reference for meconium grades and define the blood-stained code.
11. Make the urine frequency operational.

Extending the guide to birth and the first hours
12. Add a third-stage and immediate-postpartum panel aligned with the 2025 postpartum haemorrhage guidelines and recommendation 55.
13. Align third-stage wording across WHO tools on uterine massage.

The implementation package
14. Host the training package openly, with a demonstration case bank.
15. Make the indicator and audit definitions computable.
16. Keep a public registry of national adaptations and language abbreviation sets.

## Part A. Making the LCG computable

### 1. A WHO digital adaptation kit and FHIR implementation guide for the LCG

What exists. The package names "use of digital technology supports" as a Level 2 transformative practice and asks in its situation-analysis tool whether digital systems are used for labour and childbirth data. WHO SMART Guidelines digital adaptation kits exist for antenatal care, postnatal care, family planning, HIV, tuberculosis and immunization; an intrapartum kit is described as under development (Bulletin of the World Health Organization, September 2025).

What we observed. Every digital LCG we surveyed (Bangladesh, India, Uganda, Kenya, Ethiopia, this project) had to invent its own data dictionary, its own coded value sets, its own reading of the alert column as rules, and its own indicator arithmetic. The results are not interoperable and cannot be compared. Our own FHIR mapping had to choose LOINC and SNOMED codes for cervical dilatation, descent, moulding, caput and contractions without a WHO reference.

Suggestion. Publish the intrapartum kit with the LCG at its centre: a data dictionary for every LCG element with coded value sets (LOINC, SNOMED CT, ICD-11); the alert column and the manual's Step 4 plans as decision logic; the package's Table 3 indicators as computable numerators and denominators; the Annex 8 audit items as computable measures; a FHIR implementation guide; conformance test cases; and an official set of demonstration labours (normal, slow progress, fetal distress, hypertension, second-stage delay) that any tool can replay. This repository offers its data dictionary, FHIR mapping and test cases as a seed contribution under an open licence.

### 2. A minimum specification for digital LCG tools

What exists. The manual's Annex 2 guides adaptation of the paper form. There is no WHO statement of what a digital LCG must do to be called one.

What we observed. Field trials taught lessons that a paper adaptation guide cannot capture: a 30-minute entry lock-out improved timeliness but failed when one midwife covered more than four labours (Kenya); hard-coded thresholds went stale (8 of 77 rules in one trial); real-time capture fell to 29-55 percent under workload (India); a background refresh that wipes a half-filled birth record, and an alert that fires only once per woman, were defects in our own first version.

Suggestion. Publish a short conformance profile for digital LCG tools: observation time recorded separately from entry time, with a bounded back-dating window and no lock-outs; the author of every entry; every threshold breach acknowledged with a recorded decision and time (the shared decision-making row made auditable); alerts that re-arm when an abnormality recurs; append-only correction of entries; offline-first operation with local data residency; thresholds held as reviewable data, not code; export in the FHIR profile of suggestion 1; and automated computation of the package's indicators and audit score. Countries procuring or registering digital LCG tools would then have a yardstick.

## Part B. Closing ambiguities on the form and in the manual

### 3. The second-stage clock

What exists. The form says "in second stage, insert P to indicate when pushing begins". Table 6 gives the second-stage alert as "birth is not completed by 3 hours from the start of the active second stage in nulliparous and 2 hours in multiparous women". Recommendation 33 defines the second stage from full cervical dilatation. The sheet has no cell for the time full dilatation was confirmed; the last X at 10 cm is the only record.

What we observed. Implementers must decide whether the 3-hour and 2-hour alerts count from full dilatation or from the P mark, and what to do for a woman who is fully dilated without an urge to push and has no epidural. Our first version counted from full dilatation; the manual points to the P mark. Both readings are defensible from the text.

Suggestion. Add a "full dilatation confirmed at" field in the second-stage header; state explicitly that the 3-hour and 2-hour alerts run from the start of active pushing (the P mark); and state what is expected during the passive phase without epidural (a review interval, or an explicit statement that no time limit is set), so that paper and digital users apply one rule.

### 4. Persistence, escalation and resolution of alerts

What exists. The form instructs: circle any observation meeting the alert criteria, alert the senior midwife or doctor, and record the assessment and action. For contractions the manual adds a verification step ("verify the number of contractions over another 10 minutes; if confirmed, alert"). For FHR it says turn the woman to her left side, then alert.

What we observed. A digital tool must decide when an alert is over (two consecutive normal readings, a recorded action, a time limit) and whether a recurrence is the same episode or a new one. Without a WHO rule, tools either fire once and fall silent, or fire at every reading and train users to ignore them. The audit tool in Annex 8 records whether an alert value was circled, but not whether action followed within a defined time.

Suggestion. State, per observation, the confirmation step (as already done for contractions and FHR), the resolution rule (for example, two consecutive readings within normal limits after a documented action), and an expected time to senior review. Include the time-to-action item in the Annex 8 audit tool so that facilities can measure responsiveness, not only documentation.

### 5. A second alert tier for observations that need immediate action

What exists. The alert column has one level. A systolic pressure of 141 mmHg and one of 170 mmHg are the same circle; an FHR of 108 and one of 80 are the same circle.

What we observed. WHO's own guidance on pre-eclampsia treats 160/110 mmHg as severe hypertension needing magnesium sulfate and antihypertensive treatment now, and a very slow FHR persisting after contractions as fetal distress. Every digital tool we know of, including ours, added a second tier ("review" versus "act now") to avoid burying an emergency among routine circles. The tiers differ between tools.

Suggestion. Print a second threshold on the form, or in the manual's Step 3, for the four observations where it changes the action: baseline FHR (a value that calls for immediate intra-uterine resuscitation and senior presence), blood pressure (severe hypertension), temperature (fever needing sepsis assessment), and contractions (tachysystole with oxytocin running, which calls for stopping the infusion).

### 6. Admission items the package's own indicators need

What exists. Section 1 records name, parity, labour onset (spontaneous or induced), date of active-labour diagnosis, rupture of membranes and risk factors. The package's Table 3 asks for the proportion of women who "wanted and had" a companion of choice, and for the caesarean rate disaggregated by Robson classification.

What we observed. The LCG does not record whether the woman wanted a companion, so the denominator of that indicator cannot be taken from the LCG. Robson classification needs parity, previous caesarean, onset of labour, number of fetuses, gestational age and presentation; the LCG records only parity and onset. Presentation is also the single most important admission finding for referral from a health centre (breech or transverse lie), and the form's position codes A, P, T describe the occiput only.

Suggestion. Add to Section 1: companion wanted (Y/N/U), presentation (cephalic, breech, other), previous caesarean section (Y/N), number of fetuses, and gestational age in weeks. Five short cells make every indicator in Table 3 computable from the LCG alone and let a health centre flag a malpresentation at the point it matters.

### 7. Per-centimetre lag times and parity

What exists. The form applies one set of lag times (5 cm 6 h, 6 cm 5 h, 7 cm 3 h, 8 cm 2.5 h, 9 cm 2 h) to all women. Recommendation 6 gives parity-specific expected durations of the active first stage (usually not beyond 12 hours in first labours and 10 hours in subsequent labours). The manual cites the cohort and review studies on dilatation patterns (its references 6, 7 and 14), which report progression by parity.

What we observed. Digital tools can display the expected trajectory as well as the alert; without published reference values by parity they cannot. Users also ask why a multiparous woman is given the same allowance at 6 cm as a nulliparous woman when her expected total duration is shorter.

Suggestion. Publish the reference distributions (median and 95th centile time per centimetre) by parity that underpin the lag times, and either state the rationale for a single set or provide parity-specific values for tools and for future revisions of the form.

### 8. Arrest of descent with moulding and caput

What exists. Table 6 says for descent: "There are no reference thresholds for this observation, which will vary on each individual case." The moulding and caput rows alert at +++ and the manual notes that either, "along with other abnormal observations", could be a sign of obstruction.

What we observed. In health centres the decision that matters is early recognition of obstruction and referral before uterine rupture. The three signs are on separate rows and their combination is left to judgement.

Suggestion. Add to the manual's Step 4 for descent an explicit statement of the combination that should trigger senior review for suspected obstruction (for example, no descent across two examinations with moulding ++ or more or caput ++ or more, with adequate contractions), while keeping descent itself without a numeric threshold.

### 9. The latent phase and the continuation sheet

What exists. The manual says the LCG should not be initiated in the latent phase, that women should nevertheless be monitored and supported during it, and refers to the essential-practice guide. The form says "if labour extends beyond 12 h, please continue on a new Labour Care Guide".

What we observed. Many women in low-resource settings are admitted at 3 or 4 cm and stay for hours. Countries have filled the gap with their own latent-phase charts (Ethiopia's health-centre protocol has one), and digital tools invent their own monitoring intervals. The continuation instruction leaves open whether the time axis restarts, how the running lag time at the current dilatation carries over, and where the second-stage panel goes when the first sheet is full.

Suggestion. Provide a one-page WHO companion schedule for women admitted before 5 cm (FHR, contractions, maternal observations and re-examination intervals, and the trigger for starting the LCG), and specify the continuation sheet: the time axis continues from hour 13, the lag time in progress carries over, and the second-stage panel is used on whichever sheet is current.

### 10. Meconium grades and the blood-stained code

What exists. Amniotic fluid is recorded as I, C, M (with +, ++, +++ for non-significant, medium and thick meconium) or B; the alert values are M+++ and B.

What we observed. The grade of meconium is the difference between routine monitoring and an alert, yet it rests on an unillustrated verbal scale. "B" is applied inconsistently to a heavy show, to blood-stained liquor and to frank bleeding.

Suggestion. Add a photographic or colour reference for the three meconium grades to the manual and the training package, and define B as blood-stained liquor distinct from show, with frank vaginal bleeding recorded and acted on as an emergency outside the row.

### 11. Urine frequency

What exists. Table 5: "assess every 4 hours or each time the woman voids during labour."

What we observed. "Each time she voids" cannot be scheduled and is often recorded as a blank; the audit tool then cannot distinguish "not assessed" from "did not void".

Suggestion. State the minimum (every 4 hours) and add a code for "unable to void" or "not passed", so that a blank means an omission.

## Part C. Extending the guide to birth and the first hours

### 12. A third-stage and immediate-postpartum panel

What exists. The LCG ends at birth. The 2025 postpartum haemorrhage guidelines introduce objective blood-loss measurement with a calibrated drape, an action trigger at 300 mL with any abnormal vital sign or at 500 mL, and the MOTIVE first-response bundle. Recommendation 55 asks for regular assessment of bleeding, uterine tone, fundal height, temperature and pulse from the first hour, blood pressure shortly after birth and again within 6 hours, and a documented urine void within 6 hours. The package's country example (Annex 3) shows a country merging the Safe Childbirth Checklist with the LCG into one intrapartum tool.

What we observed. The hour after birth is when most maternal deaths happen and is the least structured part of the record. Countries and tools are already extending the LCG on their own, in incompatible ways.

Suggestion. Publish a WHO-designed third-stage and first-two-hours panel (or a companion "birth and immediate postpartum care guide" on the same design language): time of birth, uterotonic given and time, cord clamping time, placenta complete, measured blood loss with the two-level trigger printed, the MOTIVE bundle as a checklist with times, and the recommendation 55 observations on a 15-minute then hourly grid, with the newborn's first assessment beside the mother's.

### 13. Consistent third-stage wording

What exists. Recommendation 46 states that sustained uterine massage is not recommended for prevention in women who have received prophylactic oxytocin; uterine massage remains a first-response step for treatment in the MOTIVE bundle.

What we observed. Training materials and checklists in circulation, including our own first version, still list routine massage after the placenta as a prevention step. Users see a contradiction between the LCG's annex, older AMTSL training and the new bundle.

Suggestion. State the distinction (prevention: uterotonic, controlled cord traction, tone assessment; treatment: massage within the bundle) in one line wherever the third stage appears in WHO tools, including the training package.

## Part D. The implementation package

### 14. Open hosting of the training package and demonstration cases

What exists. Annex 7 describes a two-day, five-session training and lists the materials with "links to be added"; the package points to the Labor Care Guide Learning Resource Package developed by MOMENTUM Country and Global Leadership (Jhpiego).

What we observed. Refresher training is the strongest known driver of correct partograph use in Ethiopia (odds ratio above 5 in the national literature). Trainers currently rely on a partner-hosted package and anonymised local case notes.

Suggestion. Host the training package on an open WHO platform (for example OpenWHO) in the six official languages, with a bank of demonstration labours as both printable sheets and machine-readable files (suggestion 1) so that digital tools ship the same cases as the classroom.

### 15. Computable indicator and audit definitions

What exists. Table 3 defines six facility indicators in words. Annex 8 is a draft audit tool ("DRAFT Version 0.1") with per-section frequency, circle and initials checks. Stillbirth disaggregation is asked for as antepartum/intrapartum and before/after admission.

What we observed. "LCG completed" has no operational definition (started at 5 cm or more? every section present? every scheduled cell?). The stillbirth split relies on the FHR documented alive on admission as a proxy, but the form has no explicit code for "FHR absent on admission". Facilities computing the indicators by hand reach different numbers from the same sheets.

Suggestion. Publish numerators and denominators as computable definitions (which sheet elements count as "completed", how the antepartum/intrapartum proxy is derived, what a Robson group requires), add an explicit "no fetal heart heard on admission" code to Section 3, and version the audit tool so that automated scoring in digital tools can cite it.

### 16. A registry of national adaptations and abbreviation sets

What exists. Annex 2 of the manual and the package's adaptation box encourage local adaptation, translation and locally meaningful abbreviations, with caution not to remove effective interventions.

What we observed. Adapted forms (Portuguese, Bangla, Hindi, Amharic in preparation) are not collected anywhere public. A digital tool that wants to support a country's adaptation has to obtain it privately; a country adapting the form cannot see what others decided.

Suggestion. Maintain a public registry of national LCG adaptations: the adapted form, the abbreviation set per language, the added or changed elements, and the rationale, with a WHO note on whether each adaptation preserves the effective interventions. Digital tools could then load an adaptation as data.

## What this repository offers back

- A FHIR R4 mapping of every LCG element with LOINC and SNOMED CT codes (docs/FHIR_MAPPING.md), under an open licence, as a starting point for suggestion 1; a formal data dictionary is planned.
- Computable versions of the package's six indicators and of the Annex 8 audit score, with test cases, as a starting point for suggestion 15.
- Demonstration labours as machine-readable files, for suggestion 14.
- Field feedback from Ethiopian health centres once piloting begins, for suggestions 3 to 11.

## Sources

- WHO. WHO labour care guide: user's manual. Geneva: World Health Organization; 2020. Licence CC BY-NC-SA 3.0 IGO.
- WHO. WHO labour care guide (form). Geneva: World Health Organization; 2020.
- WHO. WHO labour care guide: implementation resource package. Geneva: World Health Organization; 2025. Licence CC BY-NC-SA 3.0 IGO.
- WHO. WHO recommendations: intrapartum care for a positive childbirth experience. Geneva: World Health Organization; 2018.
- WHO, FIGO, ICM. Consolidated guidelines for the prevention, diagnosis and treatment of postpartum haemorrhage. Geneva: World Health Organization; 2025.
- Bonet M, et al. Efforts to implement WHO recommendations on antenatal, intrapartum and postnatal care. Bulletin of the World Health Organization; September 2025.
- Vogel JP, et al. Usability, acceptability, and feasibility of the World Health Organization Labour Care Guide: a mixed-methods, multicountry evaluation. Birth; 2021.
- Field evaluations of ePartogram (Kenya, Zanzibar), PartoMa (Zanzibar, Ethiopia), mLabour (Tanzania) and DAKSH (India), and the Ethiopian partograph-compliance literature, as listed in RESEARCH.md of this repository.
