# import pyrebase
# import pandas as pd
# import os
# import time
# from datetime import datetime

# # 1. KONFIGURASI FIREBASE CLOUD (Wajib sinkron dengan JavaScript)
# config = {
#     "apiKey": "AIzaSyC9PuXQiQ2zCKfCMG3KTYoiU_kldIZmNxE",
#     "authDomain": "aquasync-dda8c.firebaseapp.com",
#     "databaseURL": "https://aquasync-dda8c-default-rtdb.asia-southeast1.firebasedatabase.app",
#     "projectId": "aquasync-dda8c",
#     "storageBucket": "aquasync-dda8c.firebasestorage.app",
#     "messagingSenderId": "332004178563"
# }

# firebase = pyrebase.initialize_app(config)
# db = firebase.database()

# FILE_DATASET = "dataset_usage.csv"
# TARIF_PER_KWH = 1444.70 # Tarif Resmi PLN
# DAYA_POMPA_WATT = 250   # Spesifikasi daya pompa Shimizu

# def inisialisasi_dataset():
#     if not os.path.exists(FILE_DATASET):
#         df = pd.DataFrame(columns=["Timestamp", "User", "Aktivitas", "Durasi_Menit", "Estimasi_kWh", "Biaya_Rupiah"])
#         df.to_csv(FILE_DATASET, index=False)
#         print(f"[INFO] File {FILE_DATASET} berhasil diinisialisasi.")

# # =================================================================
# # INTI LOGIKA UTAMA: MACHINE LEARNING POLA PERILAKU PENGGUNA
# # =================================================================
# def pelajari_pola_dan_prediksi_total():
#     try:
#         df = pd.read_csv(FILE_DATASET)
        
#         # Pengaman: Jika data log transaksi awal masih di bawah 3 baris, pasang baseline minimal dulu
#         if len(df) < 3:
#             db.child("AquaSync").child("Prediction").update({"Monthly_Bill": 45000})
#             return

#         # Ambil rentang waktu total data yang sudah terkumpul dalam satuan hari
#         df['Waktu_Riil'] = pd.to_datetime(df['Timestamp'], unit='s')
#         total_hari_eksperimen = max(1, (df['Waktu_Riil'].max() - df['Waktu_Riil'].min()).days + 1)

#         # 1. PROFILE LEARNING STAGE: Python mengelompokkan data per USER dan AKTIVITAS
#         # Menghitung total durasi menit pemakaian air dan frekuensi klik dari masing-masing kombinasi
#         pola_group = df.groupby(['User', 'Aktivitas']).agg(
#             Total_Menit=('Durasi_Menit', 'sum'),
#             Total_Klik=('Durasi_Menit', 'count')
#         ).reset_index()

#         total_estimasi_sebulan_rupiah = 0

#         # 2. PROYEKSI BOBOT STAGE: Hitung proyeksi tagihan 30 hari berdasarkan rutinitas
#         for index, row in pola_group.iterrows():
#             # Hitung rata-rata durasi asli per satu kali aktivitas (misal: Audrey sekali mandi ternyata rata-rata 15 menit)
#             rata_durasi_per_klik = row['Total_Menit'] / row['Total_Klik']
            
#             # Hitung frekuensi kemunculan aktivitas tersebut per hari selama masa eksperimen alat IoT
#             frekuensi_per_hari = row['Total_Klik'] / total_hari_eksperimen
            
#             # Proyeksikan berapa kali aktivitas ini akan terjadi dalam waktu 1 bulan penuh (30 hari)
#             estimasi_klik_sebulan = frekuensi_per_hari * 30
            
#             # Total estimasi menit yang dihabiskan oleh kombinasi ini selama sebulan kedepan
#             proyeksi_menit_sebulan = estimasi_klik_sebulan * rata_durasi_per_klik
            
#             # Konversi menit ke satuan kWh listrik dan dikalikan tarif PLN rupiah
#             proyeksi_kwh = (DAYA_POMPA_WATT * (proyeksi_menit_sebulan / 60)) / 1000
#             proyeksi_rupiah = proyeksi_kwh * TARIF_PER_KWH
            
#             # Akumulasikan seluruh bobot user ke dalam keranjang total pengeluaran
#             total_estimasi_sebulan_rupiah += proyeksi_rupiah

#         # Batasi batas pengaman pengeluaran terendah (misal abonemen minimal Rp 15.000)
#         final_prediction = max(15000, int(total_estimasi_sebulan_rupiah))

#         # 3. OVERWRITE STAGE: Kirim hasil ramalan berbasis pola user ini ke Firebase cloud
#         db.child("AquaSync").child("Prediction").update({"Monthly_Bill": final_prediction})
#         print(f"[AI MODEL UPDATED] Sukses mempelajari pola user. Prediksi Baru: Rp {final_prediction} (Akurasi Adaptif)")

#     except Exception as e:
#         print(f"[AI ERROR] Gagal mengekstrak pola perilaku user: {e}")

# def stream_handler(message):
#     if message["event"] in ["put", "patch"]:
#         path = message["path"]
#         data = message["data"]
        
#         if path == "/" and data is not None:
#             try:
#                 user = data.get("User_Terakhir", "-")
#                 aktivitas = data.get("Aktivitas_Terakhir", "-")
#                 durasi = data.get("Durasi_Asli_Menit", 0)

#                 if user != "-" and durasi > 0:
#                     print(f"\n[EVENT LOG DETECTED] {user} check-out {aktivitas} -> Durasi asli: {durasi} Menit.")
                    
#                     estimasi_kwh = round((DAYA_POMPA_WATT * (durasi / 60)) / 1000, 4)
#                     biaya_riil = round(estimasi_kwh * TARIF_PER_KWH, 2)

#                     new_row = {
#                         "Timestamp": time.time(),
#                         "User": user,
#                         "Aktivitas": aktivitas,
#                         "Durasi_Menit": durasi,
#                         "Estimasi_kWh": estimasi_kwh,
#                         "Biaya_Rupiah": biaya_riil
#                     }
                    
#                     df = pd.read_csv(FILE_DATASET)
#                     df = pd.concat([df, pd.DataFrame([new_row])], ignore_index=True)
#                     df.to_csv(FILE_DATASET, index=False)
#                     print(f"[DATA ARCS] Log berhasil dikunci permanen ke {FILE_DATASET}")

#                     # Panggil mesin kalkulator AI pola untuk memproses ulang data CSV ter-update
#                     pelajari_pola_dan_prediksi_total()

#             except Exception as e:
#                 print(f"[STREAM ERROR] Gagal menyedot data: {e}")

# if __name__ == "__main__":
#     inisialisasi_dataset()
#     print("[RUNNING SERVER AI] Agen AquaSync Behavioral AI sedang mengawasi Firebase... (Ctrl+C untuk stop)")
#     my_stream = db.child("AquaSync").child("Log_Aktivitas").stream(stream_handler)
    
#     while True:
#         time.sleep(1)