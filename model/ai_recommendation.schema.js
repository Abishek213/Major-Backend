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
      default: null,
    },
    confidence_score: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
    },
    recommendation_reason: {
      type: String,
      default: "",
    },
    source: {
      type: String,
      enum: ["ai_agent", "database_cache", "fallback", "emergency_fallback"],
      default: "ai_agent",
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for the getCachedRecommendations query:
// AI_Recommendation.find({ user_id, createdAt: { $gte: oneDayAgo } })
// .sort({ confidence_score: -1, createdAt: -1 })
aiRecommendationSchema.index({ user_id: 1, createdAt: -1 });

// Index for event-level queries (e.g. how often an event has been recommended)
aiRecommendationSchema.index({ event_id: 1, confidence_score: -1 });

// Sparse index to speed up agent-level analytics (optional field)
aiRecommendationSchema.index({ agent_id: 1 }, { sparse: true });

const AI_Recommendation = mongoose.model(
  "AI_Recommendation",
  aiRecommendationSchema
);
export default AI_Recommendation;
