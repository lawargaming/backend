require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DB_URI || "mongodb://127.0.0.1:27017/db_produk";

    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(uri);
    const db = mongoose.connection.db;

    console.log('🗑️  Mencoba menghapus index lama "nomorFaktur_1"...');
    try {
        await db.collection('penjualans').dropIndex("nomorFaktur_1");
        console.log('✅ Index berhasil dihapus!');
    } catch (e) {
        console.log('⚠️  Gagal menghapus index:', e.message);

        // Coba cari index lain yang mengandung nama nomorFaktur
        const indexes = await db.collection('penjualans').indexes();
        for (const idx of indexes) {
            if (idx.name.includes("nomorFaktur")) {
                console.log(`🗑️  Mencoba menghapus ${idx.name}...`);
                await db.collection('penjualans').dropIndex(idx.name);
                console.log(`✅ ${idx.name} berhasil dihapus!`);
            }
        }
    }

    await mongoose.disconnect();
    console.log('✅ Selesai!');
}

main().catch(e => { console.error(e); process.exit(1); });
