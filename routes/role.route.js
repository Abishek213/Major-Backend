
import express from 'express';
import { createRole, getAllRoles, verifyRole, getAdminRole } from '../controller/role.controller.js'; // Adjust path to controller

const router = express.Router();
router.post('/create', createRole);
router.get('/', getAllRoles);
router.post('/verify', verifyRole);
router.get('/admin', getAdminRole);

export default router;
