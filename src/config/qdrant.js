// const { QdrantClient } = require("@qdrant/js-client-rest");

// const qdrant = new QdrantClient({
//   url: process.env.QDRANT_URL,
//   apiKey: process.env.QDRANT_API_KEY,
// });

// module.exports = qdrant;


const { QdrantClient } = require("@qdrant/js-client-rest");

const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,

  // Skip the automatic server-version check.
  checkCompatibility: false,

  // Give requests enough time to reach Qdrant Cloud.
  timeout: 30000,

  // Keep the connection pool small for our development setup.
  maxConnections: 5,
});

module.exports = qdrant;