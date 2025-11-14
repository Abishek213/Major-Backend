import mongoose from 'mongoose';

const permissionSchema = new mongoose.Schema(
  {
    permissionName: {
      type: String,
      required: true,
      unique: true,
      trim: true, 
    },
  },
  { timestamps: true } // Automatically adds createdAt and updatedAt fields
);

const Permission = mongoose.model('Permission', permissionSchema);

export default Permission;
