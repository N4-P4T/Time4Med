/** Offline test for admin-only demo: MUST NOT persist to Sheets or Drive. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../apps-script/Code.gs'),'utf8');
const storage=new Map();
const CacheService={getScriptCache:()=>({
  get(key){return storage.get(key)||null;},
  put(key,value){storage.set(key,String(value));},
  remove(key){storage.delete(key);}
})};
const LockService={getScriptLock:()=>({waitLock(){},releaseLock(){}})};
let seq=0;
const Utilities={
  getUuid(){return 'demo-id-'+(++seq);},
  formatDate(){return '2026-10-29 13:30:00';},
  base64Decode(s){return Array.from(Buffer.from(s,'base64'));}
};
const sandbox={console,Date,JSON,Set,Map,Math,Number,String,Boolean,Array,RegExp,Error,Object,parseInt,isNaN,
  CacheService,LockService,Utilities};
const context=vm.createContext(sandbox);
vm.runInContext(source,context,{filename:'Code.gs'});
const run=s=>vm.runInContext(s,context);
run([
  "let lineMessages=[];",
  "session_=()=>({id:'ADM-DEMO',email:'admin@example.org',name:'Admin',role:'ADMIN',patientIds:['P001','P002','P003'],lineId:'line-demo-id'});",
  "deviceAuthenticated_=key=>key==='device-key-for-test';",
  "props_=()=>({getProperty:k=>k==='DEMO_DEVICE_ID'?'S3-001':null});",
  "lineTo_=(recipient,message)=>lineMessages.push({recipient,message});",
  "grid_=()=>{throw Error('Demo must not read Sheets after session validation');};",
  "writeRow_=()=>{throw Error('Demo MUST NOT write to Google Sheets');};",
  "logActivity_=()=>{throw Error('Demo MUST NOT log activity');};",
  "notificationLog_=()=>{throw Error('Demo MUST NOT persist LINE logs');};",
  "db_=()=>{throw Error('Demo MUST NOT access database');};"
].join('\n'));
const round=s=>JSON.parse(JSON.stringify(run(s)));
assert.equal(round('getDemoStatus("token")').status,'IDLE');
let result=round('startDemo("token",{patientId:"P002",mealType:6,sendLine:true})');
assert.equal(result.status,'WAITING');assert.equal(result.patientId,'P002');
assert.equal(result.shelf,2);assert.equal(result.lineStatus,'PENDING');
const id=result.id;
assert.throws(()=>run('startDemo("token",{patientId:"P003"})'),/กำลังทำงาน/);
const event=p=>round('postDevice_({postData:{contents:'+JSON.stringify(JSON.stringify(p))+'}})');
const base={deviceKey:'device-key-for-test',deviceId:'S3-001',demoId:id};
assert.throws(()=>event({action:'demoPoll',deviceKey:'incorrect',deviceId:'S3-001'}),/DEVICE_KEY_INVALID/);
assert.throws(()=>event({action:'demoPoll',deviceKey:'device-key-for-test',deviceId:'CAM-01'}),/DEMO_DEVICE_NOT_AUTHORIZED/);
const poll=event({action:'demoPoll',deviceKey:base.deviceKey,deviceId:base.deviceId});
assert.equal(poll.command,'START_DEMO');assert.equal(poll.patientId,'P002');
assert.equal(poll.mealType,6);assert.equal(poll.demoOnly,true);
assert.throws(()=>event({...base,action:'demoEvent',phase:'COMPLETE'}),/DEMO_STEPS_INCOMPLETE/);
const steps=['RECEIVED','REMINDER_STARTED','VOICE_DONE','LOCK_OPENED','DOOR_OPENED',
  'DOOR_CLOSED','CONFIRMED','PHOTO_CAPTURED'];
for(const phase of steps)assert.equal(event({...base,action:'demoEvent',phase}).ok,true);
assert.equal(round('getDemoStatus("token")').steps.length,8);
const jpeg=Buffer.from([255,216,255,...Array(150).fill(12)]).toString('base64');
assert.equal(event({...base,action:'demoPhoto',jpegBase64:jpeg}).temporary,true);
assert.equal(round('getDemoStatus("token")').photoAvailable,true);
assert.equal(run('getDemoPreview("token",'+JSON.stringify(id)+')').slice(0,23),'data:image/jpeg;base64,');
result=event({...base,action:'demoEvent',phase:'COMPLETE'});
assert.equal(result.status,'DONE');
result=round('getDemoStatus("token")');
assert.equal(result.steps.length,9);assert.equal(result.lineStatus,'SENT');
assert.equal(run('lineMessages.length'),1);
assert.match(run('lineMessages[0].message'),/\[Time4Med DEMO\]/);
assert.equal(event({action:'demoPoll',deviceKey:base.deviceKey,deviceId:base.deviceId}).command,'NONE');
assert.throws(()=>event({...base,action:'demoEvent',phase:'COMPLETE'}),/DEMO_NOT_ACTIVE/);
run("session_=()=>({id:'CG-DEMO',role:'CAREGIVER',patientIds:['P001']});");
assert.throws(()=>run("startDemo('token',{})"),/เฉพาะแอดมิน/);
assert.throws(()=>run("getDemoStatus('token')"),/เฉพาะแอดมิน/);
assert.throws(()=>run("cancelDemo('token')"),/เฉพาะแอดมิน/);
assert.throws(()=>run("getDemoPreview('token','"+id+"')"),/เฉพาะแอดมิน/);
run("session_=()=>({id:'ADM',role:'ADMIN',patientIds:['P001','P002','P003'],lineId:''});");
result=round("startDemo('token',{patientId:'P001',mealType:2,sendLine:false})");
assert.equal(result.lineStatus,'SKIPPED');
assert.equal(round('cancelDemo("token")').status,'STOPPED');
assert.equal(event({action:'demoPoll',deviceKey:base.deviceKey,deviceId:base.deviceId}).command,'STOP_DEMO');
assert.throws(()=>event({...base,action:'demoEvent',demoId:result.id,phase:'RECEIVED'}),/DEMO_NOT_ACTIVE/);
result=round("startDemo('token',{patientId:'P003',mealType:7,sendLine:false})");
run('const expired=readDemo_();expired.expiresAt=Date.now()-10;saveDemo_(expired);');
assert.equal(round('getDemoStatus("token")').status,'TIMED_OUT');
assert.equal(event({action:'demoPoll',deviceKey:base.deviceKey,deviceId:base.deviceId}).command,'STOP_DEMO');
console.log('OK: demo authorized, real device events, no Sheets/Drive writes, stop/timeout, photo preview, optional LINE, replay prevention');
