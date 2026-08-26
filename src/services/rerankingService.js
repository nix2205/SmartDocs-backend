// const normalizeText = (text = "") => {
//   return text
//     .toLowerCase()
//     .replace(/[^\w\s]/g, " ")
//     .replace(/\s+/g, " ")
//     .trim();
// };


// const getQueryTerms = (query) => {
//   const stopWords = new Set([
//     "what",
//     "is",
//     "are",
//     "the",
//     "a",
//     "an",
//     "of",
//     "to",
//     "for",
//     "and",
//     "or",
//     "in",
//     "on",
//     "how",
//     "many",
//     "does",
//     "do",
//     "can",
//     "employees",
//     "employee",
//     "their",
//     "they",
//     "with",
//     "from",
//     "about",
//   ]);

//   return normalizeText(query)
//     .split(" ")
//     .filter(
//       (word) =>
//         word.length > 2 &&
//         !stopWords.has(word)
//     );
// };


// const calculateKeywordScore = (
//   query,
//   text
// ) => {
//   const queryTerms =
//     getQueryTerms(query);

//   if (queryTerms.length === 0) {
//     return 0;
//   }

//   const normalizedText =
//     normalizeText(text);

//   let matchedTerms = 0;

//   for (const term of queryTerms) {
//     if (normalizedText.includes(term)) {
//       matchedTerms++;
//     }
//   }

//   return (
//     matchedTerms /
//     queryTerms.length
//   );
// };


// const rerankResults = (
//   query,
//   results,
//   limit = 4
// ) => {
//   const reranked = results.map(
//     (result) => {
//       const payload =
//         result.payload || {};

//       const semanticScore =
//         result.score || 0;

//       const keywordScore =
//         calculateKeywordScore(
//           query,
//           payload.text || ""
//         );

//       /*
//        * Semantic similarity remains the
//        * strongest signal.
//        *
//        * Keyword overlap helps distinguish
//        * between several semantically similar
//        * chunks.
//        */
//       const finalScore =
//         semanticScore * 0.75 +
//         keywordScore * 0.25;

//       return {
//         ...result,

//         rerankScore:
//           Number(
//             finalScore.toFixed(4)
//           ),

//         keywordScore:
//           Number(
//             keywordScore.toFixed(4)
//           ),
//       };
//     }
//   );

//   reranked.sort(
//     (a, b) =>
//       b.rerankScore -
//       a.rerankScore
//   );

//   return reranked.slice(
//     0,
//     limit
//   );
// };


// module.exports = {
//   rerankResults,
// };



const normalizeText = (text = "") => {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};


// These are only very common grammatical words.
// Domain-specific words are intentionally NOT removed.
const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "if",
  "then",
  "than",
  "that",
  "this",
  "these",
  "those",

  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",

  "am",

  "do",
  "does",
  "did",

  "has",
  "have",
  "had",

  "can",
  "could",
  "would",
  "should",
  "will",
  "shall",
  "may",
  "might",
  "must",

  "to",
  "of",
  "in",
  "on",
  "at",
  "by",
  "for",
  "from",
  "with",
  "about",
  "into",
  "during",
  "after",
  "before",
  "over",
  "under",
  "between",
  "through",

  "what",
  "which",
  "who",
  "whom",
  "where",
  "when",
  "why",
  "how",

  "i",
  "you",
  "we",
  "they",
  "he",
  "she",
  "it",

  "my",
  "your",
  "our",
  "their",
  "his",
  "her",
  "its",
]);


const tokenize = (text = "") => {
  return normalizeText(text)
    .split(/\s+/)
    .filter(
      (word) =>
        word.length > 2 &&
        !STOP_WORDS.has(word)
    );
};


const calculateKeywordScore = (
  query,
  text
) => {
  const queryTerms =
    tokenize(query);

  const documentTerms =
    new Set(tokenize(text));

  if (queryTerms.length === 0) {
    return 0;
  }

  let matchedTerms = 0;

  for (const term of queryTerms) {
    if (documentTerms.has(term)) {
      matchedTerms++;
    }
  }

  return (
    matchedTerms /
    queryTerms.length
  );
};


const rerankResults = (
  query,
  results,
  limit = 4
) => {
  const reranked = results.map(
    (result) => {
      const payload =
        result.payload || {};

      // Original Qdrant semantic similarity
      const semanticScore =
        result.score || 0;

      // Lexical/keyword overlap
      const keywordScore =
        calculateKeywordScore(
          query,
          payload.text || ""
        );

      /*
       * Semantic similarity remains
       * the primary signal.
       *
       * Keyword overlap provides
       * an additional relevance signal.
       */
      const rerankScore =
        semanticScore * 0.75 +
        keywordScore * 0.25;

      return {
        ...result,

        keywordScore:
          Number(
            keywordScore.toFixed(4)
          ),

        rerankScore:
          Number(
            rerankScore.toFixed(4)
          ),
      };
    }
  );


  // Highest rerank score first
  reranked.sort(
    (a, b) =>
      b.rerankScore -
      a.rerankScore
  );


  // Return only the best results
  return reranked.slice(
    0,
    limit
  );
};


module.exports = {
  rerankResults,
};