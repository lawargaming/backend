const Penjualan = require("../models/penjualanModel");
const Diskon = require("../models/diskonModel");
const Produk = require("../models/produkModel");
const Pajak = require("../models/pajakModel");
const SesiBooking = require("../models/sesiBookingModel");
const pajakService = require("./pajakService");
const diskonService = require("./diskonService");
const redis = require("../config/redis");
const { validatePenjualanPayload } = require("../validators/penjualanValidator");
const createError = require("http-errors");

const CACHE_KEY_LIST = (tenantID) => `penjualan:tenant:${tenantID}`;
const CACHE_KEY_DETAIL = (id) => `penjualan:detail:${id}`;
const CACHE_KEY_BOOKING_LIST = (tenantID) => `booking:tenant:${tenantID}`;

class PenjualanService {
  _normalizeIds(value) {
    if (value === undefined || value === null || value === "") return [];
    if (Array.isArray(value)) {
      return value.filter(Boolean).map((x) => x.toString());
    }

    return [value.toString()];
  }

  _generateNoReferensi(jenisTransaksi) {
    const date = new Date();
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const hh = String(date.getHours()).padStart(2, "0");
    const min = String(date.getMinutes()).padStart(2, "0");
    const ss = String(date.getSeconds()).padStart(2, "0");
    const ms = String(date.getMilliseconds()).padStart(3, "0");
    const prefix = jenisTransaksi === "INVOICE" ? "INV" : "POS";

    return `${prefix}/TKA/${yyyy}${mm}${dd}/${hh}${min}${ss}${ms}`;
  }

