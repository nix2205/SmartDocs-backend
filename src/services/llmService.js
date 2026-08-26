const crypto = require("crypto");
const { completeChat } = require("./llmProviderService");
const cache = require("./cacheService");

const clip = (value, maxChars) => {
  const text = String(value || "");
  return text.length <= maxChars
    ? text
    : `${text.slice(0, maxChars)}…`;
};

const formatResolvedContradictions = (
  contradictions = []
) => {
  if (!contradictions.length) {
    return "NONE";
  }

  return contradictions
    .slice(
      0,
      Number(
        process.env.LLM_MAX_RESOLVED_CONTRADICTIONS || 2
      )
    )
    .map((contradiction, index) => {
      const selected =
        contradiction.resolvedStatement;

      return `RESOLVED CONFLICT ${index + 1}
AUTHORITATIVE DOCUMENT: ${selected?.document || "N/A"}
AUTHORITATIVE PAGE: ${selected?.page ?? "N/A"}
AUTHORITATIVE SECTION: ${selected?.section || "N/A"}
AUTHORITATIVE STATEMENT: ${clip(
        selected?.text ||
          contradiction.resolution ||
          "",
        Number(
          process.env.LLM_RESOLUTION_CHARS || 900
        )
      )}
The human reviewer selected this statement as authoritative. Do not treat the rejected statement as equally valid.`;
    })
    .join("\n\n");
};

const formatUnresolvedContradictions = (
  contradictions = []
) => {
  if (!contradictions.length) {
    return "NONE";
  }

  return contradictions
    .slice(
      0,
      Number(
        process.env.LLM_MAX_UNRESOLVED_CONTRADICTIONS || 2
      )
    )
    .map(
      (contradiction, index) =>
        `UNRESOLVED CONFLICT ${index + 1}
SOURCE A: ${
          contradiction.statementA?.document ||
          "N/A"
        } | Page ${
          contradiction.statementA?.page ??
          "N/A"
        } | ${clip(
          contradiction.statementA?.text ||
            "",
          650
        )}
SOURCE B: ${
          contradiction.statementB?.document ||
          "N/A"
        } | Page ${
          contradiction.statementB?.page ??
          "N/A"
        } | ${clip(
          contradiction.statementB?.text ||
            "",
          650
        )}
Explanation: ${clip(
          contradiction.explanation ||
            "",
          350
        )}`
    )
    .join("\n\n");
};

const buildHistory = (
  history = []
) =>
  history
    .slice(
      -Number(
        process.env.LLM_HISTORY_MESSAGES || 4
      )
    )
    .map((message) => ({
      role: message.role,
      content: clip(
        message.content,
        Number(
          process.env.LLM_HISTORY_CHARS || 800
        )
      ),
    }));

const buildPrompt = ({
  question,
  context,
  history,
  resolvedContradictions,
  unresolvedContradictions,
}) => {
  const systemPrompt = `You are SmartDocs, a document intelligence assistant.
Answer using only the supplied document evidence, human-reviewed decisions, and conversation history.
Never invent facts.
If evidence is insufficient, say so.
Human-reviewed resolutions have highest priority, but only for the topic actually resolved by that reviewer.
If a resolved statement does not address the user's current topic, ignore that resolution for the current question.
If a conflict is resolved, use the authoritative statement and do not describe it as unresolved.
If a conflict is unresolved and affects the question, briefly explain the disagreement without choosing a side.
A newer date alone does not supersede an older document.
For follow-up questions, use the preceding conversation to identify the topic, then answer only from evidence that addresses that same topic.
Primary source entries contain the exact citation text. Related context entries are supporting context and must not be cited as primary evidence.
Use citations exactly as [SOURCE 1], [SOURCE 2], matching the primary source numbers.
Keep the answer concise. For a simple factual question, answer in one or two sentences.
Do not mention internal implementation details.

HUMAN-REVIEWED RESOLUTIONS:
${formatResolvedContradictions(
    resolvedContradictions
  )}

UNRESOLVED CONTRADICTIONS:
${formatUnresolvedContradictions(
    unresolvedContradictions
  )}

RETRIEVED DOCUMENT CONTEXT:
${clip(
    context,
    Number(
      process.env.LLM_CONTEXT_MAX_CHARS || 4200
    )
  )}`;

  return [
    {
      role: "system",
      content: systemPrompt,
    },
    ...buildHistory(history),
    {
      role: "user",
      content: question,
    },
  ];
};

const buildCacheKey = ({
  question,
  context,
  history,
  resolvedContradictions,
  unresolvedContradictions,
}) =>
  crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        question,
        context,
        history,
        resolvedContradictions,
        unresolvedContradictions,
      })
    )
    .digest("hex");

const generateAnswer = async ({
  question,
  context,
  history = [],
  resolvedContradictions = [],
  unresolvedContradictions = [],
  onToken,
}) => {
  const messages = buildPrompt({
    question,
    context,
    history,
    resolvedContradictions,
    unresolvedContradictions,
  });

  const streaming =
    typeof onToken === "function";

  const key = buildCacheKey({
    question,
    context,
    history,
    resolvedContradictions,
    unresolvedContradictions,
  });

  if (!streaming) {
    const cached = cache.get(
      "answer",
      key
    );

    if (cached) {
      return cached;
    }
  }

  const result =
    await completeChat({
      task: "chat",
      maxTokens:
        Number(
          process.env.LLM_MAX_COMPLETION_TOKENS ||
            600
        ),
      messages,
      onToken,
    });

  const answer =
    result.content ||
    "I couldn't generate an answer from the uploaded documents.";

  if (!streaming) {
    cache.set(
      "answer",
      key,
      answer
    );
  }

  return answer;
};

module.exports = {
  generateAnswer,
};
