# Time4Med LINE Phase 2: ตรวจตารางยาจาก Google Sheets แบบอ่านอย่างเดียว

## สถานะ

ผ่านการทดสอบการส่งข้อความ 1 ครั้งด้วย `Code.gs` แล้ว (ผู้ใช้เห็นข้อความ LINE จริง). ขั้นนี้ **ยังไม่ตั้ง Trigger** และ **ยังไม่ส่ง LINE** เพราะรายการยาใน Sheets ยังเป็นข้อมูลทดสอบ

`SheetPreview.gs` คือฟังก์ชันอ่านข้อมูลจาก **Time4Med_DB** 2 แท็บ:
- `MealMedicines`: รายการมื้อยาที่ใช้ในเว็บไซต์ (header แถว 1)
- `Users`: ผู้มีสิทธิ์รับแจ้งเตือน (header แถว 4)

**ไม่รวมแท็บ `Schedules` เดิมเข้าด้วยกัน** เพื่อป้องกันนับมื้อซ้ำ

## ติดตั้งใน Apps Script เดิม

1. เปิดโปรเจกต์ **Time4Med_LINE_Pilot** ใน [script.google.com](https://script.google.com/)
2. กด **+** ด้านซ้าย → **Script** เพิ่มไฟล์ใหม่ชื่อ `SheetPreview`
3. คัดลอกเนื้อหาของ [SheetPreview.gs](./SheetPreview.gs) ลงไปและบันทึก **ไม่ต้องลบ Code.gs เดิม**
4. ไปที่ **Project Settings → Script properties** เพิ่ม `TIME4MED_SHEET_ID` ใส่เฉพาะ **Spreadsheet ID** ของ Google Sheets `Time4Med_DB` ที่ผู้ใช้เป็นเจ้าของ (ไม่ใช่ URL ทั้งเส้น)
5. กลับหน้า Editor เลือก `previewTime4MedData` แล้วกด **Run** และอนุญาตสิทธิ์อ่าน Google Sheets ถ้ามีหน้าขออนุญาต
6. ดู **Execution log** จะมีฟิลด์ `mode:"READ_ONLY_NO_NOTIFICATIONS"` กับจำนวนรายการยา `eligible`, `demoExcluded` และจำนวนผู้รับ `eligibleAccounts`

ฟังก์ชันนี้ไม่มีการแก้ข้อมูล ไม่มีการเรียก LINE API และไม่จำเป็นต้องเพิ่ม Webhook หรือ Cloudflare

## การคัดเลือกแบบระมัดระวัง

รายการยาจะผ่านการตรวจเบื้องต้นเมื่อ:
- `is_active` เป็น TRUE และไม่เป็นชื่อทดสอบ/ตัวอย่าง (เช่น TEST_P001)
- `kind=scheduled`, `patient_id=P001/P002/P003`, และ `box_number` เป็น 1/2/3 ตรงกับผู้ป่วย
- `meal_type` เป็นรหัส 1–7 และ `reminder_time` เป็น `HH:mm`

ผู้รับที่นับว่า `eligibleAccounts`:
- `role=ADMIN` หรือ `CAREGIVER`
- `status=ACTIVE` และ `notification_enabled=TRUE`
- `line_user_id` เป็น LINE User ID รูปแบบ `U` และฐานสิบหก 32 หลัก

**สำคัญ:** การมี recipient ที่ผ่านฟอร์แมตไม่ได้แปลว่าได้ตรวจการจับคู่สิทธิ์ `patient_id` ครบ หรือผู้ใช้ยังติดตาม OA อยู่ ต้องทำก่อนส่งอัตโนมัติ

ฟังก์ชันอ่านอย่างเดียวนี้คืนแค่รหัสผู้สูงอายุ เวลารับยา รหัสมื้อยาและจำนวนรายการ โดยไม่พิมพ์ชื่อยา ชื่อผู้สูงอายุ อีเมล หรือ LINE User ID ลง Execution log

## จุดที่ยังต้องทำก่อนแจ้งเตือนอัตโนมัติ

- ยืนยันว่ารายการ `TEST_*` ไม่ใช่ยาจริง และจัดทำรายการยาจริงพร้อมเวลา
- ยืนยันตัวผู้ดูแลและจับคู่ `line_user_id` + `patient_id` ตามสิทธิ์จริง
- ออกแบบ ledger บันทึกการแจ้งเตือนแต่ละรายการและป้องกันส่งซ้ำเมื่อทริกเกอร์ทำงานหลายครั้ง
- เคารพโควตา LINE จริงและ soft limit ใน Settings ก่อนเปิดการส่ง
- ไม่เปลี่ยน Cloudflare Gateway เก่าหรือแก้ Production โดยไม่ได้ทดสอบระบบ E2E

โค้ดนี้เป็น **preflight inspection** ไม่ใช่ระบบส่งเตือนอัตโนมัติที่เสร็จสมบูรณ์
