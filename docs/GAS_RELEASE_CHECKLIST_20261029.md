# Time4Med — GAS-only release gate (2026-10-29)

**Status: STAGING / NOT PRODUCTION READY.** This branch must not be merged before the real Google Apps Script Web App URL exists and end-to-end tests pass.

## Confirmed work
- Main GitHub Pages entry currently redirects to legacy `test-v021/`, which loads old MQTT/Cloudflare code.
- `Time4Med_DB` is the existing Sheet. Added `time4med.project@gmail.com` to `Users` with ACTIVE/ADMIN; original user records preserved.
- Google Sheet role validation in `Users!D5:D1000` accepts ADMIN, CAREGIVER, and legacy USER. Status validation in `Users!H5:H1000` accepts ACTIVE, INACTIVE, and legacy DISABLED.
- Offline Apps Script package contains `Code.gs`, `Index.html`, manifest, device HTTPS protocol and local logic/security tests. The package is currently delivered in the Time4Med ChatGPT project as `Time4Med_AppsScript_Release_v2_2026-10-29.zip`. It has not been deployed to Apps Script yet.
- Auto LINE and Drive retention switches default to off unless Script Properties `LINE_REMINDERS_ENABLED=TRUE` and `IMAGE_RETENTION_ENABLED=TRUE`.

## Fixed shelf mapping
| Shelf | Recipient | LED |
|---|---|---|
| 1 | P001 | 4: morning / midday / evening / bedtime |
| 2 | P002 | 4: morning / midday / evening / bedtime |
| 3 | P003 | 4: morning / midday / evening / bedtime |
| 4 | Common household OTC | None |

## Unverified / blocked until owner performs setup
- Create Apps Script project and deploy as Web App; set `SPREADSHEET_ID`, `IMAGE_FOLDER_ID`, `LINE_CHANNEL_ACCESS_TOKEN`, `DEVICE_API_KEY` in Script Properties (never in GitHub).
- Test OTP, ADMIN/CAREGIVER role isolation, Google Sheet mutations, LINE push, 30-day Drive cleanup.
- Flash compatible firmware on ESP32-S3 and ESP32-CAM; test camera, RTC, DFPlayer, reed switch, emergency button and 12 per-meal indicator LEDs.
- Paste the **verified** `https://script.google.com/macros/s/.../exec` URL into this branch's `index.html`.
- Disable legacy outgoing notification triggers only after the new system has been verified, to avoid duplicates or outages.

**Do not merge PR #32 or announce 100% completion yet.** Existing legacy pages remain in the repository but are not loaded by the new entry once published.
