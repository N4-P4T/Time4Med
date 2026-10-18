/* Read-only Time4Med STAGING device status. No MQTT, actuator, schedules, credentials.
 * The backend enforces Google token, role and patient scope; UI only displays the result.
 */
(() => {
  'use strict';
  const panel = document.getElementById('t25DevicePanel');
  if (!panel) return;
  const $ = id => document.getElementById(id);
  const STALE_MS = 150000;
  let active = false, generation = 0, busy = false;

  function put(id, value) {
    const el = $(id);
    if (el) el.textContent = String(value);
  }
  function setState(value, message, state = '') {
    put('t25DeviceState', value);
    put('t25DeviceMessage', message);
    $('t25DeviceState').dataset.state = state;
  }
  function clearReadings() {
    put('t25Device', 'ยังไม่มีข้อมูล');
    put('t25Door', '—');
    put('t25Lock', '—');
    put('t25Emergency', '—');
    put('t25Rtc', '—');
    put('t25LastSeen', '—');
  }
  function show(data) {
    const state = String(data?.state ?? 'UNAVAILABLE');
    clearReadings();
    if (state === 'NO_DATA') {
      setState('NO_DATA · ยังไม่มีข้อมูล', 'ยังไม่มีข้อความสถานะจาก ESP32-S3 เข้าสู่ Staging', state);
      return;
    }
    if (state === 'STALE') {
      const time = Date.parse(data.received_at || '');
      if (Number.isFinite(time)) put('t25LastSeen', new Date(time).toLocaleString('th-TH'));
      setState('STALE · ข้อมูลเก่า', 'เกิน 150 วินาทีแล้ว ห้ามสรุปว่าอุปกรณ์ยังออนไลน์หรือกลอนอยู่ในสถานะเดิม', state);
      return;
    }
    if (state !== 'LIVE' || !data.telemetry) {
      setState('UNAVAILABLE · อ่านสถานะไม่ได้', 'Backend ยังไม่สามารถยืนยันข้อมูลสถานะได้', 'UNAVAILABLE');
      return;
    }
    const time = Date.parse(data.received_at || '');
    const t = data.telemetry;
    if (!Number.isFinite(time) || Date.now() - time > STALE_MS || time > Date.now() + 10000 ||
      !['LOCKED','UNLOCKED'].includes(t.lock_status) ||
      !['CLOSED','OPEN'].includes(t.door_status) ||
      typeof t.emergency !== 'boolean' || typeof t.rtc_valid !== 'boolean') {
      setState('STALE · เวลาหรือข้อมูลผิดปกติ', 'ไม่สามารถยืนยันความสดของสถานะได้', 'STALE');
      return;
    }
    put('t25Device', 'ESP32S3-01 · ' + String(t.system_state || 'ไม่ระบุ').slice(0, 48));
    put('t25Door', t.door_status === 'CLOSED' ? 'ปิด' : 'เปิด');
    put('t25Lock', t.lock_status === 'LOCKED' ? 'ล็อก' : 'ปลดล็อก');
    put('t25Emergency', t.emergency ? 'มีสัญญาณฉุกเฉิน' : 'ไม่มีสัญญาณ');
    put('t25Rtc', t.rtc_valid ? 'ถูกต้องตามรายงาน' : 'RTC ไม่พร้อม');
    put('t25LastSeen', new Date(time).toLocaleString('th-TH'));
    const simulated = t.reason === 'STAGING_TEST';
    setState(simulated ? 'LIVE · ข้อมูลจำลอง' : 'LIVE · ได้รับข้อมูลล่าสุด',
      simulated ? 'สถานะนี้ส่งจาก PowerShell เพื่อทดสอบ ไม่ใช่ข้อมูลเซนเซอร์จริง' :
        'Backend เพิ่งได้รับสถานะจากผู้ส่งที่ลงลายเซ็นถูกต้อง ไม่ใช่หลักฐานการรับประทานยา', 'LIVE');
  }
  async function refresh() {
    if (!active || busy || !window.Time4MedAuth?.user) return;
    const requestGeneration = generation;
    busy = true;
    $('t25Refresh').disabled = true;
    try {
      const response = await window.Time4MedAuth.api('/api/devices/status');
      if (active && requestGeneration === generation) show(response);
    } catch (error) {
      if (active && requestGeneration === generation) {
        clearReadings();
        setState('อ่าน Backend ไม่สำเร็จ', String(error?.message || 'เกิดข้อผิดพลาด').slice(0, 140), 'UNAVAILABLE');
      }
    } finally {
      busy = false;
      $('t25Refresh').disabled = false;
    }
  }
  window.addEventListener('time4med-auth-changed', event => {
    generation++;
    active = !!event.detail?.user;
    panel.hidden = !active;
    clearReadings();
    setState(active ? 'กำลังตรวจสอบ…' : 'รอเข้าสู่ระบบ',
      active ? 'กำลังอ่านสถานะจาก Cloudflare Staging…' : 'กรุณาเข้าสู่ระบบ Google', 'NO_DATA');
    if (active) void refresh();
  });
  $('t25Refresh').addEventListener('click', () => { void refresh(); });
  window.setInterval(() => { void refresh(); }, 30000);
  clearReadings();
  panel.hidden = true;
})();
