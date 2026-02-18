import mongoose from "mongoose";

const aiNegotiationLogSchema = new mongoose.Schema(
  {
    booking_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: false,
    },

      eventRequest_id: {  
      type: mongoose.Schema.Types.ObjectId,
      ref: "EventRequest",
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
      enum: ["price", "dates", "venue", "terms", "event_request"],
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
      enum: ["pending", "accepted", "rejected", "cancelled","countered", "expired"],
    },

    negotiation_round: {
      type: Number,
      default: 1,
    },

    negotiation_history: [
      {
        round: Number,
        offer: Number,
        party: { type: String, enum: ["user", "organizer", "ai"] },
        message: String,
        timestamp: { type: Date, default: Date.now }
      }
    ],

     metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }

  },
  {
    timestamps: true,
  }
);

// Indexes
aiNegotiationLogSchema.index({ eventRequest_id: 1, createdAt: -1 });
aiNegotiationLogSchema.index({ booking_id: 1 });
aiNegotiationLogSchema.index({ agent_id: 1, createdAt: -1 });

const AI_NegotiationLog = mongoose.model(
  "AI_NegotiationLog",
  aiNegotiationLogSchema
);
export default AI_NegotiationLog;
