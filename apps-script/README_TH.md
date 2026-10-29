# Time4Med — รุ่น Google Apps Script (29 ตุลาคม 2569)

ระบบใหม่ใช้ Google Apps Script + Time4Med_DB + Google Drive + LINE โดย **ไม่มี Cloudflare Workers, ไม่มี HiveMQ, ไม่มี MQTT ในเว็บไซต์** และไม่ใช้ backend แยกสำหรับตรวจสิทธิ์

## ของที่พร้อมแล้วในชุดนี้
- `apps-script/Code.gs`: API สร้างเซสชันผ่านอีเมล OTP, ตรวจบทบาท ADMIN / CAREGIVER ฝั่งเซิร์ฟเวอร์, อ่าน/แก้ไข MealMedicines, จำกัดสิทธิ์ตาม patient_id, ดึงผู้สูงอายุและประวัติ, รับข้อมูลจากอุปกรณ์, ส่ง LINE, ลบภาพเก่า 30 วัน
- `apps-script/Index.html`: เว็บสำหรับคอมพิวเตอร์และมือถือ; ภาพรวม, ตารางยา, ชั้นยา, สถานะอุปกรณ์, ประวัติ, คลังภาพ, การจัดการบัญชีสำหรับ ADMIN
- `apps-script/appsscript.json`: การตั้งค่าและ scope ของ Apps Script
- `website/index.html`: หน้าเริ่มต้น GitHub Pages นำไปยัง Web App ของ Google Apps Script หลังกำหนด URL

อ่าน `RELEASE_STATUS_20261029_TH.md` เพื่อดูสถานะงานที่ตรวจได้จริงและสิ่งที่ยังไม่ผ่านก่อนเริ่มใช้งาน

## ก่อนนำเข้าจริง (ต้องทำโดยเจ้าของบัญชี Google)

1. สำรอง Google Sheet `Time4Med_DB` และไฟล์ Apps Script เดิมก่อน ไม่วางทับ Apps Script ที่ยังใช้ส่ง LINE เดิมโดยไม่สำรอง เพราะอาจมีฟังก์ชันชื่อซ้ำ
2. ไปที่ https://script.google.com → **New project** ภายใต้บัญชี Time4Med ที่เข้าถึงฐานข้อมูลและโฟลเดอร์รูปได้
3. วาง `Code.gs` และสร้างไฟล์ HTML ชื่อ **Index** (คัดลอก `Index.html`)
4. Project Settings → เปิด `Show appsscript.json manifest` (ถ้าจะใช้ไฟล์ manifest) และเปลี่ยนเนื้อหาเป็น `appsscript.json`
5. Project Settings → **Script properties**: `SPREADSHEET_ID` = ID ของ `Time4Med_DB` (มีค่าเริ่มต้นในโค้ดแล้ว), `LINE_CHANNEL_ACCESS_TOKEN` = token จริง, `IMAGE_FOLDER_ID` = ID โฟลเดอร์ Google Drive ชื่อ Time4Med_Image, `DEVICE_API_KEY` = ค่าสุ่มอย่างน้อย 24 ตัวอักษรที่เก็บไว้ในเฟิร์มแวร์เท่านั้น, `LINE_REMINDERS_ENABLED` = `FALSE`, `IMAGE_RETENTION_ENABLED` = `FALSE` ในขั้นทดสอบ
6. เลือกฟังก์ชัน `setupTriggersFromEditor_` → Run ด้วยเจ้าของบัญชี เพื่อสร้าง Trigger แจ้งเตือนทุกนาทีและตรวจรูปเก่าทุกวัน อนุญาตสิทธิ์ครั้งแรก **ยังไม่ส่ง LINE และยังไม่ลบภาพ** หากค่า `LINE_REMINDERS_ENABLED` และ `IMAGE_RETENTION_ENABLED` ไม่เป็น `TRUE`
7. Deploy → New deployment → Web app → **Execute as: Me** และ **Who has access: Anyone** (เพราะเว็บไซต์มีการยืนยันอีเมล OTP และตรวจ Users ที่เซิร์ฟเวอร์) → Deploy → คัดลอก URL `/exec`
8. ใช้ URL `/exec` ทดสอบด้วยบัญชีที่อยู่ใน Users แถวข้อมูลจริง (`status=ACTIVE`). บัญชีผู้ดูแลต้องมี `patient_id` ที่กำหนด เช่น `P001` หรือ `P001,P002`; ฝั่ง ADMIN เลือก `ALL`
9. ใน GitHub Pages คัดลอก `website/index.html` ไปเป็น `index.html` ราก repo และแก้ `PASTE_APPS_SCRIPT_WEB_APP_URL_HERE` เป็น URL `/exec` จากข้อ 7
10. หลังทดสอบผ่านและยืนยันข้อมูลยา/ผู้รับ LINE จริงแล้ว ให้ตั้ง `LINE_REMINDERS_ENABLED=TRUE` เพื่อเปิดส่งแจ้งเตือนอัตโนมัติ และ `IMAGE_RETENTION_ENABLED=TRUE` เมื่อตรวจนโยบายเก็บภาพ 30 วันครบแล้ว
11. อัปโหลดเฟิร์มแวร์ ESP32-S3 / ESP32-CAM ที่เรียก Apps Script ผ่าน HTTPS พร้อม `DEVICE_API_KEY` และคำสั่ง `pullSchedule`, `heartbeat`, `intake`, `emergency`, `image` เพื่อเชื่อมอุปกรณ์จริง ก่อนทดสอบ end-to-end

