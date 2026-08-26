const { completeChat } = require("./llmProviderService");

const clip = (value, maxChars) => {
  const text = String(value || "");

  return text.length <= maxChars
    ? text
    : `${text.slice(0, maxChars)}…`;
};

const isEnabled = () =>
  String(
    process.env.LLM_ENABLE_CONTEXTUAL_ENRICHMENT ??
      process.env.ENABLE_CONTEXTUAL_ENRICHMENT ??
      "false"
  ).toLowerCase() === "true";

const buildFallbackEmbeddingText = ({
  chunk,
  previousChunk,
  nextChunk,
}) => {
  const parts = [
    chunk.section
      ? `Section: ${chunk.section}`
      : "",

    previousChunk?.text
      ? `Previous context: ${clip(
          previousChunk.text,
          450
        )}`
      : "",

    `Current content: ${clip(
      chunk.text,
      1800
    )}`,

    nextChunk?.text
      ? `Next context: ${clip(
          nextChunk.text,
          450
        )}`
      : "",
  ].filter(Boolean);

  return parts.join("\n");
};

const enrichChunk = async ({
  chunk,
  previousChunk = null,
  nextChunk = null,
}) => {
  const fallback =
    buildFallbackEmbeddingText({
      chunk,
      previousChunk,
      nextChunk,
    });

  // If contextual LLM enrichment is disabled,
  // still preserve neighbor context for retrieval.
  if (!isEnabled()) {
    return {
      ...chunk,
      embeddingText: fallback,
      contextualSummary: "",
    };
  }

  const prompt = `Add a short retrieval context to this document chunk.

Do not rewrite the chunk.
Do not add facts that are not supported by the supplied evidence.
Return only one or two concise sentences.

Section: ${chunk.section || "N/A"}

Previous context:
${clip(previousChunk?.text || "", 700)}

Current chunk:
${clip(chunk.text, 1600)}

Next context:
${clip(nextChunk?.text || "", 700)}`;

  try {
    const result = await completeChat({
      task: "contextual_enrichment",

      maxTokens: Number(
        process.env.CONTEXTUAL_ENRICHMENT_MAX_TOKENS ||
          120
      ),

      messages: [
        {
          role: "system",
          content:
            "Return only the short retrieval context. Do not invent facts.",
        },

        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const context =
      String(
        result?.content || ""
      ).trim();

    if (!context) {
      return {
        ...chunk,
        embeddingText: fallback,
        contextualSummary: "",
      };
    }

    return {
      ...chunk,

      // Important:
      // original chunk text remains unchanged.
      embeddingText:
        `${context}\n${chunk.text}`.trim(),

      contextualSummary: context,
    };
  } catch (error) {
    console.warn(
      "Contextual enrichment failed. Using chunk and neighbor context instead:",
      error.message
    );

    return {
      ...chunk,
      embeddingText: fallback,
      contextualSummary: "",
    };
  }
};

const enrichChunksForIndexing = async (
  chunks = []
) => {
  const output = [];

  for (
    let index = 0;
    index < chunks.length;
    index += 1
  ) {
    output.push(
      await enrichChunk({
        chunk: chunks[index],

        previousChunk:
          chunks[index - 1] || null,

        nextChunk:
          chunks[index + 1] || null,
      })
    );
  }

  return output;
};


/*
 * This is the function your current
 * documentController.js expects.
 */
const enrichChunksWithContext = async ({
  documentName,
  chunks = [],
} = {}) => {
  if (!chunks.length) {
    return [];
  }

  const batchSize = Math.max(
    1,
    Number(
      process.env.CONTEXT_ENRICHMENT_BATCH_SIZE ||
        4
    )
  );

  const output = [];

  for (
    let start = 0;
    start < chunks.length;
    start += batchSize
  ) {
    const batch = chunks.slice(
      start,
      start + batchSize
    );

    const enrichedBatch =
      await Promise.all(
        batch.map(
          (chunk, localIndex) =>
            enrichChunk({
              chunk,

              previousChunk:
                chunks[
                  start +
                    localIndex -
                    1
                ] || null,

              nextChunk:
                chunks[
                  start +
                    localIndex +
                    1
                ] || null,
            })
        )
      );

    output.push(...enrichedBatch);
  }

  return output;
};

module.exports = {
  enrichChunk,
  enrichChunksForIndexing,
  enrichChunksWithContext,
  buildFallbackEmbeddingText,
};