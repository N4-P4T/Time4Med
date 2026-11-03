/* Legacy Pages interface. The canonical Time4Med link uses Apps Script directly; no external login API. */
(() => {
'use strict';
const WEB_APP = 'https://script.google.com/macros/s/AKfycbx2-O9PDp-T0eXoP1A9_xesHk8mWcWszAbLsbsFOMpARpIIICibdKu6On0G0agGdMIEtQ/exec';
// Keep the same GitHub Pages sign-in for all devices. No forced GAS redirect.
// External login API removed; historical Pages view retains OTP only.
const API_URL='';
function makeChannel(){return Array.from(crypto.getRandomValues(new Uint8Array(24)),x=>x.toString(16).padStart(2,'0')).join('');}
// Google Apps Script documents unsupported multi-Google-account routing. An explicit
// authuser hint sometimes helps; it cannot be guaranteed to work on all accounts.
const AUTHUSER_ATTEMPTS = [null, 0, 1, 2, 3];
const MEALS = ['','ก่อนอาหารเช้า','หลังอาหารเช้า','ก่อนอาหารกลางวัน','หลังอาหารกลางวัน','ก่อนอาหารเย็น','หลังอาหารเย็น','ก่อนนอน'];
const DAYS = [['MON','จ'],['TUE','อ'],['WED','พ'],['THU','พฤ'],['FRI','ศ'],['SAT','ส'],['SUN','อา']];
const state={peer:null,origin:null,channel:null,frames:new Map(),seq:0,pending:new Map(),token:null,data:null,ready:false,rpcVerified:false,view:'dashboard'};
const $=id=>document.getElementById(id);
const html=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const text=(id,s)=>{const e=$(id);if(e)e.textContent=s;};
const message=(s,bad=false)=>{const e=$('gasStatus');if(e){e.textContent=s;e.classList.toggle('bad',bad);}else console.log(s);};
const activeMedicines=()=>state.data.medicines.filter(x=>x.active&&!x.demo&&String(x.kind).toUpperCase()!=='PRN');
const safeVal=(s)=>html(s);
const asTime=x=>/^\d\d:\d\d$/.test(x)?x:'—';
function dayLabel(value){
  const s=String(value||'').trim().toUpperCase();
  if(!s||s==='ALL'||s==='EVERYDAY')return 'ทุกวัน';
  const keys=s.split(',').map(x=>x.trim()).filter(Boolean);
  const all=DAYS.map(([key])=>key);
  if(all.every(key=>keys.includes(key)))return 'ทุกวัน';
  const names=new Map(DAYS);
  return keys.every(key=>names.has(key))?keys.map(key=>names.get(key)).join(' · '):s;
}
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
    const timer=setTimeout(()=>{state.pending.delete(id);reject(Error('Apps Script ตอบสนองช้าเกินไป กรุณาลองใหม่'));},method==='logout'&&args[0]===null?18000:45000);
    state.pending.set(id,{resolve,reject,timer});
    state.peer.postMessage({app:'time4med-gas-bridge',type:'call',channel:state.channel,id,method,args},state.origin==='null'?'*':state.origin);
  });
}
// iframe "ready" proves only HTML loaded, not that google.script.run works.
 // A harmless logout(null) RPC validates the actual Google backend channel
 // without reading patient data, requesting OTP or invalidating a session.
