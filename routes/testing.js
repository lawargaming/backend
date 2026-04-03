/**
 * routes/testing.js
 * -----------------
 * Endpoint pengujian error handling & Sentry integration.
 *
 * TUJUAN:
 *   Memudahkan developer melihat SETIAP jenis error yang mungkin terjadi
 *   di backend, lengkap dengan log detail dan capture ke Sentry.
 *
 * MOUNT PATH (otomatis oleh routes/index.js):
 *   /api/testing/<endpoint>
 *
 * CARA AKSES (contoh dengan VS Code tunnel):
 *   https://96fk6gq0-4000.asse.devtunnels.ms/api/testing/<endpoint>
 *
 * DAFTAR ENDPOINT:
 *   GET  /api/testing/                        → list semua endpoint
 *   GET  /api/testing/sync-error              → 1. Synchronous throw
 *   GET  /api/testing/async-error             → 2. Async / Promise rejection
 *   GET  /api/testing/unhandled-rejection     → 3. Unhandled promise rejection
 *   GET  /api/testing/validation-error        → 4. ValidationError class
 *   GET  /api/testing/auth-error              → 5. AuthenticationError class
 *   GET  /api/testing/authz-error             → 6. AuthorizationError class
 *   GET  /api/testing/not-found-error         → 7. NotFoundError class
 *   GET  /api/testing/conflict-error          → 8. ConflictError class
 *   GET  /api/testing/database-error          → 9. DatabaseError class
 *   GET  /api/testing/external-service-error  → 10. ExternalServiceError class
 *   GET  /api/testing/timeout-error           → 11. TimeoutError class
 *   GET  /api/testing/sentry-message          → 12. Manual Sentry.captureMessage
 *   GET  /api/testing/sentry-exception        → 13. Manual Sentry.captureException
 *   GET  /api/testing/performance-slow        → 14. Slow endpoint (performance monitoring)
 *   GET  /api/testing/memory-info             → 15. Memory usage snapshot
 *   GET  /api/testing/sentry-context          → 16. Sentry user/tag/breadcrumb context
 *   GET  /api/testing/health                  → 17. Health check dengan detail sistem
 */

"use strict";

const express  = require("express");
const router   = express.Router();
const { Sentry, captureError, addBreadcrumb } = require("../config/sentry");
const logger   = require("../utils/logger");
const {
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  DatabaseError,
  ExternalServiceError,
  TimeoutError,
} = require("../config/errorClasses");

// ============================================================
// HELPER: bungkus async handler agar error di-forward ke next()
// ============================================================

/**
 * asyncHandler – Wrapper untuk async route handler.
 * Tanpa ini, error dari async function tidak akan sampai ke errorHandler.
 *
 * @param {Function} fn - Async route handler
 * @returns {Function}
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// ============================================================
// HELPER: log entry / exit setiap endpoint
// ============================================================

/**
 * logEntry – Catat bahwa sebuah endpoint dipanggil.
 * @param {import('express').Request} req
 * @param {string} testName - Nama test yang sedang berjalan
 */
function logEntry(req, testName) {
  const log = logger.withReqId(req.requestId);
  log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  log.info(`▶  TEST DIMULAI : ${testName}`);
  log.info(`   Method       : ${req.method}`);
  log.info(`   URL          : ${req.originalUrl}`);
  log.info(`   IP           : ${req.ip}`);
  log.info(`   User-Agent   : ${req.headers["user-agent"] || "-"}`);
  log.debug(`   Headers      :`, JSON.stringify(req.headers, null, 2));
}

/**
 * logExit – Catat bahwa sebuah endpoint selesai dengan sukses.
 * @param {string} requestId
 * @param {string} testName
 * @param {number} startMs - process.hrtime.bigint() start
 */
function logExit(requestId, testName, startMs) {
  const elapsed = Number(process.hrtime.bigint() - startMs) / 1e6; // ns → ms
  const log = logger.withReqId(requestId);
  log.info(`✔  TEST SELESAI : ${testName} | durasi=${elapsed.toFixed(2)}ms`);
  log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
}

// ============================================================
// 0. INDEX – daftar semua endpoint
// ============================================================

router.get("/", (req, res) => {
  const log = logger.withReqId(req.requestId);
  log.info("▶ Menampilkan daftar endpoint testing");

  res.json({
    success: true,
    message: "Daftar endpoint testing Sentry & error handling",
    baseUrl: "/api/testing",
    endpoints: [
      { method: "GET", path: "/sync-error",             description: "1. Synchronous throw (uncaught style)" },
      { method: "GET", path: "/async-error",            description: "2. Async error / Promise rejection" },
      { method: "GET", path: "/unhandled-rejection",    description: "3. Unhandled promise rejection (process-level)" },
      { method: "GET", path: "/validation-error",       description: "4. ValidationError (400)" },
      { method: "GET", path: "/auth-error",             description: "5. AuthenticationError (401)" },
      { method: "GET", path: "/authz-error",            description: "6. AuthorizationError (403)" },
      { method: "GET", path: "/not-found-error",        description: "7. NotFoundError (404)" },
      { method: "GET", path: "/conflict-error",         description: "8. ConflictError (409)" },
      { method: "GET", path: "/database-error",         description: "9. DatabaseError (503)" },
      { method: "GET", path: "/external-service-error", description: "10. ExternalServiceError (502)" },
      { method: "GET", path: "/timeout-error",          description: "11. TimeoutError (408)" },
      { method: "GET", path: "/sentry-message",         description: "12. Manual Sentry.captureMessage" },
      { method: "GET", path: "/sentry-exception",       description: "13. Manual Sentry.captureException" },
      { method: "GET", path: "/performance-slow",       description: "14. Slow endpoint (performance monitoring)" },
      { method: "GET", path: "/memory-info",            description: "15. Memory usage snapshot" },
      { method: "GET", path: "/sentry-context",         description: "16. Sentry user/tag/breadcrumb context demo" },
      { method: "GET", path: "/health",                 description: "17. Health check dengan detail sistem" },
    ],
    tip: "Buka https://sentry.io untuk melihat error yang ter-capture",
  });
});

