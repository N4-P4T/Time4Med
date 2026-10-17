# Time4Med — MQTT Probe สำหรับ ESP32-S3

**Firmware สำหรับตรวจการเชื่อมต่อเท่านั้น ไม่ใช่โปรแกรมตู้ยาตัวจริง**
โค้ดนี้ **ไม่ขับ Relay, ไม่สั่งกลอน และไม่แก้ตารางยา** แต่จะไม่ตั้งค่า GPIO4 ด้วย
เพื่อความปลอดภัย **ให้ถอดสายไฟ 12V ที่จ่ายให้ชุดกลอน/รีเลย์ออกก่อนอัปโหลดหรือรันทดสอบ**

ไฟล์ในโฟลเดอร์:
- `Time4Med_MqttProbe.ino` — diagnostic sketch
- `mqtt_certs.h` — CA roots สำหรับ TLS จากชุดโค้ดต้นแบบที่เคยพัฒนา
- `secrets.example.h` — ค่าตัวอย่าง (ไม่มีรหัสผ่าน)

## ทดสอบบนเครื่องในภายหลัง
1. ดาวน์โหลดเฉพาะโฟลเดอร์นี้จาก GitHub เมื่อพร้อมอัปโหลด
2. คัดลอก `secrets.example.h` เป็น `secrets.h` **บนคอมของคุณเท่านั้น**
3. กรอก Wi-Fi 2.4 GHz, MQTT hostname/username/password ใน `secrets.h`
4. ใช้บอร์ด **ESP32S3 Dev Module**, เปิด Serial Monitor `115200` (และ USB CDC On Boot หากใช้ USB CDC)
5. ติดตั้ง Library `MQTT` (Joel Gaehwiler / 256dpi)
6. ดูผล `[WIFI]`, `[NTP]`, `[MQTT]`, `[RX]` โดยไม่ต้องส่ง Credentials เข้าแชต

## แปลผล
- `[CONFIG]`: ยังไม่มี credentials จริง (ไฟล์ CI เป็น placeholders)
- `[WIFI]`: ปัญหา Wi-Fi, hotspot, 2.4 GHz, รหัส/สัญญาณ
- `[NTP]`: เครือข่ายยังไม่สามารถซิงก์เวลา UTC สำหรับตรวจใบรับรอง TLS
- `[MQTT] CONNECT FAILED`: ตรวจเลข `lastError`, `returnCode` เพื่อจำแนก Authentication vs Transport/TLS
- `[MQTT] CONNECTED`: บัญชี ESP32 ต่อกับ HiveMQ ได้ **แต่ไม่ยืนยันเฟิร์มแวร์ตู้ยาตัวจริง**
- `[MQTT] SUB...`: ตรวจสิทธิ์อ่าน Topic
- `[RX]`: มี MQTT ข้อมูลจริงจาก Topic; อย่าใช้ retained message เดียวเป็นหลักฐานเครื่องออนไลน์

**ห้ามปิดการตรวจ TLS ด้วย `setInsecure()`**
**ห้ามอัปโหลด `secrets.h` หรือโพสต์รหัสผ่านลง GitHub/แชต**
ถ้า Secret เคยเผยแพร่ใน Repository ให้เปลี่ยนรหัสผ่านใน HiveMQ และเพิกถอนตัวเก่า

### GitHub Actions
Workflow `mqtt-probe-compile.yml` ช่วยคอมไพล์โค้ดบน GitHub โดยใช้ placeholders เท่านั้น
ไม่ต้องติดตั้ง ESP32 Board Package เพิ่มบนไดรฟ์ C และไม่มีการแฟลชลงฮาร์ดแวร์อัตโนมัติ
