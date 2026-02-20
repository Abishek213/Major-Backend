// routes/notification.routes.js
import express from "express";
import { authenticateUser } from "../middleware/authMiddleware.js";
import { protectAdmin } from "../middleware/adminMiddleware.js";
import {
  requestEventNotification,
  approveEventNotification,
  getUserNotifications,
  getAdminNotifications,
  markAsRead,
  markAllAsRead,
  getUnreadCount,
  deleteNotification,
} from "../controller/notification.controller.js";

const router = express.Router();

// Base route: /api/notifications

// GET routes
router.get("/", authenticateUser, getUserNotifications);
router.get("/count", authenticateUser, getUnreadCount);
router.get("/admin", [authenticateUser, protectAdmin], getAdminNotifications);

// POST routes
router.post("/events", authenticateUser, requestEventNotification);
router.post(
  "/events/:eventId/approve",
  [authenticateUser, protectAdmin],
  approveEventNotification
);

// PATCH routes
router.patch("/:id/read", authenticateUser, markAsRead);
router.patch("/read-all", authenticateUser, markAllAsRead);

// DELETE routes
router.delete("/:id", authenticateUser, deleteNotification);

export default router;
