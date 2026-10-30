/** Time4Med Apps Script release 2026-10-29
 * Bound to the existing Time4Med_DB spreadsheet or configure SPREADSHEET_ID.
 * Deploy as Web App: execute as owner, accessible to anyone; all methods
 * enforce email OTP authorization against Users. DO NOT expose secret keys.
 */
const T4M = Object.freeze({
  spreadsheet: '1pU1YnZUHrxTxxCDnoNx5Xmaosh-d4H92BUXQwQYQg8I',
  tz: 'Asia/Bangkok',
  // Public Web App URL only. Never put DEVICE_API_KEY here.
  website: 'https://n4-p4t.github.io/Time4Med/',
  patients: {'P001':1,'P002':2,'P003':3},
  meal: {1:'ก่อนอาหารเช้า',2:'หลังอาหารเช้า',3:'ก่อนอาหารกลางวัน',4:'หลังอาหารกลางวัน',5:'ก่อนอาหารเย็น',6:'หลังอาหารเย็น',7:'ก่อนนอน'},
  cols: {Users:4, Patients:4, Medicines:4, Schedules:4, IntakeLog:4,
    Devices:4, ActivityLog:4, ImageIndex:4, NotificationLog:4, MealMedicines:1}
});
function doGet(e) {
  // Dedicated, origin-bound RPC bridge for the GitHub Pages caregiver UI.
  // Public page traffic never exposes DEVICE_API_KEY, LINE tokens or spreadsheet credentials.
  if(e && e.parameter && e.parameter.bridge === '1') {
    const channel = String(e.parameter.channel || '');
    if(!/^[a-zA-Z0-9_-]{24,96}$/.test(channel))
      return HtmlService.createHtmlOutput('Invalid bridge channel');
    const template = HtmlService.createTemplateFromFile('Bridge');
    template.channel = channel;
    return template.evaluate().setTitle('Time4Med secure bridge')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  return HtmlService.createHtmlOutputFromFile('Index').setTitle('Time4Med | ระบบดูแลการใช้ยา')
    .addMetaTag('viewport','width=device-width, initial-scale=1');
}
function props_() { return PropertiesService.getScriptProperties(); }
// Use the actual deployed /exec URL; avoid extra script properties for this public link.
function time4medWebsiteUrl_() { return T4M.website; }
function db_() {
  return SpreadsheetApp.openById(props_().getProperty('SPREADSHEET_ID') || T4M.spreadsheet);
}
function tzNow_() { return Utilities.formatDate(new Date(),T4M.tz,'yyyy-MM-dd HH:mm:ss'); }
function stamp_() { return new Date().toISOString(); }
function str_(v) { return String(v == null ? '' : v).trim(); }
function upper_(v) { return str_(v).toUpperCase(); }
function active_(v) { return ['TRUE','YES','1','ACTIVE','ON'].includes(upper_(v)); }
function sha_(value) {
  const bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(value));
  return bytes.map(b=>('0'+(b&255).toString(16)).slice(-2)).join('');
}
function assert_(condition,message) { if(!condition) throw new Error(message); }
function email_(v) { return str_(v).toLowerCase(); }
function sheet_(name) {
  const sheet=db_().getSheetByName(name);assert_(sheet,'ไม่พบชีต '+name);return sheet;
}
function grid_(name) {
  const sheet=sheet_(name),row=T4M.cols[name]||1;
  const lastCol=sheet.getLastColumn(),lastRow=sheet.getLastRow();
  const keys=sheet.getRange(row,1,1,lastCol).getDisplayValues()[0].map(str_);
  const values=lastRow>row?sheet.getRange(row+1,1,lastRow-row,lastCol).getDisplayValues():[];
  return {sheet,keys,rows:values.map((cells,i)=>({index:row+i+1,cells,data:Object.fromEntries(keys.map((k,j)=>[k,cells[j]||'']))})).filter(x=>x.cells.some(str_))};
}
function userForEmail_(address) {
  const u=grid_('Users').rows.find(x=>email_(x.data.email)===email_(address) && upper_(x.data.status)==='ACTIVE');
  if(!u) return null;
  const storedRole=upper_(u.data.role);
  // Unknown roles must never become an authorized caregiver by default.
  if(!['ADMIN','CAREGIVER','USER'].includes(storedRole)) return null;
  const role=storedRole==='ADMIN'?'ADMIN':'CAREGIVER';
  const patientIds=role==='ADMIN'?Object.keys(T4M.patients):str_(u.data.patient_id).toUpperCase().split(/[,;\s]+/).filter(p=>p in T4M.patients);
  if(role==='CAREGIVER' && !patientIds.length) return null;
  return {id:u.data.user_id,email:email_(u.data.email),name:u.data.display_name||u.data.email,role,patientIds,
    lineId:str_(u.data.line_user_id),lineEnabled:active_(u.data.notification_enabled)};
}
function requestOtp(address) {
  const email=email_(address),user=userForEmail_(email);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !user)
    return {ok:true,message:'หากอีเมลได้รับสิทธิ์ ระบบจะส่งรหัสไปยังกล่องจดหมาย'};
  const cache=CacheService.getScriptCache(),rateKey='otp-rate:'+sha_(email);
  const count=Number(cache.get(rateKey)||0);
  if(count>=4) throw new Error('ขอรหัสบ่อยเกินไป กรุณาลองอีกครั้งภายหลัง');
  cache.put(rateKey,String(count+1),3600);
  const code=String(100000 + (parseInt(Utilities.getUuid().replace(/-/g,'').slice(0,8),16)%900000));
  cache.put('otp:'+sha_(email),JSON.stringify({hash:sha_(code),tries:0}),600);
  MailApp.sendEmail(email,'Time4Med — รหัสเข้าสู่ระบบ',
    'รหัสเข้าสู่ระบบ Time4Med: '+code+'\nรหัสใช้ได้ 10 นาที หากไม่ได้ร้องขอสามารถละเว้นอีเมลนี้');
  return {ok:true,message:'หากอีเมลได้รับสิทธิ์ ระบบจะส่งรหัสไปยังกล่องจดหมาย'};
}
function verifyOtp(address,code) {
  const email=email_(address),cache=CacheService.getScriptCache(),key='otp:'+sha_(email);
  const saved=cache.get(key),user=userForEmail_(email);
  assert_(saved && user,'รหัสหมดอายุหรือบัญชีไม่มีสิทธิ์');
  const record=JSON.parse(saved);
  assert_(record.tries<5,'ลองรหัสผิดเกินกำหนด กรุณาขอรหัสใหม่');
  if(record.hash!==sha_(str_(code))){
    record.tries++;cache.put(key,JSON.stringify(record),600);throw new Error('รหัสไม่ถูกต้อง');
  }
  cache.remove(key);
  const token=Utilities.getUuid()+Utilities.getUuid();
  cache.put('sess:'+sha_(token),email,21600);
  return {token,user:publicUser_(user)};
}
function publicUser_(u) { return {email:u.email,name:u.name,role:u.role,patientIds:u.patientIds}; }
function session_(token) {
  assert_(typeof token==='string' && token.length>=40,'กรุณาเข้าสู่ระบบ');
  const email=CacheService.getScriptCache().get('sess:'+sha_(token));
  const user=email && userForEmail_(email);
  assert_(user,'หมดเวลาหรือบัญชีไม่มีสิทธิ์ กรุณาเข้าสู่ระบบอีกครั้ง');
  return user;
}
function logout(token) { if(typeof token==='string')CacheService.getScriptCache().remove('sess:'+sha_(token));return true; }
function can_(user,patientId) { return user.role==='ADMIN'||user.patientIds.includes(str_(patientId)); }
function needAdmin_(user) { assert_(user.role==='ADMIN','เฉพาะแอดมินเท่านั้น'); }
function fixedShelf_(patientId) { return T4M.patients[patientId]||null; }
function patientIdOf_(d) { return str_(d.patient_id||'').toUpperCase(); }
// Sheets can display a correctly entered 08:05 as 8:05 depending on the cell format.
// Canonicalize valid 24-hour values before comparing schedules or sending them to devices.
function normalizedTime_(value) {
  const match=/^(\d{1,2}):([0-5]\d)(?::00)?$/.exec(str_(value));
  if(!match || Number(match[1])>23) return '';
  return String(Number(match[1])).padStart(2,'0')+':'+match[2];
}
function safeMedicine_(d) {
  const p=patientIdOf_(d);return {
    id:str_(d.record_id), patientId:p, patient:str_(d.patient),name:str_(d.name),
    mealType:Number(d.meal_type)||0,meal:T4M.meal[Number(d.meal_type)]||'—',
    time:normalizedTime_(d.reminder_time),days:str_(d.reminder_days),instruction:str_(d.instruction),
    stock:str_(d.stock_status),active:active_(d.is_active),kind:str_(d.kind),
    shelf:fixedShelf_(p),demo:/^(TEST|DEMO|LINECHECK)[_\s-]/i.test(str_(d.name)) ||
      /^(TEST|DEMO|LINECHECK)[_\s-]/i.test(str_(d.record_id))
  };
}
function isoLocal_(s) { return str_(s).replace('T',' ').slice(0,19); }
function bootstrap(token) {
  const user=session_(token);
  const patients=grid_('Patients').rows.map(x=>({id:patientIdOf_(x.data),name:x.data.display_name,
    status:x.data.status,shelf:fixedShelf_(patientIdOf_(x.data))})).filter(x=>x.shelf&&can_(user,x.id));
  const medicines=grid_('MealMedicines').rows.map(x=>safeMedicine_(x.data)).filter(x=>x.shelf&&can_(user,x.patientId));
  // System-wide audit events (including account emails) are ADMIN-only.
  const activity=grid_('ActivityLog').rows.map(x=>x.data).filter(x=>
    user.role==='ADMIN'||(str_(x.patient_id)==='ALL'&&x.event_type==='EMERGENCY')||
    (fixedShelf_(str_(x.patient_id))&&can_(user,x.patient_id)))
    .slice(-60).reverse().map(x=>({patientId:x.patient_id,type:x.event_type,time:isoLocal_(x.occurred_at),result:x.result,details:str_(x.details).slice(0,240)}));
  const images=grid_('ImageIndex').rows.map(x=>x.data).filter(x=>x.patient_id&&can_(user,x.patient_id))
    .slice(-40).reverse().map(x=>({id:x.image_id,patientId:x.patient_id,time:isoLocal_(x.captured_at),filename:x.filename,available:x.available,source:x.transfer_status}));
  const devices=grid_('Devices').rows.map(x=>x.data).map(x=>({id:x.device_id,type:x.device_type,lastSeen:x.last_seen,
    online:deviceFresh_(x.last_seen)?x.online_status:'UNKNOWN',lock:deviceFresh_(x.last_seen)?x.lock_status:'UNKNOWN'}));
  const users=user.role==='ADMIN'?grid_('Users').rows.map(x=>({id:x.data.user_id,email:x.data.email,name:x.data.display_name,
    role:x.data.role,patients:x.data.patient_id,status:x.data.status,lineConfigured:Boolean(x.data.line_user_id)})):[];
  return {user:publicUser_(user),patients,medicines,activity,images,devices,users,serverTime:tzNow_(),
    note:'สถานะการกดยืนยันไม่ใช่หลักฐานว่ากลืนยาแล้ว และสถานะอุปกรณ์ต้องมาจากข้อมูลใหม่เท่านั้น'};
}
function parseDateTime_(value) {
  const s=str_(value).replace(' ','T');
  const normalized=/(Z|[+-]\d{2}:\d{2})$/i.test(s)?s:s+'+07:00';
  return new Date(normalized);
}
function deviceFresh_(value) {
  const d=parseDateTime_(value);
  return !isNaN(d.getTime())&&Date.now()-d.getTime()<3*60000&&Date.now()>=d.getTime();
}
function days_(s) {
  const value=upper_(s).replace(/\s/g,'');
  if(!value||value==='ALL'||value==='EVERYDAY')return 'MON,TUE,WED,THU,FRI,SAT,SUN';
  const set=new Set(value.split(',').filter(Boolean));
  const valid=['MON','TUE','WED','THU','FRI','SAT','SUN'];
  assert_([...set].every(x=>valid.includes(x))&&set.size>0,'รูปแบบวันแจ้งเตือนไม่ถูกต้อง ใช้ MON,TUE,...,SUN');
  return valid.filter(x=>set.has(x)).join(',');
}
function mealShelf_(n) { return n<=2?'morning':n<=4?'midday':n<=6?'evening':'bedtime'; }
/**
 * Shared definition of a REAL medicine schedule, for the S3 pull response,
 * LINE due-time sender and read-only editor diagnostic. Never turn a
 * TEST/DEMO/PRN row into a scheduled LED or send it as a real LINE reminder.
 * Do not allow a malformed row to break an otherwise valid device snapshot.
 */
