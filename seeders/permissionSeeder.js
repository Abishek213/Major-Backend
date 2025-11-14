import Permission from '../model/permission.schema.js';

const seedPermissions = async () => {
  const permissions = [
    { permissionName: 'CREATE_EVENT' },
    { permissionName: 'DELETE_EVENT' },
    { permissionName: 'VIEW_EVENT' },
    { permissionName: 'MANAGE_USERS' },
  ];

  try {
    let created = 0;
    for (const perm of permissions) {
      const existingPermission = await Permission.findOne({ permissionName: perm.permissionName });
      if (!existingPermission) {
        await Permission.create(perm);
        created++;
      }
    }
    
    console.log(`Permissions: ${created} created`);
  } catch (error) {
    console.error('Seeding error:', error);
  }
};

export default seedPermissions;
