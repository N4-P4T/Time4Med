/* Time4Med v0.18 — Google Sheets via authorized Worker only.
 * Browser never receives spreadsheet access token or service account key.
 * Draft changes are in-memory; use status messages to confirm server success.
 */
(function(){
'use strict';
const auth=window.Time4MedAuth;
const host=document.getElementById('medicineList');if(!host||!auth)return;
const el=id=>document.getElementById(id);
let baseline=new Map(),patients=[],busy=false,applying=false,ready=false,again=false;
let writeChain=Promise.resolve();
let assignedUsers=[],editingUserId=null;
const clean=m=>({id:String(m.id||''),patientId:String(m.patientId||''),name:String(m.name||''),kind:m.kind==='prn'?'prn':'scheduled',mealType:m.kind==='prn'?'prn':Number(m.mealType)||2,time:m.kind==='prn'?'':String(m.time||''),boxNumber:String(m.boxNumber||''),instruction:String(m.instruction||''),stockStatus:String(m.stockStatus||'unchecked'),statusUpdatedAt:String(m.statusUpdatedAt||'')});
const equal=(a,b)=>JSON.stringify(clean(a))===JSON.stringify(clean(b));
const state=(msg,level='info')=>{const s=el('tmCloudState');if(s){s.textContent=msg;s.dataset.level=level;}};
const panel=document.createElement('section');panel.className='time4med-cloud-panel';
panel.innerHTML=`<h3>☁️ Time4Med Cloud — Google Sheets ผ่าน Backend</h3>
 <p>บัญชีแอดมิน / ผู้ดูแล ต้องได้รับอนุญาตจากแท็บ <strong>Users</strong> ข้อมูลยาและประวัติการแก้ไขบันทึกใน <strong>MealMedicines</strong> / <strong>MealMedicineAudit</strong></p>
 <div class="time4med-cloud-actions">
   <button type="button" id="tmCloudLoad" disabled>โหลดรายการยาจาก Sheets</button>
   <button type="button" id="tmCloudCheck" disabled>ตรวจสอบข้อมูลล่าสุด</button>
   <button type="button" id="tmCloudLegacyImport" hidden>นำเข้ารายการจากเว็บรุ่นเก่า (แอดมิน)</button>
 </div>
 <p id="tmCloudState" role="status">กรุณาลงชื่อ Google ด้านหน้าเว็บไซต์ก่อน</p>
 <small>ข้อมูลอยู่ในหน่วยความจำของหน้านี้จนกว่าจะได้รับข้อความบันทึกสำเร็จจาก backend · ห้ามปิดแท็บถ้าการบันทึกยังไม่เสร็จ</small>
 <details id="tmTrialSection" class="time4med-study-form" hidden><summary>🧪 บันทึกผลการทดลองบทที่ 4 (แอดมิน)</summary>
  <p>กรอกสิ่งที่ทดลองและผลที่สังเกตจริงเท่านั้น</p>
  <div class="time4med-study-fields">
    <label>ประเภท<select id="tmTrialCategory"><option value="REMINDER">เสียงแจ้งเตือน</option><option value="CONFIRM">ปุ่มยืนยัน</option><option value="LOCK">กลอน</option><option value="CAMERA">กล้อง</option><option value="MQTT">MQTT</option><option value="WEBSITE">เว็บไซต์ / Google Sheets</option><option value="OTHER">อื่น ๆ</option></select></label>
    <label>วัตถุประสงค์<input id="tmTrialObjective" maxlength="160"></label>
    <label>อุปกรณ์<input id="tmTrialDevice" maxlength="60" value="ESP32S3-01"></label>
    <label>รหัสผู้ทดลอง<input id="tmTrialOperator" maxlength="60" value="TESTER01"></label>
    <label>เวลาเริ่ม<input id="tmTrialStart" type="datetime-local"></label>
    <label>เวลาสิ้นสุด<input id="tmTrialEnd" type="datetime-local"></label>
    <label>ผล<select id="tmTrialPassed"><option value="PASS">ผ่าน</option><option value="FAIL">ไม่ผ่าน</option><option value="UNVERIFIED">ยังไม่ยืนยัน</option></select></label>
    <label>คาดหวัง<textarea id="tmTrialExpected" maxlength="300"></textarea></label>
    <label>ผลจริง<textarea id="tmTrialActual" maxlength="300"></textarea></label>
    <label>หมายเหตุ<textarea id="tmTrialNotes" maxlength="300"></textarea></label>
    <label>รหัสหลักฐาน<input id="tmTrialEvidence" maxlength="120"></label>
  </div><button type="button" id="tmTrialSave">บันทึกผลทดลองลง Sheets</button>
 </details>`;
host.before(panel);
const newOption=(value,label)=>{const o=document.createElement('option');o.value=value;o.textContent=label;return o;};
function patientOptions(){
  const select=el('medicinePatientId'),previousPatientId=select.value;
  select.replaceChildren(newOption('','เลือกผู้ป่วย'));
  for(const p of patients)select.appendChild(newOption(p.id,`${p.id} — ${p.name}`));
  const previous=patients.find(p=>p.id===previousPatientId);
  select.value=previous?.id||'';el('medicinePatient').value=previous?.name||'';
  let picker=el('t4mViewPatient');
  if(!picker){
    const label=document.createElement('label');label.className='t4m-patient-view';
    label.textContent='👨‍👩‍👧‍👦 แสดงรายการยาของ: ';
    picker=document.createElement('select');picker.id='t4mViewPatient';
    label.appendChild(picker);host.before(label);
    picker.addEventListener('change',()=>{window.Time4MedMedicineFilter=picker.value;renderMedicines();window.dispatchEvent(new CustomEvent('time4med-patient-view-changed'));});
  }
  const previously=window.Time4MedMedicineFilter||'';
  picker.replaceChildren(newOption('','ทุกคนในสิทธิ์ของบัญชี'));
  for(const p of patients)picker.appendChild(newOption(p.id,`${p.id} — ${p.name}`));
  picker.value=patients.some(p=>p.id===previously)?previously:(patients.length===1?patients[0].id:'');
  window.Time4MedMedicineFilter=picker.value;
  const checklist=el('t4mInvitePatients');checklist.replaceChildren();
  for(const p of patients){
    const label=document.createElement('label');label.className='t4m-patient-checkbox';
    const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.value=p.id;
    const caption=document.createElement('span');caption.textContent=`${p.id} — ${p.name}`;
    label.append(checkbox,caption);checklist.appendChild(label);
  }
  el('t4mInvitePatientGroup').hidden=el('t4mInviteRole').value==='ADMIN';
  renderMedicines();
}
async function reloadPatients(){patients=(await auth.api('/api/patients')).patients||[];patientOptions();}

function adopt(rows){
  applying=true;
  try{
    medicines=rows.map(m=>({...clean(m),patient:m.patient,createdAt:m.createdAt,updatedAt:m.updatedAt,patientId:m.patientId}));
    if(typeof renderMedicines==='function')renderMedicines();
    window.dispatchEvent(new CustomEvent('time4med-medicines-changed'));
  }finally{applying=false;}
  baseline=new Map(rows.map(m=>[m.id,m]));ready=true;
}
async function remote(){return (await auth.api('/api/medicines')).medicines||[];}
async function refresh(confirmOverwrite=false){
  if(!auth.user)return;
  if(busy)return state('กำลังบันทึกข้อมูลอยู่ รอสักครู่','warning');
  if(confirmOverwrite&&changed()&&!window.confirm('มีข้อมูลในหน้านี้ยังไม่บันทึก การโหลดใหม่จะยกเลิกการเปลี่ยนแปลงเหล่านั้น ยืนยันหรือไม่?'))return;
  ready=false;state('กำลังโหลดรายการยาตามสิทธิ์ของบัญชี…');
  try{const rows=await remote();adopt(rows);state(`โหลดข้อมูลจาก Google Sheets สำเร็จ ${rows.length} รายการ ✓`,'success');}
  catch(e){state('โหลดรายการยาไม่ได้: '+e.message,'error');}
}
function changed(){const mine=new Map(medicines.map(m=>[m.id,m]));if(mine.size!==baseline.size)return true;for(const [id,m] of mine)if(!baseline.has(id)||!equal(m,baseline.get(id)))return true;return false;}
async function sync(){
  if(!ready||!auth.user||applying)return;
  if(busy){again=true;return;}
  busy=true;
  try{
    const mine=new Map(medicines.map(m=>[m.id,m]));
    const actions=[];
    for(const [id,m] of mine){const old=baseline.get(id);if(!old)actions.push({type:'create',item:m});else if(!equal(m,old))actions.push({type:'update',item:m,old});}
    for(const [id,old] of baseline)if(!mine.has(id))actions.push({type:'delete',old});
    if(!actions.length)return;
    state(`กำลังส่งรายการเปลี่ยนแปลง ${actions.length} รายการ…`);
    for(const act of actions){
      let response;
      if(act.type==='create')response=await auth.api('/api/medicines',{method:'POST',body:clean(act.item)});
      else if(act.type==='update')response=await auth.api('/api/medicines/'+encodeURIComponent(act.item.id),{method:'PUT',body:{...clean(act.item),updatedAt:act.old.updatedAt}});
      else response=await auth.api('/api/medicines/'+encodeURIComponent(act.old.id),{method:'DELETE',body:{updatedAt:act.old.updatedAt}});
      if(act.type==='delete')baseline.delete(act.old.id);
      else baseline.set(response.medicine.id,response.medicine);
    }
    const persisted=await remote();
    const persistedById=new Map(persisted.map(m=>[m.id,m]));
    for(const act of actions){
      const id=act.type==='delete'?act.old.id:act.item.id;
      if(act.type==='delete')baseline.delete(id);
      else {
        const saved=persistedById.get(id);
        if(!saved)throw Error('ไม่พบรายการที่เพิ่งบันทึกใน Google Sheets กรุณาโหลดข้อมูลใหม่');
        baseline.set(id,saved);
      }
    }
    state(`บันทึกข้อมูลและ Audit ใน Google Sheets สำเร็จ ✓ ${actions.length} รายการ`,'success');
  }catch(e){ready=false;state('บันทึกไม่สำเร็จ: '+e.message+' · อย่าเพิ่งปิดหน้านี้ ให้ตรวจ Google Sheets ก่อน','error');}
  finally{busy=false;if(again){again=false;if(ready)writeChain=writeChain.then(sync);}}
}
async function legacyImport(){
  if(auth.user?.role!=='ADMIN')return;
  let old=[];try{old=JSON.parse(localStorage.getItem('time4medMedicines')||'[]');}catch(_){state('ข้อมูลในเบราว์เซอร์รุ่นเก่าไม่ใช่ JSON','error');return;}
  if(!Array.isArray(old)||!old.length)return state('ไม่พบรายการยาเดิมในเบราว์เซอร์','warning');
  const oldNames=[...new Set(old.map(x=>String(x.patient||'').trim()))];
  const mapping={};
  for(const name of oldNames){
    const choices=patients.map(p=>`${p.id}=${p.name}`).join(' | ');
    const entered=prompt(`จับคู่ผู้ป่วยเดิม: ${name||'(ไม่ระบุ)'}\nกรอก patient_id ของผู้ป่วยรายนี้:\n${choices}`,'');
    if(entered===null)return;
    const p=patients.find(p=>p.id===entered.trim());if(!p){state('ไม่พบรหัสผู้ป่วย '+entered,'error');return;}
    mapping[name]=p;
  }
  if(!window.confirm(`จะนำเข้ายาเดิม ${old.length} รายการโดยใช้การจับคู่ผู้ป่วยตามที่เลือก กรุณาตรวจว่าข้อมูลเหมาะสม ยืนยันหรือไม่?`))return;
  let made=0;
  try{
    const current=await remote(),ids=new Set(current.map(x=>x.id));
    for(const r of old){if(ids.has(r.id))continue;
      const p=mapping[String(r.patient||'').trim()];
      const data={...r,patientId:p.id,id:r.id||crypto.randomUUID()};
      await auth.api('/api/medicines',{method:'POST',body:clean(data)});made++;
    }
    await refresh();state(`นำเข้ารายการเก่าสำเร็จ ${made} รายการ · ควรตรวจสอบว่าตำแหน่งตรงกับฉลาก`,'success');
    // Keep legacy data untouched until separately backed up by owner.
  }catch(e){state(`นำเข้าได้ ${made} รายการก่อนมีข้อผิดพลาด: ${e.message} · ตรวจชีตก่อนลองซ้ำ`,'error');}
}
async function saveTrial(){
  if(auth.user?.role!=='ADMIN')return;
  const v=id=>el(id).value.trim();
  if(!v('tmTrialObjective')||!v('tmTrialExpected')||!v('tmTrialActual'))return state('ผลทดลองกรอกไม่ครบ','error');
  try{const response=await auth.api('/api/experiments',{method:'POST',body:{category:v('tmTrialCategory'),objective:v('tmTrialObjective'),device:v('tmTrialDevice'),operator:v('tmTrialOperator'),startedAt:v('tmTrialStart'),endedAt:v('tmTrialEnd'),passed:v('tmTrialPassed'),expected:v('tmTrialExpected'),actual:v('tmTrialActual'),notes:v('tmTrialNotes'),evidence:v('tmTrialEvidence')}});state('บันทึกผลทดลองแล้ว ✓ '+response.trialId,'success');}
  catch(e){state('บันทึกผลทดลองไม่ได้: '+e.message,'error');}
}
const adminMsg=message=>{el('t4mAdminMessage').textContent=message;};
function selectedPatients(){return [...el('t4mInvitePatients').querySelectorAll('input[type="checkbox"]:checked')].map(x=>x.value);}
function clearEditUser(){
  editingUserId=null;el('t4mInviteEmail').readOnly=false;el('t4mInviteEmail').value='';
  el('t4mInviteName').value='';el('t4mInviteRole').value='CAREGIVER';
  el('t4mInvitePatients').querySelectorAll('input').forEach(x=>{x.checked=false;});
  el('t4mInviteButton').textContent='เพิ่มบัญชี';el('t4mCancelEditUser').hidden=true;
  el('t4mInvitePatientGroup').hidden=false;
}
function beginEditUser(u){
  if(auth.user?.role!=='ADMIN')return;
  editingUserId=u.id;el('t4mInviteEmail').value=u.email;el('t4mInviteEmail').readOnly=true;
  el('t4mInviteName').value=u.name||'';el('t4mInviteRole').value=u.role;
  const scope=new Set(String(u.patientIds||'').split(',').map(x=>x.trim()));
  el('t4mInvitePatients').querySelectorAll('input').forEach(x=>{x.checked=scope.has(x.value);});
  el('t4mInvitePatientGroup').hidden=u.role==='ADMIN';
  el('t4mInviteButton').textContent='บันทึกการเปลี่ยนสิทธิ์';el('t4mCancelEditUser').hidden=false;
  el('t4mAdminSection').scrollIntoView({behavior:'smooth',block:'start'});
  adminMsg('กำลังแก้ไขบัญชี '+u.email+' · ตรวจสอบสิทธิ์ผู้ป่วยก่อนบันทึก');
}
async function updateUsers(){
  if(auth.user?.role!=='ADMIN')return;
  const accounts=el('t4mAdminAccounts');accounts.replaceChildren();
  try{
    const result=await auth.api('/api/users');assignedUsers=result.users||[];
    const title=document.createElement('p');title.textContent=`บัญชีในระบบ ${assignedUsers.length} รายการ`;accounts.appendChild(title);
    const table=document.createElement('table');
    for(const u of assignedUsers){
      const tr=document.createElement('tr');
      for(const value of [u.email,auth.roleLabel(u.role),u.role==='ADMIN'?'ทุกคน':u.patientIds,u.status]){
        const td=document.createElement('td');td.textContent=value;tr.appendChild(td);
      }
      const td=document.createElement('td'),button=document.createElement('button');
      button.type='button';button.textContent='แก้ไขสิทธิ์';
      button.addEventListener('click',()=>beginEditUser(u));td.appendChild(button);tr.appendChild(td);table.appendChild(tr);
    }
    accounts.appendChild(table);
  }catch(e){adminMsg('โหลดบัญชีไม่ได้: '+e.message);}
}
async function addUser(){
  if(auth.user?.role!=='ADMIN')return;
  const role=el('t4mInviteRole').value,email=el('t4mInviteEmail').value.trim();
  const patientIds=role==='ADMIN'?'ALL':selectedPatients().join(',');
  if(role==='CAREGIVER'&&!patientIds)return adminMsg('กรุณาเลือกผู้ป่วยอย่างน้อย 1 คน');
  const btn=el('t4mInviteButton');btn.disabled=true;adminMsg('กำลังบันทึกสิทธิ์ผู้ใช้งาน…');
  try{
    const body={email,role,patientIds,name:el('t4mInviteName').value.trim()};
    if(editingUserId){
      const user=assignedUsers.find(x=>x.id===editingUserId);
      if(!user)throw Error('ไม่พบบัญชีที่ต้องการแก้ไข กรุณาโหลดใหม่');
      if(!user.updatedAt)throw Error('กรุณาอัปเดต Cloudflare Worker เป็น v0.19 ก่อนแก้ไขบัญชีเดิม');
      await auth.api('/api/users/'+encodeURIComponent(editingUserId),{method:'PUT',body:{...body,updatedAt:user.updatedAt}});
    }else await auth.api('/api/users',{method:'POST',body});
    const saved=email;clearEditUser();await updateUsers();adminMsg('บันทึกสิทธิ์ '+saved+' สำเร็จ ✓');
  }catch(e){adminMsg('บันทึกสิทธิ์ไม่ได้: '+e.message);}
  finally{btn.disabled=false;}
}
async function addPatient(){
  if(auth.user?.role!=='ADMIN')return;
  const id=el('t4mNewPatientId').value.trim().toUpperCase(),name=el('t4mNewPatientName').value.trim();
  const notes=el('t4mNewPatientNotes').value.trim(),btn=el('t4mAddPatientButton');
  if(!/^P[0-9]{3,6}$/.test(id)||!name){el('t4mPatientMessage').textContent='กรอกรหัสเช่น P002 และชื่อผู้ป่วยให้ครบ';return;}
  btn.disabled=true;el('t4mPatientMessage').textContent='กำลังเพิ่มผู้ป่วย…';
  try{
    await auth.api('/api/patients',{method:'POST',body:{id,name,notes}});
    await reloadPatients();el('t4mNewPatientId').value='';el('t4mNewPatientName').value='';el('t4mNewPatientNotes').value='';
    el('t4mPatientMessage').textContent='เพิ่ม '+id+' สำเร็จ ✓ สามารถเลือกกำหนดสิทธิ์ให้ผู้ดูแลได้แล้ว';
  }catch(e){el('t4mPatientMessage').textContent='เพิ่มผู้ป่วยไม่ได้: '+e.message+' · ตรวจสอบว่าปรับใช้ Worker v0.19 แล้ว';}
  finally{btn.disabled=false;}
}

window.addEventListener('time4med-auth-changed',async event=>{
  ready=false;baseline.clear();patients=[];
  // Never leave the previous account's patient medicines visible during an account switch.
  medicines=[];if(typeof renderMedicines==='function')renderMedicines();
  if(!event.detail.user){clearEditUser();patientOptions();adopt([]);ready=false;state('ออกจากระบบแล้ว');return;}
  try{patients=(await auth.api('/api/patients')).patients||[];patientOptions();el('tmTrialSection').hidden=auth.user.role!=='ADMIN';el('tmCloudLegacyImport').hidden=auth.user.role!=='ADMIN';
    await refresh();if(auth.user.role==='ADMIN')await updateUsers();}
  catch(e){state('ตรวจสิทธิ์ไม่สำเร็จ: '+e.message,'error');}
});
window.addEventListener('time4med-medicines-changed',()=>{if(!applying&&auth.user&&ready)writeChain=writeChain.then(sync).catch(e=>state(e.message,'error'));});
el('tmCloudLoad').addEventListener('click',()=>refresh(true));
el('tmCloudCheck').addEventListener('click',()=>refresh(true));
el('tmCloudLegacyImport').addEventListener('click',legacyImport);
el('tmTrialSave').addEventListener('click',saveTrial);
el('t4mInviteButton').addEventListener('click',addUser);
el('t4mInviteRole').addEventListener('change',()=>{el('t4mInvitePatientGroup').hidden=el('t4mInviteRole').value==='ADMIN';});
el('t4mCancelEditUser').addEventListener('click',clearEditUser);
el('t4mAddPatientButton').addEventListener('click',addPatient);
// The Cloud controls become usable once a verified login has loaded patient data.
window.addEventListener('time4med-auth-changed',e=>{el('tmCloudLoad').disabled=!e.detail.user;el('tmCloudCheck').disabled=!e.detail.user;});
window.addEventListener('beforeunload',e=>{if(busy||changed()){e.preventDefault();e.returnValue='';}});
})();
