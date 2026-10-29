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
assert.throws(()=>c.run(`saveMedicine('fake',{patientId:'P002',name:'Medicine',mealType:2,time:'08:00'})`),/ไม่มีสิทธิ์/);
assert.throws(()=>c.run(`saveUser('fake',{email:'other@example.org',role:'ADMIN',status:'ACTIVE'})`),/เฉพาะแอดมิน/);
assert.throws(()=>c.run(`testLine('fake')`),/เฉพาะแอดมิน/);


/* Caregivers may manage prescriptions on their assigned shelves only.
 * Validate both the target patientId and the original record patientId.
 * All of these tests exercise server methods directly, bypassing the web UI.
 */
let med=ctx({
  LockService:{getScriptLock(){return {waitLock(){},releaseLock(){}}}},
  Utilities:{getUuid(){return 'test-med-uuid'}}
});
med.run(`
  const medicationRows=[
    {index:2,data:{record_id:'OWN',patient_id:'P001',name:'Existing own med'}},
    {index:3,data:{record_id:'OTHER',patient_id:'P002',name:'Existing other med'}}
  ];
  let medicationWrites=[];
  session_=()=>({id:'CG001',email:'cg@example.org',role:'CAREGIVER',patientIds:['P001']});
  grid_=(name)=>name==='MealMedicines'?{rows:medicationRows}:
    name==='Patients'?{rows:[
      {data:{patient_id:'P001',display_name:'Patient 1'}},
      {data:{patient_id:'P002',display_name:'Patient 2'}}]}:{rows:[]};
  writeRow_=(g,rowIndex,data)=>medicationWrites.push({rowIndex,data});
  logActivity_=()=>{};
  stamp_=()=> '2026-10-29T00:00:00.000Z';
`);
const medicine=(id,patientId)=>({id,patientId,name:'Sample medicine',mealType:2,time:'08:05',days:'MON',active:false});
assert.equal(med.run(`saveMedicine('token',${JSON.stringify(medicine('', 'P001'))}).ok`),true,'Caregiver may create medicine on own shelf');
assert.equal(med.run(`medicationWrites[0].data.patient_id`),'P001');
assert.equal(med.run(`medicationWrites[0].data.is_active`),'FALSE');
assert.equal(med.run(`saveMedicine('token',${JSON.stringify(medicine('OWN','P001'))}).ok`),true,'Caregiver may edit existing own medicine');
assert.equal(med.run(`medicationWrites[1].rowIndex`),2);
assert.equal(med.run(`disableMedicine('token','OWN').ok`),true,'Caregiver may disable medicine on own shelf');
assert.throws(()=>med.run(`saveMedicine('token',${JSON.stringify(medicine('','P002'))})`),/ไม่มีสิทธิ์/,'Cannot create for P002');
assert.throws(()=>med.run(`saveMedicine('token',${JSON.stringify(medicine('OTHER','P001'))})`),/ไม่มีสิทธิ์/,'Cannot steal P002 record by moving to P001');
assert.throws(()=>med.run(`saveMedicine('token',${JSON.stringify(medicine('OWN','P002'))})`),/ไม่มีสิทธิ์/,'Cannot move P001 record to P002');
assert.throws(()=>med.run(`disableMedicine('token','OTHER')`),/ไม่มีสิทธิ์/,'Cannot disable P002');
med.run(`session_=()=>({id:'ADM',role:'ADMIN',patientIds:['P001','P002','P003']});`);
assert.equal(med.run(`saveMedicine('token',${JSON.stringify(medicine('OTHER','P002'))}).ok`),true,'Admin may edit any patient medicine');

// One physical cabinet can assign all P001–P003 to one CAREGIVER.
med.run(`session_=()=>({id:'CG-ALL3',email:'all3@example.org',role:'CAREGIVER',patientIds:['P001','P002','P003']});`);
for(const patient of ['P001','P002','P003']){
  assert.equal(med.run(`saveMedicine('token',${JSON.stringify(medicine('',patient))}).ok`),true,
    'One caregiver should create medicines for '+patient);
}
assert.equal(med.run(`saveMedicine('token',${JSON.stringify(medicine('OTHER','P002'))}).ok`),true,
  'Multi-assigned caregiver should edit P002');
assert.equal(med.run(`disableMedicine('token','OTHER').ok`),true,
  'Multi-assigned caregiver should disable P002');
assert.throws(()=>med.run(`saveMedicine('token',${JSON.stringify(medicine('', 'P004'))})`),
  /P001–P003/, 'Fourth personal shelf must not exist');
assert.throws(()=>med.run(`saveUser('token',{email:'not-allowed@example.org',role:'ADMIN',status:'ACTIVE'})`),
  /เฉพาะแอดมิน/, 'Multi-assigned caregiver is still not an admin');

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
assert.match(html,/function canManageMedicines\(\)/,'Web must permit caregivers to manage medicines');
assert.ok(html.includes("data.patients.map(({id:p,shelf})"),'Patient selection must derive from scoped server data');
console.log('OK: strict roles, per-patient caregiver create/edit/disable, three-patient caregiver, cross-patient denial, legacy statuses, reminder/retention guards, JPEG checks, frontend syntax');