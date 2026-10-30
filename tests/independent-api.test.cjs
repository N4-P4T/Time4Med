/** No network test for independent API: mocked Google Sheets OAuth/REST. */
'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {test}=require('node:test');
const {privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
process.env.GOOGLE_SERVICE_ACCOUNT_JSON=JSON.stringify({client_email:'time4med-test@example.iam.gserviceaccount.com',private_key:privateKey.export({format:'pem',type:'pkcs8'}).toString()});
process.env.T4M_SESSION_SECRET='dev-secret-'+crypto.randomBytes(40).toString('hex');
process.env.T4M_SETUP_KEY='setup-'+crypto.randomBytes(40).toString('hex');
const handler=require('../api/rpc.js'),helper=handler._test;
const authCols=['user_id','email','display_name','role','patient_id','status','username','password_hash','line_user_id','notification_enabled','updated_at'];
const data={
 Users:[authCols,
 ['UADMIN','time4med.project@gmail.com','Admin','ADMIN','ALL','ACTIVE','','','','FALSE',''],
 ['UCARE','caregiver@example.com','Caregiver','CAREGIVER','P001','ACTIVE','caregiver01',helper.hashPassword('caregiver-secret-123'),'','FALSE','']],
 Patients:[['patient_id','display_name','status'],['P001','A','ACTIVE'],['P002','B','ACTIVE'],['P003','C','ACTIVE']],
 MealMedicines:[['record_id','patient_id','patient','name','kind','meal_type','shelf','box_number','reminder_time','instruction','is_active','reminder_days','updated_at','created_at','stock_status'],
 ['m1','P001','A','ยาทดสอบ','scheduled','2','1','01','08:00','','TRUE','MON,TUE','','','unchecked'],
 ['m2','P003','C','ยาทดสอบที่ห้ามเห็น','scheduled','7','3','03','20:00','','TRUE','MON,TUE','','','unchecked']],
 ActivityLog:[['event_id','device_id','patient_id','user_id','event_type','result','details','occurred_at']],
 ImageIndex:[['image_id','patient_id','filename','captured_at','available','transfer_status','drive_file_id']],
 Devices:[['device_id','device_type','last_seen','online_status','lock_status']]
};
function sheetFromEncoded(encoded){
 const match=decodeURIComponent(encoded).match(/^'([^']+)'!/);
 if(!match||!Object.hasOwn(data,match[1]))throw Error('Unknown sheet: '+encoded);
 return match[1];
}
function colIndex(letters){
 let n=0;for(const c of letters)n=n*26+(c.charCodeAt(0)-64);return n-1;
}
function response(obj,code=200){return {ok:code>=200&&code<300,status:code,json:async()=>obj,arrayBuffer:async()=>Buffer.from('')};}
global.fetch=async (url,options={})=>{
 const u=new URL(url);
 if(u.hostname==='oauth2.googleapis.com')return response({access_token:'mock-ya29',expires_in:3600});
 if(u.pathname.endsWith('/values:batchUpdate')){
  const value=JSON.parse(options.body);
  for(const item of value.data){
   const m=item.range.match(/^'([^']+)'!([A-Z]+)(\d+)$/);
   if(!m)throw Error('Invalid cell range '+item.range);
   const sh=m[1],x=colIndex(m[2]),y=Number(m[3])-(sh==='MealMedicines'?1:4);
   if(!data[sh][y])throw Error('Missing sheet row '+sh+' '+y);
   data[sh][y][x]=item.values[0][0];
  }
  return response({});
 }
 if(u.hostname==='sheets.googleapis.com'){
  const after=decodeURIComponent(u.pathname.split('/values/')[1]||'');
  const sheet=sheetFromEncoded(after),method=options.method||'GET';
  if(method==='GET')return response({values:data[sheet]});
  if(after.endsWith(':append')){
   const values=JSON.parse(options.body).values;
   for(const row of values)data[sheet].push(row);
   return response({updates:{updatedRows:values.length}});
  }
  throw Error('Unexpected sheets request: '+method+' '+u.pathname);
 }
 throw Error('No fake response '+url);
};
function call(method,args,origin='https://n4-p4t.github.io'){
 const req={method:'POST',headers:{origin},body:{method,args}};
 const res={code:null,headers:{},setHeader(key,val){this.headers[key]=val;return this;},
  status(code){this.code=code;return this;},json(payload){this.data=payload;return this;},end(){return this;}};
 return handler(req,res).then(()=>res);
}
test('safe password hashing and roles',()=>{
 const hash=helper.hashPassword('correct-horse-long-password');
 assert.ok(hash.startsWith('scrypt$16384$8$1$'));
 assert.equal(helper.passwordOK('correct-horse-long-password',hash),true);
 assert.equal(helper.passwordOK('wrong-password',hash),false);
 assert.equal(helper.identity({data:{user_id:'u',email:'x@y.z',role:'CAREGIVER',status:'ACTIVE',patient_id:'P001'}}).patientIds[0],'P001');
 assert.equal(helper.identity({data:{role:'CAREGIVER',status:'INACTIVE',patient_id:'P001'}}),null);
});
test('one-time Admin setup + password login + restricted caregiver data',async()=>{
 const setup=await call('setup',[process.env.T4M_SETUP_KEY,'admin01','ADMIN-protected-password-2026']);
 assert.equal(setup.code,200,JSON.stringify(setup.data));
 assert.ok(data.Users[1][7].startsWith('scrypt$'));
 assert.equal(await call('setup',[process.env.T4M_SETUP_KEY,'admin01','ADMIN-protected-password-2026']).then(x=>x.code),409);
 const login=await call('login',['caregiver01','caregiver-secret-123']);
 assert.equal(login.code,200,JSON.stringify(login.data));
 const token=login.data.value.token;
 const dashboard=await call('bootstrap',[token]);
 assert.equal(dashboard.code,200,JSON.stringify(dashboard.data));
 assert.deepEqual(dashboard.data.value.patients.map(x=>x.id),['P001']);
 assert.deepEqual(dashboard.data.value.medicines.map(x=>x.patientId),['P001']);
 assert.deepEqual(dashboard.data.value.users,[]);
 const blocked=await call('saveMedicine',[token,{patientId:'P003',name:'Do not touch',mealType:2,time:'08:00',days:'MON'}]);
 assert.equal(blocked.code,403);
 assert.equal((await call('testLine',[token])).code,403);
 const otherOrigin=await call('bootstrap',[token],'https://bad.example');
 assert.equal(otherOrigin.code,403);
 const wrong=await call('login',['caregiver01','wrongwrongwrong']);
 assert.equal(wrong.code,401);
 const change=await call('changePassword',[token,'caregiver-secret-123','new-strong-password-2026']);
 assert.equal(change.code,200,JSON.stringify(change.data));
 assert.equal((await call('bootstrap',[token])).code,401,'old session invalidated after password change');
 const relogin=await call('login',['caregiver01','new-strong-password-2026']);
 assert.equal(relogin.code,200);
 const admin=await call('login',['admin01','ADMIN-protected-password-2026']);
 assert.equal(admin.code,200);
 const adminDash=await call('bootstrap',[admin.data.value.token]);
 assert.equal(adminDash.code,200);
 assert.equal(adminDash.data.value.patients.length,3);
});
