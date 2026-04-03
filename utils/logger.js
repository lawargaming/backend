/**
 * logger.js
 * ---------
 * Utility logger dengan colorized output, timestamps, level indicators,
 * dan dukungan request ID untuk tracing.
 *
 * Log levels:
 *   🔵 INFO  – informasi umum alur eksekusi
 *   🟢 DEBUG – detail debugging (hanya muncul di non-production)
 *   🟡 WARN  – peringatan yang perlu diperhatikan
 *   🔴 ERROR – error yang perlu ditangani atau diselidiki
 */

const isDev = process.env.NODE_ENV !== "production";

// ============================================================
// ANSI color codes
// ============================================================
const RESET  = "\x1b[0m";
const BOLD   = "\x1b[1m";
const DIM    = "\x1b[2m";

const CYAN   = "\x1b[36m";
const GREEN  = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED    = "\x1b[31m";
const MAGENTA = "\x1b[35m";
const WHITE  = "\x1b[37m";

// ============================================================
// Helper: timestamp
// ============================================================
function ts() {
  return new Date().toISOString();
}

// ============================================================
// Helper: format prefix
//   [TIMESTAMP] ICON LEVEL  [requestId?]
// ============================================================
function prefix(icon, levelLabel, color, requestId) {
  const time   = `${DIM}${ts()}${RESET}`;
  const level  = `${BOLD}${color}${icon} ${levelLabel}${RESET}`;
  const rid    = requestId ? ` ${MAGENTA}[${requestId}]${RESET}` : "";
  return `${time} ${level}${rid}`;
}

// ============================================================
// Core log functions
// ============================================================

/**
 * logger.info – 🔵 Informasi umum.
 * @param {string} message
 * @param {...any} rest - Data tambahan yang akan di-log
 */
function info(message, ...rest) {
  const p = prefix("🔵", "INFO ", CYAN, null);
  if (rest.length > 0) {
    console.log(`${p} ${WHITE}${message}${RESET}`, ...rest);
  } else {
    console.log(`${p} ${WHITE}${message}${RESET}`);
  }
}

/**
 * logger.debug – 🟢 Detail debugging. Hanya tampil di non-production.
 * @param {string} message
 * @param {...any} rest
 */
function debug(message, ...rest) {
  if (!isDev) return;
  const p = prefix("🟢", "DEBUG", GREEN, null);
  if (rest.length > 0) {
    console.debug(`${p} ${DIM}${message}${RESET}`, ...rest);
  } else {
    console.debug(`${p} ${DIM}${message}${RESET}`);
  }
}

/**
 * logger.warn – 🟡 Peringatan.
 * @param {string} message
 * @param {...any} rest
 */
function warn(message, ...rest) {
  const p = prefix("🟡", "WARN ", YELLOW, null);
  if (rest.length > 0) {
    console.warn(`${p} ${YELLOW}${message}${RESET}`, ...rest);
  } else {
    console.warn(`${p} ${YELLOW}${message}${RESET}`);
  }
}

/**
 * logger.error – 🔴 Error.
 * @param {string} message
 * @param {...any} rest
 */
function error(message, ...rest) {
  const p = prefix("🔴", "ERROR", RED, null);
  if (rest.length > 0) {
    console.error(`${p} ${RED}${message}${RESET}`, ...rest);
  } else {
    console.error(`${p} ${RED}${message}${RESET}`);
  }
}

/**
 * logger.withReqId – Buat child logger yang otomatis menyertakan request ID
 * di setiap baris log.
 *
 * Contoh pemakaian di route/controller:
 *   const log = logger.withReqId(req.requestId);
 *   log.info('Memproses data pembayaran');
 *   log.debug('Payload:', req.body);
 *   log.error('Gagal simpan ke DB', err.message);
 *
 * @param {string} requestId - ID request dari middleware generateRequestId
 * @returns {{ info, debug, warn, error }}
 */
function withReqId(requestId) {
  return {
    info(message, ...rest) {
      const p = prefix("🔵", "INFO ", CYAN, requestId);
      if (rest.length > 0) {
        console.log(`${p} ${WHITE}${message}${RESET}`, ...rest);
      } else {
        console.log(`${p} ${WHITE}${message}${RESET}`);
      }
    },
    debug(message, ...rest) {
      if (!isDev) return;
      const p = prefix("🟢", "DEBUG", GREEN, requestId);
      if (rest.length > 0) {
        console.debug(`${p} ${DIM}${message}${RESET}`, ...rest);
      } else {
        console.debug(`${p} ${DIM}${message}${RESET}`);
      }
    },
    warn(message, ...rest) {
      const p = prefix("🟡", "WARN ", YELLOW, requestId);
      if (rest.length > 0) {
        console.warn(`${p} ${YELLOW}${message}${RESET}`, ...rest);
      } else {
        console.warn(`${p} ${YELLOW}${message}${RESET}`);
      }
    },
    error(message, ...rest) {
      const p = prefix("🔴", "ERROR", RED, requestId);
      if (rest.length > 0) {
        console.error(`${p} ${RED}${message}${RESET}`, ...rest);
      } else {
        console.error(`${p} ${RED}${message}${RESET}`);
      }
    },
  };
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = { info, debug, warn, error, withReqId };
