// File: Backend/model/ai_feedbackSentiment.schema.js
import mongoose from "mongoose";

const aiFeedbackSentimentSchema = new mongoose.Schema(
  {
    review_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Review",
      required: true,
      unique: true,
    },
    agent_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AI_Agent",
      required: true,
    },
    sentiment_score: {
      type: Number,
      required: true,
      min: -1,
      max: 1,
    },
    detected_issues: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
aiFeedbackSentimentSchema.index({ sentiment_score: 1 });
aiFeedbackSentimentSchema.index({ agent_id: 1, createdAt: -1 });

const AI_FeedbackSentiment = mongoose.model(
  "AI_FeedbackSentiment",
  aiFeedbackSentimentSchema
);
export default AI_FeedbackSentiment;
