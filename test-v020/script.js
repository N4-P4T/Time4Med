// ==========================================
// 1. ค้นหา Element จากหน้า HTML
// ==========================================

// เวลาและวันที่
const currentTime =
    document.getElementById("currentTime");

const currentDate =
    document.getElementById("currentDate");


// สถานะอุปกรณ์
const doorStatus =
    document.getElementById("doorStatus");

const cameraStatus =
    document.getElementById("cameraStatus");

const soundStatus =
    document.getElementById("soundStatus");

const controlMessage =
    document.getElementById("controlMessage");


// ปุ่มควบคุม
const unlockBtn =
    document.getElementById("unlockBtn");

const lockBtn =
    document.getElementById("lockBtn");

// ช่องเพิ่มรายการยา
const medicineName =
    document.getElementById("medicineName");

const medicineTime =
    document.getElementById("medicineTime");

const medicinePatient = document.getElementById("medicinePatient");
const medicinePatientId = document.getElementById("medicinePatientId");
if (medicinePatientId) medicinePatientId.addEventListener('change',()=>{
  medicinePatient.value=medicinePatientId.selectedOptions[0]?.dataset.patientName||'';
});
const medicineMeal = document.getElementById("medicineMeal");
const medicineBox = document.getElementById("medicineBox");
const medicineInstruction = document.getElementById("medicineInstruction");
const medicineShelfPreview = document.getElementById("medicineShelfPreview");
const medicineTimeGroup = document.getElementById("medicineTimeGroup");
const cancelMedicineEditBtn = document.getElementById("cancelMedicineEditBtn");

const addMedicineBtn =
    document.getElementById("addMedicineBtn");


// รายการยา
const medicineList =
    document.getElementById("medicineList");

const medicineCount =
    document.getElementById("medicineCount");

const formMessage =
    document.getElementById("formMessage");


// การ์ดสถิติ
const totalMedicineCount =
    document.getElementById("totalMedicineCount");

const takenMedicineCount =
    document.getElementById("takenMedicineCount");

const waitingMedicineCount =
    document.getElementById("waitingMedicineCount");

const latestAlert =
    document.getElementById("latestAlert");

// กล้อง ESP32-CAM
const CAMERA_BASE_URL = "http://172.20.10.6";
const CAMERA_STREAM_URL = CAMERA_BASE_URL + ":81/stream";

// คลังรูปหลักย้ายไป Google Drive ผ่าน Google Apps Script
const DRIVE_GALLERY_API_URL =
    "https://script.google.com/macros/s/AKfycbwmciXUQzSoBnbPL-O3QAm7biNMaLZlX495zasXVqxrwB8bDEHjG5b40vjGLhENYv8H1Q/exec";

const cameraStream =
    document.getElementById("cameraStream");

const cameraPlaceholder =
    document.getElementById("cameraPlaceholder");

const cameraLiveBadge =
    document.getElementById("cameraLiveBadge");

const cameraConnectionText =
    document.getElementById("cameraConnectionText");


function setCameraConnection(isConnected) {

    cameraStatus.textContent =
        isConnected ? "ออนไลน์" : "ไม่พบการเชื่อมต่อ";

    cameraLiveBadge.textContent =
        isConnected ? "● LIVE" : "● OFFLINE";

    cameraLiveBadge.classList.toggle(
        "is-online",
        isConnected
    );

    cameraLiveBadge.classList.toggle(
        "is-offline",
        !isConnected
    );

    cameraConnectionText.textContent =
        isConnected
            ? "สถานะกล้อง: เชื่อมต่อแล้ว"
            : "สถานะกล้อง: เชื่อมต่อไม่ได้";

    cameraStream.classList.toggle(
        "is-hidden",
        !isConnected
    );

    cameraPlaceholder.classList.toggle(
        "is-hidden",
        isConnected
    );
}


cameraStream.addEventListener(
    "load",
    function () {
        setCameraConnection(true);
    }
);


cameraStream.addEventListener(
    "error",
    function () {
        setCameraConnection(false);
    }
);


// Legacy camera URL bypasses the new role API; suspend in secure build.
// Resume only after adding a backend-authorized camera/image gateway.
// cameraStream.src = CAMERA_STREAM_URL;


// ==========================================
// MQTT - เชื่อมหน้าเว็บกับ ESP32-S3 ผ่าน HiveMQ Cloud
// ใช้บัญชีที่กำหนดใน mqtt-config.js เพื่อเชื่อมต่ออัตโนมัติ
// ==========================================

const MQTT_BROKER_URL = window.TIME4MED_MQTT_CONFIG?.brokerUrl || "";
const MQTT_USERNAME = window.TIME4MED_MQTT_CONFIG?.username || "";

const MQTT_TOPIC_STATUS =
    "time4med/v1/cabinet/cabinet-01/status";

const MQTT_TOPIC_EVENT =
    "time4med/v1/cabinet/cabinet-01/event";

const MQTT_TOPIC_LOCK_COMMAND =
    "time4med/v1/cabinet/cabinet-01/command/lock";

const mqttConnectButton =
    document.getElementById("mqttConnectButton");

const mqttConnectionLabel =
    document.getElementById("mqttConnectionLabel");

const systemOnlineBadge =
    document.getElementById("systemOnlineBadge");

const mqttCredentialDialog =
    document.getElementById("mqttCredentialDialog");

const mqttCredentialForm =
    document.getElementById("mqttCredentialForm");

const mqttPasswordInput =
    document.getElementById("mqttPasswordInput");

const mqttDialogMessage =
    document.getElementById("mqttDialogMessage");

const mqttCancelButton =
    document.getElementById("mqttCancelButton");

let time4MedMqttClient = null;


