// ==========================================
// KONTROL UTAMA: POMPA, TIMER AI, & NOTIFIKASI
// ==========================================
let durasiMandiMenit = 0;
let intervalCounter = null;
let currentUserId = null;

// Eksekusi otomatis saat halaman dashboard dimuat
firebase.auth().onAuthStateChanged((user) => {
    if (user) {
        currentUserId = user.uid; // Mengambil ID User asli dari Firebase Auth
        inisialisasiDashboard(currentUserId);
    } else {
        window.location.href = "index.html";
    }
});

function inisialisasiDashboard(userId) {
    const statusPompaText = document.getElementById("status-pompa");
    const timerVisualText = document.getElementById("timer-visual");
    const boxStatusDashboard = document.getElementById("dashboard-card");

    // Listen data real-time dari Realtime Database
    db.ref(`users/${userId}`).on('value', (snapshot) => {
        const userData = snapshot.val();
        if (!userData) return;

        const statusPompa = userData.status_pompa;
        const batasTimerAi = userData.batas_timer_ai || 20;
        const thresholdMatiPaksa = userData.threshold_mati_paksa || 30;

        // Logika menyalakan atau mematikan timer visual di web
        if (statusPompa === true && intervalCounter === null) {
            statusPompaText.innerText = "STATUS POMPA: MENYALA";
            boxStatusDashboard.style.backgroundColor = "#e0f7fa"; // Biru Muda (Optimal)

            // Jalankan counter (Ubah 60000 jadi 1000 saat demo bimbingan agar cepat!)
            intervalCounter = setInterval(() => {
                durasiMandiMenit++;
                timerVisualText.innerText = `${durasiMandiMenit} Menit`;

                // TAHAP 1: PERSUASIF (Notifikasi Peringatan)
                if (durasiMandiMenit >= batasTimerAi && durasiMandiMenit < thresholdMatiPaksa) {
                    boxStatusDashboard.style.backgroundColor = "#ffe0b2"; // Oranye
                    kirimNotifikasiBrowser("⚠️ Peringatan Batas Wajar", `Pemakaian melewati batas wajar Anda (${batasTimerAi} menit).`);
                } 
                // TAHAP 2: PROTEKTIF (Mati Paksa / Lupa Matiin)
                else if (durasiMandiMenit >= thresholdMatiPaksa) {
                    boxStatusDashboard.style.backgroundColor = "#ffcdd2"; // Merah
                    kirimNotifikasiBrowser("🚨 FORCE SHUTDOWN", "Pompa dimatikan otomatis oleh sistem karena terdeteksi lupa.");
                    
                    // Matikan status pompa di Firebase agar hardware ikut mematikan relay
                    db.ref(`users/${userId}`).update({ status_pompa: false });
                    hentikanTimer(userId, true);
                }
            }, 60000);

        } else if (statusPompa === false && intervalCounter !== null) {
            statusPompaText.innerText = "STATUS POMPA: MATI";
            hentikanTimer(userId, false);
        }
    });
}

function hentikanTimer(userId, isForceShutdown) {
    clearInterval(intervalCounter);
    intervalCounter = null;
    
    // Kirim durasi akhir ke Python Backend (Saring anomali lupa jika force shutdown)
    const durasiFinal = isForceShutdown ? (durasiMandiMenit - 10) : durasiMandiMenit;
    db.ref(`users/${userId}`).update({
        durasi_aktual_terakhir: durasiFinal
    });
    durasiMandiMenit = 0;
}

function kirimNotifikasiBrowser(judul, pesan) {
    if (Notification.permission === "granted") {
        new Notification(judul, { body: pesan });
    } else {
        Notification.requestPermission();
    }
}