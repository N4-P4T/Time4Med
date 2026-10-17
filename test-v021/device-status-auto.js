/* Time4Med v0.25: caregiver views ESP32-S3 status automatically after Google login.
 * No MQTT password, broker credentials, remote lock, or direct MQTT access.
 * Backend /api/devices/status must independently verify Google role.
 */
(function(){
  'use strict';
  const panel=document.getElementById('t25DevicePanel');
  if(!panel)return;
  const $=id=>document.getElementById(id);
  const POLL_MS=30000, STALE_MS=150000;
  let active=false, epoch=0, ongoing=false;
  function set(id,value){const el=$(id);if(el)el.textContent=String(value);}
  function clear(){
    set('t25Device','ESP32-S3: รอข้อมูล');
    set('t25Door','ยังไม่มีข้อมูล');
    set('t25Lock','ยังไม่มีข้อมูล');
    set('t25Emergency','ยังไม่มีข้อมูล');
    set('t25LastSeen','—');
  }
  function showState(status,message){
    set('t25DeviceState',status);
    set('t25DeviceMessage',message);
  }
  function render(data){
    const state=String(data?.state||'UNAVAILABLE');
    if(state!=='LIVE'||!data.telemetry){
      clear();
      if(state==='STALE'){
        set('t25LastSeen',data.received_at?new Date(data.received_at).toLocaleString('th-TH'):'—');
        showState('ข้อมูลหมดอายุ','เครื่องยังไม่มีสถานะใหม่ในช่วง 150 วินาที ไม่ถือว่าออนไลน์');
      }else if(state==='NO_DATA'){
        showState('รอการส่งข้อมูลจากเครื่อง','ยังไม่ได้รับข้อมูลจาก ESP32-S3 ผ่าน Backend');
      }else showState('รอการเชื่อมต่อ','Backend ยังไม่สามารถยืนยันข้อมูลสดจากอุปกรณ์');
      return;
    }
    const received=Date.parse(data.received_at||'');
    if(!Number.isFinite(received)||Date.now()-received>STALE_MS || received>Date.now()+10000){
      clear();showState('ข้อมูลหมดอายุ','พบข้อมูลเก่าหรือเวลาไม่ถูกต้อง จึงไม่ยืนยันว่า ESP32-S3 ออนไลน์');
      return;
    }
    const t=data.telemetry;
    if(!['LOCKED','UNLOCKED'].includes(t.lock_status)||
      !['CLOSED','OPEN'].includes(t.door_status)||
      typeof t.emergency!=='boolean'||typeof t.rtc_valid!=='boolean') {
      clear();showState('ข้อมูลไม่ถูกต้อง','ข้อมูลสถานะจาก Backend ไม่ผ่านการตรวจรูปแบบ');
      return;
    }
    set('t25Device','ESP32-S3 · '+String(t.system_state||'สถานะไม่ระบุ').slice(0,48));
    set('t25Door',t.door_status==='CLOSED'?'ปิด':'เปิด');
    set('t25Lock',t.lock_status==='LOCKED'?'ล็อก':'ปลดล็อก');
    set('t25Emergency',t.emergency?'มีสัญญาณฉุกเฉิน':'ไม่มีสัญญาณ');
    set('t25LastSeen',new Date(received).toLocaleString('th-TH'));
    showState('รับข้อมูลล่าสุดแล้ว','Backend ยืนยันว่ามีข้อความสถานะใหม่จากตู้ยา · ไม่ถือเป็นหลักฐานการรับประทานยา');
  }
  async function poll(){
    if(!active||ongoing||!window.Time4MedAuth?.user)return;
    ongoing=true;
    const run=epoch;
    try{
      const response=await window.Time4MedAuth.api('/api/devices/status');
      if(run!==epoch||!active)return;
      render(response);
    }catch(err){
      if(run!==epoch||!active)return;
      clear();
      showState('รอเชื่อม Backend',
        'ยังไม่สามารถอ่านสถานะจาก Backend ที่ตรวจสิทธิ์ได้ ('+
        String(err?.message||'API unavailable').slice(0,100)+')');
    }finally{ongoing=false;}
  }
  window.addEventListener('time4med-auth-changed',e=>{
    epoch++;
    active=!!e.detail?.user;
    panel.hidden=!active;
    clear();
    if(active){showState('กำลังตรวจสถานะ','กำลังโหลดสถานะ ESP32-S3 อัตโนมัติด้วยบัญชี Google');poll();}
    else showState('รอเข้าสู่ระบบ','กรุณาเข้าสู่ระบบด้วยบัญชี Google ที่ได้รับอนุญาต');
  });
  window.setInterval(poll,POLL_MS);
  panel.hidden=true;
  clear();
})();
