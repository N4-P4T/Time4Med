const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const {spawn} = require('node:child_process');
const root='http://127.0.0.1:8877/';
const url=root+'test-v020/';
async function ready() {
 for(let i=0;i<50;i++){try{if((await fetch(url,{signal:AbortSignal.timeout(1000)})).ok)return;}catch{}
 await new Promise(r=>setTimeout(r,200))}
 throw Error('Local server did not start');
}
async function testSite(){
 const server=spawn('python3',['-m','http.server','8877','--bind','127.0.0.1'],{cwd:process.cwd(),stdio:'ignore'});
 let browser;
 try{
  await ready();
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
    const ctx=await browser.newContext({viewport});
    const page=await ctx.newPage();
    const pageErrors=[];
    page.on('pageerror',e=>pageErrors.push(String(e)));
    await page.addInitScript(()=>{
      // Fake Google Identity Services: real Google is never contacted.
      window.google={accounts:{id:{
        initialize({callback}){window.__googleCallback=callback;},
        renderButton(el){
          const btn=document.createElement('button');
          btn.id='fakeGoogleButton';btn.textContent='Sign in with Google (TEST)';
          btn.type='button';btn.addEventListener('click',()=>window.__googleCallback({credential:'mock-test-only'}));
          el.append(btn);
        },
        disableAutoSelect(){}
      }}};
    });
    await page.route('**/*',async route=>{
      const u=new URL(route.request().url());
      if(u.origin===new URL(root).origin)return route.continue();
      if(u.pathname==='/api/me')return route.fulfill({status:200,contentType:'application/json',
        body:JSON.stringify({user:{name:'Tester',role:'CAREGIVER',email:'test@example.invalid',patientIds:['P001']}})});
      if(u.pathname==='/api/patients')return route.fulfill({status:200,contentType:'application/json',
        body:JSON.stringify({patients:[{id:'P001',name:'ผู้สูงอายุทดสอบ'}]})});
      if(u.pathname==='/api/medicines')return route.fulfill({status:200,contentType:'application/json',
        body:JSON.stringify({medicines:[
          {id:'t1',patientId:'P001',patient:'ผู้สูงอายุทดสอบ',name:'ยา A',kind:'scheduled',mealType:2,time:'08:30',boxNumber:'1',stockStatus:'low'},
          {id:'t2',patientId:'P001',patient:'ผู้สูงอายุทดสอบ',name:'ยา B',kind:'scheduled',mealType:7,time:'20:00',boxNumber:'2',stockStatus:'ok'}]})});
      if(u.pathname==='/api/users')return route.fulfill({status:200,contentType:'application/json',body:'{"users":[]}'});
      if(u.hostname==='accounts.google.com'||u.hostname==='cdn.jsdelivr.net')return route.fulfill({status:200,contentType:'application/javascript',body:'// fully isolated test'});
      return route.abort();
    });
    await page.goto(url,{waitUntil:'domcontentloaded'});
    await page.locator('#t4mAuthScreen').waitFor({state:'visible'});
    await page.locator('#fakeGoogleButton').waitFor({state:'visible'});
    assert.equal(await page.locator('#home-overview').isVisible(),false,
      'must not expose caregiver dashboard before authentication');
    await page.locator('#fakeGoogleButton').click();
    await page.waitForFunction(()=>!!window.Time4MedAuth?.user);
    await page.waitForFunction(()=>document.getElementById('totalMedicineCount')?.textContent==='2');
    await page.locator('#home-overview').waitFor({state:'visible'});
    assert.equal(await page.locator('#devices').isVisible(),false,'no devices controls on overview');
    assert.equal(await page.locator('#homeTodaySchedule .home-schedule-item').count(),2);
    assert.equal(await page.locator('#homeConfirmationEvents').innerText(),'—','must not invent ingestion stats');

    await page.locator('.sidebar-link[href="#devices"]').click();
    await page.locator('#devices').waitFor({state:'visible'});
    assert.equal(await page.locator('#home-overview').isVisible(),false);
    assert.equal(await page.locator('#unlockBtn').isVisible(),true);

    await page.locator('.sidebar-link[href="#dashboard"]').click();
    await page.locator('#home-overview').waitFor({state:'visible'});
    const width=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
    assert.ok(width<=4,'unexpected horizontal overflow '+width);
    await page.locator('#t4mSignOut').click();
    await page.locator('#t4mAuthScreen').waitFor({state:'visible'});
    assert.equal(await page.locator('#home-overview').isVisible(),false,
      'dashboard must disappear on sign-out');
    assert.deepEqual(pageErrors,[],'browser has JS exceptions');
    console.log('PASS: Google auth gate + dashboard/device separation '+viewport.width);
    await ctx.close();
  }
 }finally{if(browser)await browser.close();server.kill();}
}
testSite().catch(e=>{console.error(e);process.exitCode=1});
