# Time4Med · Staging Google Login (read-only)

หน้าเว็บแยกสำหรับทดลอง Google Login และดูสถานะตู้ยาจาก **Cloudflare Staging** เท่านั้น

- Path: `/Time4Med/staging-google-login/` บน GitHub Pages **หลัง merge** เท่านั้น
- Backend: `https://time4med-api-staging.napat-kaewboonpan.workers.dev`
- Auth: ใช้ Google OAuth Client ID ฝั่ง public จาก `test-v019/auth-config.js` โดยไม่โหลดไฟล์ config ที่ชี้ไป Worker หลัก
- Login: ใช้โมดูล `../test-v019/auth.js` เดิม มีการตรวจ role ผ่าน `GET /api/me`; token อยู่ใน memory ไม่ใช่ localStorage
- Device: `GET /api/devices/status` ทุก 30 วินาทีหลังเข้า Google; ไม่มีคำสั่งล็อก/ปลดล็อกและไม่มีคำสั่งเปลี่ยนยา
- Google Sheets: `Time4Med-Staging`, `Users` row 5: `ADMIN` สำหรับทดสอบ
- ไม่มีรหัส HiveMQ, Service Account Key, JWT หรือรหัส HMAC ใน frontend

## ความปลอดภัยและข้อจำกัด

1. ถ้ายังไม่มี telemetry ให้แสดง `NO_DATA` ซึ่ง **ถูกต้อง** (ตอนนี้ยังไม่ได้รวมตัวส่งจาก ESP32-S3)
2. `STALE` ต้องล้างค่าประตู/กลอนฉุกเฉินทันที ไม่แสดงเหมือนสถานะสด
3. `LIVE` บอกเพียง Backend ได้รับข้อความใหม่ที่ลงลายเซ็น ไม่ใช่หลักฐานรับประทานยา หรือยืนยันสภาพฮาร์ดแวร์จริง
4. ถ้า `reason: STAGING_TEST` แสดง **ข้อมูลจำลอง** อย่างชัดเจน
5. Login/logout ต้องไม่ให้ผลจากคำขอเก่าเผยข้อมูลขึ้นใหม่
6. ไม่ deploy ทับ `time4med-api` (Production v0.19) หรือแก้หน้า Dashboard หลัก
7. เนื่องจากเส้นทาง GitHub Pages อยู่ภายใต้ origin เดียวกัน ตรวจว่า OAuth Client อนุญาต `https://n4-p4t.github.io` และ Cloudflare `ALLOWED_ORIGIN` ตั้งเป็นค่าเดียวกัน
8. การ merge หน้า Staging เข้า `main` จะ **เพิ่มเพียงโฟลเดอร์ใหม่** แต่ผู้ใช้ควรอนุมัติการเผยแพร่ก่อน; draft PR ยังทดสอบ Google Login ผ่าน GitHub Pages จริงไม่ได้

## ทดสอบ

```bash
node --check staging-google-login/status.js
node tests/staging-google-login.test.mjs
```
