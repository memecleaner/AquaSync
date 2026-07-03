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
let statsSummaryCache = {
    Users: {},
    Purposes: {}
};

const rupiahFormatter = new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR', maximumFractionDigits: 0
});

// Daftar nama bulan Indonesia untuk penamaan otomatis periode E-Statement
const namaBulanIndo = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktobet", "November", "Desember"];

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
const predictionRef = ref(database, 'AquaSync/Prediction');
const historyRef = ref(database, 'AquaSync/History_Mingguan'); 
const statsRef = ref(database, 'AquaSync/Stats_Summary');

onValue(statsRef, (snapshot) => {

    statsSummaryCache = snapshot.val() || {
        Users: {},
        Purposes: {}
    };

});
// =================================================================
// A. MENDENGAR DATABASE REALTIME CLOUD + EKSEKUSI MONITORING TOREN
// =================================================================
onValue(realtimeRef, (snapshot) => {
    const data = snapshot.val();
    if (data) {
        rawFirebaseSnapshot = data; 
        
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

        if (document.getElementById('valWaterLevel')) {
            document.getElementById('valWaterLevel').innerText = data.Water_Level + "%";
        }
        
        const waterFillElem = document.getElementById('torenWaterFill');
        if (waterFillElem) { waterFillElem.style.height = data.Water_Level + "%"; }

        const vibrationElem = document.getElementById('valVibration');
        if (vibrationElem) { vibrationElem.innerText = data.Vibration; }

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
                
                const usersArray = currentActiveUsers.split(' + ');
                const purposesArray = currentWaterPurposes.split(' + ');
                let htmlContent = "";

                usersArray.forEach((user, index) => {
                    const purpose = purposesArray[index] || "Keperluan Umum";
                    htmlContent += `
                        <div style="background: #f8f9fa; padding: 8px 16px; border-radius: 10px; width: 100%; max-width: 320px; display: flex; justify-content: space-between; align-items: center; border: 1px solid rgba(0,0,0,0.02); box-shadow: 0 2px 5px rgba(0,0,0,0.01); margin-bottom: 5px;">
                            <span style="font-weight: 700; color: #2d3436;">👤 ${user}</span>
                            <span style="color: #36c2b5; font-weight: 600; font-size: 13px;">➔ ${purpose}</span>
                        </div>
                    `;
                });
                if (bigDetail) bigDetail.innerHTML = htmlContent;
            } else {
                if (bigStatus) {
                    bigStatus.innerText = "MEMVERIFIKASI...";
                    bigStatus.style.color = "#fdcb6e"; 
                }
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
// B. 🔥 PREDIKSI MINGGUAN AI + PROYEKSI BULANAN + OTO-ARCHIVE
// =================================================================
onValue(predictionRef, (snapshot) => {
    const data = snapshot.val();
    if (data && data.Monthly_Bill) {
        const prediksiMingguIni = data.Monthly_Bill;
        const prediksiBulanIni = prediksiMingguIni * 4; // Logika Ekstrapolasi Jembatan Waktu

        // Cetak masing-masing ke elemen display target
        const predMingguElem = document.getElementById('valPrediction');
        if (predMingguElem) { predMingguElem.innerText = rupiahFormatter.format(prediksiMingguIni); }

        const predBulanElem = document.getElementById('valPredictionMonthly');
        if (predBulanElem) { predBulanElem.innerText = rupiahFormatter.format(prediksiBulanIni); }
    }

    const sekarang = new Date();
    const hariIni = sekarang.getDay(); 
    const jamIni = sekarang.getHours();
    const notifElemen = document.getElementById('resetNotification');

    if (notifElemen) {
        if (hariIni === 0) { 
            if (jamIni >= 18) { 
                notifElemen.style.display = 'block';
                notifElemen.innerHTML = "⚠️ PEMBERITAHUAN: Pengumpulan data minggu ini selesai malam ini pukul 23:59. E-Statement otomatis terbit!";
                notifElemen.style.background = "#ff7675"; 
            } else {
                notifElemen.style.display = 'block';
                notifElemen.innerHTML = "ℹ️ Info: Hari terakhir siklus mingguan. E-Statement otomatis diproses nanti malam.";
                notifElemen.style.background = "rgba(255,255,255,0.2)";
            }

            if (jamIni === 23) {
                const currentWeekId = "week_id_" + sekarang.getFullYear() + "_" + Math.floor(sekarang.getTime() / (7 * 24 * 60 * 60 * 1000));
                if (!localStorage.getItem(currentWeekId)) {
                    const currentEnergy = rawFirebaseSnapshot.Energy || 0;
                    const hitungRupiahFinal = Math.round(currentEnergy * 1444.70);
                    
                    const seninLalu = new Date(sekarang);
                    seninLalu.setDate(sekarang.getDate() - 6);
                    
                    // 💡 FIX PERIODE BULAN: Mengambil nama bulan dinamis agar tidak stuck di kata "Juni"
                    const namaBulanSenin = namaBulanIndo[seninLalu.getMonth()];
                    const namaBulanMinggu = namaBulanIndo[sekarang.getMonth()];
                    
                    let stringPeriode = `${seninLalu.getDate().toString().padStart(2,'0')} ${namaBulanSenin} - ${sekarang.getDate().toString().padStart(2,'0')} ${namaBulanMinggu}`;

                    const paketArsip = {
                        Tanggal_Backup: stringPeriode,
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
                        localStorage.setItem(currentWeekId, 'true');
                    }).catch((err) => {
                        console.error("Gagal backup otomatis:", err);
                    });
                }
            }
        } else {
            notifElemen.style.none = 'none';
        }
    }
});

// =================================================================
// C. 💡 LOGIKA AMAN: LIST URUT MENURUN (TERBARU SELALU DI ATAS)
// =================================================================
onValue(historyRef, (snapshot) => {
    const data = snapshot.val();
    if (data) {
        let totalTagihanKumulatif = 0;
        let listArray = [];

        for (let key in data) {
            const mingguIni = data[key];
            totalTagihanKumulatif += mingguIni.Total_Bill || 0;
            listArray.push(mingguIni);
        }

        // Urutkan array berdasarkan Timestamp terbesar (Terbaru ditaruh paling atas)
        listArray.sort((a, b) => b.Timestamp - a.Timestamp);

        let htmlTableContent = "";
        listArray.forEach((mingguIni) => {
            htmlTableContent += `
                <div style="background: white; padding: 16px; border-radius: 12px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 2px 8px rgba(0,0,0,0.04);">
                    <div>
                        <div style="font-weight: 600; color: #2d3436; font-size: 15px;">📅 Periode ${mingguIni.Tanggal_Backup || '-'}</div>
                        <div style="font-size: 13px; color: #636e72; margin-top: 2px;">Status: Ready to download (.csv) | ${mingguIni.Total_Energy ? mingguIni.Total_Energy.toFixed(3) : 0} kWh</div>
                    </div>
                    <button style="background: #36c2b5; color: white; border: none; padding: 8px 16px; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 13px;">DOWNLOAD</button>
                </div>
            `;
        });

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

window.checkoutUserSession = async function() {

    document.getElementById('sessionModal').style.display = 'none';

    const usersArray = currentActiveUsers.split(' + ');
    const purposesArray = currentWaterPurposes.split(' + ');

    const userIndex = usersArray.indexOf(loggedInUserEmail);

    let submitWaterPurpose = "Keperluan Umum";
    const now = Date.now();

    let updates = {};

    if (userIndex !== -1) {

        submitWaterPurpose = purposesArray[userIndex];

        const firebaseStartTime =
            rawFirebaseSnapshot[`Start_User_${loggedInUserEmail}`];

        console.log("USER LOGIN :", loggedInUserEmail);
        console.log("START TIME :", firebaseStartTime);
        console.log("NOW :", now);

        let durationMinutes = 1;

        if (firebaseStartTime) {

            const diffMs = now - firebaseStartTime;

            console.log("SELISIH MS :", diffMs);

            durationMinutes = Math.ceil(diffMs / 60000);

            if (durationMinutes < 1) {
                durationMinutes = 1;
            }
        }

        console.log("DURASI FINAL :", durationMinutes);

// =========================================================
// SUNTIKAN LOGIKA AI: KIRIM DURASI UNTUK ADAPTIVE SMOOTHING
// =========================================================
let durasiUntukAI = durationMinutes;

// Cek apakah sesi ini mati karena diperingatkan kelalaian (Force Shutdown)
// Jika durasi menyentuh atau melebihi threshold, kita potong 10 menit agar rumus AI di Python tidak rusak
const batasKritisMax = (rawFirebaseSnapshot.Pump_Timeout - rawFirebaseSnapshot[`Start_User_${loggedInUserEmail}`]) / 60000;
if (durationMinutes >= (batasKritisMax - 1)) {
    durasiUntukAI = Math.max(1, durationMinutes - 10); // Saring anomali kelalaian lupa matiin
    console.log("[AI SECURITY] Durasi disaring dari anomali lupa matiin menjadi:", durasiUntukAI);
}

// Tembak langsung ke node database khusus agar dibaca oleh Script PythonAnywhere kamu!
updates[`AquaSync/Users_AI/${loggedInUserEmail}/durasi_aktual_terakhir`] = durasiUntukAI;
// =========================================================

        const currentStats = statsSummaryCache || {
        Users: {},
        Purposes: {}
        };  

        if (!currentStats.Users) currentStats.Users = {};
        if (!currentStats.Purposes) currentStats.Purposes = {};

        const oldUserMin =
            currentStats.Users[loggedInUserEmail] || 0;

        updates[
            `AquaSync/Stats_Summary/Users/${loggedInUserEmail}`
        ] = oldUserMin + durationMinutes;

        const oldPurposeMin =
            currentStats.Purposes[submitWaterPurpose] || 0;

        updates[
            `AquaSync/Stats_Summary/Purposes/${submitWaterPurpose}`
        ] = oldPurposeMin + durationMinutes;

        updates["AquaSync/Log_Aktivitas/User_Terakhir"] =
            loggedInUserEmail;

        updates["AquaSync/Log_Aktivitas/Aktivitas_Terakhir"] =
            submitWaterPurpose;

        updates["AquaSync/Log_Aktivitas/Durasi_Asli_Menit"] =
            durationMinutes;

        updates["AquaSync/Log_Aktivitas/Timestamp_Mati"] =
            now;

        await update(ref(database), updates);

        usersArray.splice(userIndex, 1);
        purposesArray.splice(userIndex, 1);
        
        updates[
        `AquaSync/Realtime_Status/Start_User_${loggedInUserEmail}`
        ] = null;
    }

    updates = {};

    if (usersArray.length > 0) {

        let latestEndTime = 0;
        let unlimitedUserExists = false;

        usersArray.forEach((remUser, remIndex) => {

            const remPurpose = purposesArray[remIndex];

            const remStartTime =
                rawFirebaseSnapshot[`Start_User_${remUser}`];

            if (!remStartTime) return;

            if (remPurpose === 'Lain-lain / Siram Tanaman') {
                unlimitedUserExists = true;
                return;
            }

            let durationMs = 40 * 60000;

            if (remPurpose === 'Mesin Cuci') {
                durationMs = 120 * 60000;
            }

            const endTime =
                remStartTime + durationMs;

            if (endTime > latestEndTime) {
                latestEndTime = endTime;
            }
        });

        updates['AquaSync/Realtime_Status/Pump_Button'] = 1;
        updates['AquaSync/Realtime_Status/Active_User'] =
            usersArray.join(' + ');
        updates['AquaSync/Realtime_Status/Water_Purpose'] =
            purposesArray.join(' + ');

        if (unlimitedUserExists) {
            updates['AquaSync/Realtime_Status/Pump_Timeout'] = 0;
        } else {
            updates['AquaSync/Realtime_Status/Pump_Timeout'] =
                latestEndTime;
        }

        update(ref(database), updates)
            .then(() => {
                currentPumpState = 1;
            })
            .catch(err => {
                console.error(err);
            });
    }

    // ==================================================
    // USER TERAKHIR KELUAR
    // ==================================================
    else {

        // Simpan statistik + hapus Start_User dulu
        update(ref(database), updates)
            .then(() => {

                // Sama persis seperti Force Stop
                localLockBypass = true;

                return update(ref(database), {
                    'AquaSync/Control/Button_condition': false
                });

            })
            .then(() => {

                startHandshakeMatiTimeout();

            })
            .catch(err => {
                console.error(err);
            });
    }
};

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
        if (!currentActiveUsers.includes(loggedInUserEmail)) { finalUsers = `${currentActiveUsers} + ${loggedInUserEmail}`; }
        else { finalUsers = currentActiveUsers; }

        if (!currentWaterPurposes.includes(purpose)) { finalPurposes = `${currentWaterPurposes} + ${purpose}`; }
        else { finalPurposes = currentWaterPurposes; }

        const remainingTimeMinutes = Math.floor((globalPumpTimeout - now) / 60000);
        if (durationMinutes > remainingTimeMinutes) { newTimeoutTimestamp = now + (durationMinutes * 60000); }
        else { newTimeoutTimestamp = globalPumpTimeout; }

        updates['AquaSync/Realtime_Status/Pump_Button'] = 1;
        updates['AquaSync/Realtime_Status/Active_User'] = finalUsers;
        updates['AquaSync/Realtime_Status/Water_Purpose'] = finalPurposes;
        updates['AquaSync/Realtime_Status/Pump_Timeout'] = newTimeoutTimestamp;

        update(ref(database), updates).then(() => { currentPumpState = 1; });

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

function startHandshakeMatiTimeout() {
    clearInterval(handshakeInterval);
    clearInterval(activityTimerInterval); 
    isVibrationValidated = false;
    let timeLeft = 60;
    
    updatePumpUI(1, "01:00"); 
    const bigStatus = document.getElementById('bigPumpStatus');
    if (bigStatus) { bigStatus.innerText = "VERIFIKASI MATI..."; bigStatus.style.color = "#fdcb6e"; }

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

// Tambahkan 2 variabel global baru ini di bagian paling atas script kamu
let pemicuNotifTerpanggil = false;

function startActivityCountdown() {
    clearInterval(activityTimerInterval);
    const timerDisplay = document.getElementById('tDisplay');
    
    if (globalPumpTimeout === 0) {
        if (timerDisplay) timerDisplay.style.display = 'none';
        return;
    }
    if (timerDisplay) timerDisplay.style.display = 'block';

    // Ambil batas AI khusus untuk user yang sedang login saat ini secara real-time
    // Catatan: loggedInUserEmail di kodinganmu isinya string nama (misal: "audrey")
    const aiUserRef = ref(database, `AquaSync/Users_AI/${loggedInUserEmail}`);
    
    onValue(aiUserRef, (aiSnapshot) => {
        const dataAI = aiSnapshot.val() || { batas_timer_ai: 20, threshold_mati_paksa: 30 };
        const batasTimerAi = dataAI.batas_timer_ai;
        const thresholdMatiPaksa = dataAI.threshold_mati_paksa;

        pemicuNotifTerpanggil = false; // Reset status notifikasi tiap sesi mulai

        activityTimerInterval = setInterval(() => {
            const now = Date.now();
            
            // Ambil waktu mulai user mandi (Gunakan variabel dinamismu)
            const firebaseStartTime = rawFirebaseSnapshot[`Start_User_${loggedInUserEmail}`] || now;
            const selisihMenit = Math.floor((now - firebaseStartTime) / 60000);

            // TAHAP 1: PERSUASIF (Mencapai batas wajar AI, munculkan Notifikasi)
            if (selisihMenit >= batasTimerAi && selisihMenit < thresholdMatiPaksa && !pemicuNotifTerpanggil) {
                pemicuNotifTerpanggil = true; 
                
                // Pemicu Notifikasi bawaan browser
                if (Notification.permission === "granted") {
                    new Notification("⚠️ Peringatan AquaSync", `Halo ${loggedInUserEmail}, penggunaan air telah melewati batas wajar Anda (${batasTimerAi} menit). Mohon matikan jika sudah selesai.`);
                } else {
                    alert(`⚠️ HALO ${loggedInUserEmail.toUpperCase()}! Pemakaian air sudah lewat batas wajar Anda (${batasTimerAi} Menit). Mohon matikan pompa jika sudah selesai ya!`);
                }
                
                // Beri efek visual pada background dashboard aslimu biar berubah warna peringatan
                if(document.getElementById('bigPumpStatus')) {
                    document.getElementById('bigPumpStatus').innerText = "MELEWATI BATAS WAJAR!";
                    document.getElementById('bigPumpStatus').style.color = "#fdcb6e"; // Oranye
                }
            }

            // TAHAP 2: PROTEKTIF (Lupa Matiin / Menyentuh Batas Kritis +10)
            if (selisihMenit >= thresholdMatiPaksa) {
                clearInterval(activityTimerInterval);
                alert("🚨 SYSTEM SHUTDOWN: Pompa dimatikan otomatis karena mendeteksi anomali kelalaian (Lupa mematikan).");
                
                // Eksekusi fungsi Force Stop bawaan kodingan aslimu agar relay mati fisik!
                localLockBypass = true;
                update(ref(database), { 'AquaSync/Control/Button_condition': false })
                    .then(() => {
                        startHandshakeMatiTimeout(); 
                    });
            }

            // Kodingan visual sisa waktu countdown aslimu biar tetep jalan di layar
            const difference = globalPumpTimeout - now;
            if (difference > 0) {
                const totalSeconds = Math.floor(difference / 1000);
                const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
                const seconds = (totalSeconds % 60).toString().padStart(2, '0');
                if (timerDisplay) timerDisplay.innerText = `${minutes}:${seconds}`;
            }

        }, 1000); // Cek berkala tiap detik
    }, { onlyOnce: true });
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