# Changelog

## 2.0.0-dev (unreleased) - milestone M1, 28 September 2026

- Stored case records now carry a schema version (`schemaVersion`); a pure, idempotent
  migration (`js/migrate.js`) brings every older record forward on load or on restore,
  add-only so nothing already on a device is renamed or removed.
- Each case now remembers which protocol it was admitted under (`protocolId`), fixing a
  defect where changing the Settings protocol switch used to change the standard applied
  to women already in labour. `protocolOverride` is kept as a legacy fallback.
- A `backups` object store takes an automatic snapshot before a schema migration writes
  anything, and again before a restore overwrites anything - in addition to the manual
  JSON backup file, never a replacement for it.
- Restore now previews a dry-run merge (new / updated / unchanged counts) and asks for
  confirmation before writing; newer record wins by `updatedAt`, a tie keeps the local
  record.
- Fields laid down for later milestones, not yet surfaced in the UI: per-entry author
  (`by`), observation source (`admission` vs `entry`), alert `episode`, `deliveryHistory`,
  `onsetMode`, `romUnknown`.

## 2.0.0-dev (unreleased) - milestone M0, 28 September 2026

- New repository `labour-care-guide`, started from the Parthograph v1.3.0 tree (tag `v1.3.0-import`).
- WHO alignment audit (`docs/WHO_ALIGNMENT_2026.md`) and suggestions to WHO (`docs/SUGGESTIONS_TO_WHO.md`).
- Single version constant `js/version.js` used by the service worker cache key and the About screen.
- Service worker: versioned, atomic app shell (cache-first, downloaded fresh, all-or-nothing); a new release waits until the midwife taps the "Update ready" chip; hourly and on-focus update checks.
- Alarms: audio unlocked on the first tap or key press; vibration fallback; "Test sound" button.
- Screen wake lock while the app is in the foreground; persistent storage requested; a readable error screen if the local database cannot open.
- Stepper: "-" on an empty field no longer jumps to the maximum; a previous examination value is shown greyed and is not recorded until tapped.
- Settings: honest note that the protocol switch applies to every case on the device in this version (per-case protocol arrives in M1).
- Backup files are accepted from Parthograph v1 and from this application; the FHIR export filename no longer contains the patient's name.
- Tests moved to `node:test` (`npm test`): calendar, protocol, alerts (pass and fail paths), FHIR, stepper logic, and a guard that every source file is in the offline shell.

## 1.3.0 - 12 June 2026 (imported)

The last Parthograph release: https://github.com/DrTemesgen/parthograph (commit ed42d42).
