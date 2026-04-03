/**
 * middleware.js
 * -------------
 * Kumpulan reusable middleware untuk Express application.
 *
 * Middleware yang tersedia:
 *  - generateRequestId    : Buat unique ID per request untuk tracing
 *  - requestLogger        : Log setiap request (method, URL, timing, IP)
 *  - sentryUserContext    : Set user context ke Sentry setelah auth
 *  - asyncHandler         : Wrapper async route handlers (auto catch error)
 *  - corsMiddleware       : CORS dengan konfigurasi dari environment
 *  - rateLimiter          : Rate limiting untuk mencegah abuse
 *  - sanitizeBody         : Sanitasi request body (hapus field berbahaya)
 *  - addActionBreadcrumb  : Tambahkan breadcrumb untuk user action tracking
 *
 * CARA PAKAI:
 *   const { asyncHandler, generateRequestId } = require('./middleware/middleware');
 *   app.use(generateRequestId);
 *   router.get('/resource', asyncHandler(myController));
 */

const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const { setUserContext, setRequestContext, addBreadcrumb } = require("../config/sentry");

// ============================================================
// 1. REQUEST ID GENERATOR
// ============================================================

/**
 * generateRequestId – Tambahkan unique request ID ke setiap request.
 *
 * Request ID berguna untuk:
 *  - Tracing request di multiple services (distributed tracing)
 *  - Mencari log spesifik di antara ribuan log
 *  - Korelasi antara log server dan report Sentry
 *
 * ID di-set ke:
 *  - req.requestId              : untuk dipakai di dalam aplikasi
 *  - res header 'X-Request-Id'  : untuk dikirim ke client (bisa dipakai frontend)
 */
const generateRequestId = (req, res, next) => {
  // Gunakan request ID dari upstream proxy jika ada (misal: nginx, load balancer)
  // Jika tidak ada, generate sendiri
  const requestId =
    req.headers["x-request-id"] ||
    req.headers["x-correlation-id"] ||
    crypto.randomUUID();

  req.requestId = requestId;

  // Set ke response header agar client bisa tracking
  res.setHeader("X-Request-Id", requestId);

  // Set ke Sentry context untuk korelasi
  setRequestContext(req);

  next();
};

// ============================================================
// 2. REQUEST LOGGER
// ============================================================

/**
 * requestLogger – Log setiap HTTP request dengan informasi lengkap.
 *
 * Log yang dicatat:
 *  - Timestamp, method, URL, IP, User-Agent
 *  - Response status code dan waktu proses (ms)
 *
 * CATATAN: Body request TIDAK di-log di sini untuk keamanan.
 * Hanya log metadata request, bukan payload.
 */
const requestLogger = (req, res, next) => {
  const startTime = Date.now();
  const requestId = req.requestId || "-";

  // Log saat request masuk
  console.log(
    `[REQUEST] ${new Date().toISOString()} | ${requestId} | ` +
      `${req.method} ${req.originalUrl} | IP: ${getClientIp(req)} | ` +
      `UA: ${(req.headers["user-agent"] || "unknown").substring(0, 60)}`
  );

  // Hook ke response finish event untuk log waktu proses
  res.on("finish", () => {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;

    // Pilih prefix berdasarkan status code untuk memudahkan filter log
    const prefix =
      statusCode >= 500 ? "[ERROR]" :
      statusCode >= 400 ? "[WARN]" :
      "[RESPONSE]";

    console.log(
      `${prefix} ${new Date().toISOString()} | ${requestId} | ` +
        `${req.method} ${req.originalUrl} | Status: ${statusCode} | ` +
        `Duration: ${duration}ms`
    );
  });

  next();
};

/**
 * Helper: dapatkan IP client yang sebenarnya, bahkan di belakang proxy/load balancer.
 * @param {import('express').Request} req
 * @returns {string}
 */
