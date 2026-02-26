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
  getMyRecommendations,
  checkAIHealth,
  chatBookingSupport,
  clearBookingSupportHistory,
  clearBookingSupportHistoryAnonymous,
  checkBookingSupportHealth,
  getBookingSupportStats,
  processEventRequest,
  getEventSuggestions,
  planEvent,
  checkPlanningAgentHealth,
  getPlanningAgentStats,
  getOrganizerMetrics,
  getOrganizerRevenue,
  getOrganizerBookings,
  getOrganizerTrends,
  getOrganizerSentiment,
  getOrganizerRatings,
  getOrganizerEvents,
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
router.get("/recommendations/me", authenticateUser, getAIRecommendedEvents);
router.post("/recommendations", authenticateUser, createRecommendation);
router.post(
  "/recommendations/generate",
  authenticateUser,
  generateEventRecommendations
);

// ============================================================================
// BOOKING SUPPORT AGENT ROUTES
// ============================================================================

// Authenticated chat
router.post("/booking-support/chat", authenticateUser, chatBookingSupport);

// Anonymous chat (no token required)
router.post("/booking-support/chat-anonymous", chatBookingSupport);

// Authenticated clear-history
router.post(
  "/booking-support/clear-history",
  authenticateUser,
  clearBookingSupportHistory
);

// Anonymous clear-history (no token required)
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
// These are called internally by eventrequest.controller.js via AI_AGENT_URL
// ============================================================================

router.post("/process-event-request", processEventRequest);
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

// ============================================================================
// AI ORGANIZER / PLANNER ROUTES
// ============================================================================

router.post("/organizer/plan-event", authenticateUser, planEvent);
router.get(
  "/organizer/planning/health",
  authenticateUser,
  checkPlanningAgentHealth
);
router.get(
  "/organizer/planning/stats",
  authenticateUser,
  getPlanningAgentStats
);

export default router;