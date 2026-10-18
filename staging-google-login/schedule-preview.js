/* Time4Med Staging — read-only schedule projection from authorized Sheets APIs.
 * This page never POSTs medicines, schedules, MQTT or relay commands.
 * Device ACK is required elsewhere before any schedule can be called applied.
 */
(() => {
  'use strict';
  const contract = window.Time4MedScheduleContract;
  const panel = document.getElementById('t26SchedulePanel');
  if (!contract || !panel) return;
  const $ = id => document.getElementById(id);
  let active = false, generation = 0, inflight = null;

  function show(state, message) {
    $('t26ScheduleState').textContent = state;
    $('t26ScheduleMessage').textContent = message;
  }
  function replaceList(id, items) {
    const list = $(id);
    list.replaceChildren();
    for (const str of items) {
      const li = document.createElement('li');
      li.textContent = String(str);
      list.append(li);
    }
  }
  function clear() {
    $('t26PatientCount').textContent = '—';
    $('t26MedicineCount').textContent = '—';
    $('t26SlotCount').textContent = '—';
    replaceList('t26ScheduleSlots', ['ยังไม่มีข้อมูล']);
    replaceList('t26ScheduleIssues', ['รอการตรวจ']);
  }
  function display(patients, medicines) {
    const ids = patients.map(row => String(row?.id || '').trim().toUpperCase())
      .filter(Boolean);
    const report = contract.evaluate(medicines, ids);
    const errors = report.issues.filter(item => item.kind === 'error');
    $('t26PatientCount').textContent = String(ids.length);
    $('t26MedicineCount').textContent = String(medicines.length);
    $('t26SlotCount').textContent = String(report.slots.length);
    replaceList('t26ScheduleSlots', report.slots.length
      ? report.slots.map(slot => slot.patientId + ' · ช่อง ' + slot.compartment
        + ' · ' + slot.time + ' น. · ' + slot.meal)
      : ['ไม่มีรอบแจ้งเตือน']);
    replaceList('t26ScheduleIssues', report.issues.length
      ? report.issues.map(issue => issue.message)
      : ['ไม่พบข้อผิดพลาดด้านรูปแบบ']);
    if (ids.length === 0 || medicines.length === 0) {
      show('ยังไม่มีข้อมูลตารางยา',
        'Backend อ่าน Google Sheets สำเร็จ แต่ยังไม่มีข้อมูลผู้สูงอายุหรือยาที่ใช้สร้างรอบแจ้งเตือน');
    } else if (errors.length) {
      show('ตารางยามีข้อผิดพลาด ' + errors.length + ' รายการ',
        'แก้ข้อมูลใน Google Sheets ก่อนทำระบบส่งไปตู้ยา; ไม่มีการส่งคำสั่งใด ๆ');
    } else if (!report.slots.length) {
      show('ไม่มีรอบยาตามเวลา',
        'รายการอาจเป็นยา PRN หรือไม่มีรายการตามเวลา; ไม่ลบตารางบนอุปกรณ์');
    } else {
      show('ตรวจรูปแบบผ่าน ' + report.slots.length + ' รอบ',
        'เป็นเพียงข้อมูลตัวอย่างจาก Sheets ไม่ใช่หลักฐานว่า ESP32-S3 ได้รับหรือบันทึกตารางแล้ว');
    }
  }
  async function refresh() {
    const auth = window.Time4MedAuth;
    if (!active || !auth?.user || inflight === generation) return;
    const run = generation;
    inflight = run;
    $('t26RefreshSchedule').disabled = true;
    show('กำลังโหลดตารางยา…', 'กำลังตรวจสิทธิ์และอ่านข้อมูลจาก Google Sheets Staging');
    try {
      const [patientsData, medicinesData] = await Promise.all([
        auth.api('/api/patients'),
        auth.api('/api/medicines')
      ]);
      if (!active || run !== generation) return;
      if (!Array.isArray(patientsData?.patients) ||
          !Array.isArray(medicinesData?.medicines)) throw Error('Backend ส่งข้อมูลไม่ครบ');
      display(patientsData.patients, medicinesData.medicines);
    } catch (error) {
      if (!active || run !== generation) return;
      clear();
      show('อ่านตารางยาไม่สำเร็จ',
        'ตรวจแท็บ Patients / MealMedicines, สิทธิ์ Google และ Backend: '
        + String(error?.message || 'ไม่ทราบสาเหตุ').slice(0, 120));
    } finally {
      if (inflight === run) {
        inflight = null;
        $('t26RefreshSchedule').disabled = false;
      }
    }
  }
  window.addEventListener('time4med-auth-changed', event => {
    generation += 1;
    active = !!event.detail?.user;
    panel.hidden = !active;
    clear();
    $('t26RefreshSchedule').disabled = false;
    show(active ? 'กำลังอ่าน Google Sheets…' : 'รอเข้าสู่ระบบ',
      active ? 'ระบบอ่านข้อมูลตามสิทธิ์ใน Backend' : 'ต้องเข้าสู่ระบบ Google ก่อน');
    if (active) void refresh();
  });
  $('t26RefreshSchedule').addEventListener('click', () => { void refresh(); });
  panel.hidden = true;
  clear();
})();
