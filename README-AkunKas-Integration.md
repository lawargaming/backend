# ⚠️ BUG: Invoice PAID Tapi Saldo Akun Kas Tidak Bertambah

> **Flow yang bermasalah:**
> Create Invoice → Bayar di Detail Screen → Status PAID → ❌ Saldo Akun Kas TIDAK terupdate

---

## 📌 Ringkasan Masalah

Ketika invoice sudah selesai dibayar (status `PAID`), total pembayaran **tidak masuk** ke saldo Akun Kas — walaupun metode pembayaran yang dipakai sudah terhubung ke Akun Kas.

---

## 🔍 Bukti dari Kode Backend (Line by Line)

### Step 1: Create Invoice — `penjualanService.create()` ✅ OK

Invoice dibuat melalui `POST /api/penjualan`. Field yang di-set:
- `statusBayar = "UNPAID"` (default dari model, baris 130)
- `sisaTagihan = totalTagihan` (dihitung oleh pre-validate hook)

> Tidak ada masalah di sini — invoice dibuat dengan status UNPAID. Belum ada uang masuk.

---

### Step 2: Bayar Invoice — `pembayaranService.create()` ⚠️ MASALAH DI SINI

**File: `services/pembayaranService.js` baris 228-351**

Saat user bayar invoice dari Detail Screen, backend melakukan:

```
Baris 235-244  →  Fetch Penjualan + Fetch MetodePembayaran (sudah punya akunKasID)
Baris 257-261  →  Set status = "PAID" (jika metode non-automated)
Baris 292-300  →  Validasi jumlahBayar
Baris 302-308  →  Cek jumlahBayar ≤ sisaTagihan
Baris 310-318  →  Validasi akunKasID (HANYA validasi, TIDAK update saldo)
Baris 325      →  Pembayaran.create(payload)  ← record pembayaran tersimpan
Baris 327      →  _syncPenjualan()  ← update totalDibayar di Penjualan
Baris 328      →  Invalidate Redis cache
Baris 339      →  Return result  ← SELESAI. SALDO AKUN KAS TIDAK DISENTUH.
```

#### Bukti 1: `metodeValid.akunKasID` sudah di-fetch tapi TIDAK dipakai

```javascript
// pembayaranService.js baris 240-244
// Backend SUDAH fetch metode pembayaran yang punya akunKasID
const metodeValid = await MetodePembayaran.findOne({
  _id: payload.metodePembayaranID,
  tenantID: payload.tenantID,
  isActive: true,
});
// metodeValid.akunKasID = "id_akun_kas"  ← ADA, tapi tidak pernah dipakai untuk update saldo
```

#### Bukti 2: Validasi `akunKasID` hanya CEK — tidak UPDATE

```javascript
// pembayaranService.js baris 310-318
// Backend HANYA mengecek apakah akunKasID valid — BUKAN menambah saldo
if (payload.akunKasID) {
  const akunKasValid = await AkunKas.findOne({
    _id: payload.akunKasID,
    tenantID: payload.tenantID,
  });
  if (!akunKasValid) {
    return { error: ["ID Akun Kas tidak ditemukan atau akses ditolak."] };
  }
}
// ← Selesai. Tidak ada AkunKas.findByIdAndUpdate() atau $inc saldo di sini.
```

#### Bukti 3: Setelah `Pembayaran.create()` — langsung return tanpa update saldo

```javascript
// pembayaranService.js baris 324-339
try {
  const created = await Pembayaran.create(payload);       // ← Pembayaran disimpan
  await this._syncPenjualan(payload.penjualanID, ...);    // ← Update totalDibayar di Penjualan
  await redis.del(CACHE_KEY_LIST(payload.tenantID));      // ← Invalidate cache
  // ... populate dan return result
  return this._formatOutput(result);                      // ← SELESAI.
  
  // ❌ TIDAK ADA:
  // await AkunKas.findByIdAndUpdate(metodeValid.akunKasID, { $inc: { saldo: jumlahBayar } });
}
```

---

### Step 3: _syncPenjualan() — Update Penjualan Saja, BUKAN Akun Kas

**File: `services/pembayaranService.js` baris 65-86**

```javascript
async _syncPenjualan(penjualanID, tenantID) {
  const penjualan = await Penjualan.findOne({ _id: penjualanID, tenantID });
  if (!penjualan) return;

  // Hitung total semua pembayaran PAID
  const pembayaranSukses = await Pembayaran.find({
    penjualanID, tenantID, status: "PAID",
  });
  const totalUangMasuk = pembayaranSukses.reduce(
    (acc, curr) => acc + (curr.jumlahBayar || 0), 0
  );

  penjualan.totalDibayar = totalUangMasuk;  // ← HANYA update Penjualan
  await penjualan.save();                    // ← Trigger pre-validate hook

  // ❌ TIDAK ADA update AkunKas.saldo di sini
}
```

---

### Step 4: Model pre-validate — Auto StatusBayar, BUKAN Saldo

**File: `models/penjualanModel.js` baris 190-230**

```javascript
PenjualanSchema.pre("validate", function (next) {
  // ... hitung totalTagihan, sisaTagihan ...

  if (this.totalTagihan === 0 || this.sisaTagihan === 0) {
    this.statusBayar = "PAID";     // ← statusBayar jadi PAID
  } else if (dibayar > 0 && this.sisaTagihan > 0) {
    this.statusBayar = "PARTIAL";
  } else {
    this.statusBayar = "UNPAID";
  }

  next();
  // ❌ TIDAK ADA update AkunKas.saldo di sini — hook ini HANYA tentang Penjualan
});
```

---

## 🔴 Kesimpulan: Saldo Akun Kas TIDAK PERNAH Terupdate

