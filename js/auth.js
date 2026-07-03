// ==========================================
// js/auth.js - MODUL UTAMA AUTENTIKASI (VERSION 10)
// ==========================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// 1. Konfigurasi Firebase Asli Milik Proyek AquaSync Kamu
const firebaseConfig = {
  apiKey: "AIzaSyC9PuXQiQ2zCKfCMG3KTYoiU_kldIZmNxE",
  authDomain: "aquasync-dda8c.firebaseapp.com",
  databaseURL: "https://aquasync-dda8c-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "aquasync-dda8c",
  storageBucket: "aquasync-dda8c.firebasestorage.app",
  messagingSenderId: "332004178563",
  appId: "1:332004178563:web:d34bb11e834b4832a579b6"
};

// 2. Inisialisasi Firebase Services
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app); // Kita export sekalian database-nya biar bisa dipakai di dashboard.js nanti!

// ==========================================
// FUNGSI-FUNGSI KONTROL USER
// ==========================================

// A. Fungsi Aksi Login (Dipanggil di index.html)
export function inisialisasiLogin() {
    const loginBtn = document.getElementById('loginBtn');
    if (!loginBtn) return; // Mencegah error jika dipanggil di halaman non-login

    loginBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const errorTxt = document.getElementById('errorTxt');

        errorTxt.style.display = 'none';

        signInWithEmailAndPassword(auth, email, password)
        .then((userCredential) => {
            console.log("Login sukses! Mengalihkan halaman...");
            window.location.href = "dashboard.html"; 
        })
        .catch((error) => {
            console.error(error);
            errorTxt.innerText = "Gagal Masuk: " + error.message.replace("Firebase: ", "");
            errorTxt.style.display = 'block';
        });
    });
}

// B. Fungsi Proteksi Halaman (Memastikan user wajib login untuk masuk dashboard)
export function proteksiHalaman(callbackSukses) {
    onAuthStateChanged(auth, (user) => {
        if (!user) {
            // Jika tidak ada user yang aktif login, tendang balik ke halaman login (index.html)
            window.location.href = "index.html";
        } else {
            // Jika ada user login, jalankan fungsi utama dashboard kita dan kirim data user-nya
            callbackSukses(user);
        }
    });
}

// C. Fungsi Logout (Dipanggil saat tombol logout di dashboard di-klik)
export function handleLogout() {
    signOut(auth).then(() => {
        window.location.href = "index.html";
    }).catch((error) => {
        console.error("Gagal Logout:", error);
    });
}