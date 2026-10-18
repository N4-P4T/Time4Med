/**
 * Time4Med virtual-cabinet E2E, with NO ESP32 hardware, Cloudflare account,
 * HiveMQ password, Google account or live internet access.
 *
 * Signed fake ESP32 HTTPS POST -> actual staged Worker -> mock KV ->
 * verified fake Google ID token -> actual browser Dashboard.
 */
import assert from 'node:assert/strict';
import {createHmac,createPublicKey,generateKeyPairSync,sign} from 'node:crypto';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import worker from '../backend/worker-v025-device-status.mjs';

const ORIGIN='http://127.0.0.1:8893';
const google=generateKeyPairSync('rsa',{modulusLength:2048});
const service=generateKeyPairSync('rsa',{modulusLength:2048});
const publicKey=createPublicKey(google.privateKey).export({format:'jwk'});
publicKey.kid='virtual-google-key';publicKey.alg='RS256';publicKey.use='sig';
const deviceKey=Buffer.from(Array.from({length:32},(_,i)=>i+21));
const storage=new Map();
const env={
 ALLOWED_ORIGIN:ORIGIN,GOOGLE_CLIENT_ID:'virtual-time4med.apps.googleusercontent.com',
 SPREADSHEET_ID:'SHEET-VIRTUAL-NOT-REAL',
 GCP_CLIENT_EMAIL:'fake-service@example.invalid',
 GCP_PRIVATE_KEY:service.privateKey.export({format:'pem',type:'pkcs8'}).toString(),
 DEVICE_STATUS_HMAC_KEY:deviceKey.toString('hex'),
 DEVICE_STATUS_KV:{
   get:async key=>storage.get(key)??null,
   put:async(key,val)=>{storage.set(key,val);}
 }
};
const nativeFetch=globalThis.fetch;
globalThis.fetch=async (url,opts={})=>{
 const u=new URL(typeof url==='string'?url:url.url);
 if(u.hostname==='www.googleapis.com'&&u.pathname==='/oauth2/v3/certs')
   return Response.json({keys:[publicKey]});
 if(u.hostname==='oauth2.googleapis.com'&&u.pathname==='/token')
   return Response.json({access_token:'FAKE_FOR_TESTS',expires_in:1800});
 if(u.hostname==='sheets.googleapis.com'){
   const p=decodeURIComponent(u.pathname);
   if(p.includes('Users'))return Response.json({values:[[
    'TEST-01','virtualcare@example.invalid','Virtual Caregiver','CAREGIVER','P001','','','ACTIVE'
   ]]});
   if(p.includes('Patients'))return Response.json({values:[[
    'P001','คุณพ่อ ทดสอบ','','','ACTIVE'
   ]]});
   if(p.includes('MealMedicines'))return Response.json({values:[]});
   throw Error('Unexpected tab in Sheets mock: '+p);
 }
 throw Error('Unexpected external call: '+u.hostname);
};
const b64=v=>Buffer.from(v).toString('base64url');
function googleToken(){
 const now=Math.floor(Date.now()/1000);
 const a=b64(JSON.stringify({alg:'RS256',kid:publicKey.kid,typ:'JWT'}));
 const b=b64(JSON.stringify({iss:'https://accounts.google.com',aud:env.GOOGLE_CLIENT_ID,
  email:'virtualcare@example.invalid',sub:'fake-google-user',
  email_verified:true,name:'Virtual Caregiver',iat:now,exp:now+1200}));
 const str=a+'.'+b;
 return str+'.'+b64(sign('RSA-SHA256',Buffer.from(str),google.privateKey));
}
let counter=0;
async function sendVirtualDevice({locked=true,closed=true,emergency=false}={}){
 const data={device_id:'ESP32S3-01',online:true,
  lock_status:locked?'LOCKED':'UNLOCKED',door_status:closed?'CLOSED':'OPEN',
  emergency,rtc_valid:true,system_state:'IDLE',reason:'VIRTUAL_TEST'};
 const body=JSON.stringify(data);
 const timestamp=String(Math.floor(Date.now()/1000));
 const nonce=(++counter).toString(16).padStart(32,'0');
 const canonical=['T4M-STATUS-V1','/api/device/telemetry',timestamp,nonce,body].join('\n');
 const mac=createHmac('sha256',deviceKey).update(canonical).digest('hex');
 const req=new Request('https://worker.test.invalid/api/device/telemetry',{
  method:'POST',headers:{'Content-Type':'application/json',
   'X-T4M-Timestamp':timestamp,'X-T4M-Nonce':nonce,'X-T4M-Signature':mac},
  body
 });
 const res=await worker.fetch(req,env);
 assert.equal(res.status,200,await res.text());
 return {req,nonce};
}
async function waitForServer(){
 for(let i=0;i<50;i++){
  try{const r=await nativeFetch(ORIGIN+'/test-v021/',{signal:AbortSignal.timeout(850)});if(r.ok)return;}catch{}
  await new Promise(r=>setTimeout(r,150));
 }
 throw Error('Local static site could not start');
}
async function main(){
 const process=spawn('python3',['-m','http.server','8893','--bind','127.0.0.1'],{stdio:'ignore'});
 let browser;
 try{
  await waitForServer();
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1360,height:900}});
  const errs=[];let statusCalls=0;let sentWithToken=true;
  page.on('pageerror',e=>errs.push(String(e)));
  const jwt=googleToken();
  await page.addInitScript(token=>{
   window.google={accounts:{id:{
    initialize(opts){window.__mockGoogleCallback=opts.callback;},
    renderButton(el){const b=document.createElement('button');b.id='googleTestButton';
      b.textContent='Mock Sign In With Google';
      b.onclick=()=>window.__mockGoogleCallback({credential:token});el.append(b);},
    disableAutoSelect(){},prompt(){}
   }}};
  },jwt);
  await page.route('**/*',async route=>{
   const request=route.request(),u=new URL(request.url());
   if(u.origin===ORIGIN)return route.continue();
   if(u.pathname.startsWith('/api/')||u.pathname==='/health'){
     if(u.pathname==='/api/devices/status'){
       statusCalls++;
       sentWithToken=sentWithToken && request.headers().authorization==='Bearer '+jwt;
     }
     const method=request.method(),headers=new Headers(request.headers());
     const body=['GET','HEAD','OPTIONS'].includes(method)?undefined:request.postData()??undefined;
     const res=await worker.fetch(new Request(request.url(),{method,headers,body}),env);
     const text=await res.text();
     return route.fulfill({status:res.status,headers:Object.fromEntries(res.headers.entries()),body:text});
   }
   if(u.hostname==='accounts.google.com'||u.hostname==='cdn.jsdelivr.net')
     return route.fulfill({status:200,contentType:'application/javascript',body:'// isolated external dependency'});
   return route.abort();
  });
  await page.goto(ORIGIN+'/test-v021/',{waitUntil:'domcontentloaded'});
  await page.locator('#googleTestButton').waitFor({state:'visible'});
  assert.equal(await page.locator('#t25DevicePanel').isVisible(),false,
    'Cabinet status must not appear without Google Login');
  await page.locator('#googleTestButton').click();
  await page.waitForFunction(()=>window.Time4MedAuth?.user?.role==='CAREGIVER');
  await page.locator('#t25DevicePanel').waitFor({state:'visible'});
  await page.waitForFunction(()=>document.getElementById('t25DeviceState')?.textContent==='รอการส่งข้อมูลจากเครื่อง');
  assert.ok(statusCalls>=1,'Browser must automatically GET status from Worker after login');
  assert.equal(sentWithToken,true,'Every status request must use Google bearer token');
  assert.equal(await page.locator('#t25Lock').innerText(),'ยังไม่มีข้อมูล');

  await sendVirtualDevice({locked:true,closed:true,emergency:false});
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('time4med-auth-changed',{
   detail:{user:window.Time4MedAuth.user}
  })));
  await page.waitForFunction(()=>document.getElementById('t25DeviceState')?.textContent==='รับข้อมูลล่าสุดแล้ว');
  assert.equal(await page.locator('#t25Door').innerText(),'ปิด');
  assert.equal(await page.locator('#t25Lock').innerText(),'ล็อก');
  assert.equal(await page.locator('#t25Emergency').innerText(),'ไม่มีสัญญาณ');

  await sendVirtualDevice({locked:false,closed:false,emergency:true});
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('time4med-auth-changed',{
   detail:{user:window.Time4MedAuth.user}
  })));
  await page.waitForFunction(()=>document.getElementById('t25Emergency')?.textContent==='มีสัญญาณฉุกเฉิน');
  assert.equal(await page.locator('#t25Door').innerText(),'เปิด');
  assert.equal(await page.locator('#t25Lock').innerText(),'ปลดล็อก');

  // A device power-down/network loss is simulated by an expired snapshot.
  const last=JSON.parse(storage.get('telemetry:cabinet-01'));
  last.received_at=new Date(Date.now()-210000).toISOString();
  storage.set('telemetry:cabinet-01',JSON.stringify(last));
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('time4med-auth-changed',{
   detail:{user:window.Time4MedAuth.user}
  })));
  await page.waitForFunction(()=>document.getElementById('t25DeviceState')?.textContent==='ข้อมูลหมดอายุ');
  assert.equal(await page.locator('#t25Lock').innerText(),'ยังไม่มีข้อมูล');

  await page.locator('#t4mSignOut').click();
  await page.locator('#t4mAuthScreen').waitFor({state:'visible'});
  assert.equal(await page.locator('#t25DevicePanel').isVisible(),false);
  assert.equal(await page.locator('#t25Door').innerText(),'ยังไม่มีข้อมูล');
  assert.deepEqual(errs,[],'No browser JavaScript errors');
  console.log('PASS: VIRTUAL DEVICE signed POST → Cloudflare Worker + KV → Google JWT caregiver → auto-updating website → offline and logout');
 }finally{
  if(browser)await browser.close();
  process.kill();
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
