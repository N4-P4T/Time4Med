// Time4Med Google remembered sign-in tests (isolated browser and mocked Backend).
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const origin='http://127.0.0.1:8895/';
const code=fs.readFileSync('test-v019/auth.js','utf8');
assert.match(code,/auto_select:true/);
assert.match(code,/google\.accounts\.id\.prompt\(\)/);
assert.doesNotMatch(code,/\b(?:localStorage|sessionStorage)\s*(?:\.|\[)/);
async function ready(){
 for(let i=0;i<50;i++){try{if((await fetch(origin+'test-v021/',{signal:AbortSignal.timeout(800)})).ok)return;}catch{}
 await new Promise(r=>setTimeout(r,180));}throw Error('HTTP server did not start');
}
async function runScenario(browser,scenario){
 const ctx=await browser.newContext({viewport:{width:1280,height:850}});
 const page=await ctx.newPage();
 const errors=[];
 page.on('pageerror',e=>errors.push(String(e)));
 await page.addInitScript(scenario=>{
   window.__gis={initialized:false,auto:false,prompts:0,disabled:false};
   window.google={accounts:{id:{
     initialize(options){
       window.__gis.initialized=true;
       window.__gis.auto=options.auto_select;
       window.__gis.callback=options.callback;
     },
     renderButton(el){
       const b=document.createElement('button');b.type='button';b.id='testGoogleButton';
       b.textContent='Sign in with Google';
       b.onclick=()=>window.__gis.callback({credential:'google-test-jwt'});
       el.append(b);
     },
     prompt(){
       window.__gis.prompts++;
       if(scenario==='authorized-auto'||scenario==='denied-auto'||scenario==='delayed'){
         queueMicrotask(()=>window.__gis.callback({credential:'google-test-jwt'}));
       }
     },
     disableAutoSelect(){window.__gis.disabled=true;}
   }}};
 },scenario);
 await page.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.origin===new URL(origin).origin)return route.continue();
   if(u.pathname==='/api/me'){
     if(scenario==='delayed')await new Promise(r=>setTimeout(r,1000));
     if(scenario==='denied-auto')return route.fulfill({status:403,contentType:'application/json',
       body:'{"error":"ไม่พบอีเมลในระบบ หรือบัญชีถูกระงับสิทธิ์"}'});
     return route.fulfill({status:200,contentType:'application/json',
       body:'{"user":{"name":"Caregiver Test","email":"caregiver@example.invalid","role":"CAREGIVER","patientIds":"P001"}}'});
   }
   if(u.pathname==='/api/patients')return route.fulfill({status:200,contentType:'application/json',body:'{"patients":[]}'});
   if(u.pathname==='/api/medicines')return route.fulfill({status:200,contentType:'application/json',body:'{"medicines":[]}'});
   if(u.pathname==='/api/users')return route.fulfill({status:403,contentType:'application/json',body:'{"error":"forbidden"}'});
   if(u.hostname==='accounts.google.com'||u.hostname==='cdn.jsdelivr.net')
     return route.fulfill({status:200,contentType:'application/javascript',body:'// Google/browser dependency mocked'});
   return route.abort();
 });
 await page.goto(origin+'test-v021/',{waitUntil:'domcontentloaded'});
 await page.locator('#testGoogleButton').waitFor({state:'visible'});
 assert.equal(await page.evaluate(()=>window.__gis.auto),true,'Google auto-select must be enabled');
 assert.ok(await page.evaluate(()=>window.__gis.prompts)>=1,'Google prompt attempted once');
 if(scenario==='manual'){
   assert.equal(await page.locator('#home-overview').isVisible(),false);
   await page.locator('#testGoogleButton').click();
 }
 if(scenario==='denied-auto'){
   await page.waitForFunction(()=>document.getElementById('t4mAuthMessage')?.textContent.includes('เข้าใช้งานไม่ได้'));
   assert.equal(await page.locator('#home-overview').isVisible(),false);
   assert.equal(await page.evaluate(()=>window.Time4MedAuth.user),null);
   assert.equal(await page.evaluate(()=>window.Time4MedAuth.tokenPresent),false);
   assert.equal(await page.locator('#testGoogleButton').isVisible(),true,'Manual sign-in must remain available');
 }else if(scenario==='delayed'){
   await page.waitForFunction(()=>window.Time4MedAuth.tokenPresent);
   await page.evaluate(()=>window.Time4MedAuth.signOut('ทดสอบการออกจากระบบระหว่างรอตรวจสิทธิ์'));
   await new Promise(r=>setTimeout(r,1200));
   assert.equal(await page.evaluate(()=>window.Time4MedAuth.user),null);
   assert.equal(await page.locator('#home-overview').isVisible(),false);
   assert.equal(await page.evaluate(()=>window.Time4MedAuth.tokenPresent),false);
 }else{
   await page.waitForFunction(()=>window.Time4MedAuth.user?.role==='CAREGIVER');
   await page.locator('#home-overview').waitFor({state:'visible'});
   assert.equal(await page.locator('#t4mAdminSection').isVisible(),false);
   await page.locator('#t4mSignOut').click();
   await page.locator('#t4mAuthScreen').waitFor({state:'visible'});
   assert.equal(await page.evaluate(()=>window.Time4MedAuth.user),null);
   assert.equal(await page.evaluate(()=>window.__gis.disabled),true);
 }
 assert.deepEqual(errors,[],'no JavaScript exceptions');
 const browserStorage=await page.evaluate(()=>JSON.stringify({
   local:Object.values(localStorage),session:Object.values(sessionStorage)
 }));
 assert.equal(browserStorage.includes('google-test-jwt'),false,'no ID token persisted');
 console.log('PASS scenario: '+scenario);
 await ctx.close();
}
async function main(){
 const server=spawn('python3',['-m','http.server','8895','--bind','127.0.0.1'],{stdio:'ignore'});
 let browser;
 try{
   await ready();
   browser=await chromium.launch({headless:true,args:['--no-sandbox']});
   for(const scenario of ['authorized-auto','manual','denied-auto','delayed']){
     await runScenario(browser,scenario);
   }
 }finally{if(browser)await browser.close();server.kill();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
