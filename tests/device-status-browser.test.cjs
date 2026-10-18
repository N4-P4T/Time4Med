const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const base='http://127.0.0.1:8892/';
const html=fs.readFileSync('test-v021/index.html','utf8');
const auto=fs.readFileSync('test-v021/device-status-auto.js','utf8');
assert.match(html,/id="t25DevicePanel"/);
assert.match(html,/src="device-status-auto\.js"/);
assert.doesNotMatch(html,/id="t24Username"|id="t24Password"|src="mqtt-live-status\.js"|mqtt@5/);
assert.doesNotMatch(auto,/mqtt\.connect|\.publish\s*\(|localStorage|sessionStorage/);
async function startServer(){
 for(let i=0;i<50;i++){try{if((await fetch(base+'test-v021/',{signal:AbortSignal.timeout(1000)})).ok)return;}catch{}
 await new Promise(r=>setTimeout(r,180));}
 throw Error('Dev HTTP server unavailable');
}
const sample={state:'LIVE',device_id:'ESP32S3-01',received_at:new Date().toISOString(),
 telemetry:{door_status:'CLOSED',lock_status:'LOCKED',emergency:false,rtc_valid:true,system_state:'IDLE',reason:'test'}};
async function main(){
 const server=spawn('python3',['-m','http.server','8892','--bind','127.0.0.1'],{stdio:'ignore'});
 let browser;
 try{
  await startServer();
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1360,height:900}});
  const errors=[];let statusData=sample,hitCount=0,authorizationOk=true;
  page.on('pageerror',e=>errors.push(String(e)));
  await page.addInitScript(()=>{
   window.google={accounts:{id:{
    initialize(opts){window.__googleCallback=opts.callback;},
    renderButton(el){const button=document.createElement('button');button.id='fakeGoogle';button.textContent='Mock Google';
      button.addEventListener('click',()=>window.__googleCallback({credential:'fake-jwt'}));el.append(button);},
    disableAutoSelect(){},
    prompt(){}
   }}};
  });
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.origin===new URL(base).origin)return route.continue();
   if(u.pathname==='/api/me')return route.fulfill({status:200,contentType:'application/json',body:'{"user":{"role":"ADMIN","name":"ทดสอบ","email":"tester@example.invalid","patientIds":"ALL"}}'});
   if(u.pathname==='/api/devices/status'){
     hitCount++;
     authorizationOk=authorizationOk&&route.request().headers().authorization==='Bearer fake-jwt';
     return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(statusData)});
   }
   if(u.pathname==='/api/patients')return route.fulfill({status:200,contentType:'application/json',body:'{"patients":[]}'}); 
   if(u.pathname==='/api/medicines')return route.fulfill({status:200,contentType:'application/json',body:'{"medicines":[]}'}); 
   if(u.pathname==='/api/users')return route.fulfill({status:200,contentType:'application/json',body:'{"users":[]}'}); 
   if(u.hostname==='accounts.google.com'||u.hostname==='cdn.jsdelivr.net')
     return route.fulfill({status:200,contentType:'application/javascript',body:'// isolated test'});
   return route.abort();
  });
  await page.goto(base+'test-v021/',{waitUntil:'domcontentloaded'});
  await page.locator('#fakeGoogle').waitFor({state:'visible'});
  assert.equal(await page.locator('#t25DevicePanel').isVisible(),false,'status hidden until login');
  await page.locator('#fakeGoogle').click();
  await page.waitForFunction(()=>document.getElementById('t25DeviceState')?.textContent==='รับข้อมูลล่าสุดแล้ว');
  assert.ok(hitCount>=1,'status auto-fetched');
  assert.equal(authorizationOk,true,'backend requests sent with Google ID token');
  assert.equal(await page.locator('#t25Door').innerText(),'ปิด');
  assert.equal(await page.locator('#t25Lock').innerText(),'ล็อก');
  assert.equal(await page.locator('#t25Emergency').innerText(),'ไม่มีสัญญาณ');
  // Backend freshness regression: old data must never be shown as online.
  statusData={state:'STALE',device_id:'ESP32S3-01',received_at:new Date(Date.now()-300000).toISOString()};
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('time4med-auth-changed',{detail:{user:window.Time4MedAuth.user}})));
  await page.waitForFunction(()=>document.getElementById('t25DeviceState')?.textContent==='ข้อมูลหมดอายุ');
  assert.equal(await page.locator('#t25Lock').innerText(),'ยังไม่มีข้อมูล');
  await page.locator('#t4mSignOut').click();
  await page.locator('#t4mAuthScreen').waitFor({state:'visible'});
  assert.equal(await page.locator('#t25DevicePanel').isVisible(),false);
  assert.equal(await page.locator('#t25Door').innerText(),'ยังไม่มีข้อมูล');
  assert.deepEqual(errors,[],'No browser JavaScript exceptions');
  console.log('PASS Google-only status: no MQTT prompt, authorized autoload, freshness check and logout scrub');
 }finally{if(browser)await browser.close();server.kill();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
