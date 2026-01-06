import mongoose from "mongoose";

const aiRecommendationSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    event_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: true,
    },
    agent_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AI_Agent",
      required: true,
    },
    confidence_score: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
    },
    recommendation_reason: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes matching your style
aiRecommendationSchema.index({ user_id: 1, createdAt: -1 });
aiRecommendationSchema.index({ event_id: 1, confidence_score: -1 });

const AI_Recommendation = mongoose.model(
  "AI_Recommendation",
  aiRecommendationSchema
);
export default AI_Recommendation;
