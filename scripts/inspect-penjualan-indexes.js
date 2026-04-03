/**
 * SCRIPT DEBUGGING: Lihat semua index di collection penjualans
 * Jalankan: node scripts/inspect-penjualan-indexes.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DB_URI || "mongodb://127.0.0.1:27017/db_produk";
    if (!uri) {
        console.error('❌ Tidak ada MONGODB_URI di .env!');
        process.exit(1);
    }

    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(uri);
    const db = mongoose.connection.db;

    console.log('\n📋 Index yang ada di collection PENJUALANS:');
    const indexes = await db.collection('penjualans').indexes();
    indexes.forEach((idx, i) => {
        console.log(`\n[${i}] Name: ${idx.name}`);
        console.log(`     Key : ${JSON.stringify(idx.key)}`);
        console.log(`     Unique: ${idx.unique || false}`);
        if (idx.sparse !== undefined) console.log(`     Sparse: ${idx.sparse}`);
        if (idx.partialFilterExpression) console.log(`     Partial: ${JSON.stringify(idx.partialFilterExpression)}`);
    });

    // Cek apakah ada dokumen dengan nomorFaktur
    const sample = await db.collection('penjualans').findOne({ nomorFaktur: { $exists: true } });
    console.log('\n📄 Ada dokumen dengan field nomorFaktur:', sample ? 'YA' : 'TIDAK');
    if (sample) {
        console.log('   Contoh:', JSON.stringify({ _id: sample._id, nomorFaktur: sample.nomorFaktur, noReferensi: sample.noReferensi }));
    }

    // Cek total dokumen
    const total = await db.collection('penjualans').countDocuments();
    console.log('\n📊 Total dokumen di penjualans:', total);

    await mongoose.disconnect();
    console.log('\n✅ Selesai!');
}

main().catch(e => { console.error(e); process.exit(1); });
