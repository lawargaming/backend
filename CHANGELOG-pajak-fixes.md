# 📝 Backend Changes Log — Fitur Pajak
**Tanggal**: 23 Februari 2026  
**Pembuat**: AI Assistant (diminta oleh developer frontend)

---

## 🐛 Bug Fixes

### 1. `services/pajakService.js` — Hapus Duplikasi `simulasiHitung`
- **Masalah**: Method `simulasiHitung` ada **2x** (baris 86–112 dan 113–139). Yang kedua crash ketika `listPajakRelasi` kosong karena akses `[0].pajakID.modelPerhitungan` tanpa null check.
- **Solusi**: Hapus method duplikat (baris 113–139). Yang pertama sudah punya safe null check.

### 2. `services/pajakService.js` — Fix `update()` Redis Bug
- **Masalah**: `redis.del()` dipanggil sebagai **parameter ke-4 dan ke-5** dari `Pajak.findOneAndUpdate()`. Mongoose mengabaikannya, jadi cache **tidak pernah terhapus** setelah update.
```diff
- const updated = await Pajak.findOneAndUpdate(
-   { _id: id, tenantID },
-   { $set: payload },
-   { new: true, runValidators: true },
-   await redis.del(`pajak:detail:${id}`),     // ❌ Ini jadi param Mongoose
-   await redis.del(`pajak:list:${tenantID}`),  // ❌ Ini juga
- ).lean();
+ const updated = await Pajak.findOneAndUpdate(
+   { _id: id, tenantID },
+   { $set: payload },
+   { new: true, runValidators: true },
+ ).lean();
+ if (!updated) throw createError(404, "Data tidak ditemukan.");
+ await this.#clearCache(id, tenantID);         // ✅ Sekarang benar
```

---

## ✨ Fitur Baru

### 3. `validators/pajakValidator.js` — [FILE BARU]
Validasi input untuk create/update pajak:
- `namaPajak` — wajib, non-empty string
- `tarifPajak` — wajib, angka 0–100
- `modelPerhitungan` — wajib, enum [1, 2, 3]
- `prioritas` — wajib, enum [1, 2]
- `akunPajakID` — wajib, valid ObjectId
- `tipePajak` — opsional, enum ["Per Produk", "Per Transaksi"]
- Support mode `isUpdate` (field tidak wajib saat update)

### 4. `validators/produkPajakValidator.js` — [FILE BARU]
Validasi input untuk assign pajak ke produk:
- `produkID` — wajib, valid ObjectId
- `pajakID` — wajib, valid ObjectId

### 5. `routes/pajakRoute.js` — Tambah Validator Middleware
- `POST /` → tambah `validateCreate` middleware
- `PUT /:id` → tambah `validateUpdate` middleware
- Endpoint lain (GET, DELETE, simulasi) tidak berubah

### 6. `routes/produkPajakRoute.js` — Tambah Validator Middleware
- `POST /` → tambah `validateAssign` middleware
- Endpoint lain (GET, DELETE) tidak berubah

---

## 📁 File yang Diubah
| File | Status | Keterangan |
|------|--------|------------|
| `services/pajakService.js` | MODIFIED | Fix 2 bug (duplikasi + redis) |
| `validators/pajakValidator.js` | NEW | Validasi input pajak |
| `validators/produkPajakValidator.js` | NEW | Validasi input assign pajak |
| `routes/pajakRoute.js` | MODIFIED | Wire validator ke POST/PUT |
| `routes/produkPajakRoute.js` | MODIFIED | Wire validator ke POST |
