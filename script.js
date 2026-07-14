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
let statsSummaryCache = { Users: {}, Purposes: {} };

// Variabel Global untuk AI Kontrol Perilaku
let pemicuNotifTerpanggil = false;
let intervalPengawasAI = null;

const rupiahFormatter = new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR', maximumFractionDigits: 0
});

// PROTEKSI: bersihkan string sebelum dipakai sebagai KEY Firebase (bukan value).
// Firebase RTDB melarang karakter . # $ [ ] pada key, dan '/' akan dibaca sebagai
// pemisah path (ini penyebab bug lama "Lain-lain" jadi nested object).
function sanitizeFirebaseKey(raw) {
    if (!raw) return "Keperluan_Umum";
    let s = String(raw).trim();
    s = s.replace(/[./#$\[\]]/g, "-");
    s = s.replace(/\s+/g, " ").trim();
    return s || "Keperluan_Umum";
}

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

// Sensor PZEM tidak bisa direset ke 0 (kWh selalu naik sejak alat menyala).
// Jadi biaya "minggu ini" dihitung dari selisih kWh sekarang dikurangi baseline
// yang dicatat Python persis saat minggu baru dimulai (bukan dari kWh mentah).
// CATATAN: baseline disimpan di AquaSync/System (bukan Energy_Usage) karena
// ESP32 menulis ulang SELURUH node Energy_Usage tiap update sensor, yang akan
// menimpa/menghapus field lain (termasuk baseline) kalau ditaruh di situ.
let baselineKwhCache = 0;
const systemRef = ref(database, 'AquaSync/System');
onValue(systemRef, (snapshot) => {
    const d = snapshot.val() || {};
    baselineKwhCache = d.Baseline_Kwh_Minggu_Ini || 0;
});

onValue(statsRef, (snapshot) => {
    statsSummaryCache = snapshot.val() || { Users: {}, Purposes: {} };
});

// =================================================================
// A. MENDENGAR DATABASE REALTIME CLOUD + EKSEKUSI MONITORING TOREN
// =================================================================
onValue(realtimeRef, (snapshot) => {
    const data = snapshot.val();
    if (data) {
        // PERBAIKAN BUG AKURASI DATA: Simpan snapshot root secara berkala
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

        // const currentKwh = data.Energy || 0;
        // =================================================================
        // KEMBALI KE HITUNGAN LOKAL JS (100% BEBAS BEBAN CPU PYTHON)
        // =================================================================
        // PENTING: sensor PZEM tidak bisa direset ke 0, jadi data.Energy adalah
        // kWh KUMULATIF sejak alat menyala. Kurangi dengan baseline (kWh saat
        // minggu ini dimulai, dicatat oleh Python) supaya biaya mingguan benar.
        const currentKwh = Math.max(0, (data.Energy || 0) - baselineKwhCache);
        const hitungRupiahLive = Math.round(currentKwh * 1444.70); // Dihitung di browser laptop

        const actualBillElem = document.getElementById('valActualBill'); 
        if (actualBillElem) {
            if (hitungRupiahLive > 0 && hitungRupiahLive < 100) {
                actualBillElem.innerText = "Rp " + hitungRupiahLive;
            } else {
                actualBillElem.innerText = rupiahFormatter.format(hitungRupiahLive);
            }
        }

        // Samakan juga statistik mingguan bawah agar angkanya langsung ikut kembar live
        const statBillElem = document.getElementById('statActualBill');
        if (statBillElem) {
            statBillElem.innerText = rupiahFormatter.format(hitungRupiahLive);
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
        const forceStopBtn = document.getElementById('forceStopBtn');

        // =================================================================
        // KUNCI UI KETAT: RE-ORGANISASI STATUS POMPA (ANTI-DESINKRONISASI)
        // =================================================================
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

                // VERSI FIX FOTO 2: Kotak atas murni bersih berisi nama dan tujuan saja tanpa timer!
                usersArray.forEach((user, index) => {
                    const purpose = purposesArray[index] || "Keperluan Umum";
                    htmlContent += `
                        <div style="background: #f8f9fa; padding: 8px 16px; border-radius: 10px; width: 100%; max-width: 320px; display: flex; justify-content: space-between; align-items: center; border: 1px solid rgba(0,0,0,0.02); margin-bottom: 5px;">
                            <span style="font-weight: 700; color: #2d3436;">👤 ${user}</span>
                            <span style="color: #36c2b5; font-weight: 600; font-size: 13px;">➔ ${purpose}</span>
                        </div>
                    `;
                });
                if (bigDetail) bigDetail.innerHTML = htmlContent;

                // Pastikan mesin pemicu interval berjalan lancar di bawah tombol bulat
                startActivityCountdown();
            } else {
                if (bigStatus && bigStatus.innerText !== "VERIFIKASI MATI...") {
                    bigStatus.innerText = "MEMVERIFIKASI...";
                    bigStatus.style.color = "#fdcb6e"; 
                    if (bigDetail) bigDetail.innerHTML = `<div>Menunggu respons balik mekanis dari sensor getaran...</div>`;
                }
            }
        } 
        else {
            isVibrationValidated = false;
            localLockBypass = false; 
            
            // RESET PENANDA NOTIFIKASI AGAR BISA TERPANGGIL LAGI DI TES BERIKUTNYA
            Object.keys(window).forEach(key => {
                if (key.startsWith('notifTerpanggil_')) { delete window[key]; }
            });
            
            if (forceStopBtn) forceStopBtn.style.display = 'none'; 
            
            clearInterval(handshakeInterval);
            clearInterval(activityTimerInterval);
            clearInterval(intervalPengawasAI);
            
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
        } else if (data.Pump_Button === 0) {
            updatePumpUI(0);
        }
    } 
});

// =================================================================
// B. 🔥 PREDIKSI MINGGUAN AI + PROYEKSI BULANAN + OTO-ARCHIVE
// =================================================================
onValue(predictionRef, (snapshot) => {
    const data = snapshot.val();
    if (data && data.Monthly_Bill !== undefined && data.Monthly_Bill !== null) {
        const prediksiMingguIni = data.Monthly_Bill;
        const prediksiBulanIni = prediksiMingguIni * 4; 

        const predMingguElem = document.getElementById('valPrediction');
        if (predMingguElem) { predMingguElem.innerText = rupiahFormatter.format(prediksiMingguIni); }

        const predBulanElem = document.getElementById('valPredictionMonthly');
        if (predBulanElem) { predBulanElem.innerText = rupiahFormatter.format(prediksiBulanIni); }
    }

    // CATATAN: Arsip mingguan (push ke History_Mingguan + reset Energy/Actual_Bill)
    // TIDAK lagi dilakukan di sini. Sekarang dikerjakan oleh Python (main_ai.py) yang
    // jalan 24/7 di server, supaya tidak tergantung ada/tidaknya browser yang terbuka
    // tepat jam 23:00 tiap Minggu. Bagian ini hanya menampilkan notifikasi pengingat.
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
        } else {
            notifElemen.style.display = 'none';
        }
    }
});

