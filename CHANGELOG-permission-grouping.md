# CHANGELOG: Pembaruan Sistem Permission (Role Management)

## 📌 Ringkasan Pembaruan
Sistem otorisasi (*Permission*) pada *Backend* telah mengalami peningkatan struktural yang signifikan. Pembaruan utama berfokus pada penambahan metadata kategorisasi (`grup`) pada setiap *Permission*.

Hal ini dirancang untuk menyelesaikan masalah *UX* (Pangalaman Pengguna) di sisi *Frontend* (Flutter/Web), di mana daftar *Permission* yang sangat panjang sebelumnya sulit dibaca dan dikelola oleh Administrator/Owner saat membuat *Role* baru.

---

## 🛠️ Detail Perubahan Teknis

### 1. Modifikasi Skema *Database* (`seeds/permissionSeed.js`)
Skema dasar Mongoose untuk *Permission* telah diperbarui:
```javascript
const PermissionSchema = new mongoose.Schema({
  nama: { type: String, required: true, unique: true },
  grup: { type: String, required: true }, // ✨ FIELD BARU WAJIB
  deskripsi: String,
});
```

### 2. Pengelompokan Data (Categorization)
Seluruh 21+ *Permissions* kini dikelompokkan secara terstruktur ke dalam 8 entitas logis bisnis:

| Nama Grup | Tanggung Jawab & Cakupan Hak Akses |
| :--- | :--- |
| **Manajemen Staff** | Mengelola data karyawan, absensi, izin, cuti, dan kontrak kompensasi. |
| **Manajemen Produk** | Mengelola katalog menu, master bahan baku, kategori, serta jurnal stok dan transfer inventori. |
| **Transaksi** | Memberikan akses spesifik untuk membuka mesin Kasir (POS), melihat riwayat penjualan, metode pembayaran, dan setup diskon. |
| **Keuangan** | Akses sensitif untuk mengelola pembukuan Akun Kas & Bank, beban operasional, dan manajemen kategori beban. |
| **Laporan** | Hak eksklusif untuk melihat analitik, omzet, dan rekapitulasi data krusial perusahaan. |
| **Booking & Aset** | Hak untuk mengelola ketersediaan lapangan/ruangan (Aset) serta kalender sesi reservasi/booking. |
| **Pelanggan** | Otoritas penuh untuk memodifikasi direktori pelanggan (CRM), *membership*, dan paket loyalitas. |
| **Pengaturan Toko** | Hak *Super-Admin* tertinggi untuk mengubah profil tenant bisnis. |

---

## 💡 Dampak & Keuntungan Arsitektural

1. **Frontend Lebih Intuitif**: UI *Role Management* pada Flutter/Web tidak lagi perlu menampilkan daftar datar (*flat list*) yang panjang. UI kini dapat memanfaatkan komponen *Expansion Tile* (Akordeon), *Tab Bar*, atau *Grid Card* berdasarkan atribut `grup`.
2. **Skalabilitas**: Ketika aplikasi bertumbuh dan menambah modul baru (misal: Modul *Payroll* atau Pajak), kita hanya perlu mendaftarkan permission di bawah nama `grup` baru, dan UI akan otomatis membuatkan blok kategori baru secara dinamis.
3. **Keamanan Eksekusi**: Perombakan dilakukan di struktur `seeds`. Ini mengamankan alur inisialisasi awal. Saat aplikasi di-$deploy$, menjalankan `node permissionSeed.js` terjamin akan menghapus skema usang dan menimpanya dengan arsitektur terstruktur ini (`Permission.deleteMany({})`).

---

## 🚦 Pembaruan Middleware Otentikasi & Otorisasi
Selain skema *Database*, sistem keamanan pada *Middleware* telah diperketat (RBAC - *Role Based Access Control*):

### 1. Injeksi Dinamis (`middleware/authPengguna.js`)
Setiap kali *Pengguna* (Karyawan) mengakses sistem dengan token, *middleware* kini tidak sekadar memecah (Decode) JWT. Ia aktif melakukan:
- **Validasi Sinkronisasi Versi Token:** Mencegah kebocoran token (*Token Reuse*). Jika Admin mem-bypass (mengeluarkan paksa akun), token lama akan langsung tertolak (`pengguna.tokenVersion !== decoded.version`).
- **Injeksi Hak Akses (*Populate Permissions*):** Ia secara otomatis menyuntikkan daftar *array* permission dari `Role` karyawan ke `req.pengguna.permissions`. Ini membuat sesi tersegresi aman.

### 2. Pencegatan Endpoint (`middleware/authorizePermission.js`)
Sebagai penjaga gawang (*Gatekeeper/Guard*), fungsi `checkPermission` memastikan:
- **Bypass Superadmin:** Jika `req.akun` (Owner) mendeteksi adanya sesi aktif, akses diizinkan penuh secara otomatis.
- **Validasi Ketat Karyawan:** Akan mengeksekusi `req.pengguna?.permissions.includes(permissionName)` untuk mengunci endpoint krusial.

---

## ⚡ Pembaruan API Route & Caching
Guna melayani Frontend yang meminta daftar konfigurasi Role yang cepat dan tidak membebani komputasi server:

### 1. `GET /api/permission/grouped`
Dibuat endpoint baru di mana Database (MongoDB) melakukan agregasi tingkat lanjut (*Aggregation Pipeline* `$group`) otomatis untuk mengembalikan JSON terstruktur hierarkis ke Flutter/Web.

### 2. Integrasi Pengangkut Redis (`services/permissionService.js`)
Daftar izin aplikasi (*Permission*) adalah data yang **sangat statis** (Hanya berubah saat *seeding* struktur awal). Maka:
- Akses ke DB diblokir dengan *High Performance Redis Cache* keys: `permissions:all` dan `permissions:grouped`.
- Cache ditahan selama **1 jam (3600 detik)**.
- Setiap memori akan otomatis digugurkan (`clearCache`) HANYA jika terjadi *Write Operation* (Create / Delete) pada Data Permission.

---

## 🚀 Langkah Selanjutnya untuk Frontend (Flutter)

*App Developer* disarankan melakukan improvisasi pada rute `GET /api/permission`:
1. Menerima JSON *Response*.
2. Memproses data ke dalam format terstruktur: `Map<String, List<Permission>> groupedPermissions`.
3. Menampilkan ke UI berupa `ListView` yang membungkus kumpulan *Checkboxes* sesuai dengan map Key (Nama Grup).
