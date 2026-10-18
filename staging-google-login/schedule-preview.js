/* Time4Med staging schedule preview: ADMIN-only, read-only.
 * Backend generates this plan from authorized Google Sheets; browser cannot
 * submit a medication plan or send any device command.
 */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const panel=$('t26SchedulePanel');
  if(!panel)return;
  const elStatus=$('t26ScheduleStatus'),elInfo=$('t26ScheduleInfo');
  const slotList=$('t26ScheduleList'),refreshBtn=$('t26ScheduleRefresh');
  let generation=0,inflightGeneration=null,active=false;
  function reset() {
    slotList.replaceChildren();
    $('t26ScheduleSlots').textContent='—';
    $('t26ScheduleRevision').textContent='—';
    elStatus.textContent='รออ่านตาราง';
    elInfo.textContent='ยังไม่มีข้อมูลที่ตรวจสอบได้';
  }
  function show(preview) {
    reset();
    const p=preview||{};
    if(p.state==='NO_MEDICINES') {
      elStatus.textContent='ยังไม่มีรายการยาใน Google Sheets Staging';
      elInfo.textContent='ต้องเพิ่มผู้สูงอายุและรายการยาทดสอบก่อนจึงจะสร้างตัวอย่างตารางได้ · ไม่ลบตารางยาในเครื่อง';
      $('t26ScheduleSlots').textContent='0';
      return;
    }
    if(p.state==='NO_SCHEDULED_MEDICINES') {
      elStatus.textContent='ยังไม่มีมื้อยาที่ตั้งเวลา';
      elInfo.textContent='มีเฉพาะรายการ PRN ซึ่งไม่ถูกนำไปกำหนดเวลาเตือน · ไม่มีการส่งคำสั่ง';
      $('t26ScheduleSlots').textContent='0';
      return;
    }
    if(p.state!=='PREVIEW_ONLY'||p.applied!==false||
      p.acknowledged!==false||p.canCommit!==false||
      !Array.isArray(p.slots)||p.slots.length>18) {
      elStatus.textContent='ข้อมูลตอบกลับผิดรูปแบบ';
      elInfo.textContent='ไม่แสดงว่าตารางพร้อมใช้ กรุณาตรวจ Backend Staging';
      return;
    }
    elStatus.textContent='ตรวจรูปแบบผ่าน — ยังไม่ส่งเข้าเครื่อง';
    elInfo.textContent='เป็นตัวอย่างจาก Google Sheets Staging ไม่ใช่ตารางที่ ESP32-S3 ยืนยันว่าบันทึกแล้ว';
    $('t26ScheduleSlots').textContent=String(p.slots.length);
    $('t26ScheduleRevision').textContent=String(p.revision16||'—').slice(0,16);
    for(const slot of p.slots) {
      const li=document.createElement('li');
      li.textContent=String(slot.patientId||'ไม่ระบุ')+' · กล่อง '+String(slot.compartment||'—')+
        ' · '+String(slot.time||'—')+' · '+String(slot.meal||'—');
      slotList.appendChild(li);
    }
  }
  async function refresh() {
    if(!active||inflightGeneration===generation||
       window.Time4MedAuth?.user?.role!=='ADMIN')return;
    const current=generation;
    inflightGeneration=current;
    refreshBtn.disabled=true;
    elStatus.textContent='กำลังอ่านตารางยาจาก Backend Staging…';
    try{
      const data=await window.Time4MedAuth.api('/api/cabinets/cabinet-01/schedule/preview');
      if(current!==generation||!active)return;
      show(data?.preview);
    }catch(error){
      if(current!==generation||!active)return;
      reset();
      elStatus.textContent='ยังอ่านตารางยาไม่ได้';
      elInfo.textContent=String(error?.message||'การเชื่อมต่อผิดพลาด').slice(0,160)+
        ' · ตรวจว่าติดตั้ง Worker v0.26 ใน Staging แล้ว';
    }finally{
      if(inflightGeneration===current){
        inflightGeneration=null;
        refreshBtn.disabled=false;
      }
    }
  }
  window.addEventListener('time4med-auth-changed',event=>{
    generation++;
    active=event.detail?.user?.role==='ADMIN';
    panel.hidden=!active;
    reset();
    if(active)void refresh();
  });
  refreshBtn.addEventListener('click',()=>void refresh());
  panel.hidden=true;
  reset();
})();
