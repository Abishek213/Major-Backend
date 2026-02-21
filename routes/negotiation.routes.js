import express from 'express';
import { authenticateUser } from '../middleware/authMiddleware.js';
// import { verifyOrganizer } from '../middleware/verifyOrganizer.js';
import NegotiationController from '../controller/negotiation.controller.js';

const router = express.Router();

// ============ PUBLIC ROUTES (with auth) ============
router.get('/price-analysis', authenticateUser, NegotiationController.getPriceAnalysis);

// ============ ORGANIZER ROUTES ============
// Start negotiation on an event request
router.post(
  '/event-request/:eventRequestId/start', 
  authenticateUser, 
  // verifyOrganizer, 
  NegotiationController.startNegotiation
);

// ============ USER/ORGANIZER SHARED ROUTES ============
// Submit counter offer (user side)
router.post(
  '/:negotiationId/counter',
  authenticateUser,
  NegotiationController.submitCounterOffer
);

// Accept offer
router.post(
  '/:negotiationId/accept',
  authenticateUser,
  NegotiationController.acceptOffer
);

// Reject offer
router.post(
  '/:negotiationId/reject',
  authenticateUser,
  NegotiationController.rejectOffer
);

// Get negotiation details
router.get(
  '/:negotiationId',
  authenticateUser,
  NegotiationController.getNegotiation
);

// Get all negotiations for an event request
router.get(
  '/event-request/:eventRequestId',
  authenticateUser,
  NegotiationController.getEventRequestNegotiations
);


// Add this with other routes
router.post('/ai-response', authenticateUser, NegotiationController.receiveAIResponse);

export default router;