# Time4Med — โหมดสาธิตสำหรับสอบจบ / แข่งขัน (ADMIN เท่านั้น)

อัปเดต 29 ตุลาคม 2569

## จุดประสงค์
- เมนูแยก **▶ ทดสอบระบบ** เฉพาะ ADMIN เริ่มด้วยปุ่มเดียว ไม่ต้องแก้เวลายาจริงหรือกรอกข้อมูลยาใหม่
- เลือกชั้นและมื้อก่อนกดได้หากต้องการ แต่ค่าเริ่มต้นเป็น P001 ชั้น 1 มื้อหลังอาหารเช้า
- ไม่มีการเพิ่มหรือแก้ไขข้อมูลใน Google Sheets: Patients, MealMedicines, Schedules, ActivityLog, IntakeLog, ImageIndex, NotificationLog ไม่ถูกเขียนโดยเส้นทางสาธิต
- ไม่มีการบันทึกภาพลง Google Drive; สถานะและภาพ thumbnail เก็บชั่วคราวใน CacheService เท่านั้น (ภายใน 10 นาที) หมดเวลาทดสอบหลัง 5 นาที
- สถานะหน้าเว็บจะเปลี่ยนเมื่อได้รับเหตุการณ์จาก ESP32-S3 จริงเท่านั้น ไม่แสดงว่าผ่านโดยการจับเวลาในเว็บไซต์
- สามารถเลือก LINE [Time4Med DEMO] ไปยัง ADMIN เมื่อทดสอบครบได้ด้วย checkbox หากมี LINE token และ LINE User ID; ไม่มี notification log ใน Sheet
- ไม่บันทึกประวัติการกินยาจากการทดสอบ และไม่ควรใช้ยาจริงเพื่อสอบสาธิต

## ลำดับทำงานบนฮาร์ดแวร์
1. ADMIN กดเริ่ม บนเว็บแสดง WAITING
2. ESP32-S3 ดึงคำสั่ง demoPoll ผ่าน HTTPS ทุก 2–3 วินาที และรับ START_DEMO
3. S3 ส่ง RECEIVED จากนั้นเปิด LED เฉพาะชั้น/มื้อที่เลือกและเริ่ม DFPlayer ส่ง REMINDER_STARTED
4. DFPlayer เล่นเสียงแจ้งเตือนเสร็จ S3 ส่ง VOICE_DONE
5. ผู้สาธิตกดปุ่ม **ที่ตู้** ค้าง 3 วินาทีเพื่อปลดกลอน ส่ง LOCK_OPENED (เว็บไซต์ไม่สามารถปลดล็อกตู้โดยตรง)
6. Reed Switch ตรวจพบเปิดประตู ส่ง DOOR_OPENED เมื่อปิดสนิท ส่ง DOOR_CLOSED
7. กดปุ่มยืนยันบนตู้ ส่ง CONFIRMED; การกดไม่ใช่หลักฐานว่ากลืนยา
8. S3 เรียก ESP32-CAM ผ่าน Wi-Fi (ไม่ใช้สายสัญญาณ GPIO ต่อกัน) ให้ถ่ายภาพ หากต้องการ preview ส่ง demoPhoto JPEG thumbnail แล้วรายงาน PHOTO_CAPTURED
9. เมื่อทุกขั้นตอนเสร็จและดับ LED กลับสู่สถานะพร้อมใช้งาน S3 ส่ง COMPLETE จากนั้นเว็บแสดง DONE และส่ง LINE [DEMO] เฉพาะเมื่อเลือกไว้

ข้อ 2–9 คือ **ข้อกำหนดของเฟิร์มแวร์ที่ต้องทำและทดสอบเพิ่มเติม** ไม่ใช่ผลการทดสอบฮาร์ดแวร์ที่ผ่านแล้ว

## Device API (HTTPS POST ไปยัง Apps Script Web App URL /exec)

ทุก request ของอุปกรณ์ส่ง deviceKey ตรงกับ Script Property DEVICE_API_KEY และ deviceId ตรงกับ DEMO_DEVICE_ID (ค่าเริ่มต้น S3-001). Script Properties ต้องตั้งในบัญชี Time4Med เอง ห้ามส่ง key ใน GitHub.