## ระวัง
- ข้อมูลในชีตปัจจุบันยังมี `TEST_...` และค่าตัวอย่าง โปรแกรมไม่นับรายการ TEST/DEMO เป็นตารางใช้งานและไม่ส่ง LINE ให้รายการเหล่านี้
- ไฟล์เก่าของเว็บไซต์ยังมี MQTT/Cloudflare แต่ **เวอร์ชันนี้ไม่โหลดไฟล์เหล่านั้น** หลังเปลี่ยนหน้าเริ่มต้นแล้ว สามารถเก็บใน history หรือถอดออกภายหลังได้โดยไม่ต้องทำให้เว็บไซต์ใหม่เสียหาย
- การเชื่อมอุปกรณ์จริงต้องแก้เฟิร์มแวร์ ฝั่งเว็บไซต์ไม่มีทางเรียก HTTP ตรงเข้าบ้านผู้สูงอายุจากอินเทอร์เน็ตได้โดยไม่มีระบบรับคำสั่งที่อุปกรณ์
- เว็บ **ไม่สั่งปลดล็อกระยะไกล**; ใช้ปุ่มที่ตู้ตามขอบเขตลดความซับซ้อนและป้องกันคำสั่งค้าง
- รูปภาพที่รับผ่าน `image` จำกัด JPEG ประมาณ 1.2MB; ภาพเก่าที่มีแค่ `sd_path` จะยังเปิดจาก Drive ไม่ได้
- `LINE_CHANNEL_ACCESS_TOKEN` และ `DEVICE_API_KEY` ห้ามใส่ใน GitHub Pages และห้ามส่งในข้อความ Serial Monitor
- **ยืนยันตัวตนด้วยอีเมล OTP** แทน Google One Tap/Google OAuth โดยตรง เพื่อเลี่ยงการพึ่ง Cloudflare และไม่ต้องสร้าง OAuth Client ใหม่; สิทธิ์ผู้ใช้ยังอิงอีเมลใน Google Sheets

## การแมปชั้นและ LED
| ชั้น | คน | LED |
|---|---|---|
| 1 | P001 | เช้า, กลางวัน, เย็น, ก่อนนอน |
| 2 | P002 | เช้า, กลางวัน, เย็น, ก่อนนอน |
| 3 | P003 | เช้า, กลางวัน, เย็น, ก่อนนอน |
| 4 | ยาสามัญประจำบ้าน | ไม่มี LED |

มื้อยา 1,2 → LED เช้า; 3,4 → LED กลางวัน; 5,6 → LED เย็น; 7 → LED ก่อนนอน แต่การเปิด LED ขึ้นอยู่กับ firmware ที่ต้องปรับให้ใช้ตารางใหม่

## วิธีตรวจงานจริง (acceptance)
- [ ] แอดมินได้รับ OTP และเห็นผู้สูงอายุทั้งสามชั้น
- [ ] ผู้ดูแล P001 เห็นเฉพาะ P001 และไม่สามารถเรียกแก้ไขยา/ผู้ใช้งานได้แม้เรียกฟังก์ชันเอง
- [ ] แอดมินเพิ่มและแก้ยาแล้ว Sheet `MealMedicines` เปลี่ยนจริง; reload แล้วค่าตรง
- [ ] ทดสอบ LINE ด้วยปุ่มแอดมินได้ข้อความจริง และทดสอบ trigger กับรายการยา **ที่ไม่ใช่ TEST/DEMO**
- [ ] ESP32-S3 pull ตารางยา; ส่ง heartbeat และกดยืนยันแล้ว ActivityLog + IntakeLog เพิ่มจริง
- [ ] กล้องอัปโหลดภาพสำเร็จ, ผู้ดูแลเห็นภาพ และลบหลัง 30 วันตาม trigger
- [ ] ตู้ยาเปิดด้วยปุ่มยืนยันค้างและ Reed Switch, DFPlayer, RTC, LED ทำงานตามการกำหนดจริง
- [ ] โทรศัพท์/คอมพิวเตอร์นอก Wi-Fi บ้านเข้าเว็บไซต์ได้และสิทธิ์ไม่รั่ว

**ห้ามระบุว่าทำงาน 100% จนกว่าจะผ่าน checklist บนอุปกรณ์จริงและ LINE ของผู้ดูแลจริง**

## การแก้ปัญหาชีต Users (29 ต.ค. 2569)
- ตัวเลือก Validation ใน Users!D5:D1000 ปรับให้รับ ADMIN/CAREGIVER/USER (ตัวเก่า) แล้ว
- ตัวเลือก Users!H5:H1000 ปรับให้รับ ACTIVE/INACTIVE/DISABLED (ตัวเก่า) แล้ว
- `CAREGIVER` จะไม่เห็นข้อมูลผู้สูงอายุที่ไม่กำหนดใน `patient_id` และไม่สามารถบันทึกยา/บัญชีจากเซิร์ฟเวอร์ได้
- การปิดบัญชี `DISABLED` ในข้อมูลเดิมจะแสดงว่าไม่ใช้งาน; การแก้ไขผ่านหน้าเว็บจะเขียน `INACTIVE`