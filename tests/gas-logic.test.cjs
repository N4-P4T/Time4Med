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
console.log('OK: shelf mapping, meal LEDs, days, date parsing, caregiver permissions, cabinet-wide emergency, intake validation');