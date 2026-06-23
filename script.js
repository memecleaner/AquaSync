import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, onValue, set, update, push } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
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

// =================================================================
// 🎨 DEFINISI JALUR ASET VISUAL (BERBASIS SUB-FOLDER LAPTOP)
// =================================================================
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

let currentPumpState = 0; 
let handshakeInterval = null; 
let activityTimerInterval = null; 
let isVibrationValidated = false; 
let globalPumpTimeout = 0; 
let localLockBypass = false; 

const rupiahFormatter = new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR', maximumFractionDigits: 0
});

// 1. VERIFIKASI KEAMANAN ACC & SUNTIK NAMA USER LOGIN
onAuthStateChanged(auth, (user) => {
    if (user) {
        loggedInUserEmail = user.email.split('@')[0]; 
        const nameElem = document.getElementById('dynamicUserName');
        if (nameElem) { nameElem.innerText = loggedInUserEmail; }
    } else {
        window.location.href = "index.html";
    }
});

// 🔥 JALUR PIPA REFERENSI DATABASE SINKRON ASLI FIREBASE
const realtimeRef = ref(database, 'AquaSync/Realtime_Status');
const predictionRef = ref(database, 'AquaSync/Prediction');
const historyRef = ref(database, 'AquaSync/History_Mingguan'); 

