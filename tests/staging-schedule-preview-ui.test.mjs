import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../staging-google-login/index.html',import.meta.url),'utf8');
const code=readFileSync(new URL('../staging-google-login/schedule-preview.js',import.meta.url),'utf8');
const worker=readFileSync(new URL('../backend/worker-v026-staging-schedule-preview-singlefile.mjs',import.meta.url),'utf8');

assert.match(html,/id="t26SchedulePanel"/);
assert.match(html,/\.\/schedule-preview\.js/);
assert.match(code,/Time4MedAuth\.api\('\/api\/cabinets\/cabinet-01\/schedule\/preview'\)/);
assert.doesNotMatch(code,/\bfetch\(|\.publish\(|\/schedule\/commit|\/command\/schedule/);
assert.match(worker,/SCHEDULE_GATEWAY_DISABLED/);
assert.match(worker,/deviceTelemetryPost\(request,env\)/);
assert.doesNotMatch(worker,/mqtt\.connect|mqtt\.publish|client\.publish/);

const els=new Map();
const el=id=>{
 if(!els.has(id))els.set(id,{
  hidden:true,disabled:false,dataset:{},textContent:'',listeners:{},children:[],
  replaceChildren(){this.children=[]},
  appendChild(child){this.children.push(child)},
  addEventListener(n,fn){this.listeners[n]=fn}
 });
 return els.get(id);
};
const events={};
const context={
 document:{getElementById:el,createElement:tag=>({tag,textContent:''})},
 window:{addEventListener:(name,fn)=>{events[name]=fn},Time4MedAuth:{user:null,api:async()=>({preview:{state:'NO_MEDICINES'}})}},
 String,Array,Promise
};
vm.runInNewContext(code,context,{filename:'schedule-preview.js'});
assert.equal(el('t26SchedulePanel').hidden,true);
const flush=()=>new Promise(done=>setImmediate(done));
const login=user=>{context.window.Time4MedAuth.user=user;events['time4med-auth-changed']({detail:{user}})};
login({role:'CAREGIVER'});
assert.equal(el('t26SchedulePanel').hidden,true,'caregiver cannot see full-cabinet preview');
login({role:'ADMIN'});
await flush();await flush();
assert.match(el('t26ScheduleStatus').textContent,/ยังไม่มีรายการยา/);
assert.equal(el('t26ScheduleSlots').textContent,'0');

context.window.Time4MedAuth.api=async()=>({preview:{
 state:'PREVIEW_ONLY',applied:false,acknowledged:false,canCommit:false,
 slots:[{patientId:'P001',compartment:1,time:'08:30',meal:'AFTER_BREAKFAST'}],
 revision16:'0123456789abcdef'}});
el('t26ScheduleRefresh').listeners.click();
await flush();await flush();
assert.equal(el('t26ScheduleSlots').textContent,'1');
assert.match(el('t26ScheduleStatus').textContent,/ยังไม่ส่ง/);
assert.match(el('t26ScheduleList').children[0].textContent,/P001/);

let resolveOld;
context.window.Time4MedAuth.api=()=>new Promise(resolve=>{resolveOld=resolve});
el('t26ScheduleRefresh').listeners.click();
login(null);
assert.equal(el('t26SchedulePanel').hidden,true);
resolveOld({preview:{state:'PREVIEW_ONLY',applied:false,acknowledged:false,canCommit:false,
 slots:[{patientId:'P001',compartment:1,time:'08:30',meal:'AFTER_BREAKFAST'}]}});
await flush();await flush();
assert.equal(el('t26ScheduleList').children.length,0,'logout clears prior data');
assert.equal(el('t26ScheduleSlots').textContent,'—');

login({role:'ADMIN'});
context.window.Time4MedAuth.api=async()=>({preview:{state:'LIVE',applied:true,acknowledged:true,canCommit:true,slots:[]}});
el('t26ScheduleRefresh').listeners.click();
await flush();await flush();
assert.match(el('t26ScheduleStatus').textContent,/ผิดรูปแบบ/);
console.log('PASS: staging schedule UI admin-only read, no commands, empty, valid preview and logout/race protection');
