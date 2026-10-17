# Time4Med — ตารางยารองรับหลายคน: สัญญาการเชื่อมต่อ v0.22 (อ่านอย่างเดียว)

อัปเดต 17 ตุลาคม 2569

## แหล่งที่ตรวจสอบ

- Firmware `Time4Med_ESP32S3_MQTT(2).ino` ที่มีอยู่ในไฟล์โครงงาน: ตัวแปรเวอร์ชัน `0.11.0-safe-schedules`
- Website `test-v021/index.html` อ้าง `test-v019/schedule-sync.js` ที่ยังใช้ JSON `/schedule/set`
- **ไม่สามารถยืนยันได้** ว่าเฟิร์มแวร์ไฟล์ดังกล่าวตรงกับไบนารีที่อัปโหลดอยู่บนบอร์ด ESP32-S3 ปัจจุบัน

## ปัญหาที่พบ

| หัวข้อ | เว็บเก่า `test-v019/schedule-sync.js` | Firmware `0.11.0-safe-schedules` |
|---|---|---|
| ส่งคำสั่ง | `time4med/v1/cabinet/cabinet-01/schedule/set` | `time4med/v1/cabinet/cabinet-01/command/schedule` |
| รูปแบบ | JSON `protocol: 1`, `revision`, `slots` | ข้อความ `SET|USER|HH:MM|MEAL` |
| ขอรายการ | `schedule/get` พร้อม query nonce | `LIST` |
| อ่านรายการ | `schedule/reported` JSON ทั้งชุด | `time4med/v1/cabinet/cabinet-01/schedule` JSON **ทีละรายการ** |
| จำนวน | สูงสุด 16 *เวลาที่แตกต่าง* | สูงสุด 18 *รายการผู้สูงอายุ/เวลา/มื้อ* |
| ยืนยันทั้งชุด | คาดหวัง ACK / revision | **ไม่มี correlation ID, ไม่มี end marker, ไม่มี ACK อะตอมมิก** |
| ผู้สูงอายุ | ส่งเฉพาะเวลา | `U001/P001` กล่อง 1, `U002/P002` กล่อง 2, `U003/P003` กล่อง 3 |

ตัวอย่างคำสั่งที่ *เฟิร์มแวร์เก่ารองรับ* (อธิบายเท่านั้น **ไม่ใช่คำสั่งที่เว็บ v0.22 ส่งจริง**):

- `LIST` (อ่านตารางยาทั้งหมดตามที่ firmware ส่งรายรายการ)
- `SET|U001|08:30|AFTER_BREAKFAST`
- `DELETE|U001|08:30|AFTER_BREAKFAST`
- `CLEAR|U002`

การส่ง CLEAR/SET เป็นลำดับอาจทำให้ตารางยาจริงเหลือครึ่งเดียวหากตู้ขาดไฟ/เน็ตระหว่างทำงาน และไม่มี ACK แบบรวมทั้งชุด จึง **ห้ามทำบนตู้ที่กำลังใช้งาน**

## การแก้ v0.22

- หน้า **รายการยา** ใน `test-v021/` ใช้ `schedule-contract.js` และ `schedule-review.js` แทน `test-v019/schedule-sync.js`
- ตรวจสิทธิ์รายชื่อผู้สูงอายุด้วย `Time4MedAuth.api('/api/patients')`; ถ้าโหลดไม่ได้จะไม่สรุปว่าพร้อมส่ง
- ตรวจการแม็ประหว่าง `patientId`, `userId`, ช่องกล่อง, มื้อ 1–7, เวลา `HH:MM`
- รวมการใช้ยาหลายรายการที่เป็นผู้สูงอายุ/มื้อ/เวลาเดียวกันให้เป็นรอบเดียว และข้ามยา PRN
- ตรวจจำนวนรอบไม่เกิน 18; หากพบรายการผู้สูงอายุที่ไม่มีสิทธิ์ ไม่แอบข้ามรายการนั้น
- **ไม่มีคำสั่ง SET, DELETE, CLEAR, LOCK/UNLOCK หรือ MQTT connect/publish จากหน้า review**
- ข้อความ "ตรวจรูปแบบผ่าน" **ไม่ใช่** การยืนยันว่าตารางถูกบันทึกลง ESP32-S3 หรือว่ามีการรับยา

## ข้อจำกัดและขั้นถัดไป

1. ตรวจ firmware ที่รันจริงจาก Serial Monitor / เวอร์ชันที่บอร์ดรายงานเทียบกับโค้ดแหล่งล่าสุด โดย **ไม่ส่ง secrets.h หรือรหัสผ่านเข้ามาในแชต**
2. ออกแบบ **โปรโตคอลแบบอะตอมมิก** สำหรับอัปเดตตารางยา: ส่งตารางทั้งชุดในคำขอเดียว, ตรวจสิทธิ์ผู้ดูแล, checksum/revision, validate, บันทึกสำเร็จก่อนตอบ ACK, และรองรับ retry/reconnect อย่างปลอดภัย
3. Backend Gateway ต้องตรวจ Google ID token และสิทธิ์ผู้ดูแลต่อผู้สูงอายุ/ตู้ **ที่ฝั่งเซิร์ฟเวอร์** ไม่เชื่อ client-side role
4. เครื่องต้องตอบ snapshot `begin(count,revision,request_id)` / `entry` / `end(count,revision,request_id)` หรือ JSON ชุดเดียวที่มีครบ เพื่อยืนยันว่าอ่านได้ครบ ไม่ใช่ดู retained status แล้วสรุปว่าออนไลน์
5. ก่อนเปิดให้ส่งคำสั่งกับฮาร์ดแวร์จริง ให้ทดสอบบนตู้จำลองโดยตัดไฟ **12 V ของกลอน** และตรวจกรณีเน็ตหลุด ไฟดับ และสถานะฉุกเฉิน
6. ห้ามอ้างว่ากดปุ่มยืนยันเท่ากับกลืนยาสำเร็จ — ระบบตรวจเพียงการหยิบ/ยืนยันตามข้อมูลที่มี

### ตรวจสอบอัตโนมัติ

`tests/schedule-contract.test.cjs` ตรวจจับ wrong box, unknown patient, wrong meal/time, PRN, duplicate meal, 18-slot capacity, incomplete/stale snapshot และยืนยันว่าไฟล์ review ไม่มี MQTT writes. GitHub Actions ใช้ cloud runner จึงไม่กินพื้นที่ติดตั้ง ESP32 ในไดรฟ์ C
