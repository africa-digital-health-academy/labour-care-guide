# 🤰 Parthograph — Digital Labour Care for Resource-Limited Settings

**An offline-first, tablet-based digital partograph / WHO Labour Care Guide (2020) for midwives — with a guided entry wizard, automatic chart drawing, clinical alerts, referral decision support, APGAR scoring, and FHIR R4 export.**

> ⚠️ **Disclaimer:** Parthograph is a decision-support and documentation aid for skilled birth attendants. It is **not a certified medical device** and does not replace clinical judgement, national protocols, or senior consultation. Facility use requires approval by the responsible health authorities and supervised piloting.

---

## Why

In resource-limited settings, partograph use is chronically low. In Ethiopia — the first deployment context — pooled utilization is only **~55–60%** across studies, and in the 2016 national EmONC census only **21.5%** of partographs met the WHO standard for complete recording. The strongest known drivers of proper use are refresher training (OR 5.7), form availability, supportive supervision, and being a midwife at a **health centre**. Meanwhile, field trials of electronic partographs (Jhpiego ePartogram in Kenya, mLabour in Tanzania, DAKSH in India) show that timed reminders, automatic graphing and threshold alerts improve observation compliance and even fetal outcomes — *if* the tool respects a busy midwife's reality.

There is currently **no maintained, licensed, open-source implementation of the WHO Labour Care Guide 2020** anywhere on GitHub (verified June 2026). Parthograph aims to fill that gap — built for **resource-limited settings**, and customized for Ethiopian health centres as its first deployment.

## What it does

| Feature | Detail |
|---|---|
| **Guided wizard** | One large-format question per screen (numpad / big buttons). The midwife answers; the partograph draws itself. Entries can be back-timed up to 60 min — no punishing lock-outs. |
| **Dual protocol engine** | **WHO LCG 2020** (active phase from 5 cm, per-cm time limits: 5→6h, 6→5h, 7→3h, 8→2.5h, 9→2h) **or** the **Ethiopian modified WHO partograph** (MOH 2021: 4 cm, alert line 1 cm/h, action line +4 h). Switch in Settings to match what your facility is audited against. |
| **Smart schedule timers** | FHR & contractions q30min (q5/q15min in 2nd stage), vitals & exam q4h, supportive care hourly, oxytocin checks q30min — due/overdue chips per woman, with sound. |
| **Multi-patient ward board** | Sorted by urgency: who needs me *right now*. Built for one midwife covering several labours at night. |
| **Clinical alert engine** | WHO LCG thresholds for FHR, decelerations, liquor, contractions, BP, temperature, pulse, urine, moulding/caput, progress, 2nd-stage duration, prolonged ROM — tiered (review vs ACT NOW), de-duplicated against alert fatigue, every alert acknowledged with a recorded decision (shared decision-making). |
| **Referral decision support** | Reasons pre-selected from active alerts; **pre-referral bundle checklist** (IV line, MgSO₄ loading dose for severe pre-eclampsia, first-dose antibiotics, call-ahead, ambulance, escort); printable + shareable referral note. Only ~16% of severe pre-eclampsia referrals in Ethiopia currently get MgSO₄ before transport — the checklist makes the bundle explicit. |
| **Emergency cards** | Eclampsia, cord prolapse, APH, shoulder dystocia, uterine rupture, PPH — immediate health-centre actions, one tap to record and open referral. |
| **Birth record & APGAR** | Guided APGAR 1′/5′/10′ scoring (auto-summed, colour-coded), essential newborn care checklist, AMTSL/third stage, EBL with PPH alert. |
| **Reports** | Monthly facility indicators aligned with HMIS/DHIS2 delivery-care reporting; CSV birth register export; full JSON backup/restore. |
| **FHIR R4 export** | One Bundle per case — Patient, Encounter, Observations (verified LOINC/SNOMED codes), MedicationAdministration, Flags, ServiceRequest — ready for future EMR/HIE integration (OpenMRS/Bahmni lineage). See [docs/FHIR_MAPPING.md](docs/FHIR_MAPPING.md). |
| **Ethiopian calendar** | Ge'ez (Amete Mihret) date shown alongside Gregorian. Amharic UI strings (draft) with English clinical content, matching Ethiopian clinical training. |
| **Offline-first** | 100% client-side: IndexedDB storage + service worker. No server, no account, no connectivity needed. Installable as a PWA on Android tablets. |

