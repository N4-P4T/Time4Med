# Time4Med — ข้อตกลงรับส่งข้อมูล ESP32 ↔ Google Apps Script (HTTPS)

Endpoint = URL ของ Apps Script Web App ที่ลงท้าย `/exec` ภายใต้บัญชีเจ้าของ Time4Med (ไม่ใช้ Cloudflare, HiveMQ, MQTT)

ทุก request เป็น HTTPS POST, body ชนิด `application/json` หรือ `text/plain` ที่บรรจุ JSON และต้องมี `deviceKey` ตรงกับ `DEVICE_API_KEY` ใน Script Properties (อย่าปัก key ลง GitHub หรือ Serial Monitor)

## 1. ขอรายการยา
```json
{"action":"pullSchedule","deviceKey":"<DEVICE_API_KEY>"}
```
Response: `{"ok":true,"timezone":"Asia/Bangkok","schedules":[{"id":"...","patientId":"P001","shelf":1,"mealType":2,"time":"08:00","days":"MON,TUE,WED,THU,FRI,SAT,SUN"}]}`

Firmware ใช้รายการเฉพาะ `P001/P002/P003`, และเก็บตารางลงหน่วยความจำอย่างปลอดภัยเป็น snapshot ก่อนเปลี่ยนจริง (ไม่ลบตารางเดิมหากดาวน์โหลดล้มเหลว). ไฟ LED ต้องติดเฉพาะมื้อของแต่ละคน: 1–2 เช้า, 3–4 กลางวัน, 5–6 เย็น, 7 ก่อนนอน. หลายคนติดพร้อมกันได้.

## 2. สถานะ ESP32-S3
```json
{"action":"heartbeat","deviceKey":"<DEVICE_API_KEY>","deviceId":"S3-001","lock":"LOCKED","rssi":-54}
```
ส่งเมื่อระบบพร้อมและทุกประมาณ 60 วินาที; เว็บไซต์มองว่าออนไลน์เฉพาะ last_seen ใหม่กว่า 3 นาที. ไม่มี MQTT อีกต่อไป.

## 3. ผู้สูงอายุกดยืนยัน
```json
{"action":"intake","deviceKey":"<DEVICE_API_KEY>","deviceId":"S3-001","patientId":"P001"}
```
เนื่องจากระบบไม่มีเซนเซอร์แยกคนด้วยใบหน้า ต้องกำหนดผู้สูงอายุจากชั้นที่เปิด / ตารางยาที่อยู่ระหว่างการแจ้งเตือนอย่างชัดเจนก่อนส่ง event; ห้ามเดา patientId จากปุ่มรวม. กดยืนยันคือเหตุการณ์กดปุ่ม ไม่ใช่ข้อพิสูจน์ว่ากลืนยา.

## 4. เหตุฉุกเฉิน
```json
{"action":"emergency","deviceKey":"<DEVICE_API_KEY>","deviceId":"S3-001","patientId":"ALL"}
```
**ปุ่มฉุกเฉินที่เป็นปุ่มรวมของตู้** ใช้ `patientId: "ALL"` (หรือไม่ส่งฟิลด์นี้) เพื่อแจ้งเตือนผู้รับที่เปิด LINE ทุกคน ไม่บันทึกว่าผู้สูงอายุ P001 เป็นผู้กดโดยไม่มีหลักฐาน; หากมีหลักฐานระบุตัวบุคคลจริงจึงใส่ `P001`–`P003`.

## 5. ภาพจาก ESP32-CAM
```json
{"action":"image","deviceKey":"<DEVICE_API_KEY>","patientId":"P002","jpegBase64":"<JPEG_BASE64>"}
```
ไม่เกิน JPEG 1.2 MB. โค้ด Apps Script จะสร้างไฟล์ในโฟลเดอร์ Drive ที่ตั้ง `IMAGE_FOLDER_ID` และเพิ่มแถว `ImageIndex`. การถ่ายภาพต้องอ้างอิงคนที่ตู้กำลังแจ้งเตือน ไม่ใช้ภาพเก่าจากกล้องเป็นหลักฐานอัตโนมัติ.

## ข้อจำกัด
- ขณะนี้ยัง **ไม่มีโค้ดฝั่ง ESP32-S3/CAM ที่ดัดแปลงตาม protocol นี้** อยู่ในชุด Release ต้องแก้และทดสอบจาก `.ino` ที่ใช้อยู่จริง ไม่ควรคาดเดา GPIO หรือเปลี่ยนระบบไฟเดิม
- Apps Script ContentService อาจ redirect response ไปที่ `script.googleusercontent.com`; ไคลเอนต์ HTTP ต้องรองรับ redirect อย่างปลอดภัยและตรวจ TLS
- หาก Wi-Fi หรือ Apps Script ล่ม อุปกรณ์ควรใช้ตารางยาในเครื่องและทำงานเตือนเสียง/LED แบบออฟไลน์ต่อไป พร้อมคิวส่งเหตุการณ์ย้อนหลังเมื่อกลับมาเชื่อมต่อ
- **ไม่เปิด remote lock จาก website** ใน release นี้เพราะ Apps Script ไม่สามารถยิงคำสั่งเข้าสู่ ESP32-S3 หลังเราเตอร์ได้ตรง ๆ และยังไม่มีการยืนยันคำสั่งจาก firmware