// =================================================================
// E. 🔥 AMAN & PERSONAL: SUB-STATUS AI MENGIKUTI USER YANG LOGIN
// =================================================================
const statusUserAiRef = ref(database, 'AquaSync/Users_AI');
onValue(statusUserAiRef, (snapshot) => {
    const usersData = snapshot.val();
    
    // Pastikan user sudah terotentikasi dan emailnya valid
    if (usersData && loggedInUserEmail && loggedInUserEmail !== "-") {
        const elStatus = document.getElementById('valStatusAI');

        if (elStatus) {
            // Ambil data status spesifik dari Firebase milik user yang sedang aktif login
            if (usersData[loggedInUserEmail]) {
                const statusAktif = usersData[loggedInUserEmail].status_konsumsi || "Optimal";
                elStatus.innerText = statusAktif;

                // Pewarnaan teks status AI secara otomatis
                if (statusAktif.includes("Boros")) {
                    elStatus.style.color = "#ff4757"; // Merah
                } else if (statusAktif.includes("Efisien")) {
                    elStatus.style.color = "#36c2b5"; // Hijau
                } else {
                    elStatus.style.color = "#36c2b5"; // Hijau untuk Optimal
                }
            } else {
                // Skenario aman jika data user belum terbuat di node Firebase
                elStatus.innerText = "Belum ada data";
                elStatus.style.color = "#ff4757";
            }
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
        if (totalEStatementElem) { totalEStatementElem.innerText = rupiahFormatter.format(totalTagihanKumulatif); }

        const tableBodyElem = document.getElementById('tableEStatementBody');
        if (tableBodyElem) { tableBodyElem.innerHTML = htmlTableContent; }
    } else {
        if (document.getElementById('valEStatementTotal')) { document.getElementById('valEStatementTotal').innerText = "Rp 0"; }
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
        const firebaseStartTime = rawFirebaseSnapshot[`Start_User_${loggedInUserEmail}`];

        let durationMinutes = 1;
        if (firebaseStartTime) {
            const diffMs = now - firebaseStartTime;
            durationMinutes = Math.ceil(diffMs / 60000);
            if (durationMinutes < 1) durationMinutes = 1;
        }

        console.log("DURASI FINAL :", durationMinutes);

        // SUNTIKAN LOGIKA AI SINKRON
        let durasiUntukAI = durationMinutes;
        const batasKritisMax = (rawFirebaseSnapshot.Pump_Timeout - rawFirebaseSnapshot[`Start_User_${loggedInUserEmail}`]) / 60000;
        if (durationMinutes >= (batasKritisMax - 1)) {
            durasiUntukAI = Math.max(1, durationMinutes - 10); 
            console.log("[AI SECURITY] Durasi disaring dari anomali lupa matiin menjadi:", durasiUntukAI);
        }

        updates[`AquaSync/Users_AI/${loggedInUserEmail}/durasi_aktual_terakhir`] = durasiUntukAI;

        const currentStats = statsSummaryCache || { Users: {}, Purposes: {} };  
        if (!currentStats.Users) currentStats.Users = {};
        if (!currentStats.Purposes) currentStats.Purposes = {};

        const userKey = sanitizeFirebaseKey(loggedInUserEmail);
        const purposeKey = sanitizeFirebaseKey(submitWaterPurpose);

        const oldUserMin = currentStats.Users[userKey] || 0;
        updates[`AquaSync/Stats_Summary/Users/${userKey}`] = oldUserMin + durationMinutes;

        const oldPurposeMin = currentStats.Purposes[purposeKey] || 0;
        updates[`AquaSync/Stats_Summary/Purposes/${purposeKey}`] = oldPurposeMin + durationMinutes;

        // PENTING: JANGAN tulis ke satu slot tetap (AquaSync/Log_Aktivitas) lagi.
        // Kalau 2 user checkout berdekatan (bahkan dalam loop JS yang sama), slot
        // tunggal itu akan langsung ketimpa sebelum Python sempat membacanya --
        // itulah sebabnya sesi user3/Mesin Cuci hilang dari Daily_Behavior padahal
        // Stats_Summary-nya benar (karena Stats_Summary ditulis langsung, tidak
        // lewat relay). Sekarang tiap sesi didorong sebagai entri BARU ke antrian
        // (AquaSync/Log_Queue), jadi tidak ada yang tertimpa/hilang.
        const logQueueKey = push(ref(database, 'AquaSync/Log_Queue')).key;
        updates[`AquaSync/Log_Queue/${logQueueKey}`] = {
            User_Terakhir: loggedInUserEmail,
            Aktivitas_Terakhir: submitWaterPurpose,
            Durasi_Asli_Menit: durationMinutes,
            Timestamp_Mati: now
        };

        await update(ref(database), updates);

        usersArray.splice(userIndex, 1);
        purposesArray.splice(userIndex, 1);
        
        updates = {};
        updates[`AquaSync/Realtime_Status/Start_User_${loggedInUserEmail}`] = null;
        await update(ref(database), updates);
    }

    updates = {};
if (usersArray.length > 0) {
        let latestEndTime = 0;
        let unlimitedUserExists = false;

        // Ambil data snapshot AI secara lokal untuk mencocokkan threshold terbaru
        let snapshotDataAI = {};
        try {
            const { get, child } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js");
            const snapshotAI = await get(child(ref(database), `AquaSync/Users_AI`));
            if (snapshotAI.exists()) { snapshotDataAI = snapshotAI.val(); }
        } catch (e) {
            console.error("Gagal memuat parameter AI saat checkout:", e);
        }

        usersArray.forEach((remUser, remIndex) => {
            const remPurpose = purposesArray[remIndex];
            const remStartTime = rawFirebaseSnapshot[`Start_User_${remUser}`];

            if (!remStartTime) return;
            if (remPurpose === 'Lain-lain - Siram Tanaman') {
                unlimitedUserExists = true;
                return;
            }

            // ==========================================================
            // FIX LOGIKA SISA WAKTU: AMBIL DARI THRESHOLD AI MASING-MASING USER
            // ==========================================================
            let durationMinutes = 16; // Fallback default
            
            if (remPurpose === 'Mandi & Buang Air') {
                const dataUserAI = snapshotDataAI[remUser];
                // Ambil threshold_mati_paksa milik user tersebut (misal 18 menit)
                durationMinutes = (dataUserAI && dataUserAI.threshold_mati_paksa) ? dataUserAI.threshold_mati_paksa : 16;
            } else if (remPurpose === 'Mesin Cuci') {
                durationMinutes = rawFirebaseSnapshot.Durasi_Mesin_Cuci_Kustom || 60;
            } else if (remPurpose === 'Cuci Piring') {
                durationMinutes = 25;
            }

            const durationMs = durationMinutes * 60000;
            const endTime = remStartTime + durationMs;
            if (endTime > latestEndTime) { latestEndTime = endTime; }
        });

        updates['AquaSync/Realtime_Status/Pump_Button'] = 1;
        updates['AquaSync/Realtime_Status/Active_User'] = usersArray.join(' + ');
        updates['AquaSync/Realtime_Status/Water_Purpose'] = purposesArray.join(' + ');

        if (unlimitedUserExists) {
            updates['AquaSync/Realtime_Status/Pump_Timeout'] = 0;
        } else {
            updates['AquaSync/Realtime_Status/Pump_Timeout'] = latestEndTime;
        }

        update(ref(database), updates).then(() => { currentPumpState = 1; });
    }else {
        localLockBypass = true;
        update(ref(database), { 'AquaSync/Control/Button_condition': false })
            .then(() => { startHandshakeMatiTimeout(); });
    }
};

window.submitWaterPurpose = async function(purpose, customDuration = 0) {
    document.getElementById('purposeModal').style.display = 'none';

    let durationMinutes = 0;
    if (purpose === 'Mesin Cuci') { 
        durationMinutes = customDuration > 0 ? customDuration : 120; 
    } 
    else if (purpose === 'Cuci Piring') { 
        durationMinutes = 25; 
    }
    // ==========================================================
    // LOGIKA DINAMIS SINKRONISASI FIKSASI ABSOLUT THRESHOLD 16 MENIT
    // ==========================================================
    else if (purpose === 'Mandi & Disinfeksi' || purpose === 'Mandi & Buang Air') { 
        try {
            const { get, child } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js");
            const snapshotAI = await get(child(ref(database), `AquaSync/Users_AI/${loggedInUserEmail}`));
            
            if (snapshotAI.exists() && snapshotAI.val().threshold_mati_paksa) {
                durationMinutes = snapshotAI.val().threshold_mati_paksa;
                console.log(`[SYSTEM] Mengunci plafon batas mati kritis pompa: ${durationMinutes} menit`);
            } else {
                durationMinutes = 16; // Default aman matching threshold AI
                console.log(`[SYSTEM] Menggunakan fallback batas durasi maksimal: 16 menit`);
            }
        } catch (err) {
            durationMinutes = 16; 
            console.error("Gagal menjangkau Firebase, fallback:", err);
        }
    }

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
            .then(() => { startHandshakeMatiTimeout(); });
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
            clearInterval(intervalPengawasAI);
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
    clearInterval(intervalPengawasAI);
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

// =================================================================
// E. FIKSASI RANCANGAN UTAMA PEMUTAR DETIK GANDA (FOTO 2)
// =================================================================
function startActivityCountdown() {
    clearInterval(activityTimerInterval);
    
    const timerDisplay = document.getElementById('tDisplay');
    if (!timerDisplay) return;

    if (globalPumpTimeout === 0) {
        timerDisplay.style.display = 'none';
        return;
    }
    timerDisplay.style.display = 'block';

    // Panggil mesin backup pengawas notifikasi bawaan
    jalankanPengawasAIPersonal();

    // MESIN ENGINE UTAMA: Berputar aktif meluncurkan detik tanpa refresh!
    activityTimerInterval = setInterval(async () => {
        const now = Date.now();
        const difference = globalPumpTimeout - now;

        if (difference <= 0) {
            clearInterval(activityTimerInterval);
            timerDisplay.style.display = 'none';
            alert("⏰ WAKTU HABIS: Pompa otomatis dimatikan oleh batas kritis.");
            sendPumpStateToFirebase(0, "-", "-", 0); 
            return;
        }

        const usersArray = currentActiveUsers.split(' + ');
        const purposesArray = currentWaterPurposes.split(' + ');

        // 1. Hitung Sisa Detik Pompa Utama (Merah)
        const totalSecondsPompa = Math.floor(difference / 1000);
        const minPompa = Math.floor(totalSecondsPompa / 60);
        const secPompa = Math.floor(totalSecondsPompa % 60);
        const formatPompa = `${minPompa.toString().padStart(2, '0')}:${secPompa.toString().padStart(2, '0')}`;

        // Mulai menyusun injeksi dokumen string HTML di bawah tombol bulat
        let htmlDinamis = `<div style="text-align: center; font-family: sans-serif; font-size: 14px; margin-top: 12px; line-height: 1.6;">`;
        htmlDinamis += `<div style="color: #3498db; font-weight: 700; font-size: 11px; letter-spacing: 0.5px; margin-bottom: 4px;">TIMER USER :</div>`;

        // Ambil data snapshot eksternal dari jalur root Users_AI untuk mendapatkan nilai dinamis terbaru
        let snapshotDataAI = {};
        try {
            const { get, child } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js");
            const snapshotAI = await get(child(ref(database), `AquaSync/Users_AI`));
            if (snapshotAI.exists()) {
                snapshotDataAI = snapshotAI.val();
            }
        } catch (e) {
            console.error("Gagal sinkronisasi internal detik:", e);
        }

        // 2. Hitung Sisa Detik Personal Masing-Masing User (Hijau/Oranye)
        usersArray.forEach((user) => {
            const userIndex = usersArray.indexOf(user);
            const purpose = purposesArray[userIndex] || "Keperluan Umum";
            const firebaseStartTime = rawFirebaseSnapshot[`Start_User_${user}`] || now;

            let batasWajarMenit = 40;
            if (purpose === 'Mandi & Buang Air') {
                const dataUserAI = snapshotDataAI[user];
                batasWajarMenit = (dataUserAI && dataUserAI.batas_timer_ai) ? dataUserAI.batas_timer_ai : 6;
            } else if (purpose === 'Mesin Cuci') {
                batasWajarMenit = rawFirebaseSnapshot.Durasi_Mesin_Cuci_Kustom || 60;
            } else if (purpose === 'Cuci Piring') {
                batasWajarMenit = 25;
            }

            const batasWajarMs = batasWajarMenit * 60000;
            const waktuBerjalanMs = now - firebaseStartTime;
            const sisaWajarMs = batasWajarMs - waktuBerjalanMs;

            let formatUser = "00:00";
            let warnaUser = "#2ecc71"; // Hijau stabil

            if (sisaWajarMs > 0) {
                const totalSecUser = Math.floor(sisaWajarMs / 1000);
                const minUser = Math.floor(totalSecUser / 60);
                const secUser = Math.floor(totalSecUser % 60);
                formatUser = `${minUser.toString().padStart(2, '0')}:${secUser.toString().padStart(2, '0')}`;
            } else {
                warnaUser = "#e67e22"; // Berubah oranye peringatan

                if (!window[`alertTerpanggil_${user}`]) {
                    window[`alertTerpanggil_${user}`] = true;
                    alert(`⚠️ NOTIFIKASI AMAN:\nHalo ${user.toUpperCase()}!\nWaktu wajar penggunaan air untuk [${purpose}] telah habis (${batasWajarMenit} menit).\nPompa tetap menyala untuk toleransi aktivitas, mohon checkout jika sudah selesai.`);
                }
            }

            htmlDinamis += `<div style="color: ${warnaUser}; font-weight: 700; font-family: monospace; font-size: 15px;">${user} : ${formatUser}</div>`;
        });

        // 3. Cetak Baris Pengunci Timer Kritis Pompa (Merah) di Bagian Bawah Kelompok
        htmlDinamis += `
            <div style="color: #e74c3c; font-weight: 700; font-size: 14px; margin-top: 8px; border-top: 1px dashed rgba(0,0,0,0.1); padding-top: 6px;">
                TIMER POMPA : ${formatPompa}
            </div>
        `;
        htmlDinamis += `</div>`;

        // Tembakkan total teks HTML terintegrasi ke elemen bawaah tombol bulat
        timerDisplay.innerHTML = htmlDinamis;

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

function jalankanPengawasAIPersonal() {
    pemicuNotifTerpanggil = false;
    clearInterval(intervalPengawasAI);

    const aiUserRef = ref(database, `AquaSync/Users_AI/${loggedInUserEmail}`);
    
    onValue(aiUserRef, (aiSnapshot) => {
        const dataAI = aiSnapshot.val();
        if (!dataAI) return;

        const batasTimerAi = dataAI.batas_timer_ai || 20;
        const thresholdMatiPaksa = dataAI.threshold_mati_paksa || 30;

        intervalPengawasAI = setInterval(() => {
            if (currentPumpState === 0) {
                clearInterval(intervalPengawasAI);
                return;
            }

            const now = Date.now();
            const firebaseStartTime = rawFirebaseSnapshot[`Start_User_${loggedInUserEmail}`] || now;
            const selisihMenit = Math.floor((now - firebaseStartTime) / 60000);

            if (selisihMenit >= batasTimerAi && selisihMenit < thresholdMatiPaksa && !pemicuNotifTerpanggil) {
                pemicuNotifTerpanggil = true;
                if (Notification.permission === "granted") {
                    new Notification("⚠️ Peringatan AquaSync", `Halo ${loggedInUserEmail}, penggunaan air melewati batas wajar Anda (${batasTimerAi} menit).`);
                } else {
                    alert(`⚠️ HALO ${loggedInUserEmail.toUpperCase()}! Pemakaian air sudah lewat batas wajar Anda (${batasTimerAi} Menit). Mohon matikan jika sudah selesai.`);
                }
            }

            if (selisihMenit >= thresholdMatiPaksa) {
                clearInterval(intervalPengawasAI);
                alert("🚨 SYSTEM SHUTDOWN: Pompa dimatikan otomatis oleh sistem karena terdeteksi kelalaian.");
                
                localLockBypass = true;
                update(ref(database), { 'AquaSync/Control/Button_condition': false })
                    .then(() => { startHandshakeMatiTimeout(); });
            }
        }, 5000); 

    }, { onlyOnce: true }); 
}

window.bukaSubMenuMesinCuci = function() {
    document.getElementById('mainPurposeMenu').style.display = 'none';
    document.getElementById('subCpuMenu').style.display = 'flex';
    document.getElementById('modalTitle').innerText = "🧺 Pengaturan Mesin Cuci:";
    document.getElementById('modalDesc').innerText = "Masukkan estimasi waktu operasional mesin cuci Anda.";
}

window.kembaliKeMenuUtama = function() {
    document.getElementById('mainPurposeMenu').style.display = 'flex';
    document.getElementById('subCpuMenu').style.display = 'none';
    document.getElementById('modalTitle').innerText = "Keperluan Penggunaan Air:";
    document.getElementById('modalDesc').innerText = "Silakan pilih aktivitas untuk menggunakan air:";
}

window.submitMesinCuciCustom = function() {
    const inputMenit = document.getElementById('customMesinCuciTime').value;
    const durasiMenit = parseInt(inputMenit) || 60; 
    window.submitWaterPurpose('Mesin Cuci', durasiMenit);
}

const fungsiCloseModalAsli = window.closeModal;
window.closeModal = function() {
    if (fungsiCloseModalAsli) fungsiCloseModalAsli();
    window.kembaliKeMenuUtama();
}

window.submitMesinCuciFix = function() {
    const inputMenit = document.getElementById('customMesinCuciTime').value;
    const durationMinutes = parseInt(inputMenit) || 60; 

    document.getElementById('purposeModal').style.display = 'none';

    const now = Date.now();
    let newTimeoutTimestamp = 0;
    let finalUsers = loggedInUserEmail;
    let finalPurposes = 'Mesin Cuci';

    const updates = {};
    updates[`AquaSync/Realtime_Status/Start_User_${loggedInUserEmail}`] = now;
    updates['AquaSync/Realtime_Status/Durasi_Mesin_Cuci_Kustom'] = durationMinutes;

    if (currentPumpState === 1 && globalPumpTimeout > now) {
        if (!currentActiveUsers.includes(loggedInUserEmail)) { finalUsers = `${currentActiveUsers} + ${loggedInUserEmail}`; }
        else { finalUsers = currentActiveUsers; }

        if (!currentWaterPurposes.includes('Mesin Cuci')) { finalPurposes = `${currentWaterPurposes} + Mesin Cuci`; }
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

    document.getElementById('mainPurposeMenu').style.display = 'flex';
    document.getElementById('subCpuMenu').style.display = 'none';
    document.getElementById('modalTitle').innerText = "Keperluan Penggunaan Air:";
    document.getElementById('modalDesc').innerText = "Silakan pilih aktivitas Anda untuk validasi data otomatis skripsi.";
}