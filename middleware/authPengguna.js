require("dotenv").config();
const jwt = require("jsonwebtoken");
const Pengguna = require("../models/penggunaModel");
const createError = require("http-errors");

const PENGGUNA_JWT_SECRET =
  process.env.PENGGUNA_JWT_SECRET || "pengguna_secret";

module.exports = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw createError(401, "Token Pengguna tidak ditemukan.");
    }

    const token = authHeader.split(" ")[1];

    let decoded;
    try {
      decoded = jwt.verify(token, PENGGUNA_JWT_SECRET);
    } catch (err) {
      if (err.name === "TokenExpiredError") {
        throw createError(
          401,
          "Sesi pengguna berakhir. Silakan login kembali."
        );
      }
      throw createError(403, "Token pengguna tidak valid.");
    }

    const pengguna = await Pengguna.findById(decoded.id)
      .select("tokenVersion roleID nama tenantID")
      .populate({
        path: "roleID",
        select: "permissions namaRole",
      })
      .lean();

    if (!pengguna.roleID) {
      throw createError(403, "Role tidak valid");
    }

    pengguna.permissions = pengguna.roleID.permissions || [];

    if (!pengguna) {
      throw createError(401, "Data pengguna tidak ditemukan.");
    }

    // Validasi token version (logout paksa / reuse protection)
    if (pengguna.tokenVersion !== decoded.version) {
      throw createError(401, "Sesi tidak valid. Silakan login kembali.");
    }

    req.pengguna = pengguna;
    req.userDecoded = decoded; // opsional, tapi berguna untuk audit/log

    next();
  } catch (err) {
    next(err);
  }
};
