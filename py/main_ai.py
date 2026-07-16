"""
AquaSync AI Agent - v12 (+ ringkasan Top User/Kategori siap-pakai buat frontend)

KENAPA DIUBAH JADI WEB APP (bukan while True lagi)?
PythonAnywhere Free TIDAK punya fitur "Always-on task" (khusus paid plan),
dan CPU quota-nya cuma 100 detik/hari untuk console/scheduled task.
TAPI web app di PythonAnywhere Free TIDAK kena limit CPU-seconds itu sama
sekali. Jadi solusinya: kode ini jadi endpoint HTTP (/tick) yang menjalankan
SATU siklus kerja tiap kali dipanggil, lalu kamu pancing dari luar pakai
layanan cron gratis (misal cron-job.org) tiap beberapa menit.

CARA DEPLOY DI PYTHONANYWHERE:
1. Upload file ini, misalnya ke /home/usernamekamu/aquasync/main_ai_v7.py
2. Tab "Web" -> Add a new web app -> pilih "Flask" -> pilih file ini sebagai source.
   (Atau kalau sudah ada web app, edit WSGI configuration file supaya:
      from main_ai_v7 import app as application
   )
3. Set SECRET_KEY di bawah ke string acak punyamu sendiri (jangan dibiarkan default).
4. Daftar gratis di cron-job.org (atau layanan sejenis), buat cron job yang
   nge-GET ke: https://usernamekamu.pythonanywhere.com/tick?key=SECRET_KEY_KAMU
   tiap 5 menit.
5. Selesai. Tidak perlu buka console/terminal manapun terus-menerus.
"""

import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import pyrebase
from flask import Flask, jsonify, request

# ============================================================
# Konfigurasi
# ============================================================
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

WIB = ZoneInfo("Asia/Jakarta")
TARIF_PER_KWH = 1444.70

# GANTI INI dengan string acak punyamu sendiri! Supaya orang lain tidak bisa
# memicu /tick sembarangan (walau dampaknya cuma bikin proses jalan lebih sering).
SECRET_KEY = "aquasync-skripsi"

LAST_WEEK_PATH = "AquaSync/System/Last_Archived_Week_Id"
BASELINE_PATH = "AquaSync/System/Baseline_Kwh_Minggu_Ini"
HARI_BERJALAN_PATH = "AquaSync/System/Hari_Berjalan"
INVALID_FIREBASE_CHARS = ['.', '#', '$', '[', ']', '/']
GAP_PERINGATAN_KE_PAKSA = 10

NAMA_BULAN_INDO = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli",
                    "Agustus", "September", "Oktober", "November", "Desember"]

app = Flask(__name__)


# ============================================================
# 0. UTILITAS
# ============================================================
def sanitize_key(raw, fallback="unknown"):
    if raw is None:
        return fallback
    s = str(raw).strip()
    if not s or s == "-":
        return fallback
    for ch in INVALID_FIREBASE_CHARS:
        s = s.replace(ch, "-")
    s = " ".join(s.split())
    s = s.strip("-").strip()
    return s if s else fallback


def load_val(path, default=0):
    try:
        val = db.child(path).get().val()
        return val if val is not None else default
    except Exception as e:
        print(f"[WARN] Gagal load {path}: {e}")
        return default


def save_val(path, value):
    try:
        db.child(path).set(value)
    except Exception as e:
        print(f"[WARN] Gagal simpan {path}: {e}")


# ============================================================
# 1. ARSIP DETAIL HARIAN (Daily_Behavior)
# ============================================================
def catat_daily_behavior(user_bersih, kategori_bersih, durasi_final, hari_berjalan):
    try:
        path_detail = f"AquaSync/Daily_Behavior/day_{hari_berjalan}/Users/{user_bersih}/Purposes/{kategori_bersih}"
        existing = db.child(path_detail).get().val()
        if existing is None:
            existing = 0
        elif not isinstance(existing, (int, float)):
            print(f"[WARN] {path_detail} bukan angka ({existing!r}), direset ke 0.")
            existing = 0
        db.child(path_detail).set(existing + durasi_final)
    except Exception as e:
        print(f"[ERROR Daily_Behavior] {e}")


