/**
 * errorClasses.js
 * ---------------
 * Comprehensive custom error classes untuk production-ready error handling.
 *
 * CARA PAKAI:
 *   const { ValidationError, NotFoundError } = require('./config/errorClasses');
 *   throw new NotFoundError('Produk tidak ditemukan', { id: req.params.id });
 *
 * Setiap error mewarisi dari AppError (base class) sehingga middleware
 * errorHandler dapat menangani semua jenis error secara seragam.
 */

// ============================================================
// BASE ERROR CLASS
// ============================================================

/**
 * AppError – Base class untuk semua custom application errors.
 *
 * Properties:
 *  - statusCode  : HTTP status code yang akan dikirim ke client
 *  - errorCode   : String unik untuk identifikasi jenis error (berguna untuk
 *                  frontend switch/case dan Sentry fingerprinting)
 *  - userMessage : Pesan ramah yang aman ditampilkan ke end-user
 *  - isOperational: true  = error yang kita ekspektasi (misal: user salah input)
 *                   false = unexpected bug, perlu investigasi
 *  - context     : Data tambahan untuk debugging (tidak dikirim ke user)
 *  - metadata    : Key-value bebas untuk enrichment di Sentry
 */
class AppError extends Error {
  /**
   * @param {string} message        - Pesan teknis (muncul di log & Sentry)
   * @param {number} statusCode     - HTTP status code (default 500)
   * @param {string} errorCode      - Kode unik error (default 'INTERNAL_ERROR')
   * @param {string} userMessage    - Pesan user-friendly (default sama dengan message)
   * @param {object} context        - Konteks tambahan untuk debugging
   * @param {object} metadata       - Metadata bebas untuk Sentry tags/extras
   */
  constructor(
    message = "Terjadi kesalahan pada server.",
    statusCode = 500,
    errorCode = "INTERNAL_ERROR",
    userMessage = null,
    context = {},
    metadata = {}
  ) {
    super(message);

    // Nama class (dipakai di errorHandler untuk switch/case dan Sentry)
    this.name = this.constructor.name;

    // HTTP status code
    this.statusCode = statusCode;

    // Kode string unik untuk identifikasi jenis error
    this.errorCode = errorCode;

    // Pesan yang ditampilkan ke user – jika tidak diisi, gunakan message
    this.userMessage = userMessage || message;

    // true  = operational error (expected), tidak perlu crash server
    // false = programmer error (bug), perlu crash/investigasi
    this.isOperational = true;

    // Konteks tambahan: bisa berisi field yang gagal, query yang error, dsb.
    this.context = context;

    // Metadata bebas: ditambahkan sebagai Sentry extra / tags
    this.metadata = metadata;

    // Timestamp saat error terjadi
    this.timestamp = new Date().toISOString();

    // Capture stack trace (lewati constructor sendiri agar stack lebih bersih)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Serialize error ke plain object – berguna untuk logging & response.
   * @param {boolean} includeTechnical - Apakah sertakan detail teknis (hanya untuk log)
   */
  toJSON(includeTechnical = false) {
    const base = {
      success: false,
      errorCode: this.errorCode,
      message: this.userMessage,
      timestamp: this.timestamp,
    };

    if (includeTechnical) {
      return {
        ...base,
        technicalMessage: this.message,
        statusCode: this.statusCode,
        context: this.context,
        metadata: this.metadata,
        stack: this.stack,
      };
    }

    return base;
  }
}

// ============================================================
// VALIDATION ERROR – 400 Bad Request
// ============================================================

/**
 * ValidationError – Dilempar saat data dari user tidak valid.
 *
 * Contoh:
 *   throw new ValidationError('Email tidak valid', {
 *     field: 'email',
 *     value: req.body.email,
 *     rule: 'isEmail'
 *   });
 */
class ValidationError extends AppError {
  /**
   * @param {string} message  - Pesan teknis validasi
   * @param {object} context  - { field, value, rule, ... }
   * @param {object} metadata - Metadata tambahan
   */
  constructor(
    message = "Data yang dikirim tidak valid.",
    context = {},
    metadata = {}
  ) {
    super(
      message,
      400,
      "VALIDATION_ERROR",
      "Data yang dikirim tidak valid. Periksa kembali input Anda.",
      context,
      metadata
    );

    // Daftar field errors jika tersedia (misal dari Joi / Mongoose)
    this.errors = context.errors || [];
  }
}

// ============================================================
// AUTHENTICATION ERROR – 401 Unauthorized
// ============================================================

/**
 * AuthenticationError – Dilempar saat user tidak ter-autentikasi.
 * (Tidak ada token / token invalid / session expired)
 *
 * Contoh:
 *   throw new AuthenticationError('Token JWT tidak valid');
 */
class AuthenticationError extends AppError {
  /**
   * @param {string} message  - Pesan teknis
   * @param {object} context  - Konteks autentikasi (jangan masukkan token asli!)
   * @param {object} metadata - Metadata tambahan
   */
  constructor(
    message = "Autentikasi diperlukan.",
    context = {},
    metadata = {}
  ) {
    super(
      message,
      401,
      "AUTHENTICATION_ERROR",
      "Sesi Anda tidak valid atau sudah berakhir. Silakan login kembali.",
      context,
      metadata
    );
  }
}

// ============================================================
// AUTHORIZATION ERROR – 403 Forbidden
// ============================================================

/**
 * AuthorizationError – Dilempar saat user sudah login tapi tidak punya izin.
 *
 * Contoh:
 *   throw new AuthorizationError('User tidak punya izin hapus produk', {
 *     userId: req.user.id,
 *     requiredPermission: 'produk:delete'
 *   });
 */
class AuthorizationError extends AppError {
  /**
   * @param {string} message  - Pesan teknis
   * @param {object} context  - { userId, requiredPermission, ... }
   * @param {object} metadata - Metadata tambahan
   */
  constructor(
    message = "Akses ditolak.",
    context = {},
    metadata = {}
  ) {
    super(
      message,
      403,
      "AUTHORIZATION_ERROR",
      "Anda tidak memiliki izin untuk melakukan aksi ini.",
      context,
      metadata
    );
  }
}

// ============================================================
// NOT FOUND ERROR – 404 Not Found
// ============================================================

/**
 * NotFoundError – Dilempar saat resource yang diminta tidak ditemukan.
 *
 * Contoh:
 *   throw new NotFoundError('Produk tidak ditemukan', { id: req.params.id });
 */
class NotFoundError extends AppError {
  /**
   * @param {string} message    - Pesan teknis
   * @param {object} context    - { id, resource, ... }
   * @param {object} metadata   - Metadata tambahan
   */
  constructor(
    message = "Resource tidak ditemukan.",
    context = {},
    metadata = {}
  ) {
    super(
      message,
      404,
      "NOT_FOUND",
      "Data yang Anda cari tidak ditemukan.",
      context,
      metadata
    );
  }
}

// ============================================================
// CONFLICT ERROR – 409 Conflict
// ============================================================

/**
 * ConflictError – Dilempar saat terjadi konflik data (misal: email sudah ada).
 *
 * Contoh:
 *   throw new ConflictError('Email sudah terdaftar', { field: 'email' });
 */
class ConflictError extends AppError {
  /**
   * @param {string} message  - Pesan teknis
   * @param {object} context  - { field, value, ... }
   * @param {object} metadata - Metadata tambahan
   */
  constructor(
    message = "Data sudah ada atau terjadi konflik.",
    context = {},
    metadata = {}
  ) {
    super(
      message,
      409,
      "CONFLICT_ERROR",
      "Data yang Anda masukkan sudah ada. Gunakan data yang berbeda.",
      context,
      metadata
    );
  }
}

// ============================================================
// DATABASE ERROR – 503 Service Unavailable
// ============================================================

/**
 * DatabaseError – Dilempar saat operasi database gagal.
 * Catatan: jangan expose detail query ke user!
 *
 * Contoh:
 *   throw new DatabaseError('Query timeout saat insert transaksi', {
 *     operation: 'insert',
 *     collection: 'penjualan'
 *   });
 */
class DatabaseError extends AppError {
  /**
   * @param {string} message      - Pesan teknis (tidak dikirim ke user)
   * @param {object} context      - { operation, collection, query (sanitized), ... }
   * @param {object} metadata     - Metadata tambahan
   * @param {Error}  originalError - Error asli dari database driver
   */
  constructor(
    message = "Operasi database gagal.",
    context = {},
    metadata = {},
    originalError = null
  ) {
    super(
      message,
      503,
      "DATABASE_ERROR",
      "Terjadi gangguan pada sistem. Silakan coba beberapa saat lagi.",
      context,
      metadata
    );

    // Simpan original error untuk logging – jangan kirim ke user
    this.originalError = originalError;

    // Database errors bukan kesalahan user, tapi juga bukan code bug
    // Tetap operational = true agar server tidak crash
    this.isOperational = true;
  }
}

// ============================================================
// EXTERNAL SERVICE ERROR – 502 Bad Gateway
// ============================================================

/**
 * ExternalServiceError – Dilempar saat panggilan ke third-party API gagal.
 *
 * Contoh:
 *   throw new ExternalServiceError('Payment gateway timeout', {
 *     service: 'midtrans',
 *     endpoint: '/charge',
 *     statusCode: 504
 *   });
 */
class ExternalServiceError extends AppError {
  /**
   * @param {string} message       - Pesan teknis
   * @param {object} context       - { service, endpoint, statusCode, response }
   * @param {object} metadata      - Metadata tambahan
   * @param {Error}  originalError - Error asli dari HTTP client
   */
  constructor(
    message = "Layanan eksternal tidak tersedia.",
    context = {},
    metadata = {},
    originalError = null
  ) {
    super(
      message,
      502,
      "EXTERNAL_SERVICE_ERROR",
      "Terjadi gangguan pada layanan pihak ketiga. Silakan coba beberapa saat lagi.",
      context,
      metadata
    );

    this.originalError = originalError;
  }
}

// ============================================================
// RATE LIMIT ERROR – 429 Too Many Requests
// ============================================================

/**
 * RateLimitError – Dilempar saat user melampaui batas request.
 *
 * Contoh:
 *   throw new RateLimitError('Terlalu banyak request dari IP ini', {
 *     ip: req.ip,
 *     limit: 100,
 *     windowMs: 60000
 *   });
 */
class RateLimitError extends AppError {
  /**
   * @param {string} message  - Pesan teknis
   * @param {object} context  - { ip, limit, windowMs, retryAfter }
   * @param {object} metadata - Metadata tambahan
   */
  constructor(
    message = "Batas request terlampaui.",
    context = {},
    metadata = {}
  ) {
    super(
      message,
      429,
      "RATE_LIMIT_ERROR",
      "Anda terlalu banyak melakukan request. Silakan tunggu beberapa saat.",
      context,
      metadata
    );

    // Waktu dalam detik sampai bisa request lagi (dipakai di header Retry-After)
    this.retryAfter = context.retryAfter || 60;
  }
}

// ============================================================
// TIMEOUT ERROR – 408 Request Timeout
// ============================================================

/**
 * TimeoutError – Dilempar saat operasi melebihi batas waktu.
 *
 * Contoh:
 *   throw new TimeoutError('Request ke database timeout', {
 *     operation: 'findMany',
 *     timeoutMs: 5000
 *   });
 */
class TimeoutError extends AppError {
  /**
   * @param {string} message  - Pesan teknis
   * @param {object} context  - { operation, timeoutMs, ... }
   * @param {object} metadata - Metadata tambahan
   */
  constructor(
    message = "Operasi melebihi batas waktu.",
    context = {},
    metadata = {}
  ) {
    super(
      message,
      408,
      "TIMEOUT_ERROR",
      "Permintaan Anda membutuhkan terlalu lama. Silakan coba lagi.",
      context,
      metadata
    );

    // Durasi timeout dalam ms
    this.timeoutMs = context.timeoutMs || null;
  }
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  DatabaseError,
  ExternalServiceError,
  RateLimitError,
  TimeoutError,
};
