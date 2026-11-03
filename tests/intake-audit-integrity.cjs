/** Time4Med: offline intake audit integrity regression.
 * Run: node tests/intake-audit-integrity.cjs
 * Never writes to Google Sheets or sends messages to LINE.
 */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const src=fs.readFileSync('apps-script/Code.gs','utf8');
const activityStart=src.indexOf('function logActivity_(');
const activityEnd=src.indexOf('\nfunction scheduleDaysIntersect_',activityStart);
const deviceStart=src.indexOf('function postDevice_(');
const deviceEnd=src.indexOf('\nfunction doPost(',deviceStart);
assert.ok(activityStart>=0&&activityEnd>activityStart,'audit helper must exist');
assert.ok(deviceStart>=0&&deviceEnd>deviceStart,'device endpoint must exist');
let counter=0;
const activities=[],intakes=[];
let locks=0,releases=0;
const ctx={
 JSON,Number,String,Array,Date,Error,Object,Boolean,Math,
 Utilities:{getUuid:()=>('mock-event-'+(++counter))},
 sha_:text=>crypto.createHash('sha256').update(String(text)).digest('hex'),
 LockService:{getScriptLock:()=>({waitLock(){locks++},releaseLock(){releases++}})},
 grid_:name=>({name,rows:name==='IntakeLog'?intakes.map((d,i)=>({index:i+5,data:d})):
   name==='MealMedicines'?{rows:[{data:{id:'M001',patientId:'P001',active:true,kind:'scheduled',
     mealType:2,time:'08:00',shelf:1}}]}.rows:[]}),
 writeRow_:(g,row,data)=>{
   if(g.name==='ActivityLog')activities.push(data);
   if(g.name==='IntakeLog')intakes.push(data);
 },
 tzNow_:()=> '2026-11-03 17:15:00',
 deviceAuthenticated_:key=>key==='test-key',
 assert_:(ok,message)=>{if(!ok)throw Error(message)},
 fixedShelf_:id=>({P001:1,P002:2,P003:3})[id]||null,
 upper_:v=>String(v||'').trim().toUpperCase(),
 str_:v=>String(v||'').trim(),
 uniqueLineRecipients_:()=>[],
 userForEmail_:()=>null,
 lineTo_:()=>{},
 props_:()=>({getProperty:()=>''}),
 console:{error(){}},
 demoDevicePoll_:()=>({}),demoDeviceEvent_:()=>({}),demoDevicePhoto_:()=>({}),
 safeMedicine_:d=>d,schedulableMedicine_:m=>Boolean(m?.active&&m.id&&m.patientId==='P001'),
 deviceScheduleSnapshot_:()=>[],
 T4M:{tz:'Asia/Bangkok'}
};
vm.runInNewContext(src.slice(activityStart,activityEnd)+
 '\n'+src.slice(deviceStart,deviceEnd)+
 '\nthis.handle=postDevice_;',ctx);
const reply=ctx.handle({postData:{contents:JSON.stringify({
  action:'intake',deviceKey:'test-key',patientId:'P001',deviceId:'S3-001'
})}});
assert.equal(reply.ok,true);
assert.equal(activities.length,1);
assert.equal(intakes.length,1);
assert.equal(activities[0].event_id,intakes[0].event_id,
 'intake event and activity audit must share one real event_id');
assert.equal(activities[0].device_id,'S3-001',
 'device events must identify the ESP32-S3 instead of WEBSITE');
assert.equal(intakes[0].scheduled_at,'',
 'when device has no verified due-event ID, scheduled_at cannot be fabricated');
assert.equal(intakes[0].confirmed_at,'2026-11-03 17:15:00');
assert.equal(intakes[0].patient_id,'P001');
assert.equal(intakes[0].medicine_id,'',
 'without a verified medicine ID the record must not name an individual medicine');
const request=(fields)=>ctx.handle({postData:{contents:JSON.stringify({
 action:'intake',deviceKey:'test-key',patientId:'P001',deviceId:'S3-001',...fields
})}});
const first=request({eventId:'CONFIRM-0001',medicineId:'M001'});
assert.equal(first.duplicate,false);
assert.equal(intakes.length,2);
assert.equal(intakes[1].medicine_id,'M001');
assert.equal(activities[1].event_id,intakes[1].event_id);
const again=request({eventId:'CONFIRM-0001',medicineId:'M001'});
assert.equal(again.duplicate,true,'network retry should be safely deduplicated');
assert.equal(intakes.length,2,'duplicate must not add an IntakeLog row');
assert.equal(activities.length,2,'duplicate must not add an ActivityLog row');
assert.throws(()=>request({eventId:'bad!'}),/INTAKE_EVENT_ID_INVALID/);
assert.throws(()=>request({eventId:'CONFIRM-0002',medicineId:'WRONG'}),/INTAKE_MEDICINE_ID_NOT_AUTHORIZED/);
assert.equal(intakes.length,2,'invalid medicine association must not write an intake row');
assert.equal(locks,releases,'all intake operations must release the script lock');
console.log('PASS: device intake links to audit; stable retry IDs deduplicate; medicine associations validated');
