import mongoose from "mongoose";

const aiFraudCheckSchema = new mongoose.Schema(
  {
    agentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AI_Agent",
      required: true,
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
      unique: true,
    },
    riskScore: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
    },
    fraudStatus: {
      type: String,
      required: true,
      enum: ["clean", "suspicious", "fraudulent", "pending"],
    },
    checkVersion: {
      type: String,
      required: true,
      default: "1.0",
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
aiFraudCheckSchema.index({ fraudStatus: 1, riskScore: -1 });
aiFraudCheckSchema.index({ agentId: 1, createdAt: -1 });

const AI_FraudCheck = mongoose.model("AI_FraudCheck", aiFraudCheckSchema);
export default AI_FraudCheck;
