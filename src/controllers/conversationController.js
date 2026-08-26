const Conversation = require("../models/Conversation");

const getConversations = async (req, res) => {
  try {
    const conversations = await Conversation.find({ userId: req.user.id })
      .select("title messages createdAt updatedAt")
      .sort({ updatedAt: -1 })
      .lean();

    const summaries = conversations.map((conversation) => {
      const lastMessage = conversation.messages?.[conversation.messages.length - 1];
      return {
        _id: conversation._id,
        title: conversation.title || lastMessage?.content || "New Conversation",
        preview: lastMessage?.content || "No messages yet",
        messageCount: conversation.messages?.length || 0,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      };
    });

    return res.json({ success: true, conversations: summaries });
  } catch (error) {
    console.error("Failed to fetch conversations:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch conversations" });
  }
};

const getConversationById = async (req, res) => {
  try {
    const conversation = await Conversation.findOne({
      _id: req.params.id,
      userId: req.user.id,
    }).lean();

    if (!conversation) {
      return res.status(404).json({ success: false, message: "Conversation not found" });
    }

    return res.json({ success: true, conversation });
  } catch (error) {
    console.error("Failed to fetch conversation:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch conversation" });
  }
};

module.exports = { getConversations, getConversationById };
