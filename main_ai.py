import pyrebase
import pandas as pd
import os
import time
from datetime import datetime

# 1. KONFIGURASI FIREBASE CLOUD
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

FILE_DATASET = "dataset_usage.csv"
TARIF_PER_KWH = 1444.70

def inisialisasi_dataset():
    if not os.path.exists(FILE_DATASET):
        df = pd.DataFrame(columns=["Timestamp", "Tanggal", "Total_kWh", "Total_Rupiah"])
        df.to_csv(FILE_DATASET, index=False)

# =================================================================
# FITUR 1: LOGGING REALTIME HARI (1-7) KETIKA ADA PEMAKAIAN
# =================================================================
def update_actual_usage(current_kwh):
    try:
        hari_ke = datetime.now().isoweekday() # 1 = Senin, 7 = Minggu
        hitung_rupiah_hari_ini = int(current_kwh * TARIF_PER_KWH)

        # Setiap kali alat nyala dan kWh berubah, ini langsung nembak ke Firebase!
        db.child("AquaSync").child("actual_usage").update({f"day_{hari_ke}": hitung_rupiah_hari_ini})
        print(f"[LOG] Actual Usage Day {hari_ke} terupdate: Rp {hitung_rupiah_hari_ini}")
    except Exception as e:
        print(f"[ERROR LOG ACTUAL]: {e}")

# =================================================================
# FITUR 2: AI MACHINE LEARNING SENSITIF LONJAKAN (ADAPTIVE WEIGHTING)
# =================================================================
def pelajari_pola_dan_prediksi_total(current_kwh=0):
    try:
        df = pd.read_csv(FILE_DATASET) if os.path.exists(FILE_DATASET) else pd.DataFrame()
        hitung_rupiah_hari_ini = int(current_kwh * TARIF_PER_KWH)

        if len(df) >= 2:
            rata_rata_historis = df['Total_Rupiah'].mean()
            biaya_terakhir = hitung_rupiah_hari_ini if hitung_rupiah_hari_ini > 0 else df['Total_Rupiah'].iloc[-1]

            # 🔥 LOGIKA SENSITIF LONJAKAN: Jika biaya melonjak lebih dari 1.5x rata-rata
            if biaya_terakhir > (1.5 * rata_rata_historis):
                # AI langsung membuang pola lama dan fokus 80% pada lonjakan terbaru
                prediksi_mingguan = (0.2 * rata_rata_historis) + (0.8 * biaya_terakhir)
            else:
                # Pola normal
                prediksi_mingguan = (0.7 * rata_rata_historis) + (0.3 * biaya_terakhir)
        else:
            prediksi_mingguan = hitung_rupiah_hari_ini * 1.2 if hitung_rupiah_hari_ini > 0 else 15000

        final_prediction = max(3000, int(prediksi_mingguan))
        db.child("AquaSync").child("Prediction").update({"Monthly_Bill": final_prediction})
        print(f"[AI PREDICTION] Prediksi beradaptasi: Rp {final_prediction}")

    except Exception as e:
        print(f"[AI ERROR]: {e}")

def sinkronisasi_dan_tarik_arsip():
    try:
        history_snapshot = db.child("AquaSync").child("History_Mingguan").get()
        if history_snapshot.val() is not None:
            rows = []
            for minggu in history_snapshot.each():
                val = minggu.val()
                if isinstance(val, dict):
                    rows.append({
                        "Timestamp": val.get("Timestamp", time.time()),
                        "Tanggal": val.get("Tanggal_Backup", "-"),
                        "Total_kWh": val.get("Total_Energy", 0),
                        "Total_Rupiah": val.get("Total_Bill", 0)
                    })
            if len(rows) > 0:
                pd.DataFrame(rows).to_csv(FILE_DATASET, index=False)
                pelajari_pola_dan_prediksi_total()
    except Exception as e:
        print(f"[SYNC ERROR]: {e}")

def stream_handler(message):
    path = message["path"]
    data = message["data"]

    # 💡 Pemicu 1: Update Realtime & AI saat alat mengirim data Energy
    if "Energy" in path or (isinstance(data, dict) and "Energy" in data):
        energi_saat_ini = data if "Energy" in path else data.get("Energy", 0)
        update_actual_usage(energi_saat_ini)
        pelajari_pola_dan_prediksi_total(energi_saat_ini)

    # 💡 Pemicu 2: Sinkronisasi arsip mingguan
    if path == "/" or "History_Mingguan" in path:
        sinkronisasi_dan_tarik_arsip()

if __name__ == "__main__":
    inisialisasi_dataset()
    sinkronisasi_dan_tarik_arsip()
    print("\n[AI SERVER] AquaSync Adaptive AI Running...")

    # Dengarkan seluruh perubahan di AquaSync agar lebih responsif
    my_stream = db.child("AquaSync").stream(stream_handler)
    while True:
        time.sleep(1)