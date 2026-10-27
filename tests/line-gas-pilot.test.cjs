const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');

const script = fs.readFileSync('integrations/line-apps-script/Code.gs','utf8');
const fakeToken = 'not-a-real-channel-token-for-tests-only';
const goodUser = 'U0123456789abcdef0123456789abcdef';

function harness(overrides={}) {
  const properties=new Map(Object.entries({
    LINE_CHANNEL_ACCESS_TOKEN: fakeToken,
    LINE_TEST_USER_ID:goodUser,
    ...overrides
  }));
  const calls=[], logs=[];
  let quotaUsed=0,limit=300,pushStatus=200;
  const state={
    get quotaUsed(){return quotaUsed},
    set quotaUsed(value){quotaUsed=value},
    get limit(){return limit},
    set limit(value){limit=value},
    get pushStatus(){return pushStatus},
    set pushStatus(value){pushStatus=value}
  };
  const responder=(status,obj)=>({
    getResponseCode:()=>status,
    getContentText:()=>JSON.stringify(obj)
  });
  const fetch=(url,opts={})=>{
    calls.push({url,opts});
    if (url.endsWith('/info'))return responder(200,{basicId:'@test-bot'});
    if (url.endsWith('/message/quota'))return responder(200,{type:'limited',value:limit});
    if (url.endsWith('/message/quota/consumption'))return responder(200,{totalUsage:quotaUsed});
    if (url.endsWith('/message/push'))return responder(pushStatus,pushStatus===200?{}:{message:'fail'});
    throw Error('Unexpected URL '+url);
  };
  const context={
    PropertiesService:{getScriptProperties:()=>({
      getProperty:key=>properties.get(key)||null,
      setProperty:(key,value)=>{properties.set(key,value);return null;}
    })},
    UrlFetchApp:{fetch},
    LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
    Utilities:{getUuid:()=> '123e4567-e89b-42d3-a456-426614174000'},
    console:{log:message=>logs.push(String(message))}
  };
  vm.runInNewContext(script,context,{timeout:2000});
  return {context,properties,calls,logs,state};
}

test('read-only check does not send',()=>{
  const t=harness();
  const result=t.context.checkLineSetup();
  assert.equal(result.channelReachable,true);
  assert.equal(result.targetIdConfigured,true);
  assert.equal(result.sendEnabled,false);
  assert.equal(result.quota.officialLimit,300);
  assert.equal(t.calls.length,3);
  assert.ok(t.calls.every(c=>c.opts.method!=='post'));
  assert.ok(t.logs.every(x=>!x.includes(fakeToken)&&!x.includes(goodUser)));
});

test('not confirmed rejects with no request',()=>{
  const t=harness();
  assert.throws(()=>t.context.sendLineTestOnce(),/LINE_TEST_NOT_CONFIRMED/);
  assert.equal(t.calls.length,0);
});

test('invalid user ID rejects before quota check',()=>{
  const t=harness({LINE_TEST_CONFIRM:'YES',LINE_TEST_USER_ID:'invalid'});
  assert.throws(()=>t.context.sendLineTestOnce(),/LINE_TEST_RECIPIENT_INVALID/);
  assert.equal(t.calls.length,0);
});

test('one-time send accepted, repeated manual run refused',()=>{
  const t=harness({LINE_TEST_CONFIRM:'YES'});
  const r=t.context.sendLineTestOnce();
  assert.equal(r.apiAccepted,true);
  assert.equal(r.deliveryConfirmed,false);
  assert.equal(t.properties.get('LINE_TEST_STATE'),'API_ACCEPTED');
  assert.equal(t.calls.filter(c=>c.url.endsWith('/message/push')).length,1);
  const push=t.calls.find(c=>c.url.endsWith('/message/push'));
  const body=JSON.parse(push.opts.payload);
  assert.equal(body.to,goodUser);
  assert.equal(body.messages.length,1);
  assert.match(body.messages[0].text,/ทดสอบ/);
  assert.equal(push.opts.headers['X-Line-Retry-Key'],t.properties.get('LINE_TEST_RETRY_KEY'));
  assert.throws(()=>t.context.sendLineTestOnce(),/LINE_TEST_ALREADY_ATTEMPTED/);
  assert.equal(t.calls.filter(c=>c.url.endsWith('/message/push')).length,1);
  assert.ok(t.logs.every(x=>!x.includes(fakeToken)&&!x.includes(goodUser)));
});

test('quota guard stops before sending',()=>{
  const t=harness({LINE_TEST_CONFIRM:'YES'});
  t.state.quotaUsed=280;
  assert.throws(()=>t.context.sendLineTestOnce(),/LINE_TEST_QUOTA_GUARD/);
  assert.equal(t.calls.filter(c=>c.url.endsWith('/message/push')).length,0);
  assert.equal(t.properties.get('LINE_TEST_STATE'),undefined);
});

test('quota endpoint failure blocks sending',()=>{
  const t=harness({LINE_TEST_CONFIRM:'YES'});
  t.state.limit=0;
  assert.throws(()=>t.context.sendLineTestOnce(),/LINE_QUOTA_UNVERIFIED/);
  assert.equal(t.calls.filter(c=>c.url.endsWith('/message/push')).length,0);
});

test('HTTP failure stays attempted; does not retry automatically',()=>{
  const t=harness({LINE_TEST_CONFIRM:'YES'});
  t.state.pushStatus=429;
  assert.throws(()=>t.context.sendLineTestOnce(),/LINE_PUSH_HTTP_429_CHECK_BEFORE_RETRY/);
  assert.equal(t.properties.get('LINE_TEST_STATE'),'ATTEMPTED');
  assert.throws(()=>t.context.sendLineTestOnce(),/LINE_TEST_ALREADY_ATTEMPTED/);
  assert.equal(t.calls.filter(c=>c.url.endsWith('/message/push')).length,1);
});

test('no Cloudflare endpoint, webhook or schedule trigger in pilot code',()=>{
  assert.doesNotMatch(script,/workers[.]dev|function\s+doPost\s*\(|ScriptApp[.]newTrigger|SpreadsheetApp[.]openById/i);
  assert.match(script,/PropertiesService\.getScriptProperties\(\)/);
  assert.match(script,/https:\/\/api\.line\.me\/v2\/bot/);
});
