/** Time4Med: offline intake audit integrity regression.
 * Run: node tests/intake-audit-integrity.cjs
 * Never writes to Google Sheets or sends messages to LINE.
 */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const src=fs.readFileSync('apps-script/Code.gs','utf8');
const activityStart=src.indexOf('function logActivity_(');
const activityEnd=src.indexOf('\nfunction scheduleDaysIntersect_',activityStart);
const deviceStart=src.indexOf('function postDevice_(');
const deviceEnd=src.indexOf('\nfunction doPost(',deviceStart);
assert.ok(activityStart>=0&&activityEnd>activityStart,'audit helper must exist');
assert.ok(deviceStart>=0&&deviceEnd>deviceStart,'device endpoint must exist');
let counter=0;
const activities=[],intakes=[];
const ctx={
 JSON,Number,String,Array,Date,Error,Object,Boolean,Math,
 Utilities:{getUuid:()=>('mock-event-'+(++counter))},
 grid_:name=>({name,rows:[]}),
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
 safeMedicine_:()=>({}),deviceScheduleSnapshot_:()=>[],
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
assert.equal(Object.hasOwn(intakes[0],'medicine_id'),false,
 'cannot invent individual pill identification');
console.log('PASS: device intake links to audit ID; schedule time is not fabricated');