// ============================================================
// TEST 1: Synchronous throw
// ============================================================

/**
 * GET /api/testing/sync-error
 *
 * Apa yang diuji:
 *   Throw Error biasa secara synchronous. Express menangkapnya dan
 *   meneruskan ke errorHandler → Sentry akan meng-capture-nya.
 *
 * Yang terlihat di log:
 *   [🔵 INFO ] ▶ TEST DIMULAI : TEST-1 Sync Error
 *   [🔴 ERROR] [errorHandler] UnhandledError | Test sync error!
 *
 * Yang terlihat di Sentry:
 *   Issue baru: "Test sync error!" | level=error | route=/api/testing/sync-error
 */
router.get("/sync-error", (req, res, next) => {
  const start = process.hrtime.bigint();
  logEntry(req, "TEST-1 Sync Error");
  const log = logger.withReqId(req.requestId);

  log.debug("Akan melempar synchronous Error sekarang...");

  // Tambahkan breadcrumb sebelum error agar terjejak di Sentry
  addBreadcrumb(
    "Memicu sync error untuk testing",
    { endpoint: "/sync-error", requestId: req.requestId },
    "testing",
    "info"
  );

  log.warn("⚠️  Tentang melempar Error – ini DISENGAJA untuk testing!");

  // Ini akan di-catch oleh Express dan diteruskan ke errorHandler
  throw new Error("Test sync error! Ini adalah synchronous throw untuk testing Sentry.");

  // Baris ini tidak akan pernah dieksekusi
  logExit(req.requestId, "TEST-1 Sync Error", start); // eslint-disable-line no-unreachable
  void(next); // eslint-disable-line no-unused-expressions
});

// ============================================================
// TEST 2: Async error / Promise rejection
// ============================================================

/**
 * GET /api/testing/async-error
 *
 * Apa yang diuji:
 *   Error di dalam async function. Tanpa asyncHandler, ini tidak akan
 *   sampai ke errorHandler. Dengan asyncHandler, error diteruskan via next().
 *
 * Yang terlihat di log:
 *   [🔵 INFO ] ▶ TEST DIMULAI : TEST-2 Async Error
 *   [🟢 DEBUG] Menjalankan async operation...
 *   [🔴 ERROR] [errorHandler] UnhandledError | Test async error!
 */
router.get("/async-error", asyncHandler(async (req, res) => {
  const start = process.hrtime.bigint();
  logEntry(req, "TEST-2 Async Error");
  const log = logger.withReqId(req.requestId);

  log.debug("Memulai operasi async...");
  addBreadcrumb("Memulai async operation", {}, "testing", "info");

  // Simulasi operasi async (misal: query database)
  log.debug("Menunggu 100ms (simulasi operasi async)...");
  await new Promise((resolve) => setTimeout(resolve, 100));

  log.debug("Operasi async selesai. Sekarang akan throw error...");
  addBreadcrumb("Async operation selesai, akan throw error", {}, "testing", "warning");

  log.warn("⚠️  Melempar async Error – DISENGAJA untuk testing!");

  // Error di async function – diteruskan ke next() oleh asyncHandler
  throw new Error("Test async error! Ini adalah async Promise rejection untuk testing Sentry.");

  logExit(req.requestId, "TEST-2 Async Error", start); // eslint-disable-line no-unreachable
}));

// ============================================================
// TEST 3: Unhandled Promise Rejection (process-level)
// ============================================================

/**
 * GET /api/testing/unhandled-rejection
 *
 * Apa yang diuji:
 *   Promise rejection yang TIDAK di-handle (tidak ada .catch() atau try-catch).
 *   Ini akan muncul di process.on('unhandledRejection') di serverNew.js.
 *   Di development, server tidak akan crash (hanya log). Di production, akan exit.
 *
 * Yang terlihat di log:
 *   [🔵 INFO ] ▶ TEST DIMULAI : TEST-3 Unhandled Rejection
 *   [🔴 ERROR] 🔴 UNHANDLED PROMISE REJECTION: ...
 *
 * Yang terlihat di Sentry:
 *   Sentry secara otomatis menangkap unhandledRejection
 *
 * ⚠️  PERHATIAN: Di production, ini bisa menyebabkan server restart!
 *     Hanya gunakan di development.
 */
router.get("/unhandled-rejection", (req, res) => {
  const start = process.hrtime.bigint();
  logEntry(req, "TEST-3 Unhandled Promise Rejection");
  const log = logger.withReqId(req.requestId);

  log.warn("⚠️  PERHATIAN: Akan membuat unhandled rejection!");
  log.warn("   Di production, ini bisa menyebabkan server restart.");
  log.debug("Membuat Promise yang reject tanpa .catch()...");

  addBreadcrumb(
    "Membuat unhandled promise rejection",
    { warning: "server mungkin restart di production" },
    "testing",
    "warning"
  );

  // Promise ini sengaja TIDAK di-await dan TIDAK punya .catch()
  // Hasilnya: process 'unhandledRejection' event terpanggil
  Promise.reject(new Error("INTENTIONAL unhandled rejection – untuk testing process-level handler!"));

  log.debug("Promise rejection sudah dibuat. Server masih jalan (lihat log proses).");
  logExit(req.requestId, "TEST-3 Unhandled Rejection", start);

  res.status(202).json({
    success: true,
    message: "Unhandled rejection sudah dibuat. Lihat log server dan Sentry!",
    note: "Di production, ini bisa menyebabkan server restart.",
  });
});

