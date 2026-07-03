// ==========================================
// KONTROL PENDUKUNG: MONITORING ENERGI & TARIF
// ==========================================

// Listen khusus data monitoring PZEM dan Estimasi Tarif dari Python AI
db.ref("monitoring_pzem").on('value', (snapshot) => {
    const dataPzem = snapshot.val();
    if (!dataPzem) return;

    const kwhTotal = dataPzem.get('kwh_total', 0);
    const estimasiTarifAI = dataPzem.get('estimasi_tarif_pendukung', 0);

    // Tampilkan angka ke komponen teks/grafik di halaman statistik HTML kamu
    document.getElementById("display-kwh").innerText = `${kwhTotal} kWh`;
    document.getElementById("display-tarif-ai").innerText = `Rp ${estimasiTarifAI.toLocaleString('id-ID')}`;
    
    console.log(`[STATS] Data terupdate. Estimasi Tagihan Akhir Bulan: Rp ${estimasiTarifAI}`);
});