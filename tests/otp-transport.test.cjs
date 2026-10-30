/** Regression: Time4Med must not request an OTP until Apps Script RPC works.
 * No real Google account, network, patient records or emails touched. */
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('test-v021/gas-only.js','utf8');
const begin=source.indexOf('async function verifyRpcBeforeLogin(){');
const end=source.indexOf("window.addEventListener('message'",begin);
assert.ok(begin>0&&end>begin,'backend probe exists');
const probeSource=source.slice(begin,end)+'\nthis.verify=verifyRpcBeforeLogin;';
assert.match(source,/if\(!state\.rpcVerified\)\{message\('ยังตรวจสอบการเชื่อมต่อ Apps Script ไม่สำเร็จ/);
assert.match(source,/gasOtpRequest'\)\.querySelector\('button\[type="submit"\]'\)\.disabled=true/);
assert.match(source,/method==='logout'&&args\[0\]===null\?18000:45000/);
async function scenario(reply){
  const button={disabled:false},status={value:''},messages=[],fallbacks=[],calls=[];
  const context={
    state:{rpcVerified:false},
    $:id=>id==='gasOtpRequest'?{querySelector:()=>button}:null,
    text:(id,value)=>{status.value=value},
    message:(value,bad)=>messages.push({value,bad:!!bad}),
    showDirectFallback:value=>fallbacks.push(value),
    call:async(method,arg)=>{calls.push({method,arg});if(reply instanceof Error)throw reply;return reply;},
    Error,
  };
  vm.runInNewContext(probeSource,context);
  await context.verify();
  assert.equal(calls.length,1);
  assert.equal(calls[0].method,'logout');
  assert.equal(calls[0].arg,null);
  return {context,button,status,messages,fallbacks};
}
(async()=>{
  const good=await scenario(true);
  assert.equal(good.context.state.rpcVerified,true,'working Google RPC enables OTP');
  assert.equal(good.button.disabled,false);
  assert.equal(good.fallbacks.length,0);
  const bad=await scenario(new Error('GAS blocked in iframe'));
  assert.equal(bad.context.state.rpcVerified,false);
  assert.equal(bad.button.disabled,true,'broken Google RPC cannot send OTP');
  assert.equal(bad.fallbacks.length,1);
  assert.ok(bad.messages.some(x=>x.bad&&x.value.includes('ยังไม่ส่ง OTP')));
  const unexpected=await scenario('not-true');
  assert.equal(unexpected.context.state.rpcVerified,false);
  assert.equal(unexpected.button.disabled,true,'unexpected response cannot send OTP');
  console.log('PASS: backend RPC preflight enables OTP only for a real Google reply');
})().catch(error=>{console.error(error);process.exitCode=1;});
