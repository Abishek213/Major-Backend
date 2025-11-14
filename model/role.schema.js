import mongoose from 'mongoose';
const roleSchema = new mongoose.Schema(
  {
    role_Name: {
      type: String,
      required: true,
      unique: true,
      enum: ['Admin', 'User', 'Organizer'], 
      trim: true, 
    },
  },
  { timestamps: true } 
);
const Role = mongoose.model('Role', roleSchema);
export default Role;
