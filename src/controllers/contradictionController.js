const Contradiction = require("../models/Contradiction");

const {
  generateEmbedding,
} = require("../services/embeddingService");

const {
  searchSimilarChunks,
} = require("../services/vectorService");

const {
  detectContradictions,
} = require("../services/contradictionService");

const findMatchingEvidence = (
  statement,
  results
) => {
  if (!statement) {
    return null;
  }

  const statementText =
    String(statement.text || "")
      .toLowerCase()
      .trim();

  if (!statementText) {
    return null;
  }

  let best = null;
  let bestOverlap = 0;

  for (const result of results) {
    const payload =
      result?.payload || {};

    const sourceText =
      String(payload.text || "")
        .toLowerCase()
        .trim();

    if (!sourceText) continue;

    if (
      sourceText.includes(statementText)
    ) {
      return result;
    }

    const statementWords = new Set(
      statementText
        .split(/\s+/)
        .filter(
          (word) => word.length > 3
        )
    );

    const sourceWords = new Set(
      sourceText
        .split(/\s+/)
        .filter(
          (word) => word.length > 3
        )
    );

    let overlap = 0;

    for (const word of statementWords) {
      if (sourceWords.has(word)) {
        overlap++;
      }
    }

    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = result;
    }
  }

  return best;
};

const enrichStatementMetadata = (
  statement,
  results
) => {
  const matchingResult =
    findMatchingEvidence(
      statement,
      results
    );

  const payload =
    matchingResult?.payload || {};

  return {
    document:
      statement?.document ||
      payload.documentName ||
      "Unknown document",

    documentId:
      statement?.documentId ||
      payload.documentId ||
      null,

    text:
      statement?.text ||
      payload.text ||
      "",

    page:
      statement?.page ??
      payload.pageNumber ??
      null,

    section:
      statement?.section ??
      payload.section ??
      null,

    effectiveDate:
      statement?.effectiveDate ??
      payload.effectiveDate ??
      null,
  };
};

const checkContradictions = async (
  req,
  res
) => {
  try {
    const { question } = req.body;

    if (
      !question ||
      typeof question !==
        "string" ||
      !question.trim()
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Question is required",
      });
    }

    const trimmedQuestion =
      question.trim();

    console.log(
      `\nChecking contradictions for: "${trimmedQuestion}"`
    );

    const queryVector =
      await generateEmbedding(
        trimmedQuestion
      );

    const results =
      await searchSimilarChunks(
        queryVector,
        10,
        req.user.id
      );

    console.log(
      `Retrieved ${results.length} candidate chunks for contradiction analysis`
    );

    if (results.length < 2) {
      return res.json({
        success: true,
        question:
          trimmedQuestion,
        found: false,
        contradictions: [],
        message:
          "Not enough relevant sources were found to compare.",
      });
    }

    const analysis =
      await detectContradictions(
        trimmedQuestion,
        results
      );

    const savedContradictions = [];

    if (
      analysis?.found &&
      Array.isArray(
        analysis.contradictions
      )
    ) {
      for (const contradiction of analysis.contradictions) {
        const statementA =
          enrichStatementMetadata(
            contradiction.statementA,
            results
          );

        const statementB =
          enrichStatementMetadata(
            contradiction.statementB,
            results
          );

        const saved =
          await Contradiction.create({
            userId: req.user.id,
            question:
              trimmedQuestion,

            type:
              contradiction.type,

            severity:
              contradiction.severity ||
              "warning",

            statementA,

            statementB,

            explanation:
              contradiction.explanation,

            resolution:
              contradiction.resolution ||
              null,

            status: "detected",

            sources:
              results.map(
                (result) => ({
                  documentName:
                    result.payload
                      ?.documentName,

                  documentId:
                    result.payload
                      ?.documentId ||
                    null,

                  pageNumber:
                    result.payload
                      ?.pageNumber ??
                    null,

                  section:
                    result.payload
                      ?.section ??
                    null,

                  effectiveDate:
                    result.payload
                      ?.effectiveDate ??
                    null,

                  text:
                    result.payload
                      ?.text ||
                    null,
                })
              ),
          });

        savedContradictions.push(
          saved
        );
      }
    }

    const contradictions =
      analysis?.contradictions?.map(
        (contradiction, index) => ({
          ...contradiction,

          statementA:
            enrichStatementMetadata(
              contradiction.statementA,
              results
            ),

          statementB:
            enrichStatementMetadata(
              contradiction.statementB,
              results
            ),

          id:
            savedContradictions[
              index
            ]?._id,

          status:
            savedContradictions[
              index
            ]?.status ||
            "detected",
        })
      ) || [];

    const sources =
      results.map(
        (result) => ({
          documentName:
            result.payload
              ?.documentName,

          pageNumber:
            result.payload
              ?.pageNumber ??
            null,

          section:
            result.payload
              ?.section ??
            null,

          effectiveDate:
            result.payload
              ?.effectiveDate ??
            null,

          text:
            result.payload?.text ||
            "",
        })
      );

    return res.json({
      success: true,
      question:
        trimmedQuestion,
      found:
        contradictions.length > 0,
      count:
        contradictions.length,
      contradictions,
      sources,
      message:
        contradictions.length > 0
          ? `Found ${contradictions.length} genuine contradiction${
              contradictions.length !==
              1
                ? "s"
                : ""
            }.`
          : "No genuine contradictions were found.",
    });
  } catch (error) {
    console.error(
      "Contradiction detection error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to detect contradictions",
      error:
        error.message,
    });
  }
};

module.exports = {
  checkContradictions,
};
