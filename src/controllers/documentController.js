const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const Document = require("../models/Document");
const Contradiction = require("../models/Contradiction");
const cache = require("../services/cacheService");

const {
  parseDocument,
} = require("../services/documentParser");

const {
  createChunks,
} = require("../services/chunkingService");

const {
  generateEmbedding,
} = require("../services/embeddingService");

const {
  storeChunks,
  deleteDocumentVectors,
} = require("../services/vectorService");

const {
  enrichChunksWithContext,
} = require("../services/contextualEnrichmentService");




const createContentHash = (text = "") => {
  const normalizedText = text
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  return crypto
    .createHash("sha256")
    .update(normalizedText)
    .digest("hex");
};



const resolveDocumentPath = (filePath) => {
  if (!filePath) {
    return null;
  }

  if (path.isAbsolute(filePath)) {
    return path.normalize(filePath);
  }

  return path.resolve(
    process.cwd(),
    filePath
  );
};




const uploadDocuments = async (
  req,
  res
) => {
  try {
    if (
      !req.files ||
      req.files.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message:
          "No files uploaded",
      });
    }

    const documents = [];

    for (const file of req.files) {
      const document =
        await Document.create({
          userId: req.user.id,
          name:
            file.filename,

          originalName:
            file.originalname,

          fileType:
            file.mimetype,

          
          filePath:
            path.resolve(
              file.path
            ),

          size:
            file.size,

          status:
            "processing",
        });

      try {
        console.log(
          `\nProcessing: ${file.originalname}`
        );

        

        const parsedDocument =
          await parseDocument(
            file.path
          );

        const extractedText =
          parsedDocument.text || "";

        console.log(
          `Extracted ${extractedText.length} characters`
        );

        
        if (
          extractedText.trim().length ===
          0
        ) {
          throw new Error(
            "No extractable text was found. This PDF may contain scanned images or image-only pages. OCR is required to index image-only content."
          );
        }


        

        const contentHash =
          createContentHash(
            extractedText
          );

        console.log(
          `Content hash: ${contentHash}`
        );


        

        const existingDocument =
          await Document.findOne({
            userId: req.user.id,
            contentHash,
            status:
              "processed",

            _id: {
              $ne:
                document._id,
            },
          });

        if (
          existingDocument
        ) {
          console.log(
            `Duplicate detected: ${file.originalname}`
          );

          document.status =
            "failed";

          document.errorMessage =
            `Duplicate of ${existingDocument.originalName}`;

          document.contentHash =
            contentHash;

          await document.save();

          documents.push({
            id:
              document._id,

            name:
              document.originalName,

            status:
              "duplicate",

            duplicateOf:
              existingDocument.originalName,
          });

          continue;
        }


        

        const chunks =
          createChunks(
            parsedDocument.pages,
            {
              documentName: document.originalName,
            }
          );

        console.log(
          `Created ${chunks.length} chunks`
        );

        
        const enrichedChunks =
          await enrichChunksWithContext({
            documentName: document.originalName,
            chunks,
          });

        console.log(
          `Contextually enriched ${enrichedChunks.length} chunks`
        );


        

        document.extractedText =
          extractedText;

        document.pageCount =
          parsedDocument.pageCount;

        document.chunkCount =
          enrichedChunks.length;

        document.contentHash =
          contentHash;


        

        const storedChunks =
          await storeChunks({
            documentId:
              document._id,

            documentName:
              document.originalName,

            userId:
              req.user.id,

            chunks: enrichedChunks,

            generateEmbedding,
          });

        console.log(
          `Stored ${storedChunks} chunks in Qdrant`
        );


        

        document.status =
          "processed";

        await document.save();

        documents.push({
          id:
            document._id,

          name:
            document.originalName,

          status:
            document.status,

          pageCount:
            document.pageCount,

          chunkCount:
            document.chunkCount,

          extractedCharacters:
            extractedText.length,
        });

      } catch (
        processingError
      ) {
        console.error(
          `Processing failed for ${file.originalname}:`,
          processingError.message
        );

        document.status =
          "failed";

        document.errorMessage =
          processingError.message;

        await document.save();

        documents.push({
          id:
            document._id,

          name:
            document.originalName,

          status:
            "failed",

          error:
            processingError.message,
        });
      }
    }

    const hasFailures =
      documents.some(
        (document) =>
          document.status ===
            "failed" ||
          document.status ===
            "duplicate"
      );

    res.status(
      hasFailures
        ? 207
        : 201
    ).json({
      success: true,

      message:
        hasFailures
          ? "Upload completed with some files needing attention"
          : "Documents uploaded and processed",

      documents,
    });

  } catch (error) {
    console.error(
      "Upload error:",
      error
    );

    res.status(500).json({
      success: false,
      message:
        "Failed to upload documents",
      error:
        error.message,
    });
  }
};




