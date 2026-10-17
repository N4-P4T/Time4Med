# Time4Med Google Dashboard v0.20 — STAGING

หน้าตัวอย่างที่รวม Google Login ของ test-v019 กับ Dashboard แบบใหม่

- ต้องลงชื่อเข้าใช้ Google ผ่าน Cloudflare Worker เช่นเดียวกับ test-v019
- อ้างอิง auth.js, auth-config.js, sheets-sync.js, inventory.js, schedule-sync.js, style.css, logo.png ของ test-v019
- แยก Dashboard และ Devices โดยไม่แก้เมนูควบคุมกลอนเดิม
- Dashboard ใช้รายการยาที่โหลดผ่านระบบสิทธิ์ของ test-v019 และเคารพตัวกรองผู้ป่วย
- สถานะ MQTT/สั่งกลอนโดยตรงจากเบราว์เซอร์ยังปิดใน secure mode
- Timeline และ Adherence ที่ไม่มี backend ที่ตรวจสิทธิ์ แสดงรอข้อมูลแทนตัวเลขสมมติ
- ไม่อัปโหลด HiveMQ password ใหม่

งานนี้เป็น STAGING; ก่อนเผยแพร่ขึ้น main ให้ผ่าน browser test และอย่าทำให้หน้า root เปลี่ยนโดยไม่ได้ตรวจสอบ
