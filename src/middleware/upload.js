const multer = require("multer");
const path = require("path");
const fs = require("fs");

const uploadsDirectory = path.resolve(
  process.cwd(),
  "uploads"
);

fs.mkdirSync(uploadsDirectory, {
  recursive: true,
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDirectory);
  },

  filename: (req, file, cb) => {
    const safeOriginalName =
      path
        .basename(file.originalname)
        .replace(/[^a-zA-Z0-9._-]/g, "_");

    const uniqueName =
      `${Date.now()}-${safeOriginalName}`;

    cb(null, uniqueName);
  },
});

const allowedExtensions = [
  ".pdf",
  ".docx",
  ".md",
  ".txt",
];

const allowedMimeTypes = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/markdown",
  "text/plain",
  "application/octet-stream",
]);

const fileFilter = (req, file, cb) => {
  const extension = path
    .extname(file.originalname)
    .toLowerCase();

  if (!allowedExtensions.includes(extension)) {
    return cb(
      new Error(
        "Unsupported file type. Only PDF, DOCX, MD and TXT files are allowed."
      )
    );
  }

  /*
   * Some browsers send MD/TXT files as application/octet-stream.
   * Therefore extension is the primary validation.
   */

  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,

  limits: {
    /*
     * 25 MB per file.
     * This fixes the previous 10 MB rejection while
     * still preventing accidentally huge uploads.
     */
    fileSize: 25 * 1024 * 1024,

    /*
     * Prevent excessively large multipart requests.
     */
    files: 10,
  },
});

module.exports = upload;
