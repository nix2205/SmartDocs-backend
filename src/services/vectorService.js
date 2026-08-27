const qdrant = require("../config/qdrant");
const { v5: uuidv5 } = require("uuid");
const { enrichChunksForIndexing } = require("./contextualEnrichmentService");
const Document = require("../models/Document");

const COLLECTION_NAME = "document_chunks_v2";
const VECTOR_SIZE = 384;

const getPointId = (documentId, chunkIndex) =>
  uuidv5(
    `${documentId}-${chunkIndex}`,
    uuidv5.URL
  );

const initializeCollection = async () => {
  const collections = await qdrant.getCollections();

  const exists = collections.collections.some(
    (collection) =>
      collection.name === COLLECTION_NAME
  );

  if (!exists) {
    await qdrant.createCollection(
      COLLECTION_NAME,
      {
        vectors: {
          size: VECTOR_SIZE,
          distance: "Cosine",
        },
      }
    );
  }

  try {
    await qdrant.createPayloadIndex(
      COLLECTION_NAME,
      {
        field_name: "documentId",
        field_schema: "keyword",
      }
    );
  } catch (error) {
    const message =
      String(error.message || "").toLowerCase();

    if (
      !message.includes("already exists") &&
      !message.includes("already indexed")
    ) {
      throw error;
    }
  }

  try {
    await qdrant.createPayloadIndex(
      COLLECTION_NAME,
      {
        field_name: "chunkIndex",
        field_schema: "integer",
      }
    );
  } catch (error) {
    const message =
      String(error.message || "").toLowerCase();

    if (
      !message.includes("already exists") &&
      !message.includes("already indexed")
    ) {
      throw error;
    }
  }
};

const storeChunks = async ({
  documentId,
  documentName,
  userId,
  chunks,
  generateEmbedding,
}) => {
  const enrichedChunks =
    await enrichChunksForIndexing(chunks);

  const points = [];

  for (const chunk of enrichedChunks) {
    const embeddingInput =
      chunk.embeddingText || chunk.text;

    const vector =
      await generateEmbedding(embeddingInput);

    points.push({
      id: getPointId(
        documentId,
        chunk.chunkIndex
      ),
      vector,
      payload: {
        documentId:
          documentId.toString(),
        documentName,
        userId: userId ? userId.toString() : null,
        chunkIndex:
          chunk.chunkIndex,
        localChunkIndex:
          chunk.localChunkIndex ?? null,
        pageNumber:
          chunk.pageNumber ?? null,
        section:
          chunk.section ?? null,
        parentSection:
          chunk.parentSection ?? null,
        effectiveDate:
          chunk.effectiveDate ?? null,
        previousChunkIndex:
          chunk.previousChunkIndex ?? null,
        nextChunkIndex:
          chunk.nextChunkIndex ?? null,
        parentText:
          chunk.parentText || chunk.text,
        text:
          chunk.text,
        embeddingText:
          embeddingInput,
        contextualSummary:
          chunk.contextualSummary || null,
        indexedAt:
          new Date().toISOString(),
      },
    });
  }

  if (!points.length) {
    return 0;
  }

  await qdrant.upsert(
    COLLECTION_NAME,
    {
      wait: true,
      points,
    }
  );

  return points.length;
};

const sleep = (ms) =>
  new Promise((resolve) =>
    setTimeout(resolve, ms)
  );

const searchSimilarChunks = async (
  vector,
  limit = 8,
  userId = null
) => {
  const maxAttempts = 3;

  for (
    let attempt = 1;
    attempt <= maxAttempts;
    attempt += 1
  ) {
    try {
      const response =
        await qdrant.query(
          COLLECTION_NAME,
          {
            query: vector,
            limit: Math.max(limit * 3, limit),
            with_payload: true,
            timeout: 30,
          }
        );

      const points = response.points || [];
      if (!points.length) {
        return [];
      }

      const documentIds = [
        ...new Set(
          points
            .map((point) => point?.payload?.documentId)
            .filter(Boolean)
            .map(String)
        ),
      ];

      if (!documentIds.length) {
        return [];
      }

      const documentQuery = {
        _id: { $in: documentIds },
      };

      if (userId) {
        documentQuery.userId = userId;
      }

      const activeDocuments = await Document.find(documentQuery)
        .select("_id")
        .lean();

      const activeIds = new Set(
        activeDocuments.map((document) => String(document._id))
      );

      return points
        .filter((point) =>
          activeIds.has(String(point?.payload?.documentId || ""))
        )
        .slice(0, limit);
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }

      await sleep(500 * attempt);
    }
  }

  return [];
};

