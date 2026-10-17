# Time4Med v0.23 — Staging Gateway และ Firmware Transaction

**สถานะ: ตัวอย่างที่ผ่านการคอมไพล์/ทดสอบจำลองเท่านั้น ยังไม่ได้ติดตั้ง Cloudflare Worker หรือแฟลช ESP32-S3 จริง**

## Backend Gateway

- backend/worker-v020-preview.mjs ต่อยอดจาก Worker v0.19 เดิมโดยใช้ Google ID token, Google Sheets และตาราง Users สำหรับอนุญาต
- GET /api/cabinets/cabinet-01/schedule/preview ให้เฉพาะ ADMIN เพื่ออ่านรายการยา/ผู้สูงอายุจาก Google Sheets ที่ฝั่ง Worker ไม่รับตารางหรือ patient ID จากเบราว์เซอร์
- แยก P001→U001 กล่อง 1, P002→U002 กล่อง 2, P003→U003 กล่อง 3; ยา PRN ไม่ถูกกำหนดเวลา; จำกัดสูงสุด 18 รอบ
- คำนวณ SHA-256 สำหรับ revision16 และ FNV-1a 64-bit สำหรับตรวจความครบถ้วนของข้อมูล (FNV ไม่ใช่การพิสูจน์ตัวตน)
- POST /api/cabinets/cabinet-01/schedule/commit ส่ง HTTP 503 SCHEDULE_GATEWAY_DISABLED เสมอ ไม่มีการส่ง MQTT หรือการบันทึกลงอุปกรณ์
- **ยังไม่ได้ Deploy Worker นี้**; โปรดอย่าเปลี่ยน Worker จริงจนผ่านการทดสอบการยืนยันตัวตนและการจัดการ Secrets

## Firmware

- firmware/schedule_v2/Time4MedScheduleEngine.h เป็น C++17 transaction engine ที่ไม่มี GPIO, Wi-Fi หรือ MQTT
- firmware/schedule_v2/ScheduleNvsStorage.h เป็นตัวอย่างอะแดปเตอร์ Preferences ใช้ namespace ใหม่ t4m-sched-v2 เพื่อไม่ทับ time4med-sch เดิม
- firmware/schedule_v2/Time4MedSchedule_Probe.ino เป็นสเก็ตช์แบบอ่านอย่างเดียวสำหรับคอมไพล์บน ESP32-S3 ไม่ใช่โปรแกรมควบคุมตู้ยา
- โปรโตคอล V2: INFO|requestId / BEGIN|requestId|baseRevision16|nextRevision16|count|fnv64 / ENTRY|requestId|index|U001|08:30|AFTER_BREAKFAST / COMMIT|requestId / ABORT|requestId
- COMMIT ใช้ Snapshot ที่รับครบทุกช่อง ตรวจลำดับและ digest แล้วบันทึก Flash ครั้งเดียวพร้อม readback จึงตอบ APPLIED; ถ้าไม่ผ่านตอบ NACK โดยไม่รายงานว่าเสร็จ
- ปฏิเสธคำสั่ง retained, payload ยาวเกิน, count เกิน 18, timestamp หมดอายุ, revision ขัดแย้ง, slot/meal/time ผิด และคำสั่งที่ไม่ผ่านการตรวจ auth flag

## ข้อกำหนดด้านความปลอดภัยที่ยังต้องทำ

