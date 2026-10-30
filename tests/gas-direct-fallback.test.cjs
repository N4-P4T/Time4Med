/** Browser test: if all Google iframe routes fail, offer existing direct Apps Script UI. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),GH='https://n4-p4t.github.io',GAS='https://script.google.com';
async function main(){
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try {
  const page=await browser.newPage(),errors=[],urls=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await page.route('**/*',route=>{
   const u=new URL(route.request().url());
   if(u.origin===GAS&&u.pathname.endsWith('/exec')){urls.push(u.href);return route.fulfill({status:404,body:'Google multi-login routing 404'});}
   if(u.origin===GH&&u.pathname.startsWith('/Time4Med/')){
    const rel=u.pathname.slice('/Time4Med/'.length),local=path.resolve(root,rel.endsWith('/')?rel+'index.html':rel);
    if(!local.startsWith(root+path.sep))return route.abort();
    try{
     const body=fs.readFileSync(local);
     return route.fulfill({status:200,body,contentType:local.endsWith('.js')?'application/javascript':local.endsWith('.css')?'text/css':local.endsWith('.png')?'image/png':'text/html'});
    }catch(_){return route.fulfill({status:404,body:'missing'});}
   }
   return route.abort();
  });
  await page.goto(GH+'/Time4Med/test-v021/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#gasDirectFallback:visible',{timeout:35000});
  assert.equal(urls.length,5,'All 5 distinct Google account routing hints attempted');
  assert.equal(await page.locator('#gasFallbackNote').isVisible(),true);
  const direct=await page.locator('#gasDirectFallback').getAttribute('href');
  assert.match(direct,/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/);
  assert.equal(await page.locator('#gasDirectFallback').getAttribute('target'),'_blank');
  assert.deepEqual(errors,[]);
  console.log('PASS: all Google bridge attempts 404, safe direct Apps Script UI fallback shown');
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});