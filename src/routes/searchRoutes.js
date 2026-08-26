const express = require("express");
const { searchDocuments } = require("../controllers/searchController");
const router = express.Router();
router.post("/", searchDocuments);
module.exports = router;