// =================================================================
// A. MENDENGAR DATABASE REALTIME CLOUD + EKSEKUSI MONITORING TOREN
// =================================================================
onValue(realtimeRef, (snapshot) => {
    const data = snapshot.val();
    if (data) {
        rawFirebaseSnapshot = data; 
        
        // --- 1. CETAK PARAMETER KELISTRIKAN SENSOR PZEM ASLI DARI REALTIME_STATUS ---
        if (document.getElementById('valVoltage')) {
            document.getElementById('valVoltage').innerText = data.Voltage ? data.Voltage.toFixed(1) + " V" : "-- V";    
        }
        if (document.getElementById('valCurrent')) {
            document.getElementById('valCurrent').innerText = data.Current ? data.Current.toFixed(2) + " A" : "-- A";    
        }
        if (document.getElementById('valPower')) {
            document.getElementById('valPower').innerText = data.Power ? data.Power.toFixed(1) + " W" : "-- W";        
        }
        if (document.getElementById('valEnergy')) {
            document.getElementById('valEnergy').innerText = data.Energy ? data.Energy.toFixed(3) + " kWh" : "-- kWh";    
        }

        // --- 2. ⚡ INTEGRASI ARGO RUPIAH LIVE REAL-TIME NYATA ---
        const currentKwh = data.Energy || 0;
        const hitungRupiahLive = Math.round(currentKwh * 1444.70);

        const actualBillElem = document.getElementById('valActualBill'); 
        if (actualBillElem) {
            if (hitungRupiahLive > 0 && hitungRupiahLive < 100) {
                actualBillElem.innerText = "Rp " + hitungRupiahLive;
            } else {
                actualBillElem.innerText = rupiahFormatter.format(hitungRupiahLive);
            }
        }

        // --- 3. MONITORING STATUS INDIKATOR TOREN AIR ---
        if (document.getElementById('valWaterLevel')) {
            document.getElementById('valWaterLevel').innerText = data.Water_Level + "%";
        }
        
        const waterFillElem = document.getElementById('torenWaterFill');
        if (waterFillElem) { waterFillElem.style.height = data.Water_Level + "%"; }

        const vibrationElem = document.getElementById('valVibration');
        if (vibrationElem) { vibrationElem.innerText = data.Vibration; }

        // 💡 SUNTIKAN BARIS PENGAMAN:
        if (localLockBypass) return; 

        globalPumpTimeout = data.Pump_Timeout || 0;
        currentActiveUsers = data.Active_User || "-";
        currentWaterPurposes = data.Water_Purpose || "-";
        currentPumpState = data.Pump_Button;

        const bigStatus = document.getElementById('bigPumpStatus');
        const bigDetail = document.getElementById('bigPumpDetail');
        const pumpVisual = document.getElementById('pumpVisual');
        const forceStopBtn = document.getElementById('forceStopBtn');

        if (data.Pump_Button === 1) {
            if (forceStopBtn) forceStopBtn.style.display = 'block'; 

            if (data.Vibration === true && !isVibrationValidated) {
                isVibrationValidated = true;
                clearInterval(handshakeInterval); 
                updatePumpUISuccess();
                startActivityCountdown(); 
            }

            if (isVibrationValidated) {
                if (bigStatus) {
                    bigStatus.innerText = "POMPA AKTIF";
                    bigStatus.style.color = "#36c2b5"; 
                }
                suntikVisualDinamis(pumpVisual, URI_VISUAL_AKTIF, "⚡🌀");
                
                const usersArray = currentActiveUsers.split(' + ');
                const purposesArray = currentWaterPurposes.split(' + ');
                let htmlContent = "";

                // 💡 LOGIKA BARU: Jika user hanya 1 tapi punya banyak aktivitas, tampilkan semuanya sekaligus
                if (usersArray.length === 1 && purposesArray.length > 1) {
                    htmlContent += `
                        <div style="background: #f8f9fa; padding: 8px 16px; border-radius: 10px; width: 100%; max-width: 320px; display: flex; justify-content: space-between; align-items: center; border: 1px solid rgba(0,0,0,0.02); box-shadow: 0 2px 5px rgba(0,0,0,0.01); margin-bottom: 5px;">
                            <span style="font-weight: 700; color: #2d3436;">👤 ${usersArray[0]}</span>
                            <span style="color: #36c2b5; font-weight: 600; font-size: 13px; text-align: right; max-width: 60%; word-break: break-word;">➔ ${currentWaterPurposes}</span>
                        </div>
                    `;
                } else {
                    // Logika Multi-User standar seperti biasa
                    usersArray.forEach((user, index) => {
                        const purpose = purposesArray[index] || "Keperluan Umum";
                        htmlContent += `
                            <div style="background: #f8f9fa; padding: 8px 16px; border-radius: 10px; width: 100%; max-width: 320px; display: flex; justify-content: space-between; align-items: center; border: 1px solid rgba(0,0,0,0.02); box-shadow: 0 2px 5px rgba(0,0,0,0.01); margin-bottom: 5px;">
                                <span style="font-weight: 700; color: #2d3436;">👤 ${user}</span>
                                <span style="color: #36c2b5; font-weight: 600; font-size: 13px;">➔ ${purpose}</span>
                            </div>
                        `;
                    });
                }
                
                if (bigDetail) bigDetail.innerHTML = htmlContent;
            } else {
                if (bigStatus) {
                    bigStatus.innerText = "MEMVERIFIKASI...";
                    bigStatus.style.color = "#fdcb6e"; 
                }
                suntikVisualDinamis(pumpVisual, URI_VISUAL_VERIFIKASI, "⏳");
                if (bigDetail) bigDetail.innerHTML = `<div>Menunggu respons balik mekanis dari sensor getaran...</div>`;
            }
        } else {
            isVibrationValidated = false;
            if (forceStopBtn) forceStopBtn.style.display = 'none'; 
            clearInterval(handshakeInterval);
            clearInterval(activityTimerInterval);
            
            if (bigStatus) {
                bigStatus.innerText = "POMPA NON-AKTIF";
                bigStatus.style.color = "#ff7675"; 
            }
            suntikVisualDinamis(pumpVisual, URI_VISUAL_STANDBY, "💤");
            if (bigDetail) bigDetail.innerHTML = `<div>Sistem dalam kondisi standby aman</div>`;
        }

        if (data.Pump_Button === 1 && isVibrationValidated) {
            const btn = document.getElementById('pBtn');
            if (btn) {
                btn.classList.add('on'); 
                btn.innerText = 'JOIN'; 
            }
        } else if (!isVibrationValidated && data.Pump_Button === 0) {
            updatePumpUI(0);
        }
    }
});

