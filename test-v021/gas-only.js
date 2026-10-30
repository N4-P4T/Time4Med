/* Legacy Pages interface. The canonical Time4Med link uses Apps Script directly; no external login API. */
(() => {
'use strict';
const WEB_APP = 'https://script.google.com/macros/s/AKfycbx2-O9PDp-T0eXoP1A9_xesHk8mWcWszAbLsbsFOMpARpIIICibdKu6On0G0agGdMIEtQ/exec';
// Mobile visitors arrive from the same LINE URL as desktop users.
 // Use the existing Google-hosted HTML app as a first-party destination
 // on iOS/Android, bypassing the cross-site iframe transport entirely.
 const mobileDevice=/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
   (navigator.userAgentData && navigator.userAgentData.mobile===true) ||
   (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);
 if(mobileDevice && !new URLSearchParams(location.search).has('desktop')) {
   window.location.replace(WEB_APP);
   return;
 }
// External login API removed; historical Pages view retains OTP only.
const API_URL='';
function makeChannel(){return Array.from(crypto.getRandomValues(new Uint8Array(24)),x=>x.toString(16).padStart(2,'0')).join('');}
// Google Apps Script documents unsupported multi-Google-account routing. An explicit
// authuser hint sometimes helps; it cannot be guaranteed to work on all accounts.
const AUTHUSER_ATTEMPTS = [null, 0, 1, 2, 3];
const MEALS = ['','ก่อนอาหารเช้า','หลังอาหารเช้า','ก่อนอาหารกลางวัน','หลังอาหารกลางวัน','ก่อนอาหารเย็น','หลังอาหารเย็น','ก่อนนอน'];
const DAYS = [['MON','จ'],['TUE','อ'],['WED','พ'],['THU','พฤ'],['FRI','ศ'],['SAT','ส'],['SUN','อา']];
const state={peer:null,origin:null,channel:null,frames:new Map(),seq:0,pending:new Map(),token:null,data:null,ready:false,view:'dashboard'};
const $=id=>document.getElementById(id);
const html=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const text=(id,s)=>{const e=$(id);if(e)e.textContent=s;};
const message=(s,bad=false)=>{const e=$('gasStatus');if(e){e.textContent=s;e.classList.toggle('bad',bad);}else console.log(s);};
const activeMedicines=()=>state.data.medicines.filter(x=>x.active&&!x.demo&&String(x.kind).toUpperCase()!=='PRN');
const safeVal=(s)=>html(s);
const asTime=x=>/^\d\d:\d\d$/.test(x)?x:'—';
function bridgeOrigin(origin) {
  try {const u=new URL(origin);return u.protocol==='https:' && (u.hostname==='script.google.com'||u.hostname==='script.googleusercontent.com'||u.hostname.endsWith('.googleusercontent.com'));}catch(_){return origin==='null';}
}
async function call(method,...args) {
  if(API_URL){
    const response=await fetch(API_URL,{method:'POST',mode:'cors',credentials:'omit',cache:'no-store',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({method,args})});
    let result;
    try{result=await response.json();}catch(_){throw Error('API ตอบกลับไม่ถูกต้อง (HTTP '+response.status+')');}
    if(!response.ok||!result.ok)throw Error(result.error||'API ไม่สำเร็จ (HTTP '+response.status+')');
    return result.value;
  }
  if(!state.ready) return Promise.reject(Error('ยังเชื่อมต่อ Apps Script ไม่ได้ ตรวจโปรไฟล์ Google หรือเลือกเปิดในหน้าต่างส่วนตัว'));
  return new Promise((resolve,reject)=>{
    const id=++state.seq;
    const timer=setTimeout(()=>{state.pending.delete(id);reject(Error('Apps Script ตอบสนองช้าเกินไป กรุณาลองใหม่'));},45000);
    state.pending.set(id,{resolve,reject,timer});
    state.peer.postMessage({app:'time4med-gas-bridge',type:'call',channel:state.channel,id,method,args},state.origin==='null'?'*':state.origin);
  });
}
window.addEventListener('message',event=>{
  const d=event.data;
  if(!d||d.app!=='time4med-gas-bridge'||!state.frames.has(d.channel)||!bridgeOrigin(event.origin))return;
  if(d.type==='ready'&&!state.ready){
    state.peer=event.source;state.origin=event.origin;state.channel=d.channel;state.ready=true;
    // Keep only the iframe that completed the handshake. Do not disturb live GAS RPC.
    for(const [key,frame] of state.frames)if(key!==d.channel){frame.remove();state.frames.delete(key);}
    text('gasConnectState','เชื่อมต่อ Apps Script แล้ว');
    state.peer.postMessage({app:'time4med-gas-bridge',type:'hello',channel:state.channel},event.origin==='null'?'*':event.origin);
    message('เชื่อมต่อแล้ว กรุณากรอกอีเมลเข้าสู่ระบบ');
  }
  if(d.type==='reply'&&state.ready&&d.channel===state.channel&&event.source===state.peer&&event.origin===state.origin){
    const p=state.pending.get(d.id);if(!p)return;
    state.pending.delete(d.id);clearTimeout(p.timer);
    if(d.ok)p.resolve(d.value);else p.reject(Error(d.error||'คำขอไม่สำเร็จ'));
  }
});
function installBridge(){
  let next=0;
  function tryNext(){
    if(state.ready)return;
    if(next>=AUTHUSER_ATTEMPTS.length){
      text('gasConnectState','Google Apps Script ไม่ตอบกลับ');
      message('การเชื่อมต่อผ่าน GitHub Pages ไม่สำเร็จ — ลองเปิดหน้า Time4Med สำรองโดยตรง (ไม่ต้องใช้บัญชีแอดมินร่วมกัน)',true);
      showDirectFallback('ลองเปิดหน้า Apps Script โดยตรงในเบราว์เซอร์ของโทรศัพท์ โดยใช้บัญชีและรหัส OTP ของตัวเอง ไม่ต้องใช้บัญชีแอดมินร่วมกัน');
      return;
    }
    const hint=AUTHUSER_ATTEMPTS[next++];
    const channel=makeChannel();
    const frame=document.createElement('iframe');
    frame.id=next===1?'time4medSecureBridge':'time4medSecureBridge'+next;
    frame.title='Time4Med Apps Script Bridge';
    frame.hidden=true;
    frame.setAttribute('aria-hidden','true');
    frame.src=WEB_APP+'?bridge=1&channel='+channel+(hint===null?'':'&authuser='+hint);
    state.frames.set(channel,frame);
    document.body.appendChild(frame);
    if(next>1)text('gasConnectState','ลองช่องทางสำรอง '+(next-1)+'/'+(AUTHUSER_ATTEMPTS.length-1)+'…');
    // A failed Google account route can return 404 before doGet; retry a bounded
    // set of account hints, never send OTP or other data in the URL.
    window.setTimeout(tryNext,5000);
  }
  tryNext();
}
function syncVerifiedProfile(){
  if(!state.data||!state.data.user)return;
  const user=state.data.user;
  const role=user.role==='ADMIN'?'แอดมิน (ADMIN)':'ผู้ดูแล (CAREGIVER)';
  document.querySelectorAll('.t4m-profile-role').forEach(el=>{
    el.textContent=role;
    el.title='สิทธิ์บัญชี Time4Med: '+user.role;
  });
  document.querySelectorAll('.t4m-profile-name').forEach(el=>el.textContent=user.name||user.email);
}
async function signedIn(result,box){
  if(!result||!result.token)throw Error('ไม่พบเซสชันที่ถูกต้อง');
  state.token=result.token;state.data=await call('bootstrap',state.token);
  box.hidden=true;document.body.classList.remove('t4m-auth-locked');
  const bar=$('t4mUserbar');if(bar)bar.hidden=false;
  const user=state.data.user;
  text('t4mSignedInUser',user.email);render();
}
// The bridge iframe may load correctly even when google.script.run cannot
// complete a call in iOS Safari / in-app browsers. A top-level Apps Script
// page is a same-backend fallback; it is not an alternate login or service.
function showDirectFallback(noteText){
  const link=$('gasDirectFallback'),note=$('gasFallbackNote');
  if(link)link.hidden=false;
  if(note){note.hidden=false;if(noteText)note.textContent=noteText;}
}
function handleOtpTransportError(err,operation){
  if(!/Apps Script ตอบสนองช้าเกินไป/.test(String(err.message||err))){
    message(err.message||String(err),true);return;
  }
  // A timeout does NOT prove no email was sent. Avoid blindly sending again:
  // allow the 6-digit code to be entered if it has already arrived.
  const form=$('gasOtpVerify');if(form)form.hidden=false;
  message(operation==='request'
    ? 'ไม่ได้รับผลตอบกลับจาก Apps Script — OTP อาจส่งแล้ว กรุณาตรวจอีเมลก่อนขอใหม่ หากยังใช้ไม่ได้ให้เปิดหน้า Apps Script โดยตรงด้านล่าง'
    : 'การตรวจ OTP ไม่ตอบกลับ ลองเปิดหน้า Apps Script โดยตรงด้านล่างแล้วเข้าสู่ระบบด้วยอีเมลของคุณ',true);
  showDirectFallback('สำหรับ Safari หรือเบราว์เซอร์ใน LINE: ลองเปิดหน้า Apps Script โดยตรงใน Safari หากได้รับ OTP แล้วให้ลองใช้รหัสเดิมก่อนหมดอายุ (10 นาที) และอย่ากดขอรหัสซ้ำหลายครั้ง');
}
function startAuth(){
  const box=$('t4mAuthScreen');
  if(API_URL){
    box.innerHTML='<div class="t4m-auth-card gas-login"><img src="../test-v019/logo.png" class="t4m-auth-logo" alt="Time4Med">'+
      '<h1>Time4Med</h1><p>เข้าสู่ระบบด้วยชื่อผู้ใช้และรหัสผ่าน</p>'+
      '<form id="gasPasswordLogin"><label for="gasUsername">ชื่อผู้ใช้งาน</label><input id="gasUsername" autocomplete="username" required maxlength="120">'+
      '<label for="gasPassword">รหัสผ่าน</label><input id="gasPassword" type="password" autocomplete="current-password" required>'+
      '<button class="gas-btn" type="submit">เข้าสู่ระบบ</button></form>'+
      '<p id="gasStatus" role="status">API พร้อมให้เข้าสู่ระบบ</p><small id="gasConnectState">Google Sheets · ไม่ต้องเปิดบัญชี Google</small></div>';
    $('gasPasswordLogin').addEventListener('submit',async ev=>{
      ev.preventDefault();const btn=ev.submitter;if(btn)btn.disabled=true;
      try{
        message('กำลังตรวจบัญชี...');
        const result=await call('login',$('gasUsername').value.trim(),$('gasPassword').value);
        $('gasPassword').value='';
        await signedIn(result,box);
      }catch(e){message(e.message,true);}finally{if(btn)btn.disabled=false;}
    });
    const signout=$('t4mSignOut');if(signout)signout.addEventListener('click',async()=>{
      const token=state.token;state.token=null;state.data=null;
      try{await call('logout',token);}catch(_){}window.location.reload();
    });
    return;
  }
  box.innerHTML='<div class="t4m-auth-card gas-login"><img src="../test-v019/logo.png" class="t4m-auth-logo" alt="Time4Med">'+
  '<h1>Time4Med</h1><p>เข้าสู่ระบบผู้ดูแลด้วยอีเมล OTP</p>'+
  '<form id="gasOtpRequest"><label for="gasEmail">อีเมลที่ได้รับสิทธิ์</label><input id="gasEmail" type="email" autocomplete="email" required placeholder="name@example.com">'+
  '<button type="submit" class="gas-btn">ส่งรหัสเข้าอีเมล</button></form>'+
  '<form id="gasOtpVerify" hidden><label for="gasOtp">รหัสยืนยัน 6 หลัก</label>'+
  '<input id="gasOtp" type="text" maxlength="6" pattern="[0-9]{6}" inputmode="numeric" autocomplete="one-time-code" required>'+
  '<button type="submit" class="gas-btn">เข้าสู่ระบบ</button></form>'+
  '<p id="gasStatus" role="status">กำลังเชื่อมต่อ Apps Script...</p>'+
  '<small id="gasConnectState">กำลังเชื่อมต่อ...</small>'+
  '<a id="gasDirectFallback" class="gas-direct-fallback" href="'+WEB_APP+'" target="_blank" rel="noopener noreferrer" hidden>เปิด Time4Med โดยตรง (สำหรับ Safari / LINE)</a>'+
  '<small id="gasFallbackNote" class="gas-fallback-note" hidden>ใช้หน้า Apps Script เดิมและ OTP ของผู้ดูแลเอง ไม่ต้องใช้บัญชีแอดมินร่วมกัน</small></div>';
  $('gasOtpRequest').addEventListener('submit',async ev=>{
    ev.preventDefault();const b=ev.submitter;if(b)b.disabled=true;
    try{message('กำลังส่ง OTP...');await call('requestOtp',$('gasEmail').value.trim());
      $('gasOtpVerify').hidden=false;message('หากบัญชีมีสิทธิ์ ระบบจะส่ง OTP ไปยังอีเมล');$('gasOtp').focus();}
    catch(e){handleOtpTransportError(e,'request');}finally{if(b)b.disabled=false;}
  });
  $('gasOtpVerify').addEventListener('submit',async ev=>{
    ev.preventDefault();const b=ev.submitter;if(b)b.disabled=true;
    try{
      message('กำลังตรวจรหัส...');const result=await call('verifyOtp',$('gasEmail').value.trim(),$('gasOtp').value.trim());
      await signedIn(result,box);
    }catch(e){handleOtpTransportError(e,'verify');}finally{if(b)b.disabled=false;}
  });
  // Make the direct Google-hosted version accessible without a 45s wait on
  // iPhones, where the cross-site embedded Apps Script transport is fragile.
  if(/iPhone|iPad|iPod/i.test(navigator.userAgent))
    showDirectFallback('บน iPhone หากส่ง OTP ไม่สำเร็จ สามารถเปิดหน้า Apps Script โดยตรงใน Safari ได้ (ยังใช้ OTP และสิทธิ์เดิม)');
  const out=$('t4mSignOut');if(out)out.addEventListener('click',async()=>{
    const token=state.token;state.token=null;state.data=null;
    try{await call('logout',token);}catch(_){}
    window.location.reload();
  });
}
async function reload(){
  state.data=await call('bootstrap',state.token);
  render();
}
function kpi(label,value,detail,icon){
  return '<article class="t21-kpi"><div class="t21-kpi-top"><span class="t21-kpi-icon t21-blue">'+icon+
    '</span><span class="t21-kpi-label">'+html(label)+'</span></div>'+
    '<div class="t21-kpi-value">'+html(value)+'</div><small>'+html(detail)+'</small></article>';
}
function panel(title,body){
  return '<article class="panel-card gas-panel"><div class="panel-heading"><div class="heading-left">'+
    '<h2>'+html(title)+'</h2></div></div><div class="gas-panel-body">'+body+'</div></article>';
}
function tbl(head,rows){
  return '<div class="gas-scroll"><table class="gas-table"><thead><tr>'+head.map(x=>'<th>'+html(x)+'</th>').join('')+
  '</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';
}
function tr(cells){
  return '<tr>'+cells.map(x=>'<td>'+x+'</td>').join('')+'</tr>';
}
const empty=label=>'<p class="gas-muted">'+html(label)+'</p>';
function dashboard(){
  const d=state.data,active=activeMedicines();
  const today=new Date(),now=today.getHours()*60+today.getMinutes();
  const next=active.filter(x=>/^\d\d:\d\d$/.test(x.time)).map(x=>({...x,minute:Number(x.time.slice(0,2))*60+Number(x.time.slice(3,5))}))
    .filter(x=>x.minute>=now).sort((a,b)=>a.minute-b.minute)[0];
  const rows=d.patients.map(p=>tr([html(p.id),html(p.name),html('ชั้น '+p.shelf),
    html(active.filter(x=>x.patientId===p.id).length+' รายการ')]));
  return '<div class="t21-heading"><div class="t21-heading-main"><p class="t21-eyebrow">TIME4MED / CAREGIVER CENTER</p>'+
    '<h1>ภาพรวมการดูแลวันนี้</h1><p class="t21-heading-description">ข้อมูลจาก Google Sheets ผ่าน '+(API_URL?'API':'Google Apps Script')+'</p></div></div>'+
    '<div class="t21-kpis">'+kpi('ผู้สูงอายุในสิทธิ์',d.patients.length,'P001–P003','👥')+
    kpi('รายการยาที่ใช้งาน',active.length,'ไม่รวมรายการทดสอบ','💊')+
    kpi('มื้อยาถัดไปวันนี้',next?next.time:'—',next?next.patientId+' '+next.meal:'ไม่พบรอบที่เหลือในวันนี้','◷')+
    kpi('อุปกรณ์ออนไลน์',d.devices.filter(x=>x.online==='ONLINE').length,'นับเฉพาะสถานะที่ยังไม่หมดอายุ','📶')+'</div>'+
    panel('ผู้สูงอายุและชั้นยา',tbl(['รหัส','ชื่อ','ชั้น','จำนวนรายการยา'],rows))+
    panel('สถานะการเชื่อมต่อ','<p>เว็บไซต์ GitHub Pages → '+(API_URL?'API':'Apps Script')+' → Google Sheets</p>'+
      '<p class="gas-muted">LINE ส่งจาก Apps Script ตามรอบยาโดยอิสระจากการเปิดหน้าเว็บ การกดยืนยันไม่ใช่หลักฐานว่ากลืนยาแล้ว</p>'+
      '<button class="gas-btn" data-action="refresh">โหลดข้อมูลล่าสุด</button>')+
    (API_URL?panel('เปลี่ยนรหัสผ่านบัญชีของฉัน','<form id="gasPasswordChange" class="gas-form">'+
      '<label>รหัสผ่านปัจจุบัน<input id="oldPassword" type="password" autocomplete="current-password" required></label>'+
      '<label>รหัสผ่านใหม่ (อย่างน้อย 12 ตัว)<input id="newPassword" type="password" autocomplete="new-password" minlength="12" required></label>'+
      '<button type="submit" class="gas-btn">เปลี่ยนรหัสผ่าน</button></form>'):'');
}
function medication(){
  const d=state.data,items=d.medicines.filter(x=>!x.demo);
  const rows=items.map(m=>tr([html(m.patientId),html(m.name),html(m.meal),html(asTime(m.time)),html(m.days),
    m.active?'ใช้งาน':'ปิดใช้','<button class="gas-btn light" data-action="edit" data-id="'+html(m.id)+'">แก้ไข</button> '+
    (m.active?'<button class="gas-btn danger" data-action="disable" data-id="'+html(m.id)+'">ปิดใช้</button>':'')]));
  const pOptions=d.patients.map(p=>'<option value="'+html(p.id)+'">'+html(p.id+' ชั้น '+p.shelf+' — '+p.name)+'</option>').join('');
  const mealOptions=MEALS.slice(1).map((m,i)=>'<option value="'+(i+1)+'">'+html(m)+'</option>').join('');
  const choices=DAYS.map(([key,label])=>'<label class="gas-day"><input type="checkbox" value="'+key+'" name="medDay" checked> '+label+'</label>').join('');
  return '<div class="gas-heading"><h1>รายการยาและรอบแจ้งเตือน</h1><p>บันทึกลง Google Sheets · สิทธิ์ตามผู้สูงอายุ</p></div>'+
    panel('ตารางยาปัจจุบัน',rows.length?tbl(['ผู้สูงอายุ','ชื่อยา','มื้อยา','เวลา','วัน','สถานะ','จัดการ'],rows):empty('ยังไม่มีรายการยา'))+
    panel('เพิ่มหรือแก้ไขรายการยา','<form id="gasMedicineForm" class="gas-form">'+
      '<input id="medId" type="hidden"><label>ผู้สูงอายุ<select id="medPatient" required>'+pOptions+'</select></label>'+
      '<label>ชื่อยา<input id="medName" minlength="2" maxlength="120" required placeholder="ระบุชื่อยา"></label>'+
      '<label>มื้อยา<select id="medMeal" required>'+mealOptions+'</select></label>'+
      '<label>เวลาแจ้งเตือน<input id="medTime" type="time" required value="08:00"></label>'+
      '<div><strong>วันแจ้งเตือน</strong><div class="gas-days">'+choices+'</div></div>'+
      '<label>คำแนะนำ<textarea id="medInstruction" maxlength="500" rows="2"></textarea></label>'+
      '<label class="gas-inline"><input id="medActive" type="checkbox" checked> เปิดใช้งาน</label>'+
      '<div class="gas-actions"><button type="submit" class="gas-btn">บันทึกตารางยา</button>'+
      '<button type="button" data-action="new" class="gas-btn light">ล้างแบบฟอร์ม</button></div></form>');
}
function inventory(){
  const d=state.data,active=activeMedicines();
  const rows=[1,2,3].map(s=>{
    const p='P00'+s,items=active.filter(x=>x.patientId===p);
    return tr([html('ชั้น '+s),html(p),html(items.length+' รายการ'),html(items.map(x=>x.name).join(', ')||'—')]);
  });
  rows.push(tr(['ชั้น 4','ยาสามัญประจำบ้าน','ไม่ใช้ LED','ไม่มีการแยกผู้รับยา']));
  return '<div class="gas-heading"><h1>แผนผังตู้และคลังยา</h1></div>'+
    panel('ชั้นยา 4 ชั้น',tbl(['ตำแหน่ง','ผู้ใช้','จำนวนรายการ','รายการยา'],rows))+
    panel('สถานะสต็อก','<p class="gas-muted">ระบบปัจจุบันเก็บสถานะยา ไม่ได้นับจำนวนเม็ดยาจากซองยาอัตโนมัติ</p>');
}
function devices(){
  const rows=state.data.devices.map(x=>tr([html(x.id),html(x.type),html(x.online),html(x.lastSeen||'—'),html(x.lock||'—')]));
  return '<div class="gas-heading"><h1>สถานะอุปกรณ์</h1><p>สถานะจาก heartbeat จริง ไม่แสดง ONLINE หากข้อมูลหมดอายุ</p></div>'+
    panel('ESP32-S3 / ESP32-CAM',rows.length?tbl(['อุปกรณ์','ชนิด','สถานะ','รับข้อมูลล่าสุด','กลอน'],rows):empty('อุปกรณ์ยังไม่ส่ง heartbeat เข้าระบบ'))+
    panel('ข้อจำกัด','<p class="gas-muted">เว็บนี้ไม่ส่งคำสั่งปลดล็อกผ่านอินเทอร์เน็ต การปลดล็อกใช้ปุ่มยืนยันที่ตู้ตามแบบระบบปัจจุบัน</p>');
}
function analytics(){
  const d=state.data,active=activeMedicines();
  return '<div class="gas-heading"><h1>สถิติภาพรวม</h1></div><div class="t21-kpis">'+
    kpi('ยาใช้งาน',active.length,'รายการ','💊')+
    kpi('ผู้สูงอายุ',d.patients.length,'มีสิทธิ์ดูแล','👥')+
    kpi('ประวัติกิจกรรม',d.activity.length,'รายการที่แสดงล่าสุด','◷')+
    kpi('ภาพหลักฐาน',d.images.filter(x=>String(x.available).toUpperCase()==='TRUE').length,'ภาพที่ระบุว่าพร้อมใช้งาน','📷')+
    '</div>'+panel('หมายเหตุ','<p>สถิตินี้คือจำนวนรายการที่ระบบมีข้อมูล ไม่ใช่อัตราการรับประทานยาจริง</p>');
}
function activity(){
  const rows=state.data.activity.map(x=>tr([html(x.time),html(x.patientId),html(x.type),html(x.result),html(x.details)]));
  return '<div class="gas-heading"><h1>พฤติกรรมและประวัติกิจกรรม</h1></div>'+
    panel('เหตุการณ์ล่าสุด',rows.length?tbl(['เวลา','ผู้สูงอายุ','เหตุการณ์','ผล','รายละเอียด'],rows):empty('ยังไม่มีเหตุการณ์ในประวัติ'));
}
function gallery(){
  const list=state.data.images;
  return '<div class="gas-heading"><h1>คลังรูปภาพ Google Drive</h1><p>เปิดภาพผ่านระบบตรวจสิทธิ์ Apps Script</p></div>'+
    panel('ภาพหลักฐาน',list.length?'<div class="gas-gallery">'+list.map(x=>
      '<div class="gas-photo"><strong>'+html(x.patientId)+'</strong><p>'+html(x.time)+'</p>'+
      '<p>'+html(x.filename)+'</p><button type="button" class="gas-btn light" data-action="image" data-id="'+html(x.id)+'">เปิดภาพ</button>'+
      '<div id="photo-'+html(x.id)+'"></div></div>').join('')+'</div>':empty('ยังไม่มีภาพอัปโหลดเข้า Google Drive'))+
    panel('ข้อควรทราบ','<p class="gas-muted">ภาพที่ยังอยู่เฉพาะ SD Card ไม่สามารถเปิดผ่านอินเทอร์เน็ตได้ ต้องให้ ESP32-CAM อัปโหลดเข้าระบบก่อน</p>');
}
function camera(){
  return '<div class="gas-heading"><h1>กล้อง ESP32-CAM</h1></div>'+
    panel('การดูภาพสด','<p>กล้องทำงานบนเครือข่าย Wi-Fi ภายในบ้าน</p>'+
    '<p class="gas-muted">การเปิดภาพ HTTP จากหน้า HTTPS อาจถูกเบราว์เซอร์บล็อก และผู้ดูแลที่อยู่นอกบ้านจะเข้า IP ภายในบ้านไม่ได้</p>'+
    '<p>ใช้คลังรูปภาพ Google Drive สำหรับตรวจสอบภาพจากระยะไกล</p>'+
    '<button class="gas-btn" data-action="gallery">เปิดคลังภาพ</button>');
}
function admin(){
  if(state.data.user.role!=='ADMIN')return empty('เฉพาะแอดมิน');
  const rows=state.data.users.map(x=>tr([html(x.email),html(x.role),html(x.patients),html(x.status),x.lineConfigured?'เชื่อมแล้ว':'ยังไม่เชื่อม']));
  return '<div class="gas-heading"><h1>จัดการระบบ</h1><p>เฉพาะผู้ดูแลระบบ ADMIN</p></div>'+
  panel('บัญชีผู้ใช้',tbl(['อีเมล','บทบาท','ดูแลผู้สูงอายุ','สถานะ','LINE User ID'],rows))+
  panel('เพิ่มหรือแก้ไขสิทธิ์ผู้ใช้','<form id="gasUserForm" class="gas-form">'+
    '<label>อีเมล<input id="userEmail" type="email" required></label>'+
    (API_URL?'<label>ชื่อผู้ใช้ (a-z, 0-9)<input id="userUsername" autocomplete="off" required minlength="3" maxlength="40" placeholder="caregiver01"></label>'+
      '<label>รหัสผ่านเริ่มต้น (เฉพาะบัญชีใหม่หรือเมื่อต้องการเปลี่ยน)<input id="userNewPassword" type="password" autocomplete="new-password" minlength="12" placeholder="อย่างน้อย 12 ตัวอักษร"></label>':'')+
    '<label>ชื่อแสดง<input id="userName" required></label>'+
    '<label>บทบาท<select id="userRole"><option value="CAREGIVER">CAREGIVER — ผู้ดูแล</option><option value="ADMIN">ADMIN — แอดมิน</option></select></label>'+
    '<label>ผู้สูงอายุที่ดูแล (คั่นด้วย ,)<input id="userPatients" placeholder="P001,P002,P003"></label>'+
    '<label>สถานะ<select id="userStatus"><option value="ACTIVE">ACTIVE</option><option value="INACTIVE">INACTIVE</option></select></label>'+
    '<button class="gas-btn" type="submit">บันทึกบัญชี</button></form>')+
  panel('ทดสอบ LINE','<button data-action="line" class="gas-btn">ส่งข้อความทดสอบไป LINE ของแอดมิน</button>'+
    '<p class="gas-muted">ต้องตั้ง LINE User ID ของ ADMIN ในชีต Users แล้ว การทดสอบนี้ไม่เปิดแจ้งเตือนรอบยาอัตโนมัติ</p>');
}
function render(){
  if(!state.data)return;
  // Keep both profile labels in sync with the role from the authorized backend,
  // including after refreshes and navigation.
  syncVerifiedProfile();
  const allowed=['dashboard','medication','devices','inventory','analytics','activity','camera','gallery','admin'];
  state.view=allowed.includes((window.location.hash||'').slice(1))?(window.location.hash||'').slice(1):'dashboard';
  if(state.view==='admin'&&state.data.user.role!=='ADMIN')state.view='dashboard';
  const pages={dashboard,medication,devices,inventory,analytics,activity,camera,gallery,admin};
  const main=$('dashboard');
  main.innerHTML='<div class="gas-meta"><span id="gasPageStatus">เชื่อมต่อ '+(API_URL?'API':'Apps Script')+' · '+html(state.data.serverTime)+'</span>'+
    '<button type="button" class="gas-btn light" data-action="refresh">↻ โหลดล่าสุด</button></div>'+
    '<div id="gasPageMessage" role="status"></div>'+pages[state.view]();
  document.querySelectorAll('.sidebar-navigation a').forEach(a=>a.classList.toggle('active',a.getAttribute('href')==='#'+state.view));
  if(state.data.user.role==='ADMIN'&&!document.querySelector('.sidebar-navigation a[href="#admin"]')){
    const a=document.createElement('a');a.className='sidebar-link';a.href='#admin';
    a.innerHTML='<span class="sidebar-link-icon">⚙</span><span class="sidebar-link-text"><strong>จัดการระบบ</strong><small>ADMIN</small></span>';
    document.querySelector('.sidebar-navigation').appendChild(a);
  }
  text('mqttConnectionLabel','ข้อมูลจาก '+(API_URL?'API':'Apps Script')+' · ไม่ใช้ MQTT');
  const f=$('gasMedicineForm');if(f)f.addEventListener('submit',saveMedicine);
  const uf=$('gasUserForm');if(uf)uf.addEventListener('submit',saveUser);
  const cp=$('gasPasswordChange');if(cp)cp.addEventListener('submit',async ev=>{
    ev.preventDefault();const btn=ev.submitter;if(btn)btn.disabled=true;
    try{
      await call('changePassword',state.token,$('oldPassword').value,$('newPassword').value);
      window.alert('เปลี่ยนรหัสผ่านแล้ว กรุณาเข้าสู่ระบบใหม่');state.token=null;state.data=null;window.location.reload();
    }catch(e){pageMessage(e.message,true);}finally{if(btn)btn.disabled=false;}
  });
}
function pageMessage(s,bad=false){const el=$('gasPageMessage');if(el){el.textContent=s;el.className=bad?'bad':'';}}
async function saveMedicine(ev){
  ev.preventDefault();
  const ds=[...document.querySelectorAll('[name="medDay"]:checked')].map(x=>x.value);
  if(!ds.length)return pageMessage('เลือกวันแจ้งเตือนอย่างน้อยหนึ่งวัน',true);
  const value={id:$('medId').value,patientId:$('medPatient').value,name:$('medName').value,
    mealType:Number($('medMeal').value),time:$('medTime').value,days:ds.join(','),
    instruction:$('medInstruction').value,active:$('medActive').checked};
  const button=ev.submitter;if(button)button.disabled=true;
  try{await call('saveMedicine',state.token,value);await reload();pageMessage('บันทึกตารางยาสำเร็จ');}
  catch(e){pageMessage(e.message,true);}finally{if(button)button.disabled=false;}
}
async function saveUser(ev){
  ev.preventDefault();
  const value={email:$('userEmail').value,name:$('userName').value,role:$('userRole').value,
    patientIds:$('userPatients').value,status:$('userStatus').value};
  if(API_URL){value.username=$('userUsername').value.trim();value.newPassword=$('userNewPassword').value;}
  try{await call('saveUser',state.token,value);await reload();pageMessage('บันทึกบัญชีแล้ว');}
  catch(e){pageMessage(e.message,true);}
}
document.addEventListener('click',async e=>{
  const btn=e.target.closest('[data-action]');if(!btn||!state.data)return;
  const action=btn.dataset.action,id=btn.dataset.id;btn.disabled=true;
  try{
    if(action==='refresh')await reload();
    else if(action==='gallery')window.location.hash='#gallery';
    else if(action==='line'){await call('testLine',state.token);pageMessage('ส่งข้อความทดสอบ LINE สำเร็จ');}
    else if(action==='disable'){
      const m=state.data.medicines.find(x=>x.id===id);if(!m||!window.confirm('ปิดใช้งานยา '+m.name+' ของ '+m.patientId+'?'))return;
      await call('disableMedicine',state.token,id);await reload();pageMessage('ปิดใช้รายการยาแล้ว');
    }else if(action==='new'){$('gasMedicineForm').reset();$('medId').value='';}
    else if(action==='edit'){
      const m=state.data.medicines.find(x=>x.id===id);if(!m)return;
      $('medId').value=m.id;$('medPatient').value=m.patientId;
      $('medName').value=m.name;$('medMeal').value=m.mealType;
      $('medTime').value=m.time||'08:00';$('medInstruction').value=m.instruction||'';
      $('medActive').checked=m.active;
      const ds=String(m.days||'').split(',');
      document.querySelectorAll('[name="medDay"]').forEach(x=>x.checked=ds.includes(x.value));
      $('gasMedicineForm').scrollIntoView({behavior:'smooth',block:'center'});
    }else if(action==='image'){
      const result=await call('readImage',state.token,id);
      const parent=$('photo-'+id);if(parent&&/^data:image\/(?:jpeg|png|webp);base64,/.test(result)){
        const img=document.createElement('img');img.alt='ภาพหลักฐานการรับยา';img.src=result;img.className='gas-image';
        parent.replaceChildren(img);
      }
    }
  }catch(err){pageMessage(err.message,true);}
  finally{if(btn.isConnected)btn.disabled=false;}
});
window.addEventListener('hashchange',()=>{if(state.data)render();});
document.addEventListener('DOMContentLoaded',()=>{
  startAuth();if(!API_URL)installBridge();
  const toggle=$('sidebarToggle');if(toggle)toggle.addEventListener('click',()=>document.body.classList.toggle('sidebar-collapsed'));
  const time=()=>{
    const now=new Date();
    text('currentTime',now.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit',hour12:false}));
    text('currentDate',now.toLocaleDateString('th-TH',{day:'numeric',month:'long',year:'numeric'}));
  };time();setInterval(time,30000);
});
})();