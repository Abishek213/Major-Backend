import express from 'express';
import { getPendingEvents, approveRejectEvent, getDashboardStats } from '../controller/admin.controller.js';
import { getAllPermissions, createPermission, deletePermission, getRolePermissions, assignPermissionToRole, removePermissionFromRole } from '../controller/permission.controller.js';
import {protectAdmin} from '../middleware/adminMiddleware.js';
import { authenticateUser } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/dashboard-stats', authenticateUser, protectAdmin, getDashboardStats);

router.get('/pending-events', authenticateUser, protectAdmin, getPendingEvents);
router.post('/approve-event/:eventId', authenticateUser, protectAdmin, approveRejectEvent);

// admin.routes.js
router.get('/permissions', authenticateUser, protectAdmin, getAllPermissions);
router.post('/permissions', authenticateUser, protectAdmin, createPermission);
router.delete('/permissions/:id', authenticateUser, protectAdmin, deletePermission);
router.get('/role-permissions', authenticateUser, protectAdmin, getRolePermissions);
router.post('/role-permissions', authenticateUser, protectAdmin, assignPermissionToRole);
router.delete('/role-permissions/:roleId/:permissionId', authenticateUser, protectAdmin, removePermissionFromRole);

export default router;