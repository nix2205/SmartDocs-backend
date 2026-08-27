const Conversation = require("../models/Conversation");
const Document = require("../models/Document");

const enrichConversationDocumentIds = async (conversation, userId) => {
  const messages = conversation?.messages || [];

  const documentNames = [
    ...new Set(
      messages
        .flatMap((message) => [
          ...(message.sources || []).map((source) => source?.documentName),
          ...(message.contradictions || []).flatMap((contradiction) => [
            contradiction?.statementA?.document,
            contradiction?.statementB?.document,
            contradiction?.resolvedStatement?.document,
          ]),
        ])
        .filter(Boolean)
    ),
  ];

  if (!documentNames.length) {
    return conversation;
  }

  const documents = await Document.find({
    userId,
    originalName: { $in: documentNames },
  })
    .select("_id originalName")
    .lean();

  const documentMap = new Map(
    documents.map((document) => [
      document.originalName,
      String(document._id),
    ])
  );

  return {
    ...conversation,
    messages: messages.map((message) => ({
      ...message,
      sources: (message.sources || []).map((source) => ({
        ...source,
        documentId:
          source?.documentId ||
          documentMap.get(source?.documentName) ||
          null,
      })),
      contradictions: (message.contradictions || []).map((contradiction) => ({
        ...contradiction,
        statementA: contradiction?.statementA
          ? {
              ...contradiction.statementA,
              documentId:
                contradiction.statementA.documentId ||
                documentMap.get(contradiction.statementA.document) ||
                null,
            }
          : contradiction.statementA,
        statementB: contradiction?.statementB
          ? {
              ...contradiction.statementB,
              documentId:
                contradiction.statementB.documentId ||
                documentMap.get(contradiction.statementB.document) ||
                null,
            }
          : contradiction.statementB,
        resolvedStatement: contradiction?.resolvedStatement
          ? {
              ...contradiction.resolvedStatement,
              documentId:
                contradiction.resolvedStatement.documentId ||
                documentMap.get(contradiction.resolvedStatement.document) ||
                null,
            }
          : contradiction.resolvedStatement,
      })),
    })),
  };
};

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

    const enrichedConversation =
      await enrichConversationDocumentIds(
        conversation,
        req.user.id
      );

    return res.json({
      success: true,
      conversation: enrichedConversation,
    });
  } catch (error) {
    console.error("Failed to fetch conversation:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch conversation" });
  }
};

module.exports = { getConversations, getConversationById };
