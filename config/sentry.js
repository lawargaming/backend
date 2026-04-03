/**
 * sentry.js
 * ---------
 * Konfigurasi Sentry yang komprehensif untuk production-ready error tracking
 * dan performance monitoring.
 *
 * CARA PAKAI:
 *   // Di serverNew.js – HARUS dipanggil PALING PERTAMA sebelum require lain!
 *   const { initSentry } = require('./config/sentry');
 *   initSentry(); // panggil sebelum require express
 *
 *   // Setelah express app dibuat, pasang error handler Sentry:
 *   const { setupSentryErrorHandler } = require('./config/sentry');
 *   setupSentryErrorHandler(app); // pasang setelah semua route
 *
 * SENTRY SDK VERSION: @sentry/node v10 (SDK v8+ API - @sentry/tracing no longer separate)
 */

const Sentry = require("@sentry/node");

// ============================================================
// HELPER: menentukan sample rate berdasarkan environment
// ============================================================

/**
 * Menentukan traces sample rate berdasarkan environment.
 * - development : 1.0  = semua transaksi di-trace (untuk debugging)
 * - staging     : 0.5  = setengah transaksi di-trace
 * - production  : 0.1  = 10% transaksi di-trace (hemat quota)
 *
 * Bisa di-override melalui env var SENTRY_TRACES_SAMPLE_RATE.
 */
function getTracesSampleRate() {
  const fromEnv = parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE);
  if (!isNaN(fromEnv)) return fromEnv;

  switch (process.env.NODE_ENV) {
    case "production":
      return 0.1;
    case "staging":
      return 0.5;
    default: // development, test
      return 1.0;
  }
}

/**
 * Menentukan error sample rate (profilesSampleRate).
 * Hanya aktif di production untuk menghindari overhead di dev.
 */
function getProfilesSampleRate() {
  const fromEnv = parseFloat(process.env.SENTRY_PROFILES_SAMPLE_RATE);
  if (!isNaN(fromEnv)) return fromEnv;

  return process.env.NODE_ENV === "production" ? 0.1 : 0.0;
}

// ============================================================
// HELPER: filter error yang tidak perlu dilaporkan ke Sentry
// ============================================================

/**
 * Daftar error codes yang merupakan "operational errors" dari user
 * dan tidak perlu di-alert ke tim engineering.
 * (Masih dicatat tapi dengan level 'info', bukan 'error')
 */
const IGNORABLE_ERROR_CODES = new Set([
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "RATE_LIMIT_ERROR",
]);

/**
 * Daftar HTTP status codes yang tidak perlu dilaporkan ke Sentry.
 * 4xx errors biasanya adalah kesalahan user, bukan bug.
 * EXCEPTION: 401, 403 tetap dilaporkan untuk security monitoring.
 */
const IGNORABLE_STATUS_CODES = new Set([400, 404, 429]);

/**
 * beforeSend hook – dipanggil Sentry sebelum event dikirim ke server.
 * Gunakan untuk:
 *  1. Filter event yang tidak perlu (kurangi noise)
 *  2. Hapus data sensitif (password, token, PII)
 *  3. Tambahkan enrichment data
 *
 * Return null = event TIDAK dikirim ke Sentry.
 * Return event = event dikirim ke Sentry.
 */
function beforeSend(event, hint) {
  const error = hint && hint.originalException;

  // ----------------------------------------------------------
  // 1. Filter operational errors yang tidak perlu di-alert
  // ----------------------------------------------------------
  if (error && error.isOperational) {
    const statusCode = error.statusCode || 500;
    const errorCode = error.errorCode || "";

    // Jangan kirim 400/404/429 ke Sentry – ini kesalahan user biasa
    if (IGNORABLE_STATUS_CODES.has(statusCode)) {
      return null;
    }

    // Jangan kirim error codes yang sudah kita anggap 'expected'
    if (IGNORABLE_ERROR_CODES.has(errorCode)) {
      return null;
    }
  }

  // ----------------------------------------------------------
  // 2. Filter bot/scanner requests (kurangi noise)
  // ----------------------------------------------------------
  const userAgent =
    event.request &&
    event.request.headers &&
    event.request.headers["user-agent"];
  if (userAgent) {
    const botPatterns = /bot|crawler|spider|scan|masscan|zgrab/i;
    if (botPatterns.test(userAgent)) {
      return null;
    }
  }

  // ----------------------------------------------------------
  // 3. Hapus data sensitif dari request body
  // ----------------------------------------------------------
  if (event.request && event.request.data) {
    event.request.data = sanitizeRequestData(event.request.data);
  }

  // ----------------------------------------------------------
  // 4. Hapus data sensitif dari headers
  // ----------------------------------------------------------
  if (event.request && event.request.headers) {
    const sensitiveHeaders = ["authorization", "cookie", "x-api-key"];
    sensitiveHeaders.forEach((header) => {
      if (event.request.headers[header]) {
        event.request.headers[header] = "[REDACTED]";
      }
    });
  }

  // ----------------------------------------------------------
  // 5. Tambahkan custom fingerprint untuk error grouping yang lebih baik
  // ----------------------------------------------------------
  if (error && error.errorCode) {
    // Group semua error dengan code yang sama menjadi satu issue di Sentry
    event.fingerprint = [error.errorCode, event.transaction || "{{ default }}"];
  }

  return event;
}

