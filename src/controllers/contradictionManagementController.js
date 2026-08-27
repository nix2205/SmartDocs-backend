const Contradiction = require("../models/Contradiction");
const Document = require("../models/Document");

const attachDocumentMetadata = async (contradictions) => {
  const documentNames = [
    ...new Set(
      contradictions
        .flatMap((contradiction) => [
          contradiction.statementA?.document,
          contradiction.statementB?.document,
          ...(contradiction.sources || []).map((source) => source.documentName),
        ])
        .filter(Boolean)
    ),
  ];

  const documents = documentNames.length
    ? await Document.find({ userId: contradictions[0]?.userId, originalName: { $in: documentNames } }).select("_id originalName fileType pageCount")
    : [];

  const documentMap = new Map(documents.map((document) => [document.originalName, document]));

  return contradictions.map((contradiction) => {
    const item = contradiction.toObject ? contradiction.toObject() : contradiction;
    const enrichStatement = (statement) => {
      if (!statement) return statement;
      const document = documentMap.get(statement.document);
      return {
        ...statement,
        documentId: statement.documentId || document?._id || null,
        page: statement.page ?? null,
        section: statement.section ?? null,
        effectiveDate: statement.effectiveDate ?? null,
      };
    };

    const resolvedStatement = item.resolvedStatement
      ? {
          ...item.resolvedStatement,
          documentId: documentMap.get(item.resolvedStatement.document)?._id || null,
        }
      : null;

    return {
      ...item,
      statementA: enrichStatement(item.statementA),
      statementB: enrichStatement(item.statementB),
      resolvedStatement,
      sources: (item.sources || []).map((source) => ({
        ...source,
        documentId: source.documentId || documentMap.get(source.documentName)?._id || null,
      })),
    };
  });
};

const getContradictions = async (req, res) => {
  try {
    const contradictions = await Contradiction.find({
      userId: req.user.id,
    })
      .sort({ createdAt: -1 })
      .lean();

    const referencedIds = [
      ...new Set(
        contradictions
          .flatMap((contradiction) => [
            contradiction.statementA?.documentId,
            contradiction.statementB?.documentId,
            contradiction.resolvedStatement?.documentId,
            ...(contradiction.sources || []).map((source) => source?.documentId),
          ])
          .filter(Boolean)
          .map(String)
      ),
    ];

    const referencedNames = [
      ...new Set(
        contradictions
          .flatMap((contradiction) => [
            contradiction.statementA?.document,
            contradiction.statementB?.document,
            contradiction.resolvedStatement?.document,
            ...(contradiction.sources || []).map((source) => source?.documentName),
          ])
          .filter(Boolean)
      ),
    ];

    const documentClauses = [];
    if (referencedIds.length) {
      documentClauses.push({ _id: { $in: referencedIds } });
    }
    if (referencedNames.length) {
      documentClauses.push({ originalName: { $in: referencedNames } });
    }

    const activeDocuments = documentClauses.length
      ? await Document.find({ userId: req.user.id, $or: documentClauses })
          .select("_id originalName")
          .lean()
      : [];

    const activeIds = new Set(
      activeDocuments.map((document) => String(document._id))
    );
    const activeNames = new Set(
      activeDocuments.map((document) => document.originalName)
    );

    const statementIsActive = (statement) =>
      Boolean(
        (statement?.documentId && activeIds.has(String(statement.documentId))) ||
          (statement?.document && activeNames.has(statement.document))
      );

    const sourceIsActive = (source) =>
      Boolean(
        (source?.documentId && activeIds.has(String(source.documentId))) ||
          (source?.documentName && activeNames.has(source.documentName))
      );

    const activeContradictions = contradictions.filter((contradiction) =>
      statementIsActive(contradiction.statementA) ||
      statementIsActive(contradiction.statementB) ||
      statementIsActive(contradiction.resolvedStatement) ||
      (contradiction.sources || []).some(sourceIsActive)
    );

    const orphanIds = contradictions
      .filter((contradiction) => !activeContradictions.includes(contradiction))
      .map((contradiction) => contradiction._id);

    if (orphanIds.length) {
      await Contradiction.deleteMany({
        _id: { $in: orphanIds },
        userId: req.user.id,
      });
    }

    const enriched = await attachDocumentMetadata(activeContradictions);
    return res.json({ success: true, count: enriched.length, contradictions: enriched });
  } catch (error) {
    console.error("Failed to fetch contradictions:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch contradictions" });
  }
};

const updateContradictionStatus = async (req, res) => {
  try {
    const { status, resolutionChoice, resolution } = req.body;
    const allowedStatuses = ["detected", "resolved", "false_positive"];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid contradiction status" });
    }

    const contradiction = await Contradiction.findOne({ _id: req.params.id, userId: req.user.id });
    if (!contradiction) {
      return res.status(404).json({ success: false, message: "Contradiction not found" });
    }

    if (status === "resolved") {
      if (!["statementA", "statementB"].includes(resolutionChoice)) {
        return res.status(400).json({ success: false, message: "Choose which statement should be treated as authoritative." });
      }

      const selectedStatement = resolutionChoice === "statementA" ? contradiction.statementA : contradiction.statementB;
      if (!selectedStatement?.text) {
        return res.status(400).json({ success: false, message: "The selected statement is unavailable." });
      }

      contradiction.status = "resolved";
      contradiction.resolutionChoice = resolutionChoice;
      contradiction.resolvedStatement = {
        document: selectedStatement.document || null,
        documentId: selectedStatement.documentId || null,
        text: selectedStatement.text || null,
        page: selectedStatement.page ?? null,
        section: selectedStatement.section ?? null,
        effectiveDate: selectedStatement.effectiveDate ?? null,
      };
      contradiction.resolution = String(resolution || "").trim() || `Human reviewer selected ${resolutionChoice === "statementA" ? "Source A" : "Source B"} as authoritative.`;
    } else if (status === "false_positive") {
      contradiction.status = "false_positive";
      contradiction.resolutionChoice = null;
      contradiction.resolvedStatement = null;
      contradiction.resolution = String(resolution || "").trim() || null;
    } else {
      contradiction.status = "detected";
      contradiction.resolutionChoice = null;
      contradiction.resolvedStatement = null;
      contradiction.resolution = null;
    }

    await contradiction.save();
    const [enriched] = await attachDocumentMetadata([contradiction]);
    return res.json({ success: true, contradiction: enriched });
  } catch (error) {
    console.error("Failed to update contradiction:", error);
    return res.status(500).json({ success: false, message: "Failed to update contradiction" });
  }
};

module.exports = { getContradictions, updateContradictionStatus };
