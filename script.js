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

const captureBtn =
    document.getElementById("captureBtn");

const soundBtn =
    document.getElementById("soundBtn");


// ช่องเพิ่มรายการยา
const medicineName =
    document.getElementById("medicineName");

const medicineTime =
    document.getElementById("medicineTime");

const medicineAmount =
    document.getElementById("medicineAmount");

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


// ==========================================
// 2. โหลดข้อมูลรายการยา
// ==========================================

const savedMedicines =
    localStorage.getItem("time4medMedicines");


let medicines = savedMedicines
    ? JSON.parse(savedMedicines)
    : [];


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

    const medicineText =
        JSON.stringify(medicines);

    localStorage.setItem(
        "time4medMedicines",
        medicineText
    );
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

    const total =
        medicines.length;


    const taken =
        medicines.filter(
            function (medicine) {

                return medicine.taken === true;

            }
        ).length;


    const waiting =
        total - taken;


    totalMedicineCount.textContent =
        total;

    takenMedicineCount.textContent =
        taken;

    waitingMedicineCount.textContent =
        waiting;


    if (medicines.length === 0) {

        latestAlert.textContent =
            "-";

    } else {

        const sortedMedicines =
            [...medicines].sort(
                function (firstMedicine, secondMedicine) {

                    return firstMedicine.time.localeCompare(
                        secondMedicine.time
                    );

                }
            );


        latestAlert.textContent =
            sortedMedicines[0].time;

    }
}


// ==========================================
// 7. แสดงรายการยา
// ==========================================

function renderMedicines() {

    medicineList.innerHTML = "";


    medicineCount.textContent =
        medicines.length + " รายการ";


    updateSummary();


    if (medicines.length === 0) {

        medicineList.innerHTML = `
            <div class="empty-state">

                <div class="empty-icon">
                    💊
                </div>

                <h3>
                    ยังไม่มีรายการยา
                </h3>

                <p>
                    กรุณาเพิ่มรายการยาจากแบบฟอร์มด้านซ้าย
                </p>

            </div>
        `;

        return;
    }


    medicines.forEach(
        function (medicine, index) {

            const medicineItem =
                document.createElement("div");


            medicineItem.className =
                "medicine-item";


            if (medicine.taken === true) {

                medicineItem.classList.add(
                    "completed"
                );

            }


            const takenButtonText =
                medicine.taken
                    ? "↩ ยกเลิก"
                    : "✓ ทานแล้ว";


            medicineItem.innerHTML = `
                <div class="medicine-information">

                    <div class="medicine-item-icon">
                        💊
                    </div>

                    <div class="medicine-details">

                        <h3>
                            ${medicine.name}
                        </h3>

                        <p>
                            เวลา ${medicine.time} น.
                            • จำนวน ${medicine.amount} เม็ด
                        </p>

                    </div>

                </div>


                <div class="medicine-actions">

                    <button
                        class="taken-button"
                        type="button"
                        data-action="taken"
                        data-index="${index}"
                    >
                        ${takenButtonText}
                    </button>

                    <button
                        class="delete-button"
                        type="button"
                        data-action="delete"
                        data-index="${index}"
                    >
                        🗑 ลบ
                    </button>

                </div>
            `;


            medicineList.appendChild(
                medicineItem
            );

        }
    );


    const medicineButtons =
        document.querySelectorAll(
            "[data-action]"
        );


    medicineButtons.forEach(
        function (button) {

            button.addEventListener(
                "click",
                function () {

                    const index =
                        Number(
                            button.dataset.index
                        );


                    const action =
                        button.dataset.action;


                    if (action === "delete") {

                        deleteMedicine(index);

                    }


                    if (action === "taken") {

                        toggleMedicineTaken(index);

                    }

                }
            );

        }
    );
}


// ==========================================
// 8. เพิ่มรายการยา
// ==========================================

function addMedicine() {

    const name =
        medicineName.value.trim();

    const time =
        medicineTime.value;

    const amount =
        Number(
            medicineAmount.value
        );


    if (name === "") {

        showFormMessage(
            "กรุณากรอกชื่อยา",
            "error"
        );

        medicineName.focus();

        return;
    }


    if (time === "") {

        showFormMessage(
            "กรุณาเลือกเวลารับประทานยา",
            "error"
        );

        medicineTime.focus();

        return;
    }


    if (
        Number.isNaN(amount) ||
        amount < 1
    ) {

        showFormMessage(
            "จำนวนยาต้องไม่น้อยกว่า 1 เม็ด",
            "error"
        );

        medicineAmount.focus();

        return;
    }


    const newMedicine = {

        name: name,

        time: time,

        amount: amount,

        taken: false

    };


    medicines.push(newMedicine);


    medicines.sort(
        function (firstMedicine, secondMedicine) {

            return firstMedicine.time.localeCompare(
                secondMedicine.time
            );

        }
    );


    saveMedicines();

    renderMedicines();


    showFormMessage(
        "เพิ่มยา " +
        name +
        " เวลา " +
        time +
        " เรียบร้อยแล้ว",
        "success"
    );


    medicineName.value = "";

    medicineTime.value = "";

    medicineAmount.value = 1;


    medicineName.focus();
}


// ==========================================
// 9. ลบรายการยา
// ==========================================

