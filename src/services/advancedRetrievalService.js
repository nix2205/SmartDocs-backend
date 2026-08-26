const crypto = require("crypto");
const { searchSimilarChunks, retrieveNeighborChunks } = require("./vectorService");
const { rerankResults } = require("./rerankingService");
const cache = require("./cacheService");

const normalize = (text = "") =>
  String(text)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const cacheKey = ({
  userId,
  question,
}) =>
  crypto
    .createHash("sha256")
    .update(
      `${userId || "anonymous"}::${normalize(question)}`
    )
    .digest("hex");

const dedupe = (results = []) => {
  const map = new Map();

  for (const result of results) {
    const payload = result?.payload || {};
    const key = [
      payload.documentId || "",
      payload.chunkIndex ?? "",
    ].join(":");

    if (!map.has(key)) {
      map.set(key, result);
    }
  }

  return [...map.values()];
};

const buildContextExpansion = async (
  primaryResults
) => {
  const expanded = [];

  for (const result of primaryResults) {
    const payload = result?.payload || {};

    expanded.push({
      ...result,
      retrievalRole: "primary",
    });

    if (
      payload.parentText &&
      payload.parentText !== payload.text
    ) {
      expanded.push({
        ...result,
        retrievalRole: "parent",
        score:
          Number(result.score || 0) * 0.92,
        payload: {
          ...payload,
          text: payload.parentText,
          chunkIndex:
            payload.chunkIndex,
          exactCitationText:
            payload.text,
        },
      });
    }

    const neighbors =
      await retrieveNeighborChunks(
        payload.documentId,
        payload.chunkIndex,
        Number(
          process.env.RETRIEVAL_NEIGHBOR_RADIUS || 1
        )
      );

    for (const neighbor of neighbors) {
      if (
        neighbor?.payload?.chunkIndex ===
        payload.chunkIndex
      ) {
        continue;
      }

      expanded.push({
        ...neighbor,
        retrievalRole: "neighbor",
        score:
          Number(result.score || 0) * 0.82,
      });
    }
  }

  return dedupe(expanded);
};

const retrieveWithContext = async ({
  queryEmbedding,
  question,
  userId,
}) => {
  const key = cacheKey({
    userId,
    question,
  });

  const cached = cache.get(
    "retrieval",
    key
  );

  if (cached) {
    return {
      ...cached,
      cacheHit: true,
    };
  }

  const candidateLimit = Math.max(
    8,
    Number(
      process.env.RETRIEVAL_CANDIDATE_LIMIT || 12
    )
  );

  const primaryLimit = Math.max(
    1,
    Number(
      process.env.LLM_CONTEXT_SOURCES || 3
    )
  );

  const candidates =
    await searchSimilarChunks(
      queryEmbedding,
      candidateLimit,
      userId
    );

  const reranked =
    rerankResults(
      question,
      candidates,
      Math.max(
        primaryLimit,
        Number(
          process.env.RETRIEVAL_RERANK_LIMIT || 6
        )
      )
    );

  const primaryResults =
    reranked.slice(
      0,
      primaryLimit
    );

  const contextResults =
    await buildContextExpansion(
      primaryResults
    );

  const result = {
    candidates,
    reranked,
    primaryResults,
    contextResults,
    cacheHit: false,
  };

  cache.set(
    "retrieval",
    key,
    result
  );

  return result;
};

module.exports = {
  retrieveWithContext,
  dedupe,
};