# ============================================================
# 2. AI TRAINER (Users_AI)
# ============================================================
def update_users_ai(user_bersih, durasi_final):
    """
    Mengelola TIMER adaptif per-sesi saja (batas_timer_ai, threshold_mati_paksa).
    'status_konsumsi' (Boros/Optimal) TIDAK lagi ditentukan di sini -- itu sekarang
    tugas hitung_status_konsumsi_mingguan(), yang menilai TOTAL pemakaian semua
    kategori seminggu (bukan cuma sesi Mandi & Buang Air terakhir). Variabel
    'sesi_anomali' di bawah ini cuma dipakai untuk memilih kecepatan adaptasi (alfa)
    EMA timer, bukan status konsumsi rumah tangga.
    """
    try:
        user_path = f"AquaSync/Users_AI/{user_bersih}"
        u_data = db.child(user_path).get().val() or {}
        hist = u_data.get('rata_rata_historis', durasi_final)

        sesi_anomali = durasi_final > (1.5 * hist)
        alfa = 0.8 if sesi_anomali else 0.3
        prediksi = round((alfa * durasi_final) + ((1 - alfa) * hist), 2)
        batas_timer_ai = round(prediksi + 5)
        threshold_mati_paksa = batas_timer_ai + GAP_PERINGATAN_KE_PAKSA

        db.child(user_path).update({
            'rata_rata_historis': prediksi,
            'durasi_aktual_terakhir': durasi_final,
            'batas_timer_ai': batas_timer_ai,
            'threshold_mati_paksa': threshold_mati_paksa
        })
        return {"user": user_bersih, "durasi": durasi_final, "batas_timer_ai": batas_timer_ai,
                "threshold_mati_paksa": threshold_mati_paksa, "sesi_anomali": sesi_anomali}
    except Exception as e:
        print(f"[ERROR AI TRAINER] {e}")
        return None


# ============================================================
# 2b. STATUS KONSUMSI MINGGUAN (Boros/Optimal berbasis SEMUA kategori)
# ============================================================
def hitung_status_konsumsi_mingguan():
    """
    Berbeda dari timer per-sesi di atas, ini menilai TOTAL menit pemakaian
    SEMUA kategori (Mandi, Cuci Piring, Mesin Cuci, Lain-lain) milik tiap user
    selama seminggu berjalan (dari Daily_Behavior, yang sudah otomatis reset
    tiap minggu baru). Status "Boros" diberikan kalau total user itu > 1.5x
    rata-rata seluruh user di rumah tangga tersebut minggu ini -- threshold
    ADAPTIF, bukan angka tetap, biar konsisten dengan filosofi EMA timer.

    Sekalian menghitung "Top User" & "Kategori Terbanyak" minggu ini dari
    sumber yang SAMA (Daily_Behavior), lalu disimpan ke System/Ringkasan_
    Minggu_Ini -- supaya stats_page.html tinggal BACA, bukan hitung ulang
    sendiri dari Stats_Summary (yang baru reset pas Senin, jadi kalau dibaca
    tengah minggu bisa beda dari perhitungan Boros/Optimal ini).
    """
    try:
        daily_behavior = db.child("AquaSync/Daily_Behavior").get().val() or {}

        total_per_user = {}
        total_per_kategori = {}
        for _, hari_data in daily_behavior.items():
            users_hari_itu = (hari_data or {}).get("Users", {})
            for user, u_data in users_hari_itu.items():
                purposes = (u_data or {}).get("Purposes", {})
                for kategori, menit in purposes.items():
                    if not isinstance(menit, (int, float)):
                        continue
                    total_per_user[user] = total_per_user.get(user, 0) + menit
                    total_per_kategori[kategori] = total_per_kategori.get(kategori, 0) + menit

        if not total_per_user:
            save_val("AquaSync/System/Ringkasan_Minggu_Ini", {
                "top_user": "-", "top_user_menit": 0,
                "total_keseluruhan_menit": 0, "top_kategori": "-"
            })
            return {"info": "belum ada aktivitas minggu ini"}

        rata_rata_rumah_tangga = sum(total_per_user.values()) / len(total_per_user)

        hasil = {"rata_rata_rumah_tangga": round(rata_rata_rumah_tangga, 2), "users": {}}
        for user, total_menit in total_per_user.items():
            boros = total_menit > (1.5 * rata_rata_rumah_tangga)
            db.child(f"AquaSync/Users_AI/{user}").update({
                'status_konsumsi': "Boros" if boros else "Optimal",
                'total_menit_minggu_ini': total_menit
            })
            hasil["users"][user] = {"total_menit": total_menit, "status": "Boros" if boros else "Optimal"}

        save_val("AquaSync/System/Rata_Rata_Rumah_Tangga_Menit", round(rata_rata_rumah_tangga, 2))

        top_user = max(total_per_user, key=total_per_user.get)
        top_kategori = max(total_per_kategori, key=total_per_kategori.get) if total_per_kategori else "-"
        total_keseluruhan = sum(total_per_user.values())

        save_val("AquaSync/System/Ringkasan_Minggu_Ini", {
            "top_user": top_user,
            "top_user_menit": total_per_user[top_user],
            "total_keseluruhan_menit": total_keseluruhan,
            "top_kategori": top_kategori
        })
        hasil["ringkasan"] = {
            "top_user": top_user, "top_user_menit": total_per_user[top_user],
            "total_keseluruhan_menit": total_keseluruhan, "top_kategori": top_kategori
        }
        return hasil
    except Exception as e:

        print(f"[ERROR status_konsumsi_mingguan] {e}")
        return {"error": str(e)}


