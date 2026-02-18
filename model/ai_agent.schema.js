import mongoose from "mongoose";

const aiAgentSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    role: {
      type: String,
      required: true,
      enum: ["assistant", "analyst", "moderator", "negotiator", "planner"],
    },
    capabilities: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    status: {
      type: String,
      required: true,
      default: "active",
      enum: ["active", "inactive", "training", "error"],
    },
    agent_type: {
      type: String,
      required: true,
      enum: ["user", "organizer", "admin"],
    },
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  }
);

// Indexes following your pattern
aiAgentSchema.index({ user_id: 1, agent_type: 1 });
aiAgentSchema.index({ status: 1 });

const AI_Agent = mongoose.model("AI_Agent", aiAgentSchema);
export default AI_Agent;
