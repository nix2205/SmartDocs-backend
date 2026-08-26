const dotenv = require("dotenv");

dotenv.config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");

const connectDB =
  require("./config/db");

const documentRoutes =
  require("./routes/documentRoutes");

const searchRoutes =
  require("./routes/searchRoutes");

const chatRoutes =
  require("./routes/chatRoutes");

const contradictionRoutes =
  require("./routes/contradictionRoutes");

const conversationRoutes =
  require("./routes/conversationRoutes");

const authRoutes =
  require("./routes/authRoutes");

const { requireAuth } =
  require("./middleware/auth");

const {
  initializeCollection,
} = require("./services/vectorService");


const app =
  express();




app.use(
  cors()
);

app.use(
  express.json({
    limit: "2mb",
  })
);




app.use(
  "/api/auth",
  authRoutes
);

app.use(
  "/api/documents",
  requireAuth,
  documentRoutes
);

app.use(
  "/api/search",
  requireAuth,
  searchRoutes
);

app.use(
  "/api/chat",
  requireAuth,
  chatRoutes
);

app.use(
  "/api/contradictions",
  requireAuth,
  contradictionRoutes
);

app.use(
  "/api/conversations",
  requireAuth,
  conversationRoutes
);




app.get(
  "/",
  (req, res) => {
    res.json({
      message:
        "Document Intelligence API is running",
    });
  }
);





app.use(
  (error, req, res, next) => {
    if (
      error instanceof
      multer.MulterError
    ) {
      if (
        error.code ===
        "LIMIT_FILE_SIZE"
      ) {
        return res.status(413).json({
          success: false,
          code:
            "FILE_TOO_LARGE",
          message:
            "File is too large. Maximum allowed size is 25 MB per file.",
        });
      }

      if (
        error.code ===
        "LIMIT_FILE_COUNT"
      ) {
        return res.status(400).json({
          success: false,
          code:
            "TOO_MANY_FILES",
          message:
            "You can upload a maximum of 10 files at once.",
        });
      }

      return res.status(400).json({
        success: false,
        code:
          error.code ||
          "UPLOAD_ERROR",
        message:
          error.message ||
          "File upload failed.",
      });
    }

    
    if (
      error &&
      error.message &&
      error.message.startsWith(
        "Unsupported file type"
      )
    ) {
      return res.status(415).json({
        success: false,
        code:
          "UNSUPPORTED_FILE_TYPE",
        message:
          error.message,
      });
    }

    
    console.error(
      "Unhandled API error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "An unexpected server error occurred.",
    });
  }
);




const PORT =
  process.env.PORT ||
  5000;

const startServer =
  async () => {
    try {
      await connectDB();

      await initializeCollection();

      app.listen(
        PORT,
        () => {
          console.log(
            `Server running on port ${PORT}`
          );
        }
      );

    } catch (error) {
      console.error(
        "Server startup failed:",
        error.message
      );

      process.exit(1);
    }
  };

startServer();
