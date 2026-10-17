/* Time4Med caregiver dashboard overview — no demo adherence numbers. */
(function () {
    'use strict';

    const $ = id => document.getElementById(id);
    const todayList = $('homeTodaySchedule');
    if (!todayList) return;

    const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
    const thaiClock = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit',
        hour12: false, hourCycle: 'h23'
    });
    const thaiDate = new Intl.DateTimeFormat('th-TH', {
        timeZone: 'Asia/Bangkok', dateStyle: 'full'
    });

    function text(id, value) {
        const node = $(id);
        if (node) node.textContent = String(value);
    }

    function listItem(primary, secondary, flag, flagType) {
        const item = document.createElement('li');
        item.className = 'home-schedule-item';

        const information = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = primary;
        const detail = document.createElement('small');
        detail.textContent = secondary;
        information.append(title, detail);

        const marker = document.createElement('span');
        marker.className = 'home-schedule-tag ' + (flagType || '');
        marker.textContent = flag;
        item.append(information, marker);
        return item;
    }

    function currentThaiMinutes() {
        const parts = thaiClock.formatToParts(new Date());
        const hour = Number(parts.find(p => p.type === 'hour')?.value ?? '0') % 24;
        const minute = Number(parts.find(p => p.type === 'minute')?.value ?? '0');
        return hour * 60 + minute;
    }

    function updateOverview() {
        const rows = typeof medicines !== 'undefined' && Array.isArray(medicines) ? medicines : [];
        const times = rows
            .filter(row => row && row.kind !== 'prn' && typeof row.time === 'string' && TIME_PATTERN.test(row.time))
            .sort((a, b) => a.time.localeCompare(b.time));
        const now = currentThaiMinutes();

        text('homeTodayDate', thaiDate.format(new Date()));
        text('homeDraftSource', 'ข้อมูลตารางยาในเบราว์เซอร์นี้ (ฉบับร่าง — ยังไม่ยืนยันว่าบันทึกลง ESP32-S3 แล้ว)');

        const next = times.find(row => {
            const [hour, minute] = row.time.split(':').map(Number);
            return hour * 60 + minute >= now;
        });

        text('homeNextTime', next ? next.time + ' น.' : '—');
        text('homeNextDetail',
            next ? ((rowLabel(next)) + ' • ' + (next.patient?.trim() || 'ยังไม่ระบุผู้สูงอายุ')) :
            (times.length ? 'วันนี้ไม่มีเวลาแจ้งเตือนในฉบับร่างที่กำลังจะมาถึง' : 'ยังไม่มีตารางยาตามเวลาในเบราว์เซอร์นี้'));

        todayList.replaceChildren();
        if (times.length === 0) {
            todayList.append(listItem('ยังไม่มีรายการยาตามเวลา', 'ตั้งเวลาได้ที่เมนูรายการยา', 'ฉบับร่าง', 'neutral'));
        } else {
            for (const row of times.slice(0, 8)) {
                const [hour, minute] = row.time.split(':').map(Number);
                const occurred = hour * 60 + minute < now;
                const person = String(row.patient || '').trim() || 'ไม่ระบุผู้สูงอายุ';
                const box = String(row.boxNumber || '').trim();
                const description = [
                    person, rowLabel(row), box ? 'กล่อง ' + box : 'ยังไม่ระบุกล่อง'
                ].join(' • ');
                todayList.append(listItem(
                    row.time + ' น.',
                    description,
                    occurred ? 'ผ่านเวลาแล้ว' : 'รอถึงเวลา',
                    occurred ? 'past' : 'future'
                ));
            }
            if (times.length > 8) {
                todayList.append(listItem(
                    'อีก ' + (times.length - 8) + ' รายการ',
                    'ดูรายการทั้งหมดและแก้ไขในเมนูรายการยา',
                    'เพิ่มเติม', 'neutral'
                ));
            }
        }

        const unassigned = rows.filter(row =>
            row && row.kind !== 'prn' &&
            (!String(row.patient || '').trim() || !String(row.boxNumber || '').trim()));
        const stockWarnings = rows.filter(row =>
            row && (row.stockStatus === 'low' || row.stockStatus === 'out'));
        const invalidTime = rows.filter(row =>
            row && row.kind !== 'prn' &&
            (typeof row.time !== 'string' || !TIME_PATTERN.test(row.time)));
        const checks = $('homeAttentionItems');
        checks.replaceChildren();

        if (unassigned.length) checks.append(listItem(
            'ยังไม่กำหนดผู้สูงอายุหรือหมายเลขกล่อง ' + unassigned.length + ' รายการ',
            'กรุณาตรวจในเมนูรายการยา', 'ตรวจสอบ', 'past'));
        if (stockWarnings.length) checks.append(listItem(
            'ผู้ดูแลระบุยาใกล้หมด/หมด ' + stockWarnings.length + ' รายการ',
            'เป็นสถานะที่ผู้ดูแลบันทึก ไม่ได้ตรวจนับโดยอุปกรณ์', 'ตรวจสอบ', 'past'));
        if (invalidTime.length) checks.append(listItem(
            'เวลาแจ้งเตือนในฉบับร่างไม่ถูกต้อง ' + invalidTime.length + ' รายการ',
            'กรุณาตรวจในเมนูรายการยา', 'ตรวจสอบ', 'past'));

        if (!checks.children.length) checks.append(listItem(
            rows.length ? 'ไม่พบรายการรอตรวจตามเงื่อนไขพื้นฐาน' : 'ยังไม่มีข้อมูลยาในเบราว์เซอร์นี้',
            rows.length ? 'ไม่ได้ยืนยันว่ารับประทานยาครบแล้ว' : 'เริ่มต้นเพิ่มข้อมูลที่เมนูรายการยา',
            'ข้อมูลฉบับร่าง', 'neutral'));
        text('homeDraftCount', times.length + ' รายการตามเวลา');
    }

    function rowLabel(row) {
        const meal = typeof TIME4MED_MEAL_DEFS !== 'undefined' ?
            TIME4MED_MEAL_DEFS[String(row.mealType)] : null;
        return meal?.label || String(row.name || 'รายการยา');
    }

    window.time4medHomeTimelineUpdated = function (events, ok) {
        if (!ok || !Array.isArray(events)) {
            text('homeConfirmationEvents', '—');
            text('homeActivityLabel', 'ไม่สามารถอ่านบันทึกเหตุการณ์จาก Google Sheets ได้');
            text('homeActivitySource', 'ยังไม่ควรสรุปผลการรับประทานยาจากข้อมูลที่ขาดหาย');
            return;
        }
        const confirmed = events.filter(row =>
            row && String(row.event_type || '').toUpperCase() === 'MEDICINE_CONFIRMED' &&
            String(row.result || '').toUpperCase() === 'SUCCESS'
        );
        text('homeConfirmationEvents', confirmed.length + ' เหตุการณ์');
        const latest = events[0];
        text('homeActivityLabel',
            latest ? 'เหตุการณ์ล่าสุด: ' + (String(latest.event_type || 'SYSTEM_EVENT')) :
                'วันนี้ยังไม่มีเหตุการณ์ที่บันทึกใน Google Sheets');
        text('homeActivitySource',
            'นับเฉพาะเหตุการณ์ยืนยันสำเร็จในผลลัพธ์ล่าสุด (สูงสุด 50 รายการ) ไม่ใช่จำนวนเม็ดยาหรือหลักฐานว่ากลืนยาแล้ว');
    };

    window.time4medRefreshHome = updateOverview;
    window.addEventListener('time4med-medicines-changed', updateOverview);
    window.setInterval(updateOverview, 60000);
    updateOverview();
})();