1. ตรวจเฟิร์มแวร์ที่อยู่บนบอร์ดจริงก่อนนำ V2 ไปเชื่อม; ไฟล์ต้นแบบที่ค้นพบระบุเวอร์ชัน 0.11.0-safe-schedules ซึ่งอาจไม่ใช่เวอร์ชันบนบอร์ด
2. ก่อน Engine.handle() ในโค้ด production ต้องตรวจ HMAC-SHA256 ครอบ topic+payload+nonce/time โดยใช้ secret ฝั่ง Backend/ESP32, MQTT ACL และ TLS ที่เชื่อถือได้ ห้ามส่ง authenticated=true ตรงจาก MQTT handler
3. กำหนดผู้ควบคุม Transaction ต่ออุปกรณ์แบบหนึ่งคิว ผ่าน Durable Object/Queue + Bridge ที่จัดการ reconnect, at-least-once delivery, retransmission, device ACK และ replay protection
4. ปิดการรับ SET/DELETE/CLEAR legacy ในเฟิร์มแวร์ Production หลังย้ายข้อมูล; ห้ามส่งคำสั่งใหม่เข้าท็อปปิกเก่า
5. หาก NVS ยังไม่มีข้อมูลใน namespace ใหม่ Engine จะ fail closed (STORAGE_UNAVAILABLE) จนกว่าจะมีแผน migrate ตารางเดิมอย่างปลอดภัย
6. ทดสอบขาดไฟระหว่าง COMMIT, RTC เพี้ยน, กลอน/ประตูฉุกเฉิน, ความจุ NVS, ข้อความซ้ำ/หลุด, รีบูต และการยืนยันหลังบันทึก
7. ตัดไฟ 12V ของกลอนและใช้ตู้ทดสอบเท่านั้นก่อนใช้งานจริง ห้ามเปิดโหมดส่งคำสั่งบนตู้ผู้สูงอายุที่กำลังพึ่งพาระบบ

## ตรวจสอบอัตโนมัติ

GitHub Actions ตรวจ Worker syntax, Google Sheets plan validation, C++17 atomic transaction engine with simulated storage failure, stale revision, reboot and integrity tests.

หมายเหตุ: ACK APPLIED เป็นหลักฐานว่าบันทึกตารางตามรูปแบบสำเร็จ ไม่ใช่หลักฐานว่าผู้สูงอายุกลืนยาแล้ว.
## MQTT v2 HMAC และระบบป้องกัน Replay (เพิ่มใน Staging)

- backend/schedule-wire.mjs เป็น helper สร้างซองคำสั่งที่ลง HMAC-SHA256 ด้วยกุญแจ 32 ไบต์ขึ้นไปที่เก็บ **เฉพาะ Backend**; ยังไม่มีตัวเชื่อมต่อ HiveMQ และไม่ publish MQTT
- Topic ที่เตรียมไว้: time4med/v2/cabinet/cabinet-01/schedule/command (ไม่ใช่ Legacy Topic)
- รูปแบบซองคำสั่ง: V2|sequenceNumber|base64(plaintextCommand)|hexHmac64
- MAC ครอบ domain T4M-V2, deviceId, topic, sequence และ Base64 ของคำสั่ง; ป้องกันแก้ข้อความหรือย้ายข้ามตู้/Topic
- firmware/schedule_v2/ScheduleMqttAuth.h ตรวจ HMAC ด้วย mbedTLS และเปรียบเทียบ digest แบบไม่หยุดทันทีเมื่อเจอ byte แตกต่าง
- firmware/schedule_v2/NvsReplayCounter.h ต้องอ่านและบันทึกตัวนับลำดับเพิ่มขึ้นตลอดใน NVS ก่อนเรียก Engine.handle(); หากไม่มีตัวนับที่ provision ไว้ให้ปฏิเสธคำสั่งทั้งหมด
- **สำคัญ:** โค้ด HMAC นี้ยังไม่ได้เชื่อมกับ MQTT callback จริงของเฟิร์มแวร์; ห้ามเรียก Engine.handle(message, true, ...) โดยข้ามการตรวจเฟรม + ตัวนับ Replay
- Future Gateway ต้องมี Durable Object / Queue ที่ออก Sequence Number และจัดงานทีละตู้ ไม่ใช่ให้เบราว์เซอร์สร้าง HMAC เอง
- HMAC แยกต่างหากจากรหัส HiveMQ; ไม่ใส่ไว้ใน GitHub, localStorage หรือไฟล์ .ino สาธารณะ

ผลทดสอบ HMAC ใน tests/schedule-wire.test.mjs เปรียบเทียบกับ Node.js crypto.createHmac ด้วยกุญแจ **สุ่มเฉพาะทดสอบ**; CI คอมไพล์ ESP32-S3 Probe ที่ include header mbedTLS และ NVS โดยไม่เรียกใช้งานฮาร์ดแวร์หรือ NVS จริง.