# ============================================================
# 3. PROSES LOG_AKTIVITAS (dipicu checkout dari JS)
# ============================================================
def proses_log_aktivitas():
    """
    Baca SEMUA entri di AquaSync/Log_Queue (bukan cuma satu slot terakhir).
    Ini menggantikan skema lama (AquaSync/Log_Aktivitas, satu slot yang bisa
    ketimpa) yang terbukti KEHILANGAN sesi kalau 2+ user checkout berdekatan
    -- karena JS menulis ke slot tunggal itu secara sinkron, sesi sebelumnya
    bisa langsung tertimpa sebelum sempat dibaca Python (cron cuma jalan tiap
    ~5 menit). Dengan antrian (push), tiap sesi punya key sendiri dan aman.
    """
    hasil = {"jumlah_diproses": 0, "detail": []}
    try:
        antrian = db.child("AquaSync/Log_Queue").get().val() or {}
        # proses sesuai urutan kejadian asli (Timestamp_Mati), bukan urutan key
        entri_terurut = sorted(antrian.items(), key=lambda kv: (kv[1] or {}).get("Timestamp_Mati", 0))

        for key, log in entri_terurut:
            log = log or {}
            user_bersih = sanitize_key(log.get("User_Terakhir", "-"), fallback="unknown_user")
            kategori_bersih = sanitize_key(log.get("Aktivitas_Terakhir", "-"), fallback="Keperluan-Umum")
            durasi_final = log.get("Durasi_Asli_Menit", 1) or 1

            hari_berjalan_sekarang = load_val(HARI_BERJALAN_PATH, 1)
            catat_daily_behavior(user_bersih, kategori_bersih, durasi_final, hari_berjalan_sekarang)
            ai_hasil = update_users_ai(user_bersih, durasi_final)

            # Hapus dari antrian SETELAH sukses diproses -> tidak akan diproses dobel
            db.child(f"AquaSync/Log_Queue/{key}").remove()

            hasil["jumlah_diproses"] += 1
            hasil["detail"].append({
                "user": user_bersih, "kategori": kategori_bersih,
                "durasi": durasi_final, "ai": ai_hasil
            })
    except Exception as e:
        print(f"[ERROR proses_log_aktivitas] {e}")
        hasil["error"] = str(e)
    return hasil