```
Create Invoice (penjualanService.create)
  └→ statusBayar = UNPAID                    ← ✅ OK
  └→ AkunKas.saldo = tidak disentuh          ← ✅ OK (belum bayar)

Bayar Invoice (pembayaranService.create)
  └→ Pembayaran.create() = tersimpan         ← ✅ OK
  └→ _syncPenjualan() = totalDibayar updated ← ✅ OK  
  └→ statusBayar = PAID                      ← ✅ OK (via pre-validate)
  └→ AkunKas.saldo = ❌ TIDAK DISENTUH       ← 🔴 BUG

Delete Pembayaran (pembayaranService.delete)
  └→ Pembayaran dihapus                      ← ✅ OK
  └→ _syncPenjualan() = totalDibayar updated ← ✅ OK
  └→ AkunKas.saldo = ❌ TIDAK DISENTUH       ← 🔴 BUG

Update Pembayaran (pembayaranService.update)
  └→ jumlahBayar berubah                     ← ✅ OK
  └→ _syncPenjualan() = totalDibayar updated ← ✅ OK
  └→ AkunKas.saldo = ❌ TIDAK DISENTUH       ← 🔴 BUG
```

**Tidak ada satu pun tempat di seluruh backend yang menjalankan:**
```javascript
await AkunKas.findByIdAndUpdate(akunKasID, { $inc: { saldo: jumlahBayar } });
```

---

## 🔴 Mengapa Frontend Tidak Bisa Menyelesaikan Masalah Ini

### 1. Backend pakai `$set`, bukan `$inc`

```javascript
// akunKasService.update() baris 90-96
const updated = await AkunKas.findOneAndUpdate(
  { _id: id, tenantID: requesterTenantID },
  payload,    // ← $set — MENIMPA saldo, bukan menambah!
  { new: true, runValidators: true }
);
```

Dari frontend, kita hanya bisa: GET saldo → tambah manual → PUT saldo baru.
Ini **tidak atomic** — 2 kasir bayar bersamaan = saldo kacau.

### 2. Hanya backend yang bisa `$inc` (atomic)

```javascript
// YANG DIBUTUHKAN (hanya bisa di backend):
await AkunKas.findByIdAndUpdate(akunKasID, { $inc: { saldo: jumlahBayar } });
// $inc = operasi atomic MongoDB — tidak mungkin race condition
```

### 3. Jika network error di frontend, saldo tidak konsisten

```
Frontend: createPembayaran()  → ✅ Sukses, tersimpan di DB
Frontend: GET /api/akunkas    → ✅ Dapat saldo Rp 1.000.000
Frontend: PUT saldo 1.500.000 → ❌ TIMEOUT
// Pembayaran sudah tercatat, tapi saldo akun kas tidak updated = data tidak konsisten
```

Di backend, semua terjadi di **1 request cycle** — jika gagal, bisa rollback.

---

## 🟢 Backend SUDAH Punya Pattern yang Sama — untuk Pengeluaran

**File: `services/bebanOperasionalService.js`**

Saat beban operasional dicatat (uang keluar), backend **sudah update saldo akun kas**:

```javascript
// CREATE beban (baris 78) — kurangi saldo
await AkunKas.findOneAndUpdate(
  { _id: payload.akunKasID, tenantID: payload.tenantID },
  { $inc: { saldo: -payload.jumlah } }    // ← SUDAH ADA untuk pengeluaran!
);

// DELETE beban (baris 168) — kembalikan saldo
await AkunKas.updateOne(
  { _id: target.akunKasID, tenantID: requesterTenantID },
  { $inc: { saldo: target.jumlah } }      // ← SUDAH ADA untuk rollback!
);
```

### Situasi Sekarang (Tidak Simetris)

| Transaksi | Update Saldo Akun Kas? | File |
|---|:---:|---|
| **Beban Operasional** (uang keluar) | ✅ `$inc: { saldo: -jumlah }` | `bebanOperasionalService.js` |
| **Pembayaran Invoice** (uang masuk) | ❌ Tidak ada | `pembayaranService.js` |

> **Saldo akun kas hanya TURUN (dari beban), tapi TIDAK PERNAH NAIK (dari pembayaran invoice).**
> Semakin banyak invoice dibayar, semakin tidak akurat saldo.

---

## ✅ Fix yang Dibutuhkan

**1 file, 3 titik perubahan, ~15 baris:**

### `pembayaranService.js` → `create()` (setelah baris 327)

```javascript
// Setelah: await this._syncPenjualan(...)
if (payload.status === "PAID" && metodeValid.akunKasID) {
  await AkunKas.findByIdAndUpdate(metodeValid.akunKasID, {
    $inc: { saldo: jumlahBayarNum }
  });
  await redis.del(`akunkas:list:${payload.tenantID}`);
  await redis.del(`akunkas:detail:${metodeValid.akunKasID}`);
}
```

### `pembayaranService.js` → `delete()` (sebelum baris 502)

```javascript
if (target.status === "PAID") {
  const metode = await MetodePembayaran.findById(target.metodePembayaranID);
  if (metode?.akunKasID) {
    await AkunKas.findByIdAndUpdate(metode.akunKasID, {
      $inc: { saldo: -(target.jumlahBayar || 0) }
    });
    await redis.del(`akunkas:list:${requesterTenantID}`);
    await redis.del(`akunkas:detail:${metode.akunKasID}`);
  }
}
```

### `pembayaranService.js` → `update()` (rollback old + apply new)

```javascript
// Rollback saldo lama jika sebelumnya PAID
// Apply saldo baru jika sekarang PAID
```

**Pattern ini 100% identik dengan `bebanOperasionalService.js` — bukan fitur baru, tapi melengkapi yang sudah ada.**
