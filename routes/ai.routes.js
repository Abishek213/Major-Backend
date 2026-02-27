import express from "express";
import {
  createAgent,
  getAgents,
  getUserRecommendations,
  createRecommendation,
  getMyRecommendations,
  checkAIHealth,
  planEvent,
  checkPlanningAgentHealth,
  getPlanningAgentStats,
  chatBookingSupport,
  clearBookingSupportHistory,
  clearBookingSupportHistoryAnonymous,
  checkBookingSupportHealth,
  getBookingSupportStats,
  processEventRequest,
  getEventSuggestions,
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
  generateEventRecommendations,
  getEventSentimentAnalysis,
} from "../controller/Event.controller.js";
import { authenticateUser } from "../middleware/authMiddleware.js";
import { protectAdmin } from "../middleware/adminMiddleware.js";

const router = express.Router();

router.get("/health", checkAIHealth);

// ============================================================================
// AI AGENT MANAGEMENT ROUTES (Admin Only)
// ============================================================================

router.post("/agents", authenticateUser, protectAdmin, createAgent);
router.get("/agents", authenticateUser, protectAdmin, getAgents);

// ============================================================================
// AI RECOMMENDATION ROUTES
// ============================================================================

router.get(
  "/recommendations/user/:userId",
  authenticateUser,
  getUserRecommendations
);

// GET /api/ai/recommendations/me
router.get("/recommendations/me", authenticateUser, getMyRecommendations);

router.post("/recommendations", authenticateUser, createRecommendation);
router.post(
  "/recommendations/generate",
  authenticateUser,
  generateEventRecommendations
);

// ============================================================================
// PLANNING AGENT ROUTES (Organizer)
// ============================================================================
router.post("/plan-event", authenticateUser, planEvent);
router.get("/planning/health", authenticateUser, checkPlanningAgentHealth);
router.get(
  "/planning/stats",
  authenticateUser,
  protectAdmin,
  getPlanningAgentStats
);

// ============================================================================
// BOOKING SUPPORT AGENT ROUTES
// ============================================================================

// Authenticated chat
router.post("/booking-support/chat", authenticateUser, chatBookingSupport);

// Anonymous chat (no token required — public-facing widget)
router.post("/booking-support/chat-anonymous", chatBookingSupport);

// Authenticated clear-history
router.post(
  "/booking-support/clear-history",
  authenticateUser,
  clearBookingSupportHistory
);

// Anonymous clear-history (session-based, no token required)
router.post(
  "/booking-support/clear-history-anonymous",
  clearBookingSupportHistoryAnonymous
);

router.get("/booking-support/health", checkBookingSupportHealth);
router.get(
  "/booking-support/stats",
  authenticateUser,
  protectAdmin,
  getBookingSupportStats
);

// ============================================================================
// EVENT REQUEST AI ROUTES
// Called internally by eventrequest.controller.js via AI_AGENT_URL
// ============================================================================

// POST /api/ai/process-event-request — called by eventrequest.controller → callAIAgent()
router.post("/process-event-request", processEventRequest);

// GET /api/ai/event-suggestions — called by eventrequest.controller → fetchAISuggestedOrganizers()
router.get("/event-suggestions", getEventSuggestions);

// ============================================================================
// AI NEGOTIATION ROUTES
// ============================================================================

router.post("/negotiations", authenticateUser, createNegotiation);
router.put("/negotiations/:id", authenticateUser, updateNegotiation);

// ============================================================================
// AI FRAUD CHECK ROUTES (Admin Only)
// ============================================================================

router.post(
  "/fraud-check/:bookingId",
  authenticateUser,
  protectAdmin,
  performFraudCheck
);

router.get("/fraud-check/booking/:id", authenticateUser, getBookingFraudRisk);

// ============================================================================
// AI SENTIMENT ANALYSIS ROUTES
// ============================================================================

router.post(
  "/sentiment-analysis/:reviewId",
  authenticateUser,
  protectAdmin,
  analyzeReviewSentiment
);

router.get(
  "/sentiment-analysis/event/:id",
  authenticateUser,
  getEventSentimentAnalysis
);

// ============================================================================
// REVIEW ROUTES (with AI integration)
// ============================================================================

router.post("/reviews", authenticateUser, createReview);
router.get("/reviews/event/:eventId", getEventReviews);
router.get("/reviews/me", authenticateUser, getUserReviews);

// ============================================================================
// BOOKING AI DATA ROUTES
// ============================================================================

router.get(
  "/bookings/:id/insights",
  authenticateUser,
  getBookingWithAIInsights
);
router.get("/bookings/:id/fraud-risk", authenticateUser, getBookingFraudRisk);

// ============================================================================
// AI ORGANIZER DASHBOARD ROUTES
// ============================================================================

router.get(
  "/dashboard/metrics/:id",
  authenticateUser,
  getOrganizerMetrics
);
router.get(
  "/dashboard/revenue/:id",
  authenticateUser,
  getOrganizerRevenue
);
router.get(
  "/dashboard/bookings/:id",
  authenticateUser,
  getOrganizerBookings
);
router.get(
  "/dashboard/trends/:id",
  authenticateUser,
  getOrganizerTrends
);
router.get(
  "/dashboard/sentiment/:id",
  authenticateUser,
  getOrganizerSentiment
);
router.get(
  "/dashboard/ratings/:id",
  authenticateUser,
  getOrganizerRatings
);
router.get(
  "/dashboard/events/:id",
  authenticateUser,
  getOrganizerEvents
);

// ============================================================================
// AI DASHBOARD (Admin Only) — must come AFTER /dashboard/:sub-routes
// ============================================================================

router.get("/dashboard", authenticateUser, protectAdmin, getAIDashboard);

export default router;
