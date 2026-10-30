/** Playwright: independently hosted API replaces GAS iframe only when configured. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),GH='https://n4-p4t.github.io',API='https://time4med-api-test.vercel.app/api/rpc';
async function main(){
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1380,height:900}}),apiCalls=[],unwanted=[],errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.href===API){
    const b=JSON.parse(route.request().postData()||'{}');apiCalls.push(b);
    if(b.method==='login')return route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':GH},body:JSON.stringify({ok:true,value:{token:'test-token',user:{email:'caregiver@example.com',name:'Demo',role:'CAREGIVER',patientIds:['P001']}}})});
    if(b.method==='bootstrap')return route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':GH},body:JSON.stringify({ok:true,value:{
      user:{email:'caregiver@example.com',name:'Demo',role:'CAREGIVER',patientIds:['P001']},
      patients:[{id:'P001',name:'Patient Test',shelf:1}],medicines:[],activity:[],images:[],devices:[],users:[],serverTime:'2026-10-30 12:00:00'}})});
    return route.fulfill({status:400,contentType:'application/json',headers:{'Access-Control-Allow-Origin':GH},body:JSON.stringify({ok:false,error:'Unexpected method'})});
   }
   if(u.origin===GH&&u.pathname.startsWith('/Time4Med/')){
    if(u.pathname.endsWith('/api-config.js'))return route.fulfill({status:200,contentType:'application/javascript',body:"window.TIME4MED_API_URL='"+API+"';"});
    const rel=u.pathname.slice('/Time4Med/'.length),local=path.resolve(root,rel.endsWith('/')?rel+'index.html':rel);
    if(!local.startsWith(root+path.sep))return route.abort();
    try{
     const body=fs.readFileSync(local);
     return route.fulfill({status:200,body,contentType:local.endsWith('.js')?'application/javascript':local.endsWith('.css')?'text/css':local.endsWith('.png')?'image/png':'text/html'});
    }catch(_){return route.fulfill({status:404,body:'not found'});}
   }
   unwanted.push(route.request().url());return route.abort();
  });
  await page.goto(GH+'/Time4Med/test-v021/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#gasPasswordLogin');
  assert.equal(await page.locator('#gasOtpRequest').count(),0,'OTP should not be rendered when API enabled');
  await page.locator('#gasUsername').fill('caregiver01');
  await page.locator('#gasPassword').fill('some-password');
  await page.locator('#gasPasswordLogin button').click();
  await page.waitForSelector('.t21-kpi-value',{timeout:10000});
  assert.match(await page.locator('#dashboard').innerText(),/ผู้สูงอายุในสิทธิ์/);
  assert.match(await page.locator('#dashboard').innerText(),/Patient Test/);
  assert.equal(apiCalls.length,2);
  assert.deepEqual(apiCalls.map(x=>x.method),['login','bootstrap']);
  assert.equal(unwanted.some(x=>/script\.google\.com|workers\.dev|hivemq/.test(x)),false);
  assert.deepEqual(errors,[]);
  console.log('PASS: configured independent API username/password → caregiver dashboard with no GAS iframe');
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});