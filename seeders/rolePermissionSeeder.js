import Role from '../model/role.schema.js';
import Permission from '../model/permission.schema.js';
import RolePermission from '../model/rolePermission.schema.js';

const rolePermissionMappings = {
  'Admin': ['CREATE_EVENT', 'DELETE_EVENT', 'VIEW_EVENT', 'MANAGE_USERS'],
  'Organizer': ['CREATE_EVENT', 'DELETE_EVENT', 'VIEW_EVENT'],
  'User': ['VIEW_EVENT']
};

const seedRolePermissions = async () => {
  try {
    const existingRolePermissions = await RolePermission.find({});
    if (existingRolePermissions.length > 0) {
      console.log('Role permissions already seeded');
      return;
    }

    const roles = await Role.find({});
    const permissions = await Permission.find({});
    let created = 0;
    let failed = 0;

    for (const [roleName, permissionNames] of Object.entries(rolePermissionMappings)) {
      const role = roles.find(r => r.role_Name === roleName);
      if (!role) {
        failed++;
        continue;
      }

      for (const permissionName of permissionNames) {
        const permission = permissions.find(p => p.permissionName === permissionName);
        if (!permission) {
          failed++;
          continue;
        }

        const rolePermission = new RolePermission({
          role: role._id,
          permission: permission._id
        });

        await rolePermission.save();
        created++;
      }
    }

    console.log(`Role permissions: ${created} created, ${failed} failed`);
  } catch (error) {
    console.error('Seeding error:', error);
  }
};

export default seedRolePermissions;