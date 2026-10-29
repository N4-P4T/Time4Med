# Time4Med — migration from Cloudflare/HiveMQ to Google Apps Script (2026-10-29)

## Goal
- Public entry: GitHub Pages root `index.html`.
- Application UI + authoritative role checking: Google Apps Script HtmlService + server-side `Users` lookup; email OTP login. No separate Cloudflare Worker or HiveMQ.
- Database: existing `Time4Med_DB` with `Users` header row 4, `Patients` row 4, `MealMedicines` row 1.
- Media: Google Drive; notifications: LINE Messaging API through Apps Script.
- Roles: ADMIN can modify medicines and user permissions; CAREGIVER is read-only and limited to assigned patient IDs, independently enforced server-side.
- Shelves immutable: P001/1, P002/2, P003/3, shelf 4 household OTC without patient LEDs.
- Physical locking remains local via ESP32-S3 button; no remote unlock without a separate authenticated device command/ACK design.

## Deployment gate
The source release ZIP containing `Code.gs`, `Index.html`, `appsscript.json` and Thai setup guide must first be deployed by the Google Apps Script owner (as Web app, execute as owner). Then replace `PASTE_APPS_SCRIPT_WEB_APP_URL_HERE` in the root `index.html` with the observed `/exec` URL. Do not merge this PR into main with the placeholder; it intentionally fails closed rather than exposing an unverified application.

### Actual end-to-end checks required
1. Authorized ADMIN receives an OTP and can read/write Google Sheets; authorized CAREGIVER sees only assigned patients and cannot update medicines.
2. Scheduled LINE messages are sent for active non-TEST medicines and arrive at intended caregivers.
3. ESP32-S3 can pull schedules and send heartbeat/intake/emergency over HTTPS using a device-only key.
4. ESP32-CAM image ingestion creates authorized Drive images, and cleanup removes 30+ day images.
5. Door switch, local lock, DFPlayer, 12 shelf LEDs and RTC are tested on the cabinet.

Legacy version directories are retained only for rollback/history. No old MQTT/Cloudflare script is loaded by the proposed root page. **Do not claim 100% production readiness until the live checks pass.**
