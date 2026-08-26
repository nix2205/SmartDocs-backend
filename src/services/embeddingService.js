let extractor = null;

const getExtractor = async () => {
  if (!extractor) {
    const { pipeline } = await import("@huggingface/transformers");

    console.log("Loading embedding model...");

    extractor = await pipeline(
      "feature-extraction",
      "onnx-community/all-MiniLM-L6-v2-ONNX"
    );

    console.log("Embedding model loaded.");
  }

  return extractor;
};

const generateEmbedding = async (text) => {
  const model = await getExtractor();

  const output = await model(text, {
    pooling: "mean",
    normalize: true,
  });

  return Array.from(output.data);
};

module.exports = {
  generateEmbedding,
};