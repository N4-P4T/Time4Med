# Time4Med — Staging ทดสอบแจ้งเตือน LINE อัตโนมัติหนึ่งครั้ง (ไม่แตะฐานข้อมูลยาจริง)

## สถานะ

- ชีต Staging แยกเป็นคนละไฟล์จาก `Time4Med_DB` เพื่อใช้ TEST เท่านั้น (เจ้าของโครงการมีลิงก์ในแชต)
- ฟังก์ชันทดสอบตั้งเวลาให้เอง **ประมาณ 4–5 นาทีหลังจากผู้ใช้กด Arm**, ติดตั้ง Trigger ตรวจทุก 1 นาที
- ถึงเวลาแล้วส่ง **1 ข้อความ** ไปยัง `LINE_TEST_USER_ID` ของเจ้าของโครงการเท่านั้น พร้อมลิงก์เว็บไซต์และปุ่มกด
- ข้อความติดป้ายว่า **ทดสอบ ไม่ใช่การแจ้งให้รับประทานยาจริง**
- Trigger จะลบตัวเองหลังการส่งสำเร็จ, กรณีส่งไม่ชัดเจน/ถูกจำกัดโควตา หรือเลยเวลา
- การทดสอบไม่ต้องตั้ง `LINE_AUTO_ENABLED` หรือ `LINE_AUTO_SEND_ENABLED`; ให้ทั้งสองตัว **ปิดเหมือนเดิม**
- ไม่มี Cloudflare, ไม่มีการแก้ `Time4Med_DB`, ไม่มีการเพิ่มฮาร์ดแวร์
- โค้ดใน PR ยังไม่ถูกอัปโหลดเข้า Apps Script และ Trigger **ยังไม่ได้ถูกติดตั้ง** โดยระบบนี้

## สิ่งที่เตรียมในชีต Staging

**MealMedicines** แถวหัวตาราง 1, ข้อมูลสมมติแถว 2:
- `record_id=STAGING_01`
- `name=TEST_P001` — production parser จะไม่นำไปเป็นยาจริงเด็ดขาด
- `patient_id=P001`, `kind=scheduled`, `meal_type=2`, `box_number=1`, `is_active=TRUE`, `source=STAGING_ONLY`
- `reminder_time` และ `reminder_days` เริ่มเป็นค่าว่าง และถูกกำหนดใน staging sheet เท่านั้นเมื่อ Run `armTime4MedStagingOnce`

**Users** หัวตารางแถว 4, แถวข้อมูล 5:
- บัญชีทดสอบ ADMIN, `patient_id=ALL`, `notification_enabled=TRUE`, `status=ACTIVE`
- ไม่มี LINE User ID อยู่ในชีต — โค้ดนำ `LINE_TEST_USER_ID` จาก Script Properties ของ Apps Script มาใส่ในหน่วยความจำเฉพาะช่วงทดสอบ

ถ้ามีการเปลี่ยนชื่อไฟล์, เพิ่มแถว, เปลี่ยนผู้สูงอายุ หรือเอายาจริงลงไป โค้ดปฏิเสธการเริ่มส่งทันที

## ขั้นตอนติดตั้งใน `Time4Med_LINE_Pilot`

1. ตรวจว่ามีไฟล์ `Code.gs`, `SheetPreview.gs`, `ReminderPreview.gs`, `ReminderLink.gs`, `AutoReminder.gs` ในโปรเจกต์ Apps Script แล้ว และยังไม่เปิด LINE AUTO จริง
2. สร้างไฟล์ `StagingReminder.gs` ใหม่ใน Apps Script โดยนำโค้ดจาก `StagingReminder.gs` ของ PR นี้ไปวาง
3. ไปที่ **Project Settings → Script Properties** เพิ่ม:
   - `LINE_STAGING_SHEET_ID` = ID ของ Google Sheets **Staging** (ไม่ใช่ `Time4Med_DB`)
   - ยังไม่ต้องตั้งค่า `LINE_STAGING_ARM_CONFIRM`