const retrieveChunkByIndex = async (
  documentId,
  chunkIndex
) => {
  if (
    !documentId ||
    chunkIndex === null ||
    chunkIndex === undefined ||
    chunkIndex < 0
  ) {
    return null;
  }

  const ids = [
    getPointId(
      documentId,
      chunkIndex
    ),
  ];

  const points =
    await qdrant.retrieve(
      COLLECTION_NAME,
      {
        ids,
        with_payload: true,
        with_vector: false,
      }
    );

  return points?.[0] || null;
};

const retrieveNeighborChunks = async (
  documentId,
  chunkIndex,
  radius = 1
) => {
  const indexes = [];

  for (
    let offset = -radius;
    offset <= radius;
    offset += 1
  ) {
    if (offset === 0) continue;

    const index =
      Number(chunkIndex) + offset;

    if (index >= 0) {
      indexes.push(index);
    }
  }

  if (!indexes.length) {
    return [];
  }

  const points =
    await qdrant.retrieve(
      COLLECTION_NAME,
      {
        ids: indexes.map((index) =>
          getPointId(
            documentId,
            index
          )
        ),
        with_payload: true,
        with_vector: false,
      }
    );

  return (points || [])
    .sort(
      (a, b) =>
        Number(a.payload?.chunkIndex || 0) -
        Number(b.payload?.chunkIndex || 0)
    );
};

const deleteDocumentVectors = async (
  documentId
) => {
  await qdrant.delete(
    COLLECTION_NAME,
    {
      wait: true,
      filter: {
        must: [
          {
            key: "documentId",
            match: {
              value:
                documentId.toString(),
            },
          },
        ],
      },
    }
  );
};

const cleanupOrphanedVectors = async () => {
  let offset = null;
  let deleted = 0;

  do {
    const page = await qdrant.scroll(COLLECTION_NAME, {
      limit: 256,
      with_payload: true,
      with_vector: false,
      ...(offset !== null ? { offset } : {}),
    });

    const points = page.points || [];
    if (!points.length) {
      offset = page.next_page_offset ?? null;
      continue;
    }

    const documentIds = [
      ...new Set(
        points
          .map((point) => point?.payload?.documentId)
          .filter(Boolean)
          .map(String)
      ),
    ];

    const existingDocuments = documentIds.length
      ? await Document.find({ _id: { $in: documentIds } })
          .select("_id")
          .lean()
      : [];

    const existingIds = new Set(
      existingDocuments.map((document) => String(document._id))
    );

    const orphanIds = points
      .filter((point) => {
        const documentId = point?.payload?.documentId;
        return documentId && !existingIds.has(String(documentId));
      })
      .map((point) => point.id)
      .filter(Boolean);

    if (orphanIds.length) {
      await qdrant.delete(COLLECTION_NAME, {
        wait: true,
        points: orphanIds,
      });
      deleted += orphanIds.length;
    }

    offset = page.next_page_offset ?? null;
  } while (offset !== null);

  if (deleted) {
    console.log(`Removed ${deleted} orphaned vector chunk(s) from Qdrant.`);
  }

  return deleted;
};

module.exports = {
  initializeCollection,
  storeChunks,
  searchSimilarChunks,
  retrieveChunkByIndex,
  retrieveNeighborChunks,
  deleteDocumentVectors,
  cleanupOrphanedVectors,
  getPointId,
  COLLECTION_NAME,
};
