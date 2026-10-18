# Time4Med v0.26 — ตรวจตารางยาจาก Google Sheets (STAGING, อ่านอย่างเดียว)

## สิ่งที่ทำได้แล้วในโค้ด

- ใช้ **Cloudflare Worker Staging v0.25** ที่ทดสอบ Google Login + HMAC status แล้วเป็นฐาน
- เพิ่ม GET `/api/cabinets/cabinet-01/schedule/preview` ที่ต้องยืนยัน **Google ID Token และสิทธิ์ ADMIN**
- อ่านข้อมูล **จากฝั่ง Server เท่านั้น**: `Patients!A5:G1000` และ `MealMedicines!A2:P1000` ของ **Time4Med-Staging**
- ตรวจ mapping P001→U001/กล่อง 1, P002→U002/กล่อง 2, P003→U003/กล่อง 3, มื้อ 7 ประเภท, เวลา HH:MM, จำนวนไม่เกิน 18 รอบ, ตัด PRN และรวมรายการยาในมื้อ/เวลาเดียวกันอย่างถูกต้อง
- สร้าง `revision16` (SHA-256) และ `transportFingerprint` (FNV) สำหรับ **preview** เท่านั้น
- `GET` เมื่อฐานข้อมูลว่างตอบ `NO_MEDICINES` อย่างปลอดภัย ไม่ถือว่าให้ลบตารางเดิม
- `POST /api/cabinets/cabinet-01/schedule/commit` **ตอบ 503 เสมอ**; ไม่มี MQTT broker/command/remote lock
- หน้า `/Time4Med/staging-google-login/` เพิ่มกล่องพรีวิวที่ **ADMIN** เท่านั้นมองเห็น แสดงว่าเป็น `PREVIEW_ONLY` และไม่ใช่ข้อมูลใน ESP32-S3 จริง

## สถานะ ณ ตอนจัดเตรียม

**Google Sheets Staging เตรียมแล้ว** เพิ่มแท็บ `Patients`, `MealMedicines`, `MealMedicineAudit`, `ActivityLog`, `ExperimentRuns` ตามรูปแบบคอลัมน์ของ Worker v0.19 และเก็บ `Users` ที่ทดสอบ Login ผ่านแล้วไว้เหมือนเดิม

- `Patients` headers แถว 4 (ข้อมูลเริ่มแถว 5)
- `MealMedicines`, `MealMedicineAudit`, `ActivityLog`, `ExperimentRuns` headers แถว 1 (ข้อมูลเริ่มแถว 2)
- ไม่ใส่ชื่อผู้ป่วยจริง ชื่อยา หรือเวลาเตือนสมมติอัตโนมัติ
- ไม่แก้ production Google Sheet หรือ Worker `time4med-api`

## Deployment ที่ต้องทำก่อนหน้าเว็บ Staging จะอ่าน Preview ได้

1. เปิด Worker **`time4med-api-staging`** บน Cloudflare เท่านั้น (ตรวจชื่อ Worker ให้ชัด)
2. Edit code → ใช้เนื้อหาเต็มของ `backend/worker-v026-staging-schedule-preview-singlefile.mjs` แทน Worker STAGING เดิม แล้ว Deploy
3. เปิด `https://time4med-api-staging.napat-kaewboonpan.workers.dev/health` ต้องเห็น `Time4Med Auth API v0.26-schedule-preview`
4. ไม่ต้องเปลี่ยน `GCP_PRIVATE_KEY`, `GCP_CLIENT_EMAIL`, `GOOGLE_CLIENT_ID`, `SPREADSHEET_ID`, `DEVICE_STATUS_HMAC_KEY` หรือ `DEVICE_STATUS_KV`
5. เข้า Google Login Staging ด้วยบัญชี ADMIN แล้วดูหัวข้อ "ตารางยา — ตรวจข้อมูลก่อนส่งเข้าเครื่อง" จะขึ้น `NO_MEDICINES` เมื่อยังไม่มีข้อมูลใน Sheets

**ห้าม** นำกุญแจ JSON, Secret หรือข้อมูลผู้ป่วยจริงใส่ GitHub และห้าม Deploy ทับ `time4med-api`.

## ทำไมยังไม่ให้ส่งตารางเข้า ESP32-S3

ESP32-S3 ยังถอดออกจาก PCB และแฟลช Network Probe v0.3 อยู่. เฟิร์มแวร์ตู้ยาเดิมรับ `SET|U001|HH:MM|MEAL` ทีละคำสั่ง ในขณะที่เว็บไซต์ใช้รูปแบบ JSON คนละโปรโตคอล. ยังขาด MQTT/HTTPS **authenticated command bridge, one-cabinet transaction, NVS atomic commit, complete device ACK**, รวมถึงทดสอบกลอน/RTC/เสียงจริง ดังนั้น Preview ไม่ใช่ Sync.

ชุด transaction engine แยกใน PR #13 (v0.23) **ยังไม่ผสานเข้าเฟิร์มแวร์จริง**. ต้องทดสอบกับวงจรตู้จำลอง โดยตัดไฟ 12V กลอนก่อน แล้วจึงออกแบบขั้นตอนเปิดใช้งานจริง.

## ทดสอบ

```bash
node tests/staging-schedule-preview-auth.test.mjs
node tests/staging-schedule-preview-ui.test.mjs
```

ทดสอบด้วย RSA key และ Google Sheets จำลองในเครื่อง GitHub Actions เท่านั้น ไม่ต้องใช้ Secret จริง. การผ่าน CI ไม่ใช่หลักฐานว่าตารางถูกส่งถึง ESP32-S3.