4. ตรวจว่า property `LINE_TEST_USER_ID` ยังเป็นของเจ้าของโครงการที่เคยทดสอบรับข้อความสำเร็จ
5. Run **`checkTime4MedStaging`** ควรได้ `mode=READ_ONLY_NO_LINE_SEND`, `isolatedSheetValidated=true`, `testRecipientConfigured=true`, `currentState=NOT_ARMED` และ `armConfirmed=false`
6. เมื่อพร้อมรับข้อความ TEST จริง **เพียงหนึ่งครั้ง** ให้เพิ่ม `LINE_STAGING_ARM_CONFIRM` = `YES`
7. Run **`armTime4MedStagingOnce`** หนึ่งครั้ง จะได้เวลา `dueBangkokDate`, `dueBangkokTime`, `mode=ARMED_ONE_SHOT`. ไม่ต้องกด Run `runTime4MedStagingOnce` ด้วยตัวเอง
8. ดู Google Apps Script → **Executions** และ LINE OA Time4Med ของตัวเอง. ข้อความควรมีคำว่า “ทดสอบ”, “ไม่ใช่การแจ้งให้รับประทานยาจริง”, URL `https://n4-p4t.github.io/Time4Med/` และปุ่ม “เปิดเว็บไซต์”
9. เมื่อส่งแล้วระบบจะบันทึก `LINE_STAGING_STATE=API_ACCEPTED` (รับที่ API; ไม่ใช่หลักฐานว่าอ่าน) และลบ Trigger อัตโนมัติ ส่วนการลองส่งรอบสองจะถูกป้องกันด้วย `LINE_STAGING_ALREADY_ARMED_OR_ATTEMPTED`
10. ถ้าต้องการยุติทันที ให้ Run **`stopTime4MedStaging`**; จะลบ Trigger ของ Staging เท่านั้น

**สำคัญ:** ผู้ใช้งานต้องเป็นคนกดติดตั้ง Trigger/อนุมัติสิทธิ์ใน Apps Script เอง; เครื่องมือ GitHub และ Google Sheets ในแชตนี้ไม่สามารถเข้าไปติดตั้ง Trigger ในโปรเจกต์ของผู้ใช้โดยตรงได้

## ข้อจำกัด

- เวลารันของ time-driven trigger ไม่ตรงวินาทีเสมอ; ตั้งเป็นทุก 1 นาที มีหน้าต่างยอมรับหลังเวลานัด 7 นาที จึงเป็นการทดสอบระบบตามเวลา ไม่ใช่ระบบการแพทย์แบบ real time ที่รับประกัน
- ไม่ส่งซ้ำเมื่อ LINE API timeout หรือส่ง HTTP ไม่สำเร็จ สถานะ `REVIEW_REQUIRED` ต้องตรวจเอง
- จำกัดโควตาที่ต่ำกว่า 250 หรือโควตาจริงของช่องทาง LINE
- ทดสอบนี้ใช้ข้อมูลยาสมมติทั้งหมดและ **ไม่ใช้เป็นหลักฐานว่าผู้สูงอายุรับประทานยาแล้ว**
- ถ้าเลยเวลา 7 นาที Trigger จะหยุดและบันทึก `EXPIRED_NO_SEND`
- อย่าลบ Property `LINE_STAGING_STATE` เพื่อรันทดสอบซ้ำโดยไม่ตรวจการส่งก่อน

## ถ้าข้อความไม่เข้า

ส่งเฉพาะ **Execution log** ที่ไม่มี Token / LINE ID หรือข้อมูลสุขภาพมาให้ตรวจ. ค่าที่ช่วยวิเคราะห์คือ `LINE_STAGING_STATE`, `mode`, `dueBangkokTime`. อย่านำ Channel Access Token ไปโพสต์ใน GitHub, รูป หรือแชต
