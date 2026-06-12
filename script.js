import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, onValue, set, update } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyC9PuXQiQ2zCKfCMG3KTYoiU_kldIZmNxE",
  authDomain: "aquasync-dda8c.firebaseapp.com",
  databaseURL: "https://aquasync-dda8c-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "aquasync-dda8c",
  storageBucket: "aquasync-dda8c.firebasestorage.app",
  messagingSenderId: "332004178563",
  appId: "1:332004178563:web:d34bb11e834b4832a579b6"
};

const URI_VISUAL_STANDBY = "clips/zzz_icon.png"; 
const URI_VISUAL_VERIFIKASI = "clips/hourglass.png"; 
const URI_VISUAL_AKTIF = ""; 

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);
const auth = getAuth(app);

let loggedInUserEmail = "-"; 
let currentActiveUsers = "-";
let currentWaterPurposes = "-";
let rawFirebaseSnapshot = {}; 
let isWaitingVerifikasi = false; // Flag internal pembantu countdown

onAuthStateChanged(auth, (user) => {
    if (user) {
        loggedInUserEmail = user.email.split('@')[0]; 
        const nameElem = document.getElementById('dynamicUserName');
        if (nameElem) { nameElem.innerText = loggedInUserEmail; }
    } else {
        window.location.href = "index.html";
    }
});

const realtimeRef = ref(database, 'AquaSync/Realtime_Status');
const energyRef = ref(database, 'AquaSync/Energy_Usage');
const predictionRef = ref(database, 'AquaSync/Prediction');
const controlRef = ref(database, 'AquaSync/Control');

let currentPumpState = 0; 
let handshakeInterval = null; 
let activityTimerInterval = null; 
let isVibrationValidated = false; 
let globalPumpTimeout = 0; 

const rupiahFormatter = new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR', maximumFractionDigits: 0
});