/**
 * Menghapus field sensitif dari request body sebelum dikirim ke Sentry.
 * @param {object|string} data - Request body
 * @returns {object|string} - Body yang sudah disanitasi
 */
function sanitizeRequestData(data) {
  // Jika data adalah string (misal JSON belum di-parse), kembalikan apa adanya
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return data;
    }
  }

  if (typeof data !== "object" || data === null) return data;

  // Daftar field yang harus dihapus nilainya
  const sensitiveFields = [
    "password",
    "password_confirmation",
    "passwordLama",
    "passwordBaru",
    "token",
    "refreshToken",
    "accessToken",
    "secret",
    "apiKey",
    "api_key",
    "cardNumber",
    "cvv",
    "pin",
  ];

  const sanitized = { ...data };
  sensitiveFields.forEach((field) => {
    if (sanitized[field] !== undefined) {
      sanitized[field] = "[REDACTED]";
    }
  });

  return sanitized;
}

// ============================================================
// MAIN INIT FUNCTION
// ============================================================

/**
 * initSentry – Inisialisasi Sentry SDK.
 *
 * PENTING: Harus dipanggil PALING AWAL di entry point (serverNew.js),
 * SEBELUM import Express dan middleware lainnya, agar semua error
 * (termasuk startup errors) dapat di-capture.
 *
 * Jika SENTRY_DSN tidak di-set, Sentry akan berjalan dalam mode disabled
 * (tidak mengirim data) – aman untuk development tanpa config Sentry.
 */
function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  const environment = process.env.NODE_ENV || "development";
  const release = process.env.SENTRY_RELEASE || process.env.npm_package_version;
  const debug = process.env.SENTRY_DEBUG === "true";

  // Jika DSN tidak dikonfigurasi, skip init (tidak error, hanya warning)
  if (!dsn) {
    console.warn(
      "[Sentry] SENTRY_DSN tidak dikonfigurasi. " +
        "Sentry berjalan dalam mode disabled. " +
        "Set SENTRY_DSN di .env untuk mengaktifkan error tracking."
    );
  }

  Sentry.init({
    // ----------------------------------------------------------
    // CORE CONFIGURATION
    // ----------------------------------------------------------

    // DSN: Data Source Name – alamat project Sentry Anda
    // Format: https://<public_key>@<host>/<project_id>
    dsn: dsn || undefined, // undefined = disabled mode

    // Environment: development | staging | production
    // Digunakan untuk filter di dashboard Sentry
    environment,

    // Release: versi aplikasi yang sedang berjalan
    // Format direkomendasikan: "nama-app@1.0.0" atau commit SHA
    // Berguna untuk track error per versi (tahu sejak versi mana error muncul)
    release: release
      ? `backend@${release}`
      : undefined,

    // ----------------------------------------------------------
    // INTEGRATIONS
    // ----------------------------------------------------------
    integrations: [
      // HTTP integration: track semua HTTP request/response (incoming & outgoing)
      // - tracing: true = aktifkan distributed tracing
      // - breadcrumbs: true = catat HTTP calls sebagai breadcrumbs
      Sentry.httpIntegration({
        tracing: true,
        breadcrumbs: true,
      }),

      // Express integration: auto-instrument Express routes untuk performance monitoring
      Sentry.expressIntegration(),

      // MongoDB/Mongoose integration: track database queries
      Sentry.mongooseIntegration(),

      // Redis integration: track Redis operations
      Sentry.redisIntegration(),

      // Native fetch integration: track fetch() calls (Node 18+)
      Sentry.nativeNodeFetchIntegration({
        breadcrumbs: true,
      }),
    ],

    // ----------------------------------------------------------
    // PERFORMANCE MONITORING (Distributed Tracing)
    // ----------------------------------------------------------

    // tracesSampleRate: persentase transaksi yang di-trace
    // 1.0 = 100% (semua), 0.1 = 10%, 0.0 = disabled
    // CATATAN: Di production, jangan set 1.0 karena akan memakan banyak quota
    tracesSampleRate: getTracesSampleRate(),

    // profilesSampleRate: persentase transaksi yang di-profile (CPU profiling)
    // Berguna untuk menemukan bottleneck performance
    profilesSampleRate: getProfilesSampleRate(),

    // ----------------------------------------------------------
    // ERROR FILTERING & DATA PRIVACY
    // ----------------------------------------------------------

    // beforeSend: hook yang dipanggil sebelum event dikirim ke Sentry
    // Gunakan untuk filter noise dan sanitasi data sensitif
    beforeSend,

    // maxBreadcrumbs: jumlah maksimal breadcrumb per event
    // Breadcrumb adalah rekaman aktivitas sebelum error terjadi
    maxBreadcrumbs: 50,

    // attachStacktrace: tambahkan stack trace ke semua events (bukan hanya exceptions)
    // Berguna untuk message events yang biasanya tidak punya stack trace
    attachStacktrace: true,

    // sendDefaultPii: true = Sentry otomatis capture IP address pada setiap event.
    // Sesuai konfigurasi Sentry project ini.
    sendDefaultPii: true,

    // ----------------------------------------------------------
    // DEBUGGING (matikan di production)
    // ----------------------------------------------------------

    // debug: tampilkan log internal Sentry di console
    // Berguna saat setup pertama kali, matikan di production
    debug,

    // ----------------------------------------------------------
    // NORMALIZATION (mencegah circular reference)
    // ----------------------------------------------------------

    // normalizeDepth: kedalaman object yang di-normalize
    // Default: 3. Naikkan jika context Anda sangat nested.
    normalizeDepth: 5,
  });

  console.log(
    `[Sentry] Initialized | env=${environment} | release=${release || "unknown"} | ` +
      `traceRate=${getTracesSampleRate()} | dsn=${dsn ? "configured" : "disabled"}`
  );
}

