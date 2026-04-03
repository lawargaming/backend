# 06 – Sentry & Error Testing Guide

Panduan lengkap untuk menggunakan endpoint `/api/testing/*` dalam memonitor error dan
performance melalui Sentry.

---

## Daftar Isi

1. [Prasyarat](#1-prasyarat)
2. [Cara Akses Endpoint](#2-cara-akses-endpoint)
3. [Semua Endpoint Testing](#3-semua-endpoint-testing)
4. [Log yang Diharapkan per Endpoint](#4-log-yang-diharapkan-per-endpoint)
5. [Yang Diharapkan di Sentry](#5-yang-diharapkan-di-sentry)
6. [Cara Membaca Log](#6-cara-membaca-log)
7. [Pola Error Umum yang Perlu Diwaspadai](#7-pola-error-umum-yang-perlu-diwaspadai)
8. [Contoh Output Log Lengkap](#8-contoh-output-log-lengkap)

---

## 1. Prasyarat

| Kebutuhan | Keterangan |
|-----------|------------|
| Server berjalan | `npm start` atau `nodemon serverNew.js` |
| Port | 4000 (local) atau tunnel VS Code |
| Sentry DSN (opsional) | Set `SENTRY_DSN` di `.env` untuk kirim ke Sentry |
| Log berwarna | Terminal yang mendukung ANSI color codes |

**Environment variables yang relevan:**
```env
SENTRY_DSN=https://xxxxx@oyyy.ingest.sentry.io/zzz
NODE_ENV=development
PORT=4000
```

---

## 2. Cara Akses Endpoint

**Via VS Code Dev Tunnel:**
```
https://96fk6gq0-4000.asse.devtunnels.ms/api/testing/<endpoint>
```

**Via localhost:**
```
http://localhost:4000/api/testing/<endpoint>
```

**Lihat semua endpoint (index):**
```bash
curl http://localhost:4000/api/testing/
```

---

## 3. Semua Endpoint Testing

| # | Method | Path | Error Type | HTTP | Dikirim ke Sentry? |
|---|--------|------|------------|------|-------------------|
| 0 | GET | `/` | — | 200 | Tidak |
| 1 | GET | `/sync-error` | `Error` (sync throw) | 500 | ✅ Ya |
| 2 | GET | `/async-error` | `Error` (async) | 500 | ✅ Ya |
| 3 | GET | `/unhandled-rejection` | Process-level rejection | — | ✅ Ya (otomatis) |
| 4 | GET | `/validation-error` | `ValidationError` | 400 | ❌ Tidak (difilter) |
| 5 | GET | `/auth-error` | `AuthenticationError` | 401 | ❌ Tidak (difilter) |
| 6 | GET | `/authz-error` | `AuthorizationError` | 403 | ✅ Ya (security) |
| 7 | GET | `/not-found-error` | `NotFoundError` | 404 | ❌ Tidak (difilter) |
| 8 | GET | `/conflict-error` | `ConflictError` | 409 | ❌ Tidak |
| 9 | GET | `/database-error` | `DatabaseError` | 503 | ✅ Ya |
| 10 | GET | `/external-service-error` | `ExternalServiceError` | 502 | ✅ Ya |
| 11 | GET | `/timeout-error` | `TimeoutError` | 408 | ✅ Ya |
| 12 | GET | `/sentry-message` | — | 200 | ✅ Ya (manual) |
| 13 | GET | `/sentry-exception` | — | 200 | ✅ Ya (manual) |
| 14 | GET | `/performance-slow?delay=2000` | — | 200 | Tidak |
| 15 | GET | `/memory-info` | — | 200 | Hanya jika >200MB |
| 16 | GET | `/sentry-context` | — | 200 | ✅ Ya (demo) |
| 17 | GET | `/health` | — | 200/503 | Tidak |

---

## 4. Log yang Diharapkan per Endpoint

### TEST-1: `/sync-error`
```
2024-xx-xx  🔵 INFO  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
2024-xx-xx  🔵 INFO  ▶ TEST DIMULAI : TEST-1 Sync Error
2024-xx-xx  🔵 INFO     Method       : GET
2024-xx-xx  🔵 INFO     URL          : /api/testing/sync-error
2024-xx-xx  🟢 DEBUG    Akan melempar synchronous Error sekarang...
2024-xx-xx  🟡 WARN     ⚠️  Tentang melempar Error – ini DISENGAJA untuk testing!
2024-xx-xx  🔴 ERROR [req-xxx] UnhandledError | Error | Test sync error!
```

### TEST-2: `/async-error`
```
2024-xx-xx  🔵 INFO  ▶ TEST DIMULAI : TEST-2 Async Error
2024-xx-xx  🟢 DEBUG    Memulai operasi async...
2024-xx-xx  🟢 DEBUG    Menunggu 100ms (simulasi operasi async)...
2024-xx-xx  🟢 DEBUG    Operasi async selesai. Sekarang akan throw error...
2024-xx-xx  🟡 WARN     ⚠️  Melempar async Error – DISENGAJA untuk testing!
2024-xx-xx  🔴 ERROR    [errorHandler] UnhandledError | Test async error!
```

### TEST-3: `/unhandled-rejection`
```
2024-xx-xx  🔵 INFO  ▶ TEST DIMULAI : TEST-3 Unhandled Promise Rejection
2024-xx-xx  🟡 WARN     ⚠️  PERHATIAN: Akan membuat unhandled rejection!
2024-xx-xx  🟢 DEBUG    Membuat Promise yang reject tanpa .catch()...
2024-xx-xx  🔴 ERROR 🔴 UNHANDLED PROMISE REJECTION:
2024-xx-xx  🔴 ERROR   Reason : Error: INTENTIONAL unhandled rejection...
```

### TEST-4: `/validation-error`
```
2024-xx-xx  🔵 INFO  ▶ TEST DIMULAI : TEST-4 ValidationError (400)
2024-xx-xx  🟢 DEBUG    Mensimulasikan validasi input yang gagal...
2024-xx-xx  🟡 WARN     Validasi gagal: email tidak valid → akan throw ValidationError
2024-xx-xx  🟡 WARN  [errorHandler] ValidationError | Data yang dikirim tidak valid
```

### TEST-9: `/database-error`
```
2024-xx-xx  🔵 INFO  ▶ TEST DIMULAI : TEST-9 DatabaseError (503)
2024-xx-xx  🟢 DEBUG    Mencoba eksekusi query database...
2024-xx-xx  🔴 ERROR    ⚠️  Database query timeout setelah 5000ms → melempar DatabaseError
2024-xx-xx  🔴 ERROR    Detail error DB: MongoServerSelectionError...
2024-xx-xx  🔴 ERROR    Sentry akan menerima DatabaseError ini karena ini 5xx error
2024-xx-xx  🔴 ERROR [errorHandler] DatabaseError | Query timeout...
```

---

## 5. Yang Diharapkan di Sentry

### Cara membuka Sentry Dashboard:
1. Buka **https://sentry.io**
2. Masuk ke organisasi Anda
3. Klik **Issues** untuk melihat error

### Error yang akan muncul:

| Endpoint | Judul di Sentry | Level | Tags Penting |
|----------|----------------|-------|--------------|
| `/sync-error` | `Test sync error!` | error | route=/api/testing/sync-error |
| `/async-error` | `Test async error!` | error | route=/api/testing/async-error |
| `/unhandled-rejection` | `INTENTIONAL unhandled rejection` | error | type=unhandledRejection |
| `/authz-error` | `AuthorizationError` | error | errorCode=AUTHORIZATION_ERROR |
| `/database-error` | `DatabaseError: Query timeout...` | error | errorCode=DATABASE_ERROR |
| `/external-service-error` | `ExternalServiceError: Payment gateway timeout` | error | service=midtrans |
| `/timeout-error` | `TimeoutError: Operasi melebihi...` | error | errorCode=TIMEOUT_ERROR |
| `/sentry-message` | `[TESTING] Manual captureMessage` | warning | test_type=manual_message |
| `/sentry-exception` | `ManualTestError: Manual captureException` | error | test_type=manual_exception |
| `/sentry-context` | `[TESTING] Demo Sentry Context` | info | service=testing-module |

### Filter di Sentry:
- **Berdasarkan environment**: filter `environment = development`
- **Berdasarkan level**: filter `level = error` atau `level = warning`
- **Berdasarkan tag**: `errorCode = DATABASE_ERROR`
- **Berdasarkan route**: `route = /api/testing/*`

---

## 6. Cara Membaca Log

### Format Log:
```
[TIMESTAMP]  🔵 INFO  [requestId]  pesan
```

### Level indicators:
| Icon | Level | Warna | Kapan Muncul |
|------|-------|-------|-------------|
| 🔵 | INFO | Cyan | Informasi umum, alur eksekusi |
| 🟢 | DEBUG | Hijau | Detail teknis (hanya dev) |
| 🟡 | WARN | Kuning | Peringatan, error 4xx |
| 🔴 | ERROR | Merah | Error 5xx, crash |

### Request ID:
Setiap request punya ID unik (`req-xxxxxxxx`). Gunakan ini untuk:
- Melacak satu request dari awal sampai akhir
- Mencocokkan log server dengan error di Sentry
- Melaporkan ke support ("ada masalah dengan request ID ini")

### Breadcrumbs di Sentry:
Breadcrumbs adalah rekaman aktivitas sebelum error terjadi. Setiap endpoint testing
menambahkan breadcrumbs yang menjelaskan langkah-langkah yang dijalankan sebelum error.
Di Sentry, breadcrumbs muncul di bagian bawah detail event.

---

## 7. Pola Error Umum yang Perlu Diwaspadai

### 1. Error 5xx yang sering muncul
```
Tanda: Banyak issues di Sentry dengan level=error
Penyebab: Bug di kode, database down, external service timeout
Tindakan: Periksa stack trace di Sentry, cek logs server
```

### 2. Unhandled Promise Rejection
```
Tanda: Log "🔴 UNHANDLED PROMISE REJECTION"
Penyebab: async function tanpa try-catch, atau Promise tanpa .catch()
Tindakan: Tambahkan asyncHandler wrapper ke semua async routes
```

### 3. Memory usage tinggi (>200MB heap)
```
Tanda: endpoint /memory-info menampilkan warning
Penyebab: Memory leak – object besar tidak di-garbage collect
Tindakan: Profile dengan Chrome DevTools atau clinic.js
```

### 4. Sentry tidak menerima event
```
Tanda: Error muncul di log tapi tidak di Sentry dashboard
Penyebab: SENTRY_DSN tidak di-set di .env, atau DSN salah
Tindakan: 
  1. Periksa SENTRY_DSN di .env
  2. Cek log "[Sentry] Initialized | dsn=configured atau disabled"
  3. Pastikan Sentry project masih aktif
```

### 5. Terlalu banyak noise di Sentry
```
Tanda: Ribuan events untuk error yang sama berulang
Penyebab: Rate limiting, bot scanning, atau 404 untuk static files
Tindakan: 
  - Periksa beforeSend di config/sentry.js
  - Tambahkan filter URL/user-agent jika perlu
  - Gunakan rate limiting di Sentry project settings
```

---

## 8. Contoh Output Log Lengkap

Ketika Anda hit `/api/testing/database-error`, log akan terlihat seperti:

```
2024-01-15T10:30:45.123Z  🔵 INFO  [req-ab12cd34] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
2024-01-15T10:30:45.124Z  🔵 INFO  [req-ab12cd34] ▶ TEST DIMULAI : TEST-9 DatabaseError (503)
2024-01-15T10:30:45.124Z  🔵 INFO  [req-ab12cd34]    Method       : GET
2024-01-15T10:30:45.124Z  🔵 INFO  [req-ab12cd34]    URL          : /api/testing/database-error
2024-01-15T10:30:45.124Z  🔵 INFO  [req-ab12cd34]    IP           : ::ffff:127.0.0.1
2024-01-15T10:30:45.124Z  🟢 DEBUG [req-ab12cd34]    Mencoba eksekusi query database...
2024-01-15T10:30:45.125Z  🟢 DEBUG [req-ab12cd34]    Mensimulasikan query timeout (500ms)...
2024-01-15T10:30:45.276Z  🔴 ERROR [req-ab12cd34]    ⚠️  Database query timeout setelah 5000ms
2024-01-15T10:30:45.276Z  🔴 ERROR [req-ab12cd34]    Detail error DB: MongoServerSelectionError: connection timed out
2024-01-15T10:30:45.276Z  🔴 ERROR [req-ab12cd34]    Sentry akan menerima DatabaseError ini
2024-01-15T10:30:45.277Z  🔴 ERROR [req-ab12cd34] [errorHandler] DatabaseError | Query timeout pada collection 'penjualan'
```

Response yang dikembalikan:
```json
{
  "success": false,
  "errorCode": "DATABASE_ERROR",
  "message": "Terjadi gangguan pada sistem. Silakan coba beberapa saat lagi.",
  "requestId": "req-ab12cd34",
  "sentryEventId": "abc123..."
}
```

---

## Quick Commands

```bash
# Lihat semua endpoint
curl http://localhost:4000/api/testing/

# Test 1-3: Generic errors (muncul di Sentry)
curl http://localhost:4000/api/testing/sync-error
curl http://localhost:4000/api/testing/async-error
curl http://localhost:4000/api/testing/unhandled-rejection

# Test 4-11: Custom error classes
curl http://localhost:4000/api/testing/validation-error
curl http://localhost:4000/api/testing/database-error
curl http://localhost:4000/api/testing/external-service-error

# Test 12-13: Manual Sentry
curl http://localhost:4000/api/testing/sentry-message
curl http://localhost:4000/api/testing/sentry-exception

# Test 14: Performance (sesuaikan delay dalam ms)
curl "http://localhost:4000/api/testing/performance-slow?delay=3000"

# Test 15-17: Info
curl http://localhost:4000/api/testing/memory-info
curl http://localhost:4000/api/testing/sentry-context
curl http://localhost:4000/api/testing/health

# Dengan VS Code Dev Tunnel
BASE="https://96fk6gq0-4000.asse.devtunnels.ms"
curl $BASE/api/testing/database-error
curl $BASE/api/testing/sentry-message
```
