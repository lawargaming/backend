/**
 * errorHandler.js
 * ---------------
 * Centralized error handling middleware untuk Express.
 *
 * Middleware ini menangani SEMUA error yang di-pass lewat next(err),
 * termasuk custom error classes dari config/errorClasses.js.
 *
 * URUTAN PENANGANAN:
 *   1. Custom AppError (dari errorClasses.js) → gunakan statusCode & errorCode-nya
 *   2. Mongoose ValidationError           → 400 Bad Request
 *   3. Mongoose Duplicate Key (11000)     → 409 Conflict
 *   4. Mongoose CastError                 → 404 Not Found
 *   5. JWT errors                         → 401 Unauthorized
 *   6. Semua error lain                   → 500 Internal Server Error
 *
 * KEAMANAN: Stack trace dan detail teknis TIDAK dikirim ke client di production.
 */

const { AppError } = require("../config/errorClasses");
const { captureError } = require("../config/sentry");

const isDevelopment = process.env.NODE_ENV !== "production";

/**
 * Format error response yang konsisten.
 * @param {object} params
 * @returns {object}
 */
function buildErrorResponse({
  errorCode,
  message,
  errors = null,
  requestId = null,
  sentryEventId = null,
  stack = null,
}) {
  const response = {
    success: false,
    errorCode,
    message,
  };

  // Detail validasi errors (array of field errors)
  if (errors && errors.length > 0) {
    response.errors = errors;
  }

  // Request ID untuk tracing (dikirim ke client agar bisa lapor ke support)
  if (requestId) {
    response.requestId = requestId;
  }

  // Sentry event ID – berguna untuk laporan bug ("ada error dengan ID ini")
  if (sentryEventId) {
    response.sentryEventId = sentryEventId;
  }

  // Stack trace hanya di development (jangan expose ke production!)
  if (isDevelopment && stack) {
    response.stack = stack;
  }

  return response;
}

/**
 * Main error handler middleware.
 * Signature 4 parameter adalah cara Express mengenali ini sebagai error middleware.
 */
// eslint-disable-next-line no-unused-vars
module.exports = (err, req, res, next) => {
  const requestId = req.requestId || null;

  // ----------------------------------------------------------
  // 1. CUSTOM AppError (dari config/errorClasses.js)
  // ----------------------------------------------------------
  if (err instanceof AppError) {
    // Log error dengan level yang sesuai
    if (err.statusCode >= 500) {
      console.error("[ERROR]", `${requestId} |`, err.name, "|", err.message, "\n", err.stack);

      // Kirim ke Sentry – hanya untuk 5xx (server errors)
      captureError(err, {
        tags: { errorCode: err.errorCode, route: req.path },
        extra: { context: err.context, metadata: err.metadata },
      });
    } else {
      // 4xx errors: log sebagai warning, tidak perlu kirim ke Sentry
      console.warn("[WARN]", `${requestId} |`, err.name, "|", err.message);
    }

    return res.status(err.statusCode).json(
      buildErrorResponse({
        errorCode: err.errorCode,
        message: err.userMessage,
        errors: err.errors || null,
        requestId,
        sentryEventId: res.sentry || null,
      })
    );
  }

  // ----------------------------------------------------------
  // 2. MONGOOSE VALIDATION ERROR
  // ----------------------------------------------------------
  if (err.name === "ValidationError" && err.errors) {
    const errors = Object.values(err.errors).map((e) => e.message);
    console.warn("[WARN]", `${requestId} | MongooseValidationError |`, err.message);

    return res.status(400).json(
      buildErrorResponse({
        errorCode: "VALIDATION_ERROR",
        message: "Data yang dikirim tidak valid.",
        errors,
        requestId,
      })
    );
  }

  // ----------------------------------------------------------
  // 3. MONGOOSE DUPLICATE KEY ERROR (unique index violation)
  // ----------------------------------------------------------
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || "field";
    console.warn("[WARN]", `${requestId} | DuplicateKeyError | field: ${field}`);

    return res.status(409).json(
      buildErrorResponse({
        errorCode: "CONFLICT_ERROR",
        message: `Data '${field}' sudah digunakan. Gunakan nilai yang berbeda.`,
        requestId,
      })
    );
  }

  // ----------------------------------------------------------
  // 4. MONGOOSE CAST ERROR (ID tidak valid)
  // ----------------------------------------------------------
  if (err.name === "CastError") {
    console.warn("[WARN]", `${requestId} | CastError | path: ${err.path}`);

    return res.status(404).json(
      buildErrorResponse({
        errorCode: "NOT_FOUND",
        message: "Resource tidak ditemukan (ID tidak valid).",
        requestId,
      })
    );
  }

  // ----------------------------------------------------------
  // 5. JWT ERRORS
  // ----------------------------------------------------------
  if (err.name === "JsonWebTokenError") {
    console.warn("[WARN]", `${requestId} | JsonWebTokenError |`, err.message);

    return res.status(401).json(
      buildErrorResponse({
        errorCode: "AUTHENTICATION_ERROR",
        message: "Token tidak valid. Silakan login kembali.",
        requestId,
      })
    );
  }

  if (err.name === "TokenExpiredError") {
    console.warn("[WARN]", `${requestId} | TokenExpiredError`);

    return res.status(401).json(
      buildErrorResponse({
        errorCode: "AUTHENTICATION_ERROR",
        message: "Sesi Anda telah berakhir. Silakan login kembali.",
        requestId,
      })
    );
  }

  // ----------------------------------------------------------
  // 6. SEMUA ERROR LAIN (unexpected / programmer errors)
  // ----------------------------------------------------------

  // Log lengkap dengan stack trace untuk debugging
  console.error("[ERROR]", `${requestId} | UnhandledError |`, err.name, "|", err.message, "\n", err.stack);

  // Kirim semua unexpected errors ke Sentry
  captureError(err, {
    tags: {
      errorCode: "UNHANDLED_ERROR",
      route: req.path,
      method: req.method,
    },
    extra: {
      requestId,
      body: req.body,
      params: req.params,
      query: req.query,
    },
  });

  // Kirim response generic ke client (jangan expose detail error di production!)
  return res.status(err.status || 500).json(
    buildErrorResponse({
      errorCode: "INTERNAL_ERROR",
      message: isDevelopment
        ? err.message
        : "Terjadi kesalahan pada server. Tim kami sedang menangani masalah ini.",
      requestId,
      sentryEventId: res.sentry || null,
      stack: err.stack,
    })
  );
};