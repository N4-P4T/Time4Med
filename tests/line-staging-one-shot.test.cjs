const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');

const root='integrations/line-apps-script/';
const source=['Code.gs','SheetPreview.gs','ReminderPreview.gs','ReminderLink.gs',
 'AutoReminder.gs','StagingReminder.gs'].map(f=>fs.readFileSync(root+f,'utf8')).join('\n\n');
const target='U'+'c'.repeat(32),stageId='S'.repeat(35),productionId='P'.repeat(35);
const STAGE_TITLE='Time4Med_LINE_STAGING_2026-10-28';
const HEAD=['record_id','patient','name','kind','meal_type','shelf','box_number',
 'reminder_time','instruction','stock_status','status_updated_at','created_at',
 'updated_at','is_active','source','patient_id','reminder_days'];
const USER_HEAD=['user_id','email','display_name','role','patient_id','line_user_id',
 'notification_enabled','status','created_at','updated_at'];
const makeSheet=rows=>({
 rows,
 getLastColumn(){return Math.max(...rows.map(row=>row.length));},
 getLastRow(){return rows.length;},
 getRange(row,col,height=1,width=1) {
  return {
   getDisplayValues:()=>rows.slice(row-1,row-1+height).map(r=>
    Array.from({length:width},(_,j)=>r[col+j-1]==null?'':String(r[col+j-1]))),
   setValue:value=>{rows[row-1][col-1]=value;}
  };
 }
});
function fmtBangkok(date){
 const dtf=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Bangkok',
  year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',
  hourCycle:'h23'});
 const p=dtf.formatToParts(date);
 const v=n=>p.find(part=>part.type===n).value;
 return v('year')+v('month')+v('day')+'|'+v('hour')+':'+v('minute');
}
function create(opts={}) {
 let nowEpoch=Date.parse('2026-10-28T06:51:00Z');
 const med=[HEAD,[
  'STAGING_01','P001','TEST_P001','scheduled','2','1','1','',
  'ข้อมูลจำลองเท่านั้น ไม่ใช่คำสั่งให้รับประทานยา',
  'STAGING','','','','TRUE','STAGING_ONLY','P001',''
 ]];
 const users=[
  ['STAGING title'],['notice'],[],USER_HEAD,
  ['STAGING_ADMIN_01','','STAGING','ADMIN','ALL','','TRUE','ACTIVE','','']
 ];
 if(opts.modifyMed)opts.modifyMed(med);
 if(opts.modifyUser)opts.modifyUser(users);
 const sheets={MealMedicines:makeSheet(med),Users:makeSheet(users)};
 const props=new Map(Object.entries({
  TIME4MED_SHEET_ID:productionId,
  LINE_STAGING_SHEET_ID:stageId,
  LINE_TEST_USER_ID:target,
  LINE_CHANNEL_ACCESS_TOKEN:'faketoken-for-tests-abcdefghijk000',
  ...opts.properties
 }));
 let stageTitle=opts.stageTitle||STAGE_TITLE;
 let quota=opts.quota??0;
 let networkOutcome=opts.outcome||200;
 const network=[],sheetOpens=[],triggers=[];
 const scriptProps={
  getProperty:key=>props.has(key)?props.get(key):null,
  setProperty:(key,val)=>props.set(key,String(val)),
  setProperties:map=>Object.entries(map).forEach(([k,v])=>props.set(k,String(v))),
  getProperties:()=>Object.fromEntries(props.entries()),
  deleteProperty:key=>props.delete(key)
 };
 const spreadsheet={
  getName:()=>stageTitle,
  getSheetByName:name=>sheets[name]||null
 };
 const context={
  Date:class FakeDate extends Date {
   constructor(...args){super(...(args.length?args:[nowEpoch]));}
   static now(){return nowEpoch;}
  },
  PropertiesService:{getScriptProperties:()=>scriptProps},
  SpreadsheetApp:{openById:id=>{
   sheetOpens.push(id);
   if(id!==stageId)throw Error('Unexpected spreadsheet read '+id);
   return spreadsheet;
  },flush:()=>{}},
  Utilities:{
   formatDate:(date,zone,fmt)=>{
    assert.equal(zone,'Asia/Bangkok');
    assert.equal(fmt,'yyyyMMdd|HH:mm');
    return fmtBangkok(date);
   },
   getUuid:()=> '9def977f-5949-4bb9-b9f8-3390c32ba627'
  },
  LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
  ScriptApp:{
   getProjectTriggers:()=>triggers,
   newTrigger:handler=>({
    timeBased:()=>({
     everyMinutes:interval=>({
      create:()=>triggers.push({handler,interval,getHandlerFunction:()=>handler})
     })
    })
   }),
   deleteTrigger:t=>{const i=triggers.indexOf(t);if(i>=0)triggers.splice(i,1);}
  },
  UrlFetchApp:{fetch:(url,req={})=>{
   network.push({url,req});
   if(url.endsWith('/message/quota'))return response(200,{type:'limited',value:300});
   if(url.endsWith('/message/quota/consumption'))return response(200,{totalUsage:quota});
   if(url.endsWith('/message/push')){
    if(networkOutcome==='THROW')throw Error('Timeout might still have delivered');
    return response(networkOutcome,{});
   }
   throw Error('Unexpected HTTP destination '+url);
  }},
  console:{log:()=>{}}
 };
 vm.runInNewContext(source,context,{timeout:3500});
 function response(status,body){
  return {getResponseCode:()=>status,getContentText:()=>JSON.stringify(body)};
 }
 return {context,props,sheets,stageTitle,network,triggers,sheetOpens,
  advanceToDue(extraMs=20000){nowEpoch=Number(props.get('LINE_STAGING_DUE_TS'))+extraMs;},
  advanceMs(ms){nowEpoch+=ms;},
  setQuota(n){quota=n;},
  get pushes(){return network.filter(n=>n.url.endsWith('/message/push'));}
 };
}
test('stage inspection reads isolated sheet, does not send or write',()=>{
 const t=create();
 const before=JSON.stringify(t.sheets);
 const r=t.context.checkTime4MedStaging();
 assert.equal(r.mode,'READ_ONLY_NO_LINE_SEND');
 assert.equal(r.testRecipientConfigured,true);
 assert.equal(r.currentState,'NOT_ARMED');
 assert.equal(r.armConfirmed,false);
 assert.equal(t.pushes.length,0);
 assert.equal(t.triggers.length,0);
 assert.equal(JSON.stringify(t.sheets),before);
 assert.ok(t.sheetOpens.every(x=>x===stageId));
});
test('arming without explicit confirmation fails closed',()=>{
 const t=create();
 assert.throws(()=>t.context.armTime4MedStagingOnce(),/ARM_NOT_CONFIRMED/);
 assert.equal(t.triggers.length,0);
 assert.equal(t.sheets.MealMedicines.rows[1][7],'');
 assert.equal(t.pushes.length,0);
});
test('one-shot trigger follows staged sheet, tests planner, sends only to owner and cleans up',()=>{
 const t=create({properties:{LINE_STAGING_ARM_CONFIRM:'YES'}});
 const armed=t.context.armTime4MedStagingOnce();
 assert.equal(armed.mode,'ARMED_ONE_SHOT');
 assert.equal(armed.testOnly,true);
 assert.equal(t.triggers.length,1);
 assert.equal(t.triggers[0].handler,'runTime4MedStagingOnce');
 assert.equal(t.triggers[0].interval,1);
 assert.equal(t.sheets.MealMedicines.rows[1][7],armed.dueBangkokTime);
 assert.equal(t.sheets.MealMedicines.rows[1][16],t.props.get('LINE_STAGING_DAY'));
 // original TEST name remains in the sheet
 assert.equal(t.sheets.MealMedicines.rows[1][2],'TEST_P001');
 assert.equal(t.sheets.Users.rows[4][5],'');
 assert.equal(t.context.runTime4MedStagingOnce().mode,'WAITING');
 assert.equal(t.pushes.length,0);
 t.advanceToDue();
 const sent=t.context.runTime4MedStagingOnce();
 assert.equal(sent.mode,'API_ACCEPTED');
 assert.equal(sent.deliveryConfirmed,false);
 assert.equal(t.pushes.length,1);
 const body=JSON.parse(t.pushes[0].req.payload);
 assert.equal(body.to,target);
 assert.equal(body.messages.length,1);
 assert.match(body.messages[0].text,/ทดสอบ/);
 assert.match(body.messages[0].text,/ไม่ใช่การแจ้งให้รับประทานยาจริง/);
 assert.ok(body.messages[0].text.includes('https://n4-p4t.github.io/Time4Med/'));
 assert.equal(body.messages[0].quickReply.items[0].action.uri,
  'https://n4-p4t.github.io/Time4Med/');
 assert.equal(t.triggers.length,0);
 assert.equal(t.props.get('LINE_STAGING_STATE'),'API_ACCEPTED');
 assert.equal(t.context.runTime4MedStagingOnce().mode,'NOT_ARMED_NO_SEND');
 assert.equal(t.pushes.length,1);
 assert.throws(()=>t.context.armTime4MedStagingOnce(),/ALREADY_ARMED_OR_ATTEMPTED/);
});
test('staging ID equal to production is always refused',()=>{
 const t=create({properties:{LINE_STAGING_SHEET_ID:productionId,
  LINE_STAGING_ARM_CONFIRM:'YES'}});
 assert.throws(()=>t.context.armTime4MedStagingOnce(),/NOT_ISOLATED/);
 assert.equal(t.sheetOpens.length,0);
 assert.equal(t.triggers.length,0);
});
test('wrong staging spreadsheet name cannot be used to send',()=>{
 const t=create({stageTitle:'Time4Med_DB',
  properties:{LINE_STAGING_ARM_CONFIRM:'YES'}});
 assert.throws(()=>t.context.armTime4MedStagingOnce(),/TITLE_MISMATCH/);
 assert.equal(t.pushes.length,0);
 assert.equal(t.triggers.length,0);
});
test('non-TEST medicine name fails staging sentinel guard',()=>{
 const t=create({modifyMed:rows=>{rows[1][2]='ยาจริง';},
  properties:{LINE_STAGING_ARM_CONFIRM:'YES'}});
 assert.throws(()=>t.context.armTime4MedStagingOnce(),/SENTINEL_MISMATCH/);
 assert.equal(t.triggers.length,0);
});
test('wrong user scope or embedded user ID is blocked',()=>{
 const t=create({modifyUser:rows=>{rows[4][5]=target;},
  properties:{LINE_STAGING_ARM_CONFIRM:'YES'}});
 assert.throws(()=>t.context.armTime4MedStagingOnce(),/SENTINEL_MISMATCH/);
 assert.equal(t.triggers.length,0);
});
test('send at due after quota usage reaches cap is blocked',()=>{
 const t=create({properties:{LINE_STAGING_ARM_CONFIRM:'YES'}});
 t.context.armTime4MedStagingOnce();
 t.advanceToDue();
 t.setQuota(250);
 const result=t.context.runTime4MedStagingOnce();
 assert.equal(result.mode,'QUOTA_BLOCKED_NO_SEND');
 assert.equal(t.triggers.length,0);
 assert.equal(t.pushes.length,0);
});
test('network error is recorded and never retried automatically',()=>{
 const t=create({outcome:'THROW',properties:{LINE_STAGING_ARM_CONFIRM:'YES'}});
 t.context.armTime4MedStagingOnce();
 t.advanceToDue();
 const result=t.context.runTime4MedStagingOnce();
 assert.equal(result.mode,'REVIEW_REQUIRED');
 assert.equal(t.pushes.length,1);
 assert.equal(t.triggers.length,0);
 assert.equal(t.props.get('LINE_STAGING_STATE'),'REVIEW_REQUIRED');
 assert.equal(t.context.runTime4MedStagingOnce().mode,'NOT_ARMED_NO_SEND');
 assert.equal(t.pushes.length,1);
});
test('expired late trigger never sends',()=>{
 const t=create({properties:{LINE_STAGING_ARM_CONFIRM:'YES'}});
 t.context.armTime4MedStagingOnce();
 t.advanceToDue(8*60000);
 const result=t.context.runTime4MedStagingOnce();
 assert.equal(result.mode,'EXPIRED_NO_SEND');
 assert.equal(t.triggers.length,0);
 assert.equal(t.pushes.length,0);
});
test('stop removes only staging trigger and preserves production send controls',()=>{
 const t=create({properties:{LINE_STAGING_ARM_CONFIRM:'YES',LINE_AUTO_ENABLED:'YES'}});
 t.context.armTime4MedStagingOnce();
 t.triggers.push({getHandlerFunction:()=>'runTime4MedReminders'});
 const result=t.context.stopTime4MedStaging();
 assert.equal(result.stagingTriggersRemoved,1);
 assert.equal(t.triggers.length,1);
 assert.equal(t.props.get('LINE_AUTO_ENABLED'),'YES');
 assert.equal(t.context.runTime4MedStagingOnce().mode,'NOT_ARMED_NO_SEND');
 assert.equal(t.pushes.length,0);
});
test('when disabled, staging code has no live production notification shortcuts',()=>{
 const file=fs.readFileSync(root+'StagingReminder.gs','utf8');
 assert.match(file,/LINE_STAGING_ARM_CONFIRM/);
 assert.match(file,/t4mLinkedReminderPayload_\('P001',slot[.]time,true\)/);
 assert.match(file,/getProperty\('LINE_TEST_USER_ID'\)/);
 assert.doesNotMatch(file,/setProperty\('LINE_AUTO_(?:ENABLED|SEND_ENABLED)'/);
});
