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
  getEventRequestWithAIInsights,    // NEW
  getAISuggestedOrganizers,         // NEW
  reprocessWithAI,
  searchOrganizersForAI
} from '../controller/eventrequest.controller.js';

const router = express.Router();


router.post('/', authenticateUser, createEventRequest); // Route to submit an event request
router.get('/event-requests', authenticateUser, getEventRequestsForOrganizer); // Route to get all open event requests for organizers
router.get('/accepted-organizers', authenticateUser, getAcceptedOrganizers); // Route to fetch accepted organizers for a specific event request
router.get('/event-requests-for-user', authenticateUser, getEventRequestsForUser); // Route to fetch all event requests for the logged-in user
router.put('/select-organizer', authenticateUser, selectOrganizer);        // No /event-request
router.post('/eventrequest-respond/:id', authenticateUser, respondToEventRequest);  // Route for an organizer to express interest in an event
router.put('/:eventId/accept', authenticateUser, acceptEventRequest);      // No /event-request
router.put('/:eventId/reject', authenticateUser, rejectEventRequest);      // No /event-request

router.get('/with-ai-insights/:id', authenticateUser, getEventRequestWithAIInsights);
router.get('/ai-suggestions/:id', authenticateUser, getAISuggestedOrganizers);
router.post('/reprocess-with-ai/:id', authenticateUser, reprocessWithAI);

// Add to any existing router
router.get('/organizers/search',searchOrganizersForAI);



export default router;