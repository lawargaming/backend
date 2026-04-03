/**
 * serverNew.js
 * ------------
 * Entry point utama aplikasi backend.
 *
 * URUTAN STARTUP:
 *   1. Load environment variables (.env)
 *   2. Inisialisasi Sentry (HARUS PERTAMA agar startup errors ter-capture)
 *   3. Buat HTTP server dari Express app
 *   4. Koneksi ke MongoDB
 *   5. Start server
 *   6. Register signal handlers (graceful shutdown)
 *
 * CATATAN: Sentry.init() dipanggil di config/sentry.js via initSentry(),
 * dan harus dipanggil SEBELUM require express/app agar instrumentasi berjalan.
 */

// ============================================================
// STEP 1: Load environment variables PALING AWAL
// ============================================================
require("dotenv").config();

// ============================================================
// STEP 2: Inisialisasi Sentry SEBELUM require lainnya
// ============================================================
// PENTING: initSentry() harus dipanggil sebelum require express dan app.js
// agar Sentry dapat meng-instrument semua module yang di-load setelahnya.
const { initSentry } = require("./config/sentry");
initSentry();

// ============================================================
// STEP 3: Import dependencies (setelah Sentry init)
// ============================================================
const http = require("http");
const mongoose = require("mongoose");
const app = require("./app");
const config = require("./config");
const logger = require("./utils/logger");

// ============================================================
// STEP 4: Buat HTTP server
// ============================================================
const server = http.createServer(app);

// ============================================================
// STEP 5: Koneksi ke database
// ============================================================

/**
 * connectDB – Koneksi ke MongoDB dengan retry sederhana.
 * Jika koneksi gagal saat startup, server tidak akan start.
 */
async function connectDB() {
  const mongoUri = config.MONGO_URI;

  if (!mongoUri) {
    throw new Error("MONGO_URI tidak dikonfigurasi. Set MONGO_URI di file .env");
  }

  logger.info(`Menghubungkan ke MongoDB...`);

  await mongoose.connect(mongoUri, {
    // serverSelectionTimeoutMS: batas waktu menunggu MongoDB siap
    serverSelectionTimeoutMS: 10000,
    // socketTimeoutMS: batas waktu socket idle
    socketTimeoutMS: 45000,
  });

  logger.info("✅ Terhubung ke MongoDB");

  // Log database events untuk monitoring
  mongoose.connection.on("disconnected", () => {
    logger.error("⚠️  MongoDB terputus! Mencoba reconnect otomatis...");
  });

  mongoose.connection.on("reconnected", () => {
    logger.info("✅ MongoDB terhubung kembali.");
  });

  mongoose.connection.on("error", (err) => {
    logger.error("MongoDB connection error:", err.message);
  });
}

// ============================================================
// STEP 6: Start server
// ============================================================

/**
 * start – Fungsi utama startup server.
 */
async function start() {
  try {
    // Koneksi ke database terlebih dahulu
    await connectDB();

    // Start HTTP server
    server.listen(config.PORT, config.HOST, () => {
      logger.info(
        `🚀 Server berjalan di http://${config.HOST}:${config.PORT} | ` +
          `env=${config.NODE_ENV}`
      );
    });

    // Handle server errors (misal: port sudah dipakai)
    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        logger.error(`Port ${config.PORT} sudah digunakan! Ganti PORT di .env`);
      } else {
        logger.error("Server error:", err.message);
      }
      process.exit(1);
    });
  } catch (err) {
    logger.error("Fatal error saat startup:", err.message);
    logger.error(err.stack);
    process.exit(1);
  }
}

// ============================================================
// STEP 7: Graceful shutdown handler
// ============================================================

/**
 * gracefulShutdown – Matikan server dengan bersih tanpa memotong request yang sedang berjalan.
 *
 * Alur shutdown:
 *   1. Hentikan menerima request baru
 *   2. Tunggu request yang sedang berjalan selesai (max 30 detik)
 *   3. Tutup koneksi database
 *   4. Keluar dari proses
 *
 * @param {string} signal - Nama signal yang diterima (SIGINT, SIGTERM)
 */
async function gracefulShutdown(signal) {
  logger.info(`\n${signal} diterima. Memulai graceful shutdown...`);

  // Batas waktu shutdown: 30 detik
  const shutdownTimeout = setTimeout(() => {
    logger.error("Graceful shutdown timeout! Memaksa keluar...");
    process.exit(1);
  }, 30000);

  try {
    // 1. Hentikan server dari menerima koneksi baru
    await new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    logger.info("✅ HTTP server ditutup.");

    // 2. Tutup koneksi MongoDB dengan bersih
    await mongoose.disconnect();
    logger.info("✅ Koneksi MongoDB ditutup.");

    // 3. Bersihkan timeout dan keluar dengan normal
    clearTimeout(shutdownTimeout);
    logger.info("✅ Shutdown selesai. Sampai jumpa!");
    process.exit(0);
  } catch (err) {
    logger.error("Error saat graceful shutdown:", err.message);
    clearTimeout(shutdownTimeout);
    process.exit(1);
  }
}

// Register signal handlers untuk graceful shutdown
process.on("SIGTERM", () => gracefulShutdown("SIGTERM")); // Kubernetes, Docker stop
process.on("SIGINT", () => gracefulShutdown("SIGINT"));   // Ctrl+C di terminal

// ============================================================
// STEP 8: Handler untuk uncaught exceptions & unhandled rejections
// ============================================================

/**
 * uncaughtException – Tangkap error synchronous yang tidak ter-catch.
 *
 * PENTING: Setelah uncaughtException, state aplikasi tidak bisa dipercaya.
 * SELALU exit setelah menangani uncaughtException!
 *
 * Contoh: throw new Error() di luar try-catch
 */
process.on("uncaughtException", (err) => {
  logger.error("🔴 UNCAUGHT EXCEPTION – Server akan restart:");
  logger.error(`  Name   : ${err.name}`);
  logger.error(`  Message: ${err.message}`);
  logger.error(`  Stack  :\n${err.stack}`);

  // Sentry sudah otomatis capture uncaughtException via SDK
  // Beri waktu 1 detik untuk Sentry mengirim event sebelum exit
  setTimeout(() => process.exit(1), 1000);
});

/**
 * unhandledRejection – Tangkap Promise rejection yang tidak ter-handle.
 *
 * Contoh: async function yang throw tanpa .catch() atau try-catch
 */
process.on("unhandledRejection", (reason, promise) => {
  logger.error("🔴 UNHANDLED PROMISE REJECTION:");
  logger.error(`  Reason : ${reason}`);
  if (reason instanceof Error) {
    logger.error(`  Stack  :\n${reason.stack}`);
  }

  // Di production, exit untuk mencegah aplikasi berjalan dalam state tidak stabil
  // Di development, hanya log (lebih mudah debugging)
  if (process.env.NODE_ENV === "production") {
    setTimeout(() => process.exit(1), 1000);
  }
});

// ============================================================
// JALANKAN SERVER
// ============================================================
start();
