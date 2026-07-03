import time
import pyrebase

# ==========================================
# 1. KONFIGURASI AWAL & KONEKSI PYREBASE
# ==========================================
config = {
    "apiKey": "AIzaSyC9PuXQiQ2zCKfCMG3KTYoiU_kldIZmNxE",
    "authDomain": "aquasync-dda8c.firebaseapp.com",
    "databaseURL": "https://aquasync-dda8c-default-rtdb.asia-southeast1.firebasedatabase.app",
    "projectId": "aquasync-dda8c",
    "storageBucket": "aquasync-dda8c.firebasestorage.app",
    "messagingSenderId": "332004178563"
}

firebase = pyrebase.initialize_app(config)
db = firebase.database()

TARIF_PER_KWH = 1444.70
last_processed_timestamp = 0  # Tracker pengunci loop perhitungan berulang

print("[SYSTEM] Agen AI AquaSync Berhasil Dijalankan...")


# ==========================================
# 2. FUNGSI UTAMA: KONTROL TIMER (BERDASARKAN USER)
# ==========================================
def update_user_timer_ai(user_id):
    """
    Menghitung batas timer pompa berdasarkan perilaku durasi mandi pengguna.
    """
    try:
        user_child = db.child("AquaSync").child("Users_AI").child(user_id)
        user_data = user_child.get().val()
        
        if not user_data:
            return

        durasi_aktual = user_data.get('durasi_aktual_terakhir', 0)
        rata_rata_historis = user_data.get('rata_rata_historis', 0)
        
        # Cold Start Handling
        if rata_rata_historis == 0:
            rata_rata_historis = durasi_aktual

        # Rule-Based Adaptive Alpha Switching
        threshold_lonjakan = 1.5 * rata_rata_historis
        if durasi_aktual > threshold_lonjakan:
            alfa = 0.8
            status = "Boros"
        else:
            alfa = 0.3
            status = "Optimal"

        # Rumus Peramalan Adaptive Exponential Smoothing
        prediksi_durasi_ideal = (alfa * durasi_aktual) + ((1 - alfa) * rata_rata_historis)

        # Penentuan Batas Timer + Safety Buffer 5 Menit
        batas_timer_baru = round(prediksi_durasi_ideal + 5)
        
        # Threshold Mati Paksa Relatif (+10 Menit dari Timer AI)
        threshold_mati_paksa_baru = batas_timer_baru + 10

        # Push update parameter hasil kalkulasi terbaru ke Firebase
        user_child.update({
            'rata_rata_historis': prediksi_durasi_ideal,
            'batas_timer_ai': batas_timer_baru,
            'threshold_mati_paksa': threshold_mati_paksa_baru,
            'status_konsumsi': status
        })
        print(f"[AI TIMER] {user_id} | Kalkulasi Sukses! | Timer Baru: {batas_timer_baru}m | Force Stop: {threshold_mati_paksa_baru}m | Status: {status}")
    
    except Exception as e:
        print(f"[ERROR TIMER] Gagal memproses {user_id}: {e}")