# ============================================================
# 4. BILLING HARIAN + PREDIKSI 7 HARI + ARSIP MINGGUAN
#    (pakai baseline kWh, karena sensor PZEM tidak bisa direset ke 0)
# ============================================================
def hitung_hari_dan_minggu():
    now = datetime.now(WIB)
    hari_berjalan = now.isoweekday()          # Senin=1 ... Minggu=7
    minggu_id = now.strftime("%G-W%V")         # contoh: "2026-W29"
    return hari_berjalan, minggu_id, now


def buat_label_periode_minggu_lalu(now):
    senin_minggu_ini = now - timedelta(days=now.isoweekday() - 1)
    senin_minggu_lalu = senin_minggu_ini - timedelta(days=7)
    minggu_minggu_lalu = senin_minggu_ini - timedelta(days=1)
    bln_awal = NAMA_BULAN_INDO[senin_minggu_lalu.month - 1]
    bln_akhir = NAMA_BULAN_INDO[minggu_minggu_lalu.month - 1]
    return f"{senin_minggu_lalu.day:02d} {bln_awal} - {minggu_minggu_lalu.day:02d} {bln_akhir}"


def arsipkan_minggu_lalu(week_id_lama, now, kwh_mentah_sekarang):
    try:
        daily_behavior = db.child("AquaSync/Daily_Behavior").get().val() or {}
        actual_usage = db.child("AquaSync/actual_usage").get().val() or {}
        stats_summary_lama = db.child("AquaSync/Stats_Summary").get().val() or {}

        baseline_lama = load_val(BASELINE_PATH, 0)
        energy_minggu_lalu = max(0, kwh_mentah_sekarang - baseline_lama)
        total_bill_minggu_lalu = round(energy_minggu_lalu * TARIF_PER_KWH)

        paket_arsip = {
            "Week_Id": week_id_lama,
            "Tanggal_Backup": buat_label_periode_minggu_lalu(now),
            "Timestamp": int(time.time() * 1000),
            "Total_Energy": energy_minggu_lalu,
            "Total_Bill": total_bill_minggu_lalu,
            "Daily_Behavior": daily_behavior,
            "actual_usage": actual_usage,
            "Stats_Summary": stats_summary_lama,
        }
        db.child("AquaSync/History_Mingguan").push(paket_arsip)

        # Bersihkan detail minggu lalu
        db.child("AquaSync/Daily_Behavior").remove()
        db.child("AquaSync/actual_usage").remove()
        # PENTING: Stats_Summary sebelumnya TIDAK PERNAH direset, jadi "Top User/
        # Kategori Minggu Ini" di halaman Stats sebenarnya akumulasi SEJAK AWAL
        # testing, bukan cuma minggu berjalan. Sekarang direset juga di sini.
        db.child("AquaSync/Stats_Summary").remove()

        # PENTING: sensor tidak bisa direset. Yang direset adalah BASELINE-nya,
        # bukan kWh mentahnya. kWh mentah sekarang jadi titik nol untuk minggu baru.
        save_val(BASELINE_PATH, kwh_mentah_sekarang)
        save_val("AquaSync/Realtime_Status/Actual_Bill", 0)

        print(f"[ARSIP] Minggu {week_id_lama} diarsip (Rp{total_bill_minggu_lalu}). "
              f"Baseline baru = {kwh_mentah_sekarang} kWh.")
        return total_bill_minggu_lalu
    except Exception as e:
        print(f"[ERROR ARSIP] {e}")
        return None


