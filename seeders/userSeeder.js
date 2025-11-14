import User from '../model/user.schema.js';
import bcryptjs from 'bcryptjs';
import Role from '../model/role.schema.js';

const users = [
  { fullname: 'Admin', email: 'admin@gmail.com', password: 'admin123', role: 'Admin', contactNo: '9811111111' },
  { fullname: 'User', email: 'user@gmail.com', password: 'user123', role: 'User', contactNo: '9822222222' },
  { fullname: 'Organizer', email: 'organizer@gmail.com', password: 'organizer123', role: 'Organizer', contactNo: '9833333333' }
];

const seedUsers = async () => {
  let created = 0;
  let skipped = 0;
  let failed = 0;
  
  for (const userData of users) {
    const { email, role } = userData;
    
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      skipped++;
      continue;
    }

    const roleFound = await Role.findOne({ role_Name: role });
    if (!roleFound) {
      failed++;
      continue;
    }
    
    const hashedPassword = await bcryptjs.hash(userData.password, 10);
    const newUser = new User({
      fullname: userData.fullname,
      email,
      password: hashedPassword,
      contactNo: userData.contactNo,
      role: roleFound._id
    });
    
    await newUser.save();
    created++;
  }
  
  console.log(`Users: ${created} created, ${skipped} existing, ${failed} failed`);
};

export default seedUsers;