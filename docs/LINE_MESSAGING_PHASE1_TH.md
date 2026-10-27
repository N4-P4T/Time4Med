# Time4Med — LINE Messaging API: Phase 1 (server-side, NOT DEPLOYED)

สถานะ 27 ตุลาคม 2569: **เฉพาะฟังก์ชันสำหรับ Backend และการทดสอบจำลอง** ยังไม่เชื่อม Cloudflare Worker ตัวจริง, ยังไม่ส่ง LINE จริง และยังไม่สร้างข้อมูลผู้ดูแลหรือบัญชี LINE ขึ้นมาเอง

## สิ่งที่ทำในรอบนี้
- `backend/line-messaging.mjs` จัดรูปแบบข้อความแจ้งเตือนมื้อยา โดยใช้รหัส P001/P002/P003 ไม่ส่งชื่อยา ชื่อผู้สูงอายุหรือข้อมูลสุขภาพละเอียดไปในข้อความ
- ฟังก์ชันส่ง Push ใช้ `POST /v2/bot/message/push` **จาก Backend เท่านั้น** ไม่เก็บ Channel Access Token ใน HTML/JS หน้าเว็บไซต์
- `planCaregiverReminders` จัดกลุ่ม P001–P003 เฉพาะกรณี **ผู้รับ LINE คนเดียวกัน + เวลาเดียวกัน + มื้อเดียวกัน** และกรองตามสิทธิ์ผู้ดูแลที่ยืนยันแล้ว; ผลลัพธ์เป็นแผน ไม่ใช่การส่งจริง
- ปิดการส่งเป็นค่าเริ่มต้น: ต้องมี Worker secret `LINE_CHANNEL_ACCESS_TOKEN` และตั้ง `LINE_PUSH_ENABLED=true` จึงใช้งานได้
- ตรวจโควตาผ่าน `GET /v2/bot/message/quota` และ `GET /v2/bot/message/quota/consumption` ก่อน Push; ถ้าเช็กไม่ได้จะไม่ส่ง; ตั้งเพดานอ่อนที่ 280/เดือน เพื่อเผื่อจากเพดานฟรี 300
- ใช้ `X-Line-Retry-Key` รูปแบบ UUID เพื่อช่วยป้องกันส่งซ้ำจากคำขอเดิมภายในช่วงรองรับของ LINE
- มีตัวตรวจ `x-line-signature` ด้วย HMAC-SHA256 บน **raw webhook body** ก่อน parse JSON; ยังไม่เปิด Webhook URL หรือเชื่อมบัญชี
- มี Unit Tests ที่ใช้ Mock เท่านั้น จึงไม่ส่งข้อความหรือใช้โทเค็นจริง

## สิ่งที่ต้องเชื่อมในเฟสถัดไป ก่อนจะบอกว่า LINE ใช้งานได้จริง

1. ตรวจว่ามี LINE Official Account / Messaging API Channel ของโครงงานแล้วหรือไม่ หากยังไม่มีให้เจ้าของระบบสร้าง
2. ใช้ LINE Developers / Cloudflare ตั้งค่า Channel Access Token, Channel Secret ด้วย Secrets ใน Backend เท่านั้น ห้ามใส่ใน GitHub, Chat, Sheets หรือโค้ดหน้าเว็บ
3. เปิด Webhook ที่ตรวจ signature และจับคู่ `LINE userId` กับผู้ดูแลที่ยืนยันตัวตนผ่าน Google Login แล้ว ห้ามถือว่าบัญชี LINE ใดเป็นผู้ดูแลโดยอัตโนมัติเมื่อ Follow
4. ให้ Backend อ่านตารางยาและสิทธิ์จาก Google Sheets (P001–P003) กำหนดผู้รับตามผู้ดูแลที่ได้รับอนุญาตเท่านั้น
5. วางตัวเรียกส่งที่เชื่อมกับเวลาของเครื่อง/ตารางยาจริง ซึ่งไม่ต้องเปิดหน้าเว็บไซต์ค้างไว้
6. บันทึก Event ID + Recipient ID + เวลาอย่างคงทนบน Backend เพื่อป้องกันการส่งซ้ำเมื่อ Cron/Worker ทำงานทับกัน โดยต้องไม่พึ่ง Retry Key เพียงอย่างเดียว
7. ทดสอบจริงกับบัญชีผู้ดูแลที่ยินยอมรับข้อความก่อน และตรวจว่า LINE รับ API (200) **ไม่เท่ากับยืนยันผู้ใช้เห็นข้อความแล้ว**
8. ตรวจจำนวนข้อความต่อเดือนใน LINE Official Account Manager, ไม่ใช้จำนวนจาก API เพียงอย่างเดียว เพราะ Usage API เป็นค่าประมาณ

## ความเสี่ยงและการลดจำนวนข้อความ
แพ็กเกจ LINE Official Account ฟรีในประเทศไทยระบุ **300 ข้อความต่อเดือน** (ข้อมูลทางการ ณ 27 ต.ค. 2569) และจำนวนข้อความนับตามผู้รับ
- 1 คนดูแล P001–P003 มีแจ้งเตือนแยก 12 ครั้งต่อวัน = 360 ข้อความ/30 วัน ซึ่งเกินโควตา
- หากรอบยาอยู่เวลาเดียวกันและเป็นมื้อเดียวกัน สามารถรวม P001–P003 เป็นข้อความเดียวต่อผู้ดูแลเพื่อลดจำนวน ไม่ควรรวมเวลาที่ต่างกันจนแจ้งเตือนช้า
- ต้องสำรองโควตาสำหรับเหตุฉุกเฉินและตรวจกรณีผู้ดูแลหลายคน; **ยังไม่มีระบบบังคับเพดานแบบ atomic** จึงยังไม่เปิดแจ้งเตือนอัตโนมัติใน production

## มาตรฐานที่ใช้
- LINE Push API และ Retry Key: https://developers.line.biz/en/reference/messaging-api/#send-push-message
- LINE monthly quota: https://developers.line.biz/en/reference/messaging-api/#get-the-target-limit-for-sending-messages-this-month
- LINE webhook signature: https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/
- โควตาไทย: https://lineforbusiness.com/th/helpcenter/line-oa

## ขอบเขต
ไม่แตะ `main`, Time4Med_DB จริง, ESP32-S3, ESP32-CAM, HiveMQ, กลอนหรือระบบแจ้งเตือนเดิม จนกว่าจะผ่านการทดสอบกับบัญชีผู้ดูแล/LINE จริง
