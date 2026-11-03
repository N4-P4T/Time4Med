# Time4Med — สัญญาการซิงก์ตารางยาระหว่าง ESP32-S3 กับ Apps Script

เอกสารโค้ด ณ 3 พฤศจิกายน 2569 — **ยังไม่ใช่ผลทดสอบกับอุปกรณ์จริง**

## 1. อุปกรณ์ดึงตารางยา (ยังเข้ากันได้กับเฟิร์มแวร์เดิม)

ส่ง POST JSON ไป Web App /exec ผ่าน HTTPS พร้อม Device Key:

```json
{"action":"pullSchedule","deviceKey":"<DEVICE_API_KEY>","deviceId":"S3-001"}
```

ตัวอย่าง *รูปแบบ* คำตอบ (ค่า hash เป็นตัวอย่างเท่านั้น):

```json
{
  "ok":true,
  "timezone":"Asia/Bangkok",
  "schedules":[
    {"id":"MED001","patientId":"P001","shelf":1,"mealType":2,
     "time":"08:00","days":"MON,TUE,WED,THU,FRI,SAT,SUN",
     "ledSlot":1,"ledIndex":0}
  ],
  "scheduleHash":"<SHA256 digest returned by server>",
  "scheduleCount":1
}
```

ห้ามฝัง DEVICE_API_KEY จริงใน GitHub หรือไฟล์สาธารณะ

## 2. ลำดับการทำงานที่อุปกรณ์ต้องทำ

1. ดึงตารางผ่าน HTTPS และต้องได้รับ `ok=true`
2. ตรวจความถูกต้องของข้อมูล, รหัส P001–P003, เวลา, วัน, ตำแหน่ง LED และจำนวนรายการ
3. สร้างตารางใหม่ในหน่วยความจำ/Preferences โดยเตรียมเปลี่ยนทั้งชุด ไม่ผสมกับตารางเก่า
4. **ยอมรับ `schedules: []` เป็นตารางใหม่ที่ถูกต้อง** เมื่อ server ส่ง `ok=true`, `scheduleCount=0` และ `scheduleHash` ครบ; ลบตารางเก่าเพื่อไม่ให้ LED/เสียงแจ้งยาที่ปิดใช้แล้ว
5. หลังอุปกรณ์นำตารางใหม่ไปใช้อย่างสำเร็จจริง จึงส่ง Heartbeat พร้อมหลักฐานการใช้
6. เมื่ออุปกรณ์บูตใหม่ให้สร้าง `bootId` ใหม่ (8–64 ตัวอักษร A-Z/a-z/0-9/_/-) และตรวจตารางอีกครั้ง ก่อนยืนยันสถานะว่า SYNC

## 3. Heartbeat ที่มีหลักฐานยืนยัน

```json
{
  "action":"heartbeat","deviceKey":"<DEVICE_API_KEY>",
  "deviceId":"S3-001","lock":"LOCKED","rssi":-52,
  "bootId":"boot-A10001",
  "scheduleApplied":true,
  "scheduleHash":"<copy exact scheduleHash from last successful pullSchedule>",
  "scheduleCount":1
}
```

**สำคัญ:** `scheduleHash` ให้ **คัดลอกค่าที่ server ส่งมา** ไม่ต้องคำนวณ hash ที่ ESP32 เอง และห้ามส่ง `scheduleApplied:true` ก่อนบันทึกและใช้ตารางใหม่สำเร็จ

คำตอบมี `scheduleAckAccepted:true` เฉพาะเมื่อ hash และ count ตรงกับตารางปัจจุบันฝั่ง Sheets หาก `false` อุปกรณ์ต้องดึงตารางใหม่ ไม่ควรคงสถานะ SYNC ต่อ

Heartbeat ธรรมดายังคงส่งได้:

```json
{"action":"heartbeat","deviceKey":"<DEVICE_API_KEY>",
 "deviceId":"S3-001","lock":"LOCKED","rssi":-52}
```

แต่จะไม่สร้างหลักฐานการซิงก์

## 4. เงื่อนไขที่หน้าเว็บไซต์จะแสดง “ยืนยันตารางรุ่นล่าสุด”

Apps Script ตรวจครบ:
- ชื่ออุปกรณ์ตรงกับ `S3-001`
- Heartbeat ยังใหม่ไม่เกิน 3 นาที
- `current_boot_id` ตรงกับ `schedule_ack_boot_id` และมีค่าไม่ว่าง
- `schedule_ack_hash` เท่ากับ hash ของตารางที่คำนวณจาก Google Sheets ในขณะนั้น
- `schedule_ack_count` ตรงกับจำนวนรายการ
- มีเวลา `schedule_ack_at` ที่แปลงเป็นวันเวลาได้

ถ้าตู้บูตใหม่, ข้อมูลตารางยาเปลี่ยน, ไม่มีข้อมูลยืนยัน หรือ Heartbeat หมดอายุ จะกลับไปแสดง **ยังไม่มีหลักฐานยืนยันจากตู้** อัตโนมัติ

## 5. การเปลี่ยนแปลง Google Sheets แบบควบคุม

เมื่อเฟิร์มแวร์ใหม่ส่ง `bootId` ครั้งแรก ระบบหลังบ้านจะเพิ่ม **เฉพาะหัวคอลัมน์ที่ขาด** ใน `Devices`:

`current_boot_id`, `schedule_ack_boot_id`, `schedule_ack_hash`, `schedule_ack_count`, `schedule_ack_at`

เฟิร์มแวร์เดิมที่ส่ง Heartbeat โดยไม่มี `bootId` ไม่ทำให้เกิดคอลัมน์เพิ่มเติมเอง ไม่มีการเปลี่ยนตารางยาใน `MealMedicines`

## 6. ขอบเขตการรับรอง

- SHA-256 ใช้ระบุรุ่นข้อมูลตารางยาเท่านั้น ไม่ใช่การเข้ารหัสข้อมูลหรือการยืนยันสิทธิ์ (ใช้ DEVICE_API_KEY แยกต่างหาก)
- ยัง **ไม่ยืนยันว่าไฟ LED, DFPlayer, กลอนประตู หรือผู้สูงอายุกินยาแล้ว** ต้องทดสอบกับอุปกรณ์จริงแยก
- โค้ดบน GitHub ต้อง Deploy Apps Script ในโปรเจกต์จริงก่อนฟังก์ชันใหม่นี้จึงทำงาน
- ยังไม่ใช่ฟังก์ชันยาทุก 8 ชั่วโมงนับจากการยืนยันครั้งแรก
- ทดสอบแบบไม่ใช้บริการจริงได้ด้วย `node tests/gas-schedule-ack.test.cjs`