function setMqttConnectionState(state, label) {

    mqttConnectionLabel.textContent = label;
    mqttConnectButton.dataset.state = state;

    const statusDot =
        mqttConnectButton.querySelector(".status-dot");

    const stateColors = {
        connected: "#16a34a",
        connecting: "#f59e0b",
        disconnected: "#dc2626"
    };

    statusDot.style.backgroundColor =
        stateColors[state] || stateColors.disconnected;

    mqttConnectButton.setAttribute(
        "aria-label",
        label + " คลิกเพื่อเชื่อมต่อใหม่"
    );

    if (state === "connecting") {
        systemOnlineBadge.textContent = "● รอข้อมูล MQTT";
        systemOnlineBadge.style.color = "#a16207";
    } else if (state === "disconnected") {
        systemOnlineBadge.textContent = "● ไม่ทราบสถานะอุปกรณ์";
        systemOnlineBadge.style.color = "#64748b";
    }
}


function openMqttCredentialDialog() {
    controlMessage.textContent = 'ⓘ MQTT โดยตรงปิดไว้ในรุ่นที่ใช้ล็อกอิน จนกว่าจะย้ายคำสั่งไปยัง backend';
}

function startAutomaticMqtt() {
    if (window.TIME4MED_SECURE_MODE !== false) {
        setMqttConnectionState('disconnected','MQTT: รอ backend ที่ตรวจสิทธิ์');
        return;
    }
    if (time4MedMqttClient && (time4MedMqttClient.connected || time4MedMqttClient.reconnecting)) return;
    const config = window.TIME4MED_MQTT_CONFIG;
    if (!config || !MQTT_BROKER_URL.startsWith("wss://") || !MQTT_USERNAME ||
        typeof config.password !== "string" || !config.password || config.password === "PUT_MQTT_PASSWORD_HERE") {
        setMqttConnectionState("disconnected", "MQTT: กรุณาตั้งค่า mqtt-config.js");
        controlMessage.textContent = "กรอกบัญชี MQTT ในไฟล์ mqtt-config.js แล้วอัปโหลดไฟล์และรีเฟรชหน้าเว็บ";
        return;
    }
    connectTime4MedMqtt(config.password);
}

function updateDeviceStatusFromMqtt(status) {

    const isOnline = status.online === true;

    systemOnlineBadge.textContent =
        isOnline ? "● อุปกรณ์ออนไลน์" : "● อุปกรณ์ออฟไลน์";

    systemOnlineBadge.style.color =
        isOnline ? "#138039" : "#b42318";

    if (status.lock_status === "LOCKED") {
        doorStatus.textContent = "ล็อกอยู่";
    } else if (status.lock_status === "UNLOCKED") {
        doorStatus.textContent = "ปลดล็อกแล้ว";
    }
}


function handleMqttMessage(topic, payloadBuffer) {

    let data;

    try {
        data = JSON.parse(payloadBuffer.toString());
    } catch (error) {
        console.warn("MQTT message is not JSON:", topic);
        return;
    }

    if (window.time4medScheduleMessage) window.time4medScheduleMessage(topic, data);

    if (topic === MQTT_TOPIC_STATUS) {
        updateDeviceStatusFromMqtt(data);
        return;
    }

    if (topic === MQTT_TOPIC_EVENT) {
        // Inventory module may handle a uniquely identified confirmation.
        window.dispatchEvent(new CustomEvent("time4med-mqtt-event", { detail: data }));
        const eventName = data.event || "EVENT";
        const detail = data.detail ? " — " + data.detail : "";

        controlMessage.textContent =
            "ⓘ ESP32: " + eventName + detail;
        controlMessage.style.color = "#0755c9";
    }
}


function connectTime4MedMqtt(password) {
    if (window.TIME4MED_SECURE_MODE !== false) return;

    if (typeof mqtt === "undefined") {
        setMqttConnectionState(
            "disconnected",
            "MQTT: โหลดไลบรารีไม่สำเร็จ"
        );
        controlMessage.textContent =
            "ⓘ โหลด MQTT.js ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วรีเฟรชหน้าเว็บ";
        controlMessage.style.color = "#b42318";
        return;
    }

    if (time4MedMqttClient) {
        time4MedMqttClient.end(true);
    }

    setMqttConnectionState("connecting", "MQTT: กำลังเชื่อมต่อ...");

    const clientId =
        "time4med-web-" +
        Math.random().toString(16).slice(2, 10);

    const client = mqtt.connect(
        MQTT_BROKER_URL,
        {
            username: MQTT_USERNAME,
            password: password,
            clientId: clientId,
            clean: true,
            protocolVersion: 4,
            keepalive: 30,
            connectTimeout: 10000,
            reconnectPeriod: 3000
        }
    );

    time4MedMqttClient = client;

    client.on("connect", function () {

        if (time4MedMqttClient !== client) {
            return;
        }

        setMqttConnectionState(
            "connected",
            "MQTT: เชื่อมต่อแล้ว"
        );

        controlMessage.textContent =
            "ⓘ หน้าเว็บเชื่อมต่อ HiveMQ Cloud แล้ว";
        controlMessage.style.color = "#138039";

        client.subscribe(
            [MQTT_TOPIC_STATUS, MQTT_TOPIC_EVENT, "time4med/v1/cabinet/cabinet-01/schedule/reported"],
            { qos: 1 },
            function (error) {

                if (error) {
                    controlMessage.textContent =
                        "ⓘ เชื่อมต่อได้ แต่สมัครรับสถานะจาก ESP32 ไม่สำเร็จ";
                    controlMessage.style.color = "#b42318";
                }
            }
        );
    });

    client.on("message", function (topic, payloadBuffer) {

        if (time4MedMqttClient !== client) {
            return;
        }

        handleMqttMessage(topic, payloadBuffer);
    });

    client.on("reconnect", function () {

        if (time4MedMqttClient !== client) {
            return;
        }

        setMqttConnectionState(
            "connecting",
            "MQTT: กำลังเชื่อมต่อใหม่..."
        );
    });

    client.on("offline", function () {

        if (time4MedMqttClient !== client) {
            return;
        }

        setMqttConnectionState(
            "disconnected",
            "MQTT: ออฟไลน์"
        );
    });

    client.on("close", function () {

        if (
            time4MedMqttClient === client &&
            !client.connected
        ) {
            setMqttConnectionState(
                "disconnected",
                "MQTT: การเชื่อมต่อขาด"
            );
        }
    });

    client.on("error", function (error) {

        console.error("MQTT connection error:", error);

        if (time4MedMqttClient !== client) {
            return;
        }

        setMqttConnectionState(
            "disconnected",
            "MQTT: เชื่อมต่อไม่สำเร็จ"
        );

        controlMessage.textContent =
            "ⓘ เชื่อมต่อ MQTT ไม่สำเร็จ กรุณาตรวจสอบรหัสผ่านหรือเครือข่าย";
        controlMessage.style.color = "#b42318";
    });
}


