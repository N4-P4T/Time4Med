import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const core=require('../test-v021/schedule-contract.js');

const html=readFileSync(new URL('../staging-google-login/index.html',import.meta.url),'utf8');
const src=readFileSync(new URL('../staging-google-login/medicine-editor.js',import.meta.url),'utf8');
const base='https://time4med-api-staging.napat-kaewboonpan.workers.dev';
assert.match(html,/id="t27EditorPanel"/);
assert.match(html,/id="t27Form"/);
assert.match(html,/\.\/medicine-editor\.js/);
assert.match(html,/ข้อมูลจำลองเท่านั้น/);
assert.match(src,/\.api\(editing\?'\/api\/medicines\/'/);
assert.doesNotMatch(src,/\.publish\s*\(|\/(command\/schedule|schedule\/commit|api\/device\/telemetry)|localStorage|sessionStorage|setInsecure|GCP_PRIVATE_KEY|DEVICE_STATUS_HMAC_KEY/);

const nodes=new Map();
function node(id){
 if(!nodes.has(id))nodes.set(id,{
  id,value:'',hidden:true,disabled:false,textContent:'',dataset:{},options:[],listeners:{},
  replaceChildren(){this.options=[];this.value='';},
  append(child){this.options.push(child);if(this.options.length===1)this.value=child.value;},
  addEventListener(name,listener){this.listeners[name]=listener;}
 });
 return nodes.get(id);
}
const events={};const calls=[];
const fixtures=[
 {id:'DEMO-MED-001',patientId:'P001',patient:'ผู้สูงอายุจำลอง P001',name:'รายการยา DEMO A',
  kind:'scheduled',mealType:2,time:'08:30',boxNumber:'1',active:true,updatedAt:'2026-10-18T17:39:34Z',stockStatus:'unchecked',instruction:'STAGING'},
];
let medicines=[...fixtures];
const people=[{id:'P001',name:'ผู้สูงอายุจำลอง P001',status:'ACTIVE'}];
let next=2,blocked=false;
const auth={user:null,async api(path,opts={}) {
 calls.push({path,method:opts.method||'GET',body:opts.body});
 if(path==='/api/patients'&&(!opts.method||opts.method==='GET'))return {patients:people};
 if(path==='/api/medicines'&&(!opts.method||opts.method==='GET'))return {medicines:[...medicines]};
 if(blocked)throw Error('backend unavailable');
 if(path==='/api/medicines'&&opts.method==='POST'){
   const item={...opts.body,id:'DEMO-NEW-'+next++,updatedAt:'2026-10-19T00:00:00Z',active:true};
   medicines.push(item);return {medicine:item};
 }
 if(path.startsWith('/api/medicines/')&&opts.method==='PUT'){
   const id=decodeURIComponent(path.split('/').at(-1)),old=medicines.find(m=>m.id===id);
   if(!old||old.updatedAt!==opts.body.updatedAt)throw Error('409 conflict');
   Object.assign(old,opts.body,{updatedAt:'2026-10-19T00:01:00Z'});
   return {medicine:old};
 }
 throw Error('unexpected API '+path);
}};
let refreshes=0;
node('t26RefreshSchedule').click=()=>{refreshes++};
const win={
 Time4MedAuth:auth,Time4MedScheduleContract:core,TIME4MED_AUTH_CONFIG:{apiBase:base},confirm:()=>true,
 addEventListener(n,h){events[n]=h}
};
const doc={getElementById:node,createElement:()=>({value:'',textContent:''})};
vm.runInNewContext(src,{document:doc,window:win,Promise,Number,String,Array,Error,encodeURIComponent},{filename:'medicine-editor.js'});
const settle=()=>new Promise(done=>setImmediate(done));
const flush=async()=>{for(let i=0;i<5;i++)await settle()};
const login=user=>{auth.user=user;events['time4med-auth-changed']({detail:{user}})};
async function submit() {
 const fn=node('t27Form').listeners.submit;
 fn({preventDefault(){}});
 await flush();
}
assert.equal(node('t27EditorPanel').hidden,true);
assert.equal(node('t27Save').disabled,true);

login({role:'CAREGIVER'});
await flush();
assert.equal(node('t27EditorPanel').hidden,true,'caregivers cannot use staging demo editor');

login({role:'ADMIN'});
await flush();
assert.equal(node('t27EditorPanel').hidden,false);
assert.equal(node('t27Save').disabled,false);
assert.equal(node('t27Existing').options.length,2,'existing demo medication available');
assert.equal(node('t27Patient').options[0].value,'P001');

node('t27MedicineName').value='รายการทดสอบใหม่';
node('t27Meal').value='7';
node('t27Time').value='21:30';
await submit();
assert.equal(medicines.length,2);
assert.equal(medicines[1].patientId,'P001');
assert.equal(medicines[1].boxNumber,'1');
assert.equal(medicines[1].mealType,7);
assert.equal(medicines[1].time,'21:30');
assert.match(node('t27Message').textContent,/บันทึกและอ่านกลับ/);
assert.equal(refreshes,1);
assert.equal(node('t27Patient').disabled,true,'existing record cannot be reassigned');

// Now edit that record using API optimistic-concurrency timestamp.
node('t27MedicineName').value='รายการทดสอบที่แก้ไข';
node('t27Time').value='22:00';
await submit();
assert.equal(medicines.length,2,'edit must not append a new row');
assert.equal(medicines[1].name,'รายการทดสอบที่แก้ไข');
assert.equal(medicines[1].time,'22:00');
const writes=calls.filter(x=>x.method!=='GET');
assert.equal(writes.length,2);
assert.equal(writes[0].method,'POST');
assert.equal(writes[1].method,'PUT');
assert.equal(writes[1].body.updatedAt,'2026-10-19T00:00:00Z');
assert.equal(refreshes,2);

// Invalid form data never reaches POST/PUT.
node('t27Time').value='28:00';
await submit();
assert.equal(calls.filter(x=>x.method!=='GET').length,2);
assert.match(node('t27Message').textContent,/เวลาไม่ถูกต้อง/);

// A failed write cannot be claimed successful or blindly retried.
node('t27Time').value='22:15';
blocked=true;
await submit();
assert.equal(calls.filter(x=>x.method!=='GET').length,3);
assert.match(node('t27Message').textContent,/ยังยืนยันผลการบันทึกไม่ได้/);
blocked=false;

// Logout hides data, clears options and disables saving.
login(null);
assert.equal(node('t27EditorPanel').hidden,true);
assert.equal(node('t27Save').disabled,true);
assert.equal(node('t27Existing').options.length,1);

// Guard against erroneous production Worker configuration.
win.TIME4MED_AUTH_CONFIG.apiBase='https://time4med-api.napat-kaewboonpan.workers.dev';
login({role:'ADMIN'});
await flush();
assert.equal(node('t27EditorPanel').hidden,true);
assert.equal(node('t27Save').disabled,true);
console.log('PASS: staging-only demo editor; ADMIN role, create, edit, readback, UTC revision, failed write, invalid time and logout');
