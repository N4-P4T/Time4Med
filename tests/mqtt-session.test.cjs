/**
 * Offline browser test of per-tab HiveMQ credential entry.
 * Blocks all external requests so NO live broker, device or camera is contacted.
 */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const fs=require('node:fs');
const path=require('node:path');

const cfg=fs.readFileSync(path.join(__dirname,'../mqtt-config.js'),'utf8');
assert.doesNotMatch(cfg,/\bpassword\s*:/i,'public config must not contain any password');
assert.doesNotMatch(cfg,/PUT_MQTT_PASSWORD_HERE/);
const base='http://127.0.0.1:8766/';

async function waitReady() {
  for(let k=0;k<50;k++) {
    try { if((await fetch(base,{signal:AbortSignal.timeout(1000)})).ok)return; }
    catch {}
    await new Promise(r=>setTimeout(r,180));
  }
  throw Error('HTTP server not ready');
}
(async()=>{
  const server=spawn('python3',['-m','http.server','8766','--bind','127.0.0.1'],{stdio:'ignore'});
  let browser;
  try {
    await waitReady();
    browser=await chromium.launch({headless:true,args:['--no-sandbox']});
    const page=await browser.newPage();
    const errors=[];
    page.on('pageerror',e=>errors.push(String(e)));
    await page.route('**/*',route=>{
      const url=route.request().url();
      if(url.includes('cdn.jsdelivr.net/npm/mqtt')){
        return route.fulfill({
          status:200,contentType:'application/javascript',
          body:`window.__mqttTestConnections=[]; window.__mqttTestPublishCalls=[]; window.mqtt={
              connect:function(url,options) {
                window.__mqttTestConnections.push({url,username:options.username,
                  password:options.password,clientId:options.clientId});
                return {connected:false,reconnecting:false,
                  on:function(){return this;},subscribe:function(){},
                  end:function(){},publish:function(topic,payload) {
                    window.__mqttTestPublishCalls.push({topic,payload});}};
              }};`
        });
      }
      if(url.startsWith(base))return route.continue();
      return route.abort();
    });
    await page.goto(base,{waitUntil:'domcontentloaded'});
    await page.locator('#mqttConnectButton').waitFor({state:'visible'});
    assert.equal(await page.locator('#mqttConnectionLabel').innerText(),'MQTT: รอผู้ดูแลเชื่อมต่อ');
    assert.equal(await page.evaluate(()=>window.__mqttTestConnections.length),0,
      'must not auto-connect without credentials');

    await page.locator('#mqttConnectButton').click();
    assert.equal(await page.locator('#mqttCredentialDialog').evaluate(el=>el.open),true);
    await page.locator('#mqttCancelButton').click();
    assert.equal(await page.locator('#mqttCredentialDialog').evaluate(el=>el.open),false);

    await page.locator('#mqttConnectButton').click();
    await page.locator('#mqttPasswordInput').fill('only-for-offline-test');
    await page.locator('#mqttCredentialForm button[type="submit"]').click();
    await page.waitForFunction(()=>window.__mqttTestConnections.length===1);
    assert.equal(await page.locator('#mqttPasswordInput').inputValue(),'');
    assert.equal(await page.locator('#mqttCredentialDialog').evaluate(el=>el.open),false);
    const conn=await page.evaluate(()=>window.__mqttTestConnections[0]);
    assert.equal(conn.username,'time4med-web');
    assert.equal(conn.password,'only-for-offline-test');
    assert.match(conn.url,/^wss:\/\//);
    assert.equal(await page.evaluate(()=>window.__mqttTestPublishCalls.length),0);

    const stores=await page.evaluate(()=>({
      local:Object.values(localStorage),session:Object.values(sessionStorage)
    }));
    assert.equal(JSON.stringify(stores).includes('only-for-offline-test'),false,
      'credential must not be written to browser storage');
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.__mqttTestConnections !== undefined);
    assert.equal(await page.evaluate(()=>window.__mqttTestConnections.length),0,
      'credentials must not survive page reload');
    assert.deepEqual(errors,[]);
    console.log('PASS: public config has no secret; credential form is per tab and offline test is safe');
  } finally {
    if(browser)await browser.close();
    server.kill();
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
