const assert = require('node:assert/strict');
const fs = require('node:fs');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');

const root = 'http://127.0.0.1:8899/';
const html = fs.readFileSync('index.html','utf8');
const cfg = fs.readFileSync('mqtt-config.js','utf8');
const v020 = fs.readFileSync('test-v021/index.html','utf8');
const authCfg = fs.readFileSync('test-v019/auth-config.js','utf8');

assert.match(html, /test-v021\//,'root must point to the new caregiver page');
assert.doesNotMatch(html, /<script src="(?:mqtt-config|script)\.js"/,
  'root should not run the legacy MQTT/lock code');
assert.doesNotMatch(cfg, /\bpassword\s*:/i,'no MQTT password in public config');
assert.match(v020, /id="t4mGoogleButton"/);
assert.match(v020, /class="t4m-auth-screen"/);
assert.match(v020, /id="home-overview"/);
assert.match(authCfg, /TIME4MED_SECURE_MODE\s*=\s*true/,
  'direct MQTT commands must stay disabled in authenticated preview');

async function wait() {
  for(let n=0;n<50;n++){
    try{if((await fetch(root,{signal:AbortSignal.timeout(1000)})).ok)return;}
    catch{}
    await new Promise(r=>setTimeout(r,200));
  }
  throw Error('server unavailable');
}
async function run() {
  const server=spawn('python3',['-m','http.server','8899','--bind','127.0.0.1'],{stdio:'ignore'});
  let browser;
  try{
    await wait();
    browser=await chromium.launch({headless:true,args:['--no-sandbox']});
    for(const hash of ['', '#devices', '#dashboard']){
      const ctx=await browser.newContext({viewport:{width:390,height:844}});
      const page=await ctx.newPage();
      const errors=[];
      page.on('pageerror',e=>errors.push(String(e)));
      await page.route('**/*',route=>{
        const url=route.request().url();
        if(url.startsWith(root))return route.continue();
        // prevent ALL Google, cloud, camera and MQTT calls in this test
        if(url.includes('accounts.google.com/gsi/client'))return route.fulfill({
          status:200,contentType:'application/javascript',body:'// Google GSI not invoked in this test'
        });
        if(url.includes('cdn.jsdelivr.net/npm/mqtt'))return route.fulfill({
          status:200,contentType:'application/javascript',body:'window.mqtt={};'
        });
        return route.abort();
      });
      await page.goto(root+hash,{waitUntil:'domcontentloaded'});
      await page.waitForURL(url=>url.pathname.endsWith('/test-v021/') && url.hash===hash);
      await page.locator('#t4mAuthScreen').waitFor({state:'visible'});
      assert.equal(await page.locator('#home-overview').isVisible(),false,
        'dashboard must stay behind Google Login');
      assert.equal(await page.locator('#unlockBtn').isVisible(),false,
        'lock controls must not be visible to anonymous user');
      assert.deepEqual(errors,[],'no JS errors during root redirect');
      console.log('PASS: root'+hash+' redirects to auth-protected v0.21'+hash);
      await ctx.close();
    }
  } finally {
    if(browser) await browser.close();
    server.kill();
  }
}
run().catch(e=>{console.error(e);process.exitCode=1;});