// =================================================================
// B. REAL-TIME RE-DRAW PREDIKSI MINGGUAN AI + OTO-ARCHIVE RESETER
// =================================================================
onValue(predictionRef, (snapshot) => {
    const data = snapshot.val();
    if (data && data.Monthly_Bill) {
        const predElem = document.getElementById('valPrediction');
        if (predElem) { predElem.innerText = rupiahFormatter.format(data.Monthly_Bill); }
    }

    const sekarang = new Date();
    const hariIni = sekarang.getDay(); 
    const jamIni = aerospace = sekarang.getHours();
    const menitIni = sekarang.getMinutes();
    const notifElemen = document.getElementById('resetNotification');

    if (notifElemen) {
        if (hariIni === 0) { 
            if (jamIni >= 18) { 
                notifElemen.style.display = 'block';
                notifElemen.innerHTML = "⚠️ PEMBERITAHUAN: Pengumpulan data minggu ini selesai pukul 23:59. Data Aktual akan di-reset otomatis!";
                notifElemen.style.background = "#ff7675"; 
            } else {
                notifElemen.style.display = 'block';
                notifElemen.innerHTML = "ℹ️ Info: Hari terakhir siklus mingguan. Reset otomatis nanti malam.";
                notifElemen.style.background = "rgba(255,255,255,0.2)";
            }

            if (jamIni === 23 && menitIni === 59) {
                if (!localStorage.getItem('isAlreadyBackedUpThisWeek')) {
                    const currentEnergy = rawFirebaseSnapshot.Energy || 0;
                    const hitungRupiahFinal = Math.round(currentEnergy * 1444.70);
                    
                    const paketArsip = {
                        Tanggal_Backup: sekarang.toLocaleDateString('id-ID'),
                        Total_Energy: currentEnergy,
                        Total_Bill: hitungRupiahFinal,
                        Timestamp: Date.now()
                    };

                    push(historyRef, paketArsip).then(() => {
                        const updatesReset = {};
                        updatesReset['AquaSync/Realtime_Status/Energy'] = 0;
                        updatesReset['AquaSync/Realtime_Status/Actual_Bill'] = 0;
                        return update(ref(database), updatesReset);
                    }).then(() => {
                        localStorage.setItem('isAlreadyBackedUpThisWeek', 'true');
                    }).catch((err) => {
                        console.error("Gagal backup data:", err);
                    });
                }
            }
        } else {
            notifElemen.style.display = 'none';
            localStorage.removeItem('isAlreadyBackedUpThisWeek');
        }
    }
});

// =================================================================
// C. REAL-TIME PENARIK DATA HISTORI UNTUK DISPLAY WIDGET E-STATEMENT
// =================================================================
onValue(historyRef, (snapshot) => {
    const data = snapshot.val();
    if (data) {
        let totalTagihanKumulatif = 0;
        let htmlTableContent = "";

        for (let key in data) {
            const mingguIni = data[key];
            totalTagihanKumulatif += mingguIni.Total_Bill || 0;

            htmlTableContent += `
                <tr>
                    <td style="padding: 10px; border-bottom: 1px solid #eee;">📅 ${mingguIni.Tanggal_Backup || '-'}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center;">${mingguIni.Total_Energy ? mingguIni.Total_Energy.toFixed(3) : 0} kWh</td>
                    <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right; font-weight: bold; color: #2ecc71;">${rupiahFormatter.format(mingguIni.Total_Bill || 0)}</td>
                </tr>
            `;
        }

        const totalEStatementElem = document.getElementById('valEStatementTotal');
        if (totalEStatementElem) {
            totalEStatementElem.innerText = rupiahFormatter.format(totalTagihanKumulatif);
        }

        const tableBodyElem = document.getElementById('tableEStatementBody');
        if (tableBodyElem) {
            tableBodyElem.innerHTML = htmlTableContent;
        }
    } else {
        if (document.getElementById('valEStatementTotal')) {
            document.getElementById('valEStatementTotal').innerText = "Rp 0";
        }
    }
});

