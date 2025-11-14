// routes/notification.routes.js
import express from 'express';
import { authenticateUser } from '../middleware/authMiddleware.js';
import { protectAdmin } from '../middleware/adminMiddleware.js';
import {
  requestEventNotification,
  approveEventNotification,
  getUserNotifications,
  getAdminNotifications,
  markAsRead,
  markAllAsRead,
  getUnreadCount,
  deleteNotification
} from '../controller/notification.controller.js';

const router = express.Router();

// Base route: /api/notifications

// GET routes
router.get('/', authenticateUser, getUserNotifications);
router.get('/count', authenticateUser, getUnreadCount);
router.get('/admin', [authenticateUser, protectAdmin], getAdminNotifications);  // Combined middleware

// POST routes
router.post('/events', authenticateUser, requestEventNotification); // org to admin
router.post('/events/:eventId/approve', [authenticateUser, protectAdmin], approveEventNotification);  // Changed from /status to /approve for clarity

// PATCH routes
router.patch('/:id/read', authenticateUser, markAsRead);              // Added /read for clearer route purpose
router.patch('/read-all', authenticateUser, markAllAsRead);          // Changed from / to /read-all for explicit naming

// DELETE routes
router.delete('/:id', authenticateUser, deleteNotification);

export default router;