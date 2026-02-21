// user.schema.js
import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    fullname: { type: String, required: true, trim: true },
    email: { 
      type: String, 
      required: true, 
      unique: true, 
      trim: true, 
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Invalid email format.'] 
    },
    password: { type: String, required: true, minlength: 6 },
    contactNo: {
      type: String,
      required: true,
      trim: true,
      match: [/^\+?[\d\s-]{10,}$/, 'Invalid contact number format.']
    },
    role: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Role', 
      required: true 
    },
    profileImage: {
      type: String,
      default: null
    },
    wishlist: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Event',
      default: []
    }],


    // ===== NEW ORGANIZER FIELDS =====
    // These will only be used if user has role = Organizer
    organizerDetails: {
      // Professional Info
      businessName: { type: String, default: null },
      businessRegistration: { type: String, default: null },
      yearsOfExperience: { type: Number, default: 0 },
      
      // Service Details
      expertise: [{
        type: String,
        enum: ['wedding', 'birthday', 'corporate', 'conference', 'party', 
               'anniversary', 'workshop', 'concert', 'festival', 'general'],
        default: []
      }],
      
      serviceAreas: [{
        city: String,
        distance: Number // max distance willing to travel (km)
      }],
      
      // Pricing
      priceRange: {
        min: { type: Number, default: 0 },
        max: { type: Number, default: 0 },
        currency: { type: String, default: 'NPR' }
      },
      
      pricingModel: {
        type: String,
        enum: ['fixed', 'per_person', 'custom'],
        default: 'custom'
      },
      
      // Performance Metrics
      rating: { type: Number, default: 0, min: 0, max: 5 },
      totalReviews: { type: Number, default: 0 },
      totalEvents: { type: Number, default: 0 },
      
      // Availability
      responseTime: { type: String, default: '24h' },
      
      // Verification
      isVerified: { type: Boolean, default: false },
      autoMatchEnabled: { type: Boolean, default: true }
    }


  },
  { timestamps: true } 
);
// Indexes for efficient querying
userSchema.index({ 'organizerDetails.expertise': 1 });
userSchema.index({ 'organizerDetails.serviceAreas.city': 1 });
userSchema.index({ 'organizerDetails.priceRange.min': 1, 'organizerDetails.priceRange.max': 1 });
userSchema.index({ 'organizerDetails.rating': -1 });



const User = mongoose.model('User', userSchema);
export default User;
