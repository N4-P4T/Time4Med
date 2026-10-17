import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';

// Independent HMAC-SHA256 golden vector shared with the no-network C++ probe.
const body='{"device_id":"ESP32S3-01","online":true,"lock_status":"LOCKED","door_status":"CLOSED","emergency":false,"rtc_valid":true,"system_state":"IDLE","reason":"HEARTBEAT"}';
const time='1792240000',nonce='0123456789abcdef0123456789abcdef';
const message=['T4M-STATUS-V1','/api/device/telemetry',time,nonce,body].join('\n');
const mac=createHmac('sha256',Buffer.from(Array.from({length:32},(_,i)=>i)))
  .update(message).digest('hex');
assert.equal(mac,'778596a98d6dcc0db19ce26692bbb2e2dcbe327fedeafd54a1300352958e2995');
const header=readFileSync('firmware/telemetry_v025/Time4MedStatusSender.h','utf8');
const probe=readFileSync('firmware/Time4MedTelemetry_Probe/Time4MedTelemetry_Probe.ino','utf8');
const backend=readFileSync('backend/device-telemetry.mjs','utf8');
assert.match(header,/T4M-STATUS-V1\\n/);
assert.match(backend,/T4M-STATUS-V1\\n/);
assert.match(header,/\/api\/device\/telemetry/);
assert.match(backend,/\/api\/device\/telemetry/);
assert.match(header,/setCACert\(rootCa_\)/);
assert.match(header,/HTTPC_DISABLE_FOLLOW_REDIRECTS/);
assert.match(header,/WiFi\.status\(\)!=WL_CONNECTED/);
assert.match(header,/esp_fill_random/);
assert.match(header,/mbedtls_md_hmac/);
assert.match(header,/s\.rtcValid/);
assert.match(probe,/778596a98d6dcc0db19ce26692bbb2e2dcbe327fedeafd54a1300352958e2995/);
assert.doesNotMatch(header,/setInsecure\s*\(/);
assert.doesNotMatch(header,/\.\s*publish\s*\(|\brelay\b|\bdigitalWrite\s*\(/i);
const expected=['device_id','online','lock_status','door_status','emergency','rtc_valid','system_state','reason'];
for(const field of expected){
  assert.ok(header.includes(field),'ESP sender missing '+field);
  assert.ok(backend.includes(field),'Cloudflare backend missing '+field);
}
assert.doesNotMatch(header,/\b(?:password|client_secret|private_key)\b\s*=/i);
console.log('PASS: backend/firmware HMAC schema, golden vector, TLS-only and zero GPIO/actuation calls');
