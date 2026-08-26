const express = require("express");
const { getConversations, getConversationById } = require("../controllers/conversationController");
const router = express.Router();
router.get("/", getConversations);
router.get("/:id", getConversationById);
module.exports = router;
