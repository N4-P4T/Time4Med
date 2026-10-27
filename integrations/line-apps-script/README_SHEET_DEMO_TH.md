# Time4Med: ทดสอบเชื่อมตารางยา Google Sheets → Apps Script → LINE หนึ่งข้อความ

สถานะปัจจุบัน: `checkLineSetup()` เชื่อมต่อ LINE สำเร็จ, `sendLineTestOnce()` ส่งถึงบัญชี LINE จริงและผู้ใช้งานยืนยันจากแชต, `previewTime4MedData()` อ่าน Google Sheets ได้จริง โดย **active=2, demoExcluded=2, eligible=0**.

**ขั้นนี้เป็นการทดสอบการเชื่อมข้อมูลด้วยรายการ TEST เท่านั้น ไม่ใช่ระบบเตือนให้กินยาจริง** และไม่มี Trigger.

## ขั้นตอนทดสอบที่ไม่แก้ฐานข้อมูล

1. ใน Google Apps Script โปรเจกต์เดิม `Time4Med_LINE_Pilot` (ที่มี `Code.gs` กับ `SheetPreview.gs` แล้ว) กด **+ → Script** เพิ่มไฟล์ใหม่ชื่อ `SheetLineDemo`.
2. คัดลอกไฟล์ [SheetLineDemo.gs](./SheetLineDemo.gs) ทั้งหมดไปวาง กด **Save**.
3. ตรวจ Script Properties เดิมให้มี `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_TEST_USER_ID` (ผู้รับที่ทดสอบ LINE สำเร็จแล้ว), และ `TIME4MED_SHEET_ID` (Time4Med_DB). ห้ามนำค่า Token หรือ LINE User ID ไปเผยแพร่.
4. เลือก `previewSheetLineDemo` → **Run** เพื่ออ่านตัวอย่างที่จะใช้และตรวจว่า `availableDemoRecords=2`, `selected.patient=P001`. ขั้นนี้ไม่ส่ง LINE.
5. เมื่อพร้อมให้เพิ่ม Script Property **`LINE_SHEET_TEST_CONFIRM`** ค่า **`YES`** แล้วบันทึก.
6. เลือก `sendSheetLineDemoOnce` → **Run เพียงครั้งเดียว** → LINE API ถ้ารับคำขอจะคืน `apiAccepted:true` จากนั้นตรวจข้อความในแอป LINE จริง.
7. ถ้ามีปัญหา **อย่ากดส่งซ้ำ หรือแก้ `LINE_SHEET_TEST_STATE` / `LINE_SHEET_TEST_RETRY_KEY`** ให้ตรวจสาเหตุก่อน

## ตัวป้องกันการรบกวน Production

- ใช้เฉพาะรายการ `MealMedicines` ที่ชื่อเริ่มด้วย `TEST_`, `TEST-` หรือ `TEST ` เท่านั้น และต้อง `is_active=TRUE` พร้อม patient/box/time/meal ถูกฟอร์แมต
- ไม่ส่งชื่อยา ชื่อผู้สูงอายุ หรือข้อมูลติดต่อใด ๆ ในข้อความทดสอบ: ส่งเพียง patient code, เวลาที่อ่าน, รหัสมื้อ และข้อความว่าเป็นการทดสอบ
- ผู้รับคือ `LINE_TEST_USER_ID` ที่เคยส่งสำเร็จเท่านั้น ไม่ส่งไปหาผู้ดูแลรายอื่น
- เช็ก LINE quota จาก API และหยุดที่ 250 ข้อความต่อเดือนหรือน้อยกว่าตาม quota จริง/เงื่อนไขรุ่นทดสอบ
- `LINE_SHEET_TEST_CONFIRM=YES` ต้องตั้งแยกจาก `LINE_TEST_CONFIRM` และ script จะล็อก `LINE_SHEET_TEST_STATE` ไว้ก่อนส่ง เผื่อเกิดข้อผิดพลาดเครือข่าย
- ไม่แก้ Google Sheets ไม่เพิ่ม Trigger ไม่ตั้ง Webhook ไม่ใช้ Cloudflare ไม่ Merge/Deploy อะไรเข้าสู่ระบบเดิม

**หลังทดสอบนี้:** ยังต้องบันทึกข้อมูลยาจริงและกำหนดผู้รับ/สิทธิ์ก่อนสร้างระบบแจ้งเตือนอัตโนมัติ รวมถึง ledger ป้องกันส่งซ้ำ และตั้งค่ารอบเวลา Asia/Bangkok.