const Conversation = require("../models/Conversation");
const Contradiction = require("../models/Contradiction");

const {
  rerankResults,
} = require("../services/rerankingService");

const {
  generateEmbedding,
} = require("../services/embeddingService");

const {
  searchSimilarChunks,
} = require("../services/vectorService");

const {
  retrieveWithContext,
} = require("../services/advancedRetrievalService");

const {
  generateAnswer,
} = require("../services/llmService");

const {
  detectContradictions,
} = require("../services/contradictionService");

const normalizeText = (text = "") =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenize = (text = "") =>
  normalizeText(text)
    .split(/\s+/)
    .filter((word) => word.length > 2);

const questionIsRelevant = (
  currentQuestion,
  contradictionQuestion
) => {
  if (!currentQuestion || !contradictionQuestion) {
    return false;
  }

  const currentWords = new Set(tokenize(currentQuestion));
  const contradictionWords = new Set(
    tokenize(contradictionQuestion)
  );

  if (!currentWords.size || !contradictionWords.size) {
    return false;
  }

  const overlap = [...contradictionWords].filter(
    (word) => currentWords.has(word)
  ).length;

  const required =
    currentWords.size <= 4 ? 2 : Math.max(2, Math.ceil(currentWords.size * 0.3));

  return overlap >= required;
};

const getTopicIntent = (text = "") => {
  const normalized = normalizeText(text);
  return {
    allowance:
      /how many|days per week|per week|remote days|work remotely|work from home|remaining days|office days|remote work/.test(normalized),
    workingHours:
      /working hours|available between|am|pm|9 00|8 30|5 30|6 00|remain available/.test(normalized),
    reimbursement:
      /reimbursement|hotel|lodging|travel limit|expense limit/.test(normalized),
  };
};

const evidenceIsRelevant = (
  currentQuestion,
  contradiction,
  retrievedSources = []
) => {
  const questionWords = new Set(tokenize(currentQuestion));

  if (!questionWords.size || !contradiction) {
    return false;
  }

  const statementText = [
    contradiction.statementA?.text || "",
    contradiction.statementB?.text || "",
  ].join(" ");

  const statementWords = new Set(tokenize(statementText));
  const questionOverlap = [...questionWords].filter((word) => statementWords.has(word)).length;
  const questionIntent = getTopicIntent(currentQuestion);
  const statementIntent = getTopicIntent(statementText);

  if (
    questionIntent.allowance &&
    statementIntent.workingHours &&
    !/days per week|per week|remote days|office days|work remotely up to|work from home up to/.test(normalizeText(statementText))
  ) {
    return false;
  }

  if (
    questionIntent.reimbursement &&
    !statementIntent.reimbursement
  ) {
    return false;
  }

  const retrievedDocumentNames = new Set(
    retrievedSources
      .map((source) => source?.documentName)
      .filter(Boolean)
  );

  const contradictionTouchesRetrievedDocument =
    retrievedDocumentNames.has(contradiction.statementA?.document) ||
    retrievedDocumentNames.has(contradiction.statementB?.document);

  if (!contradictionTouchesRetrievedDocument) {
    return false;
  }

  if (questionWords.size <= 4 && questionOverlap >= 2) {
    return true;
  }

  if (questionWords.size > 4 && questionOverlap >= 3) {
    return true;
  }

  for (const source of retrievedSources) {
    const sourceText = source?.text || "";
    const sourceWords = new Set(tokenize(sourceText));
    const statementOverlap = [...statementWords].filter((word) => sourceWords.has(word)).length;
    const statementSize = Math.max(statementWords.size, 1);

    if (statementOverlap / statementSize >= 0.2 && statementOverlap >= 4) {
      return true;
    }

    const sameDocument =
      source?.documentName &&
      (source.documentName === contradiction.statementA?.document ||
        source.documentName === contradiction.statementB?.document);

    if (sameDocument && statementOverlap >= 5) {
      return true;
    }
  }

  return false;
};

const contradictionIsRelevant = (
  currentQuestion,
  contradiction,
  retrievedSources = []
) => {
  return (
    questionIsRelevant(
      currentQuestion,
      contradiction.question
    ) ||
    evidenceIsRelevant(
      currentQuestion,
      contradiction,
      retrievedSources
    )
  );
};

const createContradictionKey = (
  statementA,
  statementB
) => {
  const values = [
    `${statementA?.document || ""}|${statementA?.text || ""}`,
    `${statementB?.document || ""}|${statementB?.text || ""}`,
  ]
    .map(normalizeText)
    .sort();

  return values.join("||");
};