async function verifyRpcBeforeLogin(){
  const send=$('gasOtpRequest')?.querySelector('button[type="submit"]');
  if(send)send.disabled=true;
  text('gasConnectState','กำลังทดสอบการเชื่อมต่อ Apps Script…');
  try{
    const ok=await call('logout',null);
    if(ok!==true)throw Error('Apps Script ไม่ตอบกลับตามที่คาด');
    state.rpcVerified=true;
    if(send)send.disabled=false;
    text('gasConnectState','เชื่อมต่อ Apps Script แล้ว');
    message('เชื่อมต่อระบบสำเร็จ กรุณากรอกอีเมลเพื่อขอ OTP');
  }catch(err){
    state.rpcVerified=false;
    text('gasConnectState','Apps Script ยังตอบคำสั่งไม่ได้');
    message('หน้าเว็บเชื่อมต่อ Google ได้ แต่คำสั่งเข้าระบบยังไม่ตอบกลับ จึงยังไม่ส่ง OTP เพื่อป้องกันการขอรหัสซ้ำ',true);
    showDirectFallback('เบราว์เซอร์นี้ยังส่งคำสั่ง Apps Script ไม่ได้ ลองใช้เบราว์เซอร์ที่เคยเข้าได้ โดยไม่ต้องใช้บัญชีแอดมินร่วมกัน');
  }
}
window.addEventListener('message',event=>{
  const d=event.data;
  if(!d||d.app!=='time4med-gas-bridge'||!state.frames.has(d.channel)||!bridgeOrigin(event.origin))return;
  if(d.type==='ready'&&!state.ready){
    state.peer=event.source;state.origin=event.origin;state.channel=d.channel;state.ready=true;
    // Keep only the iframe that completed the handshake. Do not disturb live GAS RPC.
    for(const [key,frame] of state.frames)if(key!==d.channel){frame.remove();state.frames.delete(key);}
    state.peer.postMessage({app:'time4med-gas-bridge',type:'hello',channel:state.channel},event.origin==='null'?'*':event.origin);
    void verifyRpcBeforeLogin();
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
  lastFetchAt=Date.now();
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
  // Only enable "send code" once the backend responds to the harmless probe.
  $('gasOtpRequest').querySelector('button[type="submit"]').disabled=true;
  $('gasOtpRequest').addEventListener('submit',async ev=>{
    ev.preventDefault();
    if(!state.rpcVerified){message('ยังตรวจสอบการเชื่อมต่อ Apps Script ไม่สำเร็จ จึงยังไม่ส่ง OTP',true);return;}
    const b=ev.submitter;if(b)b.disabled=true;
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
  const out=$('t4mSignOut');if(out)out.addEventListener('click',async()=>{
    const token=state.token;state.token=null;state.data=null;
    try{await call('logout',token);}catch(_){}
    window.location.reload();
  });
}
let lastFetchAt=0;
let refreshPromise=null;
async function reload(){
  if(refreshPromise)return refreshPromise;
  const token=state.token;
  const request=(async()=>{
    const updated=await call('bootstrap',token);
    if(token!==state.token)return;
    state.data=updated;
    lastFetchAt=Date.now();
    render();
  })();
  refreshPromise=request;
  try{return await request;}finally{if(refreshPromise===request)refreshPromise=null;}
}
function liveDeviceTimeMs(value){
  const raw=String(value||'').trim();
  if(!raw)return NaN;
  const iso=raw.replace(' ','T');
  return Date.parse(/(?:Z|[+-]\\d{2}:\\d{2})$/i.test(iso)?iso:iso+'+07:00');
}
function isLiveDevice(device,nowMs=Date.now()){
  const last=liveDeviceTimeMs(device.lastSeen);
  return String(device.online).toUpperCase()==='ONLINE' && Number.isFinite(last) &&
    last<=nowMs && nowMs-last<180000;
}
function visibleDeviceStatus(device){
  if(isLiveDevice(device))return 'ONLINE';
  return String(device.online).toUpperCase()==='OFFLINE'?'OFFLINE':'ไม่ยืนยัน (ข้อมูลเก่าหรือขาดการติดต่อ)';
}
function liveView(){return ['dashboard','devices','inventory','analytics','activity'].includes(state.view);}
async function refreshLiveView(){
  if(!state.token||!state.data||document.hidden||!liveView()||Date.now()-lastFetchAt<60000)return;
  try{await reload();}
  catch(err){
    // Only these read-only pages are rerendered. Never erase an unsaved medicine/user form.
    if(!state.data||!liveView())return;
    render();
    pageMessage('โหลดข้อมูลใหม่ไม่สำเร็จ ข้อมูลอาจไม่เป็นปัจจุบัน: '+(err.message||String(err)),true);
  }
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
// The cabinet schedule runs in Thailand time, not the viewer's phone/computer time zone.
function bangkokNowParts(date=new Date()){
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit',weekday:'short',hourCycle:'h23'})
    .formatToParts(date);
  const part=key=>parts.find(p=>p.type===key)?.value||'';
  return {weekday:part('weekday').toUpperCase(),minute:(Number(part('hour'))%24)*60+Number(part('minute'))};
}
function todaySchedule(items,date=new Date()){
  const weekday=bangkokNowParts(date).weekday;
  return items.filter(m=>{
    if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(m.time||'')))return false;
    const days=String(m.days||'').trim().toUpperCase();
    return !days||days==='ALL'||days==='EVERYDAY'||days.split(',').map(x=>x.trim()).includes(weekday);
  }).sort((a,b)=>a.time.localeCompare(b.time)||String(a.patientId).localeCompare(String(b.patientId)));
}
function nextTodayMedicine(items,date=new Date()){
  const nowMinute=bangkokNowParts(date).minute;
  return todaySchedule(items,date).find(m=>Number(m.time.slice(0,2))*60+Number(m.time.slice(3,5))>=nowMinute);
}
function dashboard(){
  const d=state.data,active=activeMedicines();
  const daily=todaySchedule(active);
  const next=nextTodayMedicine(active);
  const rows=d.patients.map(p=>tr([html(p.id),html(p.name),html('ชั้น '+p.shelf),
    html(active.filter(x=>x.patientId===p.id).length+' รายการ')]));
  const scheduleRows=daily.map(m=>tr([html(m.time),html(m.patientId),html(m.name),html(m.meal)]));
  return '<div class="t21-heading"><div class="t21-heading-main"><p class="t21-eyebrow">TIME4MED / CAREGIVER CENTER</p>'+
    '<h1>ภาพรวมการดูแลวันนี้</h1><p class="t21-heading-description">ข้อมูลจาก Google Sheets ผ่าน '+(API_URL?'API':'Google Apps Script')+'</p></div></div>'+
    '<div class="t21-kpis">'+kpi('ผู้สูงอายุในสิทธิ์',d.patients.length,'P001–P003','👥')+
    kpi('รายการยาที่ใช้งาน',active.length,'ไม่รวมรายการทดสอบ','💊')+
    kpi('มื้อยาถัดไปวันนี้',next?next.time:'—',next?next.patientId+' '+next.meal:'ไม่พบรอบที่เหลือในวันนี้','◷')+
    kpi('อุปกรณ์ออนไลน์',d.devices.filter(isLiveDevice).length,'heartbeat ภายใน 3 นาที','📶')+'</div>'+
    panel('ผู้สูงอายุและชั้นยา',tbl(['รหัส','ชื่อ','ชั้น','จำนวนรายการยา'],rows))+
    panel('รอบยาที่กำหนดวันนี้ (เวลาไทย)',
      '<p class="gas-muted">แสดงตารางยาที่เปิดใช้งานในวันนี้ ไม่รวมข้อมูลทดสอบ และไม่ถือว่าได้รับยาแล้ว</p>'+
      (scheduleRows.length?tbl(['เวลา','ผู้สูงอายุ','ชื่อยา','มื้อยา'],scheduleRows):
        empty('ยังไม่มีรอบยาจริงในวันนี้ — รายการ TEST_ ไม่แสดงในตารางนี้')))+
    panel('สถานะการเชื่อมต่อ','<p>เว็บไซต์ GitHub Pages → '+(API_URL?'API':'Apps Script')+' → Google Sheets</p>'+
      '<p class="gas-muted">ข้อมูลยาที่ปรากฏบนเว็บไม่ได้ยืนยันว่าตู้ ESP32-S3 ซิงก์ตารางยาล่าสุดแล้ว และ Heartbeat ไม่ได้ยืนยันการทำงานของ LED หรือเสียง</p>'+
      '<p class="gas-muted">ระบบ LINE ตามเวลาจะทำงานเมื่อผู้ดูแลระบบเปิดใช้งานใน Apps Script เท่านั้น การกดยืนยันไม่ใช่หลักฐานว่ากลืนยาแล้ว</p>'+
      '<button class="gas-btn" data-action="refresh">โหลดข้อมูลล่าสุด</button>')+
    (API_URL?panel('เปลี่ยนรหัสผ่านบัญชีของฉัน','<form id="gasPasswordChange" class="gas-form">'+
      '<label>รหัสผ่านปัจจุบัน<input id="oldPassword" type="password" autocomplete="current-password" required></label>'+
      '<label>รหัสผ่านใหม่ (อย่างน้อย 12 ตัว)<input id="newPassword" type="password" autocomplete="new-password" minlength="12" required></label>'+
      '<button type="submit" class="gas-btn">เปลี่ยนรหัสผ่าน</button></form>'):'');
}
function medication(){
  const d=state.data,items=d.medicines;
  const rows=items.map(m=>tr([html(m.patientId),html(m.name)+(m.demo?' <span class="gas-muted">(ทดสอบ — ไม่ส่งเข้าตู้)</span>':''),html(m.meal),html(asTime(m.time)),html(dayLabel(m.days)),
    m.demo?(m.active?'ทดสอบ · เปิด':'ทดสอบ · ปิด'):(m.active?'ใช้งาน':'ปิดใช้'),'<button class="gas-btn light" data-action="edit" data-id="'+html(m.id)+'">แก้ไข</button> '+
    (m.active?'<button class="gas-btn danger" data-action="disable" data-id="'+html(m.id)+'">ปิดใช้</button>':'')]));
  const pOptions=d.patients.map(p=>'<option value="'+html(p.id)+'">'+html(p.id+' ชั้น '+p.shelf+' — '+p.name)+'</option>').join('');
  const mealOptions=MEALS.slice(1).map((m,i)=>'<option value="'+(i+1)+'">'+html(m)+'</option>').join('');
  const choices=DAYS.map(([key,label])=>'<label class="gas-day"><input type="checkbox" value="'+key+'" name="medDay" checked> '+label+'</label>').join('');
  return '<div class="gas-heading"><h1>รายการยาและรอบแจ้งเตือน</h1><p>บันทึกลง Google Sheets · สิทธิ์ตามผู้สูงอายุ</p></div>'+
    '<p class="gas-muted">รายการที่ขึ้นต้น TEST_, DEMO_ หรือ LINECHECK_ เป็นข้อมูลทดสอบ: แสดงเพื่อให้แก้ไขหรือปิดใช้งานได้ แต่ไม่ถูกส่งเป็นตารางยาจริงให้ ESP32-S3 หรือ LINE</p>'+
    panel('ตารางยาปัจจุบัน',rows.length?tbl(['ผู้สูงอายุ','ชื่อยา','มื้อยา','เวลา','วัน','สถานะ','จัดการ'],rows):empty('ยังไม่มีรายการยา'))+
    panel('เพิ่มหรือแก้ไขรายการยา','<form id="gasMedicineForm" class="gas-form">'+
      '<p id="medFormMode" class="gas-muted">กำลังเพิ่มรายการยาใหม่</p>'+
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
  const shelves=[1,2,3].map(s=>{
    const p='P00'+s,items=active.filter(x=>x.patientId===p);
    return tr([html('ชั้น '+s),html(p),html(items.length+' รายการ'),html(items.map(x=>x.name).join(', ')||'—')]);
  });
  shelves.push(tr(['ชั้น 4','ยาสามัญประจำบ้าน','ไม่ใช้ LED','ไม่มีการแยกผู้รับยา']));
  const stockLabels={unchecked:'ยังไม่ได้ตรวจ',unknown:'ยังไม่ทราบ',ok:'ปกติ',low:'ใกล้หมด',out:'หมดแล้ว'};
  const details=active.map(m=>{
    const stock=String(m.stock||'unchecked').trim(),label=stockLabels[stock.toLowerCase()]||stock;
    return tr([html('ชั้น '+m.shelf),html(m.patientId),html(m.name),html(m.meal),
      html(asTime(m.time)),html(dayLabel(m.days)),html(label)]);
  });
  return '<div class="gas-heading"><h1>แผนผังตู้และคลังยา</h1></div>'+
    panel('ชั้นยา 4 ชั้น',tbl(['ตำแหน่ง','ผู้ใช้','จำนวนรายการ','รายการยา'],shelves))+
    panel('รายการยาที่ใช้งานและสถานะสต็อก',
      '<p class="gas-muted">แสดงสถานะสต็อกที่บันทึกไว้ใน Google Sheets เท่านั้น ไม่ได้ตรวจนับเม็ดยาอัตโนมัติ และไม่รวมข้อมูลทดสอบ</p>'+
      (details.length?tbl(['ชั้น','ผู้สูงอายุ','ชื่อยา','มื้อยา','เวลา','วัน','สถานะสต็อก'],details):
        empty('ยังไม่มีรายการยาจริงที่เปิดใช้งาน')) );
}
function devices(){
  const rows=state.data.devices.map(x=>tr([html(x.id),html(x.type),html(visibleDeviceStatus(x)),html(x.lastSeen||'—'),
    html(isLiveDevice(x)?(x.lock||'—'):'ไม่ยืนยัน')]));
  return '<div class="gas-heading"><h1>สถานะอุปกรณ์</h1><p>สถานะจาก heartbeat จริง ไม่แสดง ONLINE หากข้อมูลหมดอายุ</p></div>'+
    panel('ESP32-S3 / ESP32-CAM',rows.length?tbl(['อุปกรณ์','ชนิด','สถานะ','รับข้อมูลล่าสุด','กลอน'],rows):empty('อุปกรณ์ยังไม่ส่ง heartbeat เข้าระบบ'))+
    panel('การซิงก์ตารางยา','<p class="gas-muted">เว็บไซต์ยังไม่มีหลักฐานยืนยันจาก ESP32-S3 ว่าได้รับและนำตารางยารุ่นล่าสุดไปใช้แล้ว จึงไม่แสดงสถานะ SYNC สำเร็จ การมี Heartbeat หรือ HTTP 200 เพียงอย่างเดียวไม่ถือว่าอัปเดตตารางยาครบถ้วน</p>')+
    panel('ข้อจำกัด','<p class="gas-muted">ระบบตรวจ heartbeat ใหม่ทุกครั้งที่แสดงข้อมูล และโหลดสถานะล่าสุดอัตโนมัติเมื่อเปิดหน้านี้ทิ้งไว้ หากข้อมูลเกิน 3 นาทีจะไม่ยืนยันว่าอุปกรณ์ออนไลน์หรือกลอนอยู่ในสถานะใด เว็บนี้ไม่ส่งคำสั่งปลดล็อกผ่านอินเทอร์เน็ต</p>');
}
// ActivityLog is an audit trail, not proof of swallowing medication.
// Apps Script bootstrap intentionally returns at most 60 recent authorized events.
function activityClass(e){
  const type=String(e?.type||'').toUpperCase();
  if(type==='INTAKE_CONFIRMED')return 'button';
  if(type==='EMERGENCY')return 'emergency';
  if(type==='MEDICINE_CONFIRMED'||type==='TIMELINE_TEST'||type.startsWith('TEST_')||type.startsWith('DEMO_'))return 'historical';
  return 'system';
}
function activityTitle(e){
  const type=String(e?.type||'').toUpperCase();
  return ({
    INTAKE_CONFIRMED:'กดยืนยันที่อุปกรณ์',
    EMERGENCY:'กดปุ่มฉุกเฉิน',
    MEDICINE_CREATED:'เพิ่มรายการยา',
    MEDICINE_UPDATED:'แก้ไขรายการยา',
    MEDICINE_DISABLED:'ปิดใช้งานยา',
    USER_SAVED:'บันทึกบัญชีผู้ใช้',
    LINE_SEND_ERROR:'LINE ส่งข้อความไม่สำเร็จ',
    MEDICINE_CONFIRMED:'บันทึกการยืนยันเก่า (ไม่ใช้คำนวณ)',
    MEDICINE_REMINDER:'ประวัติการแจ้งเตือน',
    TIMELINE_TEST:'ข้อมูลทดสอบ Timeline',
    IMAGE_SAVED:'บันทึกภาพในประวัติ',
  })[type]||type||'ไม่ทราบประเภท';
}
function thaiDateKey(date){
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',
    year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  const part=key=>parts.find(x=>x.type===key)?.value||'';
  return part('year')+'-'+part('month')+'-'+part('day');
}
function recentDateKeys(date=new Date()){
  const now=thaiDateKey(date),parts=now.split('-').map(Number),days=[];
  for(let offset=6;offset>=0;offset--){
    days.push(new Date(Date.UTC(parts[0],parts[1]-1,parts[2]-offset)).toISOString().slice(0,10));
  }
  return days;
}
function eventDayKey(event){
  const raw=String(event?.time||'').trim();
  if(!/^\d{4}-\d{2}-\d{2}(?:[ T]|$)/.test(raw))return '';
  // bootstrap() returns local Asia/Bangkok timestamps without a time-zone suffix.
  const day=raw.slice(0,10),date=new Date(day+'T00:00:00Z');
  return Number.isNaN(date.getTime())||date.toISOString().slice(0,10)!==day?'':day;
}
function recentActivitySummary(items,date=new Date()){
  const days=recentDateKeys(date),allowed=new Set(days);
  const events=items.filter(e=>allowed.has(eventDayKey(e)));
  const counted=events.filter(e=>activityClass(e)==='button'&&
    String(e.result||'SUCCESS').toUpperCase()==='SUCCESS');
  const emergency=events.filter(e=>activityClass(e)==='emergency');
  const daily=days.map(day=>({day,
    confirmations:counted.filter(e=>eventDayKey(e)===day).length,
    emergencies:emergency.filter(e=>eventDayKey(e)===day).length}));
  return {daily,confirmations:counted.length,emergencies:emergency.length,
    coveredEvents:events.length,hasReachedLimit:items.length>=60};
}
function analytics(){
  const d=state.data,active=activeMedicines(),report=recentActivitySummary(d.activity);
  const daily=report.daily.map(x=>tr([
    html(x.day.slice(8,10)+'/'+x.day.slice(5,7)),html(x.confirmations),html(x.emergencies)]));
  return '<div class="gas-heading"><h1>สถิติภาพรวม</h1><p>สรุปจากเหตุการณ์ที่ระบบบันทึกไว้ ไม่ใช่การประเมินว่ากลืนยาแล้ว</p></div>'+
    '<div class="t21-kpis">'+
    kpi('ยาใช้งาน',active.length,'รายการที่ไม่ใช่ข้อมูลทดสอบ','💊')+
    kpi('กดยืนยันที่ตู้ 7 วัน',report.confirmations,'เหตุการณ์จากบันทึกล่าสุด','◷')+
    kpi('กดฉุกเฉิน 7 วัน',report.emergencies,'เหตุการณ์ที่บันทึกไว้','⚑')+
    kpi('ภาพพร้อมแสดง',d.images.filter(x=>String(x.available).toUpperCase()==='TRUE').length,'จากรายการภาพล่าสุด','📷')+
    '</div>'+
    panel('เหตุการณ์ในช่วง 7 วันตามเวลาไทย',tbl(['วันที่','กดยืนยันที่ตู้','กดฉุกเฉิน'],daily))+
    panel('ขอบเขตและความหมายของตัวเลข',
      '<p class="gas-muted">นับเฉพาะเหตุการณ์ INTAKE_CONFIRMED ที่ระบบแจ้งว่าบันทึกสำเร็จ ไม่รวมข้อมูลทดสอบหรือ MEDICINE_CONFIRMED จากระบบเก่า ไม่ใช่หลักฐานว่ากลืนยาแล้ว ไม่ใช่จำนวนโดสที่ได้รับครบ และไม่คำนวณอัตราการกินยาตรงเวลา</p>'+
      '<p class="gas-muted">Apps Script ส่งประวัติให้หน้าเว็บเพียง 60 เหตุการณ์ล่าสุดที่บัญชีมีสิทธิ์เห็น ดังนั้นสถิติ 7 วันนี้อาจไม่ครบหากมีเหตุการณ์มากกว่านั้น'+
      (report.hasReachedLimit?' (ตอนนี้ถึงขีดจำกัด 60 รายการแล้ว)':'')+'</p>');
}
function activity(){
  const data=state.data.activity;
  const button=data.filter(e=>activityClass(e)==='button');
  const emergency=data.filter(e=>activityClass(e)==='emergency');
  const other=data.filter(e=>!['button','emergency'].includes(activityClass(e)));
  const rows=entries=>entries.map(x=>tr([html(x.time||'—'),html(x.patientId||'—'),
    html(activityTitle(x)),html(x.result||'—'),html(x.details||'—')]));
  return '<div class="gas-heading"><h1>ประวัติกิจกรรม</h1><p>ข้อมูลล่าสุดจาก Apps Script แสดงเฉพาะเหตุการณ์ที่บัญชีนี้ได้รับสิทธิ์ดู</p></div>'+
    panel('เหตุการณ์กดยืนยันที่ตู้',button.length?
      tbl(['เวลา','ผู้สูงอายุ','เหตุการณ์','ผล','รายละเอียด'],rows(button)):
      empty('ยังไม่มีบันทึกการกดยืนยันจากอุปกรณ์ในรายการล่าสุด'))+
    panel('เหตุการณ์ฉุกเฉิน',emergency.length?
      tbl(['เวลา','ผู้สูงอายุ','เหตุการณ์','ผล','รายละเอียด'],rows(emergency)):
      empty('ยังไม่มีบันทึกฉุกเฉินในรายการล่าสุด'))+
    panel('การจัดการข้อมูลและเหตุการณ์อื่น ๆ',other.length?
      tbl(['เวลา','ผู้สูงอายุ','เหตุการณ์','ผล','รายละเอียด'],rows(other)):
      empty('ไม่มีรายการกิจกรรมระบบ'))+
    panel('หมายเหตุ','<p class="gas-muted">การกดยืนยันไม่ได้พิสูจน์ว่าผู้สูงอายุกลืนยาแล้ว ข้อมูลเก่าหรือข้อมูลทดสอบไม่ได้ถูกนับเป็นเหตุการณ์การยืนยันจริงในหน้าสถิติ และข้อมูลที่แสดงจำกัด 60 รายการล่าสุด</p>');
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
  const rows=state.data.users.map(x=>tr([html(x.email),html(x.role),html(x.patients),html(x.status),
    x.lineConfigured?'เชื่อมแล้ว':'ยังไม่เชื่อม',
    '<button type="button" class="gas-btn light" data-action="edit-user" data-email="'+html(x.email)+'">แก้ไขสิทธิ์</button>']));
  return '<div class="gas-heading"><h1>จัดการระบบ</h1><p>เฉพาะผู้ดูแลระบบ ADMIN</p></div>'+
  panel('บัญชีผู้ใช้',tbl(['อีเมล','บทบาท','ดูแลผู้สูงอายุ','สถานะ','LINE User ID','จัดการ'],rows))+
  panel('เพิ่มหรือแก้ไขสิทธิ์ผู้ใช้','<form id="gasUserForm" class="gas-form">'+
    '<p id="userFormMode" class="gas-muted">กำลังสร้างบัญชีใหม่ — เลือกแก้ไขจากตารางเพื่อรักษาข้อมูลบัญชีเดิม</p>'+
    '<label>อีเมล<input id="userEmail" type="email" required></label>'+
    (API_URL?'<label>ชื่อผู้ใช้ (a-z, 0-9)<input id="userUsername" autocomplete="off" required minlength="3" maxlength="40" placeholder="caregiver01"></label>'+
      '<label>รหัสผ่านเริ่มต้น (เฉพาะบัญชีใหม่หรือเมื่อต้องการเปลี่ยน)<input id="userNewPassword" type="password" autocomplete="new-password" minlength="12" placeholder="อย่างน้อย 12 ตัวอักษร"></label>':'')+
    '<label>ชื่อแสดง<input id="userName" required></label>'+
    '<label>บทบาท<select id="userRole"><option value="CAREGIVER">CAREGIVER — ผู้ดูแล</option><option value="ADMIN">ADMIN — แอดมิน</option></select></label>'+
    '<label>ผู้สูงอายุที่ดูแล (คั่นด้วย ,)<input id="userPatients" placeholder="P001,P002,P003"></label>'+
    '<label>สถานะ<select id="userStatus"><option value="ACTIVE">ACTIVE</option><option value="INACTIVE">INACTIVE</option></select></label>'+
    '<div class="gas-actions"><button class="gas-btn" type="submit">บันทึกบัญชี</button>'+
    '<button type="button" class="gas-btn light" data-action="new-user">ล้างแบบฟอร์ม / เพิ่มบัญชีใหม่</button></div></form>')+
  panel('ทดสอบ LINE','<button data-action="line" class="gas-btn">ส่งข้อความทดสอบไป LINE ของแอดมิน</button>'+
    '<p class="gas-muted">ต้องตั้ง LINE User ID ของ ADMIN ในชีต Users แล้ว การทดสอบนี้ไม่เปิดแจ้งเตือนรอบยาอัตโนมัติ</p>')+
  panel('ทดสอบระบบ (ADMIN)','<p class="gas-muted">สาธิตแยกจากตารางยาจริง ไม่เขียนบันทึกการรับยา ไม่สร้างภาพใน Google Drive และไม่ส่ง LINE โดยอัตโนมัติ กรุณาเริ่มเมื่อมีผู้ดูแลอยู่ที่ตู้เท่านั้น</p>'+
    '<div class="gas-form"><label>ผู้สูงอายุ<select id="demoPatient"><option value="P001">P001 — ชั้น 1</option><option value="P002">P002 — ชั้น 2</option><option value="P003">P003 — ชั้น 3</option></select></label>'+
    '<label>มื้อยาทดสอบ<select id="demoMeal">'+MEALS.slice(1).map((m,i)=>'<option value="'+(i+1)+'"'+(i===1?' selected':'')+'>'+html(m)+'</option>').join('')+'</select></label>'+
    '<div class="gas-actions"><button type="button" data-action="demo-start" class="gas-btn">เริ่มทดสอบระบบ</button>'+
    '<button type="button" data-action="demo-status" class="gas-btn light">ตรวจสถานะ</button>'+
    '<button type="button" data-action="demo-stop" class="gas-btn danger">หยุดทดสอบ</button></div>'+
    '<pre id="demoResult" role="status" style="white-space:pre-wrap">ยังไม่ได้เรียกดูสถานะจาก Apps Script</pre>'+
    '<button type="button" id="demoPhotoButton" data-action="demo-photo" class="gas-btn light" hidden>ดูภาพสาธิตชั่วคราว</button>'+
    '<div id="demoPhotoResult"></div></div>'+
    '<p class="gas-muted">ปุ่มนี้ต้องใช้ Apps Script ที่ Deploy ฟังก์ชันทดสอบไว้แล้ว และ ESP32-S3 ต้องรองรับ demoPoll/demoEvent จึงจะรายงานผลครบจริง การกดเริ่มไม่ได้หมายความว่าตู้ผ่านการทดสอบ</p>');
}
let previousDemoId='';
function showDemoStatus(result){
  const el=$('demoResult');if(!el)return;
  const photoBtn=$('demoPhotoButton'),photoBox=$('demoPhotoResult');
  if(!result||typeof result!=='object'){
    el.textContent='ไม่พบข้อมูลสถานะทดสอบ';
    if(photoBtn)photoBtn.hidden=true;
    return;
  }
  const demoId=String(result.id||'');
  if(previousDemoId!==demoId&&photoBox)photoBox.replaceChildren();
  previousDemoId=demoId;
  if(photoBtn){
    photoBtn.hidden=!(result.photoAvailable&&demoId);
    photoBtn.dataset.demoId=demoId;
  }
  const names={IDLE:'ยังไม่เริ่ม',WAITING:'รออุปกรณ์',RUNNING:'กำลังทดสอบ',DONE:'อุปกรณ์รายงานครบ',FAILED:'ทดสอบผิดพลาด',STOPPED:'หยุดแล้ว',TIMED_OUT:'หมดเวลารอ'};
  const status=String(result.status||'UNKNOWN');
  const steps=Array.isArray(result.steps)?result.steps:[];
  el.textContent='สถานะ: '+(names[status]||status)+'\n'+
    'ผู้สูงอายุ: '+(result.patientId||'—')+'\n'+
    'ขั้นตอนที่อุปกรณ์รายงาน: '+steps.length+'\n'+
    steps.map(x=>'• '+String(x.phase||'')+' '+String(x.at||'')).join('\n')+'\n'+
    (result.note?'รายละเอียด: '+String(result.note):'');
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
let medicineSaveBusy=false;
async function saveMedicine(ev){
  ev.preventDefault();
  if(medicineSaveBusy)return;
  const ds=[...document.querySelectorAll('[name="medDay"]:checked')].map(x=>x.value);
  if(!ds.length)return pageMessage('เลือกวันแจ้งเตือนอย่างน้อยหนึ่งวัน',true);
  const name=$('medName').value.trim();
  if(name.length<2)return pageMessage('กรุณากรอกชื่อยาอย่างน้อย 2 ตัวอักษร',true);
  const medId=$('medId').value, patientId=$('medPatient').value, mealType=Number($('medMeal').value), time=$('medTime').value;
  const dayKey=v=>String(v||'MON,TUE,WED,THU,FRI,SAT,SUN').split(',').map(x=>x.trim()).filter(Boolean).sort().join(',');
  const exists=state.data.medicines.some(m=>m.active&&m.id!==medId&&m.patientId===patientId&&
    String(m.name).trim().toLocaleLowerCase()===name.toLocaleLowerCase()&&Number(m.mealType)===mealType&&
    m.time===time&&dayKey(m.days)===dayKey(ds.join(',')));
  if(exists)return pageMessage('มีรายการยาชื่อเดียวกัน ผู้สูงอายุ มื้อ เวลา และวันเดียวกันอยู่แล้ว กรุณาแก้ไขรายการเดิมแทนการเพิ่มซ้ำ',true);
  const value={id:medId,patientId,name,
    mealType:Number($('medMeal').value),time:$('medTime').value,days:ds.join(','),
    instruction:$('medInstruction').value,active:$('medActive').checked};
  medicineSaveBusy=true;
  const button=ev.submitter;if(button)button.disabled=true;
  let saved=false, uncertain=false;
  try{
    await call('saveMedicine',state.token,value);
    saved=true;
    await reload();
    pageMessage('บันทึกตารางยาสำเร็จ');
  }catch(e){
    if(saved)pageMessage('บันทึกตารางยาแล้ว แต่โหลดรายการล่าสุดไม่สำเร็จ กรุณากด “โหลดล่าสุด” ก่อนดำเนินการต่อ ห้ามกดบันทึกซ้ำ',true);
    else{
      uncertain=/ตอบสนองช้าเกินไป|timeout|network|failed to fetch|เชื่อมต่อ/i.test(String(e.message||e));
      pageMessage((uncertain?'ยังยืนยันผลการบันทึกไม่ได้ โปรดกด “โหลดล่าสุด” ตรวจรายการก่อนบันทึกซ้ำ: ':'บันทึกไม่สำเร็จ: ')+(e.message||String(e)),true);
    }
  }finally{medicineSaveBusy=false;if(button&&!saved&&!uncertain)button.disabled=false;}
}
function clearMedicineForm(){
  const form=$('gasMedicineForm');if(!form)return;
  form.reset();
  $('medId').value='';
  document.querySelectorAll('[name="medDay"]').forEach(x=>x.checked=true);
  const mode=$('medFormMode');if(mode)mode.textContent='กำลังเพิ่มรายการยาใหม่';
}
function editMedicineForm(id){
  const m=state.data?.medicines?.find(x=>x.id===id);if(!m)return;
  $('medId').value=m.id;$('medPatient').value=m.patientId;
  $('medName').value=m.name;$('medMeal').value=m.mealType;
  $('medTime').value=m.time||'08:00';$('medInstruction').value=m.instruction||'';
  $('medActive').checked=Boolean(m.active);
  const raw=String(m.days||'').trim().toUpperCase();
  const all=!raw||raw==='ALL'||raw==='EVERYDAY';
  const selected=new Set(raw.split(',').map(x=>x.trim()).filter(Boolean));
  document.querySelectorAll('[name="medDay"]').forEach(x=>x.checked=all||selected.has(x.value));
  const mode=$('medFormMode');if(mode)mode.textContent='กำลังแก้ไขรายการยา: '+m.name+' ('+m.patientId+')';
  const form=$('gasMedicineForm');if(form?.scrollIntoView)form.scrollIntoView({behavior:'smooth',block:'center'});
}
function clearUserForm(){
  const form=$('gasUserForm');if(!form)return;
  form.reset();
  $('userEmail').readOnly=false;
  const mode=$('userFormMode');if(mode)mode.textContent='กำลังสร้างบัญชีใหม่';
}
function editUserForm(email){
  if(state.data?.user?.role!=='ADMIN')return;
  const user=state.data.users.find(x=>String(x.email).toLowerCase()===String(email).toLowerCase());
  if(!user)return pageMessage('ไม่พบบัญชีที่เลือก กรุณาโหลดข้อมูลล่าสุด',true);
  $('userEmail').value=user.email;
  $('userEmail').readOnly=true; // Prevent accidental creation of a second account.
  $('userName').value=user.name||user.email;
  $('userRole').value=user.role==='ADMIN'?'ADMIN':'CAREGIVER';
  $('userPatients').value=user.role==='ADMIN'?'':String(user.patients||'');
  $('userStatus').value=user.status==='ACTIVE'?'ACTIVE':'INACTIVE';
  const mode=$('userFormMode');if(mode)mode.textContent='กำลังแก้ไขบัญชี: '+user.email+' — ไม่สามารถเปลี่ยนอีเมลของบัญชีเดิมได้';
  const form=$('gasUserForm');if(form?.scrollIntoView)form.scrollIntoView({behavior:'smooth',block:'center'});
}
let userSaveBusy=false;
async function saveUser(ev){
  ev.preventDefault();
  if(userSaveBusy||state.data?.user?.role!=='ADMIN')return;
  const email=$('userEmail').value.trim().toLowerCase(), name=$('userName').value.trim();
  const role=$('userRole').value,status=$('userStatus').value;
  const patientIds=String($('userPatients').value||'').toUpperCase()
    .split(',').map(x=>x.trim()).filter(Boolean);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return pageMessage('อีเมลไม่ถูกต้อง',true);
  if(!name)return pageMessage('กรุณากรอกชื่อแสดงของผู้ดูแล',true);
  if(role==='CAREGIVER'&&(!patientIds.length||patientIds.some(x=>!['P001','P002','P003'].includes(x))||
      new Set(patientIds).size!==patientIds.length))
    return pageMessage('CAREGIVER ต้องระบุผู้สูงอายุ P001, P002, P003 โดยไม่ซ้ำ เช่น P001,P002',true);
  if(email===String(state.data.user.email).toLowerCase()&&(role!=='ADMIN'||status!=='ACTIVE'))
    return pageMessage('ไม่สามารถลดสิทธิ์หรือปิดใช้งานบัญชี ADMIN ที่กำลังใช้ได้',true);
  const previous=state.data.users.find(x=>String(x.email).toLowerCase()===email);
  if(previous&&previous.role==='ADMIN'&&(role!=='ADMIN'||status!=='ACTIVE')&&
    !window.confirm('กำลังเปลี่ยนสิทธิ์ของ ADMIN '+email+' กรุณายืนยันอีกครั้ง'))return;
  const value={email,name,role,patientIds:role==='ADMIN'?'ALL':patientIds.join(','),status};
  if(API_URL){value.username=$('userUsername').value.trim();value.newPassword=$('userNewPassword').value;}
  userSaveBusy=true;
  const button=ev.submitter;if(button)button.disabled=true;
  let saved=false, uncertain=false;
  try{
    await call('saveUser',state.token,value);
    saved=true;
    await reload();
    pageMessage('บันทึกบัญชีสำเร็จ');
  }catch(e){
    if(saved)pageMessage('บันทึกบัญชีแล้ว แต่โหลดข้อมูลล่าสุดไม่สำเร็จ กรุณากด “โหลดล่าสุด” ก่อนดำเนินการต่อ',true);
    else{
      uncertain=/ตอบสนองช้าเกินไป|timeout|network|failed to fetch|เชื่อมต่อ/i.test(String(e.message||e));
      pageMessage((uncertain?'ยังยืนยันผลการบันทึกบัญชีไม่ได้ โปรดกด “โหลดล่าสุด” ตรวจสอบก่อนบันทึกซ้ำ: ':'บันทึกบัญชีไม่สำเร็จ: ')+(e.message||String(e)),true);
    }
  }finally{userSaveBusy=false;if(button&&!saved&&!uncertain)button.disabled=false;}
}
document.addEventListener('click',async e=>{
  const btn=e.target.closest('[data-action]');if(!btn||!state.data)return;
  const action=btn.dataset.action,id=btn.dataset.id;btn.disabled=true;
  try{
    if(action==='refresh')await reload();
    else if(action==='edit-user'){
      if(state.data.user.role!=='ADMIN')throw Error('เฉพาะ ADMIN เท่านั้น');
      editUserForm(btn.dataset.email);
    }else if(action==='new-user'){
      if(state.data.user.role!=='ADMIN')throw Error('เฉพาะ ADMIN เท่านั้น');
      clearUserForm();
    }
    else if(action==='gallery')window.location.hash='#gallery';
    else if(action==='line'){await call('testLine',state.token);pageMessage('ส่งข้อความทดสอบ LINE สำเร็จ');}
    else if(action==='demo-photo'){
      if(state.data.user.role!=='ADMIN')throw Error('เฉพาะ ADMIN เท่านั้น');
      const demoId=String(btn.dataset.demoId||'');
      if(!demoId)throw Error('ยังไม่มีรหัสการสาธิตที่มีภาพ');
      const result=await call('getDemoPreview',state.token,demoId);
      if(typeof result!=='string'||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(result))
        throw Error('ข้อมูลภาพสาธิตที่ได้รับไม่ถูกต้อง');
      const target=$('demoPhotoResult');
      if(target&&btn.dataset.demoId===demoId){
        const img=document.createElement('img');
        img.alt='ภาพสาธิตชั่วคราวจากตู้ยา';img.className='gas-image';img.src=result;
        target.replaceChildren(img);
      }
    }
    else if(action==='demo-start'||action==='demo-status'||action==='demo-stop'){
      if(state.data.user.role!=='ADMIN')throw Error('เฉพาะ ADMIN เท่านั้น');
      let result;
      if(action==='demo-start'){
        if(!window.confirm('เริ่มสาธิตที่ตู้จริง? ต้องมีผู้ดูแลอยู่ใกล้ตู้ ข้อมูลการทดสอบจะไม่ถูกบันทึกเป็นประวัติรับยา'))return;
        result=await call('startDemo',state.token,{patientId:$('demoPatient').value,mealType:Number($('demoMeal').value),sendLine:false});
      }else if(action==='demo-status')result=await call('getDemoStatus',state.token);
      else{
        if(!window.confirm('หยุดการทดสอบที่กำลังทำงาน?'))return;
        result=await call('cancelDemo',state.token);
      }
      showDemoStatus(result);
    }
    else if(action==='disable'){
      const m=state.data.medicines.find(x=>x.id===id);if(!m||!window.confirm('ปิดใช้งานยา '+m.name+' ของ '+m.patientId+'?'))return;
      await call('disableMedicine',state.token,id);
      try{await reload();pageMessage('ปิดใช้รายการยาแล้ว');}
      catch(_){pageMessage('ระบบปิดใช้งานรายการยาแล้ว แต่โหลดหน้าล่าสุดไม่สำเร็จ กรุณากด “โหลดล่าสุด” ก่อนทำรายการอื่น',true);}
    }else if(action==='new'){clearMedicineForm();}
    else if(action==='edit'){editMedicineForm(id);}
    else if(action==='image'){
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
    text('currentTime',now.toLocaleTimeString('th-TH',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit',hour12:false}));
    text('currentDate',now.toLocaleDateString('th-TH',{timeZone:'Asia/Bangkok',day:'numeric',month:'long',year:'numeric'}));
  };time();setInterval(time,30000);
  // Read-only views refresh automatically; never interrupt the medication/admin editor.
  setInterval(()=>{void refreshLiveView();},60000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refreshLiveView();});
});
})();