// ============================================================
// TEST 4: ValidationError (400)
// ============================================================

/**
 * GET /api/testing/validation-error
 *
 * Apa yang diuji:
 *   ValidationError dari config/errorClasses.js.
 *   Status 400, errorCode=VALIDATION_ERROR.
 *   Tidak dikirim ke Sentry (4xx operational error yang difilter).
 *
 * Yang terlihat di log:
 *   [🟡 WARN ] [errorHandler] ValidationError | Data tidak valid
 *
 * Yang terlihat di Sentry:
 *   Tidak ada (difilter oleh beforeSend di config/sentry.js – 400 diabaikan)
 */
router.get("/validation-error", asyncHandler(async (req, res) => {
  const start = process.hrtime.bigint();
  logEntry(req, "TEST-4 ValidationError (400)");
  const log = logger.withReqId(req.requestId);

  log.debug("Mensimulasikan validasi input yang gagal...");
  log.debug("Misal: email tidak valid, field required kosong, dll.");

  addBreadcrumb("Validasi input gagal", { field: "email", value: "bukan-email" }, "validation", "warning");

  log.warn("Validasi gagal: email tidak valid → akan throw ValidationError");

  // Lempar ValidationError – errorHandler akan handle ini sebagai 400
  throw new ValidationError(
    "Email 'bukan-email' tidak valid (simulasi testing)",
    {
      field: "email",
      value: "bukan-email",
      rule: "isEmail",
      errors: ["Format email tidak valid", "Email harus mengandung @"],
    }
  );

  logExit(req.requestId, "TEST-4 ValidationError", start); // eslint-disable-line no-unreachable
}));

// ============================================================
// TEST 5: AuthenticationError (401)
// ============================================================

/**
 * GET /api/testing/auth-error
 *
 * Apa yang diuji:
 *   AuthenticationError (401) – user tidak ter-autentikasi.
 *
 * Yang terlihat di log:
 *   [🟡 WARN ] AuthenticationError | Token JWT tidak ditemukan
 *
 * Yang terlihat di Sentry:
 *   Tidak ada (401 difilter)
 */
router.get("/auth-error", asyncHandler(async (req, res) => {
  const start = process.hrtime.bigint();
  logEntry(req, "TEST-5 AuthenticationError (401)");
  const log = logger.withReqId(req.requestId);

  log.debug("Memeriksa token autentikasi...");

  const token = req.headers.authorization;
  log.debug(`Authorization header: ${token || "(tidak ada)"}`);

  addBreadcrumb("Token tidak ditemukan di header", { headerPresent: !!token }, "auth", "warning");

  log.warn("Token tidak ada → melempar AuthenticationError");

  throw new AuthenticationError(
    "Token JWT tidak ditemukan atau sudah kadaluarsa (simulasi testing)",
    { headerPresent: false, endpoint: req.path }
  );

  logExit(req.requestId, "TEST-5 AuthenticationError", start); // eslint-disable-line no-unreachable
}));

// ============================================================
// TEST 6: AuthorizationError (403)
// ============================================================

/**
 * GET /api/testing/authz-error
 *
 * Apa yang diuji:
 *   AuthorizationError (403) – user login tapi tidak punya izin.
 *
 * Yang terlihat di log:
 *   [🟡 WARN ] AuthorizationError | User tidak punya izin admin
 *
 * Yang terlihat di Sentry:
 *   403 dikirim ke Sentry (security monitoring) – tidak ada di IGNORABLE_STATUS_CODES
 */
router.get("/authz-error", asyncHandler(async (req, res) => {
  const start = process.hrtime.bigint();
  logEntry(req, "TEST-6 AuthorizationError (403)");
  const log = logger.withReqId(req.requestId);

  const simulatedUser = { id: "user-123", role: "staff", email: "staff@example.com" };
  log.debug("User ter-autentikasi:", simulatedUser);
  log.debug("Endpoint ini butuh role=admin, user punya role=staff");

  // Set user context di Sentry
  Sentry.setUser({
    id: simulatedUser.id,
    email: simulatedUser.email,
    role: simulatedUser.role,
  });

  addBreadcrumb(
    "Authorization check gagal",
    { userId: simulatedUser.id, userRole: simulatedUser.role, requiredRole: "admin" },
    "auth",
    "warning"
  );

  log.warn(`User ${simulatedUser.id} (role=staff) mencoba akses resource admin → ditolak`);

  throw new AuthorizationError(
    "User role=staff tidak punya izin akses endpoint admin (simulasi testing)",
    {
      userId: simulatedUser.id,
      userRole: simulatedUser.role,
      requiredPermission: "admin:read",
    }
  );

  logExit(req.requestId, "TEST-6 AuthorizationError", start); // eslint-disable-line no-unreachable
}));

// ============================================================
// TEST 7: NotFoundError (404)
// ============================================================

/**
 * GET /api/testing/not-found-error
 *
 * Apa yang diuji:
 *   NotFoundError (404) – resource tidak ditemukan.
 *
 * Yang terlihat di log:
 *   [🟡 WARN ] NotFoundError | Produk dengan ID tidak ditemukan
 *
 * Yang terlihat di Sentry:
 *   Tidak ada (404 difilter oleh beforeSend)
 */
