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
    }]
  },
  { timestamps: true } 
);

const User = mongoose.model('User', userSchema);
export default User;
