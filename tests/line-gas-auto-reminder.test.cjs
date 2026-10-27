const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');

const files=['Code.gs','SheetPreview.gs','ReminderPreview.gs','ReminderLink.gs','AutoReminder.gs'];
const source=files.map(n=>fs.readFileSync('integrations/line-apps-script/'+n,'utf8')).join('\n\n');
const LINEID_A='U'+'a'.repeat(32),LINEID_B='U'+'b'.repeat(32),LINEID_C='U'+'c'.repeat(32);
const URL='https://n4-p4t.github.io/Time4Med/';
const TOKEN='fake-token-for-offline-tests-only-abcdef';
const MED_HEAD=['record_id','patient','name','kind','meal_type','shelf','box_number',
  'reminder_time','instruction','stock_status','status_updated_at','created_at',
  'updated_at','is_active','source','patient_id','reminder_days'];
const USER_HEAD=['user_id','email','display_name','role','patient_id','line_user_id',
  'notification_enabled','status','created_at','updated_at'];
function med(id,patient,name,time,days,meal='2',active='TRUE',box) {
 const x=Array(17).fill('');
 x[0]=id;x[2]=name;x[3]='scheduled';x[4]=meal;
 x[6]=box||String(Number(patient.slice(-1)));x[7]=time;
 x[13]=active;x[15]=patient;x[16]=days;return x;
}
function user(id,role,scope,line,enabled='TRUE',status='ACTIVE') {
 const x=Array(10).fill('');
 x[0]=id;x[3]=role;x[4]=scope;x[5]=line;x[6]=enabled;x[7]=status;return x;
}
function spreadsheetSheet(rows,headerRow=0){
 return {
  getLastColumn:()=>rows[headerRow].length,
  getLastRow:()=>rows.length,
  getRange:(row,col,num,width)=>({
   getDisplayValues:()=>rows.slice(row-1,row-1+num).map(r=>r.slice(col-1,col-1+width))
  })
 };
}
function bangkokFormatted(date){
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Bangkok',year:'numeric',
  month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
  .formatToParts(date);
 const get=n=>parts.find(p=>p.type===n).value;
 return get('year')+get('month')+get('day')+'|'+get('hour')+':'+get('minute');
}
// 2026-10-27 17:04 Asia/Bangkok
const nowIso='2026-10-27T10:04:00Z';
function harness(opts={}) {
 const meds=opts.meds||[
  MED_HEAD,
  med('test-a','P001','TEST_P001','17:02','DAILY'),
  med('test-b','P002','TEST_P002','18:30','MON,TUE,WED,THU,FRI,SAT,SUN')
 ];
 const users=opts.users||[
  ['Users — header'],['description'],[],USER_HEAD,
  user('uadmin','ADMIN','ALL',LINEID_A)
 ];
 const map={MealMedicines:spreadsheetSheet(meds),Users:spreadsheetSheet(users,3)};
 const state=new Map(Object.entries({
  LINE_CHANNEL_ACCESS_TOKEN:TOKEN,
  TIME4MED_SHEET_ID:'a'.repeat(35),
  LINE_TEST_USER_ID:LINEID_A,
  ...opts.properties
 }));
 const calls=[],logs=[],triggers=[];
 let quotaUsed=opts.quotaUsed||0, failed=opts.failStatus||200;
 const scriptProps={
  getProperty:key=>state.has(key)?state.get(key):null,
  setProperty:(key,value)=>{state.set(key,String(value));},
  getProperties:()=>Object.fromEntries(state.entries()),
  deleteProperty:key=>state.delete(key)
 };
 class FakeDate extends Date {
  constructor(...args){super(...(args.length?args:[nowIso]));}
 }
 const reply=(status,body)=>({getResponseCode:()=>status,
  getContentText:()=>JSON.stringify(body)});
 const context={
  Date:FakeDate,
  PropertiesService:{getScriptProperties:()=>scriptProps},
  SpreadsheetApp:{openById:id=>{
   calls.push({type:'open',id});
   assert.equal(id,'a'.repeat(35));
   return {getSheetByName:name=>map[name]||null};
  }},
  UrlFetchApp:{fetch:(url,config={})=>{
   calls.push({type:'network',url,config});
   if(url.endsWith('/message/quota'))return reply(200,{type:'limited',value:300});
   if(url.endsWith('/message/quota/consumption'))
    return reply(200,{totalUsage:quotaUsed});
   if(url.endsWith('/message/push')){
    if(failed==='THROW')throw Error('network error with secret '+TOKEN);
    return reply(failed,{});
   }
   throw Error('Unknown URL');
  }},
  Utilities:{
   formatDate:(date,tz,fmt)=>{
    assert.equal(tz,'Asia/Bangkok'); assert.equal(fmt,'yyyyMMdd|HH:mm');
    return bangkokFormatted(date);
   },
   computeDigest:(alg,raw)=>Array.from(crypto.createHash('sha256').update(raw).digest()),
   base64EncodeWebSafe:bytes=>Buffer.from(bytes).toString('base64url'),
   DigestAlgorithm:{SHA_256:'SHA_256'},
   getUuid:()=> '123e4567-e89b-42d3-a456-426614174000'
  },
  LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
  ScriptApp:{
   getProjectTriggers:()=>triggers,
   newTrigger:handler=>({timeBased:()=>({everyMinutes:count=>({
    create:()=>{triggers.push({getHandlerFunction:()=>handler,interval:count});}
   })})}),
   deleteTrigger:t=>{let i=triggers.indexOf(t);if(i>=0)triggers.splice(i,1);}
  },
  console:{log:message=>logs.push(String(message))}
 };
 vm.runInNewContext(source,context,{timeout:3000});
 return {ctx:context,state,calls,logs,triggers,
  get pushes(){return calls.filter(c=>c.type==='network'&&c.url.endsWith('/message/push'));},
  setQuota:x=>{quotaUsed=x;},setStatus:x=>{failed=x;}};
}
test('default-disabled entrypoint makes no network or sheet reads',()=>{
 const t=harness();
 const result=t.ctx.runTime4MedReminders();
 assert.equal(result.mode,'DISABLED_NO_SEND');
 assert.equal(result.notificationsSent,0);
 assert.equal(t.calls.length,0);
});