const getCitedSourceIndexes = (
  answer = "",
  sourceCount = 0
) => {
  const matches = [
    ...answer.matchAll(
      /\[SOURCE\s+(\d+)\]/gi
    ),
  ];

  return [
    ...new Set(
      matches
        .map((match) => Number(match[1]) - 1)
        .filter(
          (index) =>
            Number.isInteger(index) &&
            index >= 0 &&
            index < sourceCount
        )
    ),
  ];
};

const normalizeContradictionCitations = (
  answer = "",
  sourceCount = 0
) => {
  if (!sourceCount) {
    return answer.replace(/\[SOURCE\s+\d+\]/gi, "").trim();
  }

  const citations = Array.from(
    { length: sourceCount },
    (_, index) => `[SOURCE ${index + 1}]`
  ).join(" ");

  return (
    answer
      .replace(/\[SOURCE\s+\d+\]/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim() +
    ` ${citations}`
  );
};

const buildSource = (result) => {
  const payload =
    result?.payload || result || {};

  return {
    documentId:
      payload.documentId || null,

    documentName:
      payload.documentName ||
      payload.document ||
      "Unknown document",

    pageNumber:
      payload.pageNumber ??
      payload.page ??
      null,

    section:
      payload.section ?? null,

    effectiveDate:
      payload.effectiveDate ?? null,

    text:
      payload.text || "",
  };
};

const buildStatementSource = (statement) => {
  if (!statement) {
    return null;
  }

  return {
    documentId:
      statement.documentId || null,

    documentName:
      statement.document ||
      statement.documentName ||
      "Unknown document",

    pageNumber:
      statement.page ??
      statement.pageNumber ??
      null,

    section:
      statement.section ?? null,

    effectiveDate:
      statement.effectiveDate ?? null,

    text:
      statement.text || "",
  };
};

const dedupeSources = (sources = []) => {
  const map = new Map();

  for (const source of sources) {
    if (!source?.documentName) {
      continue;
    }

    const key = [
      source.documentName,
      source.pageNumber ?? "N/A",
      normalizeText(source.text || ""),
    ].join("|");

    if (!map.has(key)) {
      map.set(key, source);
    }
  }

  return Array.from(map.values());
};

const chatWithDocuments = async (
  req,
  res
) => {
  try {

    const {
      question,
      conversationId,
    } = req.body;

    

    if (
      !question ||
      typeof question !== "string" ||
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
      `\nChat question: "${trimmedQuestion}"`
    );

    

    let conversation;

    if (conversationId) {

      conversation =
        await Conversation.findOne({
          _id: conversationId,
          userId: req.user.id,
        });

      if (!conversation) {
        return res.status(404).json({
          success: false,
          message:
            "Conversation not found",
        });
      }

    } else {

      conversation =
        await Conversation.create({
          userId: req.user.id,
          title:
            trimmedQuestion.slice(
              0,
              60
            ),

          messages: [],
        });
    }

    

    const queryEmbedding =
      await generateEmbedding(
        trimmedQuestion
      );

    

    const retrieval =
      await retrieveWithContext({
        queryEmbedding,
        question: trimmedQuestion,
        userId: req.user.id,
      });

    const candidates =
      retrieval.candidates;

    const results =
      retrieval.reranked;

    const primaryResults =
      retrieval.primaryResults;

    const contextResults =
      retrieval.contextResults;

    console.log(
      `Retrieved ${candidates.length} candidates`
    );

    console.log(
      `Reranked to ${results.length} results`
    );

    console.log(
      `Context expansion produced ${contextResults.length} context items`
    );

    

    if (results.length === 0) {

      const answer =
        "I couldn't find enough information in the uploaded documents to answer that question.";

      conversation.messages.push({
        role: "user",
        content:
          trimmedQuestion,
      });

      conversation.messages.push({
        role: "assistant",
        content: answer,
        sources: [],
        contradictions: [],
      });

      await conversation.save();

      return res.json({
        success: true,
        conversationId:
          conversation._id,
        question:
          trimmedQuestion,
        answer,
        sources: [],
        contradictions: [],
      });
    }

    

    const answerResultLimit =
      Math.max(
        1,
        Number(
          process.env.LLM_CONTEXT_SOURCES ||
            3
        )
      );

    const answerResults =
      primaryResults.slice(
        0,
        answerResultLimit
      );

    const contextTextLimit =
      Math.max(
        500,
        Number(
          process.env.LLM_CONTEXT_CHUNK_CHARS ||
            1200
        )
      );

    const primaryContext =
      answerResults
        .map((result, index) => {
          const payload =
            result.payload || {};

          const text =
            String(
              payload.text || ""
            );

          const compactText =
            text.length <=
            contextTextLimit
              ? text
              : `${text.slice(
                  0,
                  contextTextLimit
                )}…`;

          return `SOURCE ${index + 1}
Document: ${
            payload.documentName ||
            "Unknown document"
          }
Page: ${
            payload.pageNumber ??
            "N/A"
          }
Section: ${
            payload.section ??
            "N/A"
          }
Effective Date: ${
            payload.effectiveDate ??
            "N/A"
          }
Content: ${compactText}`;
        })
        .join(
          "\n-----------------------------\n"
        );

    const relatedContext =
      contextResults
        .filter(
          (result) =>
            result.retrievalRole !==
            "primary"
        )
        .slice(
          0,
          Number(
            process.env.RETRIEVAL_MAX_CONTEXT_EXPANSION ||
              4
          )
        )
        .map((result) => {
          const payload =
            result.payload || {};

          const text =
            String(
              payload.text || ""
            );

          const compactText =
            text.length <=
            contextTextLimit
              ? text
              : `${text.slice(
                  0,
                  contextTextLimit
                )}…`;

          return `RELATED CONTEXT
Document: ${
            payload.documentName ||
            "Unknown document"
          }
Page: ${
            payload.pageNumber ??
            "N/A"
          }
Section: ${
            payload.section ??
            "N/A"
          }
Content: ${compactText}`;
        })
        .join(
          "\n-----------------------------\n"
        );

    const context = [
      primaryContext,
      relatedContext,
    ]
      .filter(Boolean)
      .join(
        "\n=============================\n"
      );

    const allSources =
      answerResults.map(
        buildSource
      );

    const documentNames = [
      ...new Set(
        allSources
          .map(
            (source) =>
              source.documentName
          )
          .filter(Boolean)
      ),
    ];

    

    let detectedContradictions = [];

    try {

      if (results.length >= 2) {

        const analysis =
          await detectContradictions(
            trimmedQuestion,
            results
          );

        if (
          analysis?.found &&
          Array.isArray(
            analysis.contradictions
          )
        ) {

          for (
            const contradiction
            of analysis.contradictions
          ) {

            if (
              !contradiction.statementA ||
              !contradiction.statementB
            ) {
              continue;
            }

            const contradictionKey =
              createContradictionKey(
                contradiction.statementA,
                contradiction.statementB
              );

            let existing =
              await Contradiction.findOne({
                userId: req.user.id,
                contradictionKey,
              });

            if (!existing) {

              existing =
                await Contradiction.create({
                  userId: req.user.id,
                  question:
                    trimmedQuestion,

                  contradictionKey,

                  type:
                    contradiction.type,

                  severity:
                    contradiction.severity ||
                    "warning",

                  statementA:
                    contradiction.statementA,

                  statementB:
                    contradiction.statementB,

                  explanation:
                    contradiction.explanation,

                  resolution:
                    contradiction.resolution ||
                    null,

                  status:
                    "detected",

                  sources:
                    allSources.map(
                      (source) => ({
                        documentName:
                          source.documentName,

                        pageNumber:
                          source.pageNumber,

                        section:
                          source.section,

                        effectiveDate:
                          source.effectiveDate,

                        text:
                          source.text,
                      })
                    ),
                });
            }

            

            if (
              existing.status !==
              "false_positive"
            ) {

              detectedContradictions.push(
                existing
              );
            }
          }
        }
      }

    } catch (
      contradictionError
    ) {

      console.error(
        "Contradiction detection failed:",
        contradictionError
      );
    }

    

    const existingContradictions =
      await Contradiction.find({
        userId: req.user.id,
        status: {
          $ne: "false_positive",
        },

        $or: [
          {
            "statementA.document": {
              $in: documentNames,
            },
          },

          {
            "statementB.document": {
              $in: documentNames,
            },
          },
        ],
      })
        .sort({
          updatedAt: -1,
        })
        .limit(50)
        .lean();

    

    const contradictionMap =
      new Map();

    
    [
      ...detectedContradictions,
      ...existingContradictions,
    ].forEach(
      (contradiction) => {

        if (!contradiction?._id) {
          return;
        }

        const previousUserQuestion = [...conversation.messages]
          .reverse()
          .find((message) => message.role === "user")?.content || "";

        const relevanceQuestion = previousUserQuestion
          ? `${previousUserQuestion} ${trimmedQuestion}`
          : trimmedQuestion;

        if (
          !contradictionIsRelevant(
            relevanceQuestion,
            contradiction,
            allSources
          )
        ) {
          return;
        }

        const key =
          contradiction.contradictionKey ||
          createContradictionKey(
            contradiction.statementA,
            contradiction.statementB
          );

        contradictionMap.set(
          key,
          contradiction
        );
      }
    );

    const contradictions =
      Array.from(
        contradictionMap.values()
      );

    console.log(
      `Relevant contradictions: ${contradictions.length}`
    );

    

    const resolvedContradictions =
      contradictions.filter(
        (contradiction) =>
          contradiction.status ===
          "resolved" &&
          contradiction.resolvedStatement
      );

    const unresolvedContradictions =
      contradictions.filter(
        (contradiction) =>
          contradiction.status ===
          "detected"
      );

    console.log(
      `Resolved conflicts for answer: ${resolvedContradictions.length}`
    );

    console.log(
      `Unresolved conflicts for answer: ${unresolvedContradictions.length}`
    );

    

    const streaming =
      req.body.stream === true ||
      req.body.stream === "true";

    if (streaming) {
      res.setHeader(
        "Content-Type",
        "text/event-stream"
      );
      res.setHeader(
        "Cache-Control",
        "no-cache, no-transform"
      );
      res.setHeader(
        "Connection",
        "keep-alive"
      );
      res.flushHeaders?.();
    }

    const answerFromLLM =
      await generateAnswer({
        question:
          trimmedQuestion,
        context,
        history:
          conversation.messages,
        resolvedContradictions,
        unresolvedContradictions,
        onToken: streaming
          ? (token) => {
              res.write(
                `event: token
data: ${JSON.stringify({
                  token,
                })}

`
              );
            }
          : undefined,
      });

    

    
    const authoritativeSources =
      dedupeSources(
        resolvedContradictions
          .map((contradiction) =>
            buildStatementSource(
              contradiction.resolvedStatement
            )
          )
          .filter(Boolean)
      );

    const unresolvedSources =
      dedupeSources(
        unresolvedContradictions
          .flatMap((contradiction) => [
            buildStatementSource(
              contradiction.statementA
            ),
            buildStatementSource(
              contradiction.statementB
            ),
          ])
          .filter(Boolean)
      );

    const contradictionSources =
      authoritativeSources.length > 0
        ? authoritativeSources
        : unresolvedSources;

    let answer = answerFromLLM;
    let sources;

    
    if (
      resolvedContradictions.length > 0 &&
      authoritativeSources.length > 0
    ) {
      sources =
        authoritativeSources;

      answer =
        normalizeContradictionCitations(
          answer,
          sources.length
        );

    } else if (
      unresolvedContradictions.length > 0 &&
      unresolvedSources.length > 0
    ) {
      
      sources =
        unresolvedSources;

      answer =
        normalizeContradictionCitations(
          answer,
          sources.length
        );

    } else {
      
      const citedIndexes =
        getCitedSourceIndexes(
          answer,
          allSources.length
        );

      const sourceIndexes =
        citedIndexes.length > 0
          ? citedIndexes
          : allSources
              .slice(0, 2)
              .map(
                (_, index) =>
                  index
              );

      sources =
        sourceIndexes.map(
          (index) =>
            allSources[index]
        );
    }

    

    const cleanContradictions =
      contradictions.map(
        (contradiction) => ({
          _id:
            contradiction._id,

          type:
            contradiction.type,

          severity:
            contradiction.severity,

          status:
            contradiction.status,

          question:
            contradiction.question,

          statementA:
            contradiction.statementA,

          statementB:
            contradiction.statementB,

          explanation:
            contradiction.explanation,

          resolution:
            contradiction.resolution,

          resolutionChoice:
            contradiction.resolutionChoice ||
            null,

          resolvedStatement:
            contradiction.resolvedStatement ||
            null,
        })
      );

    

    conversation.messages.push({
      role: "user",
      content:
        trimmedQuestion,
    });

    

    conversation.messages.push({
      role: "assistant",
      content: answer,
      sources,
      contradictions:
        cleanContradictions,
    });

    await conversation.save();

    const responsePayload = {
      success: true,
      conversationId:
        conversation._id,
      question:
        trimmedQuestion,
      answer,
      sources,
      contradictions:
        cleanContradictions,
    };

    if (streaming) {
      res.write(
        `event: done
data: ${JSON.stringify(
          responsePayload
        )}

`
      );
      return res.end();
    }

    return res.json(
      responsePayload
    );

  } catch (error) {
    console.error(
      "Chat error:",
      error
    );

    if (res.headersSent) {
      res.write(
        `event: error
data: ${JSON.stringify({
          success: false,
          code:
            error?.code ||
            "CHAT_STREAM_ERROR",
          message:
            error?.message ||
            "Failed to process chat request.",
        })}

`
      );
      return res.end();
    }

    if (
      error?.code ===
        "LLM_PROVIDER_EXHAUSTED" ||
      error?.status === 429
    ) {
      return res.status(429).json({
        success: false,
        code:
          error.code ||
          "LLM_RATE_LIMITED",
        message:
          "The AI service is temporarily unavailable. Please try again shortly.",
      });
    }

    return res.status(500).json({
      success: false,
      message:
        "Failed to process chat request",
      error:
        error.message,
    });
  }
};

module.exports = {
  chatWithDocuments,
};
