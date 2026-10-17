/**
 * Browser integration tests for Time4Med caregiver navigation.
 * Runs against a local HTTP server and intercepts ALL external requests.
 * Never connects to HiveMQ or commands an actual cabinet.
 */
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const HOST = 'http://127.0.0.1:8765/';
const demo = [{
  id:'demo-a', kind:'scheduled', time:'08:30',
  patient:'ผู้สูงอายุ A', name:'ยาตัวอย่าง A', boxNumber:'1',
  stockStatus:'low', mealType:2, instruction:''
},{
  id:'demo-b', kind:'scheduled', time:'20:00',
  patient:'ผู้สูงอายุ B', name:'ยาตัวอย่าง B', boxNumber:'',
  stockStatus:'unchecked', mealType:7, instruction:''
},{
  id:'demo-c', kind:'prn', time:'',
  patient:'ผู้สูงอายุ A', name:'ยาตัวอย่าง PRN', boxNumber:'2',
  stockStatus:'ok', mealType:'prn', instruction:'ตามอาการ'
}];

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(HOST, {signal: AbortSignal.timeout(1000)});
      if (res.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 180));
  }
  throw new Error('Local web server never became ready');
}

async function run() {
  const server = spawn('python3',['-m','http.server','8765','--bind','127.0.0.1'],
                       {cwd:process.cwd(),stdio:'ignore'});
  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch({headless:true,args:['--no-sandbox']});
    for(const viewport of [{width:1440,height:900},{width:390,height:844}]) {
      const ctx=await browser.newContext({viewport});
      const page=await ctx.newPage();
      const pageErrors=[];
      page.on('pageerror', e=>pageErrors.push(String(e)));
      await page.route('**/*',async route=>{
        const url=route.request().url();
        if(url === HOST+'mqtt-config.js') {
          // Prevent loading the credential formerly embedded in the public site.
          return route.fulfill({status:200,contentType:'application/javascript',
            body:'window.TIME4MED_MQTT_CONFIG = {brokerUrl:"wss://example.invalid/mqtt",username:"test",password:""};'});
        }
        if(url.includes('cdn.jsdelivr.net/npm/mqtt')) {
          return route.fulfill({status:200,contentType:'application/javascript',
            body:'window.mqtt={connect:()=>{throw Error("Unsafe production connection in smoke test")}}'});
        }
        if(url.startsWith(HOST)) return route.continue();
        // No requests to HiveMQ, Google Apps Script, camera IP, or other remote hosts.
        return route.abort();
      });
      await page.addInitScript((medicines)=>{
        localStorage.setItem('time4medMedicines',JSON.stringify(medicines));
      },demo);
      await page.goto(HOST+'#dashboard',{waitUntil:'domcontentloaded'});
      await page.locator('#home-overview').waitFor({state:'visible'});
      await page.waitForFunction(()=>
        document.getElementById('homeTodaySchedule').textContent.includes('08:30'));
      assert.equal(await page.locator('#devices').isVisible(),false,
        'Device controls must be hidden on dashboard');
      assert.equal(await page.locator('#analytics').isVisible(),false);
      assert.equal(await page.locator('#home-overview').isVisible(),true);
      assert.equal(await page.locator('#totalMedicineCount').innerText(),'3');
      assert.equal(await page.locator('#takenMedicineCount').innerText(),'2');
      assert.equal(await page.locator('#waitingMedicineCount').innerText(),'1');
      assert.match(await page.locator('#homeAttentionItems').innerText(),/หมายเลขกล่อง/);
      assert.match(await page.locator('#homeAttentionItems').innerText(),/ใกล้หมด/);

      await page.locator('.sidebar-link[href="#devices"]').click();
      assert.equal(await page.locator('#home-overview').isVisible(),false);
      assert.equal(await page.locator('#devices').isVisible(),true);
      assert.equal(await page.locator('#unlockBtn').isVisible(),true);
      assert.equal(await page.locator('#medication').isVisible(),false);

      await page.locator('.sidebar-link[href="#medication"]').click();
      assert.equal(await page.locator('#medication').isVisible(),true);
      assert.equal(await page.locator('#devices').isVisible(),false);

      await page.goto(HOST+'#dashboard',{waitUntil:'domcontentloaded'});
      await page.locator('#home-overview').waitFor({state:'visible'});
      await page.locator('.home-device-shortcut a[href="#devices"]').click();
      await page.waitForURL('**/#devices');
      assert.equal(await page.locator('#devices').isVisible(),true,
        'Dashboard shortcut must navigate to actual devices panel');

      await page.evaluate(()=>window.time4medHomeTimelineUpdated([
        {event_type:'MEDICINE_CONFIRMED',result:'SUCCESS'},
        {event_type:'MEDICINE_CONFIRMED',result:'FAILED'}
      ],true));
      assert.equal(await page.locator('#homeConfirmationEvents').innerText(),'1 เหตุการณ์');

      // Ensure mobile navigation / dashboard do not create horizontal scrollbars.
      await page.locator('.sidebar-link[href="#dashboard"]').click();
      const box=await page.evaluate(()=>({
        fullWidth:document.documentElement.scrollWidth,
        viewportWidth:window.innerWidth
      }));
      assert.ok(box.fullWidth<=box.viewportWidth+3,
        'horizontal overflow: '+JSON.stringify(box));

      assert.deepEqual(pageErrors,[], 'uncaught JavaScript page errors');
      console.log('PASS browser viewport '+viewport.width+'x'+viewport.height);
      await ctx.close();
    }
  } finally {
    if(browser) await browser.close();
    server.kill();
  }
}

run().catch(error=>{console.error(error);process.exitCode=1});
