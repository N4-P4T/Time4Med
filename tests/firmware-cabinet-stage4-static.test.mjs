import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';

const root = new URL('../firmware/Time4Med_Cabinet_Stage4/',import.meta.url);
const sketch = readFileSync(new URL('Time4Med_Cabinet_Stage4.ino',root),'utf8');
const sender = readFileSync(new URL('Time4MedStatusSender.h',root),'utf8');
const config = readFileSync(new URL('telemetry_config.h',root),'utf8');
const priv = readFileSync(new URL('telemetry_private.h.example',root),'utf8');

const pins={RELAY_PIN:4,CONFIRM_BUTTON_PIN:5,REED_SWITCH_PIN:6,EMERGENCY_BUTTON_PIN:7,I2C_SDA_PIN:8,I2C_SCL_PIN:9,STATUS_LED_PIN:10,DF_TX_PIN:17,DF_RX_PIN:18};
for (const [name,value] of Object.entries(pins)) {
 assert.match(sketch,new RegExp('constexpr uint8_t '+name+' = '+value+';'),name+' must remain unchanged');
}
for(const needle of [
 'const char *CAMERA_CAPTURE_BASE_URL = "http://172.20.10.6/capture";',
 'constexpr char FIRMWARE_VERSION[] = "0.11.0-safe-schedules";',
 'constexpr uint8_t RELAY_LOCK_LEVEL = LOW;',
 'constexpr uint8_t RELAY_UNLOCK_LEVEL = HIGH;',
 'Time4MedNetworkConfig networkConfig;',
 'rtc.begin()','player.begin(dfSerial)','updateMedicineState();','updateSystemAudioAlerts();',
 'checkMedicineSchedule(now);','maintainCloudQueue();','maintainMqtt();','requestSafeLock(',
 'schedules[SCHEDULE_COUNT]','track','pendingRemoteLockCommand','syncRTCFromNTP()'
]) assert.ok(sketch.includes(needle),'Missing original cabinet feature: '+needle);
assert.equal((sketch.match(/\bvoid setup\(\)/g)||[]).length,1);
assert.equal((sketch.match(/\bvoid loop\(\)/g)||[]).length,1);
assert.match(sketch,/xQueueCreate\(1, sizeof\(T4MStatusSnapshot\)\)/);
assert.match(sketch,/xQueueOverwrite\(t4mStatusQueue, &current\)/);
assert.match(sketch,/xTaskCreatePinnedToCore\(t4mStatusSenderTask,[\s\S]*?12288, nullptr, 1/);
assert.match(sketch,/void maintainT4MStatusTelemetry\(\)/);
assert.match(sketch,/maintainT4MStatusTelemetry\(\);/);
assert.match(sketch,/void beginT4MStatusTelemetry\(\)/);
assert.match(sketch,/beginT4MStatusTelemetry\(\);/);
assert.match(sketch,/current\.lockUnlocked = lockIsUnlocked;/);
assert.match(sketch,/systemState != SystemState::IDLE/,'HTTPS must not start during medicine or access state');
assert.match(sketch,/pendingLockReason != PendingLockReason::NONE/,'HTTPS must not start while locking');
assert.match(sketch,/emergencyIsActive\(\) \|\| audioPlaying \|\| audioCount != 0/,'Do not queue TLS while emergency or audio');
assert.match(sketch,/String\(TIME4MED_STATUS_ENDPOINT\) !=/,'Only dedicated Staging host allowed');
assert.match(sketch,/time4med-api-staging\.napat-kaewboonpan\.workers\.dev\/api\/device\/telemetry/);

assert.match(sketch,/current\.doorClosed = doorIsClosed\(\);/);
assert.match(sketch,/current\.emergency = emergencyIsActive\(\);/);
assert.match(sketch,/current\.rtcValid = rtcTimeValid;/);
assert.match(sketch,/snprintf\(current\.systemState/);
assert.match(sender,/tls\.setCACert\(rootCa_\)/);
assert.doesNotMatch(sender,/\.setInsecure\(/);
assert.match(sender,/\/api\/device\/telemetry/);
assert.match(sender,/T4M-STATUS-V1/);
assert.match(sender,/x-T4M/i);
assert.doesNotMatch(sketch,/GCP_PRIVATE_KEY|GOOGLE_CLIENT_SECRET/);
assert.match(config,/#if __has_include\("telemetry_private.h"\)/);
assert.match(config,/#define TIME4MED_STATUS_HMAC_KEY ""/);
assert.match(priv,/TIME4MED_STATUS_HMAC_KEY ""/);
assert.match(priv,/TIME4MED_STATUS_ROOT_CA_PEM R"T4MPEM/);
console.log('PASS Stage4: original pin map and medicine controls retained; HTTPS isolated; TLS verified; no credentials baked into source');
