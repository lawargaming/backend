const express = require("express");
const router = express.Router();
const permissionController = require("../controllers/permissionController");
const authPengguna = require("../middleware/authPengguna");

// Wrapper utility
const wrap = (fn) => (req, res, next) => {
  Promise.resolve(fn.call(permissionController, req, res, next)).catch(next);
};

// GET flat list — PUBLIC (tanpa auth, dipakai saat Owner setup)
router.get("/", wrap(permissionController.getAll));

// GET grouped list — PROTECTED (butuh Pengguna token)
router.get("/grouped", authPengguna, wrap(permissionController.getGrouped));

router.post("/", wrap(permissionController.create));
router.delete("/:id", wrap(permissionController.delete));

module.exports = router;