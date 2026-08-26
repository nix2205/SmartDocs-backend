const express = require("express");
const { checkContradictions } = require("../controllers/contradictionController");
const { getContradictions, updateContradictionStatus } = require("../controllers/contradictionManagementController");
const router = express.Router();
router.post("/", checkContradictions);
router.get("/", getContradictions);
router.patch("/:id/status", updateContradictionStatus);
module.exports = router;