router.get("/not-found-error", asyncHandler(async (req, res) => {
  const start = process.hrtime.bigint();
  logEntry(req, "TEST-7 NotFoundError (404)");
  const log = logger.withReqId(req.requestId);

  const resourceId = "produk-abc-999-tidak-ada";
  log.debug(`Mencari resource dengan ID: ${resourceId}`);

  addBreadcrumb(
    "Query resource ke database",
    { resourceId, collection: "produk" },
    "database",
    "info"
  );

  log.debug("Query MongoDB... (simulasi)");
  // Simulasi: hasil query null
  const result = null;

  log.debug(`Hasil query: ${result}`);
  log.warn(`Resource ID=${resourceId} tidak ditemukan → melempar NotFoundError`);

  addBreadcrumb("Resource tidak ditemukan di database", { resourceId }, "database", "warning");

  throw new NotFoundError(
    `Produk dengan ID '${resourceId}' tidak ditemukan (simulasi testing)`,
    { id: resourceId, collection: "produk" }
  );

  logExit(req.requestId, "TEST-7 NotFoundError", start); // eslint-disable-line no-unreachable
}));

// ============================================================
// TEST 8: ConflictError (409)
// ============================================================

/**
 * GET /api/testing/conflict-error
 *
 * Apa yang diuji:
 *   ConflictError (409) – data duplikat.
 *
 * Yang terlihat di log:
 *   [🟡 WARN ] ConflictError | Email sudah terdaftar
 */
router.get("/conflict-error", asyncHandler(async (req, res) => {
  const start = process.hrtime.bigint();
  logEntry(req, "TEST-8 ConflictError (409)");
  const log = logger.withReqId(req.requestId);

  const email = "duplicate@example.com";
  log.debug(`Mendaftarkan user baru dengan email: ${email}`);

  addBreadcrumb("Memeriksa duplikat email", { email }, "database", "info");

  // Simulasi: email sudah ada di database
  const existingUser = { id: "user-existing-001", email };
  log.debug(`User dengan email ini sudah ada: ID=${existingUser.id}`);
  log.warn(`Konflik: email '${email}' sudah terdaftar → melempar ConflictError`);

  addBreadcrumb("Email duplikat ditemukan", { email, existingUserId: existingUser.id }, "database", "warning");

  throw new ConflictError(
    `Email '${email}' sudah terdaftar di sistem (simulasi testing)`,
    { field: "email", value: email, existingUserId: existingUser.id }
  );

  logExit(req.requestId, "TEST-8 ConflictError", start); // eslint-disable-line no-unreachable
}));

// ============================================================
// TEST 9: DatabaseError (503)
// ============================================================

/**
 * GET /api/testing/database-error
 *
 * Apa yang diuji:
 *   DatabaseError (503) – operasi database gagal.
 *   Ini adalah 5xx error → DIKIRIM ke Sentry.
 *
 * Yang terlihat di log:
 *   [🔴 ERROR] DatabaseError | Query timeout
 *
 * Yang terlihat di Sentry:
 *   Issue: "Query timeout pada collection penjualan" | level=error
 */
router.get("/database-error", asyncHandler(async (req, res) => {
  const start = process.hrtime.bigint();
  logEntry(req, "TEST-9 DatabaseError (503)");
  const log = logger.withReqId(req.requestId);

  log.debug("Mencoba eksekusi query database...");
  addBreadcrumb("Eksekusi query MongoDB dimulai", { operation: "find", collection: "penjualan" }, "database", "info");

  log.debug("Mensimulasikan query timeout (500ms)...");
  await new Promise((resolve) => setTimeout(resolve, 150)); // simulasi delay

  log.error("⚠️  Database query timeout setelah 5000ms → melempar DatabaseError");
  addBreadcrumb("Database query timeout", { timeoutMs: 5000 }, "database", "error");

  // Simulasi original error dari mongoose
  const originalDbErr = new Error("MongoServerSelectionError: connection timed out after 5000ms");
  originalDbErr.name = "MongoServerSelectionError";

  log.error(`Detail error DB: ${originalDbErr.message}`);
  log.error("Sentry akan menerima DatabaseError ini karena ini 5xx error");

  throw new DatabaseError(
    "Query timeout pada collection 'penjualan' setelah 5000ms (simulasi testing)",
    {
      operation: "find",
      collection: "penjualan",
      filter: { tanggal: "2024-01-01" },
      timeoutMs: 5000,
    },
    { severity: "high" },
    originalDbErr
  );

  logExit(req.requestId, "TEST-9 DatabaseError", start); // eslint-disable-line no-unreachable
}));

// ============================================================
// TEST 10: ExternalServiceError (502)
// ============================================================

/**
 * GET /api/testing/external-service-error
 *
 * Apa yang diuji:
 *   ExternalServiceError (502) – third-party API gagal.
 *   Ini adalah 5xx error → DIKIRIM ke Sentry.
 *
 * Yang terlihat di log:
 *   [🔴 ERROR] ExternalServiceError | Payment gateway timeout
 *
 * Yang terlihat di Sentry:
 *   Issue: "Payment gateway timeout" | tags: service=midtrans
 */
