import Role from '../model/role.schema.js';

// Create a new role
export const createRole = async (req, res) => {
  try {
    const { role_Name } = req.body;

    // Validate input
    if (!role_Name || typeof role_Name !== 'string') {
      return res.status(400).json({ message: "Role name is required and must be a string" });
    }

    // Check if the role already exists (case-insensitive)
    const existingRole = await Role.findOne({ role_Name: new RegExp(`^${role_Name}$`, 'i') });
    if (existingRole) {
      return res.status(400).json({ message: "Role already exists" });
    }

    // Save new role
    const newRole = new Role({ role_Name });
    await newRole.save();

    res.status(201).json({ message: "Role created successfully", role: newRole });
  } catch (error) {
    console.error("Error creating role:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

// Fetch all roles
export const getAllRoles = async (req, res) => {
  try {
    const roles = await Role.find().select('_id role_Name'); // Fetch only necessary fields
    res.status(200).json(roles);
  } catch (error) {
    console.error("Error fetching roles:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

// Verify if a role exists
export const verifyRole = async (req, res) => {
  try {
    const { role_Name } = req.body;

    // Validate input
    if (!role_Name || typeof role_Name !== 'string') {
      return res.status(400).json({ message: "Role name is required and must be a string" });
    }

    // Check if the role exists
    const role = await Role.findOne({ role_Name: new RegExp(`^${role_Name}$`, 'i') });
    if (!role) {
      return res.status(404).json({ message: "Role not found" });
    }

    res.status(200).json({ message: `Role "${role_Name}" exists`, role });
  } catch (error) {
    console.error("Error verifying role:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

export const getAdminRole = async (req, res) => {
  try {
    const adminRole = await Role.findOne({ role_Name: /^admin$/i });
    
    if (!adminRole) {
      return res.status(404).json({ 
        success: false, 
        message: "Admin role not found" 
      });
    }

    return res.status(200).json({ 
      success: true,
      roleId: adminRole._id,
      role_Name: adminRole.role_Name
    });
  } catch (error) {
    console.error("Error fetching admin role:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Internal Server Error" 
    });
  }
};