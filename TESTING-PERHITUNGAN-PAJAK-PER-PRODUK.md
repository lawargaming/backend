# ✅ TESTING CHECKLIST — Fitur Perhitungan Pajak Per Produk

> Setelah restart backend, jalankan semua test skenario berikut.
> Tandai ✅ jika berhasil, ❌ jika gagal.

---

## A. Happy Path — Perhitungan Pajak Per Produk (POST /api/pajak/hitung-pajak-produk)

- [ ] **A1.** Produk "makanan" (sudah di-assign pajak Per Produk 10% Exclusive), hitung pajak dengan harga 25000
  - Expected: `totalPajak: 2500 | grandTotal: 27500 | rincian: 1 entry`
  
- [ ] **A2.** Produk "makanan", hitung pajak dengan harga 0
  - Expected: `totalPajak: 0 | grandTotal: 0 | rincian: []`

- [ ] **A3.** Produk "makanan", hitung pajak dengan harga sangat besar (1.000.000.000)
  - Expected: `totalPajak: 100000000 | grandTotal: 1100000000` (tidak overflow)

---

## B. Produk Tanpa Pajak

- [ ] **B1.** Buat produk baru tanpa assign pajak → hitung pajak
  - Expected: `totalPajak: 0 | grandTotal: harga | rincian: []`

- [ ] **B2.** Produk yang pajaknya sudah di-unassign → hitung pajak
  - Expected: `totalPajak: 0`

---

## C. Tipe Pajak (Per Transaksi vs Per Produk)

- [ ] **C1.** Produk hanya punya pajak "Per Transaksi" → hitung pajak per produk
  - Expected: `totalPajak: 0` (Per Transaksi TIDAK masuk perhitungan per-produk)

- [ ] **C2.** Produk punya pajak "Per Produk" + "Per Transaksi" → hitung pajak per produk
  - Expected: Hanya pajak Per Produk yang dihitung

---

## D. Multiple Pajak Per Produk

- [ ] **D1.** Assign 2 pajak Exclusive (10% + 5%) ke produk → hitung pajak dengan harga 100.000
  - Expected: `totalPajak: 15000 | grandTotal: 115000 | rincian: 2 entries`

- [ ] **D2.** 2 pajak dengan prioritas berbeda → cek urutan di rincian
  - Expected: Pajak prioritas=1 dihitung duluan

---

## E. Error Handling — Endpoint Perhitungan (POST /api/pajak/hitung-pajak-produk)

- [ ] **E1.** Body `{ harga: 25000 }` (tanpa produkID)
  - Expected: `400` — "Field 'produkID' wajib diisi"

- [ ] **E2.** Body `{ produkID: "xxx" }` (tanpa harga)
  - Expected: `400` — "Field 'harga' wajib diisi"

- [ ] **E3.** Body `{ produkID: "xxx", harga: -100 }`
  - Expected: `400` — "Field 'harga' tidak boleh negatif"

- [ ] **E4.** Body `{ produkID: "abc123", harga: 100 }` (bukan ObjectId)
  - Expected: `400` — "Format 'produkID' tidak valid"

- [ ] **E5.** Body `{ produkID: "000000000000000000000000", harga: 100 }` (ID valid tapi tidak ada di DB)
  - Expected: `200` — `totalPajak: 0` (graceful, bukan error)

- [ ] **E6.** Body `{ produkID: "xxx", harga: "bukan_angka" }`
  - Expected: `400` — "Field 'harga' harus berupa angka"

---

## F. Integration — Buat Invoice (POST /api/penjualan)

- [ ] **F1.** Buat invoice dengan produk "makanan" (ber-pajak Per Produk 10%)
  - Cek: `item.jumlahPajak > 0` ✅
  - Cek: `item.rincianPajak` ada isi ✅
  - Cek: `item.totalharga = item.total + item.jumlahPajak` ✅

- [ ] **F2.** Buat invoice dengan produk TANPA pajak
  - Cek: `item.jumlahPajak = 0` ✅
  - Cek: `item.rincianPajak = []` ✅

- [ ] **F3.** Buat invoice campuran (produk ber-pajak + produk tanpa pajak)
  - Cek: Masing-masing item punya pajak sesuai assignment ✅

- [ ] **F4.** Buat invoice dengan pajak Per Produk + Per Transaksi
  - Cek: `item.jumlahPajak` = pajak per-produk saja ✅
  - Cek: `pajakTransaksi[]` = pajak per-transaksi saja ✅
  - Cek: `totalTagihan` = sum(item.totalharga) - diskon + pajakTransaksi ✅

- [ ] **F5.** Buat invoice → bayar → cek sisa tagihan
  - Cek: `totalTagihan` sudah termasuk pajak produk ✅
  - Cek: `sisaTagihan` = `totalTagihan - totalDibayar` ✅

---

## G. Edge Cases — Status & CRUD Pajak

- [ ] **G1.** Non-aktifkan pajak Per Produk → buat invoice baru
  - Expected: `item.jumlahPajak = 0` (pajak non-aktif tidak dihitung)

- [ ] **G2.** Aktifkan kembali pajak → buat invoice baru
  - Expected: `item.jumlahPajak > 0`

- [ ] **G3.** Hapus master pajak (yang sudah di-assign ke produk)
  - Expected: Relasi ProdukPajak ikut terhapus, perhitungan return 0

- [ ] **G4.** Ubah tarif pajak (10% → 15%) → buat invoice baru
  - Expected: Invoice BARU pakai tarif 15%
  - Expected: Invoice LAMA tetap 10% (snapshot)

- [ ] **G5.** Ubah model perhitungan (Exclusive → Inclusive) → buat invoice baru
  - Expected: Model baru berlaku, jumlah pajak berubah sesuai model

---

## H. Frontend — Tampilan di Flutter

- [ ] **H1.** Buka halaman "Buat Invoice" → tambah produk "makanan"
  - Cek: Badge pajak per-produk muncul di bawah item ✅
  - Cek: Footer menampilkan "📦 Pajak Per Produk: Rp X" ✅

- [ ] **H2.** Buka invoice yang sudah dibuat dari Dashboard
  - Cek: Baris pajak menampilkan `Rp 5.000` bukan `Rp 0` ✅
  - Cek: Total Tagihan sudah benar (termasuk pajak) ✅

- [ ] **H3.** Buka "Kelola Pajak Produk" dialog dari inventaris
  - Cek: Debug log muncul di console ✅
  - Cek: Assign/unassign bekerja ✅

---

> **Total: 25 test cases**  
> Target: 25/25 pass ✅
