/* Time4Med Staging — medication time editor.
 * Admin-authenticated CRUD through the existing v0.25 Staging Worker.
 * NO MQTT / schedules command / relays / patient hardware.
 * Do NOT put credentials or real patient medication information in this page.
 */
(() => {
  'use strict';
  const STAGING_API='https://time4med-api-staging.napat-kaewboonpan.workers.dev';
  const mapping=Object.freeze({P001:'1',P002:'2',P003:'3'});
  const $=id=>document.getElementById(id);
  const panel=$('t27EditorPanel'),form=$('t27Form');
  if(!panel||!form)return;
  const msg=$('t27Message'),existing=$('t27Existing'),patient=$('t27Patient'),save=$('t27Save');
  let generation=0,active=false,loading=false,saving=false,patients=[],medicines=[],loaded=false;
  const validTime=t=>/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t);
  function message(t,state='') {
    msg.textContent=t;msg.dataset.state=state;
  }
  function authorized() {
    return active&&window.Time4MedAuth?.user?.role==='ADMIN'&&
      window.TIME4MED_AUTH_CONFIG?.apiBase===STAGING_API;
  }
  function enable() {
    const available=authorized()&&!saving&&!loading&&loaded;
    existing.disabled=!available;patient.disabled=!available||!!existing.value;
    save.disabled=!available||!patients.length;
    $('t27Reload').disabled=!authorized()||saving||loading;
    $('t27New').disabled=!available;
    for(const id of ['t27MedicineName','t27Meal','t27Time','t27Instruction'])$(id).disabled=!available;
  }
  function setOptions(select,rows) {
    select.replaceChildren();
    for(const [value,label] of rows) {
      const option=document.createElement('option');
      option.value=String(value);option.textContent=String(label);
      select.append(option);
    }
  }
  function clearForm() {
    existing.value='';
    patient.value=patients.length?patients[0].id:'';
    $('t27MedicineName').value='';
    $('t27Meal').value='2';
    $('t27Time').value='08:30';
    $('t27Instruction').value='';
    patient.disabled=!authorized()||!loaded||saving||loading;
  }
  function fillSelection() {
    const id=existing.value;
    if(!id){clearForm();return;}
    const row=medicines.find(m=>m.id===id);
    if(!row){clearForm();return;}
    patient.value=row.patientId;
    patient.disabled=true; // Existing record cannot be reassigned to another patient.
    $('t27MedicineName').value=row.name;
    $('t27Meal').value=String(row.mealType);
    $('t27Time').value=row.time;
    $('t27Instruction').value=row.instruction||'';
    message('กำลังแก้รายการ '+row.id+' · ยังไม่ได้บันทึก','');
  }
  function reset() {
    patients=[];medicines=[];loaded=false;
    setOptions(patient,[['','กรุณาโหลดผู้สูงอายุจาก Sheets']]);
    setOptions(existing,[['','เพิ่มรายการใหม่']]);
    $('t27MedicineName').value='';
    $('t27Instruction').value='';
    $('t27Time').value='08:30';
    $('t27Meal').value='2';
    enable();
  }
  function refreshLists(patientsData,medicinesData,selectedId='') {
    if(!Array.isArray(patientsData?.patients)||!Array.isArray(medicinesData?.medicines))
      throw Error('API ส่งข้อมูลไม่ครบ');
    patients=patientsData.patients.filter(p=>p.status==='ACTIVE'&&mapping[p.id]);
    medicines=medicinesData.medicines.filter(m=>m.active!==false&&m.kind==='scheduled'&&
      mapping[m.patientId]&&typeof m.id==='string');
    loaded=true;
    setOptions(patient,patients.map(p=>[p.id,p.id+' · ช่อง '+mapping[p.id]+' · '+p.name]));
    setOptions(existing,[['','เพิ่มรายการใหม่'],...medicines.map(m=>
      [m.id,m.patientId+' · '+m.time+' · '+m.name])]);
    existing.value=medicines.some(m=>m.id===selectedId)?selectedId:'';
    clearForm();
    if(existing.value!==selectedId && medicines.some(m=>m.id===selectedId))existing.value=selectedId;
    if(selectedId&&medicines.some(m=>m.id===selectedId)) {
      existing.value=selectedId;
      fillSelection();
    }
    enable();
    if(!patients.length)message('ยังไม่มีผู้สูงอายุที่เปิดใช้งานใน Staging จึงเพิ่มรายการยาไม่ได้','bad');
    else message('อ่านข้อมูลสำเร็จ: ผู้สูงอายุ '+patients.length+' คน · รายการยาตามเวลา '+medicines.length+' รายการ');
  }
  async function reload(keepId='') {
    if(!authorized()||loading||saving)return;
    const current=generation;
    loading=true;enable();
    message('กำลังอ่านรายการจาก Google Sheets Staging…');
    try{
      const auth=window.Time4MedAuth;
      const [people,meds]=await Promise.all([auth.api('/api/patients'),auth.api('/api/medicines')]);
      if(current!==generation||!active)return;
      refreshLists(people,meds,keepId);
    }catch(err){
      if(current!==generation||!active)return;
      reset();
      message('อ่านฐานข้อมูลไม่สำเร็จ: '+String(err?.message||'เกิดข้อผิดพลาด').slice(0,130),'bad');
    }finally{
      if(current===generation){loading=false;enable();}
    }
  }
  function payload() {
    if(!authorized()||!loaded||saving)throw Error('ยังไม่พร้อมบันทึก');
    const patientId=patient.value;
    if(!patients.some(p=>p.id===patientId)||!mapping[patientId])throw Error('กรุณาเลือกผู้สูงอายุที่ถูกต้อง');
    const name=$('t27MedicineName').value.trim();
    const mealType=Number($('t27Meal').value);
    const time=$('t27Time').value;
    const instruction=$('t27Instruction').value.trim();
    if(!name||name.length>150)throw Error('กรุณาระบุชื่อรายการทดสอบไม่เกิน 150 ตัวอักษร');
    if(!Number.isInteger(mealType)||mealType<1||mealType>7)throw Error('มื้อยาไม่ถูกต้อง');
    if(!validTime(time))throw Error('เวลาไม่ถูกต้อง ต้องเป็น HH:MM แบบ 24 ชั่วโมง');
    if(instruction.length>300)throw Error('หมายเหตุต้องไม่เกิน 300 ตัวอักษร');
    const old=medicines.find(m=>m.id===existing.value);
    if(existing.value&&!old)throw Error('รายการที่เลือกไม่อยู่ในข้อมูลล่าสุด กรุณาอ่านใหม่');
    if(old&&old.patientId!==patientId)throw Error('ห้ามย้ายรายการเดิมไปยังผู้สูงอายุคนอื่น');
    const next={patientId,name,kind:'scheduled',mealType,time,boxNumber:mapping[patientId],
      instruction,stockStatus:old?.stockStatus||'unchecked'};
    if(old) {
      if(!old.updatedAt)throw Error('รายการเดิมไม่มีเวลาปรับปรุง กรุณาตรวจข้อมูลใน Sheets ก่อนแก้ไข');
      next.updatedAt=old.updatedAt;
    }
    return {old,next};
  }
  async function saveForm(event) {
    event.preventDefault();
    let details;
    try{details=payload();}catch(e){message(e.message,'bad');return;}
    const {old,next}=details,editing=!!old;
    if(!window.confirm((editing?'แก้ไข':'เพิ่ม')+'รายการยาทดสอบใน Google Sheets STAGING ใช่หรือไม่?\nไม่มีการส่งตารางไปยังตู้ยาจริง'))return;
    const current=generation;
    saving=true;enable();
    message('กำลังบันทึกลง Google Sheets Staging…');
    let accepted=false,returnedId='';
    try{
      const result=await window.Time4MedAuth.api(editing?'/api/medicines/'+encodeURIComponent(old.id):'/api/medicines',
        {method:editing?'PUT':'POST',body:next});
      accepted=!!result?.medicine?.id;
      returnedId=result?.medicine?.id||'';
      if(!accepted)throw Error('Backend ไม่ยืนยันผลบันทึก');
      if(current!==generation||!active)return;
      message('Backend รับการบันทึกแล้ว กำลังอ่านจาก Sheets กลับเพื่อตรวจ…');
      const [people,meds]=await Promise.all([
        window.Time4MedAuth.api('/api/patients'),window.Time4MedAuth.api('/api/medicines')]);
      if(current!==generation||!active)return;
      const saved=meds?.medicines?.find(m=>m.id===returnedId);
      if(!saved||saved.name!==next.name||saved.time!==next.time||
        Number(saved.mealType)!==next.mealType||saved.patientId!==next.patientId)
        throw Error('อ่านกลับแล้วยังไม่ตรงกับรายการที่บันทึก');
      refreshLists(people,meds,returnedId);
      message('บันทึกและอ่านกลับจาก Google Sheets Staging สำเร็จ ✓ · ยังไม่ได้ส่งไป ESP32-S3','success');
      // Existing schedule-review UI refreshes its authorized read-only projection.
      $('t26RefreshSchedule')?.click();
    }catch(error){
      if(current!==generation||!active)return;
      message((accepted?'Backend รับบันทึกแล้ว แต่ยังอ่านยืนยันจาก Sheets ไม่สำเร็จ: ':
        'ยังยืนยันผลการบันทึกไม่ได้: ')+String(error?.message||'เกิดข้อผิดพลาด').slice(0,120)+
        ' · โปรดกดอ่านรายการใหม่ก่อนลองบันทึกซ้ำ','bad');
    }finally{
      if(current===generation){saving=false;enable();}
    }
  }
  window.addEventListener('time4med-auth-changed',e=>{
    generation++;
    active=e.detail?.user?.role==='ADMIN'&&
      window.TIME4MED_AUTH_CONFIG?.apiBase===STAGING_API;
    loading=false;saving=false;panel.hidden=!active;
    reset();
    message(active?'กำลังโหลดข้อมูลจาก Google Sheets Staging…':
      'สำหรับบัญชี ADMIN ใน Staging เท่านั้น');
    if(active)void reload();
  });
  existing.addEventListener('change',fillSelection);
  $('t27New').addEventListener('click',()=>{clearForm();message('กำลังเพิ่มรายการยาใหม่ · ยังไม่ได้บันทึก');});
  $('t27Reload').addEventListener('click',()=>{void reload(existing.value);});
  form.addEventListener('submit',e=>{void saveForm(e);});
  panel.hidden=true;
  reset();
})();
