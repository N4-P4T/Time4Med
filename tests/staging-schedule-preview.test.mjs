import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const core = require('../test-v021/schedule-contract.js');
const html = readFileSync(new URL('../staging-google-login/index.html',import.meta.url),'utf8');
const source = readFileSync(new URL('../staging-google-login/schedule-preview.js',import.meta.url),'utf8');

assert.match(html,/id="t26SchedulePanel"/);
assert.match(html,/\.\.\/test-v021\/schedule-contract\.js/);
assert.match(html,/\.\/schedule-preview\.js/);
assert.doesNotMatch(source,/\.publish\s*\(|\/command\/schedule|\/schedule\/commit|\/api\/device\/telemetry/);
assert.doesNotMatch(source,/localStorage|sessionStorage|setInsecure|GCP_PRIVATE_KEY|DEVICE_STATUS_HMAC_KEY/);
assert.match(source,/auth\.api\('\/api\/patients'\)/);
assert.match(source,/auth\.api\('\/api\/medicines'\)/);

const elements = new Map();
function el(id) {
  if(!elements.has(id)) elements.set(id,{
    id,hidden:false,disabled:false,textContent:'',children:[],listeners:{},
    addEventListener(name,handler){this.listeners[name]=handler;},
    replaceChildren(...nodes){this.children=nodes;},
    append(child){this.children.push(child);}
  });
  return elements.get(id);
}
const handlers = {};
const paths = [];
const model={
  patients:[], medicines:[]
};
const auth = {
  user:null,
  async api(path){
    paths.push(path);
    if(path==='/api/patients')return {patients:model.patients};
    if(path==='/api/medicines')return {medicines:model.medicines};
    throw Error('unexpected route');
  }
};
const win={
  Time4MedScheduleContract:core,Time4MedAuth:auth,
  addEventListener(event,handler){handlers[event]=handler;}
};
vm.runInNewContext(source,{
 document:{getElementById:el,createElement:tag=>({tag,textContent:''})},
 window:win,Promise,String
},{filename:'schedule-preview.js'});
const flush=async()=>{await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));};
const login=user=>{
 auth.user=user;
 handlers['time4med-auth-changed']({detail:{user}});
};
const click=()=>el('t26RefreshSchedule').listeners.click();
assert.equal(el('t26SchedulePanel').hidden,true,'logged out panel hidden');

login({role:'ADMIN'});
await flush();
assert.equal(el('t26SchedulePanel').hidden,false);
assert.match(el('t26ScheduleState').textContent,/ยังไม่มีข้อมูล/);
assert.equal(el('t26PatientCount').textContent,'0');
assert.equal(el('t26SlotCount').textContent,'0');

model.patients=[{id:'P001',name:'TEST ONLY',status:'ACTIVE'}];
model.medicines=[
  {id:'m1',patientId:'P001',kind:'scheduled',boxNumber:'1',mealType:2,time:'08:30'},
  {id:'m2',patientId:'P001',kind:'scheduled',boxNumber:'1',mealType:2,time:'08:30'},
  {id:'m3',patientId:'P001',kind:'prn',boxNumber:'1',mealType:'prn',time:''}
];
click();await flush();
assert.match(el('t26ScheduleState').textContent,/ตรวจรูปแบบผ่าน 1 รอบ/);
assert.equal(el('t26MedicineCount').textContent,'3');
assert.equal(el('t26SlotCount').textContent,'1');
assert.equal(el('t26ScheduleSlots').children.length,1);
assert.match(el('t26ScheduleSlots').children[0].textContent,/P001.*ช่อง 1.*08:30.*AFTER_BREAKFAST/);
assert.match(el('t26ScheduleIssues').children.map(x=>x.textContent).join(' '),/PRN/);

model.medicines=[{id:'m4',patientId:'P001',kind:'scheduled',boxNumber:'2',mealType:2,time:'08:30'}];
click();await flush();
assert.match(el('t26ScheduleState').textContent,/ตารางยามีข้อผิดพลาด 1 รายการ/);
assert.match(el('t26ScheduleIssues').children[0].textContent,/กล่อง 1/);

const originalApi=auth.api;
auth.api=async()=>{throw Error('test backend unavailable');};
click();await flush();
assert.match(el('t26ScheduleState').textContent,/อ่านตารางยาไม่สำเร็จ/);
assert.equal(el('t26PatientCount').textContent,'—');
auth.api=originalApi;

// A request returned after logout must not repopulate patient data.
let release;
auth.api=path=>new Promise(resolve=>{if(path==='/api/patients')release=resolve;else resolve({medicines:model.medicines});});
click();
login(null);
release({patients:model.patients});
await flush();
assert.equal(el('t26SchedulePanel').hidden,true);
assert.equal(el('t26MedicineCount').textContent,'—');
assert.equal(el('t26ScheduleSlots').children[0].textContent,'ยังไม่มีข้อมูล');
assert(paths.length>0 && paths.every(p=>p==='/api/patients'||p==='/api/medicines'));
console.log('PASS: live-authorized read only, no data, duplicate rounds, PRN, box mismatch, API error and logout safety');