function publishLockCommand(command) {
    if (window.TIME4MED_SECURE_MODE !== false) {
        controlMessage.textContent = 'ⓘ คำสั่งกลอนปิดไว้จนกว่าจะเชื่อมกับ MQTT Gateway ที่ตรวจสิทธิ์';
        return;
    }
    const client = time4MedMqttClient;

    if (!client || !client.connected) {
        controlMessage.textContent =
            "ⓘ กรุณาเชื่อมต่อ MQTT ก่อนส่งคำสั่ง";
        controlMessage.style.color = "#b42318";
        openMqttCredentialDialog("กรุณาใส่รหัสผ่านก่อนส่งคำสั่ง");
        return;
    }

    if (
        command === "UNLOCK" &&
        !window.confirm("ยืนยันการปลดล็อกตู้ยา?")
    ) {
        return;
    }

    controlMessage.textContent =
        "ⓘ กำลังส่งคำสั่ง " + command + " ไปยัง ESP32...";
    controlMessage.style.color = "#0755c9";

    client.publish(
        MQTT_TOPIC_LOCK_COMMAND,
        command,
        { qos: 1, retain: false },
        function (error) {

            if (error) {
                controlMessage.textContent =
                    "ⓘ ส่งคำสั่งไม่สำเร็จ กรุณาลองใหม่";
                controlMessage.style.color = "#b42318";
                return;
            }

            controlMessage.textContent =
                "ⓘ ส่งคำสั่งแล้ว กำลังรอผลยืนยันจาก ESP32";
            controlMessage.style.color = "#0755c9";
        }
    );
}


mqttConnectButton.addEventListener("click", function () {
    openMqttCredentialDialog();
});


mqttConnectButton.addEventListener("keydown", function (event) {

    if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openMqttCredentialDialog();
    }
});


setMqttConnectionState("disconnected", "MQTT: รอ backend ที่ตรวจสิทธิ์");
// SECURITY: no browser-side automatic MQTT connection in v0.18.

// ==========================================
// 2. โหลดข้อมูลรายการยา
// ==========================================

// Do not auto-load sensitive medication records shared by older web versions.
// Existing localStorage data are retained for a controlled ADMIN migration.
const savedMedicines = null;


let medicines = [];
try {
    const parsed = savedMedicines ? JSON.parse(savedMedicines) : [];
    medicines = Array.isArray(parsed) ? parsed : [];
} catch (error) {
    console.warn('Medicine data in browser could not be read', error);
}


