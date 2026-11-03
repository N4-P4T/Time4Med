/** Offline contract test for ESP32-S3 schedule apply acknowledgments.
 * Run: node tests/gas-schedule-ack.test.cjs
 * Does not connect to Sheets, LINE, GitHub Pages, or real devices.
 */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const source=fs.readFileSync('apps-script/Code.gs','utf8');
const grab=(a,b)=>{
  const start=source.indexOf(a),end=source.indexOf(b,start+1);
  assert.ok(start>=0&&end>start,'function not found: '+a);
  return source.slice(start,end);
};
const code=grab('function deviceScheduleSnapshot_(', 'function writeRow_(')+'\n'+
  grab('function bootstrap(token)', 'function parseDateTime_(')+'\n'+
  grab('function postDevice_(e)', 'function doPost(');
const now='2026-11-03 20:25:00';
const state={
  medicines:[],headers:[
   'device_id','device_type','display_name','mqtt_client_id','firmware_version',
   'online_status','lock_status','last_seen','wifi_rssi_dbm','last_error'
  ],
  devices:[{index:5,data:{
    device_id:'S3-001',device_type:'ESP32_S3',online_status:'ONLINE',
    lock_status:'LOCKED',last_seen:now
  }}],
  headerWrites:[],deviceWrites:[],locks:0,releases:0
};
const fresh=()=>({
 id:'MED001',patientId:'P001',name:'ยา A',mealType:2,meal:'หลังอาหารเช้า',
 time:'08:00',days:'MON,TUE,WED,THU,FRI,SAT,SUN',
 kind:'scheduled',active:true,shelf:1,demo:false
});
state.medicines.push(fresh());
const sheet={
 getRange(row,col){return{setValue(value){state.headerWrites.push({row,col,value})}}}
};
const wrapRows=(rows)=>rows.map((data,i)=>({index:i+5,data}));
const context={
 JSON,Date,Error,Array,Number,String,Map,Set,Object,Boolean,Math,isNaN,console,
 T4M:{tz:'Asia/Bangkok',cols:{Devices:4},patients:{P001:1,P002:2,P003:3}},
 sha_:v=>crypto.createHash('sha256').update(String(v)).digest('hex'),
 fixedShelf_:p=>({P001:1,P002:2,P003:3})[p]||null,
 schedulableMedicine_:m=>Boolean(m.active&&!m.demo&&m.kind!=='PRN'&&m.id),
 mealLedSlot_:n=>n<=2?1:n<=4?2:n<=6?3:4,
 days_:v=>!v||v==='ALL'?'MON,TUE,WED,THU,FRI,SAT,SUN':v,
 safeMedicine_:d=>d,
 deviceAuthenticated_:key=>key==='test-device-key',
 assert_:(value,msg)=>{if(!value)throw Error(msg)},
 str_:v=>String(v==null?'':v).trim(),
 upper_:v=>String(v||'').trim().toUpperCase(),
 LockService:{getScriptLock(){return{
   waitLock(){state.locks++},releaseLock(){state.releases++}
 }}},
 grid_:name=>{
  if(name==='MealMedicines')return {rows:wrapRows(state.medicines)};
  if(name==='Devices')return {keys:state.headers,rows:state.devices,sheet};
  if(name==='Patients')return {rows:[{data:{patient_id:'P001',display_name:'Patient 1',status:'ACTIVE'}}]};
  return {rows:[]};
 },
 writeRow_:(grid,index,value)=>{
  assert.equal(index,5);
  state.deviceWrites.push(value);
  Object.assign(state.devices[0].data,value);
 },
 tzNow_:()=>now,
 session_:()=>({id:'ADMIN',email:'admin@example.com',role:'ADMIN'}),
 can_:()=>true,
 patientIdOf_:d=>d.patient_id,
 deviceFresh_:s=>s===now,
 parseDateTime_:value=>value?new Date(String(value).replace(' ','T')+'+07:00'):new Date('invalid'),
 isoLocal_:value=>String(value),
 publicUser_:u=>({role:u.role,email:u.email}),
 demoDevicePoll_:()=>null,demoDeviceEvent_:()=>null,demoDevicePhoto_:()=>null,
 json_:()=>null
};
vm.runInNewContext(code+'\nthis.api={scheduleManifest_,postDevice_,bootstrap};',context);
const api=context.api;
const send=(message)=>api.postDevice_({postData:{contents:JSON.stringify({
 deviceKey:'test-device-key',deviceId:'S3-001',...message
})}});
const info=()=>api.bootstrap('test-session').devices[0];
const original=api.scheduleManifest_(state.medicines);
assert.equal(original.scheduleCount,1);
assert.match(original.scheduleHash,/^[0-9a-f]{64}$/);
assert.equal(original.schedules[0].ledIndex,0);
assert.equal(info().scheduleSync,'NOT_VERIFIED');
assert.equal(send({action:'heartbeat',lock:'LOCKED'}).scheduleAckAccepted,false);
assert.equal(info().scheduleSync,'NOT_VERIFIED','legacy heartbeats must not verify anything');
const bad=send({action:'heartbeat',bootId:'boot-test-001',
 scheduleApplied:true,scheduleHash:'a'.repeat(64),scheduleCount:1});
