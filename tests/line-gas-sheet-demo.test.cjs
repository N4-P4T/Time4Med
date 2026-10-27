const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const code=['Code.gs','SheetPreview.gs','SheetLineDemo.gs']
  .map(name=>fs.readFileSync('integrations/line-apps-script/'+name,'utf8')).join('\n');
const userId='U'+'1'.repeat(32);
const medHeader=['record_id','patient','name','kind','meal_type','shelf','box_number','reminder_time','instruction','stock_status','status_updated_at','created_at','updated_at','is_active','source','patient_id'];
function med(name,active,patient,box,time,kind='scheduled'){
 const row=Array(16).fill('');
 row[0]='r_'+name;row[2]=name;row[3]=kind;row[4]='2';
 row[6]=box;row[7]=time;row[13]=active;row[15]=patient;
 return row;
}
function makeTest(opts={}){
 const properties=new Map(Object.entries({
  LINE_CHANNEL_ACCESS_TOKEN:'test-token-which-is-not-a-real-secret',
  LINE_TEST_USER_ID:userId,TIME4MED_SHEET_ID:'a'.repeat(35),
  ...(opts.properties||{})
 }));
 const rows=opts.rows||[
  medHeader,
  med('TEST_P001','TRUE','P001','01','17:02'),
  med('TEST_P002','TRUE','P002','02','18:30'),
  med('Real Medicine','TRUE','P001','01','08:00')
 ];
 const calls=[],logs=[];
 const sheet={
  getLastColumn:()=>medHeader.length,
  getLastRow:()=>rows.length,
  getRange:(row,col,count,cols)=>({
   getDisplayValues:()=>rows.slice(row-1,row-1+count)
     .map(v=>v.slice(col-1,col-1+cols))
  })
 };
 const context={
  PropertiesService:{getScriptProperties:()=>({
   getProperty:key=>properties.get(key)||null,
   setProperty:(key,val)=>{properties.set(key,val);}
  })},
  SpreadsheetApp:{openById:id=>{
   assert.equal(id,'a'.repeat(35));
   return {getSheetByName:n=>n==='MealMedicines'?sheet:null};
  }},
  UrlFetchApp:{fetch:(url,request={})=>{
   calls.push({url,request});
   const response=(status,value)=>({
    getResponseCode:()=>status,
    getContentText:()=>JSON.stringify(value)
   });
   if(url.endsWith('/message/quota'))return response(200,{type:'limited',value:300});
   if(url.endsWith('/message/quota/consumption'))
    return response(200,{totalUsage:opts.usage??0});
   if(url.endsWith('/message/push'))
    return response(opts.pushStatus??200,{});
   if(url.endsWith('/info'))return response(200,{basicId:'@test'});
   throw Error('unexpected request');
  }},
  LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
  Utilities:{getUuid:()=> '123e4567-e89b-42d3-a456-426614174000'},
  console:{log:x=>logs.push(String(x))}
 };
 vm.runInNewContext(code,context,{timeout:3000});
 return {context,properties,calls,logs};
}

test('read-only preview detects two TEST_ rows, not real medicine',()=>{
 const t=makeTest();
 const r=t.context.previewSheetLineDemo();
 assert.equal(r.availableDemoRecords,2);
 assert.equal(r.selected.patient,'P001');
 assert.equal(r.selected.time,'17:02');
 assert.equal(r.messageSent,false);
 assert.equal(t.calls.length,0);
});

test('sending is disabled by default even if prior test confirmation is YES',()=>{
 const t=makeTest({properties:{LINE_TEST_CONFIRM:'YES'}});
 assert.throws(()=>t.context.sendSheetLineDemoOnce(),/LINE_SHEET_TEST_NOT_CONFIRMED/);
 assert.equal(t.calls.length,0);
});