router.get("/external-service-error", asyncHandler(async (req, res) => {
  const start = process.hrtime.bigint();
  logEntry(req, "TEST-10 ExternalServiceError (502)");
  const log = logger.withReqId(req.requestId);

  log.debug("Menghubungi payment gateway (Midtrans simulasi)...");
  addBreadcrumb(
    "Mengirim request ke payment gateway",
    { service: "midtrans", endpoint: "/v2/charge", method: "POST" },
    "external-service",
    "info"
  );

  log.debug("Menunggu respons dari Midtrans... (simulasi 200ms)");
  await new Promise((resolve) => setTimeout(resolve, 200));

  log.error("Payment gateway tidak merespons dalam 10 detik → timeout!");
  addBreadcrumb(
    "Payment gateway timeout",
    { service: "midtrans", timeoutMs: 10000 },
    "external-service",
    "error"
  );

  const originalHttpErr = new Error("connect ETIMEDOUT 103.28.8.208:443");
  originalHttpErr.name = "RequestTimeoutError";

  // Set tags agar mudah di-filter di Sentry
  Sentry.setTag("external_service", "midtrans");
  Sentry.setTag("service_operation", "payment_charge");

  log.error(`HTTP Error dari Midtrans: ${originalHttpErr.message}`);
  log.error("Sentry akan menerima ExternalServiceError ini dengan tag service=midtrans");

  throw new ExternalServiceError(
    "Payment gateway Midtrans timeout setelah 10000ms (simulasi testing)",
    {
      service: "midtrans",
      endpoint: "/v2/charge",
      statusCode: 504,
      timeoutMs: 10000,
    },
    { criticalPath: true },
    originalHttpErr
  );

  logExit(req.requestId, "TEST-10 ExternalServiceError", start); // eslint-disable-line no-unreachable
}));

// ============================================================
// TEST 11: TimeoutError (408)
// ============================================================

/**
 * GET /api/testing/timeout-error
 *
 * Apa yang diuji:
 *   TimeoutError (408) – operasi melebihi batas waktu yang ditentukan.
 *
 * Yang terlihat di log:
 *   [🔴 ERROR] TimeoutError | Operasi melebihi batas waktu
 */
router.get("/timeout-error", asyncHandler(async (req, res) => {
  const start = process.hrtime.bigint();
  logEntry(req, "TEST-11 TimeoutError (408)");
  const log = logger.withReqId(req.requestId);

  const TIMEOUT_MS = 3000;
  log.debug(`Batas waktu operasi: ${TIMEOUT_MS}ms`);
  addBreadcrumb("Memulai operasi dengan timeout", { timeoutMs: TIMEOUT_MS }, "timeout", "info");

  log.debug("Mensimulasikan operasi yang berjalan terlalu lama (250ms simulasi)...");
  await new Promise((resolve) => setTimeout(resolve, 250));

  log.warn(`Operasi sudah melebihi ${TIMEOUT_MS}ms → melempar TimeoutError`);
  addBreadcrumb("Operasi timeout terdeteksi", { elapsed: TIMEOUT_MS }, "timeout", "warning");

  throw new TimeoutError(
    `Operasi 'generateLaporanBulanan' melebihi batas ${TIMEOUT_MS}ms (simulasi testing)`,
    { operation: "generateLaporanBulanan", timeoutMs: TIMEOUT_MS }
  );

  logExit(req.requestId, "TEST-11 TimeoutError", start); // eslint-disable-line no-unreachable
}));

// ============================================================
// TEST 12: Manual Sentry.captureMessage
// ============================================================

/**
 * GET /api/testing/sentry-message
 *
 * Apa yang diuji:
 *   Sentry.captureMessage – kirim pesan manual ke Sentry tanpa throw error.
 *   Berguna untuk mencatat kejadian penting (bukan error) ke Sentry.
 *
 * Yang terlihat di log:
 *   [🔵 INFO ] Mengirim pesan ke Sentry...
 *   [🟢 DEBUG] Sentry message berhasil dikirim
 *
 * Yang terlihat di Sentry:
 *   Message: "Testing manual captureMessage" | level=warning
 */
router.get("/sentry-message", asyncHandler(async (req, res) => {
  const start = process.hrtime.bigint();
  logEntry(req, "TEST-12 Manual Sentry.captureMessage");
  const log = logger.withReqId(req.requestId);

  log.info("Mengirim pesan warning ke Sentry via captureMessage...");

  // Set context sebelum capture agar pesan punya konteks lengkap
  Sentry.setTag("test_type", "manual_message");
  Sentry.setTag("triggered_by", "developer_testing");

  addBreadcrumb(
    "Developer memicu manual Sentry message",
    { requestId: req.requestId, endpoint: "/sentry-message" },
    "testing",
    "info"
  );

  // Kirim pesan ke Sentry dengan level "warning"
  // Level: 'fatal' | 'error' | 'warning' | 'info' | 'debug' | 'log'
  const eventId = Sentry.captureMessage(
    `[TESTING] Manual captureMessage dari endpoint /api/testing/sentry-message | requestId=${req.requestId}`,
    "warning"
  );

  log.debug(`Sentry captureMessage berhasil. Event ID: ${eventId || "(disabled/no DSN)"}`);
  log.info("Cek Sentry dashboard → Issues → filter by level=warning");

  logExit(req.requestId, "TEST-12 Sentry.captureMessage", start);

  res.json({
    success: true,
    test: "sentry-message",
    message: "Pesan berhasil dikirim ke Sentry (level=warning)",
    sentryEventId: eventId || null,
    note: "Buka Sentry dashboard untuk melihat pesan ini. Jika DSN tidak di-set, event tidak terkirim.",
  });
}));

// ============================================================
// TEST 13: Manual Sentry.captureException
// ============================================================

