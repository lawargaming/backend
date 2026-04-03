const Pelanggan = require("../models/pelangganModel");
const redis = require("../config/redis");
const {
  validatePelangganPayload
} = require("../validators/pelangganValidator");
const createError = require("http-errors");

const KEY_LIST = (tenantID) => `pelanggan:list:${tenantID}`;
const KEY_DETAIL = (id) => `pelanggan:detail:${id}`;

class PelangganService {
  async clearCache(tenantID, id) {
    const keys = [KEY_LIST(tenantID)];
    if (id) keys.push(KEY_DETAIL(id));
    await redis.del(keys);
  }

  async getAll(tenantID) {
    if (!tenantID) throw createError(400, "tenantID is required");

    const key = KEY_LIST(tenantID);
    const cached = await redis.get(key);

    if (cached) return JSON.parse(cached);

    const pelanggan = await Pelanggan.find({
      tenantID
    })
      .sort({
        namaPelanggan: 1
      })
      .lean();

    if (pelanggan.length > 0) {
      await redis.set(key, JSON.stringify(pelanggan), "EX", 300);
    }

    return pelanggan;
  }

  async getById(id, requesterTenantID) {
    const key = KEY_DETAIL(id);
    const cached = await redis.get(key);

    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed.tenantID !== requesterTenantID.toString()) return null;
      return parsed;
    }

    const pelanggan = await Pelanggan.findOne({
      _id: id,
      tenantID: requesterTenantID,
    }).lean();

    if (!pelanggan) return null;

    await redis.set(key, JSON.stringify(pelanggan), "EX", 300);
    return pelanggan;
  }

  async create(payload) {
    const validation = validatePelangganPayload(payload);
    if (!validation.valid) return {
      error: validation.errors
    };

    // Sanitize payload from null IDs sent by Flutter
    if (!payload._id) delete payload._id;
    if (!payload.id) delete payload.id;

    try {
      const pelanggan = await Pelanggan.create(payload);
      await this.clearCache(payload.tenantID);
      return pelanggan;
    } catch (err) {
      return this._handleDbError(err);
    }
  }

  async update(id, payload, requesterTenantID) {
    const validation = validatePelangganPayload(payload, true);
    if (!validation.valid) return {
      error: validation.errors
    };

    delete payload.tenantID;
    delete payload._id;
    delete payload.saldoPiutang;
    delete payload.poinLoyalitas;

    try {
      const updated = await Pelanggan.findOneAndUpdate({
        _id: id,
        tenantID: requesterTenantID
      }, payload, {
        new: true,
        runValidators: true
      }).lean();

      if (!updated) return null;

      await this.clearCache(requesterTenantID, id);
      return updated;
    } catch (err) {
      return this._handleDbError(err);
    }
  }

  async delete(id, requesterTenantID) {
    const result = await Pelanggan.deleteOne({
      _id: id,
      tenantID: requesterTenantID,
    });

    if (result.deletedCount === 0) return null;

    await this.clearCache(requesterTenantID, id);
    return true;
  }

  _handleDbError(err) {
    if (err.code === 11000) {
      const fields = err.keyValue;
      if (fields.namaPelanggan) {
        return {
          error: [`Nama pelanggan '${fields.namaPelanggan}' sudah terdaftar.`],
        };
      }
      if (fields.nomorHp) {
        return {
          error: [
            `Nomor HP '${fields.nomorHp}' sudah digunakan oleh pelanggan lain.`,
          ],
        };
      }
      if (fields.email) {
        return {
          error: [
            `Email '${fields.email}' sudah digunakan oleh pelanggan lain.`,
          ],
        };
      }
      return {
        error: ["Data duplikat terdeteksi."]
      };
    }
    throw err;
  }
}

module.exports = new PelangganService();