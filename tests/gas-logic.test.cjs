/** Offline unit checks for Time4Med Apps Script Code.gs.
 * These do not establish Google/LINE/hardware end-to-end readiness. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const file = path.join(__dirname, '..', 'apps-script', 'Code.gs');
const context = vm.createContext({console,Date,JSON,Set,Map,Math,Number,String,Boolean,Array,RegExp,Error,Object,parseInt,isNaN});
vm.runInContext(fs.readFileSync(file, 'utf8'), context, {filename: 'Code.gs'});
const call = (code) => vm.runInContext(code,context);
const equal=(a,b)=>assert.equal(a,b);
equal(call('fixedShelf_("P001")'),1);
equal(call('fixedShelf_("P002")'),2);
equal(call('fixedShelf_("P003")'),3);
equal(call('fixedShelf_("P004")'),null);
equal(call('mealShelf_(1)'), 'morning');
equal(call('mealShelf_(4)'), 'midday');
equal(call('mealShelf_(6)'), 'evening');
equal(call('mealShelf_(7)'), 'bedtime');
equal(call('normalizedTime_("8:05")'), '08:05');
equal(call('normalizedTime_("08:05")'), '08:05');
equal(call('normalizedTime_("8:05:00")'), '08:05');
equal(call('normalizedTime_("19:59")'), '19:59');
equal(call('normalizedTime_("24:00")'), '');
equal(call('normalizedTime_("8:5")'), '');
equal(call('safeMedicine_({patient_id:"P003",name:"TEST_GAS_P003",reminder_time:"8:05"}).time'),'08:05');
assert.equal(call('days_("MON,WED,FRI")'),'MON,WED,FRI');
assert.equal(call('days_("")'),'MON,TUE,WED,THU,FRI,SAT,SUN');
assert.equal(call('validDaysForSchedule_("INVALID","MON")'),false);
assert.equal(call('parseDateTime_("2026-10-29T12:00:00Z").toISOString()'),'2026-10-29T12:00:00.000Z');
assert.equal(call('parseDateTime_("2026-10-29 12:00:00").toISOString()'),'2026-10-29T05:00:00.000Z');
call(`
  const sampleUser={id:'U100',email:'caregiver@sample.org',name:'ผู้ดูแล',role:'CAREGIVER',patientIds:['P001']};
  session_=()=>sampleUser;
  grid_=(name)=>({rows:({
    Patients:[
      {data:{patient_id:'P001',display_name:'หนึ่ง',status:'ACTIVE'}},
      {data:{patient_id:'P002',display_name:'สอง',status:'ACTIVE'}}],
    MealMedicines:[
      {data:{record_id:'a',patient_id:'P001',name:'ตัวอย่างหนึ่ง',meal_type:'1',is_active:'TRUE'}},
      {data:{record_id:'b',patient_id:'P002',name:'ตัวอย่างสอง',meal_type:'3',is_active:'TRUE'}}],
    ActivityLog:[
      {data:{patient_id:'ALL',event_type:'USER_SAVED',details:'admin@example.com'}},
      {data:{patient_id:'ALL',event_type:'EMERGENCY',details:'ฉุกเฉินส่วนกลาง'}},
      {data:{patient_id:'P001',event_type:'INTAKE_CONFIRMED',details:'รับยา'}},
      {data:{patient_id:'P002',event_type:'INTAKE_CONFIRMED',details:'ของผู้อื่น'}}],
    ImageIndex:[{data:{image_id:'img1',patient_id:'P001'}},{data:{image_id:'img2',patient_id:'P002'}}],
    Devices:[],Users:[]
  })[name]||[]});
  tzNow_=()=> '2026-10-29 12:00:00';
`);
const data=JSON.parse(JSON.stringify(call('bootstrap("unit-test")')));
assert.deepEqual(data.patients.map(x=>x.id),['P001']);
assert.deepEqual(data.medicines.map(x=>x.patientId),['P001']);
assert.deepEqual(data.images.map(x=>x.patientId),['P001']);
assert.deepEqual(data.activity.map(x=>x.type),['INTAKE_CONFIRMED','EMERGENCY']);
assert.equal(data.users.length,0);
assert.equal(data.activity.some(x=>x.details.includes('@')),false);
call(`
  let events=[];let sent=[];
  logActivity_=(p,device,kind,detail)=>events.push({p,device,kind,detail});
  lineTo_=(id,message)=>sent.push({id,message});
  deviceAuthenticated_=(key)=>key==='valid-for-test';
  userForEmail_=(email)=>({email,role:'CAREGIVER',patientIds:['P001'],lineId:'line-recipient',lineEnabled:true});
  grid_=(name)=>name==='Users'?({rows:[{data:{email:'user@sample.org'}}]}):({rows:[]});
  deviceResult=postDevice_({postData:{contents:JSON.stringify({action:'emergency',deviceKey:'valid-for-test',deviceId:'S3-001',patientId:'ALL'})}});
`);
const incident=JSON.parse(JSON.stringify(call('deviceResult')));
equal(incident.ok,true);equal(incident.patientId,'ALL');
assert.deepEqual(JSON.parse(JSON.stringify(call('events'))).map(x=>x.p),['ALL']);
equal(call('sent.length'),1);
assert.throws(()=>call('postDevice_({postData:{contents:JSON.stringify({action:"intake",deviceKey:"valid-for-test",patientId:"ALL"})}})'),/INVALID_PATIENT_ID/);
// A single S3 pull must provide only real, valid schedules and explicit
// 12-LED mapping (no guessed physical GPIO, no shelf-4 lights).
for(let n=1;n<=7;n++){
  equal(call('mealLedSlot_('+n+')'),n<=2?1:n<=4?2:n<=6?3:4);
}
equal(call('mealLedSlot_(0)'),0);
equal(call('mealLedSlot_(8)'),0);
const samples=[];
for(let shelf=1;shelf<=3;shelf++)for(let meal=1;meal<=7;meal++)samples.push({
  id:'P'+shelf+'-meal-'+meal,
  patientId:'P00'+shelf,
  shelf,
  mealType:meal,
  time:'08:30',
  days:'MON,FRI',
  kind:'scheduled',
  active:true,
  demo:false
});
samples.push(
  {...samples[0],id:'',mealType:3},
  {...samples[0],id:'bad-demo',demo:true},
  {...samples[0],id:'bad-prn',kind:'PRN'},
  {...samples[0],id:'bad-time',time:'25:00'},
  {...samples[0],id:'bad-days',days:'FUNDAY'},
  {...samples[0],id:'bad-meal',mealType:8},
  {...samples[0],id:'bad-shelf',shelf:4},
  {...samples[0],id:'bad-inactive',active:false}
);
context.snapshotFixture=samples;
const snapshot=JSON.parse(JSON.stringify(call('deviceScheduleSnapshot_(snapshotFixture)')));
equal(snapshot.length,21);
assert.deepEqual(snapshot.filter(x=>x.patientId==='P001').map(x=>x.ledSlot),[1,1,2,2,3,3,4]);
assert.deepEqual(snapshot.filter(x=>x.patientId==='P002').map(x=>x.ledIndex),[4,4,5,5,6,6,7]);
assert.deepEqual(snapshot.filter(x=>x.patientId==='P003').map(x=>x.ledIndex),[8,8,9,9,10,10,11]);
assert.ok(snapshot.every(x=>x.days==='MON,FRI'));
assert.ok(snapshot.every(x=>x.shelf<=3 && x.ledIndex>=0 && x.ledIndex<=11));
const tooBad=JSON.parse(JSON.stringify(call('deviceScheduleSnapshot_([snapshotFixture[21],snapshotFixture[22],snapshotFixture[23]])')));
equal(tooBad.length,0);
// Users sheet currently has duplicate LINE destination for two ADMIN rows.
// Both emergency modes should alert each destination once per button event.
call(`
  sent=[];
  grid_=(name)=>name==='Users'?{rows:[
    {data:{email:'admin-one@example.org'}},
    {data:{email:'admin-two@example.org'}}
  ]}:{rows:[]};
  postDevice_({postData:{contents:JSON.stringify({
    action:'emergency',deviceKey:'valid-for-test',deviceId:'S3-001',patientId:'ALL'
  })}});
`);
equal(call('sent.length'),1);
call(`
  sent=[];
  postDevice_({postData:{contents:JSON.stringify({
    action:'emergency',deviceKey:'valid-for-test',deviceId:'S3-001',patientId:'P001'
  })}});
`);
equal(call('sent.length'),1);
// Apps Script time-driven triggers may run one or two minutes late.
// Use the scheduled Bangkok minute/day, not the trigger's current weekday.
// Unit-test both a normal time and the Friday -> Saturday midnight rollover.
context.Utilities={
  formatDate:(instant,timezone,pattern)=>{
    assert.equal(timezone,'Asia/Bangkok');
    const bangkok=new Date(instant.getTime()+7*60*60*1000);
    if(pattern==='yyyy-MM-dd HH:mm')return bangkok.toISOString().slice(0,16).replace('T',' ');
    if(pattern==='u')return String(((bangkok.getUTCDay()+6)%7)+1);
    throw Error('Unexpected Apps Script date format: '+pattern);
  }
};
const minutes=JSON.parse(JSON.stringify(call("recentReminderSlots_(new Date('2026-10-30T01:02:19Z'))")));
assert.deepEqual(minutes,[
  {date:'2026-10-30',time:'08:02',day:'FRI'},
  {date:'2026-10-30',time:'08:01',day:'FRI'},
  {date:'2026-10-30',time:'08:00',day:'FRI'}
]);
const midnight=JSON.parse(JSON.stringify(call("recentReminderSlots_(new Date('2026-10-30T17:01:45Z'))")));
assert.deepEqual(midnight,[
  {date:'2026-10-31',time:'00:01',day:'SAT'},
  {date:'2026-10-31',time:'00:00',day:'SAT'},
  {date:'2026-10-30',time:'23:59',day:'FRI'}
]);
assert.equal(midnight.some(x=>x.time==='23:58'),false,'no late catch-up beyond two minutes');
console.log('OK: LINE reminder grace window and Bangkok midnight rollover');

console.log('OK: valid S3 schedule snapshot, 12 LED indices and duplicate-free emergency LINE');

console.log('OK: shelf mapping, meal LEDs, Sheets time normalization, days, date parsing, caregiver permissions, cabinet-wide emergency, intake validation');

/* GitHub Pages → Apps Script migration static/parse smoke checks. */
const webClient = fs.readFileSync(path.join(__dirname, '..','test-v021','gas-only.js'),'utf8');
const webIndex = fs.readFileSync(path.join(__dirname, '..','test-v021','index.html'),'utf8');
const rootIndex = fs.readFileSync(path.join(__dirname, '..','index.html'),'utf8');
const bridgeHtml = fs.readFileSync(path.join(__dirname, '..','apps-script','Bridge.html'),'utf8');
new vm.Script(webClient,{filename:'gas-only.js'});
const bridgeSource = bridgeHtml.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(bridgeSource,'Bridge.html includes client script');
new vm.Script(bridgeSource[1].replace('<?= channel ?>','unit-test-channel'),{filename:'Bridge.html'});
assert.match(webIndex,/src="gas-only\.js(?:\?v=[a-zA-Z0-9-]+)?"/);
assert.doesNotMatch(webIndex,/src="\.\.\/test-v019\/auth-config\.js"/);
assert.doesNotMatch(webIndex,/src="mqtt-live-status\.js"/);
assert.doesNotMatch(webIndex,/src="gateway-control\.js"/);
assert.match(webClient,/crypto\.getRandomValues/);
assert.match(bridgeHtml,/event\.origin !== allowedOrigin/);
assert.match(bridgeHtml,/requestOtp: true, verifyOtp: true, bootstrap: true/);
assert.match(fs.readFileSync(file,'utf8'),/setXFrameOptionsMode\(HtmlService\.XFrameOptionsMode\.ALLOWALL\)/);
assert.match(rootIndex,/window\.location\.replace\(document\.getElementById\('enter'\)\.href\)/);
assert.match(rootIndex,/href="\.\/test-v021\/"/);
assert.doesNotMatch(rootIndex,/script\.google\.com\/macros\/s\//);
assert.doesNotMatch(webClient,/window\.location\.replace\(WEB_APP\)/);
equal(call('time4medWebsiteUrl_()'),'https://n4-p4t.github.io/Time4Med/');

/* iPhone/Safari: when the embedded google.script.run callback times out, the
   frontend offers the already-deployed Google Apps Script page without
   automatically requesting OTP again. Never expose the OTP in a URL. */
const fallbackStart=webClient.indexOf('function showDirectFallback(');
const fallbackEnd=webClient.indexOf('function startAuth()',fallbackStart);
assert.ok(fallbackStart>=0&&fallbackEnd>fallbackStart,'mobile fallback helper exists');
const fallbackElements={
  gasDirectFallback:{hidden:true},gasFallbackNote:{hidden:true,textContent:''},
  gasOtpVerify:{hidden:true}
};
const reported=[];
const fallbackSandbox={Error,$:id=>fallbackElements[id],message:(s,bad)=>reported.push({s,bad})};
vm.runInNewContext(webClient.slice(fallbackStart,fallbackEnd)+'\nthis.onError=handleOtpTransportError;',fallbackSandbox);
fallbackSandbox.onError(new Error('Apps Script ตอบสนองช้าเกินไป กรุณาลองใหม่'),'request');
assert.equal(fallbackElements.gasDirectFallback.hidden,false);
assert.equal(fallbackElements.gasFallbackNote.hidden,false);
assert.equal(fallbackElements.gasOtpVerify.hidden,false,'code field available when OTP may have been sent');
assert.ok(reported.some(x=>x.bad && x.s.includes('OTP อาจส่งแล้ว')));
assert.doesNotMatch(webClient,/if\(\/iPhone\|iPad\|iPod\/i\.test\(navigator\.userAgent\)\)/);
assert.match(webClient,/id="gasDirectFallback"[^\n]*WEB_APP/);
assert.doesNotMatch(webClient,/showDirectFallback[\s\S]{0,300}requestOtp\(/);
console.log('OK: iPhone Apps Script fallback exposed after timeout; OTP not retried automatically');

console.log('OK: GitHub frontend syntax, iframe bridge whitelist/origin and legacy client isolation');
