const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const base='http://127.0.0.1:8897/';
const address=base+'test-v021/';
const html=fs.readFileSync('test-v021/index.html','utf8');
const source=fs.readFileSync('test-v021/caregiver-center.js','utf8');
assert.match(html,/id="t4mGoogleButton"/);
assert.match(html,/id="home-overview"/);
assert.match(html,/src="\.\.\/test-v019\/auth\.js"/);
assert.doesNotMatch(source,/\.publish\s*\(|digitalWrite\s*\(|setInsecure\s*\(/);
for(const id of ['t21PatientCount','t21ScheduledCount','t21PatientCards','t21ScheduleList','t21AttentionList','t21NeedsCheckCount','t21PatientFilter','mqttConnectButton','currentTime','currentDate','totalMedicineCount','takenMedicineCount','waitingMedicineCount','latestAlert']){
 assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,'unique ID: '+id);
}
const people=[{id:'P001',name:'พ่อ ทดสอบ'},{id:'P002',name:'แม่ ทดสอบ'}];
const meds=[
{id:'a',patientId:'P001',patient:'พ่อ ทดสอบ',name:'ยาตัวอย่าง A',kind:'scheduled',mealType:2,time:'08:30',boxNumber:'1',stockStatus:'ok'},
{id:'b',patientId:'P002',patient:'แม่ ทดสอบ',name:'ยาตัวอย่าง B',kind:'scheduled',mealType:6,time:'18:30',boxNumber:'2',stockStatus:'low'},
{id:'c',patientId:'P002',patient:'แม่ ทดสอบ',name:'ยา PRN',kind:'prn',mealType:'prn',time:'',boxNumber:'2',stockStatus:'unchecked'}];
async function serverReady(){
 for(let i=0;i<55;i++){try{if((await fetch(address,{signal:AbortSignal.timeout(800)})).ok)return;}catch{}
 await new Promise(r=>setTimeout(r,150));}throw Error('server unavailable');
}
async function main(){
 const server=spawn('python3',['-m','http.server','8897','--bind','127.0.0.1'],{stdio:'ignore'});
 let browser;
 try{
  await serverReady();
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
   const context=await browser.newContext({viewport});
   const page=await context.newPage();
   const errors=[];
   page.on('pageerror',e=>errors.push(String(e)));
   await page.addInitScript(()=>{
    window.google={accounts:{id:{
     initialize(o){window.__loginCallback=o.callback;},
     renderButton(el){const btn=document.createElement('button');btn.id='fakeGoogleButton';
      btn.textContent='Google Test';btn.addEventListener('click',()=>window.__loginCallback({credential:'mock-token'}));el.append(btn);},
     disableAutoSelect(){}
    }}};
   });
   await page.route('**/*',async route=>{
    const u=new URL(route.request().url());
    if(u.origin===new URL(base).origin)return route.continue();
    if(u.pathname==='/api/me')return route.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify({user:{name:'Admin Tester',role:'ADMIN',email:'test@example.invalid',patientIds:'ALL'}})});
    if(u.pathname==='/api/patients')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({patients:people})});
    if(u.pathname==='/api/medicines')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({medicines:meds})});
    if(u.pathname==='/api/users')return route.fulfill({status:200,contentType:'application/json',body:'{"users":[]}'});
    if(u.hostname==='accounts.google.com'||u.hostname==='cdn.jsdelivr.net')return route.fulfill({status:200,contentType:'application/javascript',body:'// isolated from external services'});
    return route.abort();
   });
   await page.goto(address,{waitUntil:'domcontentloaded'});
   await page.locator('#fakeGoogleButton').waitFor({state:'visible'});
   assert.equal(await page.locator('#home-overview').isVisible(),false);
   await page.locator('#fakeGoogleButton').click();
   await page.waitForFunction(()=>window.Time4MedAuth?.user?.role==='ADMIN');
   await page.waitForFunction(()=>document.getElementById('t21PatientCount')?.textContent==='2');
   await page.waitForFunction(()=>document.getElementById('t21ScheduledCount')?.textContent==='2');
   await page.locator('#home-overview').waitFor({state:'visible'});
   assert.equal(await page.locator('#t21PatientCards article').count(),2);
   assert.match(await page.locator('#t21AttentionList').innerText(),/ใกล้หมด/);
   assert.equal(await page.locator('#devices').isVisible(),false);
   assert.equal(await page.locator('#unlockBtn').isVisible(),false);
   assert.match(await page.locator('#t21PatientCards').innerText(),/พ่อ ทดสอบ/);
   assert.match(await page.locator('#t21PatientCards').innerText(),/แม่ ทดสอบ/);
   assert.equal(await page.locator('#t21PatientFilter button').count(),3);
   await page.locator('#t21PatientFilter button').nth(1).click();
   assert.equal(await page.locator('#t21PatientCards article').count(),1);
   assert.equal(await page.locator('#t21ScheduledCount').innerText(),'1');
   await page.locator('#t21PatientFilter button').nth(0).click();
   assert.equal(await page.locator('#t21PatientCards article').count(),2);
   // New read-only schedule reviewer: never exposes a write/sync button.
   await page.locator('.sidebar-link[href="#medication"]').click();
   await page.locator('.t22-schedule-review').waitFor({state:'visible'});
   await page.waitForFunction(()=>document.getElementById('t22ScheduledSlots')?.textContent==='2');
   assert.equal(await page.locator('#t22ErrorCount').innerText(),'0');
   assert.equal(await page.locator('#sendMealSchedule').count(),0);
   assert.equal(await page.locator('#t22Slots li.valid').count(),2);
   await page.locator('#t22ReviewAgain').click();
   assert.match(await page.locator('#t22ReviewState').innerText(),/ยังไม่ได้ส่ง/);
   // Committee-approved cabinet: shelves belong to patients, never to meal periods.
   await page.locator('.sidebar-link[href="#inventory"]').click();
   await page.locator('#inventory').waitFor({state:'visible'});
   await page.waitForFunction(()=>document.querySelectorAll('#cabinetShelfMap .cabinet-map-shelf').length===5);
   const shelfNames=await page.locator('#cabinetShelfMap .cabinet-map-shelf h3').allInnerTexts();
   for(const [i,label] of ['ชั้น 1 — P001','ชั้น 2 — P002','ชั้น 3 — P003','ชั้น 4 — ยาสามัญประจำบ้าน'].entries())
      assert.match(shelfNames[i],new RegExp(label),'cabinet shelf '+(i+1));
   await page.locator('#inventorySlotFilter').selectOption('P001');
   assert.equal(await page.locator('#inventoryItems .inventory-item').count(),1,'P001 medicine remains on shelf 1');
   await page.locator('#inventorySlotFilter').selectOption('P002');
   assert.equal(await page.locator('#inventoryItems .inventory-item').count(),2,'P002 scheduled and PRN stay on shelf 2');
   await page.locator('#inventorySlotFilter').selectOption('common');
   assert.equal(await page.locator('#inventoryItems .inventory-item').count(),0,'PRN is not auto-classified as household medicine');
   await page.locator('.sidebar-link[href="#medication"]').click();
   await page.locator('#medicinePatientId').selectOption('P002');
   assert.equal(await page.locator('#medicineShelfPreview').innerText(),'ชั้น 2 — P002');
   await page.locator('#medicineMeal').selectOption('7');
   assert.equal(await page.locator('#medicineShelfPreview').innerText(),'ชั้น 2 — P002','bedtime changes meal, not shelf');
   await page.locator('#medicinePatientId').selectOption('P001');
   assert.equal(await page.locator('#medicineShelfPreview').innerText(),'ชั้น 1 — P001');
   await page.locator('.sidebar-link[href="#devices"]').click();
   await page.locator('#devices').waitFor({state:'visible'});
   assert.equal(await page.locator('#home-overview').isVisible(),false);
   assert.equal(await page.locator('#unlockBtn').isVisible(),true);
   await page.locator('.sidebar-link[href="#dashboard"]').click();
   await page.locator('#home-overview').waitFor({state:'visible'});
   const width=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
   assert.ok(width<=4,'unexpected horizontal scroll on viewport '+viewport.width+': '+width);
   await page.locator('#t4mSignOut').click();
   await page.locator('#t4mAuthScreen').waitFor({state:'visible'});
   assert.equal(await page.locator('#home-overview').isVisible(),false);
   await page.waitForFunction(()=>document.getElementById('t21PatientCount')?.textContent==='—');
   assert.deepEqual(errors,[],'browser exceptions');
   console.log('PASS v0.21 viewport '+viewport.width+'x'+viewport.height);
   await context.close();
  }
 }finally{if(browser)await browser.close();server.kill();}
}
main().catch(e=>{console.error(e);process.exitCode=1});