# ==========================================
# 3. FUNGSI PENDUKUNG: PREDIKSI TARIF MINGGUAN (PZEM)
# ==========================================
def update_weekly_bill_prediction_ai():
    """
    Menghitung prediksi tagihan listrik MINGGUAN (Rupiah) sesuai siklus dashboard web.
    Siklus data direset penuh setiap hari Minggu pukul 23:59 WIB.
    """
    try:
        pzem_child = db.child("AquaSync").child("Energy_Usage")
        data_pzem = pzem_child.get().val()
        
        if not data_pzem:
            return

        # Ambil total kWh akumulatif minggu berjalan dari sensor hardware
        kwh_sekarang = data_pzem.get('Energy', 0)
        
        # Mengambil data pembanding historis pengeluaran minggu lalu (default Rp 15.000 jika kosong)
        tarif_historis_minggu_lalu = data_pzem.get('tarif_historis_minggu_rata', 15000)
        
        # Hari berjalan dalam satu minggu (1 s/d 7)
        hari_berjalan = data_pzem.get('hari_berjalan', 1)
        if hari_berjalan < 1: 
            hari_berjalan = 1

        # 1. Hitung pengeluaran riil aktual saat ini dalam Rupiah
        rupiah_aktual_saat_ini = kwh_sekarang * TARIF_PER_KWH

        # 2. Proyeksi Linier Kasar: memperkirakan total akhir di hari ke-7 (akhir minggu)
        proyeksi_kasar_akhir_minggu = (rupiah_aktual_saat_ini / hari_berjalan) * 7
        
        # 3. Logika Switching Parameter Alfa Finansial (Threshold Lonjakan 1.5x)
        if proyeksi_kasar_akhir_minggu > (1.5 * tarif_historis_minggu_lalu):
            alfa_tarif = 0.8  # Sangat responsif jika terdeteksi pemborosan ekstrem di minggu ini
        else:
            alfa_tarif = 0.3  # Stabil mengikuti tren pengeluaran biasanya

        # 4. Rumus Peramalan Adaptive Exponential Smoothing Finansial
        prediksi_laju_rupiah = (alfa_tarif * proyeksi_kasar_akhir_minggu) + ((1 - alfa_tarif) * tarif_historis_minggu_lalu)

        # 5. SINKRONISASI MUTLAK: Tembak ke path 'AquaSync/Prediction/Monthly_Bill'
        # Catatan: Variabel di Firebase kamu bernama 'Monthly_Bill', tapi fungsinya menampilkan data MINGGUAN di web.
        db.child("AquaSync").child("Prediction").update({
            'Monthly_Bill': round(prediksi_laju_rupiah)
        })
        print(f"[AI FINANSIAL] Hari ke-{hari_berjalan} | Aktual: Rp {round(rupiah_aktual_saat_ini)} | Prediksi Akhir Minggu: Rp {round(prediksi_laju_rupiah)}")

    except Exception as e:
        print(f"[ERROR FINANSIAL] Gagal memproses data PZEM: {e}")


# ==========================================
# 4. LOOPING UTAMA DENGAN SISTEM TRIGGER INTERSEPSI
# ==========================================
if __name__ == "__main__":
    while True:
        try:
            # Baca log aktivitas terakhir untuk mendeteksi apakah ada user yang baru selesai mandi
            log_aktivitas = db.child("AquaSync").child("Log_Aktivitas").get().val()
            
            if log_aktivitas:
                timestamp_mati_saat_ini = log_aktivitas.get("Timestamp_Mati", 0)
                user_terakhir = log_aktivitas.get("User_Terakhir", "-")
                aktivitas_terakhir = log_aktivitas.get("Aktivitas_Terakhir", "-")

                # KUNCI UTAMA: AI hanya menghitung jika terdeteksi timestamp baru & aktivitasnya adalah Mandi!
                if timestamp_mati_saat_ini > last_processed_timestamp:
                    if aktivitas_terakhir == "Mandi & Buang Air":
                        print(f"\n[TRIGGER] Mendeteksi sesi mandi baru dari {user_terakhir}. Memulai kalkulasi AI...")
                        
                        # Jalankan pembaruan algoritma hanya untuk user yang baru selesai mandi
                        update_user_timer_ai(user_terakhir)
                        
                    # Update tracker agar sesi ini tidak dihitung ulang pada loop berikutnya
                    last_processed_timestamp = timestamp_mati_saat_ini
            
            # FIX: Nama fungsi pemanggil di bawah ini sudah diperbaiki dan disinkronkan secara benar!
            update_weekly_bill_prediction_ai()
            
            print("[STATUS] Agen AI stand-by mengawasi antrean aktivitas...")
            print("-" * 50)
            time.sleep(10) # Jeda pengecekan berkala (10 detik)
            
        except Exception as e:
            print(f"[SYSTEM CRASH] Mengalami masalah: {e}")
            time.sleep(5)