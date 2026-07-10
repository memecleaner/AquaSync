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

        # Ambil parameter adaptif user
        rata_rata_historis = user_data.get("rata_rata_historis", 10)
        durasi_aktual_terakhir = user_data.get("durasi_aktual_terakhir", 10)
        
        # Algoritma Adaptive Exponential Smoothing (AES)
        # alpha dinamis mendeteksi lonjakan durasi secara preventif
        selisih = abs(durasi_aktual_terakhir - rata_rata_historis)
        alpha = 0.6 if selisih > 5 else 0.3
        
        # Perhitungan nilai rata-rata baru
        rata_rata_baru = round((alpha * durasi_aktual_terakhir) + ((1 - alpha) * rata_rata_historis))
        
        # Tentukan threshold mati paksa (Safety Buffer)
        threshold_mati_paksa = rata_rata_baru + 5
        if threshold_mati_paksa > 20: 
            threshold_mati_paksa = 20
        elif threshold_mati_paksa < 5:
            threshold_mati_paksa = 5
            
        # Tentukan status efisiensi konsumsi air
        status_konsumsi = "Optimal"
        if durasi_aktual_terakhir > threshold_mati_paksa:
            status_konsumsi = "Boros (Terinterupsi AI)"
        elif durasi_aktual_terakhir < rata_rata_baru:
            status_konsumsi = "Sangat Efisien"
            
        # Update kembali data cerdas ke Firebase per user
        user_child.update({
            "rata_rata_historis": rata_rata_baru,
            "threshold_mati_paksa": threshold_mati_paksa,
            "status_konsumsi": status_konsumsi,
            "batas_timer_ai": rata_rata_baru
        })
        
        print(f"[AI UPDATE] {user_id} -> Rata-rata baru: {rata_rata_baru} mnt, Batas Maks: {threshold_mati_paksa} mnt. Status: {status_konsumsi}")
        
    except Exception as e:
        print(f"[AI ERROR] Gagal memproses data user {user_id}: {e}")


# ==========================================
# 3. FUNGSI UTAMA: PREDIKSI TAGIHAN MINGGUAN (AI)
# ==========================================
def update_weekly_bill_prediction_ai():
    try:
        hari_child = db.child("AquaSync").child("Energy_Usage")
        hari_data = hari_child.get().val()
        
        if not hari_data:
            return
            
        hari_berjalan = hari_data.get("hari_berjalan", 1)
        kwh_sekarang = hari_data.get("Energy", 0.0)
        
        # Mengambil parameter pembanding dari kluster historis alat
        prediction_child = db.child("AquaSync").child("Prediction")
        pred_data = prediction_child.get().val() or {}
        
        tarif_historis_minggu_lalu = pred_data.get("tarif_historis_minggu_rata", 15000)
        
        # 1. KALKULASI TAGIHAN RIIL SAAT INI (ACTUAL BILL)
        # Menghitung nominal rupiah riil berjalan berdasarkan akumulasi kwh dari ESP32
        actual_bill_riil = round(kwh_sekarang * TARIF_PER_KWH)
        db.child("AquaSync").child("Realtime_Status").update({
            "Actual_Bill": actual_bill_riil
        })
        
        # 2. ALGORITMA PERAMALAN (SHORT-TERM LOAD FORECASTING - STLF)
        # Proyeksi linier laju pemakaian energi harian menuju hari ke-7
        proyeksi_laju_rupiah = (actual_bill_riil / hari_berjalan) * 7 if hari_berjalan > 0 else 0
        
        # Penghalusan adaptif (ARES) mencegah fluktuasi akibat Join Sesi
        selisih_proyeksi = abs(proyeksi_laju_rupiah - tarif_historis_minggu_lalu)
        alpha_stlf = 0.5 if selisih_proyeksi > 10000 else 0.2
        
        prediksi_akhir_minggu = (alpha_stlf * proyeksi_laju_rupiah) + ((1 - alpha_stlf) * tarif_historis_minggu_lalu)
        
        # Update hasil ramalan finansial ke dashboard (Variabel Monthly_Bill di Firebase)
        prediction_child.update({
            "Monthly_Bill": round(prediksi_akhir_minggu)
        })
        
        # 3. SISTEM BACKUP OTOMATIS PADA SIKLUS HARI KE-7
        if hari_berjalan >= 7:
            print("\n[BACKUP] Sudah mencapai akhir minggu (Hari ke-7). Menyimpan data ke History...")
            
            db.child("AquaSync").child("History_Mingguan").push({
                "Tanggal_Backup": f"Siklus Hari ke-{hari_berjalan}",
                "Timestamp": int(time.time() * 1000),
                "Total_Energy": kwh_sekarang,
                "Total_Bill": round(prediksi_akhir_minggu)
            })
            
            # AMAN: Hanya mereset siklus hari berjalan AI, membiarkan nilai Energy dikelola alami oleh ESP32
            hari_child.update({
                "hari_berjalan": 1
            })
            
            # Perbarui acuan historis mingguan dengan hasil riil minggu ini
            prediction_child.update({
                "tarif_historis_minggu_rata": round(prediksi_akhir_minggu)
            })
            print("[BACKUP] Siklus di-reset ke Hari 1. Data kelistrikan riil tetap dipertahankan.")
            
    except Exception as e:
        print(f"[STLF ERROR] Gagal memproses peramalan beban listrik: {e}")


# ==========================================
# 4. LOOP KONTROL UTAMA (ALWAYS-ON SYSTEM)
# ==========================================
if __name__ == "__main__":
    while True:
        try:
            # Mengambil log aktivitas untuk mendeteksi trigger aktivitas pengguna
            log_aktivitas = db.child("AquaSync").child("Log_Aktivitas").get().val()
            
            if log_aktivitas:
                timestamp_mati_saat_ini = log_aktivitas.get("Timestamp_Mati", 0)
                user_terakhir = log_aktivitas.get("User_Terakhir", "-")
                aktivitas_terakhir = log_aktivitas.get("Aktivitas_Terakhir", "-")

                # KUNCI UTAMA: AI hanya menghitung jika terdeteksi timestamp baru & aktivitasnya adalah Mandi!
                if timestamp_mati_saat_ini > last_processed_timestamp:
                    if aktivitas_terakhir == "Mandi & Buang Air":
                        print(f"\n[TRIGGER] Mendeteksi sesi mandi baru dari {user_terakhir}. Memulai kalkulasi AI...")
                        update_user_timer_ai(user_terakhir)
                        
                    last_processed_timestamp = timestamp_mati_saat_ini
            
            # Jalankan kalkulasi tagihan berjalan dan peramalan STLF
            update_weekly_bill_prediction_ai()
            
            print("[STATUS] Agen AI stand-by mengawasi antrean aktivitas...")
            print("-" * 50)
            time.sleep(10)  # Jeda pengecekan berkala (10 detik)
            
        except Exception as e:
            print(f"[SYSTEM CRASH] Mengalami masalah: {e}")
            time.sleep(5)