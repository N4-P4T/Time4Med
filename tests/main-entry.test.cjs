/** Main GitHub Pages entry must not connect to legacy MQTT or claim a deployment before it exists. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const root='http://127.0.0.1:8899/';
const html=fs.readFileSync('index.html','utf8');
const oldConfig=fs.readFileSync('mqtt-config.js','utf8');
assert.match(html,/Time4Med/);
assert.doesNotMatch(html,/(?:test-v021\/|mqtt-config\.js|mqtt\.min\.js|Cloudflare|hivemq\.cloud)/i,
  'release root must not load legacy MQTT, Cloudflare or staging entry');
assert.doesNotMatch(oldConfig,/\bpassword\s*:/i,'never put broker password into public source');
assert.match(html,/PASTE_APPS_SCRIPT_WEB_APP_URL_HERE|script\.google\.com\/macros\/s\//,
  'root must contain GAS URL placeholder or configured GAS URL');
async function wait(){for(let i=0;i<40;i++){try{if((await fetch(root,{signal:AbortSignal.timeout(1000)})).ok)return;}catch{} await new Promise(r=>setTimeout(r,150));}throw Error('local server unavailable');}
async function main(){
  const server=spawn('python3',['-m','http.server','8899','--bind','127.0.0.1'],{stdio:'ignore'});
  let browser;
  try{
    await wait();browser=await chromium.launch({headless:true,args:['--no-sandbox']});
    const ctx=await browser.newContext({viewport:{width:390,height:844}});
    const page=await ctx.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(String(e)));
    await page.route('**/*',route=>route.request().url().startsWith(root)?route.continue():route.abort());
    await page.goto(root,{waitUntil:'domcontentloaded'});
    await page.locator('#enter').waitFor({state:'visible'});
    const link=page.locator('#enter'),href=await link.getAttribute('href');
    if(html.includes('PASTE_APPS_SCRIPT_WEB_APP_URL_HERE')){
      assert.equal(href,null,'entry must be disabled until GAS deployment URL is configured');
      assert.equal(await link.getAttribute('aria-disabled'),'true');
    } else assert.match(href||'',/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/);
    assert.deepEqual(errors,[]);
    await ctx.close();console.log('PASS: safe GAS entry on mobile viewport');
  }finally{if(browser)await browser.close();server.kill();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});