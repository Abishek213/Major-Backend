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
      // PROFESSIONAL IDENTITY (Required - makes them look legit)
      businessName: { type: String, required:function() { return this.role === 'Organizer'; } },
      contactPerson: { type: String, required:function() { return this.role === 'Organizer'; }},  // Their name
      contactPhone: { type: String, required:function() { return this.role === 'Organizer'; }},    // Direct line
      establishedYear: { type: Number },                  // Optional trust signal

      // MATCHING DATA (Required for AI)
      expertise: [{
        type: String,
        enum: ['wedding', 'birthday', 'corporate', 'conference', 'party',
          'anniversary', 'workshop', 'concert', 'festival'],
        required:function() { return this.role === 'Organizer'; }
      }],

      serviceAreas: [{
        city: {
          type: String,
          required:function() { return this.role === 'Organizer'; },
          enum: ['Kathmandu', 'Lalitpur', 'Bhaktapur', 'Pokhara', 'Chitwan',
            'Biratnagar', 'Butwal', 'Nepalgunj', 'Dharan', 'Other']
        }
      }],

      // PRICING (Optional - their choice)
      pricing: {
        wedding: { min: Number, max: Number },
        birthday: { min: Number, max: Number },
        corporate: { min: Number, max: Number }
        // They only fill what they selected in expertise
      },

      // AUTO-CALCULATED (No work for them)
      rating: { type: Number, default: 0 },
      totalEvents: { type: Number, default: 0 },
      responseTime: { type: String, default: '24h' },

      // VERIFICATION (Admin work, not theirs)
      isVerified: { type: Boolean, default: false }
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
