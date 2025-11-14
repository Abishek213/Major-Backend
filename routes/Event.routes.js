import express from 'express';
import {
  createEvent,
  getEvents,
  getEventsByParentCategory,
  getEventsByUserId,
  getEventById,
  updateEvent,
  deleteEvent,
  uploadEventImage,
  registerForEvent,
  cancelRegistration,
  getRegistrationStatus,
  getSimilarEvents
} from '../controller/Event.controller.js';
import { authenticateUser } from '../middleware/authMiddleware.js';
import { verifyOrganizer } from '../middleware/verifyOrganizer.js';

const router = express.Router();

// Existing routes
router.post('/create', authenticateUser, verifyOrganizer, createEvent);
router.get('/', getEvents);
router.get('/by-parent-category/:parentCategoryId', getEventsByParentCategory);
router.get('/user/:userId', getEventsByUserId);
router.get('/:id', getEventById);
router.put('/update/:id', authenticateUser, updateEvent);
router.delete('/delete/:id', authenticateUser, deleteEvent);
router.post('/upload-image', authenticateUser, uploadEventImage);

// New routes for EventDetail.jsx functionality
router.post('/:id/register', authenticateUser, registerForEvent);
router.delete('/:id/register', authenticateUser, cancelRegistration);
router.get('/:id/registration-status', authenticateUser, getRegistrationStatus);
router.get('/:id/similar', getSimilarEvents);

export default router;