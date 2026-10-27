import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReminderText,sendLineReminder,verifyLineWebhookSignature,LINE_API} from '../backend/line-messaging.mjs';

const token='test-only-access-token-not-a-real-secret';
const recipient='U0123456789abcdef0123456789abcdef';
const retryKey='123e4567-e89b-42d3-a456-426614174000';
const reminder={patientIds:['P002','P001','P001'],mealType:2,time:'08:30'};
const ok=(data,status=200,headers={})=>new Response(JSON.stringify(data),{
  status,headers:{'Content-Type':'application/json',...headers}
});
function stub({limit=300,used=50,postStatus=200,failQuota=false,acceptedId='' }={}){
  const calls=[];
  const fetchImpl=async (url,options={})=>{
    calls.push({url,options});
    if(url.endsWith('/message/quota'))return failQuota?ok({message:'fail'},503):ok({type:'limited',value:limit});
    if(url.endsWith('/message/quota/consumption'))return ok({totalUsage:used});
    if(url.endsWith('/message/push'))return ok(postStatus===200?{}:{message:'test'},postStatus,
      acceptedId?{'x-line-accepted-request-id':acceptedId}:{});
    throw Error('Unexpected request '+url);
  };
  return {calls,fetchImpl};
}
const env={LINE_PUSH_ENABLED:'true',LINE_CHANNEL_ACCESS_TOKEN:token};

test('reminder groups valid patient identifiers only and contains a caregiver link',()=>{
  const text=buildReminderText(reminder);
  assert.match(text,/P001, P002/);
  assert.match(text,/หลังอาหารเช้า เวลา 08:30/);
  assert.match(text,/https:\/\/n4-p4t.github.io\/Time4Med\//);
  assert.doesNotMatch(text,/ชื่อยา|โรคประจำตัว|กลืนยาแล้ว/);
  assert.throws(()=>buildReminderText({...reminder,patientIds:['P004']}),/INVALID_REMINDER/);
  assert.throws(()=>buildReminderText({...reminder,time:'25:90'}),/INVALID_REMINDER/);
});

test('send is disabled by default; no network or credentials in browser',async()=>{
  const mock=stub();
  await assert.rejects(sendLineReminder({env:{...env,LINE_PUSH_ENABLED:'false'},
    lineUserId:recipient,reminder,retryKey,fetchImpl:mock.fetchImpl}),/LINE_DISABLED/);
  await assert.rejects(sendLineReminder({env:{LINE_PUSH_ENABLED:'true'},
    lineUserId:recipient,reminder,retryKey,fetchImpl:mock.fetchImpl}),/LINE_NOT_CONFIGURED/);
  await assert.rejects(sendLineReminder({env,lineUserId:'invalid',reminder,retryKey,fetchImpl:mock.fetchImpl}),
    /INVALID_LINE_RECIPIENT/);
  assert.equal(mock.calls.length,0);
});

test('push reads quota before sending and never reports delivered',async()=>{
  const mock=stub();
  const result=await sendLineReminder({env,lineUserId:recipient,reminder,retryKey,fetchImpl:mock.fetchImpl});
  assert.deepEqual(result,{accepted:true,duplicate:false,delivered:false});
  assert.equal(mock.calls.length,3);
  assert.deepEqual(mock.calls.map(c=>c.url),[
    LINE_API+'/message/quota',LINE_API+'/message/quota/consumption',LINE_API+'/message/push']);
  const push=mock.calls[2].options;
  assert.equal(push.method,'POST');
  assert.equal(push.headers['X-Line-Retry-Key'],retryKey);
  assert.equal(push.headers.Authorization,'Bearer '+token);
  const body=JSON.parse(push.body);
  assert.equal(body.to,recipient);
  assert.equal(body.messages.length,1);
  assert.match(body.messages[0].text,/P001, P002/);
});

test('quota guard fails closed on exhausted, missing or unreachable usage',async()=>{
  for(const sample of [{used:280},{limit:250,used:250},{failQuota:true}]){
    const mock=stub(sample);
    await assert.rejects(sendLineReminder({env,lineUserId:recipient,reminder,retryKey,
      fetchImpl:mock.fetchImpl}),/LINE_QUOTA/);
    assert.equal(mock.calls.filter(c=>c.url.endsWith('/message/push')).length,0);
  }
});

test('LINE 409 accepted retry is deduplicated; an HTTP failure is not reported as sent',async()=>{
  const duplicate=stub({postStatus:409,acceptedId:'req-id-test'});
  const r=await sendLineReminder({env,lineUserId:recipient,reminder,retryKey,fetchImpl:duplicate.fetchImpl});
  assert.deepEqual(r,{accepted:true,duplicate:true,delivered:false});
  const failed=stub({postStatus:429});
  await assert.rejects(sendLineReminder({env,lineUserId:recipient,reminder,retryKey,
    fetchImpl:failed.fetchImpl}),/LINE_SEND_HTTP_429/);
});

test('webhook HMAC verifies exact raw bytes and rejects tampering',async()=>{
  const rawBody='{"destination":"Utest","events":[{"type":"follow"}]}';
  const secret='test-channel-secret-only';
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  const mac=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(rawBody)));
  const signature=btoa(String.fromCharCode(...mac));
  assert.equal(await verifyLineWebhookSignature({rawBody,signature,channelSecret:secret}),true);
  assert.equal(await verifyLineWebhookSignature({rawBody:rawBody.replace('follow','unfollow'),
    signature,channelSecret:secret}),false);
  assert.equal(await verifyLineWebhookSignature({rawBody,signature:'garbage',
    channelSecret:secret}),false);
});