  _formatOutput(doc) {
    if (!doc) return null;
    if (Array.isArray(doc)) return doc.map((d) => this._formatOutput(d));

    const diskonGlobal = Array.isArray(doc.diskonGlobalIDs)
      ? doc.diskonGlobalIDs
      : [];

    const pajakTransaksiIDs = Array.isArray(doc.pajakTransaksiIDs)
      ? doc.pajakTransaksiIDs
      : [];

    let orderedItems = [];

    if (doc.itemPenjualan && Array.isArray(doc.itemPenjualan)) {
      orderedItems = doc.itemPenjualan.map((item) => {
        const diskonItem = Array.isArray(item.diskonItemIDs)
          ? item.diskonItemIDs
          : [];

        return {
          sesiBookingID: item.sesiBookingID ?? null,
          produkID: item.produkID,
          namaProduk: item.namaProduk,
          jumlah: item.jumlah,
          hargaJual: item.hargaJual,
          subTotal: item.subTotal,
          diskonItem,
          jumlahDiskon: item.jumlahDiskon,
          total: item.total,
          rincianPajak: Array.isArray(item.rincianPajak)
            ? item.rincianPajak.map((pajak) => ({
                _id: pajak._id || pajak.pajakID || null,
                namaPajak: pajak.namaPajak || null,
                tarifPajak:
                  pajak.tarifPajak !== undefined
                    ? pajak.tarifPajak
                    : pajak.tarif !== undefined
                      ? pajak.tarif
                      : 0,
                jumlah: pajak.jumlah || 0,
                model: pajak.model || null,
              }))
            : [],
          jumlahPajak: item.jumlahPajak || 0,
          totalharga: item.totalharga || 0,
        };
      });
    }

    const pajakTransaksi = pajakTransaksiIDs.map((pajak, index) => {
      const rincian = Array.isArray(doc._pajakTransaksiRincian)
        ? doc._pajakTransaksiRincian
        : [];

      const matched =
        rincian.find((r) => String(r.pajakID) === String(pajak._id || pajak)) ||
        rincian[index] ||
        null;

      if (pajak && typeof pajak === "object") {
        return {
          _id: pajak._id,
          namaPajak: pajak.namaPajak,
          tarifPajak: pajak.tarifPajak,
          jumlah: matched?.jumlah || 0,
          model: matched?.model || null,
        };
      }

      return {
        _id: pajak,
        namaPajak: matched?.namaPajak || null,
        tarifPajak: matched?.tarif || 0,
        jumlah: matched?.jumlah || 0,
        model: matched?.model || null,
      };
    });

    return {
      _id: doc._id,
      tenantID: doc.tenantID,
      noReferensi: doc.noReferensi,
      dataPengguna: doc.penggunaID ?? null,
      dataPelanggan: doc.pelangganID ?? null,
      jenisTransaksi: doc.jenisTransaksi,
      jenisPenjualan: doc.jenisPenjualan,
      tanggalTransaksi: doc.tanggalTransaksi,
      jatuhTempo: doc.jatuhTempo ?? null,
      itemPenjualan: orderedItems,
      totalHargaProduk: doc.totalHargaProduk || 0,
      diskonGlobal,
      jumlahDiskonTransaksi: doc.jumlahDiskonTransaksi || 0,
      pajakTransaksi,
      jumlahPajakTransaksi: doc.jumlahPajakTransaksi || 0,
      totalTagihan: doc.totalTagihan || 0,
      totalDibayar: doc.totalDibayar || 0,
      sisaTagihan: doc.sisaTagihan || 0,
      statusBayar: doc.statusBayar,
      keterangan: doc.keterangan || "",
      statusPenjualan: doc.statusPenjualan,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  _applyFilters(list, filters = {}) {
    if (!filters || typeof filters !== "object") return list;

    const {
      statusBayar,
      statusPenjualan,
      jenisTransaksi,
      jenisPenjualan,
      pelangganID,
      startDate,
      endDate,
      noReferensi,
    } = filters;

    let out = Array.isArray(list) ? list : [];

    if (statusBayar) {
      out = out.filter((x) => x.statusBayar === statusBayar);
    }

    if (statusPenjualan) {
      out = out.filter((x) => x.statusPenjualan === statusPenjualan);
    }

    if (jenisTransaksi) {
      out = out.filter((x) => x.jenisTransaksi === jenisTransaksi);
    }

    if (jenisPenjualan) {
      out = out.filter((x) => x.jenisPenjualan === jenisPenjualan);
    }

    if (noReferensi) {
      const q = String(noReferensi).toLowerCase();
      out = out.filter((x) =>
        String(x.noReferensi || "").toLowerCase().includes(q)
      );
    }

    if (pelangganID) {
      const pid = String(pelangganID);

      out = out.filter((x) => {
        const v = x.dataPelanggan;
        if (!v) return false;

        const actual = typeof v === "object" && v._id ? String(v._id) : String(v);

        return actual === pid;
      });
    }

    if (startDate || endDate) {
      const start = startDate ? new Date(startDate) : null;
      const end = endDate ? new Date(endDate) : null;

      out = out.filter((x) => {
        const t = x.tanggalTransaksi ? new Date(x.tanggalTransaksi) : null;
        if (!t || Number.isNaN(t.getTime())) return false;

        if (start && !Number.isNaN(start.getTime()) && t < start) return false;
        if (end && !Number.isNaN(end.getTime()) && t > end) return false;

        return true;
      });
    }

    return out;
  }

  async _applyDiskonBerurutan({ baseAmount, diskonIds, tenantID, cakupan }) {
    if (!diskonIds || diskonIds.length === 0) {
      return { totalDiskon: 0, appliedIds: [] };
    }

    const check = await diskonService.validateKombinasiDiskon(diskonIds, tenantID);

    if (!check.valid) {
      return { error: check.errors };
    }

    const diskonDocs = await Diskon.find({
      _id: { $in: diskonIds },
      tenantID,
      status: "Aktif",
      cakupan,
    })
      .select("_id tipe nilai cakupan status bisaDigabung")
      .lean();

    if (diskonDocs.length !== diskonIds.length) {
      return {
        error: [
          `Diskon ${cakupan} ada yang tidak valid / non-aktif / salah cakupan / beda tenant.`,
        ],
      };
    }

    const byId = new Map(diskonDocs.map((d) => [d._id.toString(), d]));
    const ordered = diskonIds.map((id) => byId.get(id.toString()));

    let running = Number(baseAmount) || 0;
    if (running < 0) running = 0;

    let totalDiskon = 0;

    for (const d of ordered) {
      if (!d) continue;

      let potong = 0;

      if (d.tipe === "persen") {
        potong = Math.ceil((running * d.nilai) / 100);
      } else {
        potong = Number(d.nilai) || 0;
      }

      if (potong < 0) potong = 0;
      if (potong > running) potong = running;

      totalDiskon += potong;
      running -= potong;

      if (running <= 0) {
        running = 0;
        break;
      }
    }

    return { totalDiskon, appliedIds: diskonIds };
  }

  async _applyPajakTransaksi({ baseAmount, pajakIds, tenantID }) {
    if (!pajakIds || pajakIds.length === 0) {
      return {
        totalPajak: 0,
        grandTotal: Number(baseAmount) || 0,
        rincian: [],
        appliedIds: [],
      };
    }

    const pajakDocs = await Pajak.find({
      _id: { $in: pajakIds },
      tenantID,
      tipePajak: false,
      statusPajak: true,
    }).lean();

    if (pajakDocs.length !== pajakIds.length) {
      return {
        error: [
          "Pajak transaksi ada yang tidak valid / non-aktif / bukan milik tenant.",
        ],
      };
    }

    const byId = new Map(pajakDocs.map((d) => [d._id.toString(), d]));
    const ordered = pajakIds.map((id) => byId.get(id.toString())).filter(Boolean);
    const sorted = [...ordered].sort(
      (a, b) => (a.prioritas || 0) - (b.prioritas || 0)
    );

    let totalPajak = 0;
    let runningTotal = Number(baseAmount) || 0;
    const rincian = [];

    for (const p of sorted) {
      let nilaiPajakPerItem = 0;

      if (p.modelPerhitungan === 1) {
        nilaiPajakPerItem =
          (runningTotal / (1 + p.tarifPajak / 100)) * (p.tarifPajak / 100);
      } else if (p.modelPerhitungan === 2) {
        nilaiPajakPerItem = (Number(baseAmount) || 0) * (p.tarifPajak / 100);
        runningTotal += nilaiPajakPerItem;
      } else if (p.modelPerhitungan === 3) {
        nilaiPajakPerItem = runningTotal * (p.tarifPajak / 100);
        runningTotal += nilaiPajakPerItem;
      }

      totalPajak += nilaiPajakPerItem;

      rincian.push({
        pajakID: p._id,
        namaPajak: p.namaPajak,
        tarif: p.tarifPajak,
        jumlah: Math.round(nilaiPajakPerItem),
        model:
          p.modelPerhitungan === 1
            ? "Inclusive"
            : p.modelPerhitungan === 2
              ? "Exclusive"
              : "Compound",
      });
    }

    return {
      totalPajak: Math.round(totalPajak),
      grandTotal: Math.round(runningTotal),
      rincian,
      appliedIds: sorted.map((item) => item._id.toString()),
    };
  }

  async _getActivePajakTransaksi(tenantID) {
    const pajakTransaksi = await Pajak.find({
      tenantID,
      tipePajak: false,
      statusPajak: true,
    })
      .select(
        "_id namaPajak tarifPajak tipePajak modelPerhitungan prioritas statusPajak"
      )
      .sort({ prioritas: 1, createdAt: 1 })
      .lean();

    return pajakTransaksi.map((item) => item._id.toString());
  }

  async _recalc(payload, tenantID) {
    let grandTotalItem = 0;

    if (payload.itemPenjualan && payload.itemPenjualan.length > 0) {
      for (const [index, item] of payload.itemPenjualan.entries()) {
        const produkData = await Produk.findOne({
          _id: item.produkID,
          tenantID,
        });

        if (!produkData) {
          return {
            error: [`Produk ID ${item.produkID} tidak ditemukan atau akses ditolak.`],
          };
        }

        if (!item.namaProduk) {
          item.namaProduk = produkData.namaProduk;
        }

        if (item.hargaJual === undefined || item.hargaJual === null) {
          item.hargaJual = produkData.hargaJual;
        }

        const qty = item.jumlah || 1;
        const hrg = item.hargaJual || 0;
        item.subTotal = qty * hrg;

        const itemDiskonIds = this._normalizeIds(item.diskonItem);

        if (itemDiskonIds.length > 0) {
          const diskonItemRes = await this._applyDiskonBerurutan({
            baseAmount: item.subTotal,
            diskonIds: itemDiskonIds,
            tenantID,
            cakupan: "Item",
          });

          if (diskonItemRes.error) {
            return {
              error: [`Item #${index + 1}: ${diskonItemRes.error.join(", ")}`],
            };
          }

          item.jumlahDiskon = diskonItemRes.totalDiskon;
          item.diskonItemIDs = diskonItemRes.appliedIds;
        } else {
          let manualDiskon = Number(item.jumlahDiskon) || 0;

          if (manualDiskon < 0) {
            manualDiskon = 0;
          }

          if (manualDiskon > item.subTotal) {
            manualDiskon = item.subTotal;
          }

          item.jumlahDiskon = manualDiskon;
          item.diskonItemIDs = [];
        }

        delete item.diskonItem;

        item.total = item.subTotal - item.jumlahDiskon;

        if (item.total < 0) {
          item.total = 0;
        }

        const pajakCalc = await pajakService.hitungPajakProduk(
          item.produkID,
          item.total,
          tenantID
        );

        item.rincianPajak = pajakCalc.rincian;
        item.jumlahPajak = pajakCalc.totalPajak;
        item.totalharga = pajakCalc.grandTotal;

        grandTotalItem += item.totalharga;
      }
    }

    const globalDiskonIds = this._normalizeIds(payload.diskonGlobal);

    if (globalDiskonIds.length > 0) {
      const diskonGblRes = await this._applyDiskonBerurutan({
        baseAmount: grandTotalItem,
        diskonIds: globalDiskonIds,
        tenantID,
        cakupan: "Global",
      });

      if (diskonGblRes.error) {
        return { error: [diskonGblRes.error.join(", ")] };
      }

      payload.jumlahDiskonTransaksi = diskonGblRes.totalDiskon;
      payload.diskonGlobalIDs = diskonGblRes.appliedIds;
    } else {
      let manualDiskonTransaksi = Number(payload.jumlahDiskonTransaksi) || 0;

      if (manualDiskonTransaksi < 0) {
        manualDiskonTransaksi = 0;
      }

      if (manualDiskonTransaksi > grandTotalItem) {
        manualDiskonTransaksi = grandTotalItem;
      }

      payload.jumlahDiskonTransaksi = manualDiskonTransaksi;
      payload.diskonGlobalIDs = [];
    }

    delete payload.diskonGlobal;

    const dasarSetelahDiskon = Math.max(
      0,
      grandTotalItem - (payload.jumlahDiskonTransaksi || 0)
    );

    const pajakTransaksiIds = await this._getActivePajakTransaksi(tenantID);

    const pajakTransaksiRes = await this._applyPajakTransaksi({
      baseAmount: dasarSetelahDiskon,
      pajakIds: pajakTransaksiIds,
      tenantID,
    });

    if (pajakTransaksiRes.error) {
      return { error: pajakTransaksiRes.error };
    }

    payload.pajakTransaksiIDs = pajakTransaksiRes.appliedIds;
    payload.jumlahPajakTransaksi = pajakTransaksiRes.totalPajak;
    payload._pajakTransaksiRincian = pajakTransaksiRes.rincian;
    delete payload.pajakTransaksi;

    return { payload };
  }

  async getAll(tenantID, filters = {}) {
    const key = CACHE_KEY_LIST(tenantID);
    const cached = await redis.get(key);

    let formatted;

    if (cached) {
      formatted = JSON.parse(cached);
    } else {
      const penjualans = await Penjualan.find({ tenantID })
        .populate("penggunaID", "nama")
        .populate("pelangganID", "namaPelanggan tipePelanggan nomorHp")
        .populate(
          "pajakTransaksiIDs",
          "namaPajak tarifPajak tipePajak modelPerhitungan prioritas statusPajak"
        )
        .populate("diskonGlobalIDs", "namaDiskon tipe nilai cakupan bisaDigabung")
        .populate(
          "itemPenjualan.diskonItemIDs",
          "namaDiskon tipe nilai cakupan bisaDigabung"
        )
        .sort({ createdAt: -1 })
        .lean();

      formatted = this._formatOutput(penjualans);

      if (formatted.length > 0) {
        await redis.set(key, JSON.stringify(formatted), "EX", 60);
      }
    }

    return this._applyFilters(formatted, filters);
  }

  async getById(id, tenantID) {
    const key = CACHE_KEY_DETAIL(id);
    const cached = await redis.get(key);

    if (cached) {
      const parsed = JSON.parse(cached);

      if (parsed.tenantID !== tenantID.toString()) {
        return null;
      }

      return parsed;
    }

    const penjualan = await Penjualan.findOne({ _id: id, tenantID })
      .populate("penggunaID", "nama")
      .populate("pelangganID", "namaPelanggan tipePelanggan alamat email")
      .populate(
        "pajakTransaksiIDs",
        "namaPajak tarifPajak tipePajak modelPerhitungan prioritas statusPajak"
      )
      .populate("diskonGlobalIDs", "namaDiskon tipe nilai cakupan bisaDigabung")
      .populate(
        "itemPenjualan.diskonItemIDs",
        "namaDiskon tipe nilai cakupan bisaDigabung"
      )
      .lean();

    if (!penjualan) {
      return null;
    }

    const formatted = this._formatOutput(penjualan);
    await redis.set(key, JSON.stringify(formatted), "EX", 60);

    return formatted;
  }

  async create(payload) {
    const validation = validatePenjualanPayload(payload);

    if (!validation.valid) {
      return { error: validation.errors };
    }

    const tenantID = payload.tenantID;

    if (!payload.penggunaID) {
      return { error: ["penggunaID wajib terisi dari sesi login."] };
    }

    let statusPenjualan = "FINAL";

    if (payload.simpanDraft === true || payload.statusPenjualan === "DRAFT") {
      statusPenjualan = "DRAFT";
    }

    delete payload.simpanDraft;
    payload.statusPenjualan = statusPenjualan;

    if (!payload.noReferensi) {
      payload.noReferensi = this._generateNoReferensi(payload.jenisTransaksi);
    }

    const recalc = await this._recalc(payload, tenantID);

    if (recalc.error) {
      return { error: recalc.error };
    }

    payload = recalc.payload;

    const created = await Penjualan.create(payload);

    await redis.del(CACHE_KEY_LIST(tenantID));

    const result = await Penjualan.findById(created._id)
      .populate("penggunaID", "nama")
      .populate("pelangganID", "namaPelanggan tipePelanggan")
      .populate(
        "pajakTransaksiIDs",
        "namaPajak tarifPajak tipePajak modelPerhitungan prioritas statusPajak"
      )
      .populate("diskonGlobalIDs", "namaDiskon tipe nilai cakupan bisaDigabung")
      .populate(
        "itemPenjualan.diskonItemIDs",
        "namaDiskon tipe nilai cakupan bisaDigabung"
      )
      .lean();

    result._pajakTransaksiRincian = payload._pajakTransaksiRincian || [];

    return this._formatOutput(result);
  }

  async update(id, payload, tenantID) {
    const validation = validatePenjualanPayload(payload, true);

    if (!validation.valid) {
      return { error: validation.errors };
    }

    const current = await Penjualan.findOne({ _id: id, tenantID });

    if (!current) {
      return null;
    }

    if (current.statusPenjualan === "FINAL") {
      throw createError(400, "Penjualan sudah FINAL dan tidak bisa diubah.");
    }

    delete payload.penggunaID;

    const willFinalize =
      payload.finalize === true || payload.statusPenjualan === "FINAL";

    delete payload.finalize;

    const merged = current.toObject();
    Object.assign(merged, payload);

    if (payload.pajakTransaksi !== undefined) {
      merged.pajakTransaksi = payload.pajakTransaksi;
    } else {
      merged.pajakTransaksi = Array.isArray(merged.pajakTransaksiIDs)
        ? merged.pajakTransaksiIDs
        : [];
    }

    if (payload.diskonGlobal !== undefined) {
      merged.diskonGlobal = payload.diskonGlobal;
    } else {
      merged.diskonGlobal = Array.isArray(merged.diskonGlobalIDs)
        ? merged.diskonGlobalIDs
        : [];
    }

    if (payload.itemPenjualan !== undefined) {
      merged.itemPenjualan = payload.itemPenjualan;
    } else {
      merged.itemPenjualan = merged.itemPenjualan.map((it) => {
        it.diskonItem = Array.isArray(it.diskonItemIDs) ? it.diskonItemIDs : [];
        return it;
      });
    }

    const recalc = await this._recalc(merged, tenantID);

    if (recalc.error) {
      return { error: recalc.error };
    }

    Object.assign(current, recalc.payload);
    current.statusPenjualan = willFinalize ? "FINAL" : "DRAFT";

    await current.save();

    if (current.jenisPenjualan === "booking" && current.itemPenjualan) {
      for (const item of current.itemPenjualan) {
        if (item.sesiBookingID) {
          await SesiBooking.findByIdAndUpdate(item.sesiBookingID, {
            totalBiaya: item.total,
          });

          await redis.del(`booking:detail:${item.sesiBookingID}`);
        }
      }

      await redis.del(CACHE_KEY_BOOKING_LIST(current.tenantID));
    }

    await redis.del(CACHE_KEY_LIST(tenantID));
    await redis.del(CACHE_KEY_DETAIL(id));

    const result = await Penjualan.findById(id)
      .populate("penggunaID", "nama")
      .populate("pelangganID", "namaPelanggan tipePelanggan")
      .populate(
        "pajakTransaksiIDs",
        "namaPajak tarifPajak tipePajak modelPerhitungan prioritas statusPajak"
      )
      .populate("diskonGlobalIDs", "namaDiskon tipe nilai cakupan bisaDigabung")
      .populate(
        "itemPenjualan.diskonItemIDs",
        "namaDiskon tipe nilai cakupan bisaDigabung"
      )
      .lean();

    result._pajakTransaksiRincian = recalc.payload._pajakTransaksiRincian || [];

    return this._formatOutput(result);
  }

  async delete(id, tenantID) {
    const current = await Penjualan.findOne({ _id: id, tenantID }).lean();

    if (!current) {
      return null;
    }

    if (current.statusPenjualan === "FINAL") {
      throw createError(400, "Penjualan FINAL tidak bisa dihapus.");
    }

    const result = await Penjualan.deleteOne({ _id: id, tenantID });

    if (result.deletedCount === 0) {
      return null;
    }

    await redis.del(CACHE_KEY_LIST(tenantID));
    await redis.del(CACHE_KEY_DETAIL(id));

    return true;
  }
}

module.exports = new PenjualanService();