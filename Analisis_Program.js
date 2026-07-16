//tabel 1 

function jalankanPengawasAIPersonal() {
    clearInterval(intervalPengawasAI);
    const aiUserRef = ref(database, `AquaSync/Users_AI/${loggedInUserEmail}`);
    
    onValue(aiUserRef, (aiSnapshot) => {
        const dataAI = aiSnapshot.val();
        if (!dataAI) return;

        intervalPengawasAI = setInterval(() => {
            if (currentPumpState === 0) { clearInterval(intervalPengawasAI); return; }

            const firebaseStartTime = rawFirebaseSnapshot[`Start_User_${loggedInUserEmail}`] || Date.now();
            const selisihMenit = Math.floor((Date.now() - firebaseStartTime) / 60000);

            // 1. Pemicu Notifikasi Peringatan Awal
            if (selisihMenit >= dataAI.batas_timer_ai && !pemicuNotifTerpanggil) {
                pemicuNotifTerpanggil = true;
                alert(`⚠️ Batas wajar ${dataAI.batas_timer_ai} menit terlampaui!`);
            }

            // 2. Pemicu Shutdown Pompa Otomatis (Mati Paksa)
            if (selisihMenit >= dataAI.threshold_mati_paksa) {
                clearInterval(intervalPengawasAI);
                alert("🚨 SYSTEM SHUTDOWN: Kelalaian terdeteksi.");
                update(ref(database), { 'AquaSync/Control/Button_condition': false });
            }
        }, 5000);
    }, { onlyOnce: true });
}


//tabel 2

window.checkoutUserSession = async function() {
    document.getElementById('sessionModal').style.display = 'none';
    const usersArray = currentActiveUsers.split(' + ');
    const purposesArray = currentWaterPurposes.split(' + ');
    const userIndex = usersArray.indexOf(loggedInUserEmail);

    if (userIndex !== -1) {
        const submitWaterPurpose = purposesArray[userIndex];
        const firebaseStartTime = rawFirebaseSnapshot[`Start_User_${loggedInUserEmail}`];
        const durationMinutes = firebaseStartTime ? Math.ceil((Date.now() - firebaseStartTime) / 60000) : 1;

        // 1. Dorong data aktivitas unik ke antrean antetap (Log Queue) agar tidak tumpang tindih
        const logQueueKey = push(ref(database, 'AquaSync/Log_Queue')).key;
        let updates = {
            [`AquaSync/Log_Queue/${logQueueKey}`]: { User_Terakhir: loggedInUserEmail, Aktivitas_Terakhir: submitWaterPurpose, Durasi_Asli_Menit: durationMinutes, Timestamp_Mati: Date.now() },
            [`AquaSync/Stats_Summary/Users/${sanitizeFirebaseKey(loggedInUserEmail)}`]: (statsSummaryCache?.Users?.[sanitizeFirebaseKey(loggedInUserEmail)] || 0) + durationMinutes,
            [`AquaSync/Realtime_Status/Start_User_${loggedInUserEmail}`]: null
        };
        await update(ref(database), updates);

        // 2. Perbarui sisa user yang aktif atau matikan pompa jika antrean kosong
        usersArray.splice(userIndex, 1); purposesArray.splice(userIndex, 1);
        if (usersArray.length > 0) {
            update(ref(database), { 'AquaSync/Realtime_Status/Active_User': usersArray.join(' + '), 'AquaSync/Realtime_Status/Water_Purpose': purposesArray.join(' + ') });
        } else {
            update(ref(database), { 'AquaSync/Control/Button_condition': false }).then(() => { startHandshakeMatiTimeout(); });
        }
    }
};


//tabel 3

window.submitMesinCuciFix = function() {
    const inputMenit = document.getElementById('customMesinCuciTime').value;
    const durationMinutes = parseInt(inputMenit) || 60; // Fallback 60 menit jika input kosong
    const now = Date.now();
    const updates = {};

    updates[`AquaSync/Realtime_Status/Start_User_${loggedInUserEmail}`] = now;
    updates['AquaSync/Realtime_Status/Durasi_Mesin_Cuci_Kustom'] = durationMinutes;

    // 1. Kondisi Multi-User: Pompa sedang menyala, gabungkan user & perbarui batas timeout terlama
    if (currentPumpState === 1 && globalPumpTimeout > now) {
        updates['AquaSync/Realtime_Status/Active_User'] = currentActiveUsers.includes(loggedInUserEmail) ? currentActiveUsers : `${currentActiveUsers} + ${loggedInUserEmail}`;
        updates['AquaSync/Realtime_Status/Water_Purpose'] = currentWaterPurposes.includes('Mesin Cuci') ? currentWaterPurposes : `${currentWaterPurposes} + Mesin Cuci`;
        updates['AquaSync/Realtime_Status/Pump_Timeout'] = durationMinutes > Math.floor((globalPumpTimeout - now) / 60000) ? now + (durationMinutes * 60000) : globalPumpTimeout;
        update(ref(database), updates);
    } 
    // 2. Kondisi Single-User: Pompa mati, nyalakan dari awal dengan timeout kustom
    else {
        update(ref(database), { 'AquaSync/Control/Button_condition': true }).then(() => {
            updates['AquaSync/Realtime_Status/Pump_Button'] = 1;
            updates['AquaSync/Realtime_Status/Active_User'] = loggedInUserEmail;
            updates['AquaSync/Realtime_Status/Water_Purpose'] = 'Mesin Cuci';
            updates['AquaSync/Realtime_Status/Pump_Timeout'] = now + (durationMinutes * 60000);
            return update(ref(database), updates);
        }).then(() => { startHandshakeTimeout(); });
    }
};