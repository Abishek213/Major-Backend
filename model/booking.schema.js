import mongoose from 'mongoose';

const bookingSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required.'],
    },
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Event',
      required: [true, 'Event ID is required.'],
    },
    numberOfSeats: {
      type: Number,
      required: [true, 'Number of seats is required.'],
      min: [1, 'Must book at least one seat.'],
    },
    totalAmount: {
      type: Number,
      required: [true, 'Total amount is required.'],
      min: [0, 'Total amount cannot be negative.'],
    },
    payment: {
      status: {
        type: String,
        enum: ['pending', 'completed', 'failed', 'refunded', 'partially_refunded'],
        default: 'pending',
      },
      method: {
        type: String,
        enum: ['Khalti', 'eSewa'],
        required: true,
      },
      transactionId: {
        type: String,
        unique: true  // Ensure unique transaction IDs
      },
      pidx: {
        type: String,
        unique: true  // Ensure unique PIDX values
      },
      currency: {
        type: String,
        default: 'NPR'
      },
      processedAt: Date,
      gatewayResponse: Object,
      refund: {
        amount: Number,
        date: Date,
        reason: String,
        status: String
      }
    }
  },
  { timestamps: true }
);

const Booking = mongoose.model('Booking', bookingSchema);
export default Booking;