/* No live LINE messages or Google Sheet writes. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync('apps-script/Code.gs','utf8');
const start=src.indexOf('function uniqueLineRecipients_(users) {');
const end=src.indexOf('\n/**',start+1);
assert.ok(start>=0&&end>start,'recipient dedupe helper must be present');
const sandbox={};
vm.runInNewContext(src.slice(start,end)+'\nthis.unique=uniqueLineRecipients_;',sandbox);
const users=[
 {id:'U001',lineId:'line-A',patientIds:['P001']},
 {id:'ADM-PROJECT',lineId:'line-A',patientIds:['P001','P002']},
 {id:'U003',lineId:'line-B',patientIds:['P002']},
 {id:'U004',lineId:'',patientIds:['P001']}
];
assert.equal(sandbox.unique(users).length,2,'duplicate line ID and empty destination suppressed');
assert.equal(sandbox.unique(users.filter(u=>u.patientIds.includes('P001'))).length,1,'one send to P001');
assert.equal(sandbox.unique(users.filter(u=>u.patientIds.includes('P002'))).length,2,'two distinct permitted destinations P002');
assert.match(src, /items\.forEach\(\(\{m,slot\}\)=>/,
  'each due medicine must preserve its matched scheduled date');
assert.match(src, /uniqueLineRecipients_\(users\.filter\(u=>can_\(u,m\.patientId\)\)\)/,
  'authorization before deduplicating and sending');
assert.match(src, /const key='T4M-'\+slot\.date/,
  'daily dedupe key must use the scheduled date, including midnight rollover');
const inspectStart=src.indexOf('function inspectLineReminderReadiness_()');
const inspectEnd=src.indexOf('\nfunction notificationLog_',inspectStart);
assert.ok(inspectStart>=0&&inspectEnd>inspectStart);
const inspect=src.slice(inspectStart,inspectEnd);
for(const forbidden of ['lineTo_(', 'writeRow_(', 'notificationLog_(', 'setProperty('])
 assert.equal(inspect.includes(forbidden),false,'read-only diagnostic cannot call '+forbidden);
const entryStart=src.indexOf('function inspectLineReminderReadiness()');
const entryEnd=src.indexOf('function inspectLineReminderReadiness_()',entryStart);
assert.ok(entryStart>=0&&entryEnd>entryStart,'must have editor-selectable entry point');
const ctx={
  Session:{getActiveUser:()=>({getEmail:()=>''})},
  inspectLineReminderReadiness_:()=>({enabled:false}),
  Error
};
vm.runInNewContext(src.slice(entryStart,entryEnd)+'\nthis.run=inspectLineReminderReadiness;',ctx);
assert.throws(()=>ctx.run(),/Only the Time4Med owner/,'anonymous webapp request denied');
ctx.Session={getActiveUser:()=>({getEmail:()=> 'stranger@example.com'})};
assert.throws(()=>ctx.run(),/Only the Time4Med owner/,'nonowner denied');
ctx.Session={getActiveUser:()=>({getEmail:()=> 'time4med.project@gmail.com'})};
assert.equal(ctx.run().enabled,false,'owner can run read-only diagnostic');
// Trigger jitter: never require an exact-minute hit. These are pure offline
// checks and must not call LINE, Google services, or create Sheet records.
const slotStart=src.indexOf('function recentLineDueSlots_(');
const slotEnd=src.indexOf('function scheduledLineReminders_(',slotStart);
assert.ok(slotStart>=0&&slotEnd>slotStart,'jitter helper must exist');
const dateFormat=(date,tz,pattern)=>{
 const fields=new Intl.DateTimeFormat('en-GB',{
  timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',hourCycle:'h23',hour12:false,weekday:'short'
 }).formatToParts(date);
 const part=k=>fields.find(x=>x.type===k)?.value;
 if(pattern==='u')return String(
  ['MON','TUE','WED','THU','FRI','SAT','SUN'].indexOf(part('weekday').toUpperCase())+1);
 if(pattern==='HH:mm')return part('hour')+':'+part('minute');
 if(pattern==='yyyy-MM-dd')return part('year')+'-'+part('month')+'-'+part('day');
 throw Error('Unsupported test date format');
};
const timerSandbox={
 Date,Number,Array,isNaN,Error,
 T4M:{tz:'Asia/Bangkok'},
 Utilities:{formatDate:dateFormat},
 assert_:(condition,msg)=>{if(!condition)throw Error(msg)}
};
vm.runInNewContext(src.slice(slotStart,slotEnd)+'\nthis.due=recentLineDueSlots_;',timerSandbox);
const current=timerSandbox.due(new Date('2026-11-03T01:04:30Z'),4);
assert.ok(current.some(x=>x.date==='2026-11-03'&&x.day==='TUE'
  &&x.time==='08:00'&&x.delayMinutes===4),'8am due can be caught 4 minutes late');
assert.equal(current.some(x=>x.time==='07:59'),false,'5+ minutes old cannot be resent');
const midnight=timerSandbox.due(new Date('2026-11-03T17:02:10Z'),4);
assert.ok(midnight.some(x=>x.date==='2026-11-03'&&x.time==='23:59'
  &&x.day==='TUE'),'late 23:59 due retains previous day');
assert.equal(timerSandbox.due(new Date('2026-11-03T01:06:00Z'),4)
 .some(x=>x.time==='08:00'),false,'6+ minutes late is outside grace window');
assert.throws(()=>timerSandbox.due(new Date(),6),/INVALID_LINE_GRACE_WINDOW/);
assert.match(src,/const seen=new Set\(grid_\('NotificationLog'\)/,
 'already attempted reminder IDs must suppress duplicate sends');
console.log('PASS: LINE grace window, calendar rollover and idempotent dated attempts');

console.log('PASS: LINE recipient dedupe, read-only diagnostic and owner-only editor entry point');