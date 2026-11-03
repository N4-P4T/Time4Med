/** Offline tests for first-confirmation Q8H planning (NOT production-enabled).
 * Run: node tests/gas-q8h-logic.test.cjs
 * No real reminders, Google Sheets writes or device calls occur here.
 */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const src=fs.readFileSync('apps-script/Code.gs','utf8');
const from=src.indexOf('function q8hPlan_(');
const until=src.indexOf('function notificationLog_(',from);
assert.ok(from>=0&&until>from,'isolated Q8H planner exists');
const lines=src.slice(from,until);
const parse=value=>{
 const x=String(value||'').trim().replace(' ','T');
 return new Date(/(?:Z|[+-]\d{2}:\d{2})$/i.test(x)?x:x+'+07:00');
};
const tzFormat=(date,timezone,pattern)=>{
 assert.equal(timezone,'Asia/Bangkok');
 assert.equal(pattern,'yyyy-MM-dd HH:mm:ss');
 const parts=new Intl.DateTimeFormat('en-GB',{
  timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',hour12:false
 }).formatToParts(date);
 const get=type=>parts.find(p=>p.type===type)?.value;
 return get('year')+'-'+get('month')+'-'+get('day')+' '+
   get('hour')+':'+get('minute')+':'+get('second');
};
const box={Date,Math,Number,isNaN,T4M:{tz:'Asia/Bangkok'},
 parseDateTime_:parse,Utilities:{formatDate:tzFormat}};
vm.runInNewContext(lines+'\nthis.plan=q8hPlan_;this.due=q8hDueInGrace_;',box);
const anchor='2026-11-03 08:10:00';
assert.equal(box.plan(anchor,anchor).nextDueAt,'2026-11-03 16:10:00');
assert.equal(box.plan(anchor,'2026-11-03 16:10:00').nextDueAt,'2026-11-04 00:10:00');
assert.equal(box.plan(anchor,'2026-11-04 00:10:00').nextDueAt,'2026-11-04 08:10:00');
assert.equal(box.due(anchor,'2026-11-03 08:10:00',4),null,'first confirmation not reminder');
assert.equal(box.due(anchor,'2026-11-03 16:10:00',4).stepIndex,1);
assert.equal(box.due(anchor,'2026-11-03 16:14:01',4).stepIndex,1);
assert.equal(box.due(anchor,'2026-11-03 16:15:00',4),null);
assert.equal(box.due(anchor,'2026-11-04 00:10:01',4).stepIndex,2);
assert.equal(box.plan('bad',anchor).ready,false);
assert.equal(box.due(anchor,'2026-11-03 16:10:00',8),null);
const lineStart=src.indexOf('function scheduledLineReminders_(');
const lineEnd=src.indexOf('function setupTriggersFromEditor_(',lineStart);
const deviceStart=src.indexOf('function postDevice_(');
const deviceEnd=src.indexOf('function doPost(',deviceStart);
assert.doesNotMatch(src.slice(lineStart,lineEnd),/q8hPlan_|q8hDueInGrace_/,
 'unfinished mode must NOT send real LINE reminders');
assert.doesNotMatch(src.slice(deviceStart,deviceEnd),/q8hPlan_|q8hDueInGrace_/,
 'unfinished mode must NOT be enabled in S3 schedule delivery');
console.log('PASS: 8-hour first-confirmation planner, midnight, grace and fail-closed production');
