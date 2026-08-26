const express = require("express");

const {
  chatWithDocuments,
} = require("../controllers/chatController");

const router = express.Router();

router.post("/", chatWithDocuments);

module.exports = router;
