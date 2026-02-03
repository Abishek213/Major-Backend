import AI_Agent from "../model/ai_agent.schema.js";
import AI_Recommendation from "../model/ai_recommendation.schema.js";
import AI_NegotiationLog from "../model/ai_negotiationLog.schema.js";
import AI_FeedbackSentiment from "../model/ai_feedbackSentiment.schema.js";
import AI_FraudCheck from "../model/ai_fraudCheck.schema.js";
import AI_ActionLog from "../model/ai_actionLog.schema.js";
import Review from "../model/review.schema.js";
import Booking from "../model/booking.schema.js";
import Event from "../model/event.schema.js";
import AIService from "../services/ai.service.js";

/**
 * ============================================================================
 * BACKEND AI CONTROLLER
 * ============================================================================
 * 
 * This controller acts as a proxy between Frontend and AI Agent Service
 * 
 * ARCHITECTURE:
 * Frontend → Backend (this controller) → AI Agent Service
 * 
 * RESPONSIBILITIES:
 * - Authentication & authorization
 * - Request validation
 * - Database operations
 * - Caching
 * - Error handling
 * - Logging
 * 
 * ============================================================================
 */

// ==================== AI AGENT MANAGEMENT ====================
export const createAgent = async (req, res) => {
  try {
    const agent = await AI_Agent.create(req.body);
    res.status(201).json({ success: true, data: agent });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const getAgents = async (req, res) => {
  try {
    const { type, status } = req.query;
    const filter = {};

    if (type) filter.agent_type = type;
    if (status) filter.status = status;

    const agents = await AI_Agent.find(filter)
      .populate("user_id", "fullname email")
      .sort({ createdAt: -1 });

    res.json({ success: true, count: agents.length, data: agents });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== AI RECOMMENDATIONS ====================
export const getUserRecommendations = async (req, res) => {
  const userId = req.user?.id || req.params.userId;

  try {
    const { limit = 10, refresh = false } = req.query;
    const parsedLimit = parseInt(limit);

    if (!userId) {
      return res
        .status(400)
        .json({ success: false, message: "User ID is required" });
    }

    console.log(`🤖 Getting recommendations for user: ${userId}`);

    let recommendations = [];
    let source = "cache";
    let message = "";

    // Check cache first
    if (refresh !== "true") {
      const cached = await AIService.getCachedRecommendations(
        userId,
        parsedLimit
      );
      if (cached.length > 0) {
        recommendations = cached;
        source = "cache";
        message = "Using cached recommendations";
      }
    }

    // Get from AI Agent if needed
    if (recommendations.length === 0 || refresh === "true") {
      try {
        const agent = await AIService.getRecommendationAgent();
        const aiRecommendations = await AIService.getAIRecommendations(
          userId,
          parsedLimit
        );

        if (aiRecommendations.length > 0) {
          recommendations = aiRecommendations;
          source = "ai_agent";
          message = "AI-generated recommendations";

          // Store in database
          await AIService.storeRecommendations(
            userId,
            recommendations,
            agent._id
          );

          // Log action
          await AI_ActionLog.create({
            agentId: agent._id,
            userId: userId,
            logType: "recommendation",
            actionDetails: {
              count: recommendations.length,
              source: "ai_agent",
            },
          });
        }
      } catch (aiError) {
        console.warn("AI Agent unavailable:", aiError.message);
        source = "fallback";
      }
    }

    // Fallback if needed
    if (recommendations.length === 0) {
      recommendations = await AIService.getFallbackRecommendations(
        userId,
        parsedLimit
      );
      source = "fallback";
      message = "Using fallback recommendations";
    }

    res.json({
      success: true,
      count: recommendations.length,
      source: source,
      message: message || "Recommendations generated successfully",
      data: recommendations,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Recommendation error:", error);

    // Emergency fallback
    const fallback = await AIService.getFallbackRecommendations(userId, 10);

    res.status(200).json({
      success: true,
      count: fallback.length,
      source: "emergency_fallback",
      message: "System recovered with fallback recommendations",
      data: fallback,
    });
  }
};

export const createRecommendation = async (req, res) => {
  try {
    const recommendation = await AI_Recommendation.create(req.body);

    await AI_ActionLog.create({
      agentId: req.body.agent_id,
      userId: req.body.user_id,
      logType: "recommendation",
      actionDetails: {
        eventId: req.body.event_id,
        confidenceScore: req.body.confidence_score,
      },
    });

    res.status(201).json({ success: true, data: recommendation });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const getMyRecommendations = async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 10 } = req.query;

    const recommendations = await AI_Recommendation.find({ user_id: userId })
      .populate(
        "event_id",
        "event_name description location price image event_date time category"
      )
      .populate("agent_id", "name role agent_type")
      .sort({ confidence_score: -1, createdAt: -1 })
      .limit(parseInt(limit));

    res.json({
      success: true,
      count: recommendations.length,
      data: recommendations,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== BOOKING SUPPORT CHAT ====================

/**
 * POST /api/ai/booking-support/chat
 * 
 * Main endpoint for booking support chatbot
 * Forwards chat requests to AI Agent Service
 * 
 * Request Body:
 * {
 *   message: string (required),
 *   userId: string (optional - from auth middleware),
 *   sessionId: string (optional - for anonymous users)
 * }
 */
export const chatBookingSupport = async (req, res) => {
  try {
    const { message } = req.body;
    const userId = req.user?.id || req.body.userId;
    const sessionId = req.body.sessionId;

    // Validation
    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Message is required and must be a non-empty string",
      });
    }

    console.log(`💬 Booking support chat from ${userId || sessionId || "anonymous"}`);

    // Forward to AI Agent Service
    const response = await AIService.chatBookingSupport({
      message,
      userId: userId || sessionId,
      sessionId,
    });

    // Return AI response
    res.json(response);

  } catch (error) {
    console.error("Booking support chat error:", error);

    // Fallback response
    res.status(500).json({
      success: false,
      message: "Sorry, I'm experiencing technical difficulties. Please try again or contact support@eventa.com",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
      timestamp: new Date().toISOString(),
    });
  }
};

/**
 * POST /api/ai/booking-support/clear-history
 * 
 * Clear conversation history for a user
 */
export const clearBookingSupportHistory = async (req, res) => {
  try {
    const userId = req.user?.id || req.body.userId;
    const sessionId = req.body.sessionId;

    if (!userId && !sessionId) {
      return res.status(400).json({
        success: false,
        message: "userId or sessionId is required",
      });
    }

    console.log(`🗑️ Clearing history for ${userId || sessionId}`);

    // Forward to AI Agent Service
    const response = await AIService.clearBookingSupportHistory({
      userId: userId || sessionId,
      sessionId,
    });

    res.json(response);

  } catch (error) {
    console.error("Clear history error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to clear conversation history",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * GET /api/ai/booking-support/health
 * 
 * Check booking support agent health
 */
export const checkBookingSupportHealth = async (req, res) => {
  try {
    const health = await AIService.checkBookingSupportHealth();
    
    const statusCode = health.status === "ready" ? 200 : 503;
    res.status(statusCode).json(health);

  } catch (error) {
    console.error("Booking support health check error:", error);
    res.status(503).json({
      success: false,
      status: "error",
      message: "Failed to check booking support agent health",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * GET /api/ai/booking-support/stats
 * 
 * Get booking support agent statistics
 */
export const getBookingSupportStats = async (req, res) => {
  try {
    const stats = await AIService.getBookingSupportStats();
    res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error("Booking support stats error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get booking support statistics",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// ==================== AI NEGOTIATIONS ====================
export const createNegotiation = async (req, res) => {
  try {
    const negotiation = await AI_NegotiationLog.create(req.body);

    await AI_ActionLog.create({
      agentId: req.body.agent_id,
      logType: "negotiation",
      actionDetails: {
        negotiationId: negotiation._id,
        bookingId: req.body.booking_id,
        type: req.body.negotiation_type,
      },
    });

    res.status(201).json({ success: true, data: negotiation });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const updateNegotiation = async (req, res) => {
  try {
    const { id } = req.params;
    const negotiation = await AI_NegotiationLog.findByIdAndUpdate(
      id,
      req.body,
      {
        new: true,
        runValidators: true,
      }
    );

    if (!negotiation) {
      return res
        .status(404)
        .json({ success: false, message: "Negotiation not found" });
    }

    res.json({ success: true, data: negotiation });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// ==================== AI FRAUD CHECK ====================
export const performFraudCheck = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const booking = await Booking.findById(bookingId);

    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: "Booking not found" });
    }

    // Get fraud detection agent
    const fraudAgent = await AI_Agent.findOne({
      agent_type: "admin",
      role: "moderator",
      status: "active",
    });

    if (!fraudAgent) {
      return res.status(404).json({
        success: false,
        message: "No active fraud detection agent found",
      });
    }

    // Calculate risk score (simplified for Phase 1)
    const riskScore = calculateRiskScore(booking);

    // FIXED: Corrected fraud status logic (check higher threshold first)
    const fraudCheck = await AI_FraudCheck.create({
      agentId: fraudAgent._id,
      bookingId: bookingId,
      riskScore: riskScore,
      fraudStatus:
        riskScore > 0.9
          ? "fraudulent"
          : riskScore > 0.7
          ? "suspicious"
          : "clean",
      checkVersion: "1.0",
    });

    // Log the action
    await AI_ActionLog.create({
      agentId: fraudAgent._id,
      userId: booking.userId,
      logType: "fraud_check",
      actionDetails: {
        bookingId: bookingId,
        riskScore: riskScore,
        status: fraudCheck.fraudStatus,
      },
    });

    res.status(201).json({ success: true, data: fraudCheck });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== AI SENTIMENT ANALYSIS ====================
export const analyzeReviewSentiment = async (req, res) => {
  try {
    const { reviewId } = req.params;
    const review = await Review.findById(reviewId)
      .populate("userId", "fullname")
      .populate("eventId", "event_name");

    if (!review) {
      return res
        .status(404)
        .json({ success: false, message: "Review not found" });
    }

    // Get sentiment analysis agent
    const sentimentAgent = await AI_Agent.findOne({
      agent_type: "admin",
      role: "analyst",
      status: "active",
    });

    if (!sentimentAgent) {
      return res.status(404).json({
        success: false,
        message: "No active sentiment analysis agent found",
      });
    }

    // Analyze sentiment (simplified for Phase 1)
    const sentimentScore = analyzeSentiment(review.comment);
    const detectedIssues = detectIssues(review.comment);

    const sentimentAnalysis = await AI_FeedbackSentiment.create({
      review_id: reviewId,
      agent_id: sentimentAgent._id,
      sentiment_score: sentimentScore,
      detected_issues: detectedIssues,
    });

    // Log the action
    await AI_ActionLog.create({
      agentId: sentimentAgent._id,
      userId: review.userId,
      logType: "sentiment_analysis",
      actionDetails: {
        reviewId: reviewId,
        sentimentScore: sentimentScore,
        issues: detectedIssues,
      },
    });

    res.status(201).json({ success: true, data: sentimentAnalysis });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== AI DASHBOARD ====================
export const getAIDashboard = async (req, res) => {
  try {
    const [
      totalAgents,
      activeAgents,
      totalRecommendations,
      successfulNegotiations,
      fraudChecks,
      sentimentAnalyses,
    ] = await Promise.all([
      AI_Agent.countDocuments(),
      AI_Agent.countDocuments({ status: "active" }),
      AI_Recommendation.countDocuments(),
      AI_NegotiationLog.countDocuments({ status: "accepted" }),
      AI_FraudCheck.countDocuments(),
      AI_FeedbackSentiment.countDocuments(),
    ]);

    // Get recent AI activities
    const recentActivities = await AI_ActionLog.find()
      .populate("agentId", "name role")
      .populate("userId", "fullname")
      .sort({ createdAt: -1 })
      .limit(10);

    res.json({
      success: true,
      data: {
        stats: {
          totalAgents,
          activeAgents,
          totalRecommendations,
          successfulNegotiations,
          fraudChecks,
          sentimentAnalyses,
        },
        recentActivities,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== HEALTH CHECK ====================
export const checkAIHealth = async (req, res) => {
  try {
    const aiHealth = await AIService.checkAIHealth();

    const [activeAgents, recentRecommendations] = await Promise.all([
      AI_Agent.countDocuments({ status: "active" }),
      AI_Recommendation.countDocuments({
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      }),
    ]);

    res.json({
      success: true,
      data: {
        service: "AI Recommendation System",
        status: "operational",
        timestamp: new Date().toISOString(),
        components: {
          ai_agent_service: aiHealth,
          active_agents: activeAgents,
          recommendations_last_24h: recentRecommendations,
        },
        version: "1.0.0",
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      status: "degraded",
      message: error.message,
    });
  }
};

// ==================== HELPER FUNCTIONS ====================
function calculateRiskScore(booking) {
  let risk = 0.1;
  if (booking.total > 1000) risk += 0.3;
  if (booking.total > 5000) risk += 0.3;
  return Math.min(risk, 1);
}

function analyzeSentiment(comment) {
  const positiveWords = ["great", "good", "excellent", "amazing", "wonderful"];
  const negativeWords = ["bad", "terrible", "poor", "disappointing", "awful"];

  let score = 0;
  const words = comment?.toLowerCase().split(" ") || [];

  positiveWords.forEach((word) => {
    if (words.includes(word)) score += 0.2;
  });

  negativeWords.forEach((word) => {
    if (words.includes(word)) score -= 0.2;
  });

  return Math.max(-1, Math.min(1, score));
}

function detectIssues(comment) {
  const issues = [];
  const issueKeywords = {
    parking: ["parking", "car", "park"],
    food: ["food", "drink", "beverage"],
    seating: ["seat", "sitting", "chair"],
    sound: ["sound", "audio", "music"],
    price: ["expensive", "price", "cost"],
  };

  const lowerComment = comment?.toLowerCase() || "";

  Object.keys(issueKeywords).forEach((issue) => {
    issueKeywords[issue].forEach((keyword) => {
      if (lowerComment.includes(keyword)) {
        issues.push(issue);
        return;
      }
    });
  });

  return [...new Set(issues)];
}

export default {
  createAgent,
  getAgents,
  getUserRecommendations,
  createRecommendation,
  getMyRecommendations,
  createNegotiation,
  updateNegotiation,
  performFraudCheck,
  analyzeReviewSentiment,
  getAIDashboard,
  checkAIHealth,
  chatBookingSupport,
  clearBookingSupportHistory,
  checkBookingSupportHealth,
  getBookingSupportStats,
};