// ============================================================
// SETUP ERROR HANDLER
// ============================================================

/**
 * setupSentryErrorHandler – Pasang Sentry error handler ke Express app.
 *
 * PENTING: Harus dipanggil SETELAH semua routes didefinisikan,
 * tapi SEBELUM custom error handler Anda.
 *
 * @param {import('express').Application} app - Express app instance
 */
function setupSentryErrorHandler(app) {
  Sentry.setupExpressErrorHandler(app);
  console.log("[Sentry] Express error handler terpasang.");
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * captureError – Capture exception ke Sentry dengan context tambahan.
 * Wrapper yang lebih mudah dipakai di services/controllers.
 *
 * @param {Error} error     - Error yang akan di-capture
 * @param {object} context  - Konteks tambahan { user, tags, extra, level }
 */
function captureError(error, context = {}) {
  Sentry.withScope((scope) => {
    // Set level: 'fatal' | 'error' | 'warning' | 'info' | 'debug'
    if (context.level) {
      scope.setLevel(context.level);
    }

    // Set user context
    if (context.user) {
      scope.setUser(context.user);
    }

    // Set custom tags (digunakan untuk filter di dashboard)
    if (context.tags) {
      Object.entries(context.tags).forEach(([key, value]) => {
        scope.setTag(key, value);
      });
    }

    // Set extra data (detail teknis yang tidak masuk ke tags)
    if (context.extra) {
      Object.entries(context.extra).forEach(([key, value]) => {
        scope.setExtra(key, value);
      });
    }

    Sentry.captureException(error);
  });
}

/**
 * addBreadcrumb – Tambahkan breadcrumb untuk tracking user journey.
 * Breadcrumb adalah rekaman aktivitas sebelum error terjadi.
 *
 * @param {string} message  - Deskripsi aktivitas
 * @param {object} data     - Data tambahan
 * @param {string} category - Kategori (misal: 'auth', 'db', 'api')
 * @param {string} level    - Level: 'info' | 'warning' | 'error'
 */
function addBreadcrumb(message, data = {}, category = "app", level = "info") {
  Sentry.addBreadcrumb({
    message,
    data,
    category,
    level,
    timestamp: Date.now() / 1000,
  });
}

/**
 * setRequestContext – Set context request ke Sentry scope.
 * Dipanggil di request middleware untuk enrichment.
 *
 * @param {import('express').Request} req - Express request
 */
function setRequestContext(req) {
  Sentry.getCurrentScope().setTag("request_id", req.requestId || "unknown");
  Sentry.getCurrentScope().setTag("http_method", req.method);
  Sentry.getCurrentScope().setTag("route", req.path);
}

/**
 * setUserContext – Set informasi user ke Sentry scope.
 * Dipanggil setelah autentikasi berhasil.
 *
 * @param {object} user - User object dari JWT/session
 */
function setUserContext(user) {
  if (!user) return;

  // CATATAN: Jangan masukkan password atau data sensitif ke sini!
  Sentry.setUser({
    id: user.id || user._id,
    username: user.nama || user.username,
    email: user.email,
    // Custom fields
    role: user.role,
    tenantId: user.tenantId,
  });
}

/**
 * clearUserContext – Bersihkan user context (dipanggil saat logout).
 */
function clearUserContext() {
  Sentry.setUser(null);
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  Sentry,
  initSentry,
  setupSentryErrorHandler,
  captureError,
  addBreadcrumb,
  setRequestContext,
  setUserContext,
  clearUserContext,
  sanitizeRequestData,
};
