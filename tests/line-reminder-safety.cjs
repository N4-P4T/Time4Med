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
assert.ok(src.includes('items.forEach(m=>uniqueLineRecipients_(users.filter(u=>can_(u,m.patientId))).forEach(u=>{'),
  'authorization before deduplicating and sending');
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
console.log('PASS: LINE recipient dedupe, read-only diagnostic and owner-only editor entry point');