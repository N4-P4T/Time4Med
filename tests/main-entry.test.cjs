'use strict';
const fs=require('node:fs'), assert=require('node:assert/strict'), path=require('node:path'), vm=require('node:vm');
const entry=fs.readFileSync('index.html','utf8'), html=fs.readFileSync('modern-preview/index.html','utf8');
assert.match(entry,/href="\.\/modern-preview\/"/);
assert.match(entry,/window\.location\.replace/);
assert.doesNotMatch(entry+html,/hivemq\.cloud|workers\.dev|mqtt\.min\.js|test-v0\d+/i);
for(const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)){
 const target=match[1].split('?')[0];
 assert.ok(!/^https?:/.test(target),'unexpected external asset');
 assert.ok(fs.existsSync(path.join('modern-preview',target)),target);
}
const js=fs.readFileSync('modern-preview/gas-only.js','utf8');
new vm.Script(js);
assert.doesNotMatch(js,/hivemq\.cloud|workers\.dev|test-v0\d+|mqttConnectionLabel/i);
assert.match(js,/const API_URL='';/);
assert.match(js,/script\.google\.com\/macros\/s\//);
assert.match(html,/id="deviceConnectionLabel"/);
assert.match(js,/deviceConnectionLabel/);
assert.ok(fs.existsSync('modern-preview/logo.png'));
for(const p of ['mqtt-config.js','test-v018','test-v019','test-v020','test-v021','.github/workflows/mqtt-live-check.yml'])assert.ok(!fs.existsSync(p),p);
console.log('PASS: actual Medical Modern entry, local assets, GAS-only script, no retired runtime files');
