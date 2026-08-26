const scoreSeverity = ({
  type,
  explanation = "",
  statementA = {},
  statementB = {},
}) => {
  const normalizedType = String(type || "").toUpperCase();
  const text = `${explanation} ${statementA.text || ""} ${statementB.text || ""}`.toLowerCase();

  if (
    normalizedType === "NUMERICAL_DISCREPANCY" ||
    normalizedType === "LOGICAL_CONTRADICTION" ||
    normalizedType === "DIRECT_CONTRADICTION"
  ) {
    return "critical";
  }

  if (
    normalizedType === "FACTUAL_CONTRADICTION" &&
    /\b(cost|price|limit|maximum|minimum|must|cannot|required|allowed|days|hours|percent|percentage)\b/.test(text)
  ) {
    return "critical";
  }

  if (
    normalizedType === "TEMPORAL_CONTRADICTION" ||
    normalizedType === "TEMPORAL_REVISION"
  ) {
    return "warning";
  }

  return "info";
};

const normalizeSeverity = (item) => ({
  ...item,
  severity: scoreSeverity(item),
});

module.exports = {
  scoreSeverity,
  normalizeSeverity,
};