def proses_billing_dan_prediksi():
    hasil = {}
    try:
        hari_berjalan, minggu_id, now = hitung_hari_dan_minggu()
        kwh_mentah_sekarang = load_val("AquaSync/Realtime_Status/Energy", 0)

        # --- Baseline: kalau belum pernah ada, mulai dari kWh sekarang (bukan 0 absolut) ---
        baseline = db.child(BASELINE_PATH).get().val()
        if baseline is None:
            save_val(BASELINE_PATH, kwh_mentah_sekarang)
            baseline = kwh_mentah_sekarang

        # --- Cek pergantian minggu -> arsip kalau perlu ---
        last_archived = db.child(LAST_WEEK_PATH).get().val()
        if not last_archived:
            save_val(LAST_WEEK_PATH, minggu_id)
        elif minggu_id != last_archived:
            hasil["arsip"] = arsipkan_minggu_lalu(last_archived, now, kwh_mentah_sekarang)
            save_val(LAST_WEEK_PATH, minggu_id)
            baseline = kwh_mentah_sekarang  # baseline baru saja di-update di dalam arsipkan_minggu_lalu

        # --- Sinkronkan hari_berjalan dengan kalender asli ---
        save_val(HARI_BERJALAN_PATH, hari_berjalan)

        # --- Biaya murni hari ini, pakai (kWh mentah - baseline) ---
        energy_minggu_ini = max(0, kwh_mentah_sekarang - baseline)
        total_bill_minggu_ini = round(energy_minggu_ini * TARIF_PER_KWH)

        # PENTING: stats_page.html membaca Realtime_Status/Actual_Bill LANGSUNG
        # tanpa menghitung apapun sendiri. Field ini sebelumnya cuma pernah di-set
        # ke 0 saat arsip, jadi nilainya basi/tidak pernah ter-update. Simpan nilai
        # yang benar di sini supaya tampilan "Actual Bill" di Stats selalu akurat.
        save_val("AquaSync/Realtime_Status/Actual_Bill", total_bill_minggu_ini)

        biaya_hari_sebelumnya = 0
        for d in range(1, hari_berjalan):
            biaya_hari_sebelumnya += load_val(f"AquaSync/actual_usage/day_{d}", 0)

        biaya_hari_ini = max(0, total_bill_minggu_ini - biaya_hari_sebelumnya)
        save_val(f"AquaSync/actual_usage/day_{hari_berjalan}", biaya_hari_ini)

        # PENTING: stats_page.html menampilkan "Actual Bill (Minggu Ini)" langsung
        # dari Realtime_Status/Actual_Bill (field statis, bukan hasil hitung live).
        # Field ini HARUS disinkronkan tiap siklus, kalau tidak dia akan nyangkut
        # di nilai lama selamanya (ini penyebab bug "Rp2.200 tidak pernah berubah").
        save_val("AquaSync/Realtime_Status/Actual_Bill", total_bill_minggu_ini)

        # --- Prediksi 7 hari: ekstrapolasi rata-rata harian berjalan ---
        rata_rata_harian = total_bill_minggu_ini / hari_berjalan if hari_berjalan > 0 else 0
        prediksi_minggu_ini = round(rata_rata_harian * 7)
        save_val("AquaSync/Prediction/Monthly_Bill", prediksi_minggu_ini)

        # --- Status Boros/Optimal berbasis TOTAL semua kategori minggu ini ---
        status_konsumsi_hasil = hitung_status_konsumsi_mingguan()

        hasil.update({
            "hari_berjalan": hari_berjalan,
            "biaya_hari_ini": biaya_hari_ini,
            "total_bill_minggu_ini": total_bill_minggu_ini,
            "prediksi_7_hari": prediksi_minggu_ini,
            "status_konsumsi": status_konsumsi_hasil
        })
    except Exception as e:
        print(f"[ERROR BILLING] {e}")
        hasil["error"] = str(e)
    return hasil


# ============================================================
# 5. ENDPOINT HTTP
# ============================================================
@app.route("/")
def health():
    return jsonify({"status": "ok", "system": "AquaSync AI Agent v7"})


@app.route("/tick")
def tick():
    if request.args.get("key") != SECRET_KEY:
        return jsonify({"error": "unauthorized"}), 401

    hasil_log = proses_log_aktivitas()
    hasil_billing = proses_billing_dan_prediksi()

    return jsonify({"log_aktivitas": hasil_log, "billing": hasil_billing})


if __name__ == "__main__":
    # Untuk testing lokal saja. Di PythonAnywhere, 'app' diimpor oleh WSGI, baris ini tidak dipakai.
    app.run(debug=True)