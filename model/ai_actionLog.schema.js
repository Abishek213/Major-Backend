import mongoose from "mongoose";

const aiActionLogSchema = new mongoose.Schema(
  {
    agentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AI_Agent",
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    logType: {
      type: String,
      required: true,
      enum: [
        "recommendation",
        "negotiation",
        "fraud_check",
        "sentiment_analysis",
        "system_alert",
      ],
    },
    actionDetails: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    eventRequestedAt: {
      type: Date,
    },
    failureType: {
      type: String,
      enum: ["timeout", "api_error", "validation_error", "data_error", null],
    },
    success: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
aiActionLogSchema.index({ agentId: 1, createdAt: -1 });
aiActionLogSchema.index({ userId: 1, logType: 1 });

const AI_ActionLog = mongoose.model("AI_ActionLog", aiActionLogSchema);
export default AI_ActionLog;
