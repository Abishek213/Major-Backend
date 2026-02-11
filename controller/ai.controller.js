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

// ======================================================
// ===================== User Ai Agent ==================
// ======================================================

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
export const chatBookingSupport = async (req, res) => {
  try {
    const { message } = req.body;
    const userId = req.user?.id || req.body.userId;
    const sessionId = req.body.sessionId;

    // Validation
    if (
      !message ||
      typeof message !== "string" ||
      message.trim().length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Message is required and must be a non-empty string",
      });
    }

    console.log(
      `💬 Booking support chat from ${userId || sessionId || "anonymous"}`
    );

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
      message:
        "Sorry, I'm experiencing technical difficulties. Please try again or contact support@eventa.com",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
      timestamp: new Date().toISOString(),
    });
  }
};

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

// ======================================================
// ===================== Org Ai Agent ===================
// ======================================================

// ==================== EVENT PLANNING ====================
/**
 * POST /api/ai/organizer/plan-event
 *
 * Create comprehensive event plan using AI Planning Agent
 *
 * Request Body:
 * {
 *   eventType: string (required) - conference, workshop, wedding, birthday, concert, festival
 *   budget: number (required) - Total budget in NPR
 *   attendees: number (required) - Expected number of attendees
 *   location: string (required) - Event location
 *   eventDate: string (required) - Event date (ISO format)
 * }
 *
 * Response:
 * {
 *   success: true,
 *   data: {
 *     plan: { ... },
 *     processing_time: number,
 *     agent_info: { ... }
 *   }
 * }
 */
