const assert=require('node:assert/strict');
const fs=require('node:fs');
const core=require('../test-v021/schedule-contract.js');

function medicine(id,patientId,time,mealType,boxNumber,kind='scheduled',stockStatus='ok'){
 return {id,patientId,time,mealType,boxNumber,kind,stockStatus,name:'Test medicine'};
}
const allowed=['P001','P002','P003'];
const normal=core.evaluate([
 medicine('a','P001','08:30',2,'1'),
 medicine('b','P001','08:30',2,'1'),
 medicine('c','P002','18:30',6,'2'),
 medicine('d','P003','20:00',7,'3'),
 medicine('e','P001','',2,'1','prn')
],allowed);
assert.equal(normal.ok,true);
assert.equal(normal.slots.length,3,'same patient,meal,time combines medications');
assert.equal(normal.prnSkipped,1);
assert.deepEqual(normal.slots.map(s=>s.command),
 ['SET|U001|08:30|AFTER_BREAKFAST','SET|U002|18:30|AFTER_DINNER','SET|U003|20:00|BEDTIME']);
assert.equal(normal.topic,'time4med/v1/cabinet/cabinet-01/command/schedule');
assert.equal(core.LIMIT,18);
assert.equal(core.evaluate([medicine('a','P002','18:30',6,'1')],allowed).issues.some(i=>i.code==='WRONG_BOX'),true);
assert.equal(core.evaluate([medicine('a','P001','24:12',1,'1')],allowed).ok,false);
assert.equal(core.evaluate([medicine('a','P001','08:00',99,'1')],allowed).ok,false);
assert.equal(core.evaluate([medicine('a','P004','09:30',2,'4')],['P004']).issues.some(i=>i.code==='NOT_MAPPED'),true);
assert.equal(core.evaluate([medicine('a','P002','18:30',6,'2')],['P001']).ok,false,'out of scope rows must not be silently ignored');
assert.equal(core.evaluate(null,allowed).ok,false);
assert.equal(core.evaluate([],null).ok,false);
const large=Array.from({length:19},(_,i)=>medicine('x'+i,'P001',
  String(Math.floor(i/60)).padStart(2,'0')+':'+String(i%60).padStart(2,'0'),
  2,'1'));
assert.equal(core.evaluate(large,allowed).issues.some(i=>i.code==='CAPACITY'),true);
const snap={
 complete:true,deviceVerified:true,capturedAt:Date.now(),
 entries:normal.slots.map(s=>({user_id:s.userId,compartment:s.compartment,time:s.time,meal:s.meal}))
};
assert.equal(core.compareVerifiedSnapshot(normal,snap).status,'MATCH');
assert.equal(core.compareVerifiedSnapshot(normal,{...snap,complete:false}).status,'NOT_VERIFIED');
assert.equal(core.compareVerifiedSnapshot(normal,{...snap,capturedAt:Date.now()-130000}).status,'NOT_VERIFIED');
assert.equal(core.compareVerifiedSnapshot(normal,{...snap,entries:snap.entries.slice(0,2)}).status,'DIFFERENT');
assert.equal(core.compareVerifiedSnapshot(normal,{...snap,entries:[...snap.entries,{...snap.entries[0]}]}).status,'INVALID_DEVICE');

const ui=fs.readFileSync('test-v021/schedule-review.js','utf8');
const page=fs.readFileSync('test-v021/index.html','utf8');
const protectedConfig=fs.readFileSync('test-v019/auth-config.js','utf8');
assert.match(page,/src="schedule-contract\.js"/);
assert.match(page,/src="schedule-review\.js(?:\?[^"]*)?"/);
assert.doesNotMatch(page,/src="\.\.\/test-v019\/schedule-sync\.js"/);
assert.doesNotMatch(ui,/\.\s*publish\s*\(|\.\s*subscribe\s*\(|mqtt\.connect|client\.connect|command\/lock/,'review must never call MQTT');
assert.doesNotMatch(ui,/setInsecure|fetch\s*\(/);
assert.match(protectedConfig,/TIME4MED_SECURE_MODE\s*=\s*true/);
assert.doesNotMatch(ui,/innerHTML\s*=\s*.*(?:row\.name|row\.patient)/,'no untrusted medicine names in html');

console.log('PASS: Time4Med read-only schedule contract + patient/meal/box safety (no MQTT writes).');