function getClientIp(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.headers["x-real-ip"] ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

// ============================================================
// 3. SENTRY USER CONTEXT MIDDLEWARE
// ============================================================

/**
 * sentryUserContext – Set informasi user yang sedang login ke Sentry scope.
 *
 * Middleware ini harus dipasang SETELAH auth middleware (yang mengisi req.user).
 * Dengan ini, setiap error yang terjadi akan dilengkapi info siapa usernya.
 *
 * Contoh data yang di-set ke Sentry:
 *  - user.id, user.nama, user.email, user.role, user.tenantId
 *
 * KEAMANAN: Jangan masukkan password atau token ke sini!
 */
const sentryUserContext = (req, res, next) => {
  // req.user diisi oleh auth middleware (middleware/auth.js)
  if (req.user) {
    setUserContext(req.user);
  }
  next();
};

// ============================================================
// 4. ASYNC HANDLER WRAPPER
// ============================================================

/**
 * asyncHandler – Wrapper untuk async route handlers.
 *
 * Masalah yang diselesaikan:
 *   Express tidak otomatis handle Promise rejection dari async functions.
 *   Jika async handler throw error, error tidak akan masuk ke error middleware
 *   tanpa wrapper ini.
 *
 * Sebelum (RAWAN - error tidak ter-catch):
 *   router.get('/users', async (req, res) => {
 *     const users = await User.find(); // jika error, server crash!
 *     res.json(users);
 *   });
 *
 * Sesudah (AMAN - error otomatis diteruskan ke errorHandler):
 *   router.get('/users', asyncHandler(async (req, res) => {
 *     const users = await User.find();
 *     res.json(users);
 *   }));
 *
 * @param {Function} fn - Async route handler function
 * @returns {Function} - Wrapped handler yang catch error otomatis
 */
const asyncHandler = (fn) => {
  return (req, res, next) => {
    // Jalankan handler, jika throw/reject, teruskan ke next(error)
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// ============================================================
// 5. CORS MIDDLEWARE
// ============================================================

/**
 * corsOptions – Konfigurasi CORS berdasarkan environment.
 *
 * Untuk menggunakan di app.js:
 *   const cors = require('cors');
 *   const { corsOptions } = require('./middleware/middleware');
 *   app.use(cors(corsOptions));
 *
 * Environment variables:
 *  - CORS_ORIGIN: comma-separated list of allowed origins
 *               contoh: "http://localhost:3000,https://app.lawargaming.com"
 *               Gunakan "*" untuk allow semua (TIDAK DISARANKAN di production!)
 */
const corsOptions = {
  // Origin yang diizinkan
  origin: (origin, callback) => {
    const allowedOrigins = (process.env.CORS_ORIGIN || "*")
      .split(",")
      .map((o) => o.trim());

    // Allow request tanpa origin (misal: server-to-server, mobile app, Postman)
    if (!origin) return callback(null, true);

    // Development: allow semua
    if (process.env.NODE_ENV === "development") {
      return callback(null, true);
    }

    // Cek apakah origin ada di whitelist
    if (allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // Origin tidak diizinkan
    return callback(new Error(`CORS: Origin ${origin} tidak diizinkan.`));
  },

  // HTTP methods yang diizinkan
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],

  // Headers yang diizinkan dikirim dari client
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Request-Id",
    "X-API-Key",
  ],

  // Headers yang boleh dibaca oleh browser dari response
  exposedHeaders: ["X-Request-Id", "X-RateLimit-Limit", "X-RateLimit-Remaining"],

  // Izinkan cookies dikirim bersama request (untuk session-based auth)
  credentials: true,

  // Cache pre-flight response selama 24 jam (mengurangi OPTIONS request)
  maxAge: 86400,
};

// ============================================================
// 6. RATE LIMITER
// ============================================================

/**
 * rateLimiter – Batasi jumlah request untuk mencegah abuse dan DoS.
 *
 * Konfigurasi default (bisa di-override via env vars):
 *  - Window: 15 menit
 *  - Max requests: 100 per window per IP
 *
 * Environment variables:
 *  - RATE_LIMIT_WINDOW_MS   : Window dalam milidetik (default: 15 menit)
 *  - RATE_LIMIT_MAX_REQUESTS: Maksimal request per window (default: 100)
 */
const rateLimiter = rateLimit({
  // Window time dalam milidetik
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,

  // Maksimal request per window per IP
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100,

  // Pesan error yang dikirim ke client
  message: {
    success: false,
    errorCode: "RATE_LIMIT_ERROR",
    message: "Terlalu banyak request. Silakan tunggu beberapa saat.",
  },

  // Tambahkan headers rate limit ke response (untuk transparency ke client)
  // X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
  standardHeaders: true,

  // Hapus legacy X-RateLimit-* headers
  legacyHeaders: false,

  // Handler saat limit terlampaui
  handler: (req, res, next, options) => {
    // Tambahkan breadcrumb ke Sentry untuk tracking
    addBreadcrumb(
      "Rate limit exceeded",
      { ip: getClientIp(req), path: req.path },
      "security",
      "warning"
    );

    res.status(options.statusCode).json(options.message);
  },
});

/**
 * strictRateLimiter – Rate limiter lebih ketat untuk endpoint sensitif.
 * Gunakan untuk: /api/auth/login, /api/auth/register, /api/auth/reset-password
 *
 * Default: 10 request per 15 menit per IP
 */
const strictRateLimiter = rateLimit({
  windowMs: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX_REQUESTS, 10) || 10,
  message: {
    success: false,
    errorCode: "RATE_LIMIT_ERROR",
    message: "Terlalu banyak percobaan. Silakan tunggu 15 menit.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ============================================================
// 7. BODY SANITIZER
// ============================================================

/**
 * sanitizeBody – Hapus field berbahaya/sensitif dari request body.
 *
 * Mencegah:
 *  - NoSQL injection (operator MongoDB seperti $where, $ne, dll.)
 *  - Prototype pollution (__proto__, constructor, prototype)
 *
 * CATATAN: Ini bukan pengganti validasi input! Selalu validasi dengan Joi
 * atau library validasi lainnya.
 */
const sanitizeBody = (req, res, next) => {
  if (req.body && typeof req.body === "object") {
    req.body = deepSanitize(req.body);
  }
  next();
};

/**
 * Rekursif sanitasi object – hapus keys berbahaya.
 * @param {object} obj
 * @returns {object}
 */
function deepSanitize(obj) {
  if (typeof obj !== "object" || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(deepSanitize);

  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    // Hapus MongoDB operators dan prototype pollution attempts
    if (
      key.startsWith("$") ||
      key === "__proto__" ||
      key === "constructor" ||
      key === "prototype"
    ) {
      continue; // Skip field berbahaya
    }
    sanitized[key] = deepSanitize(value);
  }
  return sanitized;
}

// ============================================================
// 8. ACTION BREADCRUMB CREATOR
// ============================================================

/**
 * createBreadcrumbMiddleware – Factory untuk membuat middleware
 * yang menambahkan breadcrumb saat user melakukan aksi tertentu.
 *
 * Contoh penggunaan di route:
 *   router.post('/login',
 *     createBreadcrumbMiddleware('User attempted login', 'auth'),
 *     loginController
 *   );
 *
 * @param {string} message  - Deskripsi aksi
 * @param {string} category - Kategori breadcrumb (auth, db, api, navigation)
 * @returns {Function} - Middleware function
 */
const createBreadcrumbMiddleware = (message, category = "navigation") => {
  return (req, res, next) => {
    addBreadcrumb(
      message,
      {
        method: req.method,
        path: req.path,
        requestId: req.requestId,
      },
      category,
      "info"
    );
    next();
  };
};

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  generateRequestId,
  requestLogger,
  sentryUserContext,
  asyncHandler,
  corsOptions,
  rateLimiter,
  strictRateLimiter,
  sanitizeBody,
  createBreadcrumbMiddleware,
  getClientIp,
};