/**
 * GET /api/testing/sentry-exception
 *
 * Apa yang diuji:
 *   Sentry.captureException manual – capture exception TANPA melempar error
 *   ke user. Server tetap berjalan normal, exception hanya dicatat di Sentry.
 *
 * Yang terlihat di log:
 *   [🔵 INFO ] Menangkap exception manual ke Sentry...
 *   [🟢 DEBUG] Sentry captureException berhasil
 *
 * Yang terlihat di Sentry:
 *   Exception: "Manual captureException untuk testing" | level=error
 */
router.get("/sentry-exception", asyncHandler(async (req, res) => {
  const start = process.hrtime.bigint();
  logEntry(req, "TEST-13 Manual Sentry.captureException");
  const log = logger.withReqId(req.requestId);

  log.info("Membuat Error object dan men-capture ke Sentry secara manual...");

  const testError = new Error("[TESTING] Manual captureException – server tetap jalan, hanya dikirim ke Sentry!");
  testError.name = "ManualTestError";

  log.debug(`Error dibuat: name=${testError.name} | message=${testError.message}`);

  addBreadcrumb(
    "Manual captureException dipanggil",
    { errorName: testError.name },
    "testing",
    "info"
  );

  // captureError = wrapper di config/sentry.js yang set context sebelum capture
  captureError(testError, {
    level: "error",
    tags: {
      test_type: "manual_exception",
      endpoint: "/sentry-exception",
    },
    extra: {
      requestId: req.requestId,
      userAgent: req.headers["user-agent"],
      timestamp: new Date().toISOString(),
    },
  });

  log.debug("Sentry.captureException berhasil dipanggil.");
  log.info("Error TIDAK dilempar ke user – server tetap berjalan normal.");
  log.info("Cek Sentry dashboard → Issues untuk melihat exception ini.");

  logExit(req.requestId, "TEST-13 Sentry.captureException", start);

  res.json({
    success: true,
    test: "sentry-exception",
    message: "Exception berhasil di-capture ke Sentry tanpa menghentikan server",
    errorName: testError.name,
    note: "Buka Sentry dashboard → Issues. Error ini ter-capture tapi server tetap merespons 200 OK.",
  });
}));

// ============================================================
// TEST 14: Slow endpoint (performance monitoring)
// ============================================================

/**
 * GET /api/testing/performance-slow?delay=2000
 *
 * Query params:
 *   delay - delay dalam milidetik (default: 2000, max: 10000)
 *
 * Apa yang diuji:
 *   Endpoint yang lambat untuk testing performance monitoring di Sentry.
 *   Sentry akan mencatat durasi transaksi ini dan menandainya sebagai "slow"
 *   jika melebihi threshold.
 *
 * Yang terlihat di log:
 *   [🔵 INFO ] Memulai operasi lambat...
 *   [🔵 INFO ] Operasi selesai setelah Xms
 *
 * Yang terlihat di Sentry:
 *   Performance → Transactions → endpoint ini akan tampil dengan durasi tinggi
 */
router.get("/performance-slow", asyncHandler(async (req, res) => {
  const start = process.hrtime.bigint();
  logEntry(req, "TEST-14 Slow Endpoint (Performance Monitoring)");
  const log = logger.withReqId(req.requestId);

  // Baca delay dari query param, default 2000ms, max 10000ms
  const rawDelay = parseInt(req.query.delay, 10);
  const delay = isNaN(rawDelay) ? 2000 : Math.min(Math.max(rawDelay, 0), 10000);

  log.info(`Delay yang diminta: ${delay}ms (query ?delay=${req.query.delay || "default"})`);
  log.debug(`Delay aktual setelah sanitasi: ${delay}ms`);

  addBreadcrumb("Memulai operasi lambat simulasi", { delayMs: delay }, "performance", "info");

  // Simulasi tahap-tahap operasi lambat
  const stages = [
    { name: "Fetch data dari DB",        portion: 0.4 },
    { name: "Kalkulasi laporan bulanan", portion: 0.3 },
    { name: "Generate PDF",              portion: 0.2 },
    { name: "Upload ke storage",         portion: 0.1 },
  ];

  log.info("Memulai simulasi multi-stage operation:");

  for (const stage of stages) {
    const stageDuration = Math.round(delay * stage.portion);
    log.info(`  → ${stage.name} (${stageDuration}ms)...`);

    addBreadcrumb(`Stage: ${stage.name}`, { durationMs: stageDuration }, "performance", "info");

    await new Promise((resolve) => setTimeout(resolve, stageDuration));

    log.info(`  ✔ ${stage.name} selesai`);
  }

  const totalElapsed = Number(process.hrtime.bigint() - start) / 1e6;
  log.info(`✔ Semua stage selesai. Total waktu: ${totalElapsed.toFixed(2)}ms`);
  log.info("Cek Sentry → Performance → Transactions untuk melihat durasi endpoint ini.");

  addBreadcrumb("Operasi lambat selesai", { totalElapsedMs: Math.round(totalElapsed) }, "performance", "info");

  logExit(req.requestId, "TEST-14 Slow Endpoint", start);

  res.json({
    success: true,
    test: "performance-slow",
    requestedDelay: rawDelay || "default (2000ms)",
    actualDelay: delay,
    totalElapsedMs: Math.round(totalElapsed),
    stages: stages.map((s) => ({
      name: s.name,
      durationMs: Math.round(delay * s.portion),
    })),
    note: "Buka Sentry → Performance → Transactions untuk melihat durasi ini.",
  });
}));

