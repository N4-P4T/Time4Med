# Time4Med: LINE แจ้งเตือนผ่าน Google Apps Script — ทดสอบ 1 ข้อความ (ไม่ใช้ Cloudflare)

**สถานะ:** โค้ดทดสอบที่ต้องนำไปใส่ Apps Script ด้วยตนเอง ยังไม่เชื่อมบัญชี LINE จริง ไม่ส่งอัตโนมัติ และยังไม่ได้เขียนข้อมูลลง Time4Med_DB

ใช้ LINE Official Account **Time4Med** และ Channel เดิมของโครงงานที่เปิดใช้งาน Messaging API อยู่แล้ว **ไม่สร้าง Channel ใหม่ และไม่กด Reissue token**

## เริ่มต้นอย่างปลอดภัย

1. ที่ [LINE Developers](https://developers.line.biz/console/) เปิด Time4Med → **Basic settings** → มองหา **Your user ID** รูปแบบ `U` ตามด้วยอักขระฐานสิบหก 32 ตัว (ถ้าไม่แสดง ต้องผูกบัญชี LINE กับ Business ID ก่อน) ใช้เป็น *ผู้รับทดสอบ* โดยบัญชี LINE นี้ต้องเป็นเพื่อนของ Time4Med OA และไม่บล็อก OA
2. ที่ [Google Apps Script](https://script.google.com/) ใช้บัญชี Google ของ Time4Med → **New project** ตั้งชื่อ `Time4Med_LINE_Pilot` (ไม่ต้องเลือก Deploy หรือทำ Web app)
3. เปิดไฟล์ `Code.gs` ลบโค้ดเริ่มต้น แล้วคัดลอกไฟล์ [Code.gs](./Code.gs) **ทั้งหมด** วาง แล้ว Save
4. ที่ Apps Script → **Project Settings** (ไอคอนเฟือง) → **Script properties** → **Add script property** เพิ่ม:
   - `LINE_CHANNEL_ACCESS_TOKEN`: token เดิมจากหน้า LINE Developers → Messaging API (เก็บใน Script Properties เท่านั้น ห้ามส่งในแชต/ภาพ/GitHub)
   - `LINE_TEST_USER_ID`: Your user ID จาก Basic settings (ไม่ต้องเผยแพร่)
   - **ยังไม่** ตั้ง `LINE_TEST_CONFIRM` จนกว่าจะทดสอบการอ่านสถานะผ่าน
5. กลับไปที่ Editor เลือกฟังก์ชัน `checkLineSetup` → Run → อนุญาตการเข้าถึง `UrlFetchApp` ตามที่ Google ขอ → ดูที่ Execution log. ฟังก์ชันนี้ทำเพียง **GET /info, /message/quota, /message/quota/consumption** ไม่ส่ง LINE
6. เมื่อผล `channelReachable=true`, `targetIdConfigured=true`, `quota` อยู่ต่ำกว่า soft cap จึงเปิด Script property `LINE_TEST_CONFIRM` = `YES`
7. กลับมาเลือกฟังก์ชัน `sendLineTestOnce` → กด Run **เพียงครั้งเดียว** → ตรวจว่าบัญชี LINE ที่เป็นเพื่อนได้รับข้อความทดสอบ
8. สถานะ `apiAccepted=true` หมายถึง LINE API รับคำสั่ง ไม่ใช่ยืนยันว่าเห็นข้อความจริง ต้องดูบนมือถือ

## ระบบป้องกันความผิดพลาด

- หากไม่ได้ตั้ง `LINE_TEST_CONFIRM=YES` จะไม่ส่งข้อความ
- ตรวจโควตาช่องทางจริงจาก API ทุกครั้งก่อนส่ง และจำกัดเพดานชั่วคราวที่ **280 ข้อความ/เดือนหรือน้อยกว่าตามแพ็กเกจจริง** (จำนวนจาก API เป็นค่าประมาณ)
- ใช้ `LockService` ป้องกันส่งพร้อมกัน และบันทึก `LINE_TEST_STATE` เป็น `ATTEMPTED` **ก่อน** ส่ง เพื่อไม่พยายามซ้ำเมื่อมีปัญหาเครือข่าย
- หาก LINE ตอบรับ `HTTP 200` บันทึก `LINE_TEST_STATE=API_ACCEPTED`
- หากขัดข้อง ต้อง **ตรวจข้อความใน LINE ก่อน** พิจารณาส่งใหม่ ห้ามลบ `LINE_TEST_STATE` หรือเปลี่ยน Retry Key เองทันที
- โค้ดไม่ส่งชื่อยา ชื่อผู้สูงอายุ หรือข้อมูลสุขภาพ และไม่สร้าง Webhook, Schedule Trigger, Cloudflare Worker

**ข้อควรระวัง:** ผู้ที่มีสิทธิ์ *แก้ไข* Apps Script สามารถอ่าน Script Properties ได้; ให้สิทธิ์เฉพาะผู้ดูแลโครงการที่ไว้วางใจ อย่าแชร์โปรเจกต์นี้เป็นสาธารณะ

## ขั้นตอนถัดไป (แยกจากทดสอบหนึ่งข้อความ)

เมื่อรับข้อความทดสอบได้แล้วจึงออกแบบตัวอ่าน Google Sheets ที่ผ่านการตรวจสิทธิ์ผู้ดูแลและตารางยา สร้าง Trigger ตามเวลาเฉพาะรอบยา ป้องกันการส่งซ้ำโดยใช้ Lock + ledger และจัดกลุ่มการเตือนเพื่อรักษาโควตาฟรี
**ห้ามเปิด Trigger อัตโนมัติสำหรับรุ่นทดสอบนี้** เพราะยังไม่มีระบบเชื่อมเหตุการณ์ตารางยา/บัญชีผู้ดูแลจริง

ข้อมูลอ้างอิง:
- LINE User ID: https://developers.line.biz/en/docs/messaging-api/getting-user-ids/
- LINE Messaging API: https://developers.line.biz/en/reference/messaging-api/
- GAS Script Properties: https://developers.google.com/apps-script/guides/properties
- GAS UrlFetchApp: https://developers.google.com/apps-script/reference/url-fetch/url-fetch-app
