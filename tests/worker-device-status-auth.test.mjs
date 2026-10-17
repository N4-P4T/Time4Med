/* Offline Cloudflare Worker authorization test.
 * Mock Google public certificates, one isolated fake Sheets user and KV;
 * no production keys, emails, servers or ESP32 needed.
 */
import assert from 'node:assert/strict';
import {generateKeyPairSync,createPublicKey,sign,createHmac} from 'node:crypto';
import worker from '../backend/worker-v025-device-status.mjs';
const google=generateKeyPairSync('rsa',{modulusLength:2048});
const service=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk=createPublicKey(google.privateKey).export({format:'jwk'});
jwk.kid='test-google-public-key';jwk.alg='RS256';jwk.use='sig';
const secret=Buffer.from(Array.from({length:32},(_,i)=>i+17));
const kv={
  values:new Map(),
  async get(key){return this.values.get(key)??null;},
  async put(key,value){this.values.set(key,value);}
};
const env={
  ALLOWED_ORIGIN:'https://n4-p4t.github.io',
  GOOGLE_CLIENT_ID:'test-client.apps.googleusercontent.com',
  SPREADSHEET_ID:'FAKE-SHEET-ID',
  GCP_CLIENT_EMAIL:'service@example.invalid',
  GCP_PRIVATE_KEY:service.privateKey.export({format:'pem',type:'pkcs8'}).toString(),
  DEVICE_STATUS_KV:kv,
  DEVICE_STATUS_HMAC_KEY:secret.toString('hex')
};
const users=[
 ['U-001','admin@example.invalid','Admin','ADMIN','ALL','','','ACTIVE'],
 ['U-002','caregiver@example.invalid','Caregiver','CAREGIVER','P001','','','ACTIVE'],
 ['U-003','unassigned@example.invalid','No cabinet patient','CAREGIVER','P099','','','ACTIVE']
];
const requestLog=[];
globalThis.fetch=async(input,init={})=>{
 const url=new URL(typeof input==='string'?input:input.url);
 requestLog.push(url.hostname);
 if(url.hostname==='www.googleapis.com'&&url.pathname==='/oauth2/v3/certs')
  return Response.json({keys:[jwk]});
 if(url.hostname==='oauth2.googleapis.com'&&url.pathname==='/token')
  return Response.json({access_token:'FAKE_TOKEN'});
 if(url.hostname==='sheets.googleapis.com'){
  if(decodeURIComponent(url.pathname).includes('Users'))
   return Response.json({values:users});
  throw Error('Unexpected external sheet '+url.pathname);
 }
 throw Error('Unexpected external host '+url.hostname);
};
const b64=b=>Buffer.from(b).toString('base64url');
function googleJwt(email,aud=env.GOOGLE_CLIENT_ID){
 const now=Math.floor(Date.now()/1000);
 const header=b64(JSON.stringify({alg:'RS256',kid:jwk.kid,typ:'JWT'}));
 const payload=b64(JSON.stringify({iss:'https://accounts.google.com',aud,sub:'unit-'+email,
   email,email_verified:true,iat:now,exp:now+1800,name:'Unit Test'}));
 const unsigned=header+'.'+payload;
 return unsigned+'.'+b64(sign('RSA-SHA256',Buffer.from(unsigned),google.privateKey));
}
async function query(path,{email,method='GET',headers={},body,origin=env.ALLOWED_ORIGIN,aud}={}){
 const h=new Headers(headers);h.set('Origin',origin);
 if(email)h.set('Authorization','Bearer '+googleJwt(email,aud));
 const response=await worker.fetch(new Request('https://t4m.example.invalid'+path,{method,headers:h,body}),env);
 const data=await response.json().catch(()=>({}));
 return {status:response.status,data,headers:response.headers};
}
const endpoint='/api/devices/status';
let r=await query(endpoint);assert.equal(r.status,401);
r=await query(endpoint,{email:'missing@example.invalid'});assert.equal(r.status,403);
r=await query(endpoint,{email:'caregiver@example.invalid'});
assert.equal(r.status,200,JSON.stringify(r.data));
assert.equal(r.data.state,'NO_DATA');
r=await query(endpoint,{email:'unassigned@example.invalid'});assert.equal(r.status,403);
r=await query(endpoint,{email:'caregiver@example.invalid',aud:'wrong-client'});
assert.equal(r.status,401);
r=await query(endpoint,{email:'admin@example.invalid',origin:'https://attack.example'});
assert.equal(r.status,403);
const payload={device_id:'ESP32S3-01',online:true,door_status:'CLOSED',
 lock_status:'LOCKED',emergency:false,rtc_valid:true,system_state:'IDLE',reason:'periodic'};
const raw=JSON.stringify(payload),ts=String(Math.floor(Date.now()/1000)),nonce='12341234123412341234123412341234';
const signed=['T4M-STATUS-V1','/api/device/telemetry',ts,nonce,raw].join('\n');
const mac=createHmac('sha256',secret).update(signed).digest('hex');
r=await query('/api/device/telemetry',{method:'POST',headers:{
 'X-T4M-Timestamp':ts,'X-T4M-Nonce':nonce,'X-T4M-Signature':mac,'Content-Type':'application/json'},body:raw});
assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.stored,true);
r=await query(endpoint,{email:'caregiver@example.invalid'});
assert.equal(r.status,200,JSON.stringify(r.data));
assert.equal(r.data.state,'LIVE');
assert.equal(r.data.telemetry.door_status,'CLOSED');
assert.equal(r.data.telemetry.lock_status,'LOCKED');
assert.equal(r.headers.get('Cache-Control'),'no-store');
assert.equal(r.headers.get('Access-Control-Allow-Origin'),env.ALLOWED_ORIGIN);
r=await query('/api/device/telemetry',{method:'POST',headers:{
 'X-T4M-Timestamp':ts,'X-T4M-Nonce':nonce,'X-T4M-Signature':mac,'Content-Type':'application/json'},body:raw});
assert.equal(r.status,409,'replay must be rejected');
r=await query('/api/device/telemetry',{method:'POST',body:raw,headers:{'Content-Type':'application/json'}});
assert.equal(r.status,401,'unauthenticated device cannot inject status');
const stored=JSON.parse(kv.values.get('telemetry:cabinet-01'));
stored.received_at=new Date(Date.now()-200000).toISOString();
kv.values.set('telemetry:cabinet-01',JSON.stringify(stored));
r=await query(endpoint,{email:'admin@example.invalid'});
assert.equal(r.data.state,'STALE');assert.equal('telemetry' in r.data,false);
assert.equal(requestLog.some(x=>x.includes('hivemq')),false);
console.log('PASS: signed Google authorization and server-side patient scope, authenticated telemetry, no stale data, no MQTT');
