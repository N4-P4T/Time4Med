# Time4Med — ขั้นที่ 3: ESP32-S3 ส่งสถานะไป Cloudflare ผ่าน HTTPS

**สถานะ 17 ตุลาคม 2569: โค้ดแยกโมดูลเพื่อทดสอบ ยังไม่อัปโหลดลงบอร์ดจริงหรือ Deploy Cloudflare Worker**

## ตรวจพบจากไฟล์เฟิร์มแวร์เดิม

- Time4Med_ESP32S3_MQTT(2).ino ระบุ FIRMWARE_VERSION = 0.11.0-safe-schedules แต่ยังไม่ยืนยันว่าไฟล์เดียวกับที่แฟลชอยู่บนบอร์ดจริง
- เฟิร์มแวร์เดิมใช้ WiFi, WiFiClientSecure, HTTPClient อยู่แล้วสำหรับ Apps Script และมีการส่งสถานะ MQTT จาก publishDeviceStatus()
- มีสถานะ lockIsUnlocked, doorIsClosed(), emergencyIsActive(), rtcTimeValid, systemStateName() จึงใช้ข้อมูลเดิมส่งต่อได้โดยไม่แก้ GPIO
- มีระบบ RTC, DFPlayer, วงจรกลอน, ESP32-CAM และการแจ้งเตือนยา ซึ่งต้องไม่ถูกขัดจังหวะเพราะ HTTP request ใหม่

## โมดูลที่เพิ่ม

- firmware/telemetry_v025/Time4MedStatusSender.h: ทำ JSON สถานะ, สร้าง nonce 128 บิต, เซ็นข้อความ HMAC-SHA256, ส่ง POST HTTPS โดยตรวจ TLS Certificate จริง
- firmware/Time4MedTelemetry_Probe/Time4MedTelemetry_Probe.ino: โค้ดคอมไพล์ทดสอบเท่านั้น ไม่มี Wi-Fi connect, HTTP POST, MQTT, GPIO, relay หรือการล็อก/ปลดล็อก
- tests/esp32-telemetry-contract.test.mjs: ตรวจ payload, ลายเซ็น HMAC ตัวอย่างกับ Backend และตรวจว่าไม่มีการปิด TLS verification
- .github/workflows/esp32-telemetry-v025-check.yml: รัน node tests และคอมไพล์บน GitHub runner โดยใช้ Arduino ESP32-S3 core

## หลักการเชื่อมต่อ

ESP32-S3 → TLS-verified HTTPS POST /api/device/telemetry → Cloudflare Worker v0.25 → KV → Google-authorized GET /api/devices/status → Website

โครงสร้าง JSON สถานะมีเฉพาะ device_id, online, lock_status, door_status, emergency, rtc_valid, system_state และ reason ไม่มีชื่อ/อีเมลผู้สูงอายุ

Backend ตรวจ X-T4M-Timestamp, X-T4M-Nonce และ X-T4M-Signature โดยเซ็นคำสั่งต้นฉบับเรียงตามนี้:

    T4M-STATUS-V1
    /api/device/telemetry
    <UNIX_TIMESTAMP_UTC>
    <RANDOM_NONCE_32_HEX>
    <JSON_BODY>

โมดูลเซ็นข้อมูลด้วยกุญแจ 32 ไบต์ (64 ตัวอักษรฐานสิบหก) ที่อยู่ในไฟล์ความลับเฉพาะอุปกรณ์ ไม่ใช่รหัส HiveMQ หรือ Google

## การตั้งค่าที่ต้องทำโดยผู้พัฒนา เมื่อเตรียมทดสอบ Hardware จริง

1. Deploy Cloudflare Worker v0.25 ไปที่ staging ก่อน (แยกจาก production), ตั้ง Google OAuth/Sheets environment และ KV binding ชื่อ DEVICE_STATUS_KV
2. ตั้ง Cloudflare Secret DEVICE_STATUS_HMAC_KEY และกุญแจ 32 ไบต์ชุดเดียวกันในไฟล์ private ของ ESP32-S3 โดยไม่เผยแพร่ลง GitHub
3. ตั้ง Endpoint HTTPS ที่ลงท้ายด้วย /api/device/telemetry และ Root CA PEM **ที่ตรวจสอบแล้วสำหรับโดเมน Cloudflare Worker ที่ใช้จริง**
4. ก่อนส่งต้องแน่ใจว่า Wi-Fi ต่อสำเร็จและ NTP ให้ Unix UTC time ถูกต้อง (RTC เครื่องใช้เวลาท้องถิ่น; ไม่สามารถนำมาใช้เป็น Unix UTC แบบตรง ๆ)
5. ออกแบบเรียกส่ง HTTP ใน task คิวแยก / ช่วงที่ปลอดภัย เพื่อไม่ให้ TCP/HTTPS timeout ชะลอเสียงแจ้งเตือนหรือการทำงานกลอน
6. ทดสอบที่ตู้จำลองโดยยังไม่จ่ายไฟ 12V ให้กลอน และตรวจ Serial ว่า Backend ตอบ HTTP 200
7. เมื่อได้รับ POST สำเร็จ ล็อกอิน Google ใน Dashboard และตรวจสถานะ NO_DATA → LIVE → STALE โดยทดสอบถอด Wi-Fi หรือปิดอุปกรณ์

