/**
 * Time4Med independent caregiver API. Vercel Node.js Function (Node 20+).
 * Never expose Google private keys or LINE tokens to the GitHub Pages site.
 * No Cloudflare; ESP32 and the existing Apps Script LINE scheduler remain unchanged.
 */
'use strict';
const crypto=require('node:crypto');
const SHEET_ID=process.env.T4M_SPREADSHEET_ID||'1pU1YnZUHrxTxxCDnoNx5Xmaosh-d4H92BUXQwQYQg8I';
const SITE='https://n4-p4t.github.io';
const PATIENTS={P001:1,P002:2,P003:3};
const MEALS=['','ก่อนอาหารเช้า','หลังอาหารเช้า','ก่อนอาหารกลางวัน','หลังอาหารกลางวัน','ก่อนอาหารเย็น','หลังอาหารเย็น','ก่อนนอน'];
const HEADERS={Users:4,Patients:4,MealMedicines:1,ActivityLog:4,ImageIndex:4,Devices:4};
const str=x=>String(x==null?'':x).trim();
const upper=x=>str(x).toUpperCase();
const active=x=>['TRUE','YES','1','ACTIVE','ON'].includes(upper(x));
const sha=x=>crypto.createHash('sha256').update(String(x)).digest('hex');
const b64=x=>Buffer.from(x).toString('base64url');
const err=(message,status=400)=>Object.assign(new Error(message),{status});
function ready(){
  const needed=['GOOGLE_SERVICE_ACCOUNT_JSON','T4M_SESSION_SECRET'];
  const missing=needed.filter(x=>!process.env[x]);
  if(missing.length)throw err('API ยังไม่ตั้งค่าฝั่งเซิร์ฟเวอร์: '+missing.join(', '),503);
  if(process.env.T4M_SESSION_SECRET.length<40)throw err('T4M_SESSION_SECRET ต้องยาวอย่างน้อย 40 ตัวอักษร',503);
}
function credentials(){
  try {
    const value=JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    if(!value.client_email||!value.private_key)throw new Error();
    return value;
  }catch(_){throw err('Google service account ไม่ถูกต้อง',503);}
}
let cachedAccessToken=null;
async function googleToken(){
  if(cachedAccessToken&&Date.now()<cachedAccessToken.expires)return cachedAccessToken.value;
  const c=credentials(),now=Math.floor(Date.now()/1000);
  const h=b64(JSON.stringify({alg:'RS256',typ:'JWT'}));
  const p=b64(JSON.stringify({iss:c.client_email,scope:'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.readonly',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600}));
  const signed=h+'.'+p+'.'+crypto.sign('RSA-SHA256',Buffer.from(h+'.'+p),c.private_key).toString('base64url');
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:signed})});
  const body=await response.json();
  if(!response.ok||!body.access_token)throw err('Google API ไม่อนุญาต Service Account กรุณาตรวจสิทธิ์และแชร์ชีต',503);
  cachedAccessToken={value:body.access_token,expires:Date.now()+Math.min(Number(body.expires_in||3600)-90,3500)*1000};
  return cachedAccessToken.value;
}
async function google(url,{method='GET',body,raw=false}={}){
  const token=await googleToken();
  const response=await fetch(url,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  if(!response.ok)throw err('Google API: HTTP '+response.status+' (ตรวจสอบการแชร์ Sheet/Drive และคอลัมน์)',503);
  return raw?Buffer.from(await response.arrayBuffer()):await response.json();
}
const sheetRange=(name,r)=>encodeURIComponent("'"+name+"'!"+r);
function col(i){let s='';for(let n=i+1;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;}
async function grid(name){
  if(!Object.hasOwn(HEADERS,name))throw err('ชีตไม่รองรับ');
  const header=HEADERS[name];
  const path='https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(SHEET_ID)+'/values/'+sheetRange(name,'A'+header+':ZZ');
  const result=await google(path+'?valueRenderOption=FORMATTED_VALUE');
  const rows=result.values||[],keys=rows[0]||[];
  if(!keys.length)throw err('ไม่พบหัวคอลัมน์ชีต '+name,503);
  return {name,keys,rows:rows.slice(1).map((cells,i)=>({index:header+i+1,data:Object.fromEntries(keys.map((k,j)=>[k,cells[j]||'']))})).filter(r=>Object.values(r.data).some(str))};
}
async function saveRow(g,index,values){
  const included=Object.entries(values).filter(([key])=>g.keys.includes(key));
  if(!included.length)throw err('คอลัมน์ของ '+g.name+' ไม่ตรงกับระบบ',503);
  const base='https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(SHEET_ID)+'/values';
  if(index){
    const data=included.map(([k,v])=>({range:"'"+g.name+"'!"+col(g.keys.indexOf(k))+index,values:[[String(v??'')]]}));
    await google(base+':batchUpdate',{method:'POST',body:{valueInputOption:'RAW',data}});
  }else{
    const row=g.keys.map(k=>Object.hasOwn(values,k)?String(values[k]??''):'');
    await google(base+'/'+sheetRange(g.name,'A'+HEADERS[g.name])+':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',{method:'POST',body:{values:[row]}});
  }
}
function identity(row){
  const d=row.data,role=upper(d.role);
  if(upper(d.status)!=='ACTIVE'||!['ADMIN','CAREGIVER','USER'].includes(role))return null;
  const admin=role==='ADMIN';
  const patientIds=admin?Object.keys(PATIENTS):upper(d.patient_id).split(/[,;\s]+/).filter(p=>Object.hasOwn(PATIENTS,p));
  if(!admin&&!patientIds.length)return null;
  return {id:str(d.user_id),email:str(d.email).toLowerCase(),name:str(d.display_name)||str(d.email),
    role:admin?'ADMIN':'CAREGIVER',patientIds,username:str(d.username)||str(d.email).toLowerCase(),
    hash:str(d.password_hash),lineId:str(d.line_user_id)};
}
function publicUser(u){return {email:u.email,name:u.name,role:u.role,patientIds:u.patientIds};}
function check(u,p){return u.role==='ADMIN'||u.patientIds.includes(upper(p));}
function adminOnly(u){if(u.role!=='ADMIN')throw err('เฉพาะแอดมินเท่านั้น',403);}
function passwordOK(password,record){
  const pieces=String(record||'').split('$');
  if(pieces.length!==6||pieces[0]!=='scrypt')return false;
  const N=Number(pieces[1]),r=Number(pieces[2]),p=Number(pieces[3]);
  if(N!==16384||r!==8||p!==1)return false;
  try{
    const salt=Buffer.from(pieces[4],'base64url'),hash=Buffer.from(pieces[5],'base64url');
    if(salt.length!==16||hash.length!==64)return false;
    const computed=crypto.scryptSync(password,salt,hash.length,{N,r,p,maxmem:64*1024*1024});
    return crypto.timingSafeEqual(computed,hash);
  }catch(_){return false;}
}
function issue(u){
  const payload={uid:u.id,email:u.email,ph:sha(u.hash),exp:Math.floor(Date.now()/1000)+6*3600};
  const segment=b64(JSON.stringify(payload));
  const sig=crypto.createHmac('sha256',process.env.T4M_SESSION_SECRET).update(segment).digest('base64url');
  return segment+'.'+sig;
}
async function authorize(token){
  if(typeof token!=='string'||token.length>2000||!token.includes('.'))throw err('กรุณาเข้าสู่ระบบ',401);
  const [segment,signature,extra]=token.split('.');
  if(extra!==undefined)throw err('เซสชันไม่ถูกต้อง',401);
  const expected=crypto.createHmac('sha256',process.env.T4M_SESSION_SECRET).update(segment).digest();
  const actual=Buffer.from(signature,'base64url');
  if(actual.length!==expected.length||!crypto.timingSafeEqual(actual,expected))throw err('เซสชันไม่ถูกต้อง',401);
  let parsed;
  try{parsed=JSON.parse(Buffer.from(segment,'base64url').toString('utf8'));}catch(_){throw err('เซสชันไม่ถูกต้อง',401);}
  if(!Number.isSafeInteger(parsed.exp)||parsed.exp<=Date.now()/1000)throw err('หมดเวลาเข้าสู่ระบบ',401);
  const g=await grid('Users'),r=g.rows.find(x=>str(x.data.user_id)===parsed.uid&&str(x.data.email).toLowerCase()===parsed.email);
  const u=r&&identity(r);
  if(!u||sha(u.hash)!==parsed.ph)throw err('บัญชีถูกเปลี่ยนสิทธิ์หรือรหัสผ่าน กรุณาเข้าสู่ระบบใหม่',401);
  return u;
}
const failures=new Map();
async function login(username,password){
  const key=str(username).toLowerCase();
  if(!/^[a-z0-9._@+-]{3,120}$/.test(key)||typeof password!=='string'||password.length>256)throw err('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง',401);
  const f=failures.get(key);
  if(f&&f.until>Date.now()&&f.count>=5)throw err('ลองเข้าสู่ระบบหลายครั้งเกินไป กรุณารอ 15 นาที',429);
  const g=await grid('Users'),r=g.rows.find(x=>str(x.data.username).toLowerCase()===key||str(x.data.email).toLowerCase()===key);
  const u=r&&identity(r);
  if(!u||!u.hash||!passwordOK(password,u.hash)){
    const prev=f&&f.until>Date.now()?f.count:0;
    failures.set(key,{count:prev+1,until:Date.now()+15*60000});
    throw err('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง',401);
  }
  failures.delete(key);
  return {token:issue(u),user:publicUser(u)};
}
function stamp(){return new Date().toISOString();}
function thailandTime(value){return new Date(value||Date.now()).toLocaleString('sv-SE',{timeZone:'Asia/Bangkok'});}
function safeMedicine(d){
  const p=upper(d.patient_id),n=Number(d.meal_type)||0;
  const rawTime=str(d.reminder_time),time=/^\d:\d\d$/.test(rawTime)?'0'+rawTime:rawTime;
  return {id:str(d.record_id),patientId:p,patient:str(d.patient),name:str(d.name),mealType:n,
    meal:MEALS[n]||'—',time,days:str(d.reminder_days),instruction:str(d.instruction),stock:str(d.stock_status),
    active:active(d.is_active),kind:str(d.kind),shelf:PATIENTS[p]||null,
    demo:/^(TEST|DEMO|LINECHECK)[_\s-]/i.test(str(d.name))||/^(TEST|DEMO|LINECHECK)[_\s-]/i.test(str(d.record_id))};
}
async function bootstrap(token){
  const u=await authorize(token);
  const [pg,mg,ag,ig,dg]=await Promise.all(['Patients','MealMedicines','ActivityLog','ImageIndex','Devices'].map(grid));
  const patients=pg.rows.map(x=>({id:upper(x.data.patient_id),name:x.data.display_name,status:x.data.status,shelf:PATIENTS[upper(x.data.patient_id)]||null}))
    .filter(x=>x.shelf&&check(u,x.id));
  const medicines=mg.rows.map(x=>safeMedicine(x.data)).filter(x=>x.shelf&&check(u,x.patientId));
  const activity=ag.rows.map(x=>x.data).filter(x=>u.role==='ADMIN'||(upper(x.patient_id)==='ALL'&&x.event_type==='EMERGENCY')||(PATIENTS[upper(x.patient_id)]&&check(u,x.patient_id)))
    .slice(-60).reverse().map(x=>({patientId:x.patient_id,type:x.event_type,time:str(x.occurred_at).replace('T',' ').slice(0,19),result:x.result,details:str(x.details).slice(0,240)}));
  const images=ig.rows.map(x=>x.data).filter(x=>x.patient_id&&check(u,x.patient_id))
    .slice(-40).reverse().map(x=>({id:x.image_id,patientId:x.patient_id,time:str(x.captured_at).replace('T',' ').slice(0,19),filename:x.filename,available:x.available,source:x.transfer_status}));
  const devices=dg.rows.map(x=>x.data).map(x=>{
    const seen=Date.parse(str(x.last_seen).replace(' ','T')+'+07:00');
    const fresh=Number.isFinite(seen)&&Date.now()-seen<180000&&Date.now()>=seen;
    return {id:x.device_id,type:x.device_type,lastSeen:x.last_seen,online:fresh?x.online_status:'UNKNOWN',lock:fresh?x.lock_status:'UNKNOWN'};
  });
  const users=u.role==='ADMIN'?(await grid('Users')).rows.map(x=>({id:x.data.user_id,email:x.data.email,
    name:x.data.display_name,role:x.data.role,patients:x.data.patient_id,status:x.data.status,
    lineConfigured:Boolean(x.data.line_user_id),username:x.data.username||''})):[];
  return {user:publicUser(u),patients,medicines,activity,images,devices,users,serverTime:thailandTime(),
    note:'การกดยืนยันหมายถึงหยิบยา ไม่ใช่หลักฐานว่ากลืนยาแล้ว'};
}
async function audit(patientId,userId,type,detail){
  const g=await grid('ActivityLog');
  await saveRow(g,null,{event_id:crypto.randomUUID(),device_id:'WEBSITE',patient_id:patientId||'ALL',
    user_id:userId,event_type:type,result:'SUCCESS',details:str(detail).slice(0,400),occurred_at:thailandTime()});
}
function validDays(value){
  const days=upper(value).replace(/\s/g,'').split(',').filter(Boolean);
  const allowed=['MON','TUE','WED','THU','FRI','SAT','SUN'];
  if(!days.length||days.some(x=>!allowed.includes(x)))throw err('วันแจ้งเตือนไม่ถูกต้อง');
  return allowed.filter(x=>days.includes(x)).join(',');
}
async function saveMedicine(token,input){
  const u=await authorize(token),p=upper(input.patientId),name=str(input.name),n=Number(input.mealType),time=str(input.time);
  if(!PATIENTS[p]||!check(u,p))throw err('ไม่มีสิทธิ์จัดการผู้สูงอายุรายนี้',403);
  if(name.length<2||name.length>120||!Number.isInteger(n)||n<1||n>7||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))throw err('กรุณาตรวจชื่อยา มื้อยา และเวลา');
  const days=validDays(input.days),g=await grid('MealMedicines'),id=str(input.id);
  const found=id?g.rows.find(x=>str(x.data.record_id)===id):null;
  if(id&&!found)throw err('ไม่พบรายการยาที่ต้องการแก้ไข',404);
  if(found&&!check(u,found.data.patient_id))throw err('ไม่มีสิทธิ์แก้ไขรายการยานี้',403);
  const pg=await grid('Patients'),pname=pg.rows.find(x=>upper(x.data.patient_id)===p)?.data.display_name||p;
  const values={record_id:id||crypto.randomUUID(),patient_id:p,patient:pname,name,kind:'scheduled',
    meal_type:n,shelf:Math.ceil(n/2),box_number:String(PATIENTS[p]).padStart(2,'0'),
    reminder_time:time,instruction:str(input.instruction).slice(0,500),is_active:input.active===false?'FALSE':'TRUE',
    reminder_days:days,updated_at:stamp(),source:'WEB_API'};
  if(!found)Object.assign(values,{created_at:stamp(),stock_status:'unchecked'});
  await saveRow(g,found?.index||null,values);
  await audit(p,u.id,found?'MEDICINE_UPDATED':'MEDICINE_CREATED',values.record_id);
  return {ok:true,id:values.record_id};
}
async function disableMedicine(token,id){
  const u=await authorize(token),g=await grid('MealMedicines'),r=g.rows.find(x=>str(x.data.record_id)===str(id));
  if(!r)throw err('ไม่พบรายการยา',404);
  if(!check(u,r.data.patient_id))throw err('ไม่มีสิทธิ์ปิดรายการยา',403);
  await saveRow(g,r.index,{is_active:'FALSE',updated_at:stamp()});await audit(r.data.patient_id,u.id,'MEDICINE_DISABLED',id);
  return {ok:true};
}
async function saveUser(token,input){
  const u=await authorize(token);adminOnly(u);
  const email=str(input.email).toLowerCase(),role=upper(input.role),status=upper(input.status||'ACTIVE');
  const ids=upper(input.patientIds).replace(/\s/g,'').split(',').filter(Boolean);
  const username=str(input.username).toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!['ADMIN','CAREGIVER'].includes(role)||!['ACTIVE','INACTIVE'].includes(status)||
     (role!=='ADMIN'&&(!ids.length||ids.some(x=>!PATIENTS[x]))))throw err('กรุณาตรวจอีเมล สิทธิ์ และผู้สูงอายุ');
  if(username&&!/^[a-z0-9._-]{3,40}$/.test(username))throw err('ชื่อผู้ใช้ใช้ a-z, 0-9, จุด ขีด และขีดล่างเท่านั้น');
  const g=await grid('Users'),found=g.rows.find(x=>str(x.data.email).toLowerCase()===email);
  if(found&&email===u.email&&(role!=='ADMIN'||status!=='ACTIVE'))throw err('ไม่สามารถปิดบัญชีแอดมินของตัวเอง');
  if(username&&g.rows.some(x=>x.index!==found?.index&&str(x.data.username).toLowerCase()===username))throw err('ชื่อผู้ใช้ซ้ำ');
  const values={user_id:found?.data.user_id||'U'+crypto.randomUUID().slice(0,8).toUpperCase(),email,
    display_name:str(input.name).slice(0,100)||email,role,patient_id:role==='ADMIN'?'ALL':ids.join(','),
    status,updated_at:stamp()};
  if(!found)Object.assign(values,{created_at:stamp(),notification_enabled:'FALSE'});
  if(username)values.username=username;
  // Never accept unhashed passwords through this administrative update method.
  await saveRow(g,found?.index||null,values);await audit('ALL',u.id,'USER_SAVED',email);return {ok:true};
}
async function readImage(token,id){
  const u=await authorize(token),g=await grid('ImageIndex'),r=g.rows.find(x=>str(x.data.image_id)===str(id));
  if(!r||!check(u,r.data.patient_id))throw err('ไม่มีสิทธิ์เข้าถึงภาพ',403);
  const fileId=str(r.data.drive_file_id);
  if(!/^[a-zA-Z0-9_-]{10,150}$/.test(fileId))throw err('ภาพนี้ยังไม่ได้อัปโหลดขึ้น Google Drive');
  const meta=await google('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId)+'?fields=size,mimeType');
  if(!['image/jpeg','image/png','image/webp'].includes(meta.mimeType)||Number(meta.size)>1250000)throw err('ภาพใหญ่เกินไปหรือไม่ใช่ไฟล์ภาพ');
  const data=await google('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId)+'?alt=media',{raw:true});
  if(data.byteLength>1250000)throw err('ภาพใหญ่เกินไป');
  return 'data:'+meta.mimeType+';base64,'+data.toString('base64');
}
async function testLine(token){
  const u=await authorize(token);adminOnly(u);
  const key=process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if(!key)throw err('API นี้ยังไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN: ทดสอบ LINE ผ่าน Apps Script เดิมได้',503);
  if(!u.lineId)throw err('ยังไม่ได้ตั้ง LINE User ID ของแอดมิน');
  const response=await fetch('https://api.line.me/v2/bot/message/push',{method:'POST',
    headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},
    body:JSON.stringify({to:u.lineId,messages:[{type:'text',text:'Time4Med: ทดสอบ LINE จากเว็บไซต์สำเร็จ\nhttps://n4-p4t.github.io/Time4Med/'}]})});
  if(!response.ok)throw err('LINE ไม่สำเร็จ (HTTP '+response.status+')',502);
  await audit('ALL',u.id,'LINE_TEST','test via Vercel API');return {ok:true};
}
async function dispatch(method,args){
  if(!Array.isArray(args)||args.length>3)throw err('รูปแบบคำขอไม่ถูกต้อง');
  switch(method){
    case 'login':return login(args[0],args[1]);
    case 'bootstrap':return bootstrap(args[0]);
    case 'saveMedicine':return saveMedicine(args[0],args[1]||{});
    case 'disableMedicine':return disableMedicine(args[0],args[1]);
    case 'saveUser':return saveUser(args[0],args[1]||{});
    case 'readImage':return readImage(args[0],args[1]);
    case 'testLine':return testLine(args[0]);
    case 'logout':return true; // Client discards short-lived signed token, expires after 6 hours.
    default:throw err('คำสั่งไม่รองรับ',404);
  }
}
module.exports=async function handler(req,res){
  // Browser origin is not authorization; every protected action verifies token+sheet assignments.
  const origin=req.headers.origin;
  if(origin===SITE){
    res.setHeader('Access-Control-Allow-Origin',SITE);
    res.setHeader('Vary','Origin');
    res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers','Content-Type');
  }
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method==='OPTIONS')return res.status(origin===SITE?204:403).end();
  if(req.method!=='POST'||origin!==SITE)return res.status(403).json({ok:false,error:'Not allowed'});
  try{
    ready();
    const body=typeof req.body==='string'?JSON.parse(req.body):req.body;
    if(!body||!['login','bootstrap','saveMedicine','disableMedicine','saveUser','readImage','testLine','logout'].includes(body.method)||
       !Array.isArray(body.args)||JSON.stringify(body).length>25000)throw err('รูปแบบคำขอไม่ถูกต้อง');
    const result=await dispatch(body.method,body.args);
    return res.status(200).json({ok:true,value:result});
  }catch(e){
    const status=Number.isInteger(e.status)?e.status:500;
    if(status===500)console.error('Time4Med API request failed',e?.message);
    return res.status(status).json({ok:false,error:status===500?'ระบบขัดข้อง โปรดลองอีกครั้ง':String(e.message).slice(0,240)});
  }
};
// Pure helpers for isolated tests; never expose service-account credentials.
module.exports._test={passwordOK,identity,issue,validDays,safeMedicine};