test('readiness reports TEST-only data not ready and no changes',()=>{
 const t=harness({properties:{LINE_AUTO_ALLOWED_USER_IDS:LINEID_A}});
 const result=t.ctx.checkTime4MedAutoReadiness();
 assert.equal(result.mode,'READ_ONLY_NO_NOTIFICATIONS');
 assert.equal(result.medicineStats.excludedDemo,2);
 assert.equal(result.medicineStats.validRecords,0);
 assert.equal(result.recipientStats.allowedRecipients,1);
 assert.equal(result.readyToInstall,false);
 assert.equal(t.pushes.length,0);
 assert.ok(t.logs.every(s=>!s.includes(LINEID_A)&&!s.includes(TOKEN)));
});

test('missing days column means never silently infer daily medication',()=>{
 const meds=MED_HEAD.slice(0,-1);
 const t=harness({meds:[meds,med('id','P001','ยาแคลเซียม','17:02','DAILY').slice(0,-1)],
  properties:{LINE_AUTO_ALLOWED_USER_IDS:LINEID_A,LINE_AUTO_ENABLED:'YES',
   LINE_AUTO_SEND_ENABLED:'YES'}});
 const report=t.ctx.checkTime4MedAutoReadiness();
 assert.equal(report.daysColumnPresent,false);
 assert.equal(report.readyToInstall,false);
 assert.throws(()=>t.ctx.runTime4MedReminders(),/REMINDER_DAYS_COLUMN_MISSING/);
 assert.equal(t.pushes.length,0);
});

test('Tuesday schedule matches Bangkok day, Monday-only does not',()=>{
 const t=harness({meds:[
  MED_HEAD,
  med('med1','P001','ยาจริงหนึ่ง','17:02','TUE'),
  med('med2','P001','ยาจริงสอง','17:02','MON')
 ],properties:{LINE_AUTO_ALLOWED_USER_IDS:LINEID_A}});
 const plan=t.ctx.previewTime4MedAutoReminders();
 assert.equal(plan.matchingDeliveryCount,1);
 assert.equal(t.pushes.length,0);
});

