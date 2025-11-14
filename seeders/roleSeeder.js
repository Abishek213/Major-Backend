import Role from '../model/role.schema.js';

const roles = ['Admin', 'User', 'Organizer'];

const seedRoles = async () => {
  let created = 0;
  let existing = 0;
  for (const roleName of roles) {
    const existingRole = await Role.findOne({ role_Name: roleName });
    if (existingRole) {
      existing++;
    } else {
      const newRole = new Role({ role_Name: roleName });
      await newRole.save();
      created++;
    }
  }
  
  console.log(`Roles: ${created} created, ${existing} existing`);
};

export default seedRoles;
