import express from "express";
import {
  createAgent,
  getAgents,
  getUserRecommendations,
  createRecommendation,
  createNegotiation,
  updateNegotiation,
  performFraudCheck,
  analyzeReviewSentiment,
  getAIDashboard,
} from "../controller/ai.controller.js";
import {
  createReview,
  getEventReviews,
  getUserReviews,
} from "../controller/review.controller.js";
import {
  getBookingWithAIInsights,
  getBookingFraudRisk,
} from "../controller/booking.controller.js";
import {
  getAIRecommendedEvents,
  generateEventRecommendations,
  getEventSentimentAnalysis,
} from "../controller/Event.controller.js";
import { authenticateUser } from "../middleware/authMiddleware.js";
import { protectAdmin } from "../middleware/adminMiddleware.js"; // ✅ Use correct export name

const router = express.Router();

// AI AGENT ROUTES (Admin only)
router.post("/agents", authenticateUser, protectAdmin, createAgent);
router.get("/agents", authenticateUser, protectAdmin, getAgents);

// AI RECOMMENDATION ROUTES
// Get recommendations for a specific user
router.get(
  "/recommendations/user/:userId",
  authenticateUser,
  getUserRecommendations
);
// Create a new recommendation
router.post("/recommendations", authenticateUser, createRecommendation);
// Get AI recommended events for current user
router.get("/recommendations/me", authenticateUser, getAIRecommendedEvents);
// Generate recommendations (for AI service)
router.post(
  "/recommendations/generate",
  authenticateUser,
  generateEventRecommendations
);

// AI NEGOTIATION ROUTES
router.post("/negotiations", authenticateUser, createNegotiation);
router.put("/negotiations/:id", authenticateUser, updateNegotiation);

// AI FRAUD CHECK ROUTES (Admin only)
router.post(
  "/fraud-check/:bookingId",
  authenticateUser,
  protectAdmin,
  performFraudCheck
);
// Get fraud risk for a booking
router.get("/fraud-check/booking/:id", authenticateUser, getBookingFraudRisk);

// AI SENTIMENT ANALYSIS ROUTES
router.post(
  "/sentiment-analysis/:reviewId",
  authenticateUser,
  protectAdmin,
  analyzeReviewSentiment
);
// Get sentiment analysis for an event
router.get(
  "/sentiment-analysis/event/:id",
  authenticateUser,
  getEventSentimentAnalysis
);

// REVIEW ROUTES (with AI integration)
router.post("/reviews", authenticateUser, createReview);
router.get("/reviews/event/:eventId", getEventReviews);
router.get("/reviews/me", authenticateUser, getUserReviews);

// BOOKING AI DATA ROUTES
router.get(
  "/bookings/:id/insights",
  authenticateUser,
  getBookingWithAIInsights
);
router.get("/bookings/:id/fraud-risk", authenticateUser, getBookingFraudRisk);

// AI DASHBOARD (Admin only)
router.get("/dashboard", authenticateUser, protectAdmin, getAIDashboard);

export default router;