// MEMANTAU NODES KONTROL (Button_condition) SEKALIGUS DATA REALTIME
onValue(controlRef, (controlSnapshot) => {
    const controlData = controlSnapshot.val();
    const buttonCondition = controlData ? controlData.Button_condition : false;

    onValue(realtimeRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
            rawFirebaseSnapshot = data; 
            document.getElementById('valWaterLevel').innerText = data.Water_Level + "%";
            
            const waterFillElem = document.getElementById('torenWaterFill');
            if (waterFillElem) { waterFillElem.style.height = data.Water_Level + "%"; }

            const vibrationElem = document.getElementById('valVibration');
            if (vibrationElem) { vibrationElem.innerText = data.Vibration; }

            globalPumpTimeout = data.Pump_Timeout || 0;
            currentActiveUsers = data.Active_User || "-";
            currentWaterPurposes = data.Water_Purpose || "-";
            currentPumpState = data.Pump_Button;

            const bigStatus = document.getElementById('bigPumpStatus');
            const bigDetail = document.getElementById('bigPumpDetail');
            const pumpVisual = document.getElementById('pumpVisual');
            const forceStopBtn = document.getElementById('forceStopBtn');

            // --- LOGIKA VALIDASI HYBRID BERBASIS BUTTON_CONDITION & VIBRATION ---
            if (buttonCondition === true) {
                forceStopBtn.style.display = 'block'; 

                // Jika hardware melapor bergetar, dan kita belum memvalidasi sukses
                if (data.Vibration === true && !isVibrationValidated) {
                    isVibrationValidated = true;
                    isWaitingVerifikasi = false;
                    clearInterval(handshakeInterval); 
                    
                    // Sukses! Set Pump_Button ke 1 di Firebase agar semua user tahu pompa resmi AKTIF
                    update(ref(database), { 'AquaSync/Realtime_Status/Pump_Button': 1 });
                    updatePumpUISuccess();
                    startActivityCountdown(); 
                }

                if (isVibrationValidated || data.Pump_Button === 1) {
                    bigStatus.innerText = "POMPA AKTIF";
                    bigStatus.style.color = "#36c2b5"; 
                    suntikVisualDinamis(pumpVisual, URI_VISUAL_AKTIF, "⚡🌀");
                    
                    const usersArray = currentActiveUsers.split(' + ');
                    const purposesArray = currentWaterPurposes.split(' + ');
                    let htmlContent = "";

                    usersArray.forEach((user, index) => {
                        const purpose = purposesArray[index] || "Keperluan Umum";
                        htmlContent += `
                            <div style="background: #f8f9fa; padding: 8px 16px; border-radius: 10px; width: 100%; max-width: 320px; display: flex; justify-content: space-between; align-items: center; border: 1px solid rgba(0,0,0,0.02); box-shadow: 0 2px 5px rgba(0,0,0,0.01);">
                                <span style="font-weight: 700; color: #2d3436;">👤 ${user}</span>
                                <span style="color: #36c2b5; font-weight: 600; font-size: 13px;">➔ ${purpose}</span>
                            </div>
                        `;
                    });
                    bigDetail.innerHTML = htmlContent;
                } else {
                    // Fase tunggu verifikasi getaran (sedang countdown 1 menit)
                    bigStatus.innerText = "MEMVERIFIKASI...";
                    bigStatus.style.color = "#fdcb6e"; 
                    suntikVisualDinamis(pumpVisual, URI_VISUAL_VERIFIKASI, "⏳");
                    bigDetail.innerHTML = `<div>Menunggu respons balik mekanis dari sensor getaran...</div>`;
                    
                    if (!isWaitingVerifikasi) {
                        isWaitingVerifikasi = true;
                        startHandshakeTimeout();
                    }
                }
            } else {
                // Jika Button_condition == false (Pompa Non-Aktif)
                isVibrationValidated = false;
                isWaitingVerifikasi = false;
                forceStopBtn.style.display = 'none'; 
                clearInterval(handshakeInterval);
                clearInterval(activityTimerInterval);
                
                bigStatus.innerText = "POMPA NON-AKTIF";
                bigStatus.style.color = "#ff7675"; 
                suntikVisualDinamis(pumpVisual, URI_VISUAL_STANDBY, "💤");
                bigDetail.innerHTML = `<div>Sistem dalam kondisi standby aman</div>`;
                
                updatePumpUI(0);
            }

            if (buttonCondition === true && (isVibrationValidated || data.Pump_Button === 1)) {
                const btn = document.getElementById('pBtn');
                btn.classList.add('on'); 
                btn.innerText = 'JOIN'; 
            }
        }
    }, { onlyOnce: false });
}, { onlyOnce: false });

onValue(energyRef, (snapshot) => {
    const data = snapshot.val();
    if (data) {
        document.getElementById('valVoltage').innerText = data.Voltage + " V";    
        document.getElementById('valCurrent').innerText = data.Current + " A";    
        document.getElementById('valPower').innerText = data.Power + " W";        
        document.getElementById('valEnergy').innerText = data.Energy + " kWh";    
    }
});

onValue(predictionRef, (snapshot) => {
    const data = snapshot.val();
    if (data && data.Monthly_Bill) {
        document.getElementById('valPrediction').innerText = rupiahFormatter.format(data.Monthly_Bill);
    }
});

window.handlePumpClick = function() {
    if (currentPumpState === 1 && isVibrationValidated) {
        if (currentActiveUsers.includes(loggedInUserEmail)) {
            document.getElementById('sessionModal').style.display = 'flex';
        } else {
            openJoinMenuInstead();
        }
    } else if (currentPumpState === 0) {
        openJoinMenuInstead();
    }
}

window.openJoinMenuInstead = function() {
    document.getElementById('sessionModal').style.display = 'none';
    const modalTitle = document.getElementById('modalTitle');
    const modalDesc = document.getElementById('modalDesc');

    if (currentPumpState === 1) {
        modalTitle.innerText = "Ikut Gunakan Air / Tambah Waktu:";
        modalDesc.innerHTML = `Pompa sedang aktif oleh <strong>${currentActiveUsers}</strong>. Pilih keperluan Anda untuk menambah durasi:`;
    } else {
        modalTitle.innerText = "Keperluan Penggunaan Air:";
        modalDesc.innerText = "Silakan pilih aktivitas Anda untuk validasi data otomatis skripsi.";
    }
    document.getElementById('purposeModal').style.display = 'flex';
}

