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
  ]
});

export const EventRequest = mongoose.model('EventRequest', eventRequestSchema);
export default EventRequest;