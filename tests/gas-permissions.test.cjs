/** Isolated security regression tests; no network, Sheets, LINE or Drive calls. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../apps-script/Code.gs'),'utf8');
function ctx(extra={}) {
  const sandbox={console,Date,JSON,Set,Map,Math,Number,String,Boolean,Array,RegExp,Error,Object,parseInt,isNaN,...extra};
  const context=vm.createContext(sandbox);
  vm.runInContext(source,context,{filename:'Code.gs'});
  const run=s=>vm.runInContext(s,context);
  return {run,context};
}
let c=ctx();
c.run(`grid_=()=>({rows:[{data:{email:'enabled@example.org',user_id:'U1',role:'MYSTERY',status:'ACTIVE',patient_id:'P001'}},{data:{email:'legacy@example.org',user_id:'U2',role:'USER',status:'ACTIVE',patient_id:'P001,P003'}}]});`);
assert.equal(c.run(`userForEmail_('enabled@example.org')`),null,'Unknown role must not silently become caregiver');
assert.deepEqual(JSON.parse(JSON.stringify(c.run(`userForEmail_('legacy@example.org').patientIds`))),['P001','P003']);
assert.equal(c.run(`userForEmail_('legacy@example.org').role`),'CAREGIVER');

c=ctx();
c.run(`session_=()=>({id:'U1',email:'user@example.org',role:'CAREGIVER',patientIds:['P001']});`);
assert.throws(()=>c.run(`saveMedicine('fake',{patientId:'P002',name:'Medicine',mealType:2,time:'08:00'})`),/เฉพาะแอดมิน/);
assert.throws(()=>c.run(`saveUser('fake',{email:'other@example.org',role:'ADMIN',status:'ACTIVE'})`),/เฉพาะแอดมิน/);
assert.throws(()=>c.run(`testLine('fake')`),/เฉพาะแอดมิน/);

c=ctx({LockService:{getScriptLock(){return {waitLock(){},releaseLock(){}}}}});
c.run(`
  session_=()=>({id:'ADMIN1',email:'admin@example.org',role:'ADMIN',patientIds:['P001','P002','P003']});
  grid_=()=>({rows:[{index:5,data:{email:'caregiver@example.org',user_id:'U2',role:'USER',patient_id:'P001',status:'ACTIVE'}},{index:6,data:{email:'admin@example.org',user_id:'ADMIN1',role:'ADMIN',patient_id:'ALL',status:'ACTIVE'}}]});
  let written=null;
  writeRow_=(g,row,val)=>{written=val};
  logActivity_=()=>{};
  stamp_=()=> '2026-10-29T00:00:00.000Z';
`);
assert.throws(()=>c.run(`saveUser('fake',{email:'caregiver@example.org',role:'CAREGIVER',patientIds:'P002',status:'SUSPENDED'})`),/สถานะบัญชีไม่ถูกต้อง/);
assert.equal(c.run(`saveUser('fake',{email:'caregiver@example.org',role:'CAREGIVER',patientIds:'P002',status:'DISABLED'}).ok`),true);
assert.equal(c.run(`written.status`),'INACTIVE');
assert.equal(c.run(`written.role`),'CAREGIVER');
assert.equal(c.run(`written.patient_id`),'P002');
assert.throws(()=>c.run(`saveUser('fake',{email:'admin@example.org',role:'ADMIN',patientIds:'ALL',status:'DISABLED'})`),/ไม่สามารถลดสิทธิ์หรือปิดบัญชีแอดมินของตัวเอง/);

c=ctx({LockService:{getScriptLock(){throw Error('LINE trigger must not run while disabled');}}});
c.run(`props_=()=>({getProperty:()=>null});`);
assert.equal(c.run(`scheduledLineReminders_()`),undefined);
c=ctx();
c.run(`props_=()=>({getProperty:()=>null});grid_=()=>{throw Error('Image cleanup must not run while disabled')}`);
assert.equal(c.run(`monthlyImageCleanup_()`),undefined);

c=ctx({Utilities:{base64Decode(){return [0,0,0,...Array(200).fill(0)]}},DriveApp:{getFolderById(){throw Error('Never create Drive file for invalid JPEG')}}});
c.run(`deviceAuthenticated_=()=>true;`);
assert.throws(()=>c.run(`postDevice_({postData:{contents:JSON.stringify({action:'image',deviceKey:'test',patientId:'P001',jpegBase64:'A'.repeat(210)})}})`),/IMAGE_NOT_JPEG/);

const html=fs.readFileSync(path.join(__dirname,'../apps-script/Index.html'),'utf8');
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/ig)].map(x=>x[1]);
for(const js of scripts) new vm.Script(js);
assert.match(html,/String\(x\.kind\)\.toUpperCase\(\)!=='PRN'/,'PRN needs filtering');
assert.match(html,/u\.status==='ACTIVE'\?'ACTIVE':'INACTIVE'/,'Legacy DISABLED must render inactive');
console.log('OK: strict roles, permissions, legacy user statuses, reminder/retention guards, JPEG checks, frontend syntax');