# Time4Med — ระบบเตือนมื้อยาอัตโนมัติผ่าน Google Apps Script + LINE

**สถานะปัจจุบัน:** โค้ดได้รับการเตรียมบน PR เท่านั้น **ยังไม่ติดตั้ง Trigger และยังไม่เปิดส่งอัตโนมัติ** เพราะ Google Sheets `Time4Med_DB` ที่ตรวจเมื่อ 2026-10-27 ยังมีรายการ Active เป็น `TEST_P001` และ `TEST_P002` ไม่มีรายการยาจริงและยังขาดวันในสัปดาห์สำหรับแจ้งเตือน

**ใช้งาน Cloudflare เพิ่ม: ไม่มี**; จะไม่รื้อ Worker เดิมซึ่งเว็บยังพึ่งพาบางฟังก์ชัน โดยงาน LINE เส้นนี้ไม่มี Cloudflare

## สิ่งที่ระบบนี้ทำ

- อ่านแท็บ `MealMedicines` และ `Users` ใน Google Sheets ที่ตั้งค่า `TIME4MED_SHEET_ID`
- ตรวจผู้สูงอายุ P001/ช่อง 1, P002/ช่อง 2, P003/ช่อง 3
- ไม่ส่ง `TEST_*`, DEMO, ชื่อ "ตัวอย่าง/ทดสอบ" เป็นข้อความแจ้งกินยาจริง
- ต้องกำหนด **วันในสัปดาห์อย่างชัดเจน** ในฟิลด์ `reminder_days` เพิ่มเติมใน `MealMedicines`; ไม่สมมติว่ากินทุกวัน
- รองรับ `DAILY` (เมื่อเจ้าของกำหนดด้วยตนเอง) หรือ `MON,TUE,WED,THU,FRI,SAT,SUN` (เลือกวันที่ต้องการ)
- ทุก 5 นาที ตรวจรายการที่ครบเวลาภายใน **7 นาทีที่ผ่านมา** โดยใช้เวลาประเทศไทย `Asia/Bangkok`; ไม่รับประกันตรงนาทีและอาจข้ามรอบได้หากบริการหยุดนานกว่าหน้าต่างตรวจ
- กลุ่มหลายรายการยาในมื้อเดียวกัน และรวมทุกผู้สูงอายุที่ได้รับสิทธิ์ของผู้ดูแลภายในเวลาเดียวกันให้ส่ง **หนึ่งข้อความต่อผู้รับต่อเวลานัด** พร้อมลิงก์เว็บไซต์และปุ่ม **เปิดเว็บไซต์**
- ตรวจ `Users` โดยต้องเป็น `ADMIN` หรือ `CAREGIVER`, `status=ACTIVE`, `notification_enabled=TRUE`, สิทธิ์ผู้สูงอายุถูกต้อง, ID LINE รูปแบบถูกต้อง
- **ผู้รับต้องอยู่ใน allowlist ที่เจ้าของยืนยันอีกชั้นหนึ่ง** ผ่าน `LINE_AUTO_ALLOWED_USER_IDS`; ถ้าพบ LINE ID ซ้ำหลายบัญชีจะข้ามทั้งหมด ไม่รวมสิทธิ์ข้ามบัญชี
- บันทึก ledger ที่ `Script Properties` โดยใช้คีย์แฮช `T4M_AUTO_V1_<วัน>_<hash>`, กำหนด `ATTEMPTED` ก่อน POST; หาก API รับบันทึก `API_ACCEPTED`; หาก 4xx/5xx/timeout บันทึก `REVIEW_REQUIRED` และ **ไม่ส่งซ้ำอัตโนมัติ**; มีการลบ ledger ที่เก่ากว่า 45 วันโดยอัตโนมัติเมื่อระบบทำงาน
- ตรวจโควตา LINE จาก API; ใช้เพดาน 250 ข้อความต่อเดือนหรือต่ำกว่าตามแพ็กเกจจริง

**หมายเหตุสำคัญ**: ledger ไม่ยืนยันว่าผู้รับอ่าน LINE แล้ว (LINE API HTTP 200 = คำขอได้รับการยอมรับ). มีการเก็บ ledger 45 วันและลบเฉพาะรายการที่เก่ากว่านั้นเมื่อระบบเปิดทำงาน ต้องมีขั้นตอนสำรองบันทึกตามข้อกำหนดโครงงานและวิธีจัดการเหตุการณ์ REVIEW_REQUIRED ด้วย

## ลำดับการติดตั้งอย่างปลอดภัย

