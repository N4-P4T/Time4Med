# Time4Med Stage 4 — เฟิร์มแวร์ตู้ยาจริง + HTTPS Status Staging

**ฐานที่ใช้**: ไฟล์ที่ผู้พัฒนายืนยันว่าเป็นตัวล่าสุด ณ 15 ต.ค. 2569 `Time4Med_ESP32S3_MQTT(2).ino` (`FIRMWARE_VERSION = 0.11.0-safe-schedules`).

## พี่ปรับอะไรไปแล้ว

- เพิ่ม `Time4MedStatusSender.h` (HMAC SHA-256, nonce, HTTPS TLS verified, จำกัด timeout)
- เชื่อมสถานะจริง `lockIsUnlocked`, `doorIsClosed()`, `emergencyIsActive()`, `rtcTimeValid`, `systemStateName()` กับข้อมูลส่ง Cloudflare
- ส่งสถานะใน **FreeRTOS task priority ต่ำ** ผ่าน queue ขนาด 1 (เอาค่าล่าสุด), ไม่ให้ TLS/HTTP `POST` หยุดลูปตรวจปุ่ม/ประตู/กลอน/เสียง/เวลา
- ส่งเมื่อสถานะเปลี่ยน (คั่นอย่างน้อย 2 วินาที) หรือทุก 60 วินาที
- คง GPIO, DFPlayer, RTC, OLED, ESP32-CAM, MQTT, การล็อก/ปลดล็อก และตารางยาเดิมไว้ **ไม่แก้ flow**
- ปิด HTTPS telemetry เป็นค่าปริยาย (ไม่มี Key หรือ verified Root CA ก็ไม่สร้าง task และไม่ส่งออก)

## ข้อสำคัญก่อนคอมไพล์/อัปโหลด

1. สำรองสเก็ตช์ล่าสุด และ **ใช้สำเนาโฟลเดอร์ใหม่** `Time4Med_Cabinet_Stage4` แยกจากของเก่า
2. นำไฟล์ private/local ที่มีอยู่แล้ว **จากคอมพิวเตอร์ของผู้พัฒนา** ใส่ในโฟลเดอร์ใหม่:
   - `secrets.h` (ห้ามเผยแพร่)
   - `mqtt_certs.h`
   - `google_certs.h`
   - `network_config.h`
3. Libraries ตามโค้ดต้นฉบับ: `MQTT` (256dpi), `RTClib` (Adafruit), `U8g2`, `DFRobotDFPlayerMini`, ESP32 core
4. *ยังไม่ต้องสร้าง* `telemetry_private.h`: แบบนี้คอมไพล์/ทดลองวงจรเดิมได้โดย telemetry ใหม่ยัง **DISABLED**; ต้องมี RTC DS3231 จริงจึงผ่าน boot เดิม
5. เมื่อพร้อมทดสอบ HTTPS จริง คัดลอก `telemetry_private.h.example` เป็น `telemetry_private.h` **ในเครื่องเท่านั้น**, กรอก HMAC 64 hex ที่ตรงกับ Secret ของ `time4med-api-staging`, ใส่ verified Root CA PEM สำหรับโดเมน workers.dev เป้าหมายให้ตรง ใช้ HTTPS `/api/device/telemetry`.
6. **อย่าเปิด HMAC หรือใบรับรองที่ยังไม่ตรวจสอบ:** การที่เคยผ่าน TLS ที่ `www.google.com` ไม่ยืนยัน certificate chain ของ Worker.
7. ห้ามนำไฟล์ `telemetry_private.h`, `secrets.h`, ค่า Secret ขึ้น GitHub / ส่งแชต / ถ่ายภาพ.

## แนวทางทดสอบความปลอดภัยเมื่อกลับถึงตู้ยา

- ต่อฮาร์ดแวร์ RTC, OLED, DFPlayer, Reed Switch และ Confirm ก่อน เพื่อไม่ให้ `RTC ERROR` จากการถอด PCB ไปตัดสินว่าระบบเสีย
- ทดสอบบนโต๊ะ/ตู้จำลองก่อน โดย **ตัดไฟ 12V ของกลอน** และไม่มีการใช้งานยาในชีวิตจริง
- ติดตาม Serial `[T4M HTTPS] DISABLED` ก่อนเปิดส่ง
- ทดสอบการกด Confirm, Emergency, Reed, ปิดประตูให้สนิท, แจ้งเสียง, NVS schedules เหมือนเดิม
- หลังการตรวจ CA ของ Worker และเพิ่ม key เฉพาะ Staging เท่านั้น ดู Serial `[T4M HTTPS] STATUS_OK` และตรวจ Google Login หน้า Staging แสดง LIVE; ปิด Wi-Fi แล้วรอเกิน 150 วินาทีเพื่อให้แสดง STALE
- ความสามารถ Remote Lock ผ่าน MQTT ในของเก่า **ยังอยู่** แต่ไม่ได้ถูกนำเข้าสู่หน้า Staging (หน้านั้น read-only).
- ก่อนเชื่อมบริการหลักต้องทำ security review และทดสอบ RTC/Lock/Reminder จริงอีกครั้ง

## สถานะการพิสูจน์

- ฝั่ง Server: ทดสอบ PowerShell HMAC→Worker Staging→KV HTTP 200/401/TTL แล้ว
- ฝั่ง Firmware: โค้ด Stage4 ได้เชื่อมจริงในระดับ source แต่ **ยังไม่ได้แฟลชบนตู้จริง** และยังไม่ได้ตรวจ TLS chain บน workers.dev จากบอร์ด
- โฟลเดอร์นี้เป็น candidate สำหรับการคอมไพล์ / bench test ไม่ใช่ firmware พร้อมใช้งานกับผู้ป่วย
- ESP32-S3 ล่าสุดบนโต๊ะยังเป็น `Network Probe v0.3` ไม่ใช่โค้ดนี้

## รายการทดสอบบน GitHub

Static source assertions และ Arduino ESP32-S3 compile with *mocked private headers* ใน CI มีหน้าที่ค้นหา compile errors; **ไม่ใช้ credentials ใด** และไม่รับประกันผลไฟฟ้าจริง/RTC/DFPlayer จริง.