const getDocuments = async (
  req,
  res
) => {
  try {
    const documents =
      await Document.find({ userId: req.user.id })
        .select(
          "originalName fileType size status pageCount chunkCount errorMessage createdAt updatedAt"
        )
        .sort({
          createdAt: -1,
        });

    res.json({
      success: true,
      count:
        documents.length,
      documents: documents.map((document) => ({
        ...document.toObject(),
        fileUrl: `/documents/${document._id}/file`,
      })),
    });

  } catch (error) {
    console.error(
      "Failed to fetch documents:",
      error
    );

    res.status(500).json({
      success: false,
      message:
        "Failed to fetch documents",
    });
  }
};




const getDocumentById = async (
  req,
  res
) => {
  try {
    const document =
      await Document.findOne({
        _id: req.params.id,
        userId: req.user.id,
      });

    if (!document) {
      return res.status(404).json({
        success: false,
        message:
          "Document not found",
      });
    }

    res.json({
      success: true,
      document,
      fileUrl: `/documents/${document._id}/file`,
    });

  } catch (error) {
    console.error(
      "Failed to fetch document:",
      error
    );

    res.status(500).json({
      success: false,
      message:
        "Failed to fetch document",
    });
  }
};




const getDocumentFile = async (
  req,
  res
) => {
  try {
    const document =
      await Document.findOne({
        _id: req.params.id,
        userId: req.user.id,
      });

    if (!document) {
      return res.status(404).json({
        success: false,
        message:
          "Document not found",
      });
    }

    const resolvedPath =
      resolveDocumentPath(
        document.filePath
      );

    if (!resolvedPath) {
      return res.status(404).json({
        success: false,
        message:
          "Original file path is unavailable",
      });
    }

    if (
      !fs.existsSync(
        resolvedPath
      )
    ) {
      return res.status(404).json({
        success: false,
        message:
          "Original file could not be found on the server",
      });
    }

    const stats =
      fs.statSync(
        resolvedPath
      );

    if (!stats.isFile()) {
      return res.status(404).json({
        success: false,
        message:
          "Stored document path is not a file",
      });
    }

    
    const uploadsRoot =
      path.resolve(
        process.cwd(),
        "uploads"
      );

    const relativePath =
      path.relative(
        uploadsRoot,
        resolvedPath
      );

    if (
      relativePath.startsWith(
        ".." +
          path.sep
      ) ||
      path.isAbsolute(
        relativePath
      )
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Document path is outside the uploads directory",
      });
    }

    res.setHeader(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(
        document.originalName
      )}"`
    );

    res.setHeader(
      "Content-Type",
      document.fileType ||
        "application/octet-stream"
    );

    return res.sendFile(
      resolvedPath
    );

  } catch (error) {
    console.error(
      "Failed to open document:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to open document",
      error:
        error.message,
    });
  }
};




const deleteDocument = async (
  req,
  res
) => {
  try {
    const document =
      await Document.findOne({
        _id: req.params.id,
        userId: req.user.id,
      });

    if (!document) {
      return res.status(404).json({
        success: false,
        message:
          "Document not found",
      });
    }

    
    await deleteDocumentVectors(
      document._id
    );

    await Contradiction.deleteMany({
      userId: req.user.id,
      $or: [
        { "statementA.documentId": document._id },
        { "statementB.documentId": document._id },
        { "resolvedStatement.documentId": document._id },
        { "sources.documentId": document._id },
        {
          "statementA.document": document.originalName,
          "statementA.documentId": null,
        },
        {
          "statementB.document": document.originalName,
          "statementB.documentId": null,
        },
        {
          "sources.documentName": document.originalName,
          "sources.documentId": null,
        },
      ],
    });

    await Document.findByIdAndDelete(
      document._id
    );

    cache.clear("retrieval");
    cache.clear("answer");

    
    try {
      const resolvedPath =
        resolveDocumentPath(
          document.filePath
        );

      if (
        resolvedPath &&
        fs.existsSync(
          resolvedPath
        )
      ) {
        fs.unlinkSync(
          resolvedPath
        );
      }

    } catch (
      fileError
    ) {
      console.error(
        "Failed to delete physical file:",
        fileError.message
      );
    }

    res.json({
      success: true,
      message:
        "Document and associated vectors deleted successfully",
      documentId:
        document._id,
    });

  } catch (error) {
    console.error(
      "Delete document error:",
      error
    );

    res.status(500).json({
      success: false,
      message:
        "Failed to delete document",
      error:
        error.message,
    });
  }
};


module.exports = {
  uploadDocuments,
  getDocuments,
  getDocumentById,
  getDocumentFile,
  deleteDocument,
};
