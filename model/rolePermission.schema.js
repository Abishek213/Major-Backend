import mongoose from 'mongoose';

const rolePermissionSchema = new mongoose.Schema(
  {
    role: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Role', 
      required: true,
    },
    permission: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Permission', 
      required: true,
    },
  },
  { timestamps: true }
);

// Composite key enforcement can be implemented in MongoDB at the application level
rolePermissionSchema.index({ role: 1, permission: 1 }, { unique: true });

const RolePermission = mongoose.model('RolePermission', rolePermissionSchema);

export default RolePermission;