function schedulableMedicine_(m) {
  if(!m || !m.active || m.demo || upper_(m.kind)==='PRN' || !str_(m.id))return false;
  if(!fixedShelf_(m.patientId) || fixedShelf_(m.patientId)!==m.shelf)return false;
  if(!Number.isInteger(m.mealType) || m.mealType<1 || m.mealType>7)return false;
  if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(m.time))return false;
  try { days_(m.days);return true; } catch(_) { return false; }
}
// 4 LEDs per shelf; meal types 1-2 morning, 3-4 midday,
// 5-6 evening, 7 bedtime. Shelf 4 has NO dedicated LEDs.
function mealLedSlot_(mealType) {
  if(!Number.isInteger(mealType)||mealType<1||mealType>7)return 0;
  return mealType<=2?1:mealType<=4?2:mealType<=6?3:4;
}
function deviceScheduleSnapshot_(rows) {
  return rows.filter(schedulableMedicine_).map(m=>{
    const ledSlot=mealLedSlot_(m.mealType);
    return {id:m.id,patientId:m.patientId,shelf:m.shelf,mealType:m.mealType,
      time:m.time,days:days_(m.days),
      // Optional metadata for new S3 firmware; existing fields unchanged.
      ledSlot,ledIndex:(m.shelf-1)*4+ledSlot-1};
  });
}
function writeRow_(g,rowIndex,data) {
  const current=rowIndex?g.sheet.getRange(rowIndex,1,1,g.keys.length).getValues()[0]:Array(g.keys.length).fill('');
  g.keys.forEach((key,i)=>{if(Object.prototype.hasOwnProperty.call(data,key))current[i]=data[key];});
  if(rowIndex) g.sheet.getRange(rowIndex,1,1,g.keys.length).setValues([current]);
  else g.sheet.appendRow(current);
}
function logActivity_(patientId,userId,kind,details,result) {
  const g=grid_('ActivityLog');writeRow_(g,null,{event_id:Utilities.getUuid(),device_id:'WEBSITE',patient_id:patientId||'ALL',
    user_id:userId,event_type:kind,result:result||'SUCCESS',details:String(details).slice(0,400),occurred_at:tzNow_()});
}
function saveMedicine(token,input) {
  const u=session_(token);
  const p=upper_(input.patientId),name=str_(input.name),n=Number(input.mealType),time=str_(input.time);
  assert_(fixedShelf_(p),'เลือก P001–P003 เท่านั้น (ชั้น 4 ไม่ใช่ยาประจำบุคคล)');
  assert_(can_(u,p),'ไม่มีสิทธิ์จัดการยาของผู้สูงอายุนี้');
  assert_(name.length>=2&&name.length<=120,'ชื่อยาต้องยาว 2–120 ตัวอักษร');
  assert_(Number.isInteger(n)&&n>=1&&n<=7,'เลือกมื้อยา 1–7');
  assert_(/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time),'เวลาไม่ถูกต้อง (HH:mm)');
  const days=days_(input.days),id=str_(input.id),g=grid_('MealMedicines');
  const found=id?g.rows.find(r=>str_(r.data.record_id)===id):null;
  assert_(!id||found,'ไม่พบรายการยาที่ต้องการแก้ไข');
  // Existing record ownership must be checked separately from the new patientId.
  // This blocks a caregiver from moving another patient's medicine onto their own shelf.
  if(found) assert_(can_(u,patientIdOf_(found.data)),'ไม่มีสิทธิ์แก้ไขรายการยาของผู้สูงอายุนี้');
  const pName=grid_('Patients').rows.find(x=>patientIdOf_(x.data)===p)?.data.display_name||p;
  const val={record_id:id||Utilities.getUuid(),patient_id:p,patient:pName,name,
    kind:'scheduled',meal_type:String(n),shelf:mealShelf_(n),box_number:String(fixedShelf_(p)).padStart(2,'0'),
    reminder_time:time,instruction:str_(input.instruction).slice(0,500),is_active:input.active===false?'FALSE':'TRUE',
    reminder_days:days,updated_at:stamp_(),source:'WEB_APPS_SCRIPT'};
  if(!found){val.created_at=stamp_();val.stock_status='unchecked';}
  const lock=LockService.getScriptLock();lock.waitLock(12000);
  try{writeRow_(g,found?.index||null,val);logActivity_(p,u.id,found?'MEDICINE_UPDATED':'MEDICINE_CREATED',val.record_id);}finally{lock.releaseLock();}
  return {ok:true,id:val.record_id};
}
function disableMedicine(token,id) {
  const u=session_(token);const g=grid_('MealMedicines'),r=g.rows.find(x=>x.data.record_id===id);
  assert_(r,'ไม่พบรายการยา');
  assert_(can_(u,patientIdOf_(r.data)),'ไม่มีสิทธิ์ปิดใช้งานยาของผู้สูงอายุนี้');const lock=LockService.getScriptLock();lock.waitLock(12000);
  try{writeRow_(g,r.index,{is_active:'FALSE',updated_at:stamp_()});logActivity_(r.data.patient_id,u.id,'MEDICINE_DISABLED',id);}finally{lock.releaseLock();}
  return {ok:true};
}
function saveUser(token,input) {
  const u=session_(token);needAdmin_(u);
  const email=email_(input.email),role=upper_(input.role),p=upper_(input.patientIds).replace(/\s/g,'');
  const status=upper_(input.status||'ACTIVE');
  assert_(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'อีเมลไม่ถูกต้อง');
  assert_(role==='ADMIN'||role==='CAREGIVER','บทบาทไม่ถูกต้อง');
  assert_(['ACTIVE','INACTIVE','DISABLED'].includes(status),'สถานะบัญชีไม่ถูกต้อง');
  assert_(role==='ADMIN'||(p.length>0&&p.split(',').every(x=>fixedShelf_(x))),
    'ระบุ P001,P002,P003 เท่านั้น');
  const g=grid_('Users'),found=g.rows.find(r=>email_(r.data.email)===email);
  if(found&&email===u.email&&(role!=='ADMIN'||status!=='ACTIVE'))
    throw new Error('ไม่สามารถลดสิทธิ์หรือปิดบัญชีแอดมินของตัวเอง');
  const next={user_id:found?.data.user_id||'U'+Utilities.getUuid().slice(0,8).toUpperCase(),
    email,display_name:str_(input.name).slice(0,100)||email,role,patient_id:role==='ADMIN'?'ALL':p,
    status:status==='ACTIVE'?'ACTIVE':'INACTIVE',updated_at:stamp_()};
  if(!found){next.created_at=stamp_();next.notification_enabled='FALSE';}
  const lock=LockService.getScriptLock();lock.waitLock(12000);
  try{writeRow_(g,found?.index||null,next);logActivity_('ALL',u.id,'USER_SAVED',email);}finally{lock.releaseLock();}
  return {ok:true};
}
function readImage(token,id) {
  const u=session_(token),g=grid_('ImageIndex'),r=g.rows.find(x=>str_(x.data.image_id)===str_(id));
  assert_(r&&can_(u,r.data.patient_id),'ไม่มีสิทธิ์เข้าถึงภาพ');
  const fileId=str_(r.data.drive_file_id);
  assert_(fileId,'ภาพเก่าอยู่บน SD Card หรือยังไม่ได้อัปโหลดไป Drive');
  const blob=DriveApp.getFileById(fileId).getBlob();
  assert_(blob.getSize()<1250000,'ภาพใหญ่เกินกำหนด โปรดบีบอัดภาพ');
  assert_(blob.getContentType().startsWith('image/'),'ไฟล์ไม่ใช่ภาพ');
  return 'data:'+blob.getContentType()+';base64,'+Utilities.base64Encode(blob.getBytes());
}
function lineTo_(lineId,text) {
  const key=props_().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  assert_(key,'ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN ใน Script Properties');
  const r=UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push',{
    method:'post',contentType:'application/json',headers:{Authorization:'Bearer '+key},
    payload:JSON.stringify({to:lineId,messages:[{type:'text',text:text.slice(0,1000)}]}),muteHttpExceptions:true});
  assert_(r.getResponseCode()===200,'LINE ส่งไม่สำเร็จ (HTTP '+r.getResponseCode()+')');return true;
}
function testLine(token) {
  const u=session_(token);needAdmin_(u);assert_(u.lineId,'บัญชีแอดมินยังไม่ได้เชื่อม LINE User ID');
  lineTo_(u.lineId,'Time4Med: ทดสอบการเชื่อมต่อ LINE จาก Google Apps Script สำเร็จ\n\nเปิดเว็บไซต์ Time4Med:\n'+time4medWebsiteUrl_());
  logActivity_('ALL',u.id,'LINE_TEST','ทดสอบการส่ง LINE');return {ok:true};
}
/**
 * One LINE destination may be registered to more than one Users row.
 * For each medicine due event notify that destination only once, after
 * checking the recipient's patient permissions. Never expose LINE IDs.
 */
