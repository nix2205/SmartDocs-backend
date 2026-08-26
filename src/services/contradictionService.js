const { completeChat } = require("./llmProviderService");
const { scoreSeverity } = require("./severityService");

const normalize = (text = "") =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "are", "was", "were", "will", "shall", "should", "would", "could", "have", "has", "had", "into", "their", "there", "about", "what", "when", "where", "which", "does", "do", "how", "who", "why", "can", "may", "must", "only", "than", "then", "also", "not", "all", "any", "each", "per"
]);

const tokens = (text = "") =>
  normalize(text)
    .split(" ")
    .filter((word) => word.length > 3 && !STOP_WORDS.has(word));

const overlap = (a, b) => {
  const left = new Set(tokens(a));
  const right = new Set(tokens(b));
  let count = 0;
  for (const word of left) if (right.has(word)) count++;
  return count;
};

const buildCandidatePairs = (question, results = []) => {
  const pairs = [];

  for (let i = 0; i < results.length; i++) {
    for (let j = i + 1; j < results.length; j++) {
      const a = results[i]?.payload || {};
      const b = results[j]?.payload || {};

      if (!a.text || !b.text) continue;
      if (a.documentName && b.documentName && a.documentName === b.documentName) continue;

      const shared = overlap(a.text, b.text);
      const questionA = overlap(question, a.text);
      const questionB = overlap(question, b.text);
      const sameSection = Boolean(
        a.section && b.section && normalize(a.section) === normalize(b.section)
      );

      const score =
        shared * 2 +
        questionA +
        questionB +
        (sameSection ? 3 : 0) +
        ((a.effectiveDate || b.effectiveDate) ? 1 : 0);

      if (shared >= 2 && (questionA >= 1 || questionB >= 1 || sameSection)) {
        pairs.push({ i, j, score });
      }
    }
  }

  pairs.sort((a, b) => b.score - a.score);
  const maxPairs = Math.max(1, Number(process.env.CONTRADICTION_MAX_PAIRS || 2));
  return pairs.slice(0, maxPairs).map(({ i, j }) => [results[i], results[j]]);
};

const clip = (value, maxChars) => {
  const text = String(value || "");
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`;
};

const buildEvidence = (pairs) =>
  pairs
    .map((pair, index) => {
      const [aResult, bResult] = pair;
      const a = aResult.payload || {};
      const b = bResult.payload || {};

      return `PAIR ${index + 1}
SOURCE A
Document: ${a.documentName || "Unknown document"}
Page: ${a.pageNumber ?? "N/A"}
Section: ${a.section || "N/A"}
Effective Date: ${a.effectiveDate || "N/A"}
Text: ${clip(a.text, Number(process.env.CONTRADICTION_TEXT_CHARS || 850))}
SOURCE B
Document: ${b.documentName || "Unknown document"}
Page: ${b.pageNumber ?? "N/A"}
Section: ${b.section || "N/A"}
Effective Date: ${b.effectiveDate || "N/A"}
Text: ${clip(b.text, Number(process.env.CONTRADICTION_TEXT_CHARS || 850))}`;
    })
    .join("\n-----------------------------\n");

const extractJson = (text) => {
  try {
    return JSON.parse(text);
  } catch (_) {}

  const fenced = text?.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch (_) {}
  }

  const start = text?.indexOf("{");
  const end = text?.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch (_) {}
  }

  return null;
};

const detectContradictions = async (question, results) => {
  if (!results || results.length < 2) {
    return { found: false, contradictions: [] };
  }

  const pairs = buildCandidatePairs(question, results);

  console.log(`Contradiction candidate filter: ${results.length} chunks -> ${pairs.length} likely pairs.`);

  if (!pairs.length) {
    return { found: false, contradictions: [] };
  }

  const prompt = `You are the contradiction detection component of SmartDocs.

User question: "${question}"

Compare only the supplied candidate pairs.
Return only genuine contradictions. Similarity alone is not enough.
A contradiction requires the same subject and compatible conditions where both statements cannot reasonably be valid together.
Do not flag unrelated statements, examples, supplementary details, different valid time periods, or an older policy explicitly superseded by another policy.
Do not invent information.
Use exact statement text and supplied metadata.

Allowed types:
FACTUAL_CONTRADICTION
LOGICAL_CONTRADICTION
TEMPORAL_CONTRADICTION
NUMERICAL_DISCREPANCY

Return JSON only in this structure:
{"found":true,"contradictions":[{"type":"FACTUAL_CONTRADICTION","severity":"warning","statementA":{"document":"","page":null,"section":null,"effectiveDate":null,"text":""},"statementB":{"document":"","page":null,"section":null,"effectiveDate":null,"text":""},"explanation":"","resolution":null}]}

If there are no genuine contradictions, return {"found":false,"contradictions":[]}.

CANDIDATE PAIRS:
${buildEvidence(pairs)}`;

  const completion = await completeChat({
    task: "contradiction",
    jsonMode: true,
    maxTokens: Number(process.env.CONTRADICTION_MAX_COMPLETION_TOKENS || 700),
    messages: [
      {
        role: "system",
        content: "Return JSON only. Identify only genuine contradictions supported by supplied evidence.",
      },
      { role: "user", content: prompt },
    ],
  });

  const parsed = extractJson(completion.content);
  if (!parsed || !Array.isArray(parsed.contradictions)) {
    throw new Error("The LLM returned invalid contradiction JSON.");
  }

  const validTypes = [
    "FACTUAL_CONTRADICTION",
    "LOGICAL_CONTRADICTION",
    "TEMPORAL_CONTRADICTION",
    "NUMERICAL_DISCREPANCY",
  ];
  const validSeverities = ["critical", "warning", "info"];

  const contradictions = parsed.contradictions
    .filter((item) =>
      item &&
      validTypes.includes(item.type) &&
      item.statementA?.text &&
      item.statementB?.text &&
      normalize(item.statementA.text) !== normalize(item.statementB.text)
    )
    .map((item) => {
      const normalized = {
        type: item.type,
        severity: validSeverities.includes(item.severity)
          ? item.severity
          : "warning",
        statementA: {
          document: item.statementA.document || "Unknown document",
          page: item.statementA.page ?? null,
          section: item.statementA.section ?? null,
          effectiveDate: item.statementA.effectiveDate ?? null,
          text: item.statementA.text,
        },
        statementB: {
          document: item.statementB.document || "Unknown document",
          page: item.statementB.page ?? null,
          section: item.statementB.section ?? null,
          effectiveDate: item.statementB.effectiveDate ?? null,
          text: item.statementB.text,
        },
        explanation:
          item.explanation ||
          "The statements contain conflicting information.",
        resolution: item.resolution || null,
      };

      return {
        ...normalized,
        severity: scoreSeverity(normalized),
      };
    });

  return {
    found: contradictions.length > 0,
    contradictions,
  };
};

module.exports = {
  detectContradictions,
  buildCandidatePairs,
};