// ข้อมูลตู้ยา v0.16 — ดึงชั้นจากมื้อโดยตรง และไม่เดาหมายเลขกล่องของข้อมูลเก่า
const TIME4MED_MEAL_DEFS = Object.freeze({
    '1': {shelf:'morning', shelfLabel:'ชั้น 1 — เช้า', label:'ก่อนอาหารเช้า'},
    '2': {shelf:'morning', shelfLabel:'ชั้น 1 — เช้า', label:'หลังอาหารเช้า'},
    '3': {shelf:'noon', shelfLabel:'ชั้น 2 — กลางวัน', label:'ก่อนอาหารกลางวัน'},
    '4': {shelf:'noon', shelfLabel:'ชั้น 2 — กลางวัน', label:'หลังอาหารกลางวัน'},
    '5': {shelf:'evening', shelfLabel:'ชั้น 3 — เย็น', label:'ก่อนอาหารเย็น'},
    '6': {shelf:'evening', shelfLabel:'ชั้น 3 — เย็น', label:'หลังอาหารเย็น'},
    '7': {shelf:'bedtime', shelfLabel:'ชั้น 4 — ก่อนนอน', label:'ก่อนนอน'},
    'prn': {shelf:'prn', shelfLabel:'พื้นที่ PRN (แยกจาก 4 ชั้น)', label:'ใช้เมื่อมีอาการ (PRN)'}
});
const TIME4MED_STATUS_LABELS = Object.freeze({unchecked:'ยังไม่ตรวจสอบ',ok:'ยาเพียงพอ',low:'ยาใกล้หมด',out:'ยาหมด'});
function time4medUid() { return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `med-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function mealDef(row) { return TIME4MED_MEAL_DEFS[row.kind === 'prn' ? 'prn' : String(row.mealType)] || TIME4MED_MEAL_DEFS['2']; }
function normalizeMedicineRecords() {
    let changed = false; const ids = new Set();
    medicines = medicines.filter(row=>row && typeof row === 'object');
    for (const row of medicines) {
        if (!row.id || typeof row.id !== 'string' || ids.has(row.id)) {row.id=time4medUid();changed=true;}
        ids.add(row.id);
        // เก็บข้อมูล v0.15 เดิม (stock/amount/slot) ไว้ แต่เลิกนับเม็ดอัตโนมัติ
        if (row.kind !== 'prn' && row.kind !== 'scheduled') {row.kind='scheduled';changed=true;}
        if (row.kind === 'scheduled' && !(String(row.mealType) in TIME4MED_MEAL_DEFS) || row.kind==='scheduled' && String(row.mealType)==='prn') {row.mealType=2;changed=true;}
        if (row.kind === 'prn' && row.time) {row.time='';changed=true;}
        if (typeof row.patient !== 'string') {row.patient='';changed=true;}
        if (typeof row.boxNumber !== 'string') {row.boxNumber='';changed=true;}
        if (typeof row.instruction !== 'string') {row.instruction='';changed=true;}
        if (!(row.stockStatus in TIME4MED_STATUS_LABELS)) {row.stockStatus='unchecked';changed=true;}
    }
    // No patient data are persisted to localStorage in secure mode.
}
normalizeMedicineRecords();


// ==========================================
// 3. แสดงเวลาและวันที่
// ==========================================

function updateClock() {

    const now = new Date();


    const timeText =
        now.toLocaleTimeString(
            "th-TH",
            {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit"
            }
        );


    const dateText =
        now.toLocaleDateString(
            "th-TH",
            {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric"
            }
        );


    currentTime.textContent = timeText;

    currentDate.textContent = dateText;
}


updateClock();

setInterval(updateClock, 1000);


// ==========================================
// 4. บันทึกข้อมูล
// ==========================================

function saveMedicines() {
    // Store in memory only; authorized API syncing is handled by sheets-sync.js.
    window.dispatchEvent(new CustomEvent('time4med-medicines-changed'));
}


// ==========================================
// 5. แสดงข้อความ
// ==========================================

function showFormMessage(message, type) {

    formMessage.textContent =
        "ⓘ " + message;


    if (type === "success") {

        formMessage.style.color =
            "#138039";

        formMessage.style.backgroundColor =
            "#effcf3";

        formMessage.style.borderColor =
            "#bce5c9";

    } else {

        formMessage.style.color =
            "#c71920";

        formMessage.style.backgroundColor =
            "#fff3f3";

        formMessage.style.borderColor =
            "#f0c2c4";

    }
}


// ==========================================
// 6. อัปเดตการ์ดสถิติ
// ==========================================

function updateSummary() {
    const activePatient=window.Time4MedMedicineFilter||'';
    const visible=activePatient?medicines.filter(m=>m.patientId===activePatient):medicines;
    totalMedicineCount.textContent = String(visible.length);
    takenMedicineCount.textContent = String(visible.filter(m=>m.kind!=='prn').length);
    waitingMedicineCount.textContent = String(visible.filter(m=>m.kind==='prn').length);
    const times = visible.filter(m=>m.kind!=='prn' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(m.time)).map(m=>m.time).sort();
    latestAlert.textContent = times[0] || '-';
}

let editingMedicineId = null;
function showMedicineLocation() {
    const def = TIME4MED_MEAL_DEFS[medicineMeal.value] || TIME4MED_MEAL_DEFS['2'];
    const prn = medicineMeal.value === 'prn';
    medicineShelfPreview.textContent = def.shelfLabel;
    medicineTimeGroup.hidden = prn;
    medicineTime.required = !prn;
    medicineInstruction.required = prn;
    if (prn) { medicineTime.value = ''; medicineInstruction.closest('details').open = true; }
}
medicineMeal.addEventListener('change', showMedicineLocation);
showMedicineLocation();

function renderMedicines() {
    const activePatient=window.Time4MedMedicineFilter||'';
    const visible=activePatient?medicines.filter(m=>m.patientId===activePatient):medicines;
    medicineList.replaceChildren();
    medicineCount.textContent = `${visible.length} รายการ`;
    updateSummary();
    if (!visible.length) {
        const empty = document.createElement('div');empty.className='empty-state';
        empty.innerHTML='<div class="empty-icon">💊</div><h3>ยังไม่มีรายการยา</h3><p>เพิ่มยาตามฉลากโรงพยาบาลจากฟอร์มด้านซ้าย</p>';
        medicineList.appendChild(empty);return;
    }
    for (const row of [...visible].sort((a,b)=>((a.kind==='prn'?9:Number(a.mealType))-(b.kind==='prn'?9:Number(b.mealType)))||String(a.time||'').localeCompare(String(b.time||'')))) {
        const def = mealDef(row);
        const card = document.createElement('article');
        card.className='medicine-item meal-medicine-item';
        const box = row.boxNumber ? `กล่อง ${escapeMedicineText(row.boxNumber)}` : 'ยังไม่ระบุหมายเลขกล่อง (ข้อมูลเดิม)';
        card.innerHTML = `<div class="medicine-information"><div class="medicine-item-icon">💊</div>
          <div class="medicine-details"><h3>${escapeMedicineText(row.name||'ไม่ระบุชื่อยา')}</h3>
            <p>${escapeMedicineText(row.patient||'ยังไม่ระบุผู้ป่วย')} · ${escapeMedicineText(def.shelfLabel)} · ${box}</p>
            <p><strong>${escapeMedicineText(def.label)}</strong> ${row.kind==='prn'?'· ไม่มีเวลาแจ้งเตือนประจำ':`· ${escapeMedicineText(row.time||'ยังไม่ตั้งเวลา')} น.`}</p>
            ${row.instruction?`<p>ตามฉลาก: ${escapeMedicineText(row.instruction)}</p>`:''}
            <p class="medicine-stock-line">สถานะยา: ${escapeMedicineText(TIME4MED_STATUS_LABELS[row.stockStatus]||'ยังไม่ตรวจสอบ')}</p>
          </div></div><div class="medicine-actions">
          <button class="medicine-edit-button" type="button" data-action="edit" data-id="${escapeMedicineText(row.id)}">✎ แก้ไข</button>
          <button class="delete-button" type="button" data-action="delete" data-id="${escapeMedicineText(row.id)}">🗑 ลบ</button></div>`;
        medicineList.appendChild(card);
    }
}

function clearMedicineForm() {
    editingMedicineId = null;
    addMedicineBtn.textContent = '＋ เพิ่มรายการยา';
    cancelMedicineEditBtn.hidden = true;
    medicinePatient.value=''; if(medicinePatientId)medicinePatientId.value=''; medicineName.value='';medicineMeal.value='2'; medicineBox.value=''; medicineInstruction.value='';
    medicineTime.value='';showMedicineLocation();
}
function editMedicine(row) {
    editingMedicineId = row.id;
    medicinePatient.value = row.patient || ''; if(medicinePatientId)medicinePatientId.value = row.patientId || '';
    medicineName.value = row.name || '';
    medicineMeal.value = row.kind==='prn'?'prn':String(row.mealType||2);
    medicineBox.value = row.boxNumber || '';
    medicineInstruction.value = row.instruction || '';
    medicineTime.value = row.kind==='prn'?'':row.time || '';
    showMedicineLocation();
    medicineTime.value = row.kind==='prn'?'':row.time||'';
    addMedicineBtn.textContent='✓ บันทึกการแก้ไข';
    cancelMedicineEditBtn.hidden = false;
    document.querySelector('#medication .medicine-form-panel').scrollIntoView({behavior:'smooth',block:'start'});
    showFormMessage('กำลังแก้ไขรายการยา กรุณาตรวจข้อมูลบนฉลากและตำแหน่งจริงก่อนบันทึก','success');
}
function addMedicine() {
    if (!window.Time4MedAuth?.user) {showFormMessage('กรุณาเข้าสู่ระบบก่อน','error');return;}
    const name=medicineName.value.trim(),patient=medicinePatient.value.trim();
    const patientId=medicinePatientId?.value || '';
    const boxNumber=medicineBox.value.trim().toUpperCase();
    const mealValue=medicineMeal.value,prn=mealValue==='prn';
    const def=TIME4MED_MEAL_DEFS[mealValue],time=prn?'':medicineTime.value;
    const instruction=medicineInstruction.value.trim();
    if (!patientId || !patient || !name || !boxNumber || !def || boxNumber.length>12 ||
        (!prn && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))) {
        showFormMessage('กรุณากรอกผู้ป่วย ชื่อยา หมายเลขกล่อง และเวลาสำหรับยาตามมื้อให้ครบ','error');return;
    }
    if (prn && !instruction) {showFormMessage('ยา PRN ต้องมีวิธีใช้ตามฉลากหรือคำสั่งแพทย์ ก่อนบันทึก','error');medicineInstruction.focus();return;}
    if (!/^[0-9A-Za-zก-๙_-]{1,12}$/.test(boxNumber)) {
        showFormMessage('หมายเลขกล่องใช้ตัวอักษร ตัวเลข ขีดกลาง หรือขีดล่างเท่านั้น','error');return;
    }
    const conflict=medicines.find(m=>m.id!==editingMedicineId &&
        mealDef(m).shelf===def.shelf && String(m.boxNumber).toUpperCase()===boxNumber &&
        (m.patient!==patient || String(m.mealType)!==String(prn?'prn':mealValue)));
    if (conflict) {showFormMessage('หมายเลขกล่องนี้ในชั้นเดียวกันใช้กับผู้ป่วยหรือมื้ออื่นแล้ว กรุณาเลือกกล่องอื่นเพื่อป้องกันหยิบผิด','error');return;}
    const entry = editingMedicineId ? medicines.find(m=>m.id===editingMedicineId) : null;
    if (editingMedicineId && !entry) {showFormMessage('ไม่พบรายการที่ต้องการแก้ไข','error');return;}
    const target=entry || {id:time4medUid(),stockStatus:'unchecked'};
    // ถ้าเปลี่ยนผู้ป่วย/กล่อง/ชนิดยาหรือมื้อ ต้องตรวจสถานะใหม่ ไม่คงผลตรวจเดิมไว้
    if (entry && (entry.name!==name || entry.patient!==patient || entry.boxNumber!==boxNumber ||
        entry.kind!==(prn?'prn':'scheduled') || String(entry.mealType)!==String(prn?'prn':mealValue))) {
        target.stockStatus='unchecked';
    }
    Object.assign(target,{name,patient,patientId,boxNumber,kind:prn?'prn':'scheduled',mealType:prn?'prn':Number(mealValue),time,instruction});
    if (!entry) medicines.push(target);
    try {saveMedicines();} catch(e) {showFormMessage('บันทึกไม่สำเร็จ พื้นที่เบราว์เซอร์อาจเต็ม','error');return;}
    renderMedicines();clearMedicineForm();
    showFormMessage(`กำลังซิงก์ ${name} · ${def.shelfLabel} · กล่อง ${boxNumber} กรุณารอข้อความบันทึกสำเร็จ`,'success');
}
function deleteMedicine(id) {
    const row=medicines.find(m=>m.id===id);if (!row) return;
    if (!window.confirm(`ลบรายการ ${row.name} ของ ${row.patient||'ผู้ป่วยที่ไม่ระบุ'} ออกจากเว็บไซต์? การส่งตารางไปเครื่องต้องกดส่งใหม่ด้วย`)) return;
    medicines=medicines.filter(m=>m.id!==id);
    if (editingMedicineId===id) clearMedicineForm();
    saveMedicines();renderMedicines();showFormMessage('กำลังส่งคำสั่งลบรายการยา กรุณารอ Google Sheets ยืนยัน','success');
}
addMedicineBtn.addEventListener('click',addMedicine);
cancelMedicineEditBtn.addEventListener('click',()=>{clearMedicineForm();showFormMessage('ยกเลิกการแก้ไขแล้ว','success');});
medicineList.addEventListener('click', e=>{
    const button=e.target.closest('button[data-action]');if (!button)return;
    const row=medicines.find(m=>m.id===button.dataset.id);
    if (button.dataset.action==='edit' && row) editMedicine(row);
    if (button.dataset.action==='delete') deleteMedicine(button.dataset.id);
});
medicineName.addEventListener('keydown',e=>{if(e.key==='Enter')addMedicine();});
renderMedicines();

// ==========================================
// 11. ปุ่มควบคุมอุปกรณ์
// ==========================================

// ปลดล็อกตู้ผ่าน MQTT
unlockBtn.addEventListener(
    "click",
    function () {
        publishLockCommand("UNLOCK");
    }
);


// ล็อกตู้ผ่าน MQTT
lockBtn.addEventListener(
    "click",
    function () {
        publishLockCommand("LOCK");
    }
);


// ==========================================
// 12. แสดงข้อมูลทันที
// ==========================================

// ==========================================
// 13. คลังรูปภาพจาก Google Drive
// ==========================================

const refreshGalleryBtn =
    document.getElementById("refreshGalleryBtn");

const galleryGrid =
    document.getElementById("galleryGrid");

const galleryEmptyState =
    document.getElementById("galleryEmptyState");

const galleryConnectionMessage =
    document.getElementById("galleryConnectionMessage");

const galleryCount =
    document.getElementById("galleryCount");


function renderGallery(images) {

    galleryGrid.innerHTML = "";

    if (!Array.isArray(images) || images.length === 0) {

        galleryEmptyState.hidden = false;

        galleryCount.textContent =
            "ยังไม่มีภาพในคลัง";

        return;
    }

    galleryEmptyState.hidden = true;

    galleryCount.textContent =
        images.length + " ภาพ";


    images.forEach(
        function (imageData) {

            const card =
                document.createElement("article");

            card.className =
                "gallery-card";


            // ------------------------------------------
            // ลิงก์เปิดไฟล์บน Google Drive
            // ------------------------------------------

            const link =
                document.createElement("a");

            link.className =
                "gallery-image-link";

            link.href =
                imageData.fileUrl ||
                imageData.url;

            link.target =
                "_blank";

            link.rel =
                "noopener noreferrer";


            // ------------------------------------------
            // รูป Preview จาก Google Drive
            // ------------------------------------------

            const image =
                document.createElement("img");

            image.src =
                imageData.url;

            image.alt =
                "ภาพหลักฐานการรับประทานยา";

            image.loading =
                "lazy";

            image.referrerPolicy =
                "no-referrer";

            image.addEventListener(
                "error",
                function () {

                    image.alt =
                        "ไม่สามารถโหลดภาพ Preview ได้";

                    card.classList.add(
                        "gallery-image-error"
                    );
                }
            );

            link.appendChild(image);


            // ------------------------------------------
            // รายละเอียด
            // ------------------------------------------

            const details =
                document.createElement("div");

            details.className =
                "gallery-card-details";


            const title =
                document.createElement("strong");

            title.textContent =
                imageData.meal ||
                "ภาพยืนยันการรับประทานยา";


            const timestamp =
                document.createElement("span");

            timestamp.textContent =
                imageData.timestamp ||
                imageData.filename ||
                "ไม่ระบุเวลา";


            const status =
                document.createElement("small");

            status.textContent =
                imageData.confirmed === false
                    ? "⚠ ยังไม่ได้กดยืนยัน"
                    : "✓ บันทึกหลักฐานแล้ว";

            status.className =
                imageData.confirmed === false
                    ? "gallery-status warning"
                    : "gallery-status confirmed";


            details.append(
                title,
                timestamp,
                status
            );

            card.append(
                link,
                details
            );

            galleryGrid.appendChild(card);
        }
    );
}


// ==========================================
// JSONP
//
// ใช้ JSONP แทน fetch() เพราะหน้า GitHub Pages
// และ Google Apps Script อยู่คนละ Origin
// ==========================================

function requestDriveGallery() {

    return new Promise(
        function (resolve, reject) {

            const callbackName =
                "time4MedDriveGallery_" +
                Date.now() +
                "_" +
                Math.random()
                    .toString(16)
                    .slice(2);

            const script =
                document.createElement("script");


            const cleanup =
                function () {

                    clearTimeout(timeoutId);

                    if (script.parentNode) {
                        script.parentNode.removeChild(
                            script
                        );
                    }

                    try {
                        delete window[callbackName];
                    } catch (error) {
                        window[callbackName] =
                            undefined;
                    }
                };


            const timeoutId =
                setTimeout(
                    function () {

                        cleanup();

                        reject(
                            new Error(
                                "Google Drive API timeout"
                            )
                        );

                    },
                    15000
                );


            window[callbackName] =
                function (data) {

                    cleanup();

                    resolve(data);
                };


            script.onerror =
                function () {

                    cleanup();

                    reject(
                        new Error(
                            "โหลด Google Drive API ไม่สำเร็จ"
                        )
                    );
                };


            const query =
                new URLSearchParams({
                    action: "list",
                    limit: "60",
                    callback: callbackName,
                    _: String(Date.now())
                });


            script.src =
                DRIVE_GALLERY_API_URL +
                "?" +
                query.toString();


            document.head.appendChild(
                script
            );
        }
    );
}


// ==========================================
// โหลดคลังรูปจาก Google Drive
// ==========================================

async function loadGallery() {
    if (window.TIME4MED_SECURE_MODE !== false) {console.info('Gallery awaits authorized backend');return;}

    refreshGalleryBtn.disabled =
        true;

    refreshGalleryBtn.textContent =
        "กำลังโหลด...";

    galleryConnectionMessage.textContent =
        "กำลังเชื่อมต่อคลังรูป Google Drive";


    try {

        const data =
            await requestDriveGallery();


        if (!data || data.ok !== true) {

            throw new Error(
                data && data.error
                    ? data.error
                    : "Drive API returned an error"
            );
        }


        const images =
            Array.isArray(data.images)
                ? data.images
                : [];


        renderGallery(images);


        galleryConnectionMessage.textContent =
            "เชื่อมต่อ Google Drive สำเร็จ";


    } catch (error) {

        console.error(
            "Time4Med gallery error:",
            error
        );


        renderGallery([]);


        galleryConnectionMessage.textContent =
            "ยังไม่สามารถอ่านภาพจาก Google Drive — ตรวจสอบ Apps Script และการเชื่อมต่ออินเทอร์เน็ต";


    } finally {

        refreshGalleryBtn.disabled =
            false;

        refreshGalleryBtn.textContent =
            "↻ โหลดภาพใหม่";
    }
}


refreshGalleryBtn.addEventListener(
    "click",
    loadGallery
);


// ==========================================
// 14. Timeline จาก Google Sheets ActivityLog
// ==========================================

const activityTimeline =
    document.querySelector(
        "#activity .activity-timeline"
    );

const activitySummaryCard =
    document.querySelector(
        "#activity .activity-summary-card"
    );

const timelineFilterButton =
    document.getElementById(
        "timelineFilterButton"
    );


function requestTimeline() {

    return new Promise(
        function (resolve, reject) {

            const callbackName =
                "time4MedTimeline_" +
                Date.now() +
                "_" +
                Math.random()
                    .toString(16)
                    .slice(2);

            const script =
                document.createElement(
                    "script"
                );

            const cleanup =
                function () {

                    clearTimeout(
                        timeoutId
                    );

                    if (
                        script.parentNode
                    ) {
                        script.parentNode
                            .removeChild(
                                script
                            );
                    }

                    try {
                        delete window[
                            callbackName
                        ];
                    } catch (error) {
                        window[
                            callbackName
                        ] = undefined;
                    }
                };

            const timeoutId =
                setTimeout(
                    function () {

                        cleanup();

                        reject(
                            new Error(
                                "Timeline API timeout"
                            )
                        );
                    },
                    15000
                );

            window[callbackName] =
                function (data) {

                    cleanup();

                    resolve(data);
                };

            script.onerror =
                function () {

                    cleanup();

                    reject(
                        new Error(
                            "โหลด Timeline API ไม่สำเร็จ"
                        )
                    );
                };

            const query =
                new URLSearchParams({
                    action:
                        "timeline",
                    date:
                        "today",
                    limit:
                        "50",
                    callback:
                        callbackName,
                    _:
                        String(
                            Date.now()
                        )
                });

            script.src =
                DRIVE_GALLERY_API_URL +
                "?" +
                query.toString();

            document.head
                .appendChild(
                    script
                );
        }
    );
}


function getTimelinePresentation(
    eventData
) {

    const type =
        String(
            eventData.event_type || ""
        ).toUpperCase();

    const result =
        String(
            eventData.result || ""
        ).toUpperCase();

    const presentation = {
        icon: "📝",
        title:
            type ||
            "เหตุการณ์ระบบ",
        badge:
            result === "SUCCESS"
                ? "สำเร็จ"
                : result === "PARTIAL"
                    ? "บางส่วน"
                    : "ตรวจสอบ",
        cssClass:
            result === "SUCCESS"
                ? "completed"
                : "warning"
    };

    if (
        type ===
        "MEDICINE_REMINDER"
    ) {
        presentation.icon =
            "🔔";

        presentation.title =
            "แจ้งเตือนรับประทานยา";

    } else if (
        type ===
        "IMAGE_SAVED"
    ) {
        presentation.icon =
            "📷";

        presentation.title =
            "บันทึกภาพหลักฐาน";

        presentation.badge =
            result === "SUCCESS"
                ? "บันทึกแล้ว"
                : "ไม่สำเร็จ";

    } else if (
        type ===
        "MEDICINE_CONFIRMED"
    ) {
        presentation.icon =
            "✓";

        presentation.title =
            "ยืนยันรับประทานยาแล้ว";

        presentation.badge =
            result === "SUCCESS"
                ? "ยืนยันแล้ว"
                : "ตรวจสอบ";

    } else if (
        type ===
        "REMOTE_UNLOCK"
    ) {
        presentation.icon =
            "🔓";

        presentation.title =
            "ปลดล็อกตู้จากระยะไกล";

    } else if (
        type ===
        "REMOTE_LOCK"
    ) {
        presentation.icon =
            "🔒";

        presentation.title =
            "ล็อกตู้จากระยะไกล";

    } else if (
        type ===
        "TIMELINE_TEST"
    ) {
        presentation.icon =
            "🧪";

        presentation.title =
            "ทดสอบ Timeline";
    }

    return presentation;
}


function renderTimeline(events) {

    if (!activityTimeline) {
        return;
    }

    activityTimeline.innerHTML =
        "";

    if (
        !Array.isArray(events) ||
        events.length === 0
    ) {
        const empty =
            document.createElement(
                "div"
            );

        empty.className =
            "empty-state";

        empty.innerHTML = `
            <div class="empty-icon">🕘</div>
            <h3>ยังไม่มีเหตุการณ์วันนี้</h3>
            <p>
                เมื่อระบบแจ้งเตือนหรือมีการยืนยันรับประทานยา
                Timeline จะแสดงที่นี่
            </p>
        `;

        activityTimeline
            .appendChild(
                empty
            );

        updateTimelineSummary(
            []
        );

        return;
    }

    events.forEach(
        function (
            eventData,
            index
        ) {

            const presentation =
                getTimelinePresentation(
                    eventData
                );

            const occurredAt =
                String(
                    eventData.occurred_at ||
                    ""
                );

            const timeText =
                occurredAt.length >= 16
                    ? occurredAt.substring(
                        11,
                        16
                    )
                    : "--:--";

            const item =
                document.createElement(
                    "article"
                );

            item.className =
                "activity-item " +
                presentation.cssClass;

            item.innerHTML = `
                <div class="activity-time">
                    <strong>${escapeMedicineText(timeText)}</strong>
                    <span>น.</span>
                </div>

                <div class="activity-marker">
                    <span class="activity-dot">
                        ${presentation.icon}
                    </span>
                    ${
                        index <
                        events.length - 1
                            ? '<span class="activity-line"></span>'
                            : ''
                    }
                </div>

                <div class="activity-content">
                    <div class="activity-content-heading">
                        <strong>
                            ${escapeMedicineText(presentation.title)}
                        </strong>

                        <span class="activity-badge ${presentation.cssClass}">
                            ${escapeMedicineText(presentation.badge)}
                        </span>
                    </div>

                    <p>
                        ${
                            escapeMedicineText(eventData.details ||
                            "ไม่มีรายละเอียดเพิ่มเติม")
                        }
                    </p>

                    <small>
                        ${
                            escapeMedicineText(eventData.device_id ||
                            "Time4Med")
                        }
                        ${
                            eventData.user_id
                                ? " • " +
                                  escapeMedicineText(eventData.user_id)
                                : ""
                        }
                    </small>
                </div>
            `;

            activityTimeline
                .appendChild(
                    item
                );
        }
    );

    updateTimelineSummary(
        events
    );
}


function updateTimelineSummary(
    events
) {

    if (
        !activitySummaryCard
    ) {
        return;
    }

    const label =
        activitySummaryCard
            .querySelector(
                ".activity-summary-label"
            );

    const time =
        activitySummaryCard
            .querySelector(
                ".activity-summary-time"
            );

    const status =
        activitySummaryCard
            .querySelector(
                ".activity-summary-status"
            );

    const progressRow =
        activitySummaryCard
            .querySelector(
                ".summary-progress-row"
            );

    const progressBar =
        activitySummaryCard
            .querySelector(
                ".summary-progress-bar"
            );

    const nextSection =
        activitySummaryCard
            .querySelector(
                ".activity-summary-next"
            );

    if (label) {
        label.textContent =
            "เหตุการณ์ล่าสุด";
    }

    if (
        !Array.isArray(events) ||
        events.length === 0
    ) {

        if (time) {
            time.textContent =
                "--:-- น.";
        }

        if (status) {
            status.textContent =
                "ยังไม่มีข้อมูลวันนี้";
        }

        if (progressRow) {
            progressRow.innerHTML =
                "<span>เหตุการณ์วันนี้</span><strong>0 รายการ</strong>";
        }

        if (progressBar) {
            progressBar.style.width =
                "0%";
        }

        if (nextSection) {
            nextSection.hidden =
                true;
        }

        return;
    }

    const latest =
        events[0];

    const latestTime =
        String(
            latest.occurred_at || ""
        );

    if (time) {
        time.textContent =
            (
                latestTime.length >= 16
                    ? latestTime.substring(
                        11,
                        16
                    )
                    : "--:--"
            ) +
            " น.";
    }

    if (status) {
        status.textContent =
            getTimelinePresentation(
                latest
            ).title;
    }

    if (progressRow) {
        progressRow.innerHTML =
            "<span>เหตุการณ์วันนี้</span><strong>" +
            events.length +
            " รายการ</strong>";
    }

    if (progressBar) {
        progressBar.style.width =
            "100%";
    }

    if (nextSection) {
        nextSection.hidden =
            true;
    }
}


async function loadTimeline() {
    if (window.TIME4MED_SECURE_MODE !== false) {console.info('Timeline awaits authorized backend');return;}

    if (!activityTimeline) {
        return;
    }

    if (
        timelineFilterButton
    ) {
        timelineFilterButton.disabled =
            true;

        timelineFilterButton.textContent =
            "กำลังโหลด...";
    }

    try {
        const data =
            await requestTimeline();

        if (
            !data ||
            data.ok !== true
        ) {
            throw new Error(
                data &&
                data.error
                    ? data.error
                    : "Timeline API error"
            );
        }

        const events =
            Array.isArray(
                data.events
            )
                ? data.events
                : [];

        renderTimeline(
            events
        );

        if (
            timelineFilterButton
        ) {
            timelineFilterButton.textContent =
                "วันนี้ • " +
                events.length +
                " รายการ";
        }

    } catch (error) {
        console.error(
            "Time4Med timeline error:",
            error
        );

        renderTimeline(
            []
        );

        if (
            timelineFilterButton
        ) {
            timelineFilterButton.textContent =
                "Timeline เชื่อมต่อไม่ได้";
        }

    } finally {
        if (
            timelineFilterButton
        ) {
            timelineFilterButton.disabled =
                false;
        }
    }
}


if (
    timelineFilterButton
) {
    timelineFilterButton
        .addEventListener(
            "click",
            loadTimeline
        );
}


// ==========================================
// 14. Sidebar page navigation
// ==========================================
(function setupSidebarPageNavigation() {
    const sidebarLinks = document.querySelectorAll('.sidebar-link[href^="#"]');
    const dashboardOverview = document.getElementById('home-overview');
    const summarySection = document.querySelector('.summary-grid');
    const sections = {
        devices: document.getElementById('devices'),
        medication: document.getElementById('medication'),
        inventory: document.getElementById('inventory'),
        analytics: document.getElementById('analytics'),
        activity: document.getElementById('activity'),
        camera: document.getElementById('camera'),
        gallery: document.getElementById('gallery')
    };

    function showView(viewName, updateUrl) {
        const targetView = viewName === 'dashboard' || sections[viewName] ? viewName : 'dashboard';
        const isDashboard = targetView === 'dashboard';

        if (dashboardOverview) dashboardOverview.hidden = !isDashboard;
        if (summarySection) summarySection.hidden = !isDashboard;

        Object.entries(sections).forEach(function ([name, section]) {
            if (section) section.hidden = isDashboard || name !== targetView;
        });

        sidebarLinks.forEach(function (link) {
            const active = link.getAttribute('href') === '#' + targetView;
            link.classList.toggle('active', active);
            if (active) link.setAttribute('aria-current', 'page');
            else link.removeAttribute('aria-current');
        });

        // Pages are independent: dashboard is no longer the full devices view.
        if (targetView === 'dashboard') {
            if (window.time4medRefreshHome) window.time4medRefreshHome();
            loadTimeline();
        } else if (targetView === 'activity') {
            loadTimeline();
        } else if (targetView === 'gallery') {
            loadGallery();
        }

        if (updateUrl) history.replaceState(null, '', '#' + targetView);
        window.scrollTo({top: 0, behavior: 'smooth'});
    }

    sidebarLinks.forEach(function (link) {
        link.addEventListener('click', function (event) {
            event.preventDefault();
            showView(link.getAttribute('href').slice(1), true);
        });
    });
    window.addEventListener('hashchange', function () {
        showView(window.location.hash.slice(1) || 'dashboard', false);
    });
    showView(window.location.hash.slice(1) || 'dashboard', false);
})();

function escapeMedicineText(value) {
    return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
