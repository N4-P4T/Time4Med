# Time4Med — ย้ายเว็บไซต์ GitHub Pages ให้ใช้ Google Apps Script

## สถานะ (29 ต.ค. 2569)
โค้ดในสาขา `release/gas-only-20261029` เปลี่ยน **เว็บไซต์ GitHub Pages เดิม** ให้เรียก backend ใหม่ โดยเก็บโลโก้ เมนูด้านข้าง ส่วนหัว และ CSS เดิมไว้ และมีหน้าสำหรับ Dashboard, ตารางยา, ผังชั้น, อุปกรณ์, กิจกรรม, คลังรูป, ADMIN และ LINE test

- ไม่โหลด Cloudflare Workers, Google OAuth เดิม, HiveMQ หรือ MQTT JavaScript ในหน้าเว็บใหม่นี้
- GitHub Pages ยังเป็น frontend หลัก: `https://n4-p4t.github.io/Time4Med/`
- Google Apps Script ใช้เฉพาะ backend เพื่อสิทธิ์, OTP, Sheets, Drive และ LINE ผ่าน iframe RPC bridge (ไม่ใช้ JSONP และไม่ฝัง token ลับใน GitHub)
- คนละ deployment URL จนกว่าเจ้าของจะติดตั้งไฟล์ใหม่และ Deploy
- การทดสอบใน GitHub Actions เป็นการทดสอบ **ออฟไลน์เท่านั้น** ไม่ใช่หลักฐานว่า Google/LINE/ESP32 ใช้งานกับเว็บ GitHub จริงครบแล้ว
- ยังไม่แก้เฟิร์มแวร์ ESP32 ในงานย้ายเว็บนี้ และ LED 12 ดวงยังไม่กำหนด GPIO

## ติดตั้ง Apps Script ก่อนเปิดเว็บไซต์รุ่นใหม่
1. สำรองโปรเจ็กต์ `Time4Med-System` ที่ใช้จริง
2. เปิดไฟล์ `apps-script/Code.gs` จาก **สาขา release/gas-only-20261029** แล้วคัดลอกไปแทน `รหัส.gs` ใน Apps Script
3. ใน Apps Script คลิกเครื่องหมาย + ข้าง “ไฟล์” → **HTML** → ตั้งชื่อ `Bridge` (ไม่มีนามสกุล) แล้วคัดลอกเนื้อหา `apps-script/Bridge.html` จาก GitHub ไปวาง
4. **อย่าลบไฟล์ `Index.html`** ที่ Apps Script มีอยู่ หน้า Web App แบบเดิมยังใช้ได้
5. เลือก **ทำให้ใช้งานได้ → จัดการการทำให้ใช้งานได้ → ไอคอนดินสอ → เวอร์ชันใหม่ → ทำให้ใช้งานได้** ใน deployment URL เดิมที่อยู่ในซอร์ส
6. ยืนยันว่า Web App ยังคง “เรียกใช้ในฐานะ: ฉัน (Me)” และการเข้าถึง “ทุกคน (Anyone)” เพราะ server ใช้ OTP/สิทธิ์จากชีตแทน Google OAuth; ห้ามใส่ API keys ใน GitHub
7. คง Script Properties `LINE_REMINDERS_ENABLED=FALSE` และ `IMAGE_RETENTION_ENABLED=FALSE` ระหว่างทดสอบ

## เปิด GitHub Pages เวอร์ชันใหม่
- หลัง Deploy Apps Script พร้อม `Bridge.html` แล้วจึง Merge PR ที่เสนอเข้า `main`; GitHub Pages จะใช้ไฟล์ `index.html` ไปยัง `test-v021/` ที่อัปเดต
- ก่อน Merge เว็บไซต์ GitHub ที่ใช้อยู่ยังเป็นเวอร์ชันเดิม ไม่มีการกระทบ
- เปิดเว็บในโหมดส่วนตัวเพื่อทดสอบ OTP บน GitHub, Dashboard, สิทธิ์ผู้ดูแล, บันทึกยา, กล้องในคลังภาพ, LINE ทดสอบของ ADMIN
- ถ้าแสดง “ยังเชื่อม Apps Script ไม่ได้” ให้เช็ก `Bridge.html` และว่ากด **เวอร์ชันใหม่** ของ deployment เดิมแล้ว; ถ้าติดขัดที่ iframe/คุกกี้ข้ามเว็บไซต์ให้บันทึกภาพ Console/Network ก่อนสรุปว่าใช้งานได้
- หากทดสอบไม่ผ่านให้ย้อนกลับ PR/commit บน main; Apps Script เดิมยังเปิดได้ที่ URL `/exec`

## ฟังก์ชันและข้อจำกัดปัจจุบัน
- ใช้ Google Sheets `MealMedicines` เป็นฐานข้อมูลรายการยาและตารางเวลา `P001–P003`; `P001=ชั้น1`, `P002=ชั้น2`, `P003=ชั้น3`, ชั้น 4 ยาสามัญไม่มี LED
- แอดมินจัดการบัญชีและทดสอบ LINE ได้ ส่วนผู้ดูแลเห็นเฉพาะ P ที่ได้รับสิทธิ์จากเซิร์ฟเวอร์
- `readImage` เปิดภาพบน Drive หลังผ่านสิทธิ์ผ่าน Apps Script; รูปเก่าที่ยังไม่อัปโหลดจาก SD Card จะเปิดไม่ได้
- ไม่มี remote lock และไม่มี live stream ที่เข้าจากอินเทอร์เน็ตได้ เพราะ ESP32-CAM อยู่บน private IP และเว็บ Github ใช้ HTTPS
- รายการ “มื้อยาถัดไปวันนี้” เป็นสรุปเวลาในวันนั้นอย่างง่าย ไม่ได้คำนวณวันแจ้งเตือนรายรายการ/บันทึกการกลืนยา; ไม่ใช้เป็นผลยืนยันทางการแพทย์
- LINE scheduled trigger **ยังไม่เปิดอัตโนมัติ**; ต้องตรวจตารางยาและสิทธิ์ผู้รับ LINE ก่อนเปิด `TRUE`
- ระบบ iframe/postMessage ต้องทดสอบบนเบราว์เซอร์และ deployment จริงอีกครั้งก่อนประกาศว่าสมบูรณ์
