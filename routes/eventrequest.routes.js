import express from 'express';
import { authenticateUser } from '../middleware/authMiddleware.js';

import {
  createEventRequest,
  getEventRequestsForOrganizer,
  selectOrganizer,
  getAcceptedOrganizers,
  respondToEventRequest,
  acceptEventRequest,
  rejectEventRequest,
  getEventRequestsForUser, // Add this import
} from '../controller/eventrequest.controller.js';

const router = express.Router();


router.post('/', authenticateUser, createEventRequest); // Route to submit an event request
router.get('/event-requests', authenticateUser, getEventRequestsForOrganizer); // Route to get all open event requests for organizers
router.get('/accepted-organizers', authenticateUser, getAcceptedOrganizers); // Route to fetch accepted organizers for a specific event request
router.get('/event-requests-for-user', authenticateUser, getEventRequestsForUser); // Route to fetch all event requests for the logged-in user
router.put('/event-request/select-organizer', authenticateUser, selectOrganizer); // Route to select an organizer for the event request
router.post('/eventrequest-respond/:id', authenticateUser, respondToEventRequest);  // Route for an organizer to express interest in an event
router.put('/event-request/:eventId/accept', authenticateUser, acceptEventRequest);  // Route for an organizer to accept an event request
router.put('/event-request/:eventId/reject', authenticateUser, rejectEventRequest);  // Route for an organizer to reject an event request


export default router;