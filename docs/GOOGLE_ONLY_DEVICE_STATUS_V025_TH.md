# Time4Med v0.25 — Google Login แล้วอ่านสถานะ ESP32-S3 อัตโนมัติ

**สถานะ: PR ทดสอบ / ไม่ได้ Deploy Worker หรือแฟลช ESP32-S3 จริง**

## เป้าหมายของผู้ดูแล

1. เปิดเว็บไซต์แล้วใช้ Google Account ที่ได้รับสิทธิ์เหมือนเดิม
2. Cloudflare ตรวจ Google ID Token กับตาราง Users ใน Google Sheets
3. หน้า Dashboard ขอข้อมูลสถานะ GET /api/devices/status อัตโนมัติทุก 30 วินาที
4. ผู้ดูแลที่ได้รับอนุญาตจะเห็นข้อมูลประตู กลอน ฉุกเฉิน โดยแสดงเฉพาะ snapshot ที่สดไม่เกิน 150 วินาที

ไม่มีแบบฟอร์ม HiveMQ Username/Password และไม่ต้องกด Connect MQTT บนหน้า Dashboard

## Architecture ที่เตรียม

ESP32-S3 → HTTPS POST ที่เซ็น HMAC หรือ MQTT-to-HTTPS Bridge ที่ตรวจสอบต้นทาง → Cloudflare Worker → Cloudflare KV → Google-authorized GET /api/devices/status → เว็บไซต์

- backend/device-telemetry.mjs: ตรวจ HMAC-SHA256, timestamp ±90 วินาที, nonce, device ID แล้วเก็บ KV
- backend/worker-v025-device-status.mjs: ต่อเติม Worker Google Login / Sheets v0.19 ด้วย API รับและอ่านสถานะ
- test-v021/device-status-auto.js: แสดงสถานะโดยไม่ใช้ MQTT Password และไม่เก็บความลับในเบราว์เซอร์
- test-v021/index.html: ไม่แสดงแบบฟอร์ม/ปุ่มเชื่อม HiveMQ ของรุ่น v0.24
- API เหล่านี้ไม่สามารถสั่งกลอนหรือแก้ตารางยา

## ขั้นตอน Admin ที่ต้องทำครั้งเดียวในอนาคต

1. Deploy Worker เป็น staging แยกจาก Production v0.19 ก่อน
2. Bind Cloudflare KV namespace ชื่อ DEVICE_STATUS_KV
3. ตั้ง Cloudflare Secret ชื่อ DEVICE_STATUS_HMAC_KEY เป็นเลขฐาน 16 จำนวน 64 ตัวอักษร (32 random bytes). ห้ามเก็บใน GitHub
4. ตั้ง environment variables เดิมของ Google Auth / Sheets เช่น ALLOWED_ORIGIN, GOOGLE_CLIENT_ID, SPREADSHEET_ID, GCP_CLIENT_EMAIL, GCP_PRIVATE_KEY ผ่านช่องทางที่ปลอดภัย
5. อัปเดต firmware หรือใช้ Bridge ที่ส่ง HMAC-authenticated HTTPS จาก ESP32-S3 จริง เข้า POST /api/device/telemetry
6. ทดสอบกับ hardware จริงก่อนอัปเดต production. ไม่แตะโปรโตคอลสั่งกลอน, การแจ้งเตือนยา, RTC หรือ DFPlayer ระหว่างการตรวจขั้นนี้

**สำคัญ:** Firmware 0.11.x ที่เคยตรวจพบส่งสถานะไป HiveMQ แล้ว แต่ยังไม่ส่ง HMAC HTTPS POST เข้า Worker นี้. ดังนั้น Worker อย่างเดียวจะตอบ NO_DATA ไม่ใช่ LIVE. อย่าอ้างว่าใช้งานฮาร์ดแวร์ได้แล้ว

## ข้อควรระวัง

- Cloudflare KV มี eventual consistency; nonce de-dup เป็น best-effort. เหมาะกับข้อมูลสถานะ read-only เท่านั้น ไม่เหมาะกับการ authorize คำสั่งกลอน
- การกำหนดสิทธิ์ตู้เป็น P001/P002/P003 ในรุ่นนี้เท่านั้น. ถ้าขยายหลายตู้ต้องใช้ cabinet-specific access control
- หากเกิน 150 วินาทีหรือไม่มีข้อมูลใหม่ ห้ามแสดง LOCKED/UNLOCKED เก่าว่าเป็นสถานะปัจจุบัน
- Token ของ Google ไม่เก็บถาวรที่ browser; ระบบเลือกบัญชีเดิมอัตโนมัติเฉพาะเมื่อ Google/Browser อนุญาต
- การหยิบยาและการกด Confirm ไม่ใช่หลักฐานว่ากลืนยาแล้ว

## การทดสอบ GitHub Actions

- tests/device-telemetry.test.mjs: HMAC, replay, invalid device, stale, patient rights
- tests/worker-device-status-auth.test.mjs: fake signed Google JWT, fake Sheets, authenticated device POST, negative rights
- tests/device-status-browser.test.cjs: บัญชี Google จำลอง, ลบแบบฟอร์ม MQTT, auto status, stale และ logout
- tests/v021-browser.test.cjs: regression สำหรับ Dashboard และตารางยาเดิม

เมื่อทุกอย่างผ่าน staging จึงค่อยเชื่อม ESP32-S3 จริงและ merge/release ระบบ Google-only status นี้