## Quick start

It's a static web app — no build step, no dependencies.

```bash
# any static file server works:
npx http-server .          # or: python -m http.server
# open http://localhost:8080 — then Settings → load a demo case
```

**Install on a tablet:** open the hosted URL in Chrome on Android → menu → *Add to Home screen*. The app then works fully offline.

**Host it free on GitHub Pages:** repository → Settings → Pages → deploy from `main` branch root. Done — every tablet in the facility installs from that URL.

## Project structure

```
index.html            app shell (PWA)
sw.js                 service worker (offline cache)
css/app.css           tablet-first styles (48px+ touch targets, print styles)
js/
  protocol.js         ⭐ clinical engine: both protocols, schedules, thresholds
  alerts.js           ⭐ alert rules (obs-triggered + time-triggered), emergencies
  wizard.js           guided entry flow, alert acknowledgement, medications
  chart.js            SVG partograph renderer (auto-drawn)
  ethiopic.js         Ethiopian calendar conversion (tested)
  fhir.js             FHIR R4 Bundle export (LOINC/SNOMED coded)
  db.js / store.js    IndexedDB persistence, backup/restore
  i18n.js             English + draft Amharic strings
  views/              dashboard, admission, patient, delivery, referral, reports, settings
test/smoke.mjs        logic tests — run: node test/smoke.mjs
docs/                 design, research evidence, FHIR mapping, roadmap
```

All clinical thresholds live in `js/protocol.js` and `js/alerts.js` — **never in UI code** — so they can be reviewed by clinicians and updated when national guidance changes (a hard lesson from field trials where embedded rules went stale).

## Evidence base & design rationale

The design synthesizes:
- **WHO Labour Care Guide (2020)** + User's Manual — all thresholds and monitoring frequencies
- **Ethiopian MOH Obstetrics Management Protocol for Health Centers (2021)** — modified partograph, referral indications, BEmONC scope
- Field lessons from **Jhpiego ePartogram** (Kenya/Zanzibar), **PartoMa** (Zanzibar/Ethiopia), **mLabour** (Tanzania), **DAKSH** (India)
- Ethiopian partograph-compliance literature and the **Digital Health Blueprint 2021–2030**

See [docs/RESEARCH.md](docs/RESEARCH.md) for the full annotated evidence brief and [docs/DESIGN.md](docs/DESIGN.md) for architecture decisions.

## Roadmap (see [docs/ROADMAP.md](docs/ROADMAP.md))

1. Clinical review of thresholds & Amharic translation review (Ethiopian midwifery/OBGYN input)
2. Afaan Oromo, Tigrinya, Somali, Afar localization
3. Optional sync server + supervisor dashboard (facility/woreda mentorship view)
4. DHIS2 aggregate push; OpenMRS/Bahmni FHIR integration pilot
5. Alignment with a future WHO SMART Guidelines intrapartum DAK (none exists yet — this project could inform it)
6. Field usability study at pilot health centres (with MOH digital-health governance registration)

## Get involved / implementation support

📣 **This project is looking for collaborators and pilot partners.** If you are a health facility, ministry, NGO, researcher, midwife, obstetrician, or developer interested in **piloting, adapting, translating, or supporting the implementation** of Parthograph in your setting — Ethiopia or any resource-limited context — please reach out:

**Dr Temesgen Endalew** — [linkedin.com/in/dr-temesgen-endalew](https://www.linkedin.com/in/dr-temesgen-endalew/)

Help is especially welcome with: clinical review of the alert thresholds, Amharic / Afaan Oromo / Tigrinya / Somali / Afar translation, field usability testing, and integration with national systems (DHIS2, OpenMRS/Bahmni).

## Contributing

Issues and PRs welcome — especially from Ethiopian midwives, obstetricians, and digital-health implementers. Clinical-content changes require a citation (WHO/MOH document + page).

## License

[MIT](LICENSE) — free to use, adapt and deploy. Every existing partograph repo we surveyed was unlicensed and therefore legally unusable; this one is deliberately open.