window.checkoutUserSession = function() {
    document.getElementById('sessionModal').style.display = 'none';
    const usersArray = currentActiveUsers.split(' + ');
    const purposesArray = currentWaterPurposes.split(' + ');
    const userIndex = usersArray.indexOf(loggedInUserEmail);
    const now = Date.now();
    const updates = {};

    if (userIndex !== -1) {
        let myPurpose = purposesArray[userIndex];
        const firebaseStartTime = rawFirebaseSnapshot[`Start_User_${loggedInUserEmail}`];
        let durationMinutes = 1;
        if (firebaseStartTime) { durationMinutes = Math.max(1, Math.floor((now - firebaseStartTime) / 60000)); }

        updates[`AquaSync/Realtime_Status/Start_User_${loggedInUserEmail}`] = null;
        usersArray.splice(userIndex, 1);
        purposesArray.splice(userIndex, 1);
    }

    if (usersArray.length > 0) {
        const finalUsers = usersArray.join(' + ');
        const finalPurposes = purposesArray.join(' + ');
        
        updates['AquaSync/Realtime_Status/Active_User'] = finalUsers;
        updates['AquaSync/Realtime_Status/Water_Purpose'] = finalPurposes;
        update(ref(database), updates);
    } else {
        sendPumpStateToFirebase(0, "-", "-", 0).then(() => { update(ref(database), updates); });
    }
}

window.submitWaterPurpose = function(purpose) {
    document.getElementById('purposeModal').style.display = 'none';
    let durationMinutes = purpose === 'Mesin Cuci' ? 120 : 40; 
    const now = Date.now();
    let newTimeoutTimestamp = now + (durationMinutes * 60000);

    const updates = {};
    updates[`AquaSync/Realtime_Status/Start_User_${loggedInUserEmail}`] = now;

    if (currentPumpState === 1) {
        let finalUsers = currentActiveUsers.includes(loggedInUserEmail) ? currentActiveUsers : `${currentActiveUsers} + ${loggedInUserEmail}`;
        let finalPurposes = currentWaterPurposes.includes(purpose) ? currentWaterPurposes : `${currentWaterPurposes} + ${purpose}`;

        updates['AquaSync/Realtime_Status/Active_User'] = finalUsers;
        updates['AquaSync/Realtime_Status/Water_Purpose'] = finalPurposes;
        updates['AquaSync/Realtime_Status/Pump_Timeout'] = Math.max(globalPumpTimeout, newTimeoutTimestamp);
        update(ref(database), updates);
    } else {
        // JALUR AWAL NYALAKAN POMPA BARU
        updates['AquaSync/Control/Button_condition'] = true; // Pemicu SSR Utama ke ESP32
        updates['AquaSync/Realtime_Status/Pump_Button'] = 0;   // Biarkan 0 dulu (Menunggu validasi getaran)
        updates['AquaSync/Realtime_Status/Vibration'] = false;
        updates['AquaSync/Realtime_Status/Active_User'] = loggedInUserEmail;
        updates['AquaSync/Realtime_Status/Water_Purpose'] = purpose;
        updates['AquaSync/Realtime_Status/Pump_Timeout'] = newTimeoutTimestamp;
        
        update(ref(database), updates);
    }
}

window.triggerForceStop = function() {
    if (confirm("Apakah Anda yakin ingin mematikan pompa secara paksa?")) {
        sendPumpStateToFirebase(0, "-", "-", 0);
    }
}

function sendPumpStateToFirebase(state, user, purpose, timeoutTimestamp) {
    const updates = {};
    updates['AquaSync/Control/Button_condition'] = state === 1 ? true : false;
    updates['AquaSync/Realtime_Status/Pump_Button'] = state;
    updates['AquaSync/Realtime_Status/Active_User'] = user;
    updates['AquaSync/Realtime_Status/Water_Purpose'] = purpose;
    updates['AquaSync/Realtime_Status/Pump_Timeout'] = timeoutTimestamp;

    if (state === 0 && rawFirebaseSnapshot) {
        Object.keys(rawFirebaseSnapshot).forEach(key => {
            if (key.startsWith('Start_User_')) { updates[`AquaSync/Realtime_Status/${key}`] = null; }
        });
    }

    return update(ref(database), updates).then(() => {
        currentPumpState = state;
        if (state === 0) {
            isVibrationValidated = false;
            isWaitingVerifikasi = false;
            clearInterval(handshakeInterval);
            clearInterval(activityTimerInterval);
            updatePumpUI(0);
        }
    });
}

