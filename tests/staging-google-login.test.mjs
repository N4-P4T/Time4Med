import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../staging-google-login/index.html',import.meta.url),'utf8');
const source=readFileSync(new URL('../staging-google-login/status.js',import.meta.url),'utf8');

assert.match(html,/time4med-api-staging\.napat-kaewboonpan\.workers\.dev/);
assert.doesNotMatch(html,/https:\/\/time4med-api\.napat-kaewboonpan\.workers\.dev/);
assert.match(html,/\.\.\/test-v019\/auth\.js/);
assert.match(html,/id="t4mGoogleButton"/);
assert.match(html,/id="t4mSignOut"/);
assert.match(html,/id="t4mAdminSection"/);
assert.match(html,/id="t25DevicePanel"/);
assert.doesNotMatch(html,/\bGCP_PRIVATE_KEY\s*[:=]/);
assert.doesNotMatch(html,/mqtt\.hivemq|wss:\/\/|<input[^>]+type="password"/i);
assert.doesNotMatch(source,/\/api\/device\/telemetry|\/api\/medicines|\/api\/users|\/api\/lock/);
assert.match(source,/Time4MedAuth\.api\('\/api\/devices\/status'\)/);

const elements=new Map();
const element=id=>{
 if(!elements.has(id))elements.set(id,{id,textContent:'',hidden:false,disabled:false,dataset:{},listeners:{},
   addEventListener(name,fn){this.listeners[name]=fn;}});
 return elements.get(id);
};
const handlers={};
const context={document:{getElementById:element},window:{
 addEventListener(name,handler){handlers[name]=handler;},
 setInterval(){},
 Time4MedAuth:{user:null,api:()=>Promise.resolve({state:'NO_DATA'})}
},Date,Promise,Number,String};
vm.runInNewContext(source,context,{filename:'status.js'});
assert.equal(element('t25DevicePanel').hidden,true,'unauthenticated screen must hide telemetry');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const login=user=>{context.window.Time4MedAuth.user=user;handlers['time4med-auth-changed']({detail:{user}});};
const clickRefresh=()=>element('t25Refresh').listeners.click();
const live=(time=Date.now(),reason='')=>({
 state:'LIVE',received_at:new Date(time).toISOString(),
 telemetry:{door_status:'CLOSED',lock_status:'LOCKED',emergency:false,rtc_valid:true,system_state:'IDLE',reason}
});

login({role:'ADMIN'});
await flush();await flush();
assert.match(element('t25DeviceState').textContent,/NO_DATA/);
assert.equal(element('t25Door').textContent,'—');

context.window.Time4MedAuth.api=async()=>live(Date.now(),'STAGING_TEST');
clickRefresh();await flush();await flush();
assert.match(element('t25DeviceState').textContent,/ข้อมูลจำลอง/);
assert.match(element('t25DeviceMessage').textContent,/PowerShell/);
assert.equal(element('t25Lock').textContent,'ล็อก');

context.window.Time4MedAuth.api=async()=>live(Date.now()-160000);
clickRefresh();await flush();await flush();
assert.match(element('t25DeviceState').textContent,/STALE/);
assert.equal(element('t25Door').textContent,'—','stale data must erase former reading');

context.window.Time4MedAuth.api=async()=>({state:'STALE',received_at:new Date(Date.now()-200000).toISOString()});
clickRefresh();await flush();await flush();
assert.match(element('t25DeviceState').textContent,/STALE/);
assert.equal(element('t25Lock').textContent,'—');

let resolvePending;
context.window.Time4MedAuth.api=()=>new Promise(r=>{resolvePending=r;});
clickRefresh();
login(null);
assert.equal(element('t25DevicePanel').hidden,true);
resolvePending(live(Date.now(),'STAGING_TEST'));
await flush();await flush();
assert.equal(element('t25Door').textContent,'—','late response cannot reveal data after logout');

let resolveVeryOld;
context.window.Time4MedAuth.api=()=>new Promise(r=>{resolveVeryOld=r;});
login({role:'ADMIN'});
context.window.Time4MedAuth.api=async()=>({state:'NO_DATA'});
login({role:'ADMIN'});
await flush();await flush();
resolveVeryOld(live());
await flush();await flush();
assert.match(element('t25DeviceState').textContent,/NO_DATA/,'old session cannot overwrite new session');

console.log('PASS: staging page isolate, Google-only auth, NO_DATA, simulation, STALE, logout, login-race protections');
