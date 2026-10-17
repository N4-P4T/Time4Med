/* Time4Med schedule compatibility analysis — NO MQTT publish / no network.
 * Contract based on inspected ESP32-S3 firmware 0.11.0-safe-schedules.
 * U001/P001 compartment 1, U002/P002 compartment 2, U003/P003 compartment 3.
 * Legacy firmware has NO atomic batch and NO correlated completion ACK.
 * Review-only; do not use output as a "sync successful" signal.
 */
(function(factory){
  const api=factory();
  if(typeof module==='object' && module.exports) module.exports=api;
  if(typeof window!=='undefined') window.Time4MedScheduleContract=api;
})(function(){
  'use strict';
  const TIME=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
  const USERS=Object.freeze([
    Object.freeze({patientId:'P001',userId:'U001',compartment:1}),
    Object.freeze({patientId:'P002',userId:'U002',compartment:2}),
    Object.freeze({patientId:'P003',userId:'U003',compartment:3})
  ]);
  const MEALS=Object.freeze({
    '1':'BEFORE_BREAKFAST','2':'AFTER_BREAKFAST',
    '3':'BEFORE_LUNCH','4':'AFTER_LUNCH',
    '5':'BEFORE_DINNER','6':'AFTER_DINNER','7':'BEDTIME'
  });
  const LIMIT=18,TOPIC='time4med/v1/cabinet/cabinet-01/command/schedule';
  function evaluate(rows,authorizedPatientIds){
    const issues=[],slots=[],seen=new Set();
    const users=new Map(USERS.map(x=>[x.patientId,x]));
    if(!Array.isArray(rows)) return {ok:false,slots:[],issues:[{kind:'error',code:'NOT_LOADED',message:'ยังไม่มีรายการยาที่โหลดสำเร็จ'}],capacity:LIMIT,prnSkipped:0,total:0,topic:TOPIC};
    if(!Array.isArray(authorizedPatientIds)) return {ok:false,slots:[],issues:[{kind:'error',code:'NO_AUTH',message:'ยังไม่ยืนยันขอบเขตผู้สูงอายุจาก Backend'}],capacity:LIMIT,prnSkipped:0,total:rows.length,topic:TOPIC};
    const allowed=new Set(authorizedPatientIds.map(String));
    let prnSkipped=0,duplicates=0;
    for(const row of rows){
      if(!row || typeof row!=='object'){issues.push({kind:'error',code:'INVALID_ROW',message:'พบรายการยาไม่ถูกต้อง'});continue;}
      const patientId=String(row.patientId||'').trim();
      // Stop on even ONE out-of-scope patient. Never silently discard a row.
      if(!allowed.has(patientId)){
        issues.push({kind:'error',code:'OUT_OF_SCOPE',message:'มีรายการยาไม่อยู่ในสิทธิ์ผู้ดูแลหรือไม่มีรหัสผู้สูงอายุ: '+(patientId||'ไม่ระบุ')});
        continue;
      }
      const person=users.get(patientId);
      if(!person){
        issues.push({kind:'error',code:'NOT_MAPPED',message:'ยังไม่มีการจับคู่ผู้สูงอายุ '+patientId+' กับช่องยาใน ESP32-S3'});
        continue;
      }
      if(row.kind==='prn'){prnSkipped++;continue;}
      const box=String(row.boxNumber||'').trim();
      if(!box || !/^\d{1,2}$/.test(box) || Number(box)!==person.compartment){
        issues.push({kind:'error',code:'WRONG_BOX',message:'ผู้สูงอายุ '+patientId+' ต้องใช้กล่อง '+person.compartment+' แต่รายการนี้ระบุ '+(box||'ว่าง')});
        continue;
      }
      const time=String(row.time||'').trim();
      if(!TIME.test(time)){
        issues.push({kind:'error',code:'BAD_TIME',message:'เวลายา '+patientId+' ไม่ถูกต้อง: '+(time||'ว่าง')});
        continue;
      }
      const meal=MEALS[String(row.mealType??'')];
      if(!meal){
        issues.push({kind:'error',code:'BAD_MEAL',message:'มื้อยาของ '+patientId+' ไม่ตรงกับ 7 ช่วงที่เฟิร์มแวร์รองรับ'});
        continue;
      }
      const key=person.userId+'|'+time+'|'+meal;
      if(seen.has(key)){duplicates++;continue;}
      seen.add(key);
      slots.push({
        patientId, userId:person.userId, compartment:person.compartment,
        time,meal, command:'SET|'+key
      });
    }
    slots.sort((a,b)=>a.time.localeCompare(b.time)||a.userId.localeCompare(b.userId)||a.meal.localeCompare(b.meal));
    if(slots.length>LIMIT)issues.push({kind:'error',code:'CAPACITY',message:'ตารางมี '+slots.length+' รอบยา เกินความจุ '+LIMIT+' รายการของเฟิร์มแวร์'});
    if(duplicates)issues.push({kind:'info',code:'DEDUPED',message:'มีรายการยาหลายตัวในมื้อเดียวกัน '+duplicates+' รายการ (แจ้งเตือนรอบเดียว)'});
    if(prnSkipped)issues.push({kind:'info',code:'PRN',message:'ข้ามยา PRN '+prnSkipped+' รายการ เพราะไม่มีการเตือนประจำ'});
    if(slots.length===0)issues.push({kind:'warning',code:'EMPTY',message:'ไม่มีรายการยาตามเวลาที่ส่งได้ — ห้ามลบตารางที่อยู่ในเครื่องอัตโนมัติ'});
    issues.push({kind:'info',code:'LEGACY_PROTOCOL',message:'เฟิร์มแวร์รุ่นที่ตรวจพบรองรับ SET/DELETE/CLEAR/LIST ทีละคำสั่ง ไม่รองรับ ACK แบบแทนที่ตารางทั้งชุด'});
    return {ok:!issues.some(x=>x.kind==='error'),slots,issues,capacity:LIMIT,prnSkipped,total:rows.length,topic:TOPIC};
  }
  function normalizeDeviceRow(raw){
    if(!raw || typeof raw!=='object')return null;
    const userId=String(raw.user_id||'');
    const time=String(raw.time||'');
    const meal=String(raw.meal||'');
    const user=USERS.find(x=>x.userId===userId);
    if(!user || !TIME.test(time) || !Object.values(MEALS).includes(meal) || Number(raw.compartment)!==user.compartment)return null;
    return userId+'|'+time+'|'+meal;
  }
  function compareVerifiedSnapshot(review,snapshot){
    if(!review?.ok) return {status:'INVALID_LOCAL',description:'ตารางยาในบัญชียังมีข้อผิดพลาด'};
    if(!snapshot || snapshot.complete!==true || !Array.isArray(snapshot.entries) ||
      !snapshot.deviceVerified || !Number.isFinite(snapshot.capturedAt) ||
      Date.now()-snapshot.capturedAt > 120000 || snapshot.capturedAt > Date.now()+10000)
      return {status:'NOT_VERIFIED',description:'ยังไม่มี Snapshot ครบรายการที่ยืนยันตัวอุปกรณ์และเวลาได้'};
    const device=snapshot.entries.map(normalizeDeviceRow);
    if(device.some(x=>!x)||new Set(device).size!==device.length)
      return {status:'INVALID_DEVICE',description:'ข้อมูล Snapshot จากอุปกรณ์ไม่ถูกต้องหรือซ้ำ'};
    const mine=new Set(review.slots.map(x=>x.userId+'|'+x.time+'|'+x.meal));
    const theirs=new Set(device);
    const missing=[...mine].filter(x=>!theirs.has(x)),extra=[...theirs].filter(x=>!mine.has(x));
    return {status:missing.length||extra.length?'DIFFERENT':'MATCH',
      missing,extra,description:missing.length||extra.length?
        'ตารางยาในอุปกรณ์แตกต่างจากบัญชี; ห้ามแก้ไขอัตโนมัติ':
        'Snapshot ที่ตรวจสอบครบตรงกับรายการในบัญชี ณ เวลาที่อ่าน'};
  }
  return Object.freeze({USERS,MEALS,LIMIT,TOPIC,evaluate,normalizeDeviceRow,compareVerifiedSnapshot});
});
