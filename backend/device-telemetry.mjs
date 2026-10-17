/* Cloudflare Worker extension for Time4Med.
 * Device status only: never unlocks or changes medication schedules.
 * Required Cloudflare Secret: DEVICE_STATUS_HMAC_KEY (64 hexadecimal chars)
 * Required Cloudflare KV binding: DEVICE_STATUS_KV
 */
const PATH='/api/device/telemetry',STORAGE_KEY='telemetry:cabinet-01',FRESH_MS=150000;
const DEVICE='ESP32S3-01';
const fail=(status,code)=>{const e=new Error(code);e.status=status;throw e;};
const utf8=new TextEncoder();
const hexBytes=hex=>Uint8Array.from(hex.match(/../g)||[],x=>parseInt(x,16));
async function authenticatedDevice(request,env,payload) {
  const timestamp=request.headers.get('X-T4M-Timestamp')||'';
  const nonce=request.headers.get('X-T4M-Nonce')||'';
  const signature=request.headers.get('X-T4M-Signature')||'';
  if(!/^[0-9]{10}$/.test(timestamp)||
     Math.abs(Math.floor(Date.now()/1000)-Number(timestamp))>90||
     !/^[a-fA-F0-9]{32}$/.test(nonce)||
     !/^[a-fA-F0-9]{64}$/.test(signature))fail(401,'INVALID_DEVICE_SIGNATURE');
  if(!/^[a-fA-F0-9]{64}$/.test(env.DEVICE_STATUS_HMAC_KEY||''))fail(503,'DEVICE_KEY_NOT_CONFIGURED');
  const key=await crypto.subtle.importKey('raw',hexBytes(env.DEVICE_STATUS_HMAC_KEY),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signed='T4M-STATUS-V1\n'+PATH+'\n'+timestamp+'\n'+nonce+'\n'+payload;
  const mac=new Uint8Array(await crypto.subtle.sign('HMAC',key,utf8.encode(signed)));
  const provided=hexBytes(signature);
  let difference=0;
  for(let i=0;i<32;i++) difference|=mac[i]^provided[i];
  if(difference)fail(401,'INVALID_DEVICE_SIGNATURE');
  return nonce.toLowerCase();
}
export async function deviceTelemetryPost(request,env){
  if(!env.DEVICE_STATUS_KV)fail(503,'DEVICE_KV_NOT_CONFIGURED');
  if(Number(request.headers.get('Content-Length')||0)>1024)fail(413,'BODY_TOO_LARGE');
  const raw=await request.text();
  if(raw.length>1024)fail(413,'BODY_TOO_LARGE');
  const nonce=await authenticatedDevice(request,env,raw);
  const nonceKey='nonce:'+nonce;
  // KV nonce check is best-effort for cross-region concurrency, acceptable for
  // read-only telemetry but NOT to authorize a physical actuator.
  if(await env.DEVICE_STATUS_KV.get(nonceKey)!==null)fail(409,'DUPLICATE_NONCE');
  let d;
  try{d=JSON.parse(raw);}catch(_){fail(400,'INVALID_JSON');}
  if(!d||d.device_id!==DEVICE||d.online!==true||
    !['LOCKED','UNLOCKED'].includes(d.lock_status)||
    !['CLOSED','OPEN'].includes(d.door_status)||
    typeof d.emergency!=='boolean'||typeof d.rtc_valid!=='boolean'||
    typeof d.system_state!=='string'||d.system_state.length>48||
    (d.reason!==undefined&&(typeof d.reason!=='string'||d.reason.length>48)))
    fail(422,'INVALID_DEVICE_STATUS');
  const stored={device_id:DEVICE,online:true,lock_status:d.lock_status,
    door_status:d.door_status,emergency:d.emergency,rtc_valid:d.rtc_valid,
    system_state:d.system_state,reason:d.reason||'',received_at:new Date().toISOString()};
  await env.DEVICE_STATUS_KV.put(nonceKey,'1',{expirationTtl:300});
  await env.DEVICE_STATUS_KV.put(STORAGE_KEY,JSON.stringify(stored),{expirationTtl:600});
  return {ok:true,stored:true};
}
export async function deviceTelemetryGet(env,user){
  if(!user||!['ADMIN','CAREGIVER'].includes(user.role))fail(403,'NOT_AUTHORIZED');
  if(!env.DEVICE_STATUS_KV)fail(503,'DEVICE_KV_NOT_CONFIGURED');
  const raw=await env.DEVICE_STATUS_KV.get(STORAGE_KEY);
  if(!raw)return {state:'NO_DATA',device_id:DEVICE,received_at:null};
  let data;try{data=JSON.parse(raw);}catch(_){return {state:'UNAVAILABLE',device_id:DEVICE,received_at:null};}
  const age=Date.now()-Date.parse(data.received_at||'');
  if(!Number.isFinite(age)||age< -10000||age>FRESH_MS)
    return {state:'STALE',device_id:DEVICE,received_at:data.received_at||null};
  return {state:'LIVE',device_id:DEVICE,received_at:data.received_at,
    telemetry:{lock_status:data.lock_status,door_status:data.door_status,
      emergency:data.emergency,rtc_valid:data.rtc_valid,
      system_state:data.system_state,reason:data.reason}};
}