assert.equal(bad.scheduleAckAccepted,false);
assert.equal(info().scheduleSync,'NOT_VERIFIED');
assert.equal(state.headerWrites.length,5,'new columns created only for new boot protocol');
const success=send({action:'heartbeat',bootId:'boot-test-001',
 scheduleApplied:true,scheduleHash:original.scheduleHash,scheduleCount:1});
assert.equal(success.scheduleAckAccepted,true);
assert.equal(info().scheduleSync,'VERIFIED');
assert.equal(info().scheduleAckAt,now);
assert.equal(state.headerWrites.length,5,'ack headers never appended twice');
send({action:'heartbeat',bootId:'boot-test-002'});
assert.equal(info().scheduleSync,'NOT_VERIFIED','a reboot invalidates previous apply');
send({action:'heartbeat',bootId:'boot-test-002',
 scheduleApplied:true,scheduleHash:original.scheduleHash,scheduleCount:1});
assert.equal(info().scheduleSync,'VERIFIED');
state.medicines[0].time='09:00';
assert.equal(info().scheduleSync,'NOT_VERIFIED','changing a medicine invalidates the hash');
const newer=api.scheduleManifest_(state.medicines);
assert.notEqual(newer.scheduleHash,original.scheduleHash);
send({action:'heartbeat',bootId:'boot-test-002',
 scheduleApplied:true,scheduleHash:newer.scheduleHash,scheduleCount:1});
assert.equal(info().scheduleSync,'VERIFIED');
state.medicines.length=0;
assert.equal(info().scheduleSync,'NOT_VERIFIED','empty schedule must replace stale cache');
const empty=api.scheduleManifest_(state.medicines);
assert.equal(empty.scheduleCount,0);
assert.equal(empty.schedules.length,0);
assert.notEqual(empty.scheduleHash,newer.scheduleHash);
assert.equal(send({action:'heartbeat',bootId:'boot-test-002',
 scheduleApplied:true,scheduleHash:empty.scheduleHash,scheduleCount:0}).scheduleAckAccepted,true);
assert.equal(info().scheduleSync,'VERIFIED','applied empty schedule can be verified');
assert.throws(()=>send({action:'heartbeat',bootId:'bad!',
 scheduleApplied:true,scheduleHash:empty.scheduleHash,scheduleCount:0}),/BOOT_ID_INVALID/);
assert.throws(()=>send({action:'heartbeat',bootId:'boot-test-002',
 scheduleApplied:true,scheduleHash:'bad',scheduleCount:0}),/SCHEDULE_ACK_HASH_INVALID/);
assert.equal(state.locks,state.releases,'release script locks');
console.log('PASS: S3 schedule digest, boot-scoped apply acknowledgment, empty and changed schedules');
