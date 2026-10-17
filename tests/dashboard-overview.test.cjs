/* Node-only smoke tests: no browser / no hardware / no credentials. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const js = fs.readFileSync('script.js', 'utf8');
const css = fs.readFileSync('style.css', 'utf8');
const required = ['home-overview', 'homeNextTime', 'homeTodaySchedule',
  'homeAttentionItems', 'homeConfirmationEvents', 'homeActivityLabel',
  'homeTodayDate', 'homeTodaySchedule', 'devices', 'analytics', 'activity'];
for (const id of new Set(required)) {
  const found = html.match(new RegExp('id="' + id + '"', 'g')) || [];
  assert.equal(found.length, 1, 'required unique DOM ID: ' + id);
}
assert.match(html, /<script src="dashboard-overview\.js"><\/script>/);
assert.match(css, /\.dashboard-container \[hidden\]\s*\{\s*display:\s*none\s*!important;/);
assert.match(js, /section\.hidden = isDashboard \|\| name !== targetView/);
assert.doesNotMatch(html, /รับประทานแล้ว\s+\d+\s+จาก\s+\d+\s+ครั้ง/);
assert.doesNotMatch(html, /style="width: —;"/);
assert.doesNotMatch(html, /ระบบเล่นเสียงแจ้งเตือนยาหลังอาหารเช้า/);

class Node {
  constructor(name='node') {
    this.nodeName = name; this.textContent = '';
    this.children = []; this.className = '';
  }
  append(...args) { this.children.push(...args); }
  replaceChildren(...args) { this.children = args; }
}
const ids = new Map();
for (const id of new Set(required.concat([
  'homeNextDetail','homeDraftSource','homeDraftCount','homeActivitySource'
]))) ids.set(id, new Node(id));
const rows = [
  {kind: 'scheduled', time:'08:30', mealType:2, patient:'<img src=x onerror=alert(1)>', boxNumber:'', stockStatus:'low'},
  {kind: 'prn', time:'', mealType:'prn', patient:'P001', stockStatus:'ok'}
];
const windowMock = {listeners: {}, addEventListener(type, fn) {this.listeners[type]=fn;}};
const context = {
  document: {
    getElementById: id => ids.get(id) || null,
    createElement: name => new Node(name)
  },
  window:windowMock,
  medicines:rows,
  TIME4MED_MEAL_DEFS:{'2':{label:'หลังอาหารเช้า'}},
  setInterval:()=>{}, Intl, Date, console
};
vm.runInNewContext(fs.readFileSync('dashboard-overview.js', 'utf8'), context);
assert.equal(typeof windowMock.time4medRefreshHome, 'function');
assert.match(ids.get('homeDraftCount').textContent, /1 รายการตามเวลา/);
assert.equal(ids.get('homeTodaySchedule').children.length, 1, 'exclude PRN from daily schedule');
assert.equal(ids.get('homeAttentionItems').children.length, 2, 'missing compartment + stock low');
const scheduledInfo = ids.get('homeTodaySchedule').children[0].children[0].children[1].textContent;
assert.match(scheduledInfo, /<img src=x onerror=alert\(1\)>/);
assert.equal(ids.get('homeTodaySchedule').children[0].children[0].children[1].innerHTML, undefined,
  'untrusted person names must not be injected as HTML');
windowMock.time4medHomeTimelineUpdated([
  {event_type:'MEDICINE_CONFIRMED',result:'SUCCESS'},
  {event_type:'MEDICINE_REMINDER',result:'SUCCESS'},
  {event_type:'MEDICINE_CONFIRMED',result:'ERROR'}
], true);
assert.equal(ids.get('homeConfirmationEvents').textContent, '1 เหตุการณ์');
windowMock.time4medHomeTimelineUpdated([], false);
assert.equal(ids.get('homeConfirmationEvents').textContent, '—',
  'API error must not be misrepresented as 0 successful medication events');
rows.splice(0, rows.length);
windowMock.time4medRefreshHome();
assert.equal(ids.get('homeNextTime').textContent, '—');
assert.match(ids.get('homeTodaySchedule').children[0].children[0].children[0].textContent, /ยังไม่มีรายการ/);
console.log('Dashboard smoke tests passed (navigation, no demo metrics, safe data handling)');