// =================================================================
// D. INTERFACE BUTTON CONTROL LOGIC & MODAL ACTION
// =================================================================
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
    
    let myPurpose = "Keperluan Umum";
    const now = Date.now();
    const updates = {};

    if (userIndex !== -1) {
        myPurpose = purposesArray[userIndex];
        
        const firebaseStartTime = rawFirebaseSnapshot[`Start_User_${loggedInUserEmail}`];
        let durationMinutes = 1;
        if (firebaseStartTime) {
            durationMinutes = Math.max(1, Math.floor((now - firebaseStartTime) / 60000));
        }

        const logRef = ref(database, 'AquaSync/Log_Aktivitas');
        set(logRef, {
            User_Terakhir: loggedInUserEmail,
            Aktivitas_Terakhir: myPurpose,
            Durasi_Asli_Menit: durationMinutes,
            Timestamp_Mati: now
        });

        const currentStats = rawFirebaseSnapshot.Stats_Summary || { Users: {}, Purposes: {} };
        if (!currentStats.Users) currentStats.Users = {};
        if (!currentStats.Purposes) currentStats.Purposes = {};

        const oldUserMin = currentStats.Users[loggedInUserEmail] || 0;
        updates[`AquaSync/Stats_Summary/Users/${loggedInUserEmail}`] = oldUserMin + durationMinutes;

        const safePurposeKey = myPurpose.split(' ')[0]; 
        const oldPurposeMin = currentStats.Purposes[safePurposeKey] || 0;
        updates[`AquaSync/Stats_Summary/Purposes/${safePurposeKey}`] = oldPurposeMin + durationMinutes;
        updates[`AquaSync/Realtime_Status/Start_User_${loggedInUserEmail}`] = null;

        usersArray.splice(userIndex, 1);
        purposesArray.splice(userIndex, 1);
    }

    if (usersArray.length > 0) {
        let maxRemainingAllowed = 0;

        usersArray.forEach((remUser, remIndex) => {
            const remPurpose = purposesArray[remIndex];
            const remStartTime = rawFirebaseSnapshot[`Start_User_${remUser}`];
            
            if (remStartTime) {
                let totalJatahMili = 40 * 60000; 
                if (remPurpose === 'Mesin Cuci') { totalJatahMili = 120 * 60000; }
                else if (remPurpose === 'Lain-lain / Siram Tanaman') { totalJatahMili = 0; }

                if (totalJatahMili > 0) {
                    const targetMatiUserItu = remStartTime + totalJatahMili;
                    const sisaMiliUserItu = targetMatiUserItu - now;
                    if (sisaMiliUserItu > maxRemainingAllowed) { maxRemainingAllowed = sisaMiliUserItu; }
                } else {
                    maxRemainingAllowed = -1;
                }
            }
        });

        let newTimeoutTimestamp = 0;
        if (maxRemainingAllowed === -1) { newTimeoutTimestamp = 0; }
        else if (maxRemainingAllowed > 0) { newTimeoutTimestamp = now + maxRemainingAllowed; }
        else { newTimeoutTimestamp = now + 60000; }

        const finalUsers = usersArray.join(' + ');
        const finalPurposes = purposesArray.join(' + ');
        
        updates['AquaSync/Realtime_Status/Pump_Button'] = 1;
        updates['AquaSync/Realtime_Status/Active_User'] = finalUsers;
        updates['AquaSync/Realtime_Status/Water_Purpose'] = finalPurposes;
        updates['AquaSync/Realtime_Status/Pump_Timeout'] = newTimeoutTimestamp;

        update(ref(database), updates).then(() => { currentPumpState = 1; });

    } else {
        // 💡 INTEGRASI HITUNG MUNDUR USER TERAKHIR MATIKAN POMPA
        localLockBypass = true;
        update(ref(database), { 'AquaSync/Control/Button_condition': false })
            .then(() => {
                startHandshakeMatiTimeout(); 
            });
    }
}