1. **ยังไม่เพิ่มค่าเปิดใช้งาน** บน Google Apps Script ตราบใดที่รายการยาจริงและผู้ดูแลยังไม่ยืนยันครบ
2. คัดลอก [AutoReminder.gs](./AutoReminder.gs) เพิ่มเป็นไฟล์ Script ใหม่ชื่อ `AutoReminder` ในโปรเจกต์ `Time4Med_LINE_Pilot`. ต้องมีไฟล์เดิม `Code.gs`, `SheetPreview.gs`, `ReminderPreview.gs`, `ReminderLink.gs` อยู่แล้ว
3. เปิด Script Properties เดิมและตรวจว่ามี `TIME4MED_SHEET_ID`, `LINE_CHANNEL_ACCESS_TOKEN` ที่ทดสอบผ่านแล้ว ห้ามเผยแพร่ Token หรือผู้รับ
4. เพิ่ม Header ชื่อ `reminder_days` ที่คอลัมน์ Q1 ของ **`MealMedicines`** ในชีตของตน เมื่อ *พร้อมเปลี่ยนโครงสร้างฐานข้อมูลจริงแล้ว* จึงระบุวันเฉพาะแถวรายการยาจริง เช่น `DAILY` หรือ `MON,WED,FRI`. ช่องว่าง/ค่าไม่ตรงมาตรฐานจะถูกข้าม
5. ให้ผู้ดูแลตัวจริงเพิ่ม Time4Med OA เป็นเพื่อน และยืนยัน `Users.line_user_id`, `notification_enabled`, `patient_id` ตามสิทธิ์ โดยไม่เปิดเผย Token หรือข้อมูลบุคคล
6. จัดทำค่า `LINE_AUTO_ALLOWED_USER_IDS` ด้วย **LINE User ID ของผู้ดูแลที่ยืนยันแล้วเท่านั้น** (คั่นด้วยจุลภาคเมื่อหลายคน), **ไม่ใช่ Channel ID** และไม่ใช่ `Users.user_id` แบบ U001
7. เลือกฟังก์ชัน `checkTime4MedAutoReadiness` แล้ว Run: **อ่านอย่างเดียว**, พิมพ์ `mode: READ_ONLY_NO_NOTIFICATIONS`; ตรวจ `daysColumnPresent:true`, `medicineStats.validRecords>0`, `hasAuthorizedScheduleMatch:true`, `readyToInstall:true`
8. `previewTime4MedAutoReminders` คือ read-only preview ตลอดเวลา ไม่มีการส่งข้อความ
9. **หลังตรวจข้อมูลและขอบเขตผู้รับกับเจ้าของโครงการเท่านั้น** ให้เปิด Script Properties:
   - `LINE_AUTO_ENABLED` = `YES`
   - `LINE_AUTO_SEND_ENABLED` = `YES`
   - `LINE_AUTO_INSTALL_CONFIRM` = `YES`
10. เลือก `installTime4MedReminderTrigger` แล้ว Run หนึ่งครั้ง: ฟังก์ชันจะปฏิเสธหากไม่พร้อม และถ้ามี Trigger อยู่แล้วก็ไม่สร้างซ้ำ; ตั้งเวลา **every 5 minutes**
11. ทดสอบกับผู้รับที่ได้รับอนุญาตจริงและเวลานัดจริงอย่างระมัดระวัง ตรวจประวัติ Execution และ LINE ในมือถือ ก่อนใช้กับผู้สูงอายุ

## หยุดระบบทันที

เลือกฟังก์ชัน **`pauseTime4MedReminders`** แล้ว Run เพื่อเปลี่ยน `LINE_AUTO_ENABLED` เป็น `NO` และลบเฉพาะ Trigger `runTime4MedReminders`. Ledger จะยังอยู่เพื่อไม่ให้ส่งซ้ำโดยไม่ตั้งใจ

**ห้ามลบ ledger `T4M_AUTO_V1_*` เพื่อทดลองส่งใหม่** ขณะยังไม่ได้ตรวจประวัติ เพราะอาจส่งซ้ำเมื่อรันอีกครั้ง

## ข้อจำกัดที่ยังต้องทดสอบ

- โค้ดนี้ยังไม่ผ่านการรัน Google Apps Script ทุก 5 นาทีในบัญชีจริง; GitHub CI เป็นเพียงการจำลอง API/Sheets
- Google Apps Script Trigger มีความคลาดเคลื่อนของเวลารัน; ใช้หน้าต่าง 7 นาทีเพื่อรองรับบางกรณี แต่ไม่รับประกันการแจ้งตรงนาที
- Script Properties มีขนาดรวมจำกัด; มีระบบลบ ledger เก่ากว่า 45 วัน แต่ยังต้องทดสอบการจัดเก็บต่อเนื่องและวิธีสำรองบันทึกก่อนเปิดใช้งาน production
- ไม่มีการรายงานข้อความถูกอ่านหรือผู้สูงอายุทานยาแล้ว: ต้องตรวจจากเว็บ/ระบบยืนยันจริง
- ในฐานข้อมูล ณ ตอนนี้ `MealMedicines` ยังไม่มี `reminder_days`; การเปิดการส่งจะถูกปฏิเสธอย่างปลอดภัย
- ระบบไม่รับข้อมูลวันกำหนดยาจากแท็บ `Schedules` เดิม เพราะเป็นอีก schema ที่ยังไม่ได้ยืนยันว่าแถวหนึ่งต่อหนึ่งกับ `MealMedicines`

อ้างอิง: [Apps Script time trigger](https://developers.google.com/apps-script/reference/script/clock-trigger-builder), [Script Properties](https://developers.google.com/apps-script/guides/properties), [LINE push and quotas](https://developers.line.biz/en/reference/messaging-api/), [LINE retry keys](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/).
