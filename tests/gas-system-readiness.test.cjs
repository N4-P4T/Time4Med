/** Offline ADMIN software readiness report: no Google/LINE side effects.
 * Run: node tests/gas-system-readiness.test.cjs
 */
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const src=fs.readFileSync('apps-script/Code.gs','utf8');
const start=src.indexOf('function getSystemReadiness(');
const end=src.indexOf('function readImage(',start);
assert.ok(start>=0&&end>start,'ADMIN readiness function must exist');
const piece=src.slice(start,end);
for(const dangerous of ['writeRow_(', 'lineTo_(', 'UrlFetchApp.', 'DriveApp.',
   'setProperty(', 'newTrigger(', 'postDevice_('])
 assert.equal(piece.includes(dangerous),false,'read-only readiness must not invoke '+dangerous);
let role='ADMIN',real=[],devices=[],images=[],line={};
const ctx={
 JSON,Date,Array,Boolean,Number,String,
 session_:()=>({role}),needAdmin_:u=>{if(u.role!=='ADMIN')throw Error('ADMIN_ONLY')},
 bootstrap:()=>({medicines:real,devices,backendVersion:'2026-11-03-readiness-1'}),
 schedulableMedicine_:m=>!!(m.active&&!m.demo&&m.kind==='scheduled'&&m.patientId),
 inspectLineReminderReadiness_:()=>line,
 grid_:name=>{assert.equal(name,'ImageIndex');return{rows:images.map(data=>({data}))}},
 props_:()=>({getProperty:name=>name==='IMAGE_FOLDER_ID'?'folder-configured':''}),
 active_:x=>x===true,
 str_:x=>String(x==null?'':x).trim(),
 upper_:x=>String(x||'').toUpperCase(),
 tzNow_:()=> '2026-11-03 21:48:00'
};
vm.runInNewContext(piece+'\nthis.check=getSystemReadiness;',ctx);
real=[
 {id:'TEST_P001',active:true,demo:true,kind:'scheduled',patientId:'P001'},
 {id:'MED1',active:false,demo:false,kind:'scheduled',patientId:'P001'}
];
line={enabled:false,triggerCount:0,tokenConfigured:true,uniqueLineDestinations:0,
 dueCandidates:[]};
let report=ctx.check('admin-test');
assert.equal(report.readOnly,true);
assert.equal(report.schedules.eligibleCount,0);
assert.equal(report.schedules.demoExcludedCount,1);
assert.equal(report.devices.s3.online,false);
assert.equal(report.devices.camera.online,false);
assert.equal(report.line.enabled,false);
assert.ok(report.checklist.some(c=>c.id==='realSchedules'&&!c.passed));
assert.ok(report.checklist.some(c=>c.id==='scheduleApplied'&&!c.passed));
assert.ok(report.checklist.some(c=>c.id==='lineEnabled'&&!c.passed));
assert.ok(report.checklist.some(c=>c.id==='driveFolder'&&c.passed));
assert.doesNotMatch(JSON.stringify(report),/folder-configured|Bearer|U[a-f0-9]{32}/);
role='CAREGIVER';
assert.throws(()=>ctx.check('caregiver-test'),/ADMIN_ONLY/,
 'caregiver cannot access system details');
role='ADMIN';
real=[{id:'MED1',active:true,demo:false,kind:'scheduled',patientId:'P001'}];
devices=[
 {id:'S3-001',online:'ONLINE',scheduleSync:'VERIFIED',lastSeen:'2026-11-03 21:48:00'},
 {id:'CAM-001',online:'ONLINE',lastSeen:'2026-11-03 21:48:00'}
];
line={enabled:true,triggerCount:1,tokenConfigured:true,uniqueLineDestinations:1,
 dueCandidates:[{recipientCount:1}]};
images=[{available:true,drive_file_id:'private-image-id'}];
report=ctx.check('admin-test');
assert.equal(report.schedules.eligibleCount,1);
assert.equal(report.line.uncoveredSchedules,0);
assert.equal(report.images.storedInDriveCount,1);
assert.equal(report.checklist.filter(c=>!c.passed).length,0);
line.dueCandidates=[{recipientCount:0}];
report=ctx.check('admin-test');
assert.equal(report.line.uncoveredSchedules,1);
assert.ok(report.checklist.some(c=>c.id==='lineRecipients'&&!c.passed));
console.log('PASS: ADMIN-only readiness, no writes, demo excluded, LINE and device gates, no secret leakage');