window.submitWaterPurpose = function(purpose) {
    document.getElementById('purposeModal').style.display = 'none';

    let durationMinutes = 0;
    if (purpose === 'Mesin Cuci') { durationMinutes = 120; } 
    else if (purpose === 'Mandi & Buang Air' || purpose === 'Cuci Piring') { durationMinutes = 40; } 

    const now = Date.now();
    let newTimeoutTimestamp = 0;
    let finalUsers = loggedInUserEmail;
    let finalPurposes = purpose;

    const updates = {};
    updates[`AquaSync/Realtime_Status/Start_User_${loggedInUserEmail}`] = now;

    if (currentPumpState === 1 && globalPumpTimeout > now) {
        if (!currentActiveUsers.includes(loggedInUserEmail)) { 
            finalUsers = `${currentActiveUsers} + ${loggedInUserEmail}`; 
        } else { 
            finalUsers = currentActiveUsers; 
        }

        if (!currentWaterPurposes.includes(purpose)) { 
            finalPurposes = `${currentWaterPurposes} + ${purpose}`; 
        } else { 
            finalPurposes = currentWaterPurposes; 
        }

        const remainingTimeMinutes = Math.floor((globalPumpTimeout - now) / 60000);
        if (durationMinutes > remainingTimeMinutes) { 
            newTimeoutTimestamp = now + (durationMinutes * 60000); 
        } else { 
            newTimeoutTimestamp = globalPumpTimeout; 
        }

        updates['AquaSync/Realtime_Status/Pump_Button'] = 1;
        updates['AquaSync/Realtime_Status/Active_User'] = finalUsers;
        updates['AquaSync/Realtime_Status/Water_Purpose'] = finalPurposes;
        updates['AquaSync/Realtime_Status/Pump_Timeout'] = newTimeoutTimestamp;

        update(ref(database), updates).then(() => { 
            currentPumpState = 1; 
            currentWaterPurposes = finalPurposes; 
            currentActiveUsers = finalUsers;
            globalPumpTimeout = newTimeoutTimestamp;
            startActivityCountdown(); 
        });

    } else {
        newTimeoutTimestamp = durationMinutes > 0 ? now + (durationMinutes * 60000) : 0;
        
        const initUpdates = {};
        initUpdates['AquaSync/Control/Button_condition'] = true;
        
        update(ref(database), initUpdates).then(() => {
            return set(ref(database, 'AquaSync/Realtime_Status/Vibration'), false);
        })
        .then(() => {
            updates['AquaSync/Realtime_Status/Pump_Button'] = 1;
            updates['AquaSync/Realtime_Status/Active_User'] = finalUsers;
            updates['AquaSync/Realtime_Status/Water_Purpose'] = finalPurposes;
            updates['AquaSync/Realtime_Status/Pump_Timeout'] = newTimeoutTimestamp;
            return update(ref(database), updates);
        })
        .then(() => { startHandshakeTimeout(); });
    }
}

window.closeModal = function() { document.getElementById('purposeModal').style.display = 'none'; }
window.closeSessionModal = function() { document.getElementById('sessionModal').style.display = 'none'; }

window.triggerForceStop = function() {
    if (confirm("Apakah Anda yakin ingin mematikan pompa secara paksa?")) {
        localLockBypass = true;
        update(ref(database), { 'AquaSync/Control/Button_condition': false })
            .then(() => {
                startHandshakeMatiTimeout(); 
            });
    }
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
        if (elementTarget.querySelector('img') || tulisanSekarang !== emojiSerep) {
            elementTarget.innerHTML = emojiSerep;
        }
    }
}

function sendPumpStateToFirebase(state, user, purpose, timeoutTimestamp) {
    const updates = {};
    updates['AquaSync/Realtime_Status/Pump_Button'] = state;
    updates['AquaSync/Realtime_Status/Active_User'] = user;
    updates['AquaSync/Realtime_Status/Water_Purpose'] = purpose;
    updates['AquaSync/Realtime_Status/Pump_Timeout'] = timeoutTimestamp;
    
    if (state === 0) { updates['AquaSync/Control/Button_condition'] = false; }

    if (state === 0 && rawFirebaseSnapshot) {
        Object.keys(rawFirebaseSnapshot).forEach(key => {
            if (key.startsWith('Start_User_')) { updates[`AquaSync/Realtime_Status/${key}`] = null; }
        });
    }

    return update(ref(database), updates)
    .then(() => {
        currentPumpState = state;
        if (state === 0) {
            isVibrationValidated = false;
            clearInterval(handshakeInterval);
            clearInterval(activityTimerInterval);
            updatePumpUI(0);
        }
    })
    .catch((error) => { console.error("Gagal sinkronisasi Firebase:", error); });
}

