import {deviceTelemetryGet,deviceTelemetryPost} from './device-telemetry.mjs';
/** Time4Med v0.19 — Cloudflare Workers + Google Sheets permissioned API.
 * No service-account credentials or MQTT passwords may be placed in GitHub Pages.
 * Required Worker secrets: GCP_CLIENT_EMAIL, GCP_PRIVATE_KEY.
 */
const sheetCache = new Map();
let accessTokenCache = null;
let jwksCache = null;
const enc = new TextEncoder();
const b64u = s => btoa(String.fromCharCode(...new Uint8Array(s))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const fromB64u = s => Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(s.length/4)*4,'=')), c=>c.charCodeAt(0));
const decodeJson = s => JSON.parse(new TextDecoder().decode(fromB64u(s)));
const now = () => new Date().toISOString();
const text = x => String(x ?? '').trim();
const normEmail = x => text(x).toLowerCase();
const json = (obj,status=200,origin='') => new Response(JSON.stringify(obj),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(origin?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{})}});
function fail(status,message){const e=new Error(message);e.status=status;throw e;}
function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin') || '';
  const permitted = text(env.ALLOWED_ORIGIN).replace(/\/$/,'');
  if (origin && origin !== permitted) fail(403,'Origin ไม่ได้รับอนุญาต');
  return origin;
}
function safeString(x,max=250){const s=text(x);if(s.length>max)fail(400,'ข้อความยาวเกินกำหนด');return s;}
async function verifyIdToken(token, env){
  if (!token || token.length>12000) fail(401,'ไม่พบ Google ID token');
  const parts=token.split('.');if(parts.length!==3)fail(401,'รูปแบบ Google ID token ไม่ถูกต้อง');
  let head,payload;try{head=decodeJson(parts[0]);payload=decodeJson(parts[1]);}catch(_){fail(401,'อ่าน Google ID token ไม่ได้');}
  if(head.alg!=='RS256'||!head.kid)fail(401,'ชนิดลายเซ็นไม่ถูกต้อง');
  const unix=Math.floor(Date.now()/1000);
  if(payload.aud!==env.GOOGLE_CLIENT_ID||!['accounts.google.com','https://accounts.google.com'].includes(payload.iss)||
     typeof payload.exp!=='number'||payload.exp<=unix||typeof payload.iat!=='number'||payload.iat>unix+120||
     payload.email_verified!==true||!payload.sub||!payload.email) fail(401,'Google ID token ไม่ผ่านการตรวจสอบ');
  if(!jwksCache || Date.now()>jwksCache.until){
    const r=await fetch('https://www.googleapis.com/oauth2/v3/certs');if(!r.ok)fail(503,'ไม่สามารถตรวจสอบกุญแจ Google');
    jwksCache={keys:(await r.json()).keys,until:Date.now()+45*60*1000};
  }
  let jwk=jwksCache.keys.find(k=>k.kid===head.kid&&k.kty==='RSA');
  if(!jwk){jwksCache=null;fail(401,'ไม่รู้จักกุญแจ Google กรุณาลองใหม่');}
  const pub=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  const sig=fromB64u(parts[2]);const valid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',pub,sig,enc.encode(parts[0]+'.'+parts[1]));
  if(!valid)fail(401,'ลายเซ็น Google ID token ไม่ถูกต้อง');
  return {sub:payload.sub,email:normEmail(payload.email),name:text(payload.name||payload.email)};
}
async function serviceToken(env){
  if(accessTokenCache&&Date.now()<accessTokenCache.until)return accessTokenCache.value;
  if(!env.GCP_CLIENT_EMAIL||!env.GCP_PRIVATE_KEY||!env.SPREADSHEET_ID)fail(503,'ยังไม่ได้ตั้งค่า Google Sheets backend');
  const head=b64u(enc.encode(JSON.stringify({alg:'RS256',typ:'JWT'})));
  const t=Math.floor(Date.now()/1000);
  const claim=b64u(enc.encode(JSON.stringify({iss:env.GCP_CLIENT_EMAIL,scope:'https://www.googleapis.com/auth/spreadsheets',aud:'https://oauth2.googleapis.com/token',iat:t,exp:t+3600})));
  const pem=env.GCP_PRIVATE_KEY.replace(/\\n/g,'\n').replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'');
  const key=await crypto.subtle.importKey('pkcs8',Uint8Array.from(atob(pem),c=>c.charCodeAt(0)),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,enc.encode(head+'.'+claim));
  const assertion=head+'.'+claim+'.'+b64u(sig);
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});
  const data=await r.json();if(!r.ok||!data.access_token)fail(503,'Google Sheets service account ไม่ได้รับอนุญาต');
  accessTokenCache={value:data.access_token,until:Date.now()+(Math.max(120,Number(data.expires_in)||3600)-90)*1000};return data.access_token;
}
async function sheets(env,method,path,body){
  const token=await serviceToken(env);
  const url='https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(env.SPREADSHEET_ID)+path;
  const r=await fetch(url,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const response=await r.json().catch(()=>({}));
  if(!r.ok){console.error('Sheets API error',r.status,response.error?.status);fail(r.status===403?503:502,'Google Sheets ตอบกลับข้อผิดพลาด '+r.status);}
  return response;
}
const q=name=>"'"+name.replace(/'/g,"''")+"'";
async function values(env,name,range='A1:Z1000'){
  const result=await sheets(env,'GET','/values/'+encodeURIComponent(q(name)+'!'+range));return result.values||[];
}
async function idFor(env,name){
  const key=env.SPREADSHEET_ID+':'+name;if(sheetCache.has(key))return sheetCache.get(key);
  const m=await sheets(env,'GET','?fields=sheets(properties(sheetId,title))');
  for(const s of m.sheets||[])sheetCache.set(env.SPREADSHEET_ID+':'+s.properties.title,s.properties.sheetId);
  if(!sheetCache.has(key))fail(503,'ไม่พบแท็บ '+name+' ใน Google Sheets');return sheetCache.get(key);
}
const cell=v=>({userEnteredValue:{stringValue:String(v??'')}});
const row=values=>({values:values.map(cell)});
async function batch(env,requests){return sheets(env,'POST',':batchUpdate',{requests});}
async function appendMany(env,tabs){const requests=[];for(const [tab,arr] of tabs){requests.push({appendCells:{sheetId:await idFor(env,tab),rows:[row(arr)],fields:'userEnteredValue'}});}return batch(env,requests);}
async function updateWithAudit(env,tab,index,values,audit){
  const requests=[{updateCells:{start:{sheetId:await idFor(env,tab),rowIndex:index,columnIndex:0},rows:[row(values)],fields:'userEnteredValue'}}];
  if(audit)requests.push({appendCells:{sheetId:await idFor(env,audit.tab),rows:[row(audit.values)],fields:'userEnteredValue'}});
  return batch(env,requests);
}
async function authUser(request,env){
  const match=/^Bearer (\S+)$/.exec(request.headers.get('Authorization')||'');if(!match)fail(401,'กรุณาเข้าสู่ระบบ Google');
  const identity=await verifyIdToken(match[1],env);
  const users=(await values(env,'Users','A5:J1000')).filter(r=>r[0]);
  const found=users.find(r=>normEmail(r[1])===identity.email&&text(r[7]).toUpperCase()==='ACTIVE');
  if(!found)fail(403,'บัญชีนี้ยังไม่ได้รับอนุญาตให้ใช้ Time4Med');
  let role=text(found[3]).toUpperCase();if(role==='USER')role='CAREGIVER';
  if(!['ADMIN','CAREGIVER'].includes(role))fail(403,'บทบาทผู้ใช้ไม่ถูกต้อง');
  const patients=text(found[4]).split(/[,;\s]+/).filter(Boolean).map(x=>x.toUpperCase());
  return {id:text(found[0]),email:identity.email,name:text(found[2])||identity.name,role,patients};
}
// API values remain stable (ADMIN/CAREGIVER); Thai labels belong in the web UI.
function normalizePatientIds(input, role, patients){
  if(role==='ADMIN')return 'ALL';
  const raw=safeString(input,160).toUpperCase();
  if(!raw||raw==='ALL')fail(400,'กรุณาเลือกผู้ป่วยอย่างน้อย 1 คน');
  const ids=raw.split(',').map(v=>v.trim());
  if(ids.some(id=>!id)||new Set(ids).size!==ids.length)fail(400,'รายชื่อผู้ป่วยซ้ำหรือมีรหัสว่าง');
  const active=new Set(patients.filter(p=>p.status.toUpperCase()==='ACTIVE').map(p=>p.id));
  if(ids.some(id=>!active.has(id)))fail(400,'พบรหัสผู้ป่วยที่ไม่อยู่ในระบบหรือไม่ได้ใช้งาน');
  return ids.join(',');
}
function canPatient(user,id){return user.role==='ADMIN'||user.patients.includes(text(id).toUpperCase());}
function adminOnly(user){if(user.role!=='ADMIN')fail(403,'เฉพาะ ADMIN เท่านั้น');}
function mapPatients(rows){return rows.filter(r=>r[0]).map(r=>({id:text(r[0]),name:text(r[1]),status:text(r[4])}));}
function mapMedicine(r,index){return {id:text(r[0]),patient:text(r[1]),name:text(r[2]),kind:r[3]==='prn'?'prn':'scheduled',mealType:r[3]==='prn'?'prn':(Number(r[4])||2),shelf:text(r[5]),boxNumber:text(r[6]),time:text(r[7]),instruction:text(r[8]),stockStatus:text(r[9])||'unchecked',statusUpdatedAt:text(r[10]),createdAt:text(r[11]),updatedAt:text(r[12]),active:text(r[13]).toUpperCase()!=='FALSE',patientId:text(r[15]),_rowIndex:index};}
function medArray(m,old){return [m.id,m.patient,m.name,m.kind,m.kind==='prn'?'prn':String(m.mealType),m.kind==='prn'?'prn':({'1':'morning','2':'morning','3':'noon','4':'noon','5':'evening','6':'evening','7':'bedtime'}[m.mealType]||''),m.boxNumber,m.kind==='prn'?'':m.time,m.instruction,m.stockStatus,m.statusUpdatedAt||'',old?.createdAt||now(),now(),m.active===false?'FALSE':'TRUE','WEB_V018',m.patientId];}
function parseMedicine(input,patients,user){
  if(!input||typeof input!=='object')fail(400,'ไม่พบข้อมูลยา');
  const patientId=safeString(input.patientId,50).toUpperCase();
  if(!patientId||!patients.some(p=>p.id===patientId&&p.status.toUpperCase()==='ACTIVE'))fail(400,'กรุณาเลือกผู้ป่วยที่มีอยู่ในฐานข้อมูล');
  if(!canPatient(user,patientId))fail(403,'ไม่มีสิทธิ์จัดการผู้ป่วยรายนี้');
  const kind=input.kind==='prn'?'prn':'scheduled',mealType=kind==='prn'?'prn':Number(input.mealType);
  if(kind==='scheduled'&&![1,2,3,4,5,6,7].includes(mealType))fail(400,'กรุณาเลือกมื้อยา');
  const time=kind==='prn'?'':safeString(input.time,5);
  if(kind==='scheduled'&&!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))fail(400,'เวลาแจ้งเตือนไม่ถูกต้อง');
  const name=safeString(input.name,150),boxNumber=safeString(input.boxNumber,12).toUpperCase(),instruction=safeString(input.instruction,300);
  if(!name||!/^[0-9A-Za-zก-๙_-]{1,12}$/.test(boxNumber))fail(400,'ชื่อยาหรือหมายเลขกล่องไม่ถูกต้อง');
  if(kind==='prn'&&!instruction)fail(400,'ยา PRN ต้องมีคำแนะนำตามฉลาก');
  const status=['unchecked','ok','low','out'].includes(input.stockStatus)?input.stockStatus:'unchecked';
  return {id:safeString(input.id,75)||crypto.randomUUID(),patient:patients.find(p=>p.id===patientId).name,patientId,name,kind,mealType,time,boxNumber,instruction,stockStatus:status,statusUpdatedAt:status==='unchecked'?'':(safeString(input.statusUpdatedAt,50)||now()),active:true};
}
function ensureSlotAvailable(records,med,except=''){
  const shelf=med.kind==='prn'?'prn':({'1':'morning','2':'morning','3':'noon','4':'noon','5':'evening','6':'evening','7':'bedtime'}[med.mealType]||'');
  const clash=records.find(x=>x.id!==except&&x.active&&x.shelf===shelf&&x.boxNumber.toUpperCase()===med.boxNumber&&
    (x.patientId!==med.patientId||String(x.mealType)!==String(med.mealType)));
  if(clash)fail(409,'กล่องเดียวกันในชั้นนี้ผูกกับผู้ป่วยหรือมื้ออื่นอยู่แล้ว');
}
const isSamePayload=(a,b)=>['patientId','name','kind','mealType','boxNumber','time','instruction','stockStatus'].every(k=>String(a[k]??'')===String(b[k]??''));
async function readPayload(req){const type=req.headers.get('content-type')||'';if(!type.includes('application/json'))fail(415,'ต้องส่ง JSON');const body=await req.text();if(body.length>25000)fail(413,'ข้อมูลมีขนาดใหญ่เกินกำหนด');try{return JSON.parse(body);}catch(_){fail(400,'JSON ไม่ถูกต้อง');}}
async function handle(request,env,url,user){
  const method=request.method,pathname=url.pathname;
  if(method==='GET'&&pathname==='/api/devices/status')return deviceTelemetryGet(env,user);
  if(method==='GET'&&pathname==='/api/me')return {user:{id:user.id,email:user.email,name:user.name,role:user.role,patients:user.patients}};
  if(method==='GET'&&pathname==='/api/patients')return {patients:mapPatients(await values(env,'Patients','A5:G1000')).filter(p=>p.status.toUpperCase()==='ACTIVE'&&canPatient(user,p.id))};
  if(method==='GET'&&pathname==='/api/medicines'){
    const all=(await values(env,'MealMedicines','A2:P1000')).map((r,i)=>mapMedicine(r,i+1)).filter(m=>m.id&&m.active);
    return {medicines:all.filter(m=>m.patientId?canPatient(user,m.patientId):user.role==='ADMIN')};
  }
  if(method==='POST'&&pathname==='/api/medicines'){
    const input=await readPayload(request),patients=mapPatients(await values(env,'Patients','A5:G1000'));
    const med=parseMedicine(input,patients,user);
    const records=(await values(env,'MealMedicines','A2:P1000')).map((r,i)=>mapMedicine(r,i+1));
    if(records.some(r=>r.id===med.id))fail(409,'รหัสรายการยาซ้ำ กรุณาโหลดข้อมูลล่าสุด');
    ensureSlotAvailable(records,med);
    await appendMany(env,[['MealMedicines',medArray(med)],['MealMedicineAudit',[crypto.randomUUID(),now(),med.id,'MEDICINE_CREATED','',JSON.stringify(med),user.email,'SUCCESS']]]);
    return {medicine:med};
  }
  const medRoute=pathname.match(/^\/api\/medicines\/([A-Za-z0-9_-]{1,75})$/);
  if(medRoute&&['PUT','DELETE'].includes(method)){
    const records=(await values(env,'MealMedicines','A2:P1000')).map((r,i)=>mapMedicine(r,i+1));
    const old=records.find(m=>m.id===medRoute[1]&&m.active);if(!old)fail(404,'ไม่พบรายการยา');
    if(!old.patientId){adminOnly(user);}else if(!canPatient(user,old.patientId))fail(403,'ไม่มีสิทธิ์แก้ไขรายการยานี้');
    const input=await readPayload(request);
    if(text(input.updatedAt)!==old.updatedAt)fail(409,'ข้อมูลถูกเปลี่ยนจากอีกอุปกรณ์ กรุณาโหลดข้อมูลใหม่');
    const pts=mapPatients(await values(env,'Patients','A5:G1000'));
    const next=method==='DELETE'?{...old,active:false}:parseMedicine({...input,id:old.id},pts,user);
    next.id=old.id;
    if(method==='PUT')ensureSlotAvailable(records,next,old.id);
    await updateWithAudit(env,'MealMedicines',old._rowIndex,medArray(next,old),{tab:'MealMedicineAudit',values:[crypto.randomUUID(),now(),next.id,method==='DELETE'?'MEDICINE_DELETED':isSamePayload(old,next)?'MEDICINE_CHECKED':'MEDICINE_UPDATED',JSON.stringify(old),JSON.stringify(next),user.email,'SUCCESS']});
    return {medicine:next};
  }
  if(method==='POST'&&pathname==='/api/experiments'){
    adminOnly(user);const d=await readPayload(request),fields=['category','objective','device','operator','expected','actual','passed','notes','evidence'];
    for(const f of fields)d[f]=safeString(d[f],f==='objective'?160:400);
    if(!d.objective||!d.expected||!d.actual||!['PASS','FAIL','UNVERIFIED'].includes(d.passed))fail(400,'ข้อมูลผลทดลองไม่ครบ');
    const start=d.startedAt?new Date(d.startedAt):new Date(),end=d.endedAt?new Date(d.endedAt):new Date();
    if(Number.isNaN(+start)||Number.isNaN(+end)||start>end)fail(400,'เวลาทดลองไม่ถูกต้อง');
    const id=crypto.randomUUID();await appendMany(env,[['ExperimentRuns',[id,start.toISOString(),end.toISOString(),d.category,d.objective,d.device,d.operator,d.expected,d.actual,d.passed,d.notes,d.evidence]]]);return {trialId:id};
  }
  if(method==='POST'&&pathname==='/api/patients'){
    adminOnly(user);
    const d=await readPayload(request),id=safeString(d.id,15).toUpperCase(),name=safeString(d.name,100),notes=safeString(d.notes,250);
    if(!/^P[0-9]{3,6}$/.test(id)||!name)fail(400,'รหัสผู้ป่วยต้องเป็น P ตามด้วยเลข 3–6 หลัก และระบุชื่อ');
    const pts=mapPatients(await values(env,'Patients','A5:G1000'));
    if(pts.some(p=>p.id===id))fail(409,'มีรหัสผู้ป่วยนี้แล้ว');
    const created=now();
    await appendMany(env,[['Patients',[id,name,'',notes,'ACTIVE',created,created]],['ActivityLog',[crypto.randomUUID(),'WEB',id,user.id,'PATIENT_CREATED','','SUCCESS','New patient '+id,created]]]);
    return {patient:{id,name,status:'ACTIVE'}};
  }
  if(method==='GET'&&pathname==='/api/users'){
    adminOnly(user);const rs=(await values(env,'Users','A5:J1000')).filter(r=>r[0]);
    return {users:rs.map(r=>({id:text(r[0]),email:normEmail(r[1]),name:text(r[2]),role:text(r[3]).toUpperCase()==='USER'?'CAREGIVER':text(r[3]).toUpperCase(),patientIds:text(r[4]),status:text(r[7]),updatedAt:text(r[9])}))};
  }
  if(method==='POST'&&pathname==='/api/users'){
    adminOnly(user);const d=await readPayload(request),email=normEmail(d.email),role=safeString(d.role,30).toUpperCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!['ADMIN','CAREGIVER'].includes(role))fail(400,'อีเมลหรือบทบาทไม่ถูกต้อง');
    const all=(await values(env,'Users','A5:J1000'));if(all.some(r=>normEmail(r[1])===email))fail(409,'มีบัญชีนี้ในระบบแล้ว');
    const assigned=normalizePatientIds(d.patientIds,role,mapPatients(await values(env,'Patients','A5:G1000')));
    const id='U-'+crypto.randomUUID().slice(0,12);const changed=now();
    await appendMany(env,[['Users',[id,email,safeString(d.name,100),role,assigned,'','FALSE','ACTIVE',changed,changed]],['ActivityLog',[crypto.randomUUID(),'WEB','',user.id,'USER_CREATED','','SUCCESS','Added role '+role+' for '+email,changed]]]);
    return {id,email,role,patientIds:assigned};
  }
  const userRoute=pathname.match(/^\/api\/users\/(U-[A-Za-z0-9-]{1,70}|U[0-9]{3,6})$/);
  if(userRoute&&method==='PUT'){
    adminOnly(user);
    const d=await readPayload(request),all=await values(env,'Users','A5:J1000');
    const pos=all.findIndex(r=>text(r[0])===userRoute[1]);
    if(pos<0)fail(404,'ไม่พบบัญชีผู้ใช้งาน');
    const old=all[pos],email=normEmail(old[1]);
    if(text(old[9])!==text(d.updatedAt))fail(409,'บัญชีถูกเปลี่ยนจากอีกอุปกรณ์ กรุณาโหลดข้อมูลใหม่');
    const role=safeString(d.role,30).toUpperCase();
    if(!['ADMIN','CAREGIVER'].includes(role))fail(400,'บทบาทผู้ใช้ไม่ถูกต้อง');
    if(email===user.email && role!=='ADMIN')fail(400,'ไม่สามารถลดสิทธิ์แอดมินของบัญชีที่กำลังใช้งาน');
    const remainingAdmins=all.filter((r,i)=>i!==pos&&text(r[3]).toUpperCase()==='ADMIN'&&text(r[7]).toUpperCase()==='ACTIVE');
    if(text(old[3]).toUpperCase()==='ADMIN'&&role!=='ADMIN'&&remainingAdmins.length===0)fail(400,'ไม่สามารถลดสิทธิ์แอดมินคนสุดท้าย');
    const assigned=normalizePatientIds(d.patientIds,role,mapPatients(await values(env,'Patients','A5:G1000')));
    const name=safeString(d.name,100)||text(old[2]);
    if(!name)fail(400,'กรุณาระบุชื่อที่แสดง');
    const changed=now();
    const next=[text(old[0]),email,name,role,assigned,text(old[5]),text(old[6]),text(old[7]),text(old[8]),changed];
    await updateWithAudit(env,'Users',pos+4,next,{tab:'ActivityLog',values:[crypto.randomUUID(),'WEB','',user.id,'USER_PERMISSIONS_UPDATED','','SUCCESS','Permissions updated for '+next[0],changed]});
    return {user:{id:next[0],email,name,role,patientIds:assigned,status:next[7],updatedAt:changed}};
  }
  fail(404,'ไม่พบ API นี้');
}
export default {
  async fetch(request,env){
    let origin='';
    try{
      origin=allowedOrigin(request,env);
      if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origin||text(env.ALLOWED_ORIGIN),'Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Max-Age':'600','Vary':'Origin'}});
      const url=new URL(request.url);if(url.pathname==='/health'&&request.method==='GET')return json({ok:true,service:'Time4Med Auth API v0.25-device-status'},200,origin);
      if(url.pathname==='/api/device/telemetry'&&request.method==='POST'){
        return json(await deviceTelemetryPost(request,env),200,origin);
      }
      const user=await authUser(request,env);const result=await handle(request,env,url,user);return json(result,200,origin);
    }catch(e){console.error('Time4Med API',e.status||500,e.message);return json({error:e.message||'เกิดข้อผิดพลาด'},e.status||500,origin);}
  }
};