// ============================================================
// TEST 15: Memory info snapshot
// ============================================================

/**
 * GET /api/testing/memory-info
 *
 * Apa yang diuji:
 *   Snapshot penggunaan memory saat ini. Berguna untuk monitoring dan
 *   mendeteksi memory leak selama testing.
 *
 * Yang terlihat di log:
 *   [🔵 INFO ] Memory usage saat ini: heapUsed=XXmb
 */
router.get("/memory-info", asyncHandler(async (req, res) => {
  const start = process.hrtime.bigint();
  logEntry(req, "TEST-15 Memory Info Snapshot");
  const log = logger.withReqId(req.requestId);

  log.debug("Mengambil snapshot process.memoryUsage()...");

  const raw = process.memoryUsage();

  // Konversi bytes ke MB untuk keterbacaan
  const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

  const memory = {
    rss:          { bytes: raw.rss,          human: mb(raw.rss) },
    heapTotal:    { bytes: raw.heapTotal,     human: mb(raw.heapTotal) },
    heapUsed:     { bytes: raw.heapUsed,      human: mb(raw.heapUsed) },
    external:     { bytes: raw.external,      human: mb(raw.external) },
    arrayBuffers: { bytes: raw.arrayBuffers,  human: mb(raw.arrayBuffers) },
  };

  log.info(`Memory Snapshot:`);
  log.info(`  RSS          : ${memory.rss.human}           (total memory proses, termasuk C++ library)`);
  log.info(`  Heap Total   : ${memory.heapTotal.human}     (total heap V8 yang dialokasikan)`);
  log.info(`  Heap Used    : ${memory.heapUsed.human}      (heap V8 yang sedang dipakai – ini yang penting!)`);
  log.info(`  External     : ${memory.external.human}      (memory C++ objects terhubung ke V8)`);
  log.info(`  Array Buffers: ${memory.arrayBuffers.human}  (Buffer/ArrayBuffer yang dialokasikan)`);

  // Peringatan jika heap usage tinggi (> 200MB)
  const heapUsedMb = raw.heapUsed / 1024 / 1024;
  if (heapUsedMb > 200) {
    log.warn(`⚠️  Heap usage tinggi: ${heapUsedMb.toFixed(1)}MB > 200MB. Periksa potensi memory leak!`);
    addBreadcrumb(
      "Memory usage tinggi terdeteksi",
      { heapUsedMb: heapUsedMb.toFixed(1) },
      "memory",
      "warning"
    );
    Sentry.captureMessage(
      `[TESTING] Memory usage tinggi: heapUsed=${heapUsedMb.toFixed(1)}MB`,
      "warning"
    );
  } else {
    log.debug(`Heap usage normal: ${heapUsedMb.toFixed(1)}MB`);
  }

  const uptime = process.uptime();
  log.info(`Uptime proses: ${uptime.toFixed(1)}s (${(uptime / 60).toFixed(1)} menit)`);

  logExit(req.requestId, "TEST-15 Memory Info", start);

  res.json({
    success: true,
    test: "memory-info",
    memory,
    uptime: { seconds: Math.round(uptime), human: `${(uptime / 60).toFixed(1)} menit` },
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
  });
}));

// ============================================================
// TEST 16: Sentry context demo (user, tags, breadcrumbs)
// ============================================================

/**
 * GET /api/testing/sentry-context
 *
 * Apa yang diuji:
 *   Cara men-set user context, tags, dan breadcrumbs di Sentry.
 *   Sangat berguna agar setiap error punya konteks siapa yang melakukan apa.
 *
 * Yang terlihat di log:
 *   [🔵 INFO ] Setting Sentry user context...
 *   [🟢 DEBUG] Sentry context berhasil di-set
 *
 * Yang terlihat di Sentry:
 *   Pesan dengan user context, custom tags, dan breadcrumb trail lengkap
 */
