import time
import pyrebase

# Konfigurasi Firebase
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
last_processed_timestamp = 0
pump_was_on = False
pump_start_time = 0
riil_duration_cache = 1

print("[SYSTEM] Agen AI V3 - Full Integration Dijalankan...")

# 1. FUNGSI AI TIMER & TRACKER HARIAN
def update_user_timer_ai(user_id, durasi_final, kategori):
    try:
        hari_berjalan = db.child("AquaSync/Energy_Usage/hari_berjalan").get().val() or 1
        kategori_bersih = kategori.replace("/", "-").strip()
        
        # 🔥 STRUKTUR BARU: Pisahkan kategori per user per hari
        # Path: Daily_Behavior / day_X / Users / User_ID / Kategori / menit
        path_detail = f"AquaSync/Daily_Behavior/day_{hari_berjalan}/Users/{user_id}/Purposes/{kategori_bersih}"
        
        # Tambahkan durasi ke path spesifik tersebut
        db.child(path_detail).set((db.child(path_detail).get().val() or 0) + durasi_final)
        
        # --- (Sisanya adalah logika AI untuk timer yang tetap sama) ---
        user_path = f"AquaSync/Users_AI/{user_id}"
        u_data = db.child(user_path).get().val() or {}
        hist = u_data.get('rata_rata_historis', durasi_final)
        
        alfa = 0.8 if durasi_final > (1.5 * hist) else 0.3
        prediksi = round((alfa * durasi_final) + ((1 - alfa) * hist), 2)
        
        db.child(user_path).update({
            'rata_rata_historis': prediksi,
            'durasi_aktual_terakhir': durasi_final,
            'batas_timer_ai': round(prediksi + 5)
        })
        print(f"[TRACKER DETAIL] {user_id} - {kategori}: {durasi_final} menit tercatat.")
    except Exception as e: print(f"[ERROR TRACKER] {e}")

# 2. LOOP UTAMA (STOPWATCH + INTERCEPTOR)
if __name__ == "__main__":
    while True:
        try:
            # Stopwatch Python
            is_pump_on = db.child("AquaSync/Control/Button_condition").get().val()
            if is_pump_on and not pump_was_on:
                pump_start_time = time.time(); pump_was_on = True
            elif not is_pump_on and pump_was_on:
                pump_was_on = False
                riil_duration_cache = max(1, round((time.time() - pump_start_time) / 60))

            # Intercept Data Alat
            log = db.child("AquaSync/Log_Aktivitas").get().val() or {}
            if log.get("Timestamp_Mati", 0) > last_processed_timestamp:
                user = log.get("User_Terakhir", "-").strip()
                kategori = log.get("Aktivitas_Terakhir", "-")
                durasi_alat = log.get("Durasi_Asli_Menit", 1)
                
                # Koreksi Bug 1 Menit
                final_dur = riil_duration_cache if (durasi_alat <= 1 and riil_duration_cache > 1) else max(durasi_alat, riil_duration_cache)
                
                update_user_timer_ai(user, final_dur, kategori)
                last_processed_timestamp = log["Timestamp_Mati"]

            time.sleep(10)
        except Exception as e: print(f"[CRASH] {e}"); time.sleep(10)