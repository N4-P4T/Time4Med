/** Read-only live diagnostic: no OTP, credentials, Sheets, or LINE requests. */
'use strict';
const { chromium }=require('playwright');
const GITHUB='https://n4-p4t.github.io/Time4Med/test-v021/';
const GAS='https://script.google.com/macros/s/AKfycbx2-O9PDp-T0eXoP1A9_xesHk8mWcWszAbLsbsFOMpARpIIICibdKu6On0G0agGdMIEtQ/exec';
function label(url){try{let u=new URL(url);return u.hostname+u.pathname.substring(0,70)+(u.searchParams.has('bridge')?'?bridge=1':'');}catch{return '<unknown>';}}
async function frameDetails(page) {
 const out=[];
 for(const [i,frame] of page.frames().entries()){
  let data={i,url:label(frame.url())};
  try{data.snapshot=await frame.evaluate(()=>({
    title:document.title,origin:location.origin,hrefPath:location.pathname.slice(0,80),
    hasBridgeText:document.body?.innerText.includes('Time4Med secure bridge'),
    containsRPC:document.documentElement.outerHTML.includes('time4med-gas-bridge'),
    hasGoogleRunner:typeof google!=='undefined'&&typeof google.script?.run!=='undefined',
    bodyText:document.body?.innerText.slice(0,100).replace(/\s+/g,' ')
  }));}catch(e){data.error=String(e.message).slice(0,170)}
  out.push(data);
 }
 return out;
}
async function observe(browser,url,sec){
 const page=await browser.newPage({viewport:{width:1200,height:800}});
 const errors=[],failed=[],requests=[],responses=[];
 page.on('pageerror',e=>errors.push(String(e.message).slice(0,250)));
 page.on('console',m=>{if(m.type()==='error')errors.push('CONSOLE '+m.text().slice(0,230));});
 page.on('requestfailed',r=>failed.push({url:label(r.url()),failure:r.failure()?.errorText}));
 page.on('request',r=>{if(requests.length<25)requests.push(label(r.url()))});
 page.on('response',r=>{if(responses.length<35)responses.push({u:label(r.url()),code:r.status()})});
 try{
  const main=await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForTimeout(sec*1000);
  const state=await page.evaluate(()=>({
   status:document.querySelector('#gasStatus')?.textContent||'',
   connection:document.querySelector('#gasConnectState')?.textContent||'',
   title:document.title,
   frames:document.querySelectorAll('iframe').length,
   bridgeIframeSrc:document.querySelector('#time4medSecureBridge')?.getAttribute('src')?.replace(/channel=.*/, 'channel=<redacted>')||'none'
  }));
  console.log(JSON.stringify({kind:'PAGE',url:label(url),mainStatus:main?.status(),state,frames:await frameDetails(page),errors,failed,requests,responses},null,2));
 }catch(e){console.log(JSON.stringify({kind:'ERROR',url:label(url),message:String(e.message).slice(0,500),frames:await frameDetails(page),errors,failed},null,2));}
 await page.close();
}
async function run(){
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  await observe(browser,GITHUB,18);
  await observe(browser,GAS+'?bridge=1&channel=abcdef0123456789abcdef0123456789',5);
 }finally{await browser.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