function startHandshakeTimeout() {
    clearInterval(handshakeInterval);
    isVibrationValidated = false;
    let timeLeft = 60;
    updatePumpUI(1, "01:00");

    handshakeInterval = setInterval(() => {
        timeLeft--;
        const minutes = Math.floor(timeLeft / 60).toString().padStart(2, '0');
        const seconds = (timeLeft % 60).toString().padStart(2, '0');
        
        const tDisp = document.getElementById('tDisplay');
        if (tDisp) tDisp.innerText = `${minutes}:${seconds}`;

        if (timeLeft <= 0) {
            clearInterval(handshakeInterval);
            alert("⚠️ PERINGATAN: Pompa Gagal Diaktifkan! Tidak ada respon getaran.");
            sendPumpStateToFirebase(0, "-", "-", 0);
        }
    }, 1000);
}

// 🔥 FUNGSI TIMEOUT MEMATIKAN (BERSIH & MATIKAN TIMER LAMA BIAR GAK TABRAKAN)
function startHandshakeMatiTimeout() {
    clearInterval(handshakeInterval);
    clearInterval(activityTimerInterval); 
    isVibrationValidated = false;
    let timeLeft = 60;
    
    updatePumpUI(1, "01:00"); 
    const bigStatus = document.getElementById('bigPumpStatus');
    if (bigStatus) { bigStatus.innerText = "VERIFIKASI MATI..."; bigStatus.style.color = "#fdcb6e"; }
    const pumpVisual = document.getElementById('pumpVisual');
    if (pumpVisual) pumpVisual.innerHTML = "⏳";

    handshakeInterval = setInterval(() => {
        timeLeft--;
        const minutes = Math.floor(timeLeft / 60).toString().padStart(2, '0');
        const seconds = (timeLeft % 60).toString().padStart(2, '0');
        
        const tDisp = document.getElementById('tDisplay');
        if (tDisp) tDisp.innerText = `${minutes}:${seconds}`;

        if (rawFirebaseSnapshot.Vibration === false || rawFirebaseSnapshot.Vibration === "false") {
            clearInterval(handshakeInterval);
            localLockBypass = false;
            
            const finalUpdates = {};
            finalUpdates['AquaSync/Realtime_Status/Pump_Button'] = 0;
            finalUpdates['AquaSync/Realtime_Status/Active_User'] = "-";
            finalUpdates['AquaSync/Realtime_Status/Water_Purpose'] = "-";
            finalUpdates['AquaSync/Realtime_Status/Pump_Timeout'] = 0;
            update(ref(database), finalUpdates);
            
            alert("✅ SUKSES: Pompa terverifikasi telah berhenti bergetar dan mati total.");
        }

        if (timeLeft <= 0) {
            clearInterval(handshakeInterval);
            localLockBypass = false;
            alert("⚠️ POP-UP: Pompa gagal dimatikan, cek koneksi internet!");
            update(ref(database), { 'AquaSync/Control/Button_condition': true });
            startActivityCountdown(); 
        }
    }, 1000);
}

function startActivityCountdown() {
    clearInterval(activityTimerInterval);
    const timerDisplay = document.getElementById('tDisplay');
    
    if (globalPumpTimeout === 0) {
        if (timerDisplay) timerDisplay.style.display = 'none';
        return;
    }
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

    if (!btn) return;

    if (state === 1) {
        btn.classList.add('on'); 
        btn.innerText = 'WAIT';
        btn.style.background = '#fdcb6e'; 
        btn.style.color = 'white';
        if (timer) {
            timer.style.display = 'block';
            timer.style.color = "#fdcb6e"; 
            timer.innerText = timeText;
        }
    } else {
        btn.classList.remove('on'); 
        btn.innerText = 'OFF';
        btn.style.background = '#dfe6e9'; 
        btn.style.color = '#636e72';
        if (timer) timer.style.display = 'none';
    }
}

function updatePumpUISuccess() {
    const btn = document.getElementById('pBtn');
    const timer = document.getElementById('tDisplay');
    
    if (btn) {
        btn.classList.add('on'); 
        btn.innerText = 'JOIN'; 
        btn.style.background = '#36c2b5'; 
        btn.style.color = 'white';
    }
    if (timer) {
        timer.style.display = 'block'; 
        timer.style.color = "#36c2b5"; 
    }
}