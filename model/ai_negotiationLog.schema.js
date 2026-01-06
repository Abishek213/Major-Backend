import mongoose from "mongoose";

const aiNegotiationLogSchema = new mongoose.Schema(
  {
    booking_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
    },
    agent_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AI_Agent",
      required: true,
    },
    negotiation_type: {
      type: String,
      required: true,
      enum: ["price", "dates", "venue", "terms"],
    },
    initial_offer: {
      type: Number,
      required: true,
      min: 0,
    },
    final_offer: {
      type: Number,
      min: 0,
    },
    status: {
      type: String,
      required: true,
      default: "pending",
      enum: ["pending", "accepted", "rejected", "cancelled"],
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
aiNegotiationLogSchema.index({ booking_id: 1 });
aiNegotiationLogSchema.index({ agent_id: 1, createdAt: -1 });

const AI_NegotiationLog = mongoose.model(
  "AI_NegotiationLog",
  aiNegotiationLogSchema
);
export default AI_NegotiationLog;
