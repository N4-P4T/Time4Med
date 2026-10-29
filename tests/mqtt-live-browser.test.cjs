const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const origin='http://127.0.0.1:8894/';
const source=fs.readFileSync('test-v021/mqtt-live-status.js','utf8');
const html=fs.readFileSync('test-v021/index.html','utf8');
if (html.includes('src="gas-only.js"')) {
  assert.doesNotMatch(html,/src="mqtt-live-status\.js"|mqtt\.min\.js/);
  assert.match(html,/src="gas-only\.js"/);
  console.log('PASS: MQTT browser scripts intentionally removed from GAS-only UI');
  process.exit(0);
}

assert.match(html,/id="t24MqttPanel"/);
assert.doesNotMatch(source,/\.\s*publish\s*\(/,'no MQTT publishes');
assert.doesNotMatch(source,/\b(?:localStorage|sessionStorage)\s*(?:\.|\[)|document\.cookie/,'no credential storage calls');

async function ready(){
 for(let i=0;i<50;i++){try{if((await fetch(origin+'test-v021/',{signal:AbortSignal.timeout(1000)})).ok)return;}catch{}
 await new Promise(r=>setTimeout(r,180));}throw Error('server unavailable');
}
async function main(){
 const server=spawn('python3',['-m','http.server','8894','--bind','127.0.0.1'],{stdio:'ignore'});
 let browser;
 try{
  await ready();
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const page=await browser.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await page.addInitScript(()=>{
    window.google={accounts:{id:{
      initialize(o){window.__loginCallback=o.callback;},
      renderButton(el){const b=document.createElement('button');b.id='fakeGoogleButton';b.textContent='Mock Google';b.addEventListener('click',()=>window.__loginCallback({credential:'test-only'}));el.append(b);},
      disableAutoSelect(){}
    }}};
  });
  await page.route('**/*',async route=>{
    const u=new URL(route.request().url());
    if(u.origin===new URL(origin).origin)return route.continue();
    if(u.pathname==='/api/me')return route.fulfill({status:200,contentType:'application/json',body:'{"user":{"name":"Test Admin","email":"test@example.invalid","role":"ADMIN","patientIds":"ALL"}}'});
    if(u.pathname==='/api/patients')return route.fulfill({status:200,contentType:'application/json',body:'{"patients":[]}'});
    if(u.pathname==='/api/medicines')return route.fulfill({status:200,contentType:'application/json',body:'{"medicines":[]}'});
    if(u.pathname==='/api/users')return route.fulfill({status:200,contentType:'application/json',body:'{"users":[]}'});
    if(u.hostname==='accounts.google.com')return route.fulfill({status:200,contentType:'application/javascript',body:'// mock Google'});
    if(u.hostname==='cdn.jsdelivr.net')return route.fulfill({status:200,contentType:'application/javascript',
      body:[
       'window.__mqttCalls=[];window.__mqttEnded=false;window.__mqttStub={};',
       'window.mqtt={connect:function(url,options){',
       'window.__mqttCalls.push({url,username:options.username,password:options.password});',
       'const listeners={};const client={connected:false,reconnecting:false,',
       'on:function(t,fn){listeners[t]=fn;return client;},',
       'emit:function(t,...args){if(listeners[t])listeners[t](...args);},',
       'subscribe:function(topic,opts,cb){window.__mqttTopic=topic;cb(null);},',
       'end:function(){client.connected=false;window.__mqttEnded=true;}};',
       'window.__mqttStub.client=client;return client;}};'
      ].join('\n')});
    return route.abort();
  });
  await page.goto(origin+'test-v021/',{waitUntil:'domcontentloaded'});
  await page.locator('#fakeGoogleButton').waitFor({state:'visible'});
  assert.equal(await page.locator('#t24MqttPanel').isVisible(),false);
  await page.locator('#fakeGoogleButton').click();
  await page.locator('#t24MqttPanel').waitFor({state:'visible'});
  await page.locator('#t24Username').fill('viewer-test');
  await page.locator('#t24Password').fill('never-store-test');
  await page.locator('#t24Start').click();
  await page.waitForFunction(()=>!!window.__mqttStub.client);
  const first=await page.evaluate(()=>window.__mqttCalls[0]);
  assert.match(first.url,/^wss:\/\//);
  assert.equal(first.username,'viewer-test');
  assert.equal(first.password,'never-store-test');
  assert.equal(await page.locator('#t24Password').inputValue(),'');
  await page.evaluate(()=>{window.__mqttStub.client.connected=true;window.__mqttStub.client.emit('connect');});
  assert.equal(await page.evaluate(()=>window.__mqttTopic),'time4med/v1/cabinet/cabinet-01/status');
  const sample={device_id:'ESP32S3-01',online:true,lock_status:'LOCKED',door_status:'OPEN',emergency:false,system_state:'IDLE'};
  await page.evaluate(msg=>{
    const packet={toString:()=>JSON.stringify(msg),length:180};
    window.__mqttStub.client.emit('message',window.__mqttTopic,packet,{retain:true});
  },sample);
  assert.equal(await page.locator('#t24Lock').innerText(),'ยังไม่มีข้อมูลสด','retained not considered live');
  await page.evaluate(msg=>{
    const packet={toString:()=>JSON.stringify(msg),length:180};
    window.__mqttStub.client.emit('message',window.__mqttTopic,packet,{retain:false});
  },sample);
  assert.equal(await page.locator('#t24Lock').innerText(),'ล็อก');
  assert.equal(await page.locator('#t24Door').innerText(),'เปิด');
  await page.locator('#t4mSignOut').click();
  await page.locator('#t4mAuthScreen').waitFor({state:'visible'});
  assert.equal(await page.locator('#t24MqttPanel').isVisible(),false);
  assert.equal(await page.evaluate(()=>window.__mqttEnded),true);
  assert.equal(await page.locator('#t24Lock').innerText(),'ยังไม่มีข้อมูลสด');
  assert.equal(await page.evaluate(()=>JSON.stringify(Object.values(localStorage)).includes('never-store-test')||JSON.stringify(Object.values(sessionStorage)).includes('never-store-test')),false);
  assert.deepEqual(errors,[]);
  console.log('PASS read-only live status: auth-gated, no retain trust, no publish, logout clears credentials');
 }finally{if(browser)await browser.close();server.kill();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