test('one message includes grouped P001 and P002 and dashboard URL/URI action',()=>{
 const t=harness({meds:[
  MED_HEAD,
  med('med1','P001','ยาจริงหนึ่ง','17:02','DAILY'),
  med('med2','P001','ยาจริงสอง','17:02','TUE'),
  med('med3','P002','ยาจริงสาม','17:02','TUE')
 ],properties:{
  LINE_AUTO_ENABLED:'YES',LINE_AUTO_SEND_ENABLED:'YES',
  LINE_AUTO_ALLOWED_USER_IDS:LINEID_A
 }});
 const first=t.ctx.runTime4MedReminders();
 assert.equal(first.mode,'LIVE_API_ATTEMPTS');
 assert.equal(first.apiAccepted,1);
 assert.equal(first.deliveryConfirmed,false);
 assert.equal(t.pushes.length,1);
 const body=JSON.parse(t.pushes[0].config.payload);
 assert.equal(body.to,LINEID_A);
 assert.equal(body.messages.length,1);
 const message=body.messages[0];
 assert.match(message.text,/P001, P002/);
 assert.match(message.text,/17:02/);
 assert.ok(message.text.includes(URL));
 assert.equal(message.quickReply.items[0].action.uri,URL);
 assert.doesNotMatch(message.text,/ยาจริงหนึ่ง|ยาจริงสอง|ยาจริงสาม/);
 assert.ok(t.logs.every(s=>!s.includes(TOKEN)&&!s.includes(LINEID_A)));
 const second=t.ctx.runTime4MedReminders();
 assert.equal(second.notificationsSent,0);
 assert.equal(t.pushes.length,1);
 const props=[...t.state.entries()].filter(([key])=>key.startsWith('T4M_AUTO_V1_'));
 assert.equal(props.length,1);
 assert.equal(props[0][1],'API_ACCEPTED');
});

test('authorized scope and allowlist prevent unrelated caregiver notifications',()=>{
 const t=harness({meds:[MED_HEAD,med('med1','P001','Vitamin','17:02','TUE')],
  users:[['title'],['info'],[],USER_HEAD,
   user('admin','ADMIN','ALL',LINEID_A),
   user('care','CAREGIVER','P002',LINEID_B),
   user('care2','CAREGIVER','P001',LINEID_C)
  ],properties:{
   LINE_AUTO_ENABLED:'YES',LINE_AUTO_SEND_ENABLED:'YES',
   LINE_AUTO_ALLOWED_USER_IDS:LINEID_B+','+LINEID_C
  }});
 const result=t.ctx.runTime4MedReminders();
 assert.equal(result.apiAccepted,1);
 assert.equal(t.pushes.length,1);
 assert.equal(JSON.parse(t.pushes[0].config.payload).to,LINEID_C);
});

test('duplicate LINE account rows are rejected rather than unioning permissions',()=>{
 const t=harness({meds:[MED_HEAD,med('1','P001','Vitamin','17:02','TUE')],
 users:[['title'],['info'],[],USER_HEAD,
  user('a','CAREGIVER','P001',LINEID_A),
  user('b','ADMIN','ALL',LINEID_A)],
 properties:{LINE_AUTO_ENABLED:'YES',LINE_AUTO_SEND_ENABLED:'YES',
  LINE_AUTO_ALLOWED_USER_IDS:LINEID_A}});
 const result=t.ctx.runTime4MedReminders();
 assert.equal(result.notificationsSent,0);
 assert.equal(t.pushes.length,0);
});

test('no trigger without explicit install confirmation and live eligible data',()=>{
 const t=harness({meds:[MED_HEAD,med('1','P001','Vitamin','17:02','TUE')],
  properties:{LINE_AUTO_ENABLED:'YES',LINE_AUTO_SEND_ENABLED:'YES',
   LINE_AUTO_ALLOWED_USER_IDS:LINEID_A}});
 assert.throws(()=>t.ctx.installTime4MedReminderTrigger(),/INSTALL_NOT_CONFIRMED/);
 assert.equal(t.triggers.length,0);
 t.state.set('LINE_AUTO_INSTALL_CONFIRM','YES');
 const created=t.ctx.installTime4MedReminderTrigger();
 assert.equal(created.everyMinutes,5);
 assert.equal(t.triggers.length,1);
 assert.equal(t.ctx.installTime4MedReminderTrigger().alreadyInstalled,true);
 assert.equal(t.triggers.length,1);
 const stopped=t.ctx.pauseTime4MedReminders();
 assert.equal(stopped.disabled,true);
 assert.equal(stopped.triggersRemoved,1);
 assert.equal(t.state.get('LINE_AUTO_ENABLED'),'NO');
 assert.equal(t.triggers.length,0);
});