router.get("/sentry-context", asyncHandler(async (req, res) => {
  const start = process.hrtime.bigint();
  logEntry(req, "TEST-16 Sentry Context Demo");
  const log = logger.withReqId(req.requestId);

  // ── A. Set User Context ──────────────────────────────────────────────────
  log.info("A. Mengatur user context di Sentry...");
  const simulatedUser = {
    id: "user-demo-testing-001",
    email: "demo.testing@lawargaming.com",
    username: "DemoTester",
    role: "admin",
    tenantId: "tenant-lawar-001",
  };

  Sentry.setUser({
    id: simulatedUser.id,
    email: simulatedUser.email,
    username: simulatedUser.username,
    role: simulatedUser.role,
    tenantId: simulatedUser.tenantId,
  });

  log.debug("User context di-set:", simulatedUser);
  log.info(`  → User: ${simulatedUser.username} (${simulatedUser.email})`);
  log.info(`  → Role: ${simulatedUser.role} | Tenant: ${simulatedUser.tenantId}`);

  // ── B. Set Tags ──────────────────────────────────────────────────────────
  log.info("B. Mengatur custom tags di Sentry...");
  const tags = {
    "service":        "testing-module",
    "feature":        "error-demo",
    "version":        process.env.npm_package_version || "1.0.0",
    "request_id":     req.requestId || "unknown",
    "environment":    process.env.NODE_ENV || "development",
  };

  Object.entries(tags).forEach(([key, value]) => {
    Sentry.setTag(key, value);
    log.debug(`  Tag: ${key} = ${value}`);
  });
  log.info(`  → ${Object.keys(tags).length} tags berhasil di-set`);

  // ── C. Add Breadcrumbs ───────────────────────────────────────────────────
  log.info("C. Menambahkan breadcrumbs (rekaman aksi user)...");

  const crumbs = [
    { msg: "User login berhasil",          cat: "auth",     lvl: "info"    },
    { msg: "User membuka halaman dashboard", cat: "navigation", lvl: "info" },
    { msg: "User memilih laporan bulan ini", cat: "ui",       lvl: "info"   },
    { msg: "Request laporan ke server",     cat: "http",     lvl: "info"   },
    { msg: "Database query dimulai",        cat: "db",       lvl: "info"   },
    { msg: "Database query lambat (>2s)",   cat: "db",       lvl: "warning"},
  ];

  for (const crumb of crumbs) {
    addBreadcrumb(crumb.msg, { userId: simulatedUser.id }, crumb.cat, crumb.lvl);
    log.debug(`  Breadcrumb [${crumb.cat}/${crumb.lvl}]: ${crumb.msg}`);
  }
  log.info(`  → ${crumbs.length} breadcrumbs ditambahkan`);

  // ── D. Capture message dengan semua context ──────────────────────────────
  log.info("D. Mengirim pesan ke Sentry dengan semua context...");
  const eventId = Sentry.captureMessage(
    `[TESTING] Demo Sentry Context: user=${simulatedUser.email}, requestId=${req.requestId}`,
    "info"
  );

  log.debug(`Sentry event dikirim. Event ID: ${eventId || "(disabled/no DSN)"}`);
  log.info("Context demo selesai. Buka Sentry untuk melihat:");
  log.info("  • User context di bagian 'User' pada event detail");
  log.info("  • Custom tags di bagian 'Tags'");
  log.info("  • Breadcrumb trail di bagian 'Breadcrumbs'");

  logExit(req.requestId, "TEST-16 Sentry Context", start);

  res.json({
    success: true,
    test: "sentry-context",
    sentryEventId: eventId || null,
    demoData: {
      userContext:  simulatedUser,
      tags,
      breadcrumbs: crumbs.map((c) => ({ message: c.msg, category: c.cat, level: c.lvl })),
    },
    instructions: [
      "1. Buka https://sentry.io → Issues",
      "2. Cari event dengan message '[TESTING] Demo Sentry Context'",
      "3. Klik event → lihat bagian 'User', 'Tags', dan 'Breadcrumbs'",
      "4. Ini menunjukkan cara konteks yang kaya membantu debugging",
    ],
  });
}));

// ============================================================
// TEST 17: Health check dengan detail sistem
// ============================================================

/**
 * GET /api/testing/health
 *
 * Menampilkan status kesehatan server secara detail, termasuk:
 * - Status MongoDB & Redis (dari koneksi yang sedang aktif)
 * - Memory usage
 * - Uptime
 * - Environment info
 */
router.get("/health", asyncHandler(async (req, res) => {
  const start = process.hrtime.bigint();
  logEntry(req, "TEST-17 Health Check Detail");
  const log = logger.withReqId(req.requestId);

  log.info("Mengumpulkan informasi kesehatan sistem...");

  // Memory
  const memRaw = process.memoryUsage();
  const mb = (b) => `${(b / 1024 / 1024).toFixed(1)} MB`;

  // MongoDB status
  let mongoStatus = "unknown";
  try {
    const mongoose = require("mongoose");
    const states = ["disconnected", "connected", "connecting", "disconnecting"];
    mongoStatus = states[mongoose.connection.readyState] || "unknown";
    log.debug(`MongoDB state: ${mongoStatus} (readyState=${mongoose.connection.readyState})`);
  } catch (e) {
    mongoStatus = "error";
    log.warn("Tidak bisa membaca status MongoDB:", e.message);
  }

  // Redis status
  let redisStatus = "unknown";
  try {
    const redisClient = require("../utils/redisClient");
    redisStatus = (redisClient && redisClient.status) ? redisClient.status : "unknown";
    log.debug(`Redis status: ${redisStatus}`);
  } catch (e) {
    redisStatus = "not configured";
    log.debug("Redis client tidak dapat di-load:", e.message);
  }

  const uptime = process.uptime();
  const health = {
    status: mongoStatus === "connected" ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
    uptime: { seconds: Math.round(uptime), human: `${(uptime / 60).toFixed(1)} menit` },
    services: {
      mongodb: { status: mongoStatus },
      redis:   { status: redisStatus },
      sentry:  { status: process.env.SENTRY_DSN ? "configured" : "disabled (no DSN)" },
    },
    memory: {
      rss:       mb(memRaw.rss),
      heapTotal: mb(memRaw.heapTotal),
      heapUsed:  mb(memRaw.heapUsed),
      external:  mb(memRaw.external),
    },
    process: {
      nodeVersion: process.version,
      platform:    process.platform,
      arch:        process.arch,
      pid:         process.pid,
      env:         process.env.NODE_ENV || "development",
    },
  };

  log.info(`Status sistem: ${health.status}`);
  log.info(`  MongoDB : ${health.services.mongodb.status}`);
  log.info(`  Redis   : ${health.services.redis.status}`);
  log.info(`  Sentry  : ${health.services.sentry.status}`);
  log.info(`  Memory  : heapUsed=${health.memory.heapUsed}`);
  log.info(`  Uptime  : ${health.uptime.human}`);

  const statusCode = health.status === "healthy" ? 200 : 503;
  logExit(req.requestId, "TEST-17 Health Check", start);

  res.status(statusCode).json({ success: health.status === "healthy", ...health });
}));

// ============================================================
// EXPORTS
// ============================================================

module.exports = router;
