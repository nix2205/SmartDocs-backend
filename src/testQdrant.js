require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const { QdrantClient } = require("@qdrant/js-client-rest");

console.log("URL:", process.env.QDRANT_URL);
console.log("API key exists:", !!process.env.QDRANT_API_KEY);

const qdrant = new QdrantClient({
    url: process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY,
    checkCompatibility: false,
});

async function test() {
    try {
        const result = await qdrant.getCollections();

        console.log("✅ Qdrant connected!");
        console.log(result);
    } catch (error) {
        console.error("❌ Qdrant failed:");
        console.error(error);
    }
}

test();