### demoPoll
Request:
{"action":"demoPoll","deviceKey":"<SECRET>","deviceId":"S3-001"}

Response ขณะเริ่ม:
{"ok":true,"command":"START_DEMO","demoId":"demo-uuid","demoOnly":true,"patientId":"P001","shelf":1,"mealType":2,"expiresAt":1793270000000}

หากไม่มีคำสั่ง: {"ok":true,"command":"NONE"}
หากยกเลิกหรือหมดเวลา: {"ok":true,"command":"STOP_DEMO","demoId":"demo-uuid"}

**S3 จะได้รับ START_DEMO ซ้ำ** ในแต่ละ poll จนเสร็จหรือหยุด ต้องจำ demoId ใน RAM และไม่เล่นเสียงซ้ำหรือปลดกลอนจากคำสั่งซ้ำ

### demoEvent
Request ตัวอย่าง:
{"action":"demoEvent","deviceKey":"<SECRET>","deviceId":"S3-001","demoId":"demo-uuid","phase":"REMINDER_STARTED"}

Supported phases:
RECEIVED, REMINDER_STARTED, VOICE_DONE, LOCK_OPENED, DOOR_OPENED, DOOR_CLOSED, CONFIRMED, PHOTO_CAPTURED, COMPLETE, ERROR.

COMPLETE ต้องได้รับทุก phase ก่อนหน้าแล้ว; ERROR ระบุฟิลด์ note เพื่อแสดงสาเหตุ (ข้อความสั้น). การส่ง phase ควรเป็นไปตามเหตุการณ์จริงของบอร์ดเท่านั้น.

### demoPhoto (ไม่บันทึก Drive)
Request:
{"action":"demoPhoto","deviceKey":"<SECRET>","deviceId":"S3-001","demoId":"demo-uuid","jpegBase64":"<THUMBNAIL_BASE64>"}

JPEG thumbnail base64 ต้องไม่เกิน 60,000 อักขระ; server ตรวจส่วนหัว JPEG และเก็บใน CacheService ชั่วคราว จากนั้นผู้ดูแล ADMIN เห็นภาพที่หน้าโหมดสาธิตได้. ถ้า CAM อยู่คนละบอร์ด ให้ S3 รับภาพจาก CAM ทาง HTTP ภายใน Wi-Fi แล้วส่งต่อ หรือต่อยอดให้ CAM อัปโหลดได้โดยตรงในรุ่นถัดไป.

## การดูแลความปลอดภัย/แยกโหมดจริง
- ห้ามใช้ normal intake, image, schedule update และ normal activity logging ระหว่างการสาธิต เพราะเส้นทางปกติเขียนลง Sheets/Drive
- เฟิร์มแวร์ต้องตรวจ demoOnly และส่งเฉพาะ demoEvent/demoPhoto ในรอบสาธิต โดยไม่เปลี่ยนกำหนดเวลาจาก RTC หรือ Google Sheets
- ไม่เปิดรีเลย์เพียงเพราะได้รับ START_DEMO; ให้กดปุ่มจริงบนตู้และตรวจ Reed Switch
- เมื่อได้รับ STOP_DEMO/timeout ต้องหยุดเสียง ดับ LED สาธิต และคืนสถานะปกติ
- หากบอร์ดไม่ได้เชื่อม HTTPS ระบบจะขึ้น WAITING/TIMED_OUT ไม่แกล้งแสดงสถานะสำเร็จ
- การทดสอบต่อหน้ากรรมการควรใช้ตู้เปล่า และมีการยืนยันพฤติกรรมจริงของ ESP32-S3, DFPlayer, รีเลย์, reed switch, ESP32-CAM และ LINE แยกเป็นรายขั้น

## สถานะ
พร้อมใน branch release/gas-only-20261029: UI ของ ADMIN, API Start/Stop/Poll/Event, CacheService, thumbnail/LINE แบบเลือกส่ง และ offline tests.
ยังไม่พร้อมใช้งานจริงจนกว่าจะคัดลอก Code.gs + Index.html รุ่นใหม่เข้า Apps Script, กำหนด DEVICE_API_KEY และปรับ/อัปโหลดเฟิร์มแวร์ S3/CAM ที่ใช้อยู่จริงแล้วทดสอบครบทุกส่วน