test('no trigger while TEST-only even if all enabled',()=>{
 const t=harness({properties:{LINE_AUTO_ENABLED:'YES',LINE_AUTO_SEND_ENABLED:'YES',
  LINE_AUTO_INSTALL_CONFIRM:'YES',LINE_AUTO_ALLOWED_USER_IDS:LINEID_A}});
 assert.throws(()=>t.ctx.installTime4MedReminderTrigger(),/DATA_NOT_READY/);
 assert.equal(t.triggers.length,0);
});

test('quota cap stops without network pushes at 250 messages',()=>{
 const t=harness({meds:[MED_HEAD,med('1','P001','Vitamin','17:02','TUE')],
 quotaUsed:250,properties:{LINE_AUTO_ENABLED:'YES',
  LINE_AUTO_SEND_ENABLED:'YES',LINE_AUTO_ALLOWED_USER_IDS:LINEID_A}});
 const result=t.ctx.runTime4MedReminders();
 assert.equal(result.apiAccepted,0);
 assert.equal(result.quotaBlocked,1);
 assert.equal(t.pushes.length,0);
});

test('network timeout enters review ledger and never resends automatically',()=>{
 const t=harness({meds:[MED_HEAD,med('1','P001','Vitamin','17:02','TUE')],
  failStatus:'THROW',properties:{LINE_AUTO_ENABLED:'YES',
  LINE_AUTO_SEND_ENABLED:'YES',LINE_AUTO_ALLOWED_USER_IDS:LINEID_A}});
 const first=t.ctx.runTime4MedReminders();
 assert.equal(first.apiAccepted,0);
 assert.equal(first.reviewRequired,1);
 assert.equal(t.pushes.length,1);
 const props=[...t.state.entries()].filter(([k])=>k.startsWith('T4M_AUTO_V1_'));
 assert.equal(props.length,1);
 assert.equal(props[0][1],'REVIEW_REQUIRED');
 const second=t.ctx.runTime4MedReminders();
 assert.equal(second.notificationsSent,0);
 assert.equal(t.pushes.length,1);
});

test('unknown days and wrong medicine compartment are excluded',()=>{
 const t=harness({meds:[
  MED_HEAD,
  med('1','P001','Vitamin','17:02','TUR'),
  med('2','P003','Vitamin','17:02','DAILY','2','TRUE','4')
 ],properties:{LINE_AUTO_ALLOWED_USER_IDS:LINEID_A}});
 const r=t.ctx.checkTime4MedAutoReadiness();
 assert.equal(r.medicineStats.invalidRecords,1);
 assert.equal(r.medicineStats.missingOrInvalidDays,1);
 assert.equal(r.readyToInstall,false);
});

test('ledger cleanup prunes only old hashed entries, never current-day keys',()=>{
 const t=harness({properties:{
  LINE_AUTO_ENABLED:'YES',LINE_AUTO_SEND_ENABLED:'YES',
  LINE_AUTO_ALLOWED_USER_IDS:LINEID_A,
  T4M_AUTO_V1_20260101_123456789012345678901234:'API_ACCEPTED',
  T4M_AUTO_V1_20261027_123456789012345678901234:'API_ACCEPTED',
  OTHER_PROPERTY:'preserve'
 }});
 const result=t.ctx.runTime4MedReminders();
 assert.equal(result.notificationsSent,0);
 assert.equal(t.state.has('T4M_AUTO_V1_20260101_123456789012345678901234'),false);
 assert.equal(t.state.get('T4M_AUTO_V1_20261027_123456789012345678901234'),'API_ACCEPTED');
 assert.equal(t.state.get('OTHER_PROPERTY'),'preserve');
 assert.equal(t.state.get('T4M_AUTO_PRUNE_DAY'),'20261027');
});

test('no Cloudflare Worker endpoint/webhook or mutation of production sheet',()=>{
 const engine=fs.readFileSync('integrations/line-apps-script/AutoReminder.gs','utf8');
 assert.doesNotMatch(engine,/workers[.]dev|function\s+doPost\s*\(|[.]appendRow\s*\(|[.]setValue\s*\(/);
 assert.match(engine,/LINE_AUTO_ENABLED/);
 assert.match(engine,/reminder_days/);
 assert.match(engine,/X-Line-Retry-Key/);
});
