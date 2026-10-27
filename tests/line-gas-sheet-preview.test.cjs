const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');

const source=fs.readFileSync('integrations/line-apps-script/SheetPreview.gs','utf8');
const id='a'.repeat(35),lineId='U'+'0'.repeat(32);
const medHeader=['record_id','patient','name','kind','meal_type','shelf','box_number','reminder_time','instruction','stock_status','status_updated_at','created_at','updated_at','is_active','source','patient_id'];
const userHeader=['user_id','email','display_name','role','patient_id','line_user_id','notification_enabled','status','created_at','updated_at'];

function med(recordId,patient,name,kind,meal,box,time,active) {
  const row=Array(16).fill('');
  Object.assign(row,{0:recordId,2:name,3:kind,4:meal,6:box,7:time,13:active,15:patient});
  return row;
}
function user(userId,role,patients,line,enable,status){
  const r=Array(10).fill('');
  Object.assign(r,{0:userId,3:role,4:patients,5:line,6:enable,7:status});
  return r;
}
function sheet(allRows,headerLine){
  return {
    getLastColumn:()=>allRows[headerLine-1].length,
    getLastRow:()=>allRows.length,
    getRange:(row,col,qty,numCols)=>({
      getDisplayValues:()=>allRows.slice(row-1,row-1+qty).map(x=>x.slice(col-1,col-1+numCols))
    })
  };
}
function fixture(overrides={}){
  const meds=overrides.meds||[
    medHeader,
    med('a','P001','TEST_P001','scheduled','2','01','17:02','TRUE'),
    med('b','P002','TEST_P002','scheduled','6','02','18:30','TRUE'),
    med('c','P001','ยาจริง','scheduled','2','01','08:30','FALSE')
  ];
  const users=overrides.users||[
    ['Users — description'],['info'],[],
    userHeader,
    user('U001','ADMIN','ALL',lineId,'TRUE','ACTIVE'),
    user('U002','CAREGIVER','P001,P002','','FALSE','ACTIVE')
  ];
  const sheets={MealMedicines:sheet(meds,1),Users:sheet(users,4)};
  let opens=0;const logs=[];
  const context={
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>k==='TIME4MED_SHEET_ID'?(overrides.id||id):null})},
    SpreadsheetApp:{openById:key=>{assert.equal(key,id);opens++;return{getSheetByName:n=>sheets[n]};}},
    console:{log:x=>logs.push(String(x))}
  };
  vm.runInNewContext(source,context,{timeout:3000});
  return{context,logs,get opens(){return opens;}};
}

test('current test records are excluded; no LINE calls or writes',()=>{
  const t=fixture();
  const r=t.context.previewTime4MedData();
  assert.equal(r.mode,'READ_ONLY_NO_NOTIFICATIONS');
  assert.equal(r.medicines.scanned,3);
  assert.equal(r.medicines.active,2);
  assert.equal(r.medicines.demoExcluded,2);
  assert.equal(r.medicines.eligible,0);
  assert.equal(r.recipients.eligibleAccounts,1);
  assert.equal(r.recipients.disabledOrInactive,1);
  assert.equal(t.opens,1);
  assert.doesNotMatch(t.logs.join(' '),/TEST_P001|TEST_P002|ยาจริง|U00000000000000000000000000000000/);
});

test('count same time medicines separately without sending twice',()=>{
  const t=fixture({meds:[
    medHeader,
    med('1','P001','วิตามิน','scheduled','1','01','08:00','TRUE'),
    med('2','P001','ยาเอ','scheduled','1','1','08:00','TRUE'),
    med('3','P003','ยาบี','scheduled','7','03','21:00','TRUE'),
    med('4','P003','ยาไม่ตรงช่อง','scheduled','7','04','21:00','TRUE')
  ]});
  const r=t.context.previewTime4MedData();
  assert.equal(r.medicines.eligible,3);
  assert.equal(r.medicines.invalidExcluded,1);
  assert.equal(r.medicines.sameSlotMedicineGroups,1);
  assert.equal(r.medicines.candidateReminders.length,3);
  assert.equal(r.medicines.candidateReminders[0].shelf,1);
});

test('invalid recipient LINE user id blocked',()=>{
  const t=fixture({users:[
    ['users'],['info'],[],userHeader,
    user('a','ADMIN','ALL','U002','TRUE','ACTIVE'),
    user('b','CAREGIVER','P001','U'+'1'.repeat(32),'TRUE','ACTIVE'),
    user('c','CAREGIVER','P002','U'+'2'.repeat(32),'FALSE','ACTIVE')
  ]});
  const r=t.context.previewTime4MedData();
  assert.equal(r.recipients.eligibleAccounts,1);
  assert.equal(r.recipients.invalidOrMissingLineId,1);
  assert.equal(r.recipients.disabledOrInactive,1);
});

test('missing property fails without any read',()=>{
  const t=fixture({id:'invalid'});
  assert.throws(()=>t.context.previewTime4MedData(),/TIME4MED_SHEET_ID_MISSING_OR_INVALID/);
  assert.equal(t.opens,0);
});

test('fail closed on missing schema',()=>{
  const t=fixture({meds:[['name','is_active','patient_id'],['foo','TRUE','P001']]});
  assert.throws(()=>t.context.previewTime4MedData(),/TIME4MED_HEADER_MISSING_MealMedicines/);
});

test('no write, send, webhook, or timer APIs appear in preview source',()=>{
  assert.doesNotMatch(source,/\.setValue\s*\(|\.appendRow\s*\(|UrlFetchApp\s*\.|newTrigger\s*\(|function\s+doPost\s*\(/);
  assert.match(source,/SpreadsheetApp\.openById/);
  assert.match(source,/MealMedicines/);
});