test('one-time message includes demo times and never real medicine or LINE user ID',()=>{
 const t=makeTest({properties:{LINE_SHEET_TEST_CONFIRM:'YES'}});
 const r=t.context.sendSheetLineDemoOnce();
 assert.equal(r.apiAccepted,true);
 assert.equal(r.deliveryConfirmed,false);
 assert.equal(t.properties.get('LINE_SHEET_TEST_STATE'),'API_ACCEPTED');
 const pushes=t.calls.filter(c=>c.url.endsWith('/message/push'));
 assert.equal(pushes.length,1);
 const payload=JSON.parse(pushes[0].request.payload);
 assert.equal(payload.to,userId);
 assert.equal(payload.messages.length,1);
 const msg=payload.messages[0].text;
 assert.match(msg,/ข้อมูลทดสอบ P001/);
 assert.match(msg,/17:02/);
 assert.match(msg,/ไม่ใช่การแจ้งให้รับประทานยาจริง/);
 assert.doesNotMatch(msg,/Real Medicine|TEST_P001|TEST_P002/);
 assert.ok(t.logs.every(x=>!x.includes(userId)&&!x.includes('test-token')));
 assert.throws(()=>t.context.sendSheetLineDemoOnce(),/LINE_SHEET_TEST_ALREADY_ATTEMPTED/);
 assert.equal(t.calls.filter(c=>c.url.endsWith('/message/push')).length,1);
});

test('all demo records inactive means no sending',()=>{
 const t=makeTest({properties:{LINE_SHEET_TEST_CONFIRM:'YES'},
  rows:[medHeader,med('TEST_P001','FALSE','P001','01','17:02')]});
 assert.throws(()=>t.context.sendSheetLineDemoOnce(),/LINE_SHEET_NO_ELIGIBLE_DEMO/);
 assert.equal(t.calls.length,0);
});

test('sends no real med even if active and well-formed',()=>{
 const t=makeTest({properties:{LINE_SHEET_TEST_CONFIRM:'YES'},
  rows:[medHeader,med('Paracetamol','TRUE','P001','01','17:02')]});
 assert.throws(()=>t.context.sendSheetLineDemoOnce(),/LINE_SHEET_NO_ELIGIBLE_DEMO/);
 assert.equal(t.calls.length,0);
});

test('invalid compartment or patient excludes demo',()=>{
 const t=makeTest({properties:{LINE_SHEET_TEST_CONFIRM:'YES'},
  rows:[medHeader,med('TEST_P001','TRUE','P001','02','17:02'),
       med('TEST_P004','TRUE','P004','04','17:02')]});
 assert.throws(()=>t.context.sendSheetLineDemoOnce(),/LINE_SHEET_NO_ELIGIBLE_DEMO/);
 assert.equal(t.calls.length,0);
});

test('quota max 250 prevents send',()=>{
 const t=makeTest({properties:{LINE_SHEET_TEST_CONFIRM:'YES'},usage:250});
 assert.throws(()=>t.context.sendSheetLineDemoOnce(),/LINE_SHEET_QUOTA_GUARD/);
 assert.equal(t.calls.filter(c=>c.url.endsWith('/message/push')).length,0);
});

test('ambiguous send failure marks attempted and never auto-retries',()=>{
 const t=makeTest({properties:{LINE_SHEET_TEST_CONFIRM:'YES'},pushStatus:429});
 assert.throws(()=>t.context.sendSheetLineDemoOnce(),/LINE_SHEET_TEST_HTTP_429/);
 assert.equal(t.properties.get('LINE_SHEET_TEST_STATE'),'ATTEMPTED');
 assert.throws(()=>t.context.sendSheetLineDemoOnce(),/LINE_SHEET_TEST_ALREADY_ATTEMPTED/);
 assert.equal(t.calls.filter(c=>c.url.endsWith('/message/push')).length,1);
});

test('invalid test LINE recipient prevents network access',()=>{
 const t=makeTest({properties:{
  LINE_SHEET_TEST_CONFIRM:'YES',LINE_TEST_USER_ID:'U123'
 }});
 assert.throws(()=>t.context.sendSheetLineDemoOnce(),/LINE_SHEET_TEST_USER_ID_INVALID/);
 assert.equal(t.calls.length,0);
});

test('no Sheets mutations or timed trigger in manual integration source',()=>{
 const source=fs.readFileSync('integrations/line-apps-script/SheetLineDemo.gs','utf8');
 assert.doesNotMatch(source,/\.appendRow\s*\(|\.setValue\s*\(|ScriptApp\.newTrigger|function\s+doPost\s*\(/);
 assert.match(source,/LINE_SHEET_TEST_STATE/);
 assert.match(source,/TEST\[_/);
});
