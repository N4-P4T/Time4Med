/* Offline browser check of GitHub Pages + Apps Script iframe RPC.
   Mock script.google.com; no real Google, LINE, or medicine records are touched. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const GH='https://n4-p4t.github.io', GAS='https://script.google.com';
const data={
  user:{email:'time4med.project@gmail.com',name:'Admin Test',role:'ADMIN',patientIds:['P001','P002','P003']},
  patients:[{id:'P001',name:'บุคคลทดสอบ',shelf:1}],
  medicines:[{id:'m1',patientId:'P001',name:'ยาทดสอบ A',mealType:2,meal:'หลังอาหารเช้า',time:'08:30',days:'MON,TUE',kind:'scheduled',active:true,demo:false}],
  devices:[],images:[],activity:[],users:[],serverTime:'2026-10-29 21:00:00'
};
function mockBridge(channel) {
  const mock='<script>window.__calls=[];window.__data='+JSON.stringify(data)+';'+
    'function run(ok,fail){return new Proxy({withSuccessHandler:f=>run(f,fail),withFailureHandler:f=>run(ok,f)},'+
    '{get:(o,k)=>k in o?o[k]:(...a)=>{window.__calls.push(k);setTimeout(()=>{'+
    'try{if(k==="requestOtp")ok({ok:true});'+
    'else if(k==="verifyOtp")ok({token:"T".repeat(64)});'+
    'else if(k==="bootstrap")ok(window.__data);'+
    'else if(k==="saveMedicine"){window.__data.medicines.push({...a[1],id:"m2",meal:"ก่อนนอน",kind:"scheduled",active:true,demo:false});ok({ok:true});}'+
    'else if(k==="testLine")ok({ok:true});else if(k==="logout")ok(true);'+
    'else fail({message:"not mocked: "+k});}catch(e){fail({message:e.message})}},0)}})};'+
    'window.google={script:{run:run(()=>{},()=>{})}};</script>';
  return fs.readFileSync(path.join(root,'apps-script','Bridge.html'),'utf8')
    .replace("'<?= channel ?>'",JSON.stringify(channel))
    .replace('<script>',mock+'<script>');
}
async function main(){
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1380,height:900}}),errors=[],unexpected=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.origin===GAS&&u.pathname.endsWith('/exec'))
     return route.fulfill({status:200,contentType:'text/html',body:mockBridge(u.searchParams.get('channel'))});
   if(u.origin===GH&&u.pathname.startsWith('/Time4Med/')){
    const relative=u.pathname.slice('/Time4Med/'.length);
    const local=path.resolve(root,relative.endsWith('/')?relative+'index.html':relative);
    if(!local.startsWith(root+path.sep))return route.abort();
    try{
     const body=fs.readFileSync(local);
     return route.fulfill({status:200,body,contentType:local.endsWith('.js')?'application/javascript':local.endsWith('.css')?'text/css':local.endsWith('.png')?'image/png':'text/html'});
    }catch(_){return route.fulfill({status:404,body:'missing fixture'});}
   }
   unexpected.push(route.request().url());return route.abort();
  });
  await page.goto(GH+'/Time4Med/test-v021/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('#gasConnectState')?.textContent==='เชื่อมต่อ Apps Script แล้ว',{timeout:15000});
  await page.locator('#gasEmail').fill('time4med.project@gmail.com');
  await page.locator('#gasOtpRequest button').click();
  await page.waitForSelector('#gasOtpVerify:not([hidden])');
  await page.locator('#gasOtp').fill('123456');
  await page.locator('#gasOtpVerify button').click();
  await page.waitForSelector('.t21-kpi-value');
  assert.deepEqual(await page.locator('.t4m-profile-role').allTextContents(),['แอดมิน (ADMIN)','แอดมิน (ADMIN)']);
  assert.equal(await page.locator('.sidebar-navigation a[href="#admin"]').count(),1,'ADMIN menu is present only for verified admin');
  assert.match(await page.locator('#dashboard').innerText(),/ผู้สูงอายุในสิทธิ์/);
  await page.locator('a[href="#medication"]').click();
  await page.waitForSelector('#gasMedicineForm');
  assert.match(await page.locator('#dashboard').innerText(),/ยาทดสอบ A/);
  await page.locator('#medName').fill('ยาทดสอบ B');
  await page.locator('#gasMedicineForm button[type="submit"]').click();
  await page.waitForFunction(()=>document.querySelector('#gasPageMessage')?.textContent.includes('บันทึกตารางยาสำเร็จ'));
  await page.locator('a[href="#admin"]').click();
  await page.waitForSelector('[data-action="line"]');
  await page.locator('[data-action="line"]').click();
  await page.waitForFunction(()=>document.querySelector('#gasPageMessage')?.textContent.includes('LINE สำเร็จ'));
  const frame=page.frames().find(f=>f.url().startsWith(GAS));
  assert.ok(frame,'GAS frame should be present');
  const calls=await frame.evaluate(()=>window.__calls);
  for(const k of ['requestOtp','verifyOtp','bootstrap','saveMedicine','testLine'])assert.ok(calls.includes(k),k);
  assert.deepEqual(errors,[]);
  assert.equal(unexpected.some(x=>/workers\.dev|hivemq|mqtt/.test(x)),false);
  // iOS Safari/LINE and Android Chrome/LINE should follow the identical
  // Time4Med URL to the existing top-level GAS web app automatically.
  // Only navigations are simulated; live Android authorization still needs
  // an on-device test.
  const mobileAgents=[
    ['iOS','Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Line/15.0.0'],
    ['Android','Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36 Line/15.0.0']
  ];
  for(const [device,userAgent] of mobileAgents){
    const mobile=await browser.newPage({userAgent,viewport:{width:390,height:844}});
    const errors=[];
    mobile.on('pageerror',e=>errors.push(String(e)));
    await mobile.route('**/*',route=>{
      const u=new URL(route.request().url());
      if(u.origin===GAS && u.pathname.endsWith('/exec'))
        return route.fulfill({status:200,contentType:'text/html',body:'<h1 id="directApp">Time4Med GAS Direct</h1>'});
      if(u.origin===GH && u.pathname.startsWith('/Time4Med/')){
        const relative=u.pathname.slice('/Time4Med/'.length);
        const local=path.resolve(root,relative.endsWith('/')?relative+'index.html':relative);
        if(!local.startsWith(root+path.sep))return route.abort();
        try{
          const body=fs.readFileSync(local);
          return route.fulfill({status:200,body,contentType:local.endsWith('.js')?'application/javascript':local.endsWith('.css')?'text/css':'text/html'});
        }catch(_){return route.fulfill({status:404,body:'missing fixture'});}
      }
      return route.abort();
    });
    for(const entry of ['/Time4Med/','/Time4Med/test-v021/']){
      await mobile.goto(GH+entry,{waitUntil:'domcontentloaded'});
      await mobile.waitForURL(url=>url.origin===GAS&&url.pathname.endsWith('/exec'),{timeout:10000});
      assert.equal(await mobile.locator('#directApp').count(),1,device+' entry '+entry+' must land on GAS direct login');
    }
    assert.deepEqual(errors,[],device+' mobile route must be free of JavaScript errors');
    await mobile.close();
  }
  console.log('PASS: simulated secure bridge, OTP, dashboard, medicine edit, LINE command; iPhone and Android one-link direct GAS navigation');
 }finally{await browser.close();}
}
main().catch(err=>{console.error(err);process.exitCode=1;});