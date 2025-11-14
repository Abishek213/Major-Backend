// middleware/checkPermission.js
import RolePermission from '../models/rolePermission.schema.js';

export const checkPermission = (requiredPermission) => {
  return async (req, res, next) => {
    try {
      // Assuming you store user data in req.user after authentication
      if (!req.user || !req.user.role) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      // Check if the user's role has the required permission
      const hasPermission = await RolePermission.findOne({
        role: req.user.role,
        permission: requiredPermission
      }).populate('permission');

      if (!hasPermission) {
        return res.status(403).json({ 
          message: 'You do not have permission to perform this action' 
        });
      }

      next();
    } catch (error) {
      return res.status(500).json({ 
        message: 'Error checking permissions', 
        error: error.message 
      });
    }
  };
};

// Usage in routes:
import { checkPermission } from '../middleware/checkPermission.js';
import Permission from '../models/permission.schema.js';

// Example route with permission check
router.post('/admin/users', 
  checkPermission('CREATE_USER'), // Pass the required permission
  async (req, res) => {
    // Your route handler code
  }
);

// Example permission seeding
const seedPermissions = async () => {
  const permissions = [
    { permissionName: 'CREATE_USER' },
    { permissionName: 'UPDATE_USER' },
    { permissionName: 'DELETE_USER' },
    { permissionName: 'VIEW_USERS' },
    // Add more permissions as needed
  ];

  try {
    await Permission.insertMany(permissions);
    console.log('Permissions seeded successfully');
  } catch (error) {
    console.error('Error seeding permissions:', error);
  }
};

// Example role-permission assignment
const assignPermissionToRole = async (roleId, permissionId) => {
  try {
    await RolePermission.create({
      role: roleId,
      permission: permissionId
    });
  } catch (error) {
    console.error('Error assigning permission:', error);
  }
};