function uniqueLineRecipients_(users) {
  const seen=new Set();
  return users.filter(u=>{
    if(!u.lineId||seen.has(u.lineId))return false;
    seen.add(u.lineId);
    return true;
  });
}
/**
 * Read-only editor diagnostic. Does not send LINE, create triggers, mutate
 * medicine records, or write NotificationLog.
 */
/**
 * Run this function manually from the Apps Script editor (Time4Med owner).
 * Never expose the reminder candidates through the public Web App.
 * In "execute as me" web apps getActiveUser().getEmail() is generally blank.
 */
function inspectLineReminderReadiness() {
  const caller=String(Session.getActiveUser().getEmail()||'').toLowerCase();
  if(caller!=='time4med.project@gmail.com')
    throw new Error('Only the Time4Med owner may run this diagnostic from the editor.');
  return inspectLineReminderReadiness_();
}
function inspectLineReminderReadiness_() {
  const medicines=grid_('MealMedicines').rows.map(x=>safeMedicine_(x.data));
  const allUsers=grid_('Users').rows.map(x=>userForEmail_(x.data)).filter(Boolean);
  const lineUsers=allUsers.filter(u=>u.lineEnabled&&u.lineId);
  const active=medicines.filter(m=>m.active);
  const schedulable=active.filter(schedulableMedicine_);
  const jobs=ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='scheduledLineReminders_');
  const candidates=schedulable.map(m=>({
    patientId:m.patientId,mealType:m.mealType,time:m.time,days:m.days,
    recipientCount:uniqueLineRecipients_(lineUsers.filter(u=>can_(u,m.patientId))).length
  }));
  const summary={
    enabled:upper_(props_().getProperty('LINE_REMINDERS_ENABLED'))==='TRUE',
    triggerCount:jobs.length,
    medicineActiveCount:active.length,
    medicineExcludedDemoCount:active.filter(m=>m.demo).length,
    medicineEligibleCount:schedulable.length,
    lineEnabledUserRows:lineUsers.length,
    uniqueLineDestinations:uniqueLineRecipients_(lineUsers).length,
    dueCandidates:candidates
  };
  Logger.log(JSON.stringify(summary));
  return summary;
}
function notificationLog_(key,p,recipient,type,status,error) {
  const g=grid_('NotificationLog');const row=g.sheet.getLastRow()+1;
  writeRow_(g,null,{notification_id:key,event_id:key,patient_id:p,recipient_user_id:recipient,
    channel:'LINE',message_type:type,sent_at:tzNow_(),delivery_status:status,error_message:error||''});
  return row;
}
function weekdayNow_() {return ['SUN','MON','TUE','WED','THU','FRI','SAT'][Number(Utilities.formatDate(new Date(),T4M.tz,'u'))%7]||'MON';}
function validDaysForSchedule_(value,day) {
  try {return days_(value).split(',').includes(day);}
  catch(err){console.error('Invalid reminder_days',String(err));return false;}
}
// A one-minute Apps Script trigger is not guaranteed to fire at exactly
// HH:mm:00. Examine this minute and the previous two, using the scheduled
// minute's Bangkok date/weekday (important around midnight).
function recentReminderSlots_(now) {
  const slots=[];
  for(let minutesAgo=0;minutesAgo<3;minutesAgo++) {
    const instant=new Date(now.getTime()-minutesAgo*60000);
    const local=Utilities.formatDate(instant,T4M.tz,'yyyy-MM-dd HH:mm');
    const weekday=['MON','TUE','WED','THU','FRI','SAT','SUN'][
      Number(Utilities.formatDate(instant,T4M.tz,'u'))-1];
    if(weekday)slots.push({date:local.slice(0,10),time:local.slice(-5),day:weekday});
  }
  return slots;
}
function scheduledLineReminders_() {
  // Fail closed: enabling a trigger alone must not start sending medication reminders.
  if(upper_(props_().getProperty('LINE_REMINDERS_ENABLED'))!=='TRUE') return;
  const lock=LockService.getScriptLock();if(!lock.tryLock(500))return;
  try{
    const dueMinutes=recentReminderSlots_(new Date());
    const items=grid_('MealMedicines').rows.map(x=>safeMedicine_(x.data))
      .filter(m=>schedulableMedicine_(m) && dueMinutes.some(slot=>
        m.time===slot.time && validDaysForSchedule_(m.days,slot.day)));
    if(!items.length)return;
    const users=grid_('Users').rows.map(x=>userForEmail_(x.data.email)).filter(x=>x&&x.lineEnabled&&x.lineId);
    const notificationGrid=grid_('NotificationLog');
    const seen=new Set(notificationGrid.rows.map(x=>str_(x.data.notification_id)));
    items.forEach(m=>uniqueLineRecipients_(users.filter(u=>can_(u,m.patientId))).forEach(u=>{
      const scheduled=dueMinutes.find(slot=>m.time===slot.time && validDaysForSchedule_(m.days,slot.day));
      const key='T4M-'+scheduled.date+'-'+sha_(m.id+':'+u.id).slice(0,14);
      if(seen.has(key))return;
      // Record the attempt before sending, then record the actual provider outcome.
      // A failed attempt is not falsely displayed as SENT.
      const logRow=notificationLog_(key,m.patientId,u.id,'MEDICINE_DUE','ATTEMPTED');seen.add(key);
      try{
        lineTo_(u.lineId,'Time4Med แจ้งเตือน '+m.patientId+' ชั้น '+m.shelf+'\n'+m.meal+' เวลา '+m.time+'\nยา: '+m.name+'\nกรุณาตรวจสอบการรับยาตามคำแนะนำ\n\nเปิดเว็บไซต์ Time4Med:\n'+time4medWebsiteUrl_());
        writeRow_(grid_('NotificationLog'),logRow,{delivery_status:'SENT',error_message:''});
      } catch(err){
        writeRow_(grid_('NotificationLog'),logRow,{delivery_status:'FAILED',error_message:String(err).slice(0,200)});
        logActivity_(m.patientId,'SYSTEM','LINE_SEND_ERROR',String(err),'ERROR');
      }
    }));
  }finally{lock.releaseLock();}
}
function setupTriggersFromEditor_() {
  // Run manually as project owner once; not exposed via website.
  ScriptApp.getProjectTriggers().forEach(t=>{
    if(['scheduledLineReminders_','monthlyImageCleanup_'].includes(t.getHandlerFunction()))ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('scheduledLineReminders_').timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger('monthlyImageCleanup_').timeBased().everyDays(1).atHour(3).create();
}
function monthlyImageCleanup_() {
  // Require an explicit go-live decision before deleting Drive evidence.
  if(upper_(props_().getProperty('IMAGE_RETENTION_ENABLED'))!=='TRUE') return;
  const g=grid_('ImageIndex'),cutoff=Date.now()-30*86400000;
  g.rows.forEach(r=>{const d=r.data,date=parseDateTime_(d.captured_at);
    if(!isNaN(date.getTime())&&date.getTime()<cutoff&&str_(d.drive_file_id)&&active_(d.available)){
      try{DriveApp.getFileById(str_(d.drive_file_id)).setTrashed(true);
        writeRow_(g,r.index,{available:'FALSE',transfer_status:'EXPIRED_30D'});}catch(error){console.error('Image cleanup',r.index,error);}
    }
  });
}

/**
 * Admin-only, one-click, real-hardware demonstration.
 * CacheService is temporary memory: NO writes to Sheets, ActivityLog,
 * IntakeLog, ImageIndex, NotificationLog, Drive or medication schedules.
 * ESP32-S3 must poll demoPoll and report demoEvent using DEVICE_API_KEY.
 * Sending START_DEMO NEVER unlocks the door remotely.
 */
const DEMO_KEY_='time4med:demo:active';
const DEMO_PHASES_=Object.freeze([
  'RECEIVED','REMINDER_STARTED','VOICE_DONE','LOCK_OPENED',
  'DOOR_OPENED','DOOR_CLOSED','CONFIRMED','PHOTO_CAPTURED','COMPLETE'
]);
function demoCache_(){return CacheService.getScriptCache();}
function readDemo_(){
  const json=demoCache_().get(DEMO_KEY_);
  if(!json)return null;
  const state=JSON.parse(json);
  if(['WAITING','RUNNING'].includes(state.status) && Date.now()>state.expiresAt){
    state.status='TIMED_OUT';state.note='หมดเวลารออุปกรณ์ 5 นาที กรุณาเริ่มใหม่';
    saveDemo_(state);
  }
  return state;
}
function saveDemo_(state){demoCache_().put(DEMO_KEY_,JSON.stringify(state),600);}
function demoPublic_(state){
  if(!state)return {status:'IDLE'};
  return {id:state.id,status:state.status,patientId:state.patientId,
    shelf:state.shelf,mealType:state.mealType,startedAt:state.startedAt,
    expiresAt:state.expiresAt,steps:state.steps||[],note:state.note||'',
    photoAvailable:!!demoCache_().get('time4med:demo:photo:'+state.id),
    lineStatus:state.lineStatus||'SKIPPED'};
}
function startDemo(token,opts){
  const admin=session_(token);needAdmin_(admin);
  const x=opts||{},patientId=upper_(x.patientId||'P001'),mealType=Number(x.mealType||2);
  assert_(fixedShelf_(patientId),'การสาธิตรองรับ P001–P003 เท่านั้น');
  assert_(Number.isInteger(mealType)&&mealType>=1&&mealType<=7,'มื้อยาไม่ถูกต้อง');
  const lock=LockService.getScriptLock();lock.waitLock(5000);
  try{
    const existing=readDemo_();
    assert_(!existing||!['WAITING','RUNNING'].includes(existing.status),
      'มีการทดสอบกำลังทำงานอยู่ โปรดหยุดหรือรอให้สิ้นสุดก่อน');
    const now=Date.now();
    // LINE demo is optional, explicit opt-in and never sends a scheduled reminder.
    const sendLine=x.sendLine===true;
    const state={id:Utilities.getUuid(),status:'WAITING',
      patientId,shelf:fixedShelf_(patientId),mealType,
      startedAt:Utilities.formatDate(new Date(),T4M.tz,'yyyy-MM-dd HH:mm:ss'),
      expiresAt:now+300000,steps:[],note:'รอ ESP32-S3 เชื่อมต่อเพื่อเริ่มสาธิต',
      lineStatus:sendLine?'PENDING':'SKIPPED',
      lineRecipient:sendLine?str_(admin.lineId):''};
    if(sendLine&&!state.lineRecipient)state.lineStatus='UNAVAILABLE';
    saveDemo_(state);
    return demoPublic_(state);
  }finally{lock.releaseLock();}
}
function getDemoStatus(token){
  needAdmin_(session_(token));
  return demoPublic_(readDemo_());
}
function cancelDemo(token){
  needAdmin_(session_(token));
  const lock=LockService.getScriptLock();lock.waitLock(5000);
  try{
    const state=readDemo_();
    if(!state)return {status:'IDLE'};
    if(['WAITING','RUNNING'].includes(state.status)){
      state.status='STOPPED';state.note='แอดมินสั่งหยุดการทดสอบ';
      saveDemo_(state);
    }
    return demoPublic_(state);
  }finally{lock.releaseLock();}
}
function getDemoPreview(token,id){
  needAdmin_(session_(token));
  const state=readDemo_();
  assert_(state&&state.id===str_(id),'ไม่พบการสาธิตที่ร้องขอ');
  const base64=demoCache_().get('time4med:demo:photo:'+state.id);
  assert_(base64,'ยังไม่มีรูปสาธิตในหน่วยความจำชั่วคราว');
  return 'data:image/jpeg;base64,'+base64;
}
function demoDevicePoll_(p){
  const deviceId=str_(p.deviceId);
  assert_(deviceId.length>0 && deviceId===str_(props_().getProperty('DEMO_DEVICE_ID')||'S3-001'),
    'DEMO_DEVICE_NOT_AUTHORIZED');
  const state=readDemo_();
  if(!state)return {ok:true,command:'NONE'};
  if(['STOPPED','TIMED_OUT'].includes(state.status))
    return {ok:true,command:'STOP_DEMO',demoId:state.id};
  if(['WAITING','RUNNING'].includes(state.status)){
    // Idempotent: firmware MUST ignore a repeated START_DEMO for the same demoId.
    return {ok:true,command:'START_DEMO',demoId:state.id,
      demoOnly:true,patientId:state.patientId,shelf:state.shelf,
      mealType:state.mealType,expiresAt:state.expiresAt};
  }
  return {ok:true,command:'NONE'};
}
function demoDeviceEvent_(p){
  const deviceId=str_(p.deviceId);
  assert_(deviceId===str_(props_().getProperty('DEMO_DEVICE_ID')||'S3-001'),
    'DEMO_DEVICE_NOT_AUTHORIZED');
  const id=str_(p.demoId),phase=upper_(p.phase);
  assert_(DEMO_PHASES_.includes(phase)||phase==='ERROR','INVALID_DEMO_PHASE');
  const lock=LockService.getScriptLock();lock.waitLock(5000);
  let recipient='';
  let result;
  try{
    const state=readDemo_();
    assert_(state&&state.id===id,'DEMO_NOT_FOUND');
    assert_(['WAITING','RUNNING'].includes(state.status),'DEMO_NOT_ACTIVE');
    if(phase==='ERROR'){
      state.status='FAILED';
      state.note='อุปกรณ์แจ้งข้อผิดพลาด: '+str_(p.note).slice(0,120);
    }else if(!state.steps.some(step=>step.phase===phase)){
      if(phase==='COMPLETE'){
        // Cannot mark complete without confirmed events from the real hardware.
        const needed=DEMO_PHASES_.filter(x=>x!=='COMPLETE');
        assert_(needed.every(x=>state.steps.some(step=>step.phase===x)),
          'DEMO_STEPS_INCOMPLETE');
        state.status='DONE';state.note='อุปกรณ์ส่งเหตุการณ์ครบทุกขั้นตอน';
      }else{state.status='RUNNING';state.note='รับสัญญาณจาก ESP32-S3: '+phase;}
      state.steps.push({phase,at:Utilities.formatDate(new Date(),T4M.tz,'HH:mm:ss')});
    }
    if(phase==='COMPLETE' && state.status==='DONE' && state.lineStatus==='PENDING'){
      state.lineStatus='SENDING';
      recipient=state.lineRecipient;
    }
    saveDemo_(state);
    result={ok:true,status:state.status,phase};
  }finally{lock.releaseLock();}
  if(recipient){
    // Intentionally NO NotificationLog/ActivityLog write for demo LINE.
    let delivery='SENT';
    try{lineTo_(recipient,'[Time4Med DEMO] สาธิตระบบเสร็จสิ้น: '+id+
      '\nผู้สูงอายุ '+str_(p.patientId||'')+' (โหมดทดสอบ ไม่มีการบันทึกประวัติการรับยา)');}
    catch(err){delivery='FAILED';}
    const lineLock=LockService.getScriptLock();lineLock.waitLock(5000);
    try{
      const latest=readDemo_();
      if(latest&&latest.id===id&&latest.lineStatus==='SENDING'){
        latest.lineStatus=delivery;saveDemo_(latest);
      }
    }finally{lineLock.releaseLock();}
  }
  return result;
}
function demoDevicePhoto_(p){
  assert_(str_(p.deviceId)===str_(props_().getProperty('DEMO_DEVICE_ID')||'S3-001'),
    'DEMO_DEVICE_NOT_AUTHORIZED');
  const state=readDemo_();
  assert_(state&&state.id===str_(p.demoId)&&['WAITING','RUNNING'].includes(state.status),
    'DEMO_NOT_ACTIVE');
  const jpeg=str_(p.jpegBase64);
  assert_(jpeg.length>100 && jpeg.length<=60000 && /^[A-Za-z0-9+/]+={0,2}$/.test(jpeg),
    'DEMO_PHOTO_TOO_LARGE');
  const bytes=Utilities.base64Decode(jpeg);
  assert_(bytes.length>=100 && (bytes[0]&255)===255 && (bytes[1]&255)===216 &&
    (bytes[2]&255)===255,'DEMO_PHOTO_NOT_JPEG');
  // CacheService is volatile and expires. Never create a Google Drive file.
  demoCache_().put('time4med:demo:photo:'+state.id,jpeg,600);
  return {ok:true,temporary:true};
}

function json_(obj) {return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);}
function deviceAuthenticated_(key) {
  const actual=props_().getProperty('DEVICE_API_KEY');
  return Boolean(actual && actual.length>=24 && typeof key==='string' && sha_(actual)===sha_(key));
}
function postDevice_(e) {
  const p=JSON.parse((e&&e.postData&&e.postData.contents)||'{}');
  assert_(deviceAuthenticated_(p.deviceKey),'DEVICE_KEY_INVALID');
  assert_(['pullSchedule','heartbeat','intake','emergency','image','demoPoll','demoEvent','demoPhoto'].includes(p.action),'UNKNOWN_DEVICE_ACTION');
  if(p.action==='demoPoll')return demoDevicePoll_(p);
  if(p.action==='demoEvent')return demoDeviceEvent_(p);
  if(p.action==='demoPhoto')return demoDevicePhoto_(p);
  if(p.action==='pullSchedule'){
    const schedules=deviceScheduleSnapshot_(
      grid_('MealMedicines').rows.map(x=>safeMedicine_(x.data)));
    return {ok:true,timezone:T4M.tz,schedules};
  }
  const patientId=upper_(p.patientId||''),event=String(p.action),deviceId=str_(p.deviceId||'S3-001');
  if(p.action==='heartbeat'){
    const g=grid_('Devices'),r=g.rows.find(x=>x.data.device_id===deviceId);
    if(r)writeRow_(g,r.index,{online_status:'ONLINE',lock_status:upper_(p.lock||'UNKNOWN'),last_seen:tzNow_(),wifi_rssi_dbm:Number(p.rssi)||0});
    return {ok:true,receivedAt:tzNow_()};
  }
  // The emergency button is shared by the entire cabinet. ALL is an explicit
  // cabinet-wide emergency and must not be misattributed to P001.
  if(p.action==='emergency' && (!patientId || patientId==='ALL')) {
    logActivity_('ALL',deviceId,'EMERGENCY','กดปุ่มฉุกเฉินส่วนกลางที่ตู้ยา');
    const recipients=uniqueLineRecipients_(grid_('Users').rows.map(x=>userForEmail_(x.data.email))
      .filter(x=>x&&x.lineEnabled&&x.lineId));
    recipients.forEach(u=>{try{lineTo_(u.lineId,'Time4Med ฉุกเฉิน! กดปุ่มฉุกเฉินส่วนกลางที่ตู้ยา กรุณาตรวจสอบทันที\n\nเปิดเว็บไซต์ Time4Med:\n'+time4medWebsiteUrl_());}
      catch(err){console.error('Emergency LINE failed',String(err));}});
    return {ok:true,receivedAt:tzNow_(),patientId:'ALL'};
  }
  assert_(fixedShelf_(patientId),'INVALID_PATIENT_ID');
  if(p.action==='image'){
    const content=str_(p.jpegBase64);assert_(content.length>0&&content.length<1800000,'IMAGE_SIZE_INVALID');
    const bytes=Utilities.base64Decode(content);assert_(bytes.length>100&&bytes.length<=1200000,'IMAGE_SIZE_INVALID');
    assert_((bytes[0]&255)===255&&(bytes[1]&255)===216&&(bytes[2]&255)===255,'IMAGE_NOT_JPEG');
    const folderId=props_().getProperty('IMAGE_FOLDER_ID');assert_(folderId,'IMAGE_FOLDER_ID_MISSING');
    const file=DriveApp.getFolderById(folderId).createFile(Utilities.newBlob(bytes,'image/jpeg',Utilities.getUuid()+'.jpg'));
    const g=grid_('ImageIndex'),id=Utilities.getUuid();
    // If drive_file_id column is absent, add it. Required for secure caregiver image preview.
    let col=g.keys.indexOf('drive_file_id');if(col<0){col=g.keys.length;g.sheet.getRange(T4M.cols.ImageIndex,col+1).setValue('drive_file_id');g.keys.push('drive_file_id');}
    writeRow_(g,null,{image_id:id,patient_id:patientId,filename:file.getName(),captured_at:tzNow_(),
      file_size_bytes:bytes.length,transfer_status:'DRIVE',available:'TRUE',drive_file_id:file.getId()});
    return {ok:true,imageId:id};
  }
  logActivity_(patientId,deviceId,p.action==='emergency'?'EMERGENCY':'INTAKE_CONFIRMED',
    p.action==='emergency'?'มีการกดปุ่มฉุกเฉิน':'มีการกดยืนยันที่อุปกรณ์ (ไม่ใช่หลักฐานว่ากลืนยาแล้ว)');
  if(p.action==='intake'){
    const g=grid_('IntakeLog');writeRow_(g,null,{log_id:Utilities.getUuid(),event_id:Utilities.getUuid(),patient_id:patientId,
      scheduled_at:tzNow_(),confirmed_at:tzNow_(),status:'CONFIRMED',confirmation_source:'BUTTON',created_at:tzNow_()});
  }
  if(p.action==='emergency'){
    uniqueLineRecipients_(grid_('Users').rows.map(x=>userForEmail_(x.data.email)).filter(x=>x&&x.lineEnabled&&x.lineId&&can_(x,patientId)))
      .forEach(u=>{try{lineTo_(u.lineId,'Time4Med ฉุกเฉิน! มีการกดปุ่มฉุกเฉินที่ตู้ยา ชั้น '+fixedShelf_(patientId)+' ('+patientId+') กรุณาตรวจสอบทันที\n\nเปิดเว็บไซต์ Time4Med:\n'+time4medWebsiteUrl_());}
      catch(err){console.error('Emergency line failed',err);}});
  }
  return {ok:true,receivedAt:tzNow_()};
}
function doPost(e) {
  try{return json_(postDevice_(e));}
  catch(err){console.error('Time4Med device',String(err));return json_({ok:false,error:String(err.message||err)});}
}