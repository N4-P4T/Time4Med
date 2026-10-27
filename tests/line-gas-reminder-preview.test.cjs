const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=['SheetPreview.gs','ReminderPreview.gs']
 .map(n=>fs.readFileSync('integrations/line-apps-script/'+n,'utf8'))
 .join('\n');
const HEAD_M=['record_id','patient','name','kind','meal_type','shelf','box_number','reminder_time','instruction','stock_status','status_updated_at','created_at','updated_at','is_active','source','patient_id'];
const HEAD_U=['user_id','email','display_name','role','patient_id','line_user_id','notification_enabled','status','created_at','updated_at'];
const A='U'+'a'.repeat(32),B='U'+'b'.repeat(32),C='U'+'c'.repeat(32);
const SHEET_ID='a'.repeat(35);
function med(id,patient,name,meal,box,time,active='TRUE',kind='scheduled'){
 const row=Array(16).fill('');
 row[0]=id;row[2]=name;row[3]=kind;row[4]=meal;
 row[6]=box;row[7]=time;row[13]=active;row[15]=patient;return row;
}
function user(id,role,scope,line,enable='TRUE',status='ACTIVE'){
 const row=Array(10).fill('');
 row[0]=id;row[3]=role;row[4]=scope;row[5]=line;
 row[6]=enable;row[7]=status;return row;
}
function mockSheet(rows){
 return{
  getLastColumn:()=>rows[0]?.length||0,
  getLastRow:()=>rows.length,
  getRange:(row,col,count,width)=>({
   getDisplayValues:()=>rows.slice(row-1,row-1+count).map(r=>r.slice(col-1,col-1+width))
  })
 };
}
function fixture(overrides={}){
 const meds=overrides.meds||[
  HEAD_M,
  med('1','P001','TEST_P001','2','01','17:02'),
  med('2','P002','TEST_P002','6','02','18:30')
 ];
 const users=overrides.users||[
  ['Users title'],['Subtitle'],[],HEAD_U,
  user('owner','ADMIN','ALL',A),
  user('care','CAREGIVER','P001,P002','', 'FALSE'),
  user('member','USER','P001',C)
 ];
 const sheetMap={MealMedicines:mockSheet(meds),Users:mockSheet(users.slice(3))};
 // Preserve original Users's row 4 header rather than trimming it in mock:
 const headers=users.slice(0,3);
 sheetMap.Users={
  getLastColumn:()=>HEAD_U.length,
  getLastRow:()=>users.length,
  getRange:(row,col,count,width)=>({
   getDisplayValues:()=>users.slice(row-1,row-1+count).map(r=>r.slice(col-1,col-1+width))
  })
 };
 const calls=[],logs=[];
 const context={
  PropertiesService:{getScriptProperties:()=>({
   getProperty:k=>k==='TIME4MED_SHEET_ID'?(overrides.sheetId??SHEET_ID):null
  })},
  SpreadsheetApp:{openById:id=>{
   calls.push({action:'openById',id});return {
    getSheetByName:n=>sheetMap[n]||null
   };
  }},
  Utilities:{formatDate:(date,tz,format)=>{
   assert.equal(tz,'Asia/Bangkok');assert.equal(format,'HH:mm');
   return overrides.localTime||'08:00';
  }},
  console:{log:value=>logs.push(String(value))}
 };
 vm.runInNewContext(source,context,{timeout:4000});
 return {context,calls,logs};
}
test('current real-sheet-like TEST_ data: no eligible meds or sends',()=>{
 const f=fixture();
 const r=f.context.previewTime4MedReminderPlan();
 assert.equal(r.mode,'PREVIEW_ONLY_NO_NOTIFICATIONS');
 assert.equal(r.medicineRecords.active,2);
 assert.equal(r.medicineRecords.excludedDemo,2);
 assert.equal(r.medicineRecords.groupedSlots,0);
 assert.equal(r.recipientAccounts,1);
 assert.equal(r.recipientsWithDueCandidates,0);
 assert.equal(r.wouldSendNow,false);
 assert.equal(f.calls.length,1);
 assert.ok(f.logs.every(s=>!s.includes(A)&&!s.includes('TEST_P001')));
});
test('multiple real medicines for same meal group into one slot per patient',()=>{
 const f=fixture({meds:[
  HEAD_M,
  med('1','P001','Vitamin B','1','01','08:00'),
  med('2','P001','Calcium','1','1','08:00'),
  med('3','P003','Other Med','2','03','08:00'),
  med('4','P002','Other Med 2','2','02','09:00'),
  med('5','P001','TEST_FOO','1','01','08:00'),
  med('6','P003','Something','1','04','08:00'),
 ],
 users:[['title'],['desc'],[],HEAD_U,
  user('admin','ADMIN','ALL',A),
  user('care1','CAREGIVER','P001',B),
  user('duplicate','CAREGIVER','P001',B),
  user('inactive','CAREGIVER','P003',C,'FALSE'),
  user('user','USER','P003',C)
 ]});
 const r=f.context.previewTime4MedReminderPlan();
 assert.equal(r.medicineRecords.validMedicineRecords,4);
 assert.equal(r.medicineRecords.groupedSlots,3);
 assert.equal(r.medicineRecords.excludedDemo,1);
 assert.equal(r.medicineRecords.excludedMalformed,1);
 assert.equal(r.recipientAccounts,2);
 assert.equal(r.candidateMealSlotsDueAtTime,2);
 assert.equal(r.recipientsWithDueCandidates,2);
 assert.equal(r.wouldSendNow,false);
 assert.ok(f.logs.every(s=>![A,B,C,'Vitamin B','Calcium'].some(secret=>s.includes(secret))));
});
test('caregiver P002 scope does not get P001 due candidates',()=>{
 const f=fixture({meds:[HEAD_M,med('1','P001','Drug','1','01','08:00')],
 users:[['title'],['desc'],[],HEAD_U,
  user('care','CAREGIVER','P002',B)
 ]});
 const r=f.context.previewTime4MedReminderPlan();
 assert.equal(r.recipientAccounts,1);
 assert.equal(r.candidateMealSlotsDueAtTime,1);
 assert.equal(r.recipientsWithDueCandidates,0);
});
test('invalid caregiver ALL and unknown patient scopes are rejected',()=>{
 const f=fixture({meds:[HEAD_M,med('1','P001','Drug','1','01','08:00')],
 users:[['title'],['desc'],[],HEAD_U,
  user('care','CAREGIVER','ALL',B),
  user('care2','CAREGIVER','P001,P004',C),
  user('admin','ADMIN','ALL',A)
 ]});
 const r=f.context.previewTime4MedReminderPlan();
 assert.equal(r.recipientAccounts,1);
 assert.equal(r.recipientsWithDueCandidates,1);
});
test('time matching is preview only and not an actual scheduled trigger',()=>{
 const f=fixture({localTime:'09:00',meds:[HEAD_M,
  med('1','P001','Drug','1','01','08:00'),
  med('2','P002','Drug','1','02','09:00')
 ]});
 const r=f.context.previewTime4MedReminderPlan();
 assert.equal(r.selectedTime,'09:00');
 assert.equal(r.candidateMealSlotsDueAtTime,1);
 assert.equal(r.wouldSendNow,false);
});
test('invalid property fails closed with no Sheets reads',()=>{
 const f=fixture({sheetId:'invalid'});
 assert.throws(()=>f.context.previewTime4MedReminderPlan(),/SHEET_ID_MISSING_OR_INVALID/);
 assert.equal(f.calls.length,0);
});
test('source has no external push, write or trigger API',()=>{
 const script=fs.readFileSync('integrations/line-apps-script/ReminderPreview.gs','utf8');
 assert.doesNotMatch(script,/UrlFetchApp[.]fetch|ScriptApp[.]newTrigger|[.]appendRow\s*\(|[.]setValue\s*\(|function\s+doPost\s*\(/);
 assert.match(script,/mode:'PREVIEW_ONLY_NO_NOTIFICATIONS'/);
 assert.match(script,/Asia\/Bangkok/);
});
