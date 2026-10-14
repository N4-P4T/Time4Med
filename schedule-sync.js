/* Time4Med schedule protocol v1. No broker password is stored here. */
(function () {
    'use strict';
    const ROOT = 'time4med/v1/cabinet/cabinet-01/schedule/';
    const DEVICE = 'ESP32S3-01';
    let reported = null;
    let queryNonce = '';
    let querySentAt = 0;
    let freshAt = 0;
    let pending = null;
    let pendingSentAt = 0;
    let observedClient = null;
    let wasConnected = false;
    const host = document.getElementById('medicineList');
    if (!host) return;
    const panel = document.createElement('section');
    panel.style.cssText = 'padding:18px;margin:0 0 20px;border:1px solid #b9d5f4;border-radius:12px;background:#f3f8ff;line-height:1.7';
    panel.innerHTML = `
        <h3 style="margin:0 0 8px">เชื่อมเวลามื้อยากับเครื่อง</h3>
        <p>ส่งเวลาจากรายการยาด้านล่างให้เครื่องเตือนทุกวัน ตามเวลาไทย ยา PRN จะไม่ถูกส่งเป็นเวลาแจ้งเตือน เครื่องปัจจุบันรับเฉพาะเวลา (สูงสุด 16 เวลา) ไม่ได้รับชื่อผู้ป่วย ชั้น หรือหมายเลขกล่อง</p>
        <p id="mealPreview"></p>
        <button type="button" id="sendMealSchedule" style="padding:10px 16px;cursor:pointer">ส่งเวลามื้อยาเข้าเครื่อง</button>
        <button type="button" id="refreshMealSchedule" style="padding:10px 16px;cursor:pointer">ตรวจสถานะเครื่อง</button>
        <p id="mealSyncStatus" role="status" aria-live="polite"></p>
        <p id="mealDeviceSchedule"></p>
        <small>การเพิ่ม/ลบยาและเลือกหมายเลขกล่องเป็นฉบับร่างในเบราว์เซอร์ ต้องกดส่งและรอเครื่องตอบรับ การส่งใช้ได้เมื่อเครื่องออนไลน์ ตารางที่บันทึกแล้วทำงานออฟไลน์ได้</small>`;
    host.before(panel);
    const $ = id => document.getElementById(id);
    const status = message => { $('mealSyncStatus').textContent = message; };
    const client = () => typeof time4MedMqttClient !== 'undefined' ? time4MedMqttClient : null;
    const uniqueId = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now()+'-'+Math.random().toString(36).slice(2);
    function slotsFromMedicines(rows) {
        if (!Array.isArray(rows)) throw new Error('รายการยาไม่ถูกต้อง');
        // PRN ไม่มีตารางแจ้งเตือนประจำ และห้ามบังคับให้มีเวลา
        const scheduled = rows.filter(row => row && row.kind !== 'prn');
        const slots = [...new Set(scheduled.map(row => {
            if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row.time)) throw new Error('มียาตามมื้อที่เวลายังไม่ถูกต้อง กรุณาแก้ไขรายการ');
            return row.time;
        }))].sort();
        if (slots.length > 16) throw new Error('รองรับเวลามื้อยาที่แตกต่างกันสูงสุด 16 เวลา');
        return slots;
    }
    function localSlots() { return slotsFromMedicines(medicines); }
    function updatePreview() {
        try {
            const slots = localSlots();
            $('mealPreview').textContent = slots.length ? 'ฉบับร่างที่จะส่ง: ' + slots.join(' • ') + ' น.' : 'ฉบับร่างว่าง: หากส่งจะยกเลิกเวลามื้อยาทั้งหมดในเครื่อง';
        } catch (e) { $('mealPreview').textContent = e.message; }
    }
    function refresh() {
        const c = client();
        freshAt = 0;
        if (!c || !c.connected) { status('กรุณาเชื่อมต่อ MQTT ด้วยปุ่มเชื่อมต่อของเว็บไซต์ก่อน'); return; }
        queryNonce = uniqueId();
        querySentAt = Date.now();
        const nonce = queryNonce;
        c.publish(ROOT + 'get', nonce, {qos: 1, retain: false}, error => {
            if (error) status('ขอสถานะไม่สำเร็จ กรุณาลองใหม่');
        });
        status(pending ? 'กำลังตรวจสอบว่าเครื่องบันทึกตารางที่ส่งแล้วหรือยัง…' : 'กำลังขอสถานะล่าสุดจากเครื่อง…');
        setTimeout(() => {
            if (queryNonce === nonce && !freshAt) status('ยังไม่ได้รับคำตอบจากเครื่อง ตรวจสอบไฟ Wi-Fi และสิทธิ์ MQTT แล้วกดตรวจสถานะอีกครั้ง');
        }, 12000);
    }
    window.time4medScheduleMessage = function (topic, data) {
        if (topic !== ROOT + 'reported' || data.device_id !== DEVICE || data.protocol !== 1 ||
            typeof data.revision !== 'string' || !Array.isArray(data.slots)) return;
        reported = data;
        if (data.query_nonce === queryNonce && queryNonce && Date.now() - querySentAt < 12000) freshAt = Date.now();
        const times = data.slots.filter(t => typeof t === 'string').join(' • ');
        $('mealDeviceSchedule').textContent = 'ตารางที่เครื่องรายงาน: ' + (times || 'ไม่มีมื้อยา') + ' | เวลาเครื่อง: ' + (data.device_time || 'ไม่ทราบ') + ' (ไทย)';
        if (pending && data.revision === pending.revision && JSON.stringify(data.slots) === JSON.stringify(pending.slots)) {
            status('เครื่องบันทึกตารางแล้ว ✓ ' + (data.slots.length ? data.slots.join(' • ') : 'ยกเลิกทุกมื้อแล้ว'));
            pending = null;
        } else if (pending && data.result_revision === pending.revision && data.error) {
            status('เครื่องไม่รับตาราง: ' + data.error + ' — ตรวจตารางล่าสุดก่อนกดส่งใหม่');
            pending = null;
        } else if (pending && data.query_nonce === queryNonce && querySentAt >= pendingSentAt && freshAt && !data.pending) {
            status('เครื่องยังใช้ตารางเดิม ตารางที่ส่งยังไม่ได้บันทึก ตรวจรายการแล้วกดส่งใหม่ได้');
            pending = null;
        } else if (data.pending) {
            status('เครื่องมีตารางรอใช้ จะบันทึกเมื่อจบรอบแจ้งเตือนปัจจุบัน');
        } else if (!pending) {
            status(freshAt && Date.now() - freshAt < 30000 ? 'ได้รับสถานะล่าสุดแล้ว พร้อมส่งเวลามื้อยา' : 'นี่คือสถานะที่รายงานไว้ก่อนหน้า กดตรวจสถานะเครื่องก่อนส่ง');
        }
        if (!data.clock_ready) status('นาฬิกาเครื่องยังไม่พร้อม เครื่องจะไม่เริ่มแจ้งเตือน ให้ต่ออินเทอร์เน็ตแล้วเปิดเครื่องใหม่เพื่อเทียบเวลา');
        if (!data.storage_ready) status('เครื่องบันทึกข้อมูลไม่ได้ ตรวจสอบเครื่องก่อนใช้งาน (' + (data.error || 'STORAGE_ERROR') + ')');
    };
    $('sendMealSchedule').addEventListener('click', () => {
        const c = client();
        if (!c || !c.connected) { status('ยังไม่ได้เชื่อมต่อ MQTT'); return; }
        if (pending) { status('ตารางก่อนหน้ายังรอคำตอบ กดตรวจสถานะเครื่องก่อน'); return; }
        if (!reported || Date.now() - freshAt > 30000 || !freshAt) { refresh(); return; }
        if (!reported.clock_ready || !reported.storage_ready) { status('เครื่องยังไม่พร้อมรับใช้งานตาราง ตรวจนาฬิกาและหน่วยความจำก่อน'); return; }
        const unassigned = medicines.filter(row => row && row.kind !== 'prn' && (!row.boxNumber || !row.patient));
        if (unassigned.length) { status('มีรายการตามเวลาที่ยังไม่กำหนดผู้ป่วย/หมายเลขกล่อง '+unassigned.length+' รายการ กรุณาแก้ข้อมูลก่อนส่งเวลา'); return; }
        let slots;
        try { slots = localSlots(); } catch (e) { status(e.message); return; }
        const message = slots.length ? 'แทนที่ตารางในเครื่องด้วยเวลา ' + slots.join(', ') + ' น. ทุกวัน?' : 'ยกเลิกเวลามื้อยาทั้งหมดในเครื่อง?';
        if (!window.confirm(message)) return;
        const request = {protocol: 1, device_id: DEVICE, timezone: 'Asia/Bangkok', base_revision: reported.revision, revision: uniqueId(), slots};
        pending = request;
        pendingSentAt = Date.now();
        status('กำลังส่ง… ยังไม่ถือว่าเครื่องบันทึกแล้วจนกว่าจะได้รับคำตอบ');
        c.publish(ROOT + 'set', JSON.stringify(request), {qos: 1, retain: false}, error => {
            if (error && pending === request) {
                status('การส่งมีข้อผิดพลาด ยังไม่ทราบว่าเครื่องได้รับหรือไม่ กดตรวจสถานะเครื่อง');
            }
        });
        setTimeout(() => { if (pending === request) refresh(); }, 12000);
    });
    $('refreshMealSchedule').addEventListener('click', refresh);
    window.addEventListener('time4med-medicines-changed', () => {
        updatePreview();
        if (!pending) status('ฉบับร่างเปลี่ยนแล้ว ยังไม่ได้ส่งเข้าเครื่อง');
    });
    setInterval(() => {
        const c = client();
        const connected = !!(c && c.connected);
        if (connected && (!wasConnected || c !== observedClient)) refresh();
        if (!connected) freshAt = 0;
        observedClient = c;
        wasConnected = connected;
    }, 1500);
    updatePreview();
    status('เชื่อมต่อ MQTT แล้วตรวจสถานะเครื่องเพื่อเริ่มส่งตาราง');
})();
