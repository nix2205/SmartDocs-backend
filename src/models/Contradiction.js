const mongoose = require("mongoose");

const statementSchema = new mongoose.Schema(
  {
    document: { type: String, required: true },
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Document",
      default: null,
    },
    text: { type: String, required: true },
    page: { type: Number, default: null },
    section: { type: String, default: null },
    effectiveDate: { type: String, default: null },
  },
  { _id: false }
);

const contradictionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    question: { type: String, required: true, trim: true },
    contradictionKey: { type: String, default: null, index: true },
    type: {
      type: String,
      enum: [
        "DIRECT_CONTRADICTION",
        "FACTUAL_CONTRADICTION",
        "LOGICAL_CONTRADICTION",
        "TEMPORAL_CONTRADICTION",
        "TEMPORAL_REVISION",
        "NUMERICAL_DISCREPANCY",
      ],
      required: true,
    },
    severity: {
      type: String,
      enum: ["critical", "warning", "info"],
      default: "warning",
    },
    statementA: { type: statementSchema, required: true },
    statementB: { type: statementSchema, required: true },
    explanation: { type: String, required: true, trim: true },
    resolution: { type: String, default: null },
    resolutionChoice: {
      type: String,
      enum: ["statementA", "statementB", "custom", null],
      default: null,
    },
    resolvedStatement: {
      document: { type: String, default: null },
      documentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Document",
        default: null,
      },
      text: { type: String, default: null },
      page: { type: Number, default: null },
      section: { type: String, default: null },
      effectiveDate: { type: String, default: null },
    },
    status: {
      type: String,
      enum: ["detected", "resolved", "false_positive"],
      default: "detected",
    },
    sources: [
      {
        documentName: { type: String, required: true },
        documentId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Document",
          default: null,
        },
        pageNumber: { type: Number, default: null },
        section: { type: String, default: null },
        effectiveDate: { type: String, default: null },
        text: { type: String, default: null },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Contradiction", contradictionSchema);
