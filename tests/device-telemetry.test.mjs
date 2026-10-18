import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {deviceTelemetryPost,deviceTelemetryGet} from '../backend/device-telemetry.mjs';

const secret=Buffer.from(Array.from({length:32},(_,i)=>i*7+1));
const env={
 DEVICE_STATUS_HMAC_KEY:secret.toString('hex'),
 DEVICE_STATUS_KV:{
   data:new Map(),
   async get(key){return this.data.get(key)??null;},
   async put(key,value){this.data.set(key,value);}
 }
};
const root='https://worker.test.invalid';
const payload={device_id:'ESP32S3-01',online:true,door_status:'CLOSED',
 lock_status:'LOCKED',emergency:false,rtc_valid:true,system_state:'IDLE',reason:'periodic'};
let counter=0;
function req(data=payload,overrides={}){
 const raw=JSON.stringify(data),timestamp=String(overrides.timestamp||Math.floor(Date.now()/1000));
 const nonce=overrides.nonce||(++counter).toString(16).padStart(32,'0');
 const signed=['T4M-STATUS-V1','/api/device/telemetry',timestamp,nonce,raw].join('\n');
 const signature=createHmac('sha256',secret).update(signed).digest('hex');
 return new Request(root+'/api/device/telemetry',{method:'POST',body:raw,headers:{
  'X-T4M-Timestamp':timestamp,'X-T4M-Nonce':nonce,
  'X-T4M-Signature':overrides.signature??signature,
  'Content-Type':'application/json'
 }});
}
async function denied(code,callback){
 await assert.rejects(callback,error=>error.status===code,'expected '+code);
}
assert.deepEqual(await deviceTelemetryGet(env,{role:'ADMIN',patients:[]}),
 {state:'NO_DATA',device_id:'ESP32S3-01',received_at:null});
const signed=req();
assert.deepEqual(await deviceTelemetryPost(signed.clone(),env),{ok:true,stored:true});
await denied(409,()=>deviceTelemetryPost(signed.clone(),env));
const current=await deviceTelemetryGet(env,{role:'CAREGIVER',patients:['P001']});
assert.equal(current.state,'LIVE');assert.equal(current.telemetry.lock_status,'LOCKED');
assert.equal(current.telemetry.door_status,'CLOSED');
assert.equal(current.telemetry.emergency,false);
assert.equal('key' in current,false);
assert.equal('nonce' in current,false);
await denied(403,()=>deviceTelemetryGet(env,{role:'CAREGIVER',patients:['P004']}));
await denied(403,()=>deviceTelemetryGet(env,{role:'CAREGIVER',patients:[]}));
await denied(403,()=>deviceTelemetryGet(env,{role:'SUSPENDED',patients:['P001']}));
await denied(401,()=>deviceTelemetryPost(req(payload,{signature:'0'.repeat(64)}),env));
await denied(401,()=>deviceTelemetryPost(req(payload,{timestamp:String(Math.floor(Date.now()/1000)-1000)}),env));
await denied(422,()=>deviceTelemetryPost(req({...payload,emergency:'false'}),env));
await denied(422,()=>deviceTelemetryPost(req({...payload,online:false}),env));
await denied(422,()=>deviceTelemetryPost(req({...payload,device_id:'ESP32-FAKE'}),env));
const last=JSON.parse(await env.DEVICE_STATUS_KV.get('telemetry:cabinet-01'));
last.received_at=new Date(Date.now()-190000).toISOString();
await env.DEVICE_STATUS_KV.put('telemetry:cabinet-01',JSON.stringify(last));
const stale=await deviceTelemetryGet(env,{role:'ADMIN',patients:[]});
assert.equal(stale.state,'STALE');
assert.equal('telemetry' in stale,false,'must never expose outdated lock status');
const badEnv={DEVICE_STATUS_HMAC_KEY:env.DEVICE_STATUS_HMAC_KEY,DEVICE_STATUS_KV:null};
await denied(503,()=>deviceTelemetryPost(req(),badEnv));
await denied(503,()=>deviceTelemetryGet(badEnv,{role:'ADMIN',patients:[]}));
console.log('PASS: ESP32 HMAC telemetry, replay rejection, wrong schema, patient role gating, no stale lock readings');
