const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const base = 'integrations/line-apps-script/';
const sources=['Code.gs','SheetPreview.gs','SheetLineDemo.gs','ReminderLink.gs']
 .map(n=>fs.readFileSync(base+n,'utf8')).join('\n');
const token = 'fake-channel-token-only-for-offline-unit-tests';
const userId='U'+'a'.repeat(32);
const url='https://n4-p4t.github.io/Time4Med/';
const heads=['record_id','patient','name','kind','meal_type','shelf',
 'box_number','reminder_time','instruction','stock_status','status_updated_at',
 'created_at','updated_at','is_active','source','patient_id'];
function row(n,patient='P001',box='01',time='17:02',active='TRUE') {
 const result=Array(16).fill('');
 result[0]='id-'+n;result[2]=n;result[3]='scheduled';result[4]='2';
 result[6]=box;result[7]=time;result[13]=active;result[15]=patient;
 return result;
}
function make({properties={},rows=[heads,row('TEST_P001'),row('Vitamin B','P002','02','18:30')],quotaUsed=0,status=200}={}) {
 const props=new Map(Object.entries({
  TIME4MED_SHEET_ID:'a'.repeat(35),
  LINE_CHANNEL_ACCESS_TOKEN:token,
  LINE_TEST_USER_ID:userId,
  ...properties
 }));
 const calls=[], logs=[];
 const context={
  PropertiesService:{getScriptProperties:()=>({
   getProperty:key=>props.get(key)||null,
   setProperty:(key,val)=>{props.set(key,val);}
  })},
  SpreadsheetApp:{openById:(id)=>{
   assert.equal(id,'a'.repeat(35));
   return {getSheetByName:name=>{
    assert.equal(name,'MealMedicines');
    return {
     getLastColumn:()=>heads.length,
     getLastRow:()=>rows.length,
     getRange:(start,firstCol,count,width)=>({
      getDisplayValues:()=>rows.slice(start-1,start-1+count)
       .map(r=>r.slice(firstCol-1,firstCol+width))
     })
    };
   }};
  }},
  UrlFetchApp:{fetch:(address,config={})=>{
   calls.push({address,config});
   const response=(status,body)=>({
    getResponseCode:()=>status,
    getContentText:()=>JSON.stringify(body)
   });
   if(address.endsWith('/message/quota'))
    return response(200,{type:'limited',value:300});
   if(address.endsWith('/message/quota/consumption'))
    return response(200,{totalUsage:quotaUsed});
   if(address.endsWith('/message/push'))return response(status,{});
   throw new Error('Unexpected API call '+address);
  }},
  LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
  Utilities:{getUuid:()=> '123e4567-e89b-42d3-a456-426614174000'},
  console:{log:message=>logs.push(String(message))}
 };
 vm.runInNewContext(sources,context,{timeout:3000});
 return {context,props,calls,logs};
}
test('construct reminder with clickable plain text website and URI action',()=>{
 const t=make();
 const v=t.context.t4mLinkedReminderPayload_('P001','08:00',false);
 assert.equal(v.type,'text');
 assert.match(v.text,/Time4Med.*แจ้งเตือนมื้อยา/);
 assert.match(v.text,/ผู้สูงอายุ: P001/);
 assert.match(v.text,/08:00 น./);
 assert.ok(v.text.includes('👉 '+url));
 assert.equal(v.quickReply.items.length,1);
 assert.equal(v.quickReply.items[0].action.type,'uri');
 assert.equal(v.quickReply.items[0].action.uri,url);
 assert.equal(v.quickReply.items[0].action.label,'เปิดเว็บไซต์');
 assert.doesNotMatch(v.text,/TEST เท่านั้น/);
});
test('demo payload explicitly warns not to take medicine',()=>{
 const t=make();
 const m=t.context.t4mLinkedReminderPayload_('P001','17:02',true);
 assert.match(m.text,/นี่เป็นข้อมูล TEST เท่านั้น/);
 assert.match(m.text,/ไม่ใช่การแจ้งให้รับประทานยาจริง/);
 assert.match(m.text,/Time4Med\//);
});
test('reject invalid person IDs and times',()=>{
 const t=make();
 for(const x of ['P004','ALL','P001?foo=1','']){
  assert.throws(()=>t.context.t4mLinkedReminderPayload_(x,'08:00',true),/PATIENT_INVALID/);
 }
 assert.throws(()=>t.context.t4mLinkedReminderPayload_('P001','25:00',true),/TIME_INVALID/);
 assert.throws(()=>t.context.t4mLinkedReminderPayload_('P001','08:00','false'),/MODE_INVALID/);
});
test('preview uses only TEST record and never sends a message',()=>{
 const t=make();
 const p=t.context.previewLinkedReminderDemo();
 assert.equal(p.mode,'PREVIEW_ONLY');
 assert.equal(p.messageSent,false);
 assert.equal(p.patient,'P001');
 assert.equal(p.reminderTime,'17:02');
 assert.equal(p.website,url);
 assert.ok(p.message.includes(url));
 assert.equal(t.calls.length,0);
 assert.ok(t.logs.every(s=>!s.includes(token)&&!s.includes(userId)));
});
test('fails closed without explicit consent flag',()=>{
 const t=make({properties:{LINE_TEST_CONFIRM:'YES',LINE_SHEET_TEST_CONFIRM:'YES'}});
 assert.throws(()=>t.context.sendLinkedReminderDemoOnce(),/LINE_LINK_TEST_NOT_CONFIRMED/);
 assert.equal(t.calls.length,0);
});
test('one-time linked reminder sends one push and no real medicines',()=>{
 const t=make({properties:{LINE_LINK_TEST_CONFIRM:'YES'}});
 const result=t.context.sendLinkedReminderDemoOnce();
 assert.equal(result.apiAccepted,true);
 assert.equal(result.deliveryConfirmed,false);
 assert.equal(result.websiteIncluded,true);
 assert.equal(result.uriButtonIncluded,true);
 assert.equal(t.props.get('LINE_LINK_TEST_STATE'),'API_ACCEPTED');
 const pushes=t.calls.filter(x=>x.address.endsWith('/message/push'));
 assert.equal(pushes.length,1);
 const body=JSON.parse(pushes[0].config.payload);
 assert.equal(body.to,userId);
 assert.equal(body.messages.length,1);
 assert.equal(body.messages[0].quickReply.items[0].action.uri,url);
 assert.match(body.messages[0].text,/17:02/);
 assert.match(body.messages[0].text,/TEST เท่านั้น/);
 assert.doesNotMatch(body.messages[0].text,/Vitamin B/);
 assert.throws(()=>t.context.sendLinkedReminderDemoOnce(),/LINE_LINK_TEST_ALREADY_ATTEMPTED/);
 assert.equal(t.calls.filter(x=>x.address.endsWith('/message/push')).length,1);
 assert.ok(t.logs.every(s=>!s.includes(token)&&!s.includes(userId)));
});
test('no active TEST records must not send any message',()=>{
 const t=make({properties:{LINE_LINK_TEST_CONFIRM:'YES'},
  rows:[heads,row('Vitamin B','P001','01','08:00')]});
 assert.throws(()=>t.context.sendLinkedReminderDemoOnce(),/LINE_LINK_NO_ELIGIBLE_DEMO/);
 assert.equal(t.calls.length,0);
});
test('quota cap blocks test and keeps state unset',()=>{
 const t=make({properties:{LINE_LINK_TEST_CONFIRM:'YES'},quotaUsed:250});
 assert.throws(()=>t.context.sendLinkedReminderDemoOnce(),/LINE_LINK_QUOTA_GUARD/);
 assert.equal(t.calls.filter(x=>x.address.endsWith('/message/push')).length,0);
 assert.equal(t.props.get('LINE_LINK_TEST_STATE'),undefined);
});
test('HTTP failure marks attempted; no accidental resends',()=>{
 const t=make({properties:{LINE_LINK_TEST_CONFIRM:'YES'},status:429});
 assert.throws(()=>t.context.sendLinkedReminderDemoOnce(),/LINE_LINK_PUSH_HTTP_429/);
 assert.equal(t.props.get('LINE_LINK_TEST_STATE'),'ATTEMPTED');
 assert.throws(()=>t.context.sendLinkedReminderDemoOnce(),/LINE_LINK_TEST_ALREADY_ATTEMPTED/);
});
test('no Cloudflare/cron/webhook/Sheet mutations in link-bearing test',()=>{
 const script=fs.readFileSync(base+'ReminderLink.gs','utf8');
 assert.doesNotMatch(script,/workers[.]dev|ScriptApp[.]newTrigger|[.]appendRow\s*\(|[.]setValue\s*\(|function\s+doPost\s*\(/);
 assert.match(script,/https:\/\/n4-p4t[.]github[.]io\/Time4Med\//);
});
