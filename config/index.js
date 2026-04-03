const dotenv = require("dotenv");
dotenv.config(); // load .env

module.exports = {
  PORT: process.env.PORT || 4000,
  HOST: process.env.HOST || "0.0.0.0",
  MONGO_URI: process.env.MONGO_URI || "mongodb://127.0.0.1:27017/db_produk",
  REDIS_URL: process.env.REDIS_URL || null,
  NODE_ENV: process.env.NODE_ENV || "development",
};
