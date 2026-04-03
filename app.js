/**
 * app.js
 * ------
 * Konfigurasi Express application dengan Sentry integration,
 * custom middleware, dan centralized error handling.
 *
 * URUTAN MIDDLEWARE SANGAT PENTING:
 *   1. Security (helmet, CORS)
 *   2. Request tracing (requestId, requestLogger)
 *   3. Body parsers
 *   4. Sanitasi & rate limiting
 *   5. Routes
 *   6. Sentry error handler (HARUS sebelum custom error handler)
 *   7. Custom error handler (PALING AKHIR)
 */

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");

// Sentry – setupSentryErrorHandler dipanggil setelah routes
const { setupSentryErrorHandler } = require("./config/sentry");

// Custom middleware
const {
  generateRequestId,
  requestLogger,
  sanitizeBody,
  rateLimiter,
  corsOptions,
} = require("./middleware/middleware");

// Routes & error handler
const routes = require("./routes");
const errorHandler = require("./middleware/errorHandler");

const app = express();

// ============================================================
// 1. SECURITY HEADERS
// ============================================================

// Helmet: set berbagai HTTP security headers otomatis
// (X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security, dll.)
app.use(helmet());

// ============================================================
// 2. CORS
// ============================================================

// CORS: izinkan request dari frontend (konfigurasi via corsOptions)
app.use(cors(corsOptions));

// ============================================================
// 3. REQUEST TRACING
// ============================================================

// Generate unique request ID untuk setiap request (untuk log tracing & Sentry)
app.use(generateRequestId);

// Log setiap request masuk beserta waktu prosesnya
app.use(requestLogger);

// ============================================================
// 4. BODY PARSERS
// ============================================================

// Parse JSON body – batasi ukuran 10mb untuk mencegah large payload attack
app.use(express.json({ limit: process.env.BODY_LIMIT || "10mb" }));

// Parse URL-encoded form data
app.use(express.urlencoded({ extended: true, limit: process.env.BODY_LIMIT || "10mb" }));

// Parse cookies (untuk session-based auth)
app.use(cookieParser());

// ============================================================
// 5. SANITASI & RATE LIMITING
// ============================================================

// Sanitasi body: hapus MongoDB operators ($where, $ne, dll.) dan prototype keys
app.use(sanitizeBody);

// Rate limiting: batasi request per IP untuk mencegah abuse dan DoS
app.use(rateLimiter);

// ============================================================
// 6. HEALTH CHECK ENDPOINTS
// ============================================================

// /healthz – untuk liveness probe (apakah server masih hidup?)
app.get("/healthz", (_req, res) =>
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  })
);

// /ready – untuk readiness probe (apakah server siap menerima traffic?)
app.get("/ready", (_req, res) =>
  res.status(200).json({
    ready: true,
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || "development",
  })
);

// ============================================================
// 7. API ROUTES
// ============================================================

app.use("/api", routes);

// ============================================================
// 8. 404 FALLBACK
// ============================================================

// Tangkap semua request yang tidak cocok dengan route manapun
app.use((req, res) => {
  res.status(404).json({
    success: false,
    errorCode: "NOT_FOUND",
    message: `Route ${req.method} ${req.originalUrl} tidak ditemukan.`,
  });
});

// ============================================================
// 9. SENTRY ERROR HANDLER
// ============================================================

// PENTING: Sentry error handler harus dipasang SEBELUM custom error handler,
// agar Sentry sempat mencatat error sebelum response dikirim ke client.
setupSentryErrorHandler(app);

// ============================================================
// 10. CENTRALIZED ERROR HANDLER
// ============================================================

// Custom error handler (lihat middleware/errorHandler.js)
app.use(errorHandler);

module.exports = app;