## ตัวอย่างการเรียกใช้งานหลังผ่านการทดสอบ (ยังไม่ให้คัดลอกลง Firmware หลักในขั้นนี้)

ในเฟิร์มแวร์หลักของ Time4Med เดิม สามารถสร้างข้อมูล Status ด้วยค่า:

- lockIsUnlocked (ตัวแปรสถานะกลอน)
- doorIsClosed() (Reed Switch)
- emergencyIsActive() (Emergency Button)
- rtcTimeValid
- systemStateName()
- reason = HEARTBEAT

จากนั้นเรียก Sender.send(status) เฉพาะเมื่อ Scheduler อนุญาตให้ Task เครือข่ายทำงาน การเรียก send() เป็น blocking HTTP จึง **ห้ามเพิ่มลง loop() ทุกครั้งหรือใน callback ฉุกเฉินโดยตรง**

## สิ่งที่ยังไม่เสร็จ

- ไม่ได้เชื่อม Sender นี้กับ firmware หลัก 0.11.x, ไม่มีการแฟลชเครื่องจริง
- ยังไม่ทราบว่าเฟิร์มแวร์บนบอร์ดปัจจุบันตรงกับไฟล์ตัวอย่างหรือไม่
- ยังไม่ได้สร้าง Cloudflare KV/Secret และไม่มีสิทธิ์ Deploy Worker ที่ใช้งานจริงจาก GitHub connector
- ยังไม่ได้ทดสอบ Certificate Chain บน Wi-Fi ของเครื่องจริง
- นี่เป็นการ **ส่งสถานะทางเดียว** ไม่ใช่การส่งตารางยาจากเว็บลงอุปกรณ์หรือการยืนยันรับประทานยา

**ผู้ดูแลจะไม่ต้องเห็น HiveMQ หรือกรอกรหัสใดนอกจาก Google Login; การตั้งค่ากุญแจและ Worker เป็นหน้าที่ของผู้พัฒนาเพียงครั้งเดียว**
## ทดสอบครบเส้นทางโดยไม่ใช้บอร์ดจริง (Virtual Cabinet)

- เพิ่ม tests/virtual-esp32-end-to-end.test.mjs เพื่อจำลองข้อมูลสถานะจาก ESP32-S3 แล้วเซ็น HMAC ด้วยกุญแจจำลอง
- ส่ง JSON ตัวอย่างผ่าน **โค้ด Worker v0.25 ตัวจริงในสภาพแวดล้อมทดสอบ**, เก็บผลใน KV จำลอง; ไม่มีการส่งไป Cloudflare production
- ใช้ Google ID Token ที่ลงนามด้วย RSA key จำลอง (ไม่ใช้บัญชี Google จริง) เพื่อเข้าหน้าแดชบอร์ด
- เปิด Chromium ให้ทดสอบ Dashboard ตอน NO_DATA, LIVE ปิด/ล็อก, LIVE เปิด/ปลดล็อก/ฉุกเฉิน, STALE, และ LOGOUT
- ทดสอบว่าระบบส่ง Bearer token ให้ Backend จริง ไม่แสดงสถานะเมื่อยังไม่ได้ login และล้างสถานะเมื่อออกจากระบบ
- การผ่านการทดสอบเป็นเพียง **Software integration test** ไม่ใช่หลักฐานว่า ESP32-S3 หรือ Cloudflare Workspace จริงสื่อสารกันแล้ว

ผลการทดสอบดูที่ GitHub Actions ของ PR #17 (Stage 3) จากไฟล์ esp32-telemetry-v025-check.yml

## เมื่อตัว ESP32-S3 กลับมาอยู่ใกล้ตัว

ยังไม่ต้องเสียบสายเพิ่มหรือเปลี่ยน GPIO; เริ่มจากถ่าย Serial Monitor ขณะเปิดเครื่องเดิมเพื่อยืนยันเวอร์ชันจริง เทียบกับไฟล์ต้นแบบ 0.11.0-safe-schedules แล้วค่อยกำหนดช่วงเวลาอัปเดตสถานะและ Secrets สำหรับ staging แบบปลอดภัย