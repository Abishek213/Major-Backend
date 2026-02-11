import mongoose from 'mongoose';

const eventRequestSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  eventType: { type: String, required: true },
  venue: { type: String, required: true },
  budget: { type: Number, required: true },
  date: { type: Date, required: true },
  description: { type: String, required: true },
  status: { type: String, enum: ['open', 'deal_done'], default: 'open' },
  interestedOrganizers: [
    {
      organizerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      message: { type: String },
      status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
      responseDate: { type: Date, default: Date.now },
      proposedBudget: { type: Number },
    }
  ],

   // NEW: AI Insights field
  aiInsights: {
    type: {
      processed: { type: Boolean, default: false },
      reprocessed: { type: Boolean, default: false },
      matchedOrganizers: [{
        id: String,
        name: String,
        matchPercentage: Number,
        expertise: [String],
        location: String,
        rating: Number,
        priceRange: [Number]
      }],
      budgetAnalysis: {
        userBudget: Number,
        industryAverage: Number,
        feasibility: String,
        recommendedBudget: Number,
        budgetRange: {
          min: Number,
          max: Number
        }
      },
      suggestions: {
        budget: Object,
        timing: Object,
        location: Object,
        organizerSelection: Object
      },
      processingTime: { type: Date, default: Date.now },
      previousInsights: { type: Object }
    },
    default: null
  }
}, {
  timestamps: true // Adds createdAt and updatedAt automatically


});

export const EventRequest = mongoose.model('EventRequest', eventRequestSchema);
export default EventRequest;