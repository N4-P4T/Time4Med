// End-to-end simulated Worker tests with ephemeral RSA keys and mock Google APIs.
// No real Google, Sheets, Cloudflare, HiveMQ, ESP32, or external network calls.
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createPublicKey} from 'node:crypto';
import worker from '../backend/worker-v020-preview.mjs';

const google=generateKeyPairSync('rsa',{modulusLength:2048});
const service=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk=createPublicKey(google.privateKey).export({format:'jwk'});
jwk.kid='integration-test-kid';jwk.alg='RS256';jwk.use='sig';
const env={
 ALLOWED_ORIGIN:'https://n4-p4t.github.io',
 GOOGLE_CLIENT_ID:'test-id.apps.googleusercontent.com',
 SPREADSHEET_ID:'test-sheet',
 GCP_CLIENT_EMAIL:'test-service@invalid.example',
 GCP_PRIVATE_KEY:service.privateKey.export({format:'pem',type:'pkcs8'}).toString()
};
let medicineRows=[[
 'test-med-01','คนที่หนึ่ง','ยาทดสอบ','scheduled','2','morning','1','08:30',
 '','ok','','','','TRUE','WEB','P001'
],[
 'test-med-02','คนที่สอง','ยาทดสอบ','scheduled','6','evening','2','18:30',
 '','ok','','','','TRUE','WEB','P002'
]];
const patientRows=[
 ['P001','คนที่หนึ่ง','','','ACTIVE'],
 ['P002','คนที่สอง','','','ACTIVE'],
 ['P003','คนที่สาม','','','ACTIVE']
];
const users=[
 ['U-test-admin','admin@example.invalid','Admin','ADMIN','ALL','','','ACTIVE','',''],
 ['U-test-caregiver','care@example.invalid','Caregiver','CAREGIVER','P001','','','ACTIVE','','']
];
const externalCalls=[];
globalThis.fetch=async function mockExternal(input,init={}){
 const url=new URL(typeof input==='string'?input:input.url);
 externalCalls.push({hostname:url.hostname,pathname:decodeURIComponent(url.pathname),method:init.method||'GET'});
 if(url.hostname==='www.googleapis.com'&&url.pathname==='/oauth2/v3/certs')
   return Response.json({keys:[jwk]});
 if(url.hostname==='oauth2.googleapis.com'&&url.pathname==='/token')
   return Response.json({access_token:'MOCK-SHEETS-TOKEN',expires_in:3600});
 if(url.hostname==='sheets.googleapis.com'){
   const pathname=decodeURIComponent(url.pathname);
   if(pathname.includes('Users!'))return Response.json({values:users});
   if(pathname.includes('Patients!'))return Response.json({values:patientRows});
   if(pathname.includes('MealMedicines!'))return Response.json({values:medicineRows});
   throw Error('Unexpected Sheets call: '+pathname);
 }
 throw Error('Unexpected external HTTP call: '+url.href);
};
const b64=buffer=>Buffer.from(buffer).toString('base64url');
function token(email,aud=env.GOOGLE_CLIENT_ID){
 const now=Math.floor(Date.now()/1000);
 const head=b64(JSON.stringify({alg:'RS256',typ:'JWT',kid:jwk.kid}));
 const body=b64(JSON.stringify({iss:'https://accounts.google.com',aud,sub:'subject-'+email,email,email_verified:true,iat:now,exp:now+1800,name:'Test'}));
 const payload=head+'.'+body;
 return payload+'.'+b64(sign('RSA-SHA256',Buffer.from(payload),google.privateKey));
}
async function request(path,email,method='GET',origin=env.ALLOWED_ORIGIN,audience){
 const headers={'Origin':origin};
 if(email)headers.Authorization='Bearer '+token(email,audience);
 const req=new Request('https://worker.invalid'+path,{method,headers});
 const response=await worker.fetch(req,env);
 const data=await response.json();
 return {status:response.status,data,headers:response.headers};
}
const path='/api/cabinets/cabinet-01/schedule';
let result=await request(path+'/preview','admin@example.invalid');
assert.equal(result.status,200,JSON.stringify(result.data));
assert.equal(result.data.preview.slots.length,2);
assert.equal(result.data.preview.state,'PREVIEW_ONLY');
assert.equal(result.data.preview.applied,false);
assert.match(result.data.preview.revision16,/^[a-f0-9]{16}$/);
assert.equal(result.headers.get('Access-Control-Allow-Origin'),env.ALLOWED_ORIGIN);
assert.equal(result.headers.get('Cache-Control'),'no-store');
result=await request(path+'/preview','care@example.invalid');
assert.equal(result.status,403,'Caregiver must not prepare a full-cabinet replacement');
result=await request(path+'/commit','admin@example.invalid','POST');
assert.equal(result.status,503,'Commit must fail-closed even for admin');
assert.match(result.data.error,/SCHEDULE_GATEWAY_DISABLED/);
result=await request(path+'/preview',null);
assert.equal(result.status,401);
result=await request(path+'/preview','admin@example.invalid','GET','https://evil.example');
assert.equal(result.status,403);
result=await request(path+'/preview','admin@example.invalid','GET',env.ALLOWED_ORIGIN,'wrong-client');
assert.equal(result.status,401,'Token audience verification');
result=await request('/api/medicines','care@example.invalid');
assert.equal(result.status,200,'v0.19 caregiver med endpoint remains working');
assert.equal(result.data.medicines.length,1,'v0.19 permissions are still patient-scoped');

medicineRows[0][6]='2'; // wrong P001 compartment
result=await request(path+'/preview','admin@example.invalid');
assert.equal(result.status,422,'Wrong fixed compartment fails closed');
assert.equal(result.data.error,'WRONG_COMPARTMENT');
medicineRows[0][6]='1';medicineRows[0][4]='INVALID';
result=await request(path+'/preview','admin@example.invalid');
assert.equal(result.status,422,'Malformed meal must not silently default to breakfast');
medicineRows[0][4]='2';
assert.equal(externalCalls.some(c=>c.hostname.includes('hivemq')),false,
 'No outgoing MQTT or broker network requests in staging Worker');
console.log('PASS: signed Google JWT verification, role/patient auth, API preview validation, bad origin/aud, fail-closed commit, no MQTT calls');
