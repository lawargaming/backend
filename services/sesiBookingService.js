const mongoose = require("mongoose");
const createError = require("http-errors");

const SesiBooking = require("../models/sesiBookingModel");
const Penjualan = require("../models/penjualanModel");
const Aset = require("../models/asetModel");
const Tarif = require("../models/tarifModel");
const Diskon = require("../models/diskonModel");

const diskonService = require("./diskonService");
const pajakService = require("./pajakService");

const redis = require("../config/redis");
const { validateSesiBookingPayload } = require("../validators/sesiBookingValidator");

const CACHE_KEY_LIST = (tenantID, dateStr) =>
  dateStr
    ? `booking:tenant:${tenantID}:date:${dateStr}`
    : `booking:tenant:${tenantID}`;

const CACHE_KEY_DETAIL = (id) => `booking:detail:${id}`;

function toYMDLocal(dateObj) {
  const d = new Date(dateObj);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd}`;
}

async function invalidateTenantCache(tenantID, dates = []) {
  const keysToDel = [CACHE_KEY_LIST(tenantID)];

  dates.forEach((date) => {
    if (!date) return;

    let dStr = null;

    if (typeof date === "string") {
      if (!date.includes("T") && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
        dStr = date;
      } else {
        dStr = toYMDLocal(new Date(date));
      }
    } else {
      dStr = toYMDLocal(new Date(date));
    }

    if (dStr) {
      keysToDel.push(CACHE_KEY_LIST(tenantID, dStr));
    }
  });

  if (keysToDel.length > 0) {
    await redis.del(...keysToDel);
  }
}

class SesiBookingService {
  _generateNoReferensi() {
    const date = new Date();
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const hh = String(date.getHours()).padStart(2, "0");
    const min = String(date.getMinutes()).padStart(2, "0");
    const ss = String(date.getSeconds()).padStart(2, "0");
    const ms = String(date.getMilliseconds()).padStart(3, "0");

    return `INV/TKA/${yyyy}${mm}${dd}/${hh}${min}${ss}${ms}`;
  }

  _normalizeIds(value) {
    if (value === undefined || value === null || value === "") return [];

    if (Array.isArray(value)) {
      return value.filter(Boolean).map((x) => x.toString());
    }

    return [value.toString()];
  }

  _formatPenjualanOutput(doc) {
    if (!doc) return null;

    const diskonGlobal = Array.isArray(doc.diskonGlobalIDs)
      ? doc.diskonGlobalIDs
      : [];

    const itemPenjualan = Array.isArray(doc.itemPenjualan)
      ? doc.itemPenjualan.map((it) => ({
          sesiBookingID: it.sesiBookingID ?? null,
          produkID: it.produkID,
          namaProduk: it.namaProduk,
          jumlah: it.jumlah,
          hargaJual: it.hargaJual,
          subTotal: it.subTotal,
          diskonItem: Array.isArray(it.diskonItemIDs) ? it.diskonItemIDs : [],
          jumlahDiskon: it.jumlahDiskon,
          total: it.total,
          rincianPajak: it.rincianPajak || [],
          jumlahPajak: it.jumlahPajak || 0,
          totalharga: it.totalharga || 0,
        }))
      : [];

    return {
      _id: doc._id,
      tenantID: doc.tenantID,
      noReferensi: doc.noReferensi,
      dataPengguna: doc.penggunaID ?? null,
      dataPelanggan: doc.dataPelanggan ?? null,
      jenisTransaksi: doc.jenisTransaksi,
      jenisPenjualan: doc.jenisPenjualan,
      tanggalTransaksi: doc.tanggalTransaksi,
      jatuhTempo: doc.jatuhTempo ?? null,
      itemPenjualan,
      totalHargaProduk: doc.totalHargaProduk || 0,
      diskonGlobal,
      jumlahDiskonTransaksi: doc.jumlahDiskonTransaksi || 0,
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

  _formatBookingOutput(doc) {
    if (!doc) return null;
    if (Array.isArray(doc)) return doc.map((d) => this._formatBookingOutput(d));

    return {
      _id: doc._id,
      tenantID: doc.tenantID,
      dataPengguna: doc.dataPengguna ?? null,
      dataPelanggan: doc.dataPelanggan ?? null,
      dataAset: doc.dataAset ?? null,
      dataTarif: doc.dataTarif ?? null,
      waktuMulai: doc.waktuMulai,
      waktuSelesai: doc.waktuSelesai ?? null,
      durasiMenit: doc.durasiMenit ?? null,
      totalBiaya: doc.totalBiaya ?? null,
      status: doc.status,
      dataPenjualan: this._formatPenjualanOutput(doc.dataPenjualan),
    };
  }

  async _findBestTarif(tenantID, tipeAsetID, waktuMulaiIso) {
    const bookingTime = new Date(waktuMulaiIso);
    const dayOfWeek = bookingTime.getDay();
    const hours = String(bookingTime.getHours()).padStart(2, "0");
    const minutes = String(bookingTime.getMinutes()).padStart(2, "0");
    const timeString = `${hours}:${minutes}`;

    const tariffs = await Tarif.find({ tenantID, tipeAsetID }).lean();
    if (!tariffs || tariffs.length === 0) return null;

    const candidates = tariffs.filter((t) => {
      if (t.hariAktif && t.hariAktif.length > 0) {
        if (!t.hariAktif.includes(dayOfWeek)) return false;
      }

      if (t.jamMulai && t.jamSelesai) {
        if (timeString < t.jamMulai || timeString > t.jamSelesai) return false;
      }

      return true;
    });

    if (candidates.length > 0) {
      candidates.sort((a, b) => {
        if (b.prioritas !== a.prioritas) return b.prioritas - a.prioritas;
        return a.harga - b.harga;
      });

      return candidates[0];
    }

    const def = tariffs.find((t) => t.isDefault === true);
    return def || null;
  }

  async _calculateCost(tenantID, asetID, dataTarif, durasiMenit, waktuMulai) {
    const asset = await Aset.findById(asetID);

    if (!asset) {
      throw createError(404, "Aset tidak ditemukan saat hitung biaya.");
    }

    let tarif;

    if (dataTarif) {
      tarif = await Tarif.findOne({ _id: dataTarif, tenantID });

      if (!tarif) {
        throw createError(404, "Tarif manual tidak ditemukan atau tidak valid.");
      }

      const tipeList = Array.isArray(tarif.tipeAsetID)
        ? tarif.tipeAsetID
        : [tarif.tipeAsetID];

      const isValidForAsset = tipeList.some(
        (id) => id?.toString() === asset.tipeAsetID.toString()
      );

      if (!isValidForAsset) {
        throw createError(
          400,
          `Tarif '${tarif.namaTarif}' tidak berlaku untuk aset '${asset.namaAset}'.`
        );
      }
    } else {
      tarif = await this._findBestTarif(tenantID, asset.tipeAsetID, waktuMulai);

      if (!tarif) {
        throw createError(
          400,
          `Tidak ditemukan tarif yang cocok untuk waktu: ${waktuMulai}. Hubungi admin toko.`
        );
      }
    }

    let hargaKotor = 0;

    if (tarif.basisPerhitungan === "per sesi") {
      hargaKotor = tarif.harga;
    } else if (tarif.basisPerhitungan === "per jam") {
      const durasiJam = durasiMenit / 60;
      const durasiKalkulasi = Math.max(durasiJam, tarif.durasiMinimum || 0);
      hargaKotor = durasiKalkulasi * tarif.harga;
    }

    return {
      harga: Math.ceil(hargaKotor),
      namaTarif: tarif.namaTarif,
      tarifObj: tarif,
    };
  }

  async _checkConflict(asetID, startStr, endStr, excludeId = null) {
    const start = new Date(startStr);
    const end = new Date(endStr);

    const q = {
      dataAset: asetID,
      status: "Aktif",
      waktuMulai: { $lt: end },
      $or: [{ waktuSelesai: null }, { waktuSelesai: { $gt: start } }],
    };

    if (excludeId) {
      q._id = { $ne: excludeId };
    }

    const conflict = await SesiBooking.findOne(q).lean();
    return !!conflict;
  }

  async _applyDiskonBerurutan({ baseAmount, diskonIds, tenantID, cakupan }) {
    const ids = this._normalizeIds(diskonIds);

    if (ids.length === 0) {
      return { totalDiskon: 0, appliedIds: [] };
    }

    if (ids.length > 1) {
      const check = await diskonService.validateKombinasiDiskon(ids, tenantID);

      if (!check.valid) {
        return { error: check.errors };
      }
    }

    const diskonDocs = await Diskon.find({
      _id: { $in: ids },
      tenantID,
      status: "Aktif",
      cakupan,
    })
      .select("_id tipe nilai cakupan status bisaDigabung")
      .lean();

    if (diskonDocs.length !== ids.length) {
      return {
        error: [
          `Diskon ${cakupan} ada yang tidak valid / non-aktif / salah cakupan / beda tenant.`,
        ],
      };
    }

    const byId = new Map(diskonDocs.map((d) => [d._id.toString(), d]));
    const ordered = ids.map((id) => byId.get(id));

    let running = Number(baseAmount) || 0;
    if (running < 0) running = 0;

    let totalDiskon = 0;

    for (const d of ordered) {
      let potong = 0;

      if (d.tipe === "persen") {
        potong = Math.ceil((running * d.nilai) / 100);
      } else {
        potong = Number(d.nilai) || 0;
      }

      if (potong > running) potong = running;
      if (potong < 0) potong = 0;

      totalDiskon += potong;
      running -= potong;

      if (running <= 0) break;
    }

    return { totalDiskon, appliedIds: ids };
  }

  async getAll(tenantID, tanggalDate) {
    if (!tenantID) {
      throw createError(400, "tenantID is required");
    }

    let dateStr = null;

    if (tanggalDate && typeof tanggalDate === "string") {
      if (!tanggalDate.includes("T") && /^\d{4}-\d{2}-\d{2}$/.test(tanggalDate)) {
        dateStr = tanggalDate;
      } else {
        dateStr = toYMDLocal(new Date(tanggalDate));
      }
    }

    const key = CACHE_KEY_LIST(tenantID, dateStr);
    const cached = await redis.get(key);

    if (cached) {
      return JSON.parse(cached);
    }

    const query = { tenantID };

    if (dateStr) {
      const start = new Date(`${dateStr}T00:00:00`);
      const end = new Date(`${dateStr}T23:59:59.999`);
      query.waktuMulai = { $gte: start, $lte: end };
    }

    const bookings = await SesiBooking.find(query)
      .populate("dataAset", "namaAset status")
      .populate("dataPengguna", "nama")
      .populate("dataPelanggan", "namaPelanggan tipePelanggan")
      .populate("dataTarif", "namaTarif harga")
      .populate({
        path: "dataPenjualan",
        populate: [
          { path: "penggunaID", select: "nama" },
          {
            path: "dataPelanggan",
            select: "namaPelanggan tipePelanggan nomorHp",
          },
          {
            path: "diskonGlobalIDs",
            select: "namaDiskon tipe nilai cakupan bisaDigabung",
          },
          {
            path: "itemPenjualan.diskonItemIDs",
            select: "namaDiskon tipe nilai cakupan bisaDigabung",
          },
        ],
      })
      .sort({ waktuMulai: -1 })
      .lean();

    const formatted = this._formatBookingOutput(bookings);

    if (formatted.length > 0) {
      await redis.set(key, JSON.stringify(formatted), "EX", 300);
    }

    return formatted;
  }

  async getById(id, requesterTenantID) {
    const key = CACHE_KEY_DETAIL(id);
    const cached = await redis.get(key);

    if (cached) {
      const parsed = JSON.parse(cached);

      if (parsed.tenantID !== requesterTenantID.toString()) {
        return null;
      }

      return parsed;
    }

    const booking = await SesiBooking.findOne({
      _id: id,
      tenantID: requesterTenantID,
    })
      .populate("dataAset", "namaAset status")
      .populate("dataPengguna", "nama")
      .populate("dataPelanggan", "namaPelanggan tipePelanggan")
      .populate("dataTarif", "namaTarif harga")
      .populate({
        path: "dataPenjualan",
        populate: [
          { path: "penggunaID", select: "nama" },
          {
            path: "dataPelanggan",
            select: "namaPelanggan tipePelanggan nomorHp alamat email",
          },
          {
            path: "diskonGlobalIDs",
            select: "namaDiskon tipe nilai cakupan bisaDigabung",
          },
          {
            path: "itemPenjualan.diskonItemIDs",
            select: "namaDiskon tipe nilai cakupan bisaDigabung",
          },
        ],
      })
      .lean();

    if (!booking) {
      return null;
    }

    const formatted = this._formatBookingOutput(booking);
    await redis.set(key, JSON.stringify(formatted), "EX", 300);

    return formatted;
  }

  async create(payload) {
    const validation = validateSesiBookingPayload(payload);

    if (!validation.valid) {
      return { error: validation.errors };
    }

    const tenantID = payload.tenantID;

    const targetAset = await Aset.findById(payload.dataAset);

    if (!targetAset) {
      return { error: ["Aset tidak ditemukan."] };
    }

    if (targetAset.tenantID.toString() !== tenantID.toString()) {
      return { error: ["Akses ditolak: aset bukan milik tenant Anda."] };
    }

    if (!payload.waktuSelesai) {
      return { error: ["waktuSelesai wajib diisi untuk membuat booking."] };
    }

    const conflict = await this._checkConflict(
      payload.dataAset,
      payload.waktuMulai,
      payload.waktuSelesai
    );

    if (conflict) {
      return { error: ["Aset sedang digunakan pada jam tersebut."] };
    }

    const start = new Date(payload.waktuMulai);
    const end = new Date(payload.waktuSelesai);
    const durasiMenit = Math.ceil((end - start) / (1000 * 60));

    const calc = await this._calculateCost(
      tenantID,
      payload.dataAset,
      payload.dataTarif,
      durasiMenit,
      payload.waktuMulai
    );

    const hargaKotor = calc.harga;
    const namaTarifApplied = calc.namaTarif;
    const finalDataTarif = calc.tarifObj._id;

    const diskonItemRes = await this._applyDiskonBerurutan({
      baseAmount: hargaKotor,
      diskonIds: payload.diskonItem,
      tenantID,
      cakupan: "Item",
    });

    if (diskonItemRes.error) {
      return { error: diskonItemRes.error };
    }

    const jumlahDiskonItem = diskonItemRes.totalDiskon;

    let totalSetelahDiskonItem = hargaKotor - jumlahDiskonItem;
    if (totalSetelahDiskonItem < 0) totalSetelahDiskonItem = 0;

    const pajakCalc = await pajakService.hitungPajakProduk(
      payload.dataAset,
      totalSetelahDiskonItem,
      tenantID
    );

    const totalhargaItem = pajakCalc.grandTotal;

    const diskonGlobalRes = await this._applyDiskonBerurutan({
      baseAmount: totalhargaItem,
      diskonIds: payload.diskonGlobal,
      tenantID,
      cakupan: "Global",
    });

    if (diskonGlobalRes.error) {
      return { error: diskonGlobalRes.error };
    }

    const jumlahDiskonTransaksi = diskonGlobalRes.totalDiskon;
    const totalTagihan = Math.max(totalhargaItem - jumlahDiskonTransaksi, 0);

    const newPenjualanId = new mongoose.Types.ObjectId();
    const newBookingId = new mongoose.Types.ObjectId();

    const itemPenjualanData = {
      sesiBookingID: newBookingId,
      produkID: new mongoose.Types.ObjectId(),
      namaProduk: `Sewa ${targetAset.namaAset} (${namaTarifApplied})`,
      jumlah: 1,
      hargaJual: hargaKotor,
      subTotal: hargaKotor,
      diskonItemIDs: diskonItemRes.appliedIds,
      jumlahDiskon: jumlahDiskonItem,
      total: totalSetelahDiskonItem,
      rincianPajak: pajakCalc.rincian,
      jumlahPajak: pajakCalc.totalPajak,
      totalharga: totalhargaItem,
    };

    const noRef = payload.noReferensi || this._generateNoReferensi();

    const newPenjualan = new Penjualan({
      _id: newPenjualanId,
      tenantID,
      penggunaID: payload.dataPengguna,
      dataPelanggan: payload.dataPelanggan,
      noReferensi: noRef,
      jenisTransaksi: "POS",
      jenisPenjualan: "booking",
      tanggalTransaksi: new Date(),
      jatuhTempo: null,
      itemPenjualan: [itemPenjualanData],
      diskonGlobalIDs: diskonGlobalRes.appliedIds,
      jumlahDiskonTransaksi,
      totalHargaProduk: totalhargaItem,
      totalTagihan,
      totalDibayar: 0,
      sisaTagihan: totalTagihan,
      statusBayar: totalTagihan === 0 ? "PAID" : "UNPAID",
      keterangan: "",
      statusPenjualan: payload.simpanDraft === true ? "DRAFT" : "FINAL",
    });

    const newBooking = new SesiBooking({
      _id: newBookingId,
      tenantID,
      dataPengguna: payload.dataPengguna,
      dataPelanggan: payload.dataPelanggan,
      dataAset: payload.dataAset,
      dataTarif: finalDataTarif,
      waktuMulai: payload.waktuMulai,
      waktuSelesai: payload.waktuSelesai,
      durasiMenit,
      totalBiaya: hargaKotor,
      status: payload.status || "Aktif",
      dataPenjualan: newPenjualanId,
    });

    await newPenjualan.save();
    await newBooking.save();

    await invalidateTenantCache(tenantID, [payload.waktuMulai]);
    await redis.del(CACHE_KEY_DETAIL(newBookingId.toString()));
    await redis.del(`penjualan:tenant:${tenantID}`);

    const result = await SesiBooking.findById(newBookingId)
      .populate("dataAset", "namaAset status")
      .populate("dataPengguna", "nama")
      .populate("dataPelanggan", "namaPelanggan tipePelanggan")
      .populate("dataTarif", "namaTarif harga")
      .populate({
        path: "dataPenjualan",
        populate: [
          { path: "penggunaID", select: "nama" },
          {
            path: "dataPelanggan",
            select: "namaPelanggan tipePelanggan nomorHp",
          },
          {
            path: "diskonGlobalIDs",
            select: "namaDiskon tipe nilai cakupan bisaDigabung",
          },
          {
            path: "itemPenjualan.diskonItemIDs",
            select: "namaDiskon tipe nilai cakupan bisaDigabung",
          },
        ],
      })
      .lean();

    return this._formatBookingOutput(result);
  }

  async update(id, payload, requesterTenantID) {
    const validation = validateSesiBookingPayload(payload, true);

    if (!validation.valid) {
      return { error: validation.errors };
    }

    delete payload.tenantID;
    delete payload.dataPenjualan;
    delete payload.dataPengguna;

    const currentBooking = await SesiBooking.findOne({
      _id: id,
      tenantID: requesterTenantID,
    });

    if (!currentBooking) {
      return null;
    }

    const oldTanggal = currentBooking.waktuMulai;

    const start = payload.waktuMulai
      ? new Date(payload.waktuMulai)
      : currentBooking.waktuMulai;

    const end = payload.waktuSelesai
      ? new Date(payload.waktuSelesai)
      : currentBooking.waktuSelesai;

    if (end && end <= start) {
      return { error: ["Waktu selesai harus setelah waktu mulai."] };
    }

    const asetToUse = payload.dataAset || currentBooking.dataAset;

    const shouldRecalc =
      payload.waktuMulai ||
      payload.waktuSelesai ||
      payload.dataAset ||
      payload.dataTarif !== undefined ||
      payload.diskonItem !== undefined ||
      payload.diskonGlobal !== undefined;

    if (shouldRecalc) {
      if (!end) {
        return { error: ["waktuSelesai wajib ada untuk perubahan booking."] };
      }

      const conflict = await this._checkConflict(asetToUse, start, end, id);

      if (conflict) {
        return { error: ["Aset bentrok dengan jadwal lain."] };
      }

      const durasiMenit = Math.ceil((end - start) / (1000 * 60));
      payload.durasiMenit = durasiMenit;

      const dataTarifToUse =
        payload.dataTarif !== undefined ? payload.dataTarif : currentBooking.dataTarif;

      const calc = await this._calculateCost(
        requesterTenantID,
        asetToUse,
        dataTarifToUse,
        durasiMenit,
        start
      );

      const hargaKotor = calc.harga;

      payload.totalBiaya = hargaKotor;
      payload.dataTarif = calc.tarifObj._id;

      let diskonItemIds = payload.diskonItem;
      let diskonGlobalIds = payload.diskonGlobal;

      if (diskonItemIds === undefined || diskonGlobalIds === undefined) {
        const penjualan = await Penjualan.findOne({
          _id: currentBooking.dataPenjualan,
          tenantID: requesterTenantID,
        })
          .select("diskonGlobalIDs itemPenjualan")
          .lean();

        if (penjualan) {
          if (diskonItemIds === undefined) {
            const firstItem = penjualan.itemPenjualan?.[0];
            diskonItemIds = firstItem?.diskonItemIDs || [];
          }

          if (diskonGlobalIds === undefined) {
            diskonGlobalIds = penjualan.diskonGlobalIDs || [];
          }
        }
      }

      const diskonItemRes = await this._applyDiskonBerurutan({
        baseAmount: hargaKotor,
        diskonIds: diskonItemIds,
        tenantID: requesterTenantID,
        cakupan: "Item",
      });

      if (diskonItemRes.error) {
        return { error: diskonItemRes.error };
      }

      const jumlahDiskonItem = diskonItemRes.totalDiskon;

      let totalSetelahDiskonItem = hargaKotor - jumlahDiskonItem;
      if (totalSetelahDiskonItem < 0) totalSetelahDiskonItem = 0;

      const pajakCalc = await pajakService.hitungPajakProduk(
        asetToUse,
        totalSetelahDiskonItem,
        requesterTenantID
      );

      const totalhargaItem = pajakCalc.grandTotal;

      const diskonGlobalRes = await this._applyDiskonBerurutan({
        baseAmount: totalhargaItem,
        diskonIds: diskonGlobalIds,
        tenantID: requesterTenantID,
        cakupan: "Global",
      });

      if (diskonGlobalRes.error) {
        return { error: diskonGlobalRes.error };
      }

      const jumlahDiskonTransaksi = diskonGlobalRes.totalDiskon;
      const totalTagihan = Math.max(totalhargaItem - jumlahDiskonTransaksi, 0);

      if (currentBooking.dataPenjualan) {
        await Penjualan.findOneAndUpdate(
          { _id: currentBooking.dataPenjualan, tenantID: requesterTenantID },
          {
            $set: {
              "itemPenjualan.0.hargaJual": hargaKotor,
              "itemPenjualan.0.subTotal": hargaKotor,
              "itemPenjualan.0.diskonItemIDs": diskonItemRes.appliedIds,
              "itemPenjualan.0.jumlahDiskon": jumlahDiskonItem,
              "itemPenjualan.0.total": totalSetelahDiskonItem,
              "itemPenjualan.0.rincianPajak": pajakCalc.rincian,
              "itemPenjualan.0.jumlahPajak": pajakCalc.totalPajak,
              "itemPenjualan.0.totalharga": totalhargaItem,
              diskonGlobalIDs: diskonGlobalRes.appliedIds,
              jumlahDiskonTransaksi,
              totalHargaProduk: totalhargaItem,
              totalTagihan,
              sisaTagihan: totalTagihan,
              statusBayar: totalTagihan === 0 ? "PAID" : "UNPAID",
            },
          }
        );

        await redis.del(`penjualan:detail:${currentBooking.dataPenjualan}`);
        await redis.del(`penjualan:tenant:${requesterTenantID}`);
      }

      delete payload.diskonItem;
      delete payload.diskonGlobal;
    }

    const updated = await SesiBooking.findOneAndUpdate(
      { _id: id, tenantID: requesterTenantID },
      payload,
      { new: true, runValidators: true }
    )
      .populate("dataAset", "namaAset status")
      .populate("dataPengguna", "nama")
      .populate("dataPelanggan", "namaPelanggan tipePelanggan")
      .populate("dataTarif", "namaTarif harga")
      .populate({
        path: "dataPenjualan",
        populate: [
          { path: "penggunaID", select: "nama" },
          {
            path: "dataPelanggan",
            select: "namaPelanggan tipePelanggan nomorHp",
          },
          {
            path: "diskonGlobalIDs",
            select: "namaDiskon tipe nilai cakupan bisaDigabung",
          },
          {
            path: "itemPenjualan.diskonItemIDs",
            select: "namaDiskon tipe nilai cakupan bisaDigabung",
          },
        ],
      })
      .lean();

    await invalidateTenantCache(requesterTenantID, [oldTanggal, start]);
    await redis.del(CACHE_KEY_DETAIL(id));

    return this._formatBookingOutput(updated);
  }

  async delete(id, requesterTenantID) {
    const booking = await SesiBooking.findOne({
      _id: id,
      tenantID: requesterTenantID,
    }).lean();

    if (!booking) {
      return null;
    }

    const result = await SesiBooking.deleteOne({
      _id: id,
      tenantID: requesterTenantID,
    });

    if (result.deletedCount === 0) {
      return null;
    }

    await invalidateTenantCache(requesterTenantID, [booking.waktuMulai]);
    await redis.del(CACHE_KEY_DETAIL(id));

    return true;
  }

  async createBatch(payload) {
    if (!payload.items || !Array.isArray(payload.items) || payload.items.length === 0) {
      return { error: ["Daftar item booking (items) wajib diisi."] };
    }

    try {
      const tenantID = payload.tenantID;

      const newPenjualanId = new mongoose.Types.ObjectId();
      const itemPenjualanList = [];
      const bookingDocs = [];
      let grandTotalItem = 0;
      const affectedDates = [];

      for (const [index, item] of payload.items.entries()) {
        const targetAset = await Aset.findById(item.dataAset);

        if (!targetAset) {
          return { error: [`Item #${index + 1}: Aset tidak ditemukan.`] };
        }

        if (targetAset.tenantID.toString() !== tenantID.toString()) {
          return { error: [`Item #${index + 1}: Aset bukan milik tenant ini.`] };
        }

        if (!item.waktuSelesai) {
          return { error: [`Item #${index + 1}: waktuSelesai wajib diisi.`] };
        }

        const conflict = await this._checkConflict(
          item.dataAset,
          item.waktuMulai,
          item.waktuSelesai
        );

        if (conflict) {
          return {
            error: [
              `Item #${index + 1}: Aset ${targetAset.namaAset} bentrok pada jam tersebut.`,
            ],
          };
        }

        const start = new Date(item.waktuMulai);
        const end = new Date(item.waktuSelesai);
        const durasiMenit = Math.ceil((end - start) / (1000 * 60));

        const calc = await this._calculateCost(
          tenantID,
          item.dataAset,
          item.dataTarif,
          durasiMenit,
          item.waktuMulai
        );

        const hargaKotor = calc.harga;

        const diskonItemRes = await this._applyDiskonBerurutan({
          baseAmount: hargaKotor,
          diskonIds: item.diskonItem,
          tenantID,
          cakupan: "Item",
        });

        if (diskonItemRes.error) {
          return {
            error: [`Item #${index + 1}: ${diskonItemRes.error.join(", ")}`],
          };
        }

        const jumlahDiskonItem = diskonItemRes.totalDiskon;

        let totalSetelahDiskonItem = hargaKotor - jumlahDiskonItem;
        if (totalSetelahDiskonItem < 0) totalSetelahDiskonItem = 0;

        const pajakCalc = await pajakService.hitungPajakProduk(
          item.dataAset,
          totalSetelahDiskonItem,
          tenantID
        );

        const totalhargaItem = pajakCalc.grandTotal;
        grandTotalItem += totalhargaItem;

        const newBookingId = new mongoose.Types.ObjectId();
        affectedDates.push(item.waktuMulai);

        itemPenjualanList.push({
          sesiBookingID: newBookingId,
          produkID: new mongoose.Types.ObjectId(),
          namaProduk: `Sewa ${targetAset.namaAset} (${calc.namaTarif})`,
          jumlah: 1,
          hargaJual: hargaKotor,
          subTotal: hargaKotor,
          diskonItemIDs: diskonItemRes.appliedIds,
          jumlahDiskon: jumlahDiskonItem,
          total: totalSetelahDiskonItem,
          rincianPajak: pajakCalc.rincian,
          jumlahPajak: pajakCalc.totalPajak,
          totalharga: totalhargaItem,
        });

        bookingDocs.push({
          _id: newBookingId,
          tenantID,
          dataPengguna: payload.dataPengguna,
          dataPelanggan: payload.dataPelanggan,
          dataAset: item.dataAset,
          dataTarif: calc.tarifObj._id,
          waktuMulai: item.waktuMulai,
          waktuSelesai: item.waktuSelesai,
          durasiMenit,
          totalBiaya: hargaKotor,
          status: "Aktif",
          dataPenjualan: newPenjualanId,
        });
      }

      const diskonGlobalRes = await this._applyDiskonBerurutan({
        baseAmount: grandTotalItem,
        diskonIds: payload.diskonGlobal,
        tenantID,
        cakupan: "Global",
      });

      if (diskonGlobalRes.error) {
        return { error: diskonGlobalRes.error };
      }

      const jumlahDiskonTransaksi = diskonGlobalRes.totalDiskon;
      const totalTagihan = Math.max(grandTotalItem - jumlahDiskonTransaksi, 0);

      const noRef = payload.noReferensi || this._generateNoReferensi();

      const newPenjualan = new Penjualan({
        _id: newPenjualanId,
        tenantID,
        penggunaID: payload.dataPengguna,
        dataPelanggan: payload.dataPelanggan,
        noReferensi: noRef,
        jenisTransaksi: "POS",
        jenisPenjualan: "booking",
        tanggalTransaksi: new Date(),
        jatuhTempo: null,
        itemPenjualan: itemPenjualanList,
        diskonGlobalIDs: diskonGlobalRes.appliedIds,
        jumlahDiskonTransaksi,
        totalHargaProduk: grandTotalItem,
        totalTagihan,
        totalDibayar: 0,
        sisaTagihan: totalTagihan,
        statusBayar: totalTagihan === 0 ? "PAID" : "UNPAID",
        keterangan: "",
        statusPenjualan: payload.simpanDraft === true ? "DRAFT" : "FINAL",
      });

      await newPenjualan.save();
      await SesiBooking.insertMany(bookingDocs);

      await invalidateTenantCache(tenantID, affectedDates);
      await redis.del(`penjualan:tenant:${tenantID}`);

      return {
        penjualanID: newPenjualanId,
        totalBookings: bookingDocs.length,
        noReferensi: noRef,
      };
    } catch (error) {
      return { error: [error.message] };
    }
  }
}

module.exports = new SesiBookingService();