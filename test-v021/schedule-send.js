/* Time4Med v0.21 schedule pilot UI.
 * Sends exactly one EXISTING/authorized medicine slot after confirmation.
 * No schedule deletion, no automatic sync, no credential storage.
 */
(() => {
  'use strict';
  const core=window.Time4MedScheduleContract;
  const auth=()=>window.Time4MedAuth;
  const parent=document.querySelector('.t22-schedule-review');
  if (!core||!parent) return;
  const el=document.createElement('section');
  el.className='t4m-one-slot-send';
  el.style.cssText='margin:1rem 0;padding:1rem;border:1px solid #a3a3a3;border-radius:12px';
  el.innerHTML=`
    <h4>ทดลองส่งรอบยา 1 รายการไปยัง ESP32-S3</h4>
    <p>ตรวจข้อมูลจาก Google Sheets ก่อนส่งทุกครั้ง · ยังไม่ใช่ซิงก์อัตโนมัติ</p>
    <label for="t4mSendOneSelect">เลือกรอบยา</label>
    <select id="t4mSendOneSelect" style="width:100%;padding:0.6rem;margin:0.4rem 0"></select>
    <button type="button" id="t4mSendOneBtn" disabled>ตรวจสอบและส่งรอบยาที่เลือก</button>
    <p id="t4mSendOneStatus" role="status" aria-live="polite">รอข้อมูล Google Login / ตารางยา...</p>
    <small>การตอบรับจาก HiveMQ (PUBACK) ไม่ใช่การยืนยันว่า ESP32-S3 บันทึกแล้ว โปรดตรวจ Serial Monitor และผลแจ้งเตือนก่อนใช้จริง</small>`;
  parent.append(el);
  const select=el.querySelector('#t4mSendOneSelect');
  const button=el.querySelector('#t4mSendOneBtn');
  const status=el.querySelector('#t4mSendOneStatus');
  let patients=null,slots=[],busy=false,sequence=0;
  const setStatus=(s)=>{status.textContent=s;};
  function render(){
    const a=auth();
    const data=a?.user&&typeof medicines!=='undefined'&&Array.isArray(medicines)?medicines:null;
    const report=core.evaluate(data,patients);
    const valid=Boolean(a?.user && Array.isArray(patients) && report.ok && report.slots.length);
    slots=valid?report.slots:[];
    const previous=select.value;
    select.replaceChildren();
    for(let i=0;i<slots.length;i++){
      const s=slots[i];
      const opt=new Option(`${s.patientId} · กล่อง ${s.compartment} · ${s.time} · ${s.meal}`,String(i));
      select.add(opt);
    }
    if (slots.length && Number(previous)>=0 && Number(previous)<slots.length)select.value=previous;
    if(!slots.length)select.add(new Option('ยังไม่มีรอบยาที่ผ่านการตรวจ',''));
    button.disabled=busy||!valid;
    if(!busy && !valid) setStatus(a?.user?'ยังไม่พร้อมส่ง: ตรวจข้อมูลยา ผู้สูงอายุ และรายการข้อผิดพลาดด้านบน':'กรุณาเข้าสู่ระบบ Google');
  }
  async function loadPatients(){
    const a=auth();const my=++sequence;
    patients=null;render();
    if(!a?.user) return;
    try{
      const response=await a.api('/api/patients');
      if(my!==sequence)return;
      if(!Array.isArray(response.patients)) throw Error('รายชื่อผู้สูงอายุไม่ถูกต้อง');
      patients=response.patients.map(p=>String(p.id||''));render();
    }catch(error){if(my!==sequence)return;setStatus('โหลดสิทธิ์ผู้สูงอายุไม่ได้: '+String(error.message||error));}
  }
  async function sendOne(){
    if(busy || !auth()?.user || !slots.length)return;
    const slot=slots[Number(select.value)];
    if(!slot)return;
    busy=true;render();setStatus('กำลังตรวจรอบยากับข้อมูลล่าสุดใน Google Sheets...');
    const body={deviceId:'cabinet-01',action:'SET_ONE',userId:slot.userId,time:slot.time,meal:slot.meal};
    try{
      const preview=await auth().api('/api/devices/cabinet-01/schedule',{method:'POST',body});
      if(!preview?.ok || preview.preview!==true)throw Error('Backend ไม่ยืนยันตัวอย่างคำสั่ง');
      const confirmed=window.confirm(`ทดสอบส่งรอบยา ${slot.patientId} · กล่อง ${slot.compartment} · ${slot.time} · ${slot.meal} ไปยังตู้ยา?\n\nโปรดทดลองโดยไม่ใส่ยาจริง และตรวจ ESP32-S3 หลังส่ง\nไม่ได้ลบตารางยาเดิม`);
      if(!confirmed){setStatus('ยกเลิกแล้ว ไม่มีคำสั่งถูกส่ง');return;}
      setStatus('กำลังส่งหนึ่งรอบยาไป HiveMQ...');
      const result=await auth().api('/api/devices/cabinet-01/schedule',{method:'POST',body:{...body,commit:true}});
      if(!result?.brokerAccepted)throw Error('HiveMQ ยังไม่ตอบรับคำสั่ง');
      setStatus('HiveMQ ตอบ PUBACK แล้ว แต่ยังต้องตรวจ ESP32-S3 รับ/บันทึก และทดลองเสียงตามเวลาจริง');
    }catch(error){setStatus('ส่งไม่สำเร็จ: '+String(error.message||error));}
    finally{busy=false;render();}
  }
  button.addEventListener('click',()=>{void sendOne();});
  window.addEventListener('time4med-auth-changed',()=>{void loadPatients();});
  window.addEventListener('time4med-medicines-changed',render);
  render();
  if(auth()?.user)void loadPatients();
})();
