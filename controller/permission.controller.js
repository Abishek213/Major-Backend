import mongoose from 'mongoose';
import Permission from '../model/permission.schema.js';
import RolePermission from '../model/rolePermission.schema.js';
import Role from '../model/role.schema.js';

export const getAllPermissions = async (req, res) => {
    try {
        const permissions = await Permission.find({}).sort({ permissionName: 1 });
        
        res.status(200).json({
            success: true,
            data: permissions
        });
    } catch (error) {
        console.error('getAllPermissions error:', error);
        res.status(500).json({
            success: false,
            message: "Error fetching permissions",
            error: error.message
        });
    }
};

export const createPermission = async (req, res) => {
    try {
        const { permissionName } = req.body;
        
        if (!permissionName) {
            return res.status(400).json({
                success: false,
                message: "Permission name is required"
            });
        }

        // Check if permission already exists
        const existingPermission = await Permission.findOne({ 
            permissionName: permissionName.trim() 
        });

        if (existingPermission) {
            return res.status(400).json({
                success: false,
                message: "Permission already exists"
            });
        }

        const permission = await Permission.create({ 
            permissionName: permissionName.trim() 
        });

        res.status(201).json({
            success: true,
            message: "Permission created successfully",
            data: permission
        });
    } catch (error) {
        console.error('createPermission error:', error);
        res.status(500).json({
            success: false,
            message: "Error creating permission",
            error: error.message
        });
    }
};

export const deletePermission = async (req, res) => {
    try {
        const { id } = req.params;

        // Delete the permission
        const permission = await Permission.findByIdAndDelete(id);
        
        if (!permission) {
            return res.status(404).json({
                success: false,
                message: "Permission not found"
            });
        }

        // Delete all role-permission associations for this permission
        await RolePermission.deleteMany({ permission: id });

        res.status(200).json({
            success: true,
            message: "Permission deleted successfully"
        });
    } catch (error) {
        console.error('deletePermission error:', error);
        res.status(500).json({
            success: false,
            message: "Error deleting permission",
            error: error.message
        });
    }
};

export const getRolePermissions = async (req, res) => {
    try {
        const rolePermissions = await RolePermission.find({})
            .populate('role', 'role_Name')
            .populate('permission', 'permissionName');

        // Format the data to match frontend expectations
        const formattedRolePermissions = rolePermissions.map(rp => ({
            role: rp.role.role_Name,
            permission: rp.permission._id
        }));

        res.status(200).json({
            success: true,
            data: formattedRolePermissions
        });
    } catch (error) {
        console.error('getRolePermissions error:', error);
        res.status(500).json({
            success: false,
            message: "Error fetching role permissions",
            error: error.message
        });
    }
};

export const assignPermissionToRole = async (req, res) => {
    try {
        const { role: roleName, permission: permissionId } = req.body;

        // Find the role by name
        const role = await Role.findOne({ role_Name: roleName });
        if (!role) {
            return res.status(404).json({
                success: false,
                message: "Role not found"
            });
        }

        // Verify permission exists
        const permission = await Permission.findById(permissionId);
        if (!permission) {
            return res.status(404).json({
                success: false,
                message: "Permission not found"
            });
        }

        // Check if assignment already exists
        const existingAssignment = await RolePermission.findOne({
            role: role._id,
            permission: permissionId
        });

        if (existingAssignment) {
            return res.status(400).json({
                success: false,
                message: "Permission already assigned to role"
            });
        }

        // Create new role-permission assignment
        await RolePermission.create({
            role: role._id,
            permission: permissionId
        });

        res.status(201).json({
            success: true,
            message: "Permission assigned to role successfully"
        });
    } catch (error) {
        console.error('assignPermissionToRole error:', error);
        res.status(500).json({
            success: false,
            message: "Error assigning permission to role",
            error: error.message
        });
    }
};

export const removePermissionFromRole = async (req, res) => {
    const { roleId, permissionId } = req.params;

    try {
        // If roleId is a name (like "Organizer"), find the role ID first
        let actualRoleId = roleId;
        if (!mongoose.Types.ObjectId.isValid(roleId)) {
            const role = await Role.findOne({ role_Name: roleId });
            if (!role) {
                return res.status(404).json({
                    success: false,
                    message: "Role not found"
                });
            }
            actualRoleId = role._id;
        }

        // Find and delete the role-permission combination
        const deletedPermission = await RolePermission.findOneAndDelete({
            role: actualRoleId,
            permission: permissionId
        });

        if (!deletedPermission) {
            return res.status(404).json({
                success: false,
                message: "Role-permission combination not found"
            });
        }

        return res.status(200).json({
            success: true,
            message: "Permission removed from role successfully",
            data: deletedPermission
        });

    } catch (error) {
        console.error('removePermissionFromRole error:', error);
        return res.status(500).json({
            success: false,
            message: "Error removing permission from role",
            error: error.message
        });
    }
};