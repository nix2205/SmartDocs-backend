const Conversation = require("../models/Conversation");
const Document = require("../models/Document");

const enrichConversationDocumentIds = async (conversation, userId) => {
  const messages = conversation?.messages || [];

  const documentIds = [
    ...new Set(
      messages
        .flatMap((message) => [
          ...(message.sources || []).map((source) => source?.documentId),
          ...(message.contradictions || []).flatMap((contradiction) => [
            contradiction?.statementA?.documentId,
            contradiction?.statementB?.documentId,
            contradiction?.resolvedStatement?.documentId,
          ]),
        ])
        .filter(Boolean)
        .map(String)
    ),
  ];

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

  const clauses = [];
  if (documentIds.length) {
    clauses.push({ _id: { $in: documentIds } });
  }
  if (documentNames.length) {
    clauses.push({ originalName: { $in: documentNames } });
  }

  const documents = clauses.length
    ? await Document.find({ userId, $or: clauses })
        .select("_id originalName")
        .lean()
    : [];

  const documentMap = new Map(
    documents.map((document) => [
      document.originalName,
      String(document._id),
    ])
  );
  const activeIds = new Set(documents.map((document) => String(document._id)));
  const activeNames = new Set(documents.map((document) => document.originalName));

  const resolveDocumentId = (item, name) => {
    if (item?.documentId && activeIds.has(String(item.documentId))) {
      return String(item.documentId);
    }
    return documentMap.get(name) || null;
  };

  const sourceIsActive = (source) => {
    const id = resolveDocumentId(source, source?.documentName);
    return Boolean(id && activeIds.has(id)) || Boolean(
      source?.documentName && activeNames.has(source.documentName)
    );
  };

  return {
    ...conversation,
    messages: messages.map((message) => ({
      ...message,
      sources: (message.sources || [])
        .filter(sourceIsActive)
        .map((source) => ({
          ...source,
          documentId: resolveDocumentId(source, source?.documentName),
        })),
      contradictions: (message.contradictions || [])
        .map((contradiction) => ({
          ...contradiction,
          statementA: contradiction?.statementA
            ? {
                ...contradiction.statementA,
                documentId: resolveDocumentId(
                  contradiction.statementA,
                  contradiction.statementA.document || contradiction.statementA.documentName
                ),
              }
            : contradiction.statementA,
          statementB: contradiction?.statementB
            ? {
                ...contradiction.statementB,
                documentId: resolveDocumentId(
                  contradiction.statementB,
                  contradiction.statementB.document || contradiction.statementB.documentName
                ),
              }
            : contradiction.statementB,
          resolvedStatement: contradiction?.resolvedStatement
            ? {
                ...contradiction.resolvedStatement,
                documentId: resolveDocumentId(
                  contradiction.resolvedStatement,
                  contradiction.resolvedStatement.document || contradiction.resolvedStatement.documentName
                ),
              }
            : contradiction.resolvedStatement,
        }))
        .filter((contradiction) => {
          const a = contradiction.statementA?.documentId;
          const b = contradiction.statementB?.documentId;
          return Boolean(
            (a && activeIds.has(String(a))) ||
            (b && activeIds.has(String(b)))
          );
        }),
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