export const planEvent = async (req, res) => {
  const startTime = Date.now();

  try {
    const { eventType, budget, attendees, location, eventDate } = req.body;
    const organizerId = req.user?.id; // From auth middleware

    // Validation
    if (!eventType || !budget || !attendees || !location || !eventDate) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: eventType, budget, attendees, location, eventDate",
      });
    }

    // Validate event type
    const validEventTypes = [
      "conference",
      "workshop",
      "wedding",
      "birthday",
      "concert",
      "festival",
    ];
    if (!validEventTypes.includes(eventType.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: `Invalid event type. Must be one of: ${validEventTypes.join(
          ", "
        )}`,
      });
    }

    // Validate numbers
    if (budget <= 0 || attendees <= 0) {
      return res.status(400).json({
        success: false,
        message: "Budget and attendees must be positive numbers",
      });
    }

    // Validate date
    const eventDateObj = new Date(eventDate);
    if (isNaN(eventDateObj.getTime()) || eventDateObj < new Date()) {
      return res.status(400).json({
        success: false,
        message: "Event date must be a valid future date",
      });
    }

    console.log(
      `📋 Planning ${eventType} event for organizer: ${
        organizerId || "anonymous"
      }`
    );

    // Get or create planning agent in database
    let planningAgent = await AI_Agent.findOne({
      name: "planning-agent",
      agent_type: "organizer",
    });

    if (!planningAgent) {
      planningAgent = await AI_Agent.create({
        name: "planning-agent",
        role: "assistant",
        agent_type: "organizer",
        status: "active",
        capabilities: {
          event_planning: true,
          budget_optimization: true,
          timeline_generation: true,
          vendor_recommendations: true,
          risk_assessment: true,
        },
      });
      console.log("✅ Planning agent registered in database");
    }

    // Forward to AI Agent Service
    const planningResult = await AIService.planEvent({
      eventType: eventType.toLowerCase(),
      budget: parseFloat(budget),
      attendees: parseInt(attendees),
      location,
      eventDate,
      organizerId,
    });

    const processingTime = Date.now() - startTime;

    // Check if planning was successful
    if (!planningResult.success) {
      // Log failed attempt
      await AI_ActionLog.create({
        agentId: planningAgent._id,
        userId: organizerId || null,
        logType: "event_planning",
        actionDetails: {
          eventType,
          budget,
          attendees,
          location,
          error: planningResult.error || planningResult.message,
        },
        success: false,
        failureType: "api_error",
      });

      return res.status(500).json({
        success: false,
        message: planningResult.error || "Failed to create event plan",
        details: planningResult.message,
        timestamp: new Date().toISOString(),
      });
    }

    // Log successful action
    await AI_ActionLog.create({
      agentId: planningAgent._id,
      userId: organizerId || null,
      logType: "event_planning",
      actionDetails: {
        eventType,
        budget,
        attendees,
        location,
        plan_generated: true,
        llm_enhanced: planningResult.plan?.metadata?.llm_enhanced || false,
        processing_time: processingTime,
      },
      success: true,
    });

    // Return successful response
    res.status(200).json({
      success: true,
      message: "Event plan generated successfully",
      data: {
        plan: planningResult.plan,
        processing_time: processingTime,
        agent_info: {
          agent_id: planningAgent._id,
          agent_name: planningAgent.name,
          llm_enhanced: planningResult.plan?.metadata?.llm_enhanced || false,
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error("❌ Event planning error:", error);

    // Try to log error if possible
    try {
      const agent = await AI_Agent.findOne({ name: "planning-agent" });
      if (agent) {
        await AI_ActionLog.create({
          agentId: agent._id,
          userId: req.user?.id || null,
          logType: "event_planning",
          actionDetails: {
            error: error.message,
            processing_time: processingTime,
          },
          success: false,
          failureType: "api_error",
        });
      }
    } catch (logError) {
      console.error("Failed to log error:", logError);
    }

    // Return error response
    res.status(500).json({
      success: false,
      message: "Failed to generate event plan",
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : "Internal server error",
      timestamp: new Date().toISOString(),
    });
  }
};

/**
 * GET /api/ai/organizer/planning-agent/health
 *
 * Check planning agent health and capabilities
 */
export const checkPlanningAgentHealth = async (req, res) => {
  try {
    const health = await AIService.checkPlanningAgentHealth();

    const statusCode = health.status === "active" ? 200 : 503;
    res.status(statusCode).json({
      success: health.status === "active",
      ...health,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Planning agent health check error:", error);
    res.status(503).json({
      success: false,
      status: "error",
      message: "Failed to check planning agent health",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
      timestamp: new Date().toISOString(),
    });
  }
};

/**
 * GET /api/ai/organizer/planning-agent/stats
 *
 * Get planning agent statistics
 */
export const getPlanningAgentStats = async (req, res) => {
  try {
    const organizerId = req.user?.id;
    const { timeRange = "30d" } = req.query;

    // Calculate date range
    const daysBack = timeRange === "7d" ? 7 : timeRange === "90d" ? 90 : 30;
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - daysBack);

    // Get planning agent
    const agent = await AI_Agent.findOne({ name: "planning-agent" });

    if (!agent) {
      return res.status(404).json({
        success: false,
        message: "Planning agent not found",
      });
    }

    // Build query filter
    const filter = {
      agentId: agent._id,
      logType: "event_planning",
      createdAt: { $gte: dateFrom },
    };

    // Add user filter if organizer is requesting their own stats
    if (organizerId) {
      filter.userId = organizerId;
    }

    // Get stats
    const [totalPlans, successfulPlans, failedPlans, recentLogs] =
      await Promise.all([
        AI_ActionLog.countDocuments(filter),
        AI_ActionLog.countDocuments({ ...filter, success: true }),
        AI_ActionLog.countDocuments({ ...filter, success: false }),
        AI_ActionLog.find(filter)
          .sort({ createdAt: -1 })
          .limit(10)
          .select("actionDetails success createdAt"),
      ]);

    // Calculate average processing time
    const logsWithTime = recentLogs.filter(
      (log) => log.actionDetails?.processing_time
    );
    const avgProcessingTime =
      logsWithTime.length > 0
        ? logsWithTime.reduce(
            (sum, log) => sum + log.actionDetails.processing_time,
            0
          ) / logsWithTime.length
        : 0;

    // Get event type distribution
    const eventTypeStats = await AI_ActionLog.aggregate([
      { $match: { ...filter, success: true } },
      {
        $group: {
          _id: "$actionDetails.eventType",
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]);

    res.json({
      success: true,
      data: {
        summary: {
          total_plans: totalPlans,
          successful: successfulPlans,
          failed: failedPlans,
          success_rate:
            totalPlans > 0
              ? ((successfulPlans / totalPlans) * 100).toFixed(1)
              : 0,
          avg_processing_time_ms: Math.round(avgProcessingTime),
        },
        event_types: eventTypeStats.map((stat) => ({
          type: stat._id,
          count: stat.count,
        })),
        recent_activity: recentLogs.map((log) => ({
          event_type: log.actionDetails?.eventType,
          budget: log.actionDetails?.budget,
          attendees: log.actionDetails?.attendees,
          success: log.success,
          created_at: log.createdAt,
        })),
        time_range: timeRange,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Planning agent stats error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get planning agent statistics",
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

// ======================================================
// ===================== Admin Ai Agent =================
// ======================================================

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
  planEvent,
  checkPlanningAgentHealth,
  getPlanningAgentStats,
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
