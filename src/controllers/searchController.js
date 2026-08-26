const {
  generateEmbedding,
} = require("../services/embeddingService");

const {
  rerankResults,
} = require("../services/rerankingService");

const {
  searchSimilarChunks,
} = require("../services/vectorService");


const searchDocuments = async (req, res) => {
  try {
    const { query } = req.body;


    if (!query || !query.trim()) {
      return res.status(400).json({
        success: false,
        message: "Query is required",
      });
    }


    console.log(
      `\nSearching for: "${query}"`
    );



    const queryVector =
      await generateEmbedding(query);

    console.log(
      "Query embedding length:",
      queryVector.length
    );



    const candidates =
      await searchSimilarChunks(
        queryVector,
        8,
        req.user.id
      );

    console.log(
      `Retrieved ${candidates.length} candidate chunk(s)`
    );



    const results =
      rerankResults(
        query,
        candidates,
        4
      );

    console.log(
      `Reranked to ${results.length} result(s)`
    );



    res.json({
      success: true,

      query,

      results: results.map(
        (result) => ({
          score: result.score,

          keywordScore:
            result.keywordScore,

          rerankScore:
            result.rerankScore,

          documentName:
            result.payload.documentName,

          pageNumber:
            result.payload.pageNumber,

          section:
            result.payload.section,

          effectiveDate:
            result.payload.effectiveDate,

          chunkIndex:
            result.payload.chunkIndex,

          text:
            result.payload.text,
        })
      ),
    });

  } catch (error) {
    console.error(
      "Search error:",
      error
    );

    res.status(500).json({
      success: false,
      message: "Search failed",
      error: error.message,
    });
  }
};


module.exports = {
  searchDocuments,
};
