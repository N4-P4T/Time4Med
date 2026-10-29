# Time4Med — สถานะการย้ายระบบ ณ 29 ตุลาคม 2569

## ทำแล้วและตรวจสอบได้

1. ตรวจสอบ GitHub `N4-P4T/Time4Med`: หน้าเริ่มต้นเวอร์ชันเดิมยัง redirect ไป `test-v021/` ซึ่งมี Cloudflare/HiveMQ และ JavaScript MQTT รุ่นเก่าอยู่
2. มีสาขาทดสอบ `release/gas-only-20261029` และ Draft PR #32 สำหรับหน้าเริ่มต้นใหม่ (ยังไม่ Merge)
3. ตรวจสอบฐานข้อมูลจริง `Time4Med_DB`: มีแท็บ Users, Patients, MealMedicines, ActivityLog, ImageIndex, NotificationLog และอื่น ๆ ตามสคีมาที่โค้ดอ่าน
4. เพิ่มบัญชี `time4med.project@gmail.com` ลง Users ในสถานะ ACTIVE/ADMIN ตามคำขอเดิม (ข้อมูลผู้ใช้เดิมไม่ถูกลบ)
5. ปรับกฎรายการเลือกใน Users!D5:D1000 ให้รองรับ `ADMIN`, `CAREGIVER`, `USER` และ Users!H5:H1000 ให้รองรับ `ACTIVE`, `INACTIVE`, `DISABLED` พร้อมอ่านกลับยืนยัน
6. ปรับโค้ด Apps Script ให้ไม่ยกระดับบทบาทแปลกปลอมเป็น CAREGIVER, ไม่เปิดบัญชี `DISABLED` โดยไม่ได้ตั้งใจ และไม่แสดงรายการ PRN เป็นรอบยาปกติ
7. ใส่สวิตช์ **ปิดไว้โดยค่าเริ่มต้น**: `LINE_REMINDERS_ENABLED` และ `IMAGE_RETENTION_ENABLED` — สร้าง trigger ได้โดยไม่ส่ง LINE อัตโนมัติหรือลบไฟล์ Drive จนกว่าจะเปิดใช้
8. ตรวจ JPEG signature ก่อนรับไฟล์ภาพ และมีชุดทดสอบจำลองฝั่งเซิร์ฟเวอร์/สิทธิ์/ตารางยา/สถานะ

## สิ่งที่ยังไม่ได้ยืนยัน (อย่าเรียกว่าพร้อมใช้งาน 100%)

- ยังไม่มี URL ของ Google Apps Script ที่ Deploy สำเร็จภายใต้บัญชีโครงการนี้
- ยังไม่ได้อนุญาต OAuth scopes และตั้ง Script Properties จริง (`LINE_CHANNEL_ACCESS_TOKEN`, `IMAGE_FOLDER_ID`, `DEVICE_API_KEY`)
- ยังไม่ได้ทดสอบอีเมล OTP, login ผู้ดูแลจริง, LINE จริง, การเขียนข้อมูลยาในชีตจริงผ่านหน้าเว็บ
- ยังไม่ได้อัปโหลดเฟิร์มแวร์ ESP32-S3/CAM ที่เรียก Apps Script แทน HiveMQ/MQTT โดยไม่ไปแก้ GPIO ของ PCB เดิม
- ยังไม่ได้ทดสอบปุ่ม, ประตู, DFPlayer, RTC, 12 LED, ถ่ายภาพ/อัปโหลด, การรับประวัติบนอุปกรณ์จริง
- ยังไม่ได้ Merge PR #32 หรือเปลี่ยนหน้า GitHub Pages production

## เส้นทางติดตั้งที่ปลอดภัย

1. สำรอง Sheets และ Apps Script ตัวเก่า แล้วสร้างโปรเจกต์ Apps Script ใหม่ในบัญชีโครงการ
2. วางไฟล์ `apps-script/Code.gs`, `apps-script/Index.html`; ตั้ง Script Properties อย่างปลอดภัย (ห้ามใส่ token ใน GitHub)
3. ตั้ง `LINE_REMINDERS_ENABLED=FALSE`, `IMAGE_RETENTION_ENABLED=FALSE` ก่อนรัน Trigger
4. Deploy → Web app → Execute as Me, Anyone → ตรวจ OTP/ADMIN/CAREGIVER กับข้อมูลตัวอย่าง (ไม่ใช้ผู้สูงอายุจริงก่อนตรวจสิทธิ์)
5. ตรวจแอดมินบันทึกยาและผู้ดูแลไม่มีสิทธิ์แก้ข้อมูลผ่านการเรียกเซิร์ฟเวอร์โดยตรง
6. ทดสอบ LINE แบบกดส่งครั้งเดียวและตามรอบก่อนเปิด LINE_REMINDERS_ENABLED เป็น TRUE
7. ตรวจรูปและนโยบาย retention ก่อนเปิด IMAGE_RETENTION_ENABLED เป็น TRUE
8. อัปเดตเฟิร์มแวร์เฉพาะชั้นเครือข่ายด้วยโค้ดล่าสุดจริงและทดสอบฮาร์ดแวร์
9. ใส่ URL Web app `/exec` ใน `website/index.html` แล้วเผยแพร่ผ่าน GitHub PR หลังผ่านทุกอย่าง
10. ปิด Trigger ของ Apps Script เดิมที่ส่ง LINE ซ้ำเฉพาะเมื่อระบบใหม่ยืนยันทำงานแล้ว

## ขอบเขตตู้ยา

- ชั้น 1 = P001, LED 4 ดวง: เช้า/กลางวัน/เย็น/ก่อนนอน
- ชั้น 2 = P002, LED 4 ดวง: เช้า/กลางวัน/เย็น/ก่อนนอน
- ชั้น 3 = P003, LED 4 ดวง: เช้า/กลางวัน/เย็น/ก่อนนอน
- ชั้น 4 = ยาสามัญประจำบ้าน ไม่เชื่อม P001–P003 และไม่มี LED
- บันทึกการกดยืนยันเป็นเหตุการณ์กดปุ่ม ไม่ถือเป็นหลักฐานว่าผู้สูงอายุกลืนยาแล้ว
- ปุ่มปลดล็อกระยะไกลบนเว็บไม่รวมในเวอร์ชันนี้; ใช้ปุ่มยืนยันค้างที่ตู้ตามระบบเดิม

## ทดสอบโค้ดโดยไม่ใช้ระบบจริง

```bash
node tests/logic.test.cjs
node tests/permissions-and-gates.test.cjs
```

ผลการทดสอบภายในชุด Release ไม่เท่ากับการทดสอบ end-to-end กับ Google, LINE และฮาร์ดแวร์จริง