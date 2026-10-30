/** Simulate Google 404 on default route, then 200 on authuser=0, with no real accounts. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),GH='https://n4-p4t.github.io',GAS='https://script.google.com';
const calls=[];
function mockBridge(ch) {
  return fs.readFileSync(path.join(root,'apps-script','Bridge.html'),'utf8')
    .replace("'<?= channel ?>'",JSON.stringify(ch))
    .replace('<script>',`<script>
      function run(ok,fail){return {
        withSuccessHandler:f=>run(f,fail),
        withFailureHandler:f=>run(ok,f),
        logout:()=>setTimeout(()=>ok(true),0)
      }}
      window.google={script:{run:run(()=>{},()=>{})}};
    </script><script>`);
}
async function main(){
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await page.route('**/*',route=>{
    const u=new URL(route.request().url());
    if(u.origin===GAS&&u.pathname.endsWith('/exec')){
      const hint=u.searchParams.get('authuser');calls.push(hint);
      if(hint===null)return route.fulfill({status:404,body:'Simulated Google multi-login 404'});
      if(hint==='0')return route.fulfill({status:200,contentType:'text/html',body:mockBridge(u.searchParams.get('channel'))});
      return route.fulfill({status:404,body:'Wrong hint'});
    }
    if(u.origin===GH&&u.pathname.startsWith('/Time4Med/')){
      const rel=u.pathname.slice('/Time4Med/'.length),local=path.resolve(root,rel.endsWith('/')?rel+'index.html':rel);
      if(!local.startsWith(root+path.sep))return route.abort();
      try{
        const body=fs.readFileSync(local);
        return route.fulfill({status:200,body,contentType:local.endsWith('.js')?'application/javascript':local.endsWith('.css')?'text/css':local.endsWith('.png')?'image/png':'text/html'});
      }catch(_){return route.fulfill({status:404,body:'missing'});}
    }
    return route.abort();
  });
  await page.goto(GH+'/Time4Med/test-v021/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('#gasConnectState')?.textContent==='เชื่อมต่อ Apps Script แล้ว',{timeout:18000});
  assert.deepEqual(calls,[null,'0'],'should only try default and authuser=0');
  assert.match(await page.locator('#gasStatus').innerText(),/เชื่อมต่อระบบสำเร็จ/);
  assert.equal(await page.locator('#time4medSecureBridge2').count(),1);
  assert.deepEqual(errors,[]);
  console.log('PASS: 404 default GAS route → automatic authuser=0 recovery with origin/nonce bridge');
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});