function startHandshakeTimeout() {
    clearInterval(handshakeInterval);
    let timeLeft = 60;
    updatePumpUI(1, "01:00");

    handshakeInterval = setInterval(() => {
        timeLeft--;
        const minutes = Math.floor(timeLeft / 60).toString().padStart(2, '0');
        const seconds = (timeLeft % 60).toString().padStart(2, '0');
        const timerDisplay = document.getElementById('tDisplay');
        if (timerDisplay) timerDisplay.innerText = `${minutes}:${seconds}`;

        if (timeLeft <= 0) {
            clearInterval(handshakeInterval);
            isWaitingVerifikasi = false;
            alert("⚠️ PERINGATAN: Pompa Gagal Diaktifkan! Tidak ada respon getaran.");
            sendPumpStateToFirebase(0, "-", "-", 0);
        }
    }, 1000);
}

function startActivityCountdown() {
    clearInterval(activityTimerInterval);
    const timerDisplay = document.getElementById('tDisplay');
    if (globalPumpTimeout === 0) { if (timerDisplay) timerDisplay.style.display = 'none'; return; }
    if (timerDisplay) timerDisplay.style.display = 'block';

    activityTimerInterval = setInterval(() => {
        const now = Date.now();
        const difference = globalPumpTimeout - now;

        if (difference <= 0) {
            clearInterval(activityTimerInterval);
            if (timerDisplay) timerDisplay.style.display = 'none';
            alert("⏰ WAKTU HABIS: Pompa otomatis dimatikan.");
            sendPumpStateToFirebase(0, "-", "-", 0); 
        } else {
            const totalSeconds = Math.floor(difference / 1000);
            const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
            const seconds = (totalSeconds % 60).toString().padStart(2, '0');
            if (timerDisplay) timerDisplay.innerText = `${minutes}:${seconds}`;
        }
    }, 1000);
}

function updatePumpUI(state, timeText = "01:00") {
    const btn = document.getElementById('pBtn');
    const timer = document.getElementById('tDisplay');
    if (!btn || !timer) return;

    if (state === 1) {
        btn.classList.add('on'); 
        btn.innerText = 'WAIT';
        btn.style.background = '#fdcb6e'; 
        btn.style.color = 'white';
        timer.style.display = 'block';
        timer.style.color = "#fdcb6e"; 
        timer.innerText = timeText;
    } else {
        btn.classList.remove('on'); 
        btn.innerText = 'OFF';
        btn.style.background = '#dfe6e9'; 
        btn.style.color = '#636e72';
        timer.style.display = 'none';
    }
}

function updatePumpUISuccess() {
    const btn = document.getElementById('pBtn');
    const timer = document.getElementById('tDisplay');
    if (!btn || !timer) return;
    btn.classList.add('on'); 
    btn.innerText = 'JOIN'; 
    btn.style.background = '#36c2b5'; 
    btn.style.color = 'white';
    timer.style.display = 'block'; 
    timer.style.color = "#36c2b5"; 
}

function suntikVisualDinamis(elementTarget, uriGambar, emojiSerep) {
    if (!elementTarget) return;
    const adaGambarSekarang = elementTarget.querySelector('img');
    const tulisanSekarang = elementTarget.innerText;
    if (uriGambar && uriGambar !== "") {
        if (!adaGambarSekarang || adaGambarSekarang.getAttribute('src') !== uriGambar) {
            elementTarget.innerHTML = `<img src="${uriGambar}" alt="Status Animasi" style="max-width: 55px; max-height: 55px; object-fit: contain; display: inline-block; vertical-align: middle;">`;
        }
    } else {
        if (elementTarget.querySelector('img') || tulisanSekarang !== emojiSerep) { elementTarget.innerHTML = emojiSerep; }
    }
}