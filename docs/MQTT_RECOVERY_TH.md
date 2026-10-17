# Time4Med — MQTT recovery / การตรวจสอบการเชื่อมต่อ

สถานะ: **ขั้นเตรียมตรวจสอบ ไม่ใช่ผลทดสอบบนบอร์ดจริง** (17 ตุลาคม 2569)

## 1. ทำไมหน้าเว็บต่อได้ แต่ ESP32-S3 ยังออฟไลน์

เว็บไซต์กับบอร์ดไม่ได้ติดต่อหากันโดยตรง ทั้งสองต้องเชื่อม broker เดียวกัน
- Web browser: WSS / port **8884**, path **/mqtt**
- ESP32-S3: MQTT over TLS / port **8883**
- Broker hostname: ดูจาก HiveMQ Overview เทียบกับค่าใน \`mqtt-config.js\` และ \`secrets.h\`
- Topic namespace: \`time4med/v1/cabinet/cabinet-01/\`

การเชื่อมเว็บไซต์สำเร็จแปลว่า **เฉพาะเว็บเชื่อม Broker ได้** ไม่ได้ยืนยันว่าอุปกรณ์ออนไลน์

## 2. เริ่มทดสอบแบบไม่แตะกลอน

หน้า [เครื่องมือ MQTT](../tools/mqtt-diagnostics.html) เมื่อเผยแพร่ผ่าน GitHub Pages:
- ใช้ credentials ที่ผู้ดูแลกรอก *เฉพาะในหน้าเว็บครั้งนั้น* ไม่ฝังรหัสในไฟล์
- ตรวจว่าบัญชีเว็บ CONNECT และ SUBSCRIBE ได้ไหม
- แสดงสถานะสดของ ESP32-S3 เทียบกับ retained status
- อ่าน \`status\`, \`event\`, \`schedule\` ตาม namespace
- ปุ่ม LIST ส่งคำสั่ง *อ่านตารางยา* เท่านั้น; ไม่ส่ง LOCK/UNLOCK, SET, DELETE หรือ CLEAR

> หากมีสถานะ retained ว่า online=true นั่นอาจเป็นข้อมูลเก่า ต้องรอ heartbeat สดจาก ESP32 ก่อนสรุปว่าออนไลน์

## 3. MQTT topic matrix

| Topic suffix | Direction | Payload |
|---|---|---|
| \`status\` | ESP32 → broker → web | JSON: \`online\`, \`lock_status\`, \`rtc_valid\`, \`system_state\` |
| \`event\` | ESP32 → broker → web | JSON: \`event\`, \`detail\` |
| \`command/lock\` | web → ESP32 | text: \`LOCK\` or \`UNLOCK\` |
| \`command/schedule\` | web → ESP32 | text: \`LIST\`, \`SET|U001|08:30|AFTER_BREAKFAST\`, \`DELETE|...\`, \`CLEAR|U001\` |
| \`schedule\` | ESP32 → broker → web | **One JSON object per enabled slot**: \`slot\`, \`user_id\`, \`compartment\`, \`time\`, \`meal\` |

**Important protocol mismatch:** currently published \`schedule-sync.js\` uses
\`schedule/get\`, \`schedule/set\`, \`schedule/reported\` with protocol-v1 JSON
and an atomic acknowledgement. The inspected ESP32 v0.11.0 firmware listens
to \`command/schedule\` with pipe-delimited text and reports *individual* entries
on \`schedule\`, with **no batch completion/atomic ACK**.

Therefore the existing web sync button must **not** be considered working with
this firmware. Do not push a batch by simply changing topic names: \`CLEAR\`/
\`SET\` could partially update medication schedules. Implement and test an
acknowledged, versioned protocol on both sides before switching production sync.

## 4. Hardware-side checks

1. เปิด Serial Monitor 115200 และยืนยัน Wi-Fi connected พร้อม IP จริง
2. ตรวจ \`secrets.h\` *เฉพาะบนเครื่องส่วนตัว* เทียบกับ HiveMQ Credentials; ชื่อ \`time4med-esp32s\` และ \`time4med-esp32s3\` ไม่ใช่ชื่อเดียวกัน
3. ตรวจ host/port 8883, เวลา RTC/NTP ที่ใช้กับ TLS, และ Root CA ที่โปรเจกต์ระบุไว้
4. ตรวจ CONNECT return code / TLS error; \`[BOOT] MQTT configuration complete\` ไม่ได้แปลว่า CONNECT สำเร็จ
5. ดู heartbeat สด (เฟิร์มแวร์มีค่าเริ่มต้นส่งทุก 60 วินาทีในเวอร์ชันที่ตรวจ)
6. เมื่อดู status/events ได้แล้ว ค่อยทดสอบ LOCK/UNLOCK โดยตัดไฟ 12V ของกลอนก่อนและทำตามขั้นตอนทดสอบความปลอดภัย

## 5. ความปลอดภัย

\`mqtt-config.js\` ใน branch \`main\` ยังมีรหัสผ่านที่เคยเผยแพร่ใน GitHub Pages (และอาจอยู่ใน Git history).
ถือว่ารหัสนั้น **ไม่ปลอดภัยแล้ว**: หมุนเวียน credentials ใน HiveMQ,
เพิกถอนรหัสเดิม, ใช้บัญชี/ACL แยกตามหน้าที่ และย้ายคำสั่งกลอนผ่าน backend
ที่ตรวจสิทธิ์ก่อนเปิดระบบให้ผู้อื่นใช้งานจริง

**ห้ามอัปโหลด** \`secrets.h\`, \`*.env\` หรือ token ขึ้น GitHub

## 6. ขั้นตอนถัดไป

- นำไฟล์ .ino เวอร์ชัน **ที่อยู่บนบอร์ดจริงในขณะนี้** มาเทียบกับ v0.11.0 ที่เคยสร้าง
- เพิ่มการแสดงผล Wi-Fi/MQTT state และ certificate/connection error ในเฟิร์มแวร์เวอร์ชันถัดไป
- กำหนดคำสั่งตารางยาแบบ versioned JSON พร้อม correlation ID และ ACK
- ทดสอบโดยไม่ต่อไฟกลอน ก่อน deploy รุ่นที่แก้ไขเข้าระบบใช้งานจริง
