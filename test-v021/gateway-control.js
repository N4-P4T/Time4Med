/* Time4Med test-v021 - authorized Gateway controls, no MQTT password in browser.
   Load this file AFTER auth.js in test-v021/index.html. */
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const msg = content => { if (el('controlMessage')) el('controlMessage').textContent = content; };
  const wait = (value) => {
    ['unlockBtn','lockBtn'].forEach(id => { if (el(id)) el(id).disabled = value; });
  };
  let busy = false;

  async function sendCommand(action, event) {
    // Capture before the legacy click handlers in test-v020/script.js.
    // The legacy script remains in SECURE_MODE and cannot publish MQTT.
    event.preventDefault();
    event.stopImmediatePropagation();
    if (busy) return;
    const auth = window.Time4MedAuth;
    if (!auth?.tokenPresent || !auth?.user) return msg('กรุณาเข้าสู่ระบบ Google ก่อนใช้งาน');
    if (!window.confirm('ยืนยันคำสั่ง ' + action + ' ที่ตู้ยา cabinet-01?')) return;
    busy = true;
    wait(true);
    msg('กำลังให้ Gateway ตรวจสิทธิ์และส่งคำสั่ง...');
    try {
      const data = await auth.api('/api/devices/cabinet-01/lock', {
        method:'POST', body:{deviceId:'cabinet-01',action}
      });
      if (!data?.brokerAccepted) throw new Error('Broker ยังไม่ยืนยันการรับคำสั่ง');
      msg('ส่ง '+ action +' ถึง HiveMQ แล้ว (PUBACK) — กรุณาตรวจกลอนและ Serial Monitor ที่อุปกรณ์เพื่อยืนยันการทำงานจริง');
    } catch(error) {
      msg('ส่งคำสั่งไม่สำเร็จ: ' + String(error?.message || error));
    } finally {
      busy = false;
      wait(false);
    }
  }
  function attach(id, command) {
    const button = el(id);
    if (!button) return;
    button.addEventListener('click', event => {void sendCommand(command, event);}, true);
  }
  attach('unlockBtn', 'UNLOCK');
  attach('lockBtn', 'LOCK');

  async function refreshGatewayStatus() {
    const auth = window.Time4MedAuth;
    const label = el('mqttConnectionLabel');
    if (!auth?.tokenPresent || !auth?.user) return;
    try {
      const status = await auth.api('/api/gateway/status');
      const ready = Boolean(status.configured && status.authorized);
      if (label) label.textContent = ready ? 'Gateway: พร้อมส่งคำสั่ง' : 'Gateway: รอตั้งค่า/สิทธิ์';
      const notice = document.querySelector('#devices .t4m-legacy-notice');
      if (notice && ready) notice.textContent = 'Gateway ตรวจสิทธิ์พร้อมแล้ว · สถานะกลอนจริงยังต้องยืนยันจาก ESP32-S3';
    } catch(err) {
      if (label) label.textContent = 'Gateway: ไม่พร้อม';
      console.warn('Time4Med Gateway status failed', err);
    }
  }
  window.addEventListener('time4med-auth-changed', (e) => {
    if (e.detail?.user) void refreshGatewayStatus();
    else if (el('mqttConnectionLabel')) el('mqttConnectionLabel').textContent = 'Gateway: รอเข้าสู่ระบบ';
  });
  if (window.Time4MedAuth?.user) void refreshGatewayStatus();
})();