function deleteMedicine(index) {

    const medicine =
        medicines[index];


    const confirmDelete =
        confirm(
            "ต้องการลบยา " +
            medicine.name +
            " ใช่หรือไม่?"
        );


    if (confirmDelete === false) {

        return;

    }


    medicines.splice(index, 1);


    saveMedicines();

    renderMedicines();


    showFormMessage(
        "ลบรายการยาเรียบร้อยแล้ว",
        "success"
    );
}


// ==========================================
// 10. เปลี่ยนสถานะรับประทานยา
// ==========================================

function toggleMedicineTaken(index) {

    medicines[index].taken =
        !medicines[index].taken;


    saveMedicines();

    renderMedicines();


    if (medicines[index].taken === true) {

        showFormMessage(
            "บันทึกการรับประทานยาเรียบร้อยแล้ว",
            "success"
        );

    } else {

        showFormMessage(
            "ยกเลิกสถานะรับประทานยาแล้ว",
            "success"
        );

    }
}


// ==========================================
// 11. Event เพิ่มยา
// ==========================================

addMedicineBtn.addEventListener(
    "click",
    function () {

        addMedicine();

    }
);


medicineAmount.addEventListener(
    "keydown",
    function (event) {

        if (event.key === "Enter") {

            addMedicine();

        }

    }
);


// ==========================================
// 12. ปุ่มควบคุมอุปกรณ์
// ==========================================

// เปิดกลอน
unlockBtn.addEventListener(
    "click",
    function () {

        doorStatus.textContent =
            "ปลดล็อกแล้ว";

        controlMessage.textContent =
            "ⓘ ส่งคำสั่งเปิดกลอนเรียบร้อยแล้ว";

        controlMessage.style.color =
            "#138039";

    }
);


// ล็อกกลอน
lockBtn.addEventListener(
    "click",
    function () {

        doorStatus.textContent =
            "ล็อกอยู่";

        controlMessage.textContent =
            "ⓘ ส่งคำสั่งล็อกกลอนเรียบร้อยแล้ว";

        controlMessage.style.color =
            "#0755c9";

    }
);


// ถ่ายภาพ
captureBtn.addEventListener(
    "click",
    function () {

        cameraStatus.textContent =
            "กำลังถ่ายภาพ";

        controlMessage.textContent =
            "ⓘ กำลังบันทึกภาพจากกล้อง";


        setTimeout(
            function () {

                cameraStatus.textContent =
                    "พร้อมใช้งาน";

                controlMessage.textContent =
                    "ⓘ ถ่ายภาพและบันทึกเรียบร้อยแล้ว";

            },
            1300
        );

    }
);


// เล่นเสียง
soundBtn.addEventListener(
    "click",
    function () {

        soundStatus.textContent =
            "กำลังเล่นเสียง";

        controlMessage.textContent =
            "ⓘ กำลังเล่นเสียงแจ้งเตือน";


        setTimeout(
            function () {

                soundStatus.textContent =
                    "พร้อมใช้งาน";

                controlMessage.textContent =
                    "ⓘ เล่นเสียงแจ้งเตือนเรียบร้อยแล้ว";

            },
            1700
        );

    }
);


// ==========================================
// 13. แสดงข้อมูลทันที
// ==========================================

renderMedicines();
// ==========================================
// 14. Sidebar page navigation
// ==========================================
(function setupSidebarPageNavigation() {
    const sidebarLinks = document.querySelectorAll('.sidebar-link[href^="#"]');
    const summarySection = document.querySelector('.summary-grid');

    const sections = {
        devices: document.getElementById('devices'),
        medication: document.getElementById('medication'),
        analytics: document.getElementById('analytics'),
        activity: document.getElementById('activity'),
        camera: document.getElementById('camera'),
        history: document.getElementById('history')
    };

    function setActiveLink(viewName) {
        sidebarLinks.forEach(function (link) {
            const isActive = link.getAttribute('href') === '#' + viewName;
            link.classList.toggle('active', isActive);

            if (isActive) {
                link.setAttribute('aria-current', 'page');
            } else {
                link.removeAttribute('aria-current');
            }
        });
    }

    function showDashboard() {
        if (summarySection) {
            summarySection.hidden = false;
        }

        Object.values(sections).forEach(function (section) {
            if (section) {
                section.hidden = false;
            }
        });

        setActiveLink('dashboard');
    }

    function showSingleSection(viewName) {
        const selectedSection = sections[viewName];

        if (!selectedSection) {
            showDashboard();
            return;
        }

        if (summarySection) {
            summarySection.hidden = true;
        }

        Object.entries(sections).forEach(function ([name, section]) {
            if (section) {
                section.hidden = name !== viewName;
            }
        });

        setActiveLink(viewName);
    }

    function openView(viewName, updateUrl) {
        if (viewName === 'dashboard') {
            showDashboard();
        } else {
            showSingleSection(viewName);
        }

        if (updateUrl) {
            history.replaceState(null, '', '#' + viewName);
        }

        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    sidebarLinks.forEach(function (link) {
        link.addEventListener('click', function (event) {
            event.preventDefault();
            const viewName = link.getAttribute('href').slice(1) || 'dashboard';
            openView(viewName, true);
        });
    });

    const initialView = window.location.hash.slice(1) || 'dashboard';
    openView(initialView, false);
})();
