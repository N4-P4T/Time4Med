/* Offline regression tests. NEVER connects to LINE or Google. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync('apps-script/Time4Med_LINE_Alerts_20261113.gs','utf8');
assert.doesNotMatch(src,/function\s+(doPost|doGet)\s*\(/,'Never replace deployed routing');
assert.doesNotMatch(src,/MailApp\.sendEmail/,'LINE-only service must not send Gmail');
new vm.Script(src,{filename:'Time4Med_LINE_Alerts_20261113.gs'});
const dateFormat=(date,tz,pattern)=>{
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:tz,
    year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',
    weekday:'short',hourCycle:'h23'}).formatToParts(date);
  const field=(key)=>parts.find(x=>x.type===key)?.value;
  if(pattern==='yyyy-MM-dd')return field('year')+'-'+field('month')+'-'+field('day');
  if(pattern==='yyyy-MM')return field('year')+'-'+field('month');
  if(pattern==='yyyy-MM-dd HH:mm:ss')return field('year')+'-'+field('month')+'-'+field('day')+
    ' '+field('hour')+':'+field('minute')+':00';
  if(pattern==='u')return String(['MON','TUE','WED','THU','FRI','SAT','SUN']
    .indexOf(field('weekday').toUpperCase())+1);
  throw Error('bad pattern '+pattern);
};
const sandbox={Date,Set,Number,String,Array,Object,Math,JSON,console,
  Utilities:{formatDate:dateFormat,computeDigest:()=>Array(32).fill(171)}};
vm.runInNewContext(src,sandbox);
assert.equal(sandbox.t4mlParse_('2026-11-12 16:30:40'),Date.parse('2026-11-12T16:30:40+07:00'));
const mockLog=[
 {data:{channel:'LINE',sent_at:'2026-11-13 08:00:00',delivery_status:'SENT'}},
 {data:{channel:'LINE',sent_at:'2026-11-13 09:00:00',delivery_status:'ATTEMPTED'}},
 {data:{channel:'LINE',sent_at:'2026-11-13 10:00:00',delivery_status:'FAILED'}},
 {data:{channel:'LINE',sent_at:'2026-10-13 09:00:00',delivery_status:'SENT'}}
];
assert.equal(sandbox.t4mlSentThisMonth_(mockLog,new Date('2026-11-13T10:00:00Z')),2,
 'Only current-month committed/attempted sends count toward conservative internal limit');
const users=[{role:'ADMIN',patients:['P001','P002','P003']},
 {role:'CAREGIVER',patients:['P001']},{role:'CAREGIVER',patients:['P002']}];
assert.equal(sandbox.t4mlRecipients_(users,'P001').length,2);
assert.equal(sandbox.t4mlRecipients_(users,'ALL').length,3);
const now=new Date('2026-11-14T01:03:00Z'),started=Date.parse('2026-11-14T00:00:00Z');
const meds=[{data:{record_id:'M-001',patient_id:'P001',name:'ตัวอย่างยาจำลองแบบปกติ',
  kind:'scheduled',is_active:'TRUE',reminder_time:'08:00',reminder_days:'SAT'}}];
const dueKey='T4M-2026-11-14-'+sandbox.t4mlSha_('M-001:U001').slice(0,14);
const data={'MealMedicines':meds,'IntakeLog':[],
 'NotificationLog':[{data:{channel:'LINE',message_type:'MEDICINE_DUE',
   delivery_status:'SENT',notification_id:dueKey}}]};
sandbox.t4mlTable_=(name)=>({rows:data[name]||[]});
const calls=[];sandbox.t4mlSendOnce_=(ctx,key,p,u,kind,message)=>{
  calls.push({key,p,kind,message});
  ctx.ids.add(key);return true;
};
const ctx={now,users:[{id:'U001',lineId:'line-1',role:'ADMIN',patients:['P001','P002','P003']}],
  log:{rows:data.NotificationLog},ids:new Set(),sent:1,limit:250};
sandbox.t4mlUnconfirmed_(ctx,started);
assert.equal(calls.length,1,'Unconfirmed alert after due+2min');
assert.equal(calls[0].kind,'MEDICINE_UNCONFIRMED');
calls.length=0;
data.IntakeLog=[{data:{patient_id:'P001',status:'CONFIRMED',confirmed_at:'2026-11-14 08:01:00'}}];
sandbox.t4mlUnconfirmed_(ctx,started);
assert.equal(calls.length,0,'Do not report no-confirm when intake is already acknowledged');
data.IntakeLog=[];data.MealMedicines[0].data.record_id='QA-20261114-P001';
sandbox.t4mlUnconfirmed_(ctx,started);
assert.equal(calls.length,0,'QA demo rows must not send misleading no-confirm warnings');
console.log('PASS: LINE-only addon parses timestamps, checks monthly log count, patient permission, 2-minute no-ack and QA exclusions');
