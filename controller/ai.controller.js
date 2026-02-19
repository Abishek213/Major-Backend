import AI_Agent from "../model/ai_agent.schema.js";
import AI_Recommendation from "../model/ai_recommendation.schema.js";
import AI_NegotiationLog from "../model/ai_negotiationLog.schema.js";
import AI_FeedbackSentiment from "../model/ai_feedbackSentiment.schema.js";
import AI_FraudCheck from "../model/ai_fraudCheck.schema.js";
import AI_ActionLog from "../model/ai_actionLog.schema.js";
import Review from "../model/review.schema.js";
import Booking from "../model/booking.schema.js";
import Event from "../model/event.schema.js";
import Category from "../model/categories.schema.js";
import AIService from "../services/ai.service.js";
import User from "../model/user.schema.js";

import asyncHandler from "../utils/asyncHandler.js";
import { sendSuccess, sendError } from "../utils/response.js";
import {
  calculateRiskScore,
  analyzeSentiment,
  detectIssues,
} from "../utils/aiHelpers.js";

// ==================== AI AGENT MANAGEMENT ====================
export const createAgent = asyncHandler(async (req, res) => {
  const agent = await AI_Agent.create(req.body);
  sendSuccess(res, { data: agent }, 201);
});

export const getAgents = asyncHandler(async (req, res) => {
  const { type, status } = req.query;
  const filter = {};
  if (type) filter.agent_type = type;
  if (status) filter.status = status;

  const agents = await AI_Agent.find(filter)
    .populate("user_id", "fullname email")
    .sort({ createdAt: -1 });

  sendSuccess(res, { count: agents.length, data: agents });
});

// ==================== AI RECOMMENDATIONS ====================
export const getUserRecommendations = asyncHandler(async (req, res) => {
  // Note: This function always returns 200 with fallback data, even on DB errors.
  // We preserve that behavior by catching any error and sending fallback.
  try {
    const userId = req.user?.id || req.params.userId;
    const { limit = 10, refresh = false } = req.query;
    const parsedLimit = parseInt(limit);

    if (!userId) {
      return sendError(res, new Error("User ID is required"), 400);
    }

    console.log(`🤖 Getting recommendations for user: ${userId}`);

    let recommendations = [];
    let source = "cache";
    let message = "";

    // Try cache first
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

    // If no cache or refresh, call AI Agent
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

          await AIService.storeRecommendations(
            userId,
            recommendations,
            agent._id
          );
          await AI_ActionLog.create({
            agentId: agent._id,
            userId,
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

    // Final fallback
    if (recommendations.length === 0) {
      recommendations = await AIService.getFallbackRecommendations(
        userId,
        parsedLimit
      );
      source = "fallback";
      message = "Using fallback recommendations";
    }

    sendSuccess(res, {
      count: recommendations.length,
      source,
      message: message || "Recommendations generated successfully",
      data: recommendations,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    // If any unexpected error occurs (e.g., DB error), return fallback recommendations
    console.error("Unexpected error in getUserRecommendations:", error);
    const fallback = await AIService.getFallbackRecommendations(
      req.user?.id || req.params.userId,
      10
    );
    sendSuccess(res, {
      count: fallback.length,
      source: "emergency_fallback",
      message: "System recovered with fallback recommendations",
      data: fallback,
      timestamp: new Date().toISOString(),
    });
  }
});

export const createRecommendation = asyncHandler(async (req, res) => {
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

  sendSuccess(res, { data: recommendation }, 201);
});

export const getMyRecommendations = asyncHandler(async (req, res) => {
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

  sendSuccess(res, { count: recommendations.length, data: recommendations });
});

// ==================== BOOKING SUPPORT CHAT ====================
export const chatBookingSupport = asyncHandler(async (req, res) => {
  try {
    const { message } = req.body;
    const userId = req.user?.id || req.body.userId;
    const sessionId = req.body.sessionId;

    if (
      !message ||
      typeof message !== "string" ||
      message.trim().length === 0
    ) {
      return sendError(
        res,
        new Error("Message is required and must be a non-empty string"),
        400
      );
    }

    console.log(
      `💬 Booking support chat from ${userId || sessionId || "anonymous"}`
    );

    const response = await AIService.chatBookingSupport({
      message,
      userId,
      sessionId,
    });
    sendSuccess(res, response);
  } catch (error) {
    // Preserve original custom error message
    console.error("Booking support chat error:", error);
    sendError(
      res,
      new Error(
        "Sorry, I'm experiencing technical difficulties. Please try again or contact support@eventa.com"
      ),
      500,
      {
        error:
          process.env.NODE_ENV === "development" ? error.message : undefined,
        timestamp: new Date().toISOString(),
      }
    );
  }
});

export const clearBookingSupportHistory = asyncHandler(async (req, res) => {
  try {
    const userId = req.user?.id || req.body.userId;
    const sessionId = req.body.sessionId;

    if (!userId && !sessionId) {
      return sendError(res, new Error("userId or sessionId is required"), 400);
    }

    console.log(`🗑️ Clearing history for ${userId || sessionId}`);

    const response = await AIService.clearBookingSupportHistory({
      userId,
      sessionId,
    });
    sendSuccess(res, response);
  } catch (error) {
    console.error("Clear history error:", error);
    sendError(res, new Error("Failed to clear conversation history"), 500, {
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

export const checkBookingSupportHealth = asyncHandler(async (req, res) => {
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
});

export const getBookingSupportStats = asyncHandler(async (req, res) => {
  try {
    const stats = await AIService.getBookingSupportStats();
    sendSuccess(res, { data: stats, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error("Booking support stats error:", error);
    sendError(res, new Error("Failed to get booking support statistics"), 500, {
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ==================== EVENT PLANNING ====================
export const planEvent = asyncHandler(async (req, res) => {
  const startTime = Date.now();
  const body = req.body;
  const organizerId = req.user?.id;

  const isLegacyFormat = !body.event_name && body.eventType && body.attendees;
  let eventData;

  if (isLegacyFormat) {
    console.warn(
      "⚠️ Legacy planEvent format used. Please migrate to new format."
    );
    const { eventType, budget, attendees, location, eventDate } = body;

    if (!eventType || !attendees || !location || !eventDate) {
      return sendError(
        res,
        new Error(
          "Missing required fields: eventType, attendees, location, eventDate"
        ),
        400
      );
    }

    let categoryId = null;
    let categoryName = null; // ✅ ADD: Store category name

    const categoryDoc = await Category.findOne({
      categoryName: { $regex: new RegExp(`^${eventType}$`, "i") },
    });

    if (categoryDoc) {
      categoryId = categoryDoc._id;
      categoryName = categoryDoc.categoryName; // ✅ ADD: Get name
    } else {
      const capitalizedType =
        eventType.charAt(0).toUpperCase() + eventType.slice(1);
      const newCategory = await Category.create({
        categoryName: capitalizedType,
        isActive: true,
      });
      categoryId = newCategory._id;
      categoryName = newCategory.categoryName; // ✅ ADD: Get name
    }

    eventData = {
      event_name: `${eventType} in ${location}`,
      description: `A ${eventType} event organized in ${location}.`,
      category: categoryName, // ✅ FIXED: Use string name for AI Agent
      categoryId: categoryId, // ✅ ADD: Keep ObjectId for logging
      location,
      totalSlots: parseInt(attendees),
      event_date: eventDate,
      time: "10:00",
      price: 0,
      tags: [],
      isPublic: true,
    };
  } else {
    const {
      event_name,
      category,
      location,
      totalSlots,
      event_date,
      description,
      time,
      price,
      tags,
      isPublic,
    } = body;
    if (!event_name || !category || !location || !totalSlots || !event_date) {
      return sendError(
        res,
        new Error(
          "Missing required fields: event_name, category, location, totalSlots, event_date"
        ),
        400
      );
    }

    const categoryExists = await Category.findById(category);
    if (!categoryExists) {
      return sendError(res, new Error("Invalid category ID"), 400);
    }

    eventData = {
      event_name,
      description: description || `${event_name} event`,
      category,
      location,
      totalSlots: parseInt(totalSlots),
      event_date,
      time: time || "10:00",
      price: price || 0,
      tags: tags || [],
      isPublic: isPublic !== undefined ? isPublic : true,
    };
  }

  const result = await AIService.getPlanningSuggestions(eventData);
  const processingTime = Date.now() - startTime;

  const agent = await AI_Agent.findOne({
    name: "planning-agent",
    agent_type: "organizer",
  });
  const agentId = agent?._id || null;

  if (!result.success) {
    await AI_ActionLog.create({
      agentId,
      userId: organizerId || null,
      logType: "event_planning",
      actionDetails: { ...eventData, error: result.error },
      success: false,
      failureType: "api_error",
    });
    return sendError(
      res,
      new Error(result.error || "Failed to generate event plan"),
      500
    );
  }

  await AI_ActionLog.create({
    agentId,
    userId: organizerId || null,
    logType: "event_planning",
    actionDetails: {
      eventName: eventData.event_name,
      category: eventData.category,
      location: eventData.location,
      totalSlots: eventData.totalSlots,
      suggestedPrice: result.data.suggestions.price.suggestedPrice,
      processing_time: processingTime,
    },
    success: true,
  });

  sendSuccess(res, {
    message: "Event plan generated successfully",
    data: {
      plan: {
        status: "optimized",
        phase: "3.0",
        timeline: result.data.suggestions.dateTime.suggestedDayOfWeek,
        budget: {
          suggested: result.data.suggestions.price.suggestedPrice,
          range: result.data.suggestions.price.priceRange,
        },
        tags: result.data.suggestions.tags.suggestedTags,
        totalSlots: result.data.suggestions.totalSlots.suggestedSlots,
        recommendations: result.data.recommendations,
        confidence: result.data.confidence.overall,
      },
      fullSuggestions: result.data,
      processing_time: processingTime,
      agent_info: {
        agent_id: agentId,
        agent_name: "planning-agent",
      },
    },
    timestamp: new Date().toISOString(),
  });
});

export const getEventPlanningSuggestions = asyncHandler(async (req, res) => {
  const organizerId = req.user?.id;
  const eventData = req.body;

  if (
    !eventData.event_name ||
    !eventData.category ||
    !eventData.location ||
    !eventData.totalSlots ||
    !eventData.event_date
  ) {
    return sendError(
      res,
      new Error(
        "Missing required fields: event_name, category, location, totalSlots, event_date"
      ),
      400
    );
  }

  const categoryExists = await Category.findById(eventData.category);
  if (!categoryExists) {
    return sendError(res, new Error("Invalid category ID"), 400);
  }

  const result = await AIService.getPlanningSuggestions(eventData);

  if (!result.success) {
    return sendError(
      res,
      new Error(result.error || "Failed to generate planning suggestions"),
      500
    );
  }

  const agent = await AI_Agent.findOne({
    name: "planning-agent",
    agent_type: "organizer",
  });
  if (agent) {
    await AI_ActionLog.create({
      agentId: agent._id,
      userId: organizerId || null,
      logType: "event_planning",
      actionDetails: {
        eventName: eventData.event_name,
        category: eventData.category,
        location: eventData.location,
        totalSlots: eventData.totalSlots,
        source: "dedicated_endpoint",
      },
      success: true,
    });
  }

  sendSuccess(res, { data: result.data, timestamp: new Date().toISOString() });
});

export const checkPlanningAgentHealth = asyncHandler(async (req, res) => {
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
});

export const getPlanningAgentStats = asyncHandler(async (req, res) => {
  try {
    const organizerId = req.user?.id;
    const { timeRange = "30d" } = req.query;

    const daysBack = timeRange === "7d" ? 7 : timeRange === "90d" ? 90 : 30;
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - daysBack);

    // ✅ FIX: Auto-create agent if not found instead of throwing error
    let agent = await AI_Agent.findOne({
      $or: [
        { name: "planning-agent" },
        { name: "planningAgent" },
        { name: "Event Planning Agent" },
        { role: "planner", agent_type: "organizer" },
      ],
    });

    // Auto-create if doesn't exist (prevents "Planning agent not found" error)
    if (!agent) {
      console.log("⚠️ Planning agent not found in database, creating...");
      agent = await AI_Agent.create({
        name: "planning-agent",
        role: "planner",
        capabilities: {
          price_optimization: true,
          tag_recommendation: true,
          slot_suggestion: true,
          datetime_optimization: true,
          deadline_validation: true,
        },
        status: "active",
        agent_type: "organizer",
        user_id: null,
      });
      console.log("✅ Planning agent created:", agent._id);
    }

    // Build filter for action logs
    const filter = {
      agentId: agent._id,
      logType: "event_planning",
      createdAt: { $gte: dateFrom },
    };
    if (organizerId) filter.userId = organizerId;

    // Query all stats in parallel
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

    // Aggregate event types
    const eventTypeStats = await AI_ActionLog.aggregate([
      { $match: { ...filter, success: true } },
      { $group: { _id: "$actionDetails.eventType", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    // Format response
    sendSuccess(res, {
      data: {
        agent: {
          id: agent._id,
          name: agent.name,
          status: agent.status,
          type: agent.agent_type,
          role: agent.role,
        },
        summary: {
          total_plans: totalPlans,
          successful: successfulPlans,
          failed: failedPlans,
          success_rate:
            totalPlans > 0
              ? ((successfulPlans / totalPlans) * 100).toFixed(1)
              : "0.0",
          avg_processing_time_ms: Math.round(avgProcessingTime),
          time_range: timeRange,
          period_start: dateFrom.toISOString(),
          period_end: new Date().toISOString(),
        },
        event_types: eventTypeStats.map((stat) => ({
          type: stat._id || "unknown",
          count: stat.count,
        })),
        recent_activity: recentLogs.map((log) => ({
          event_name: log.actionDetails?.eventName || "Unknown",
          event_type:
            log.actionDetails?.eventType ||
            log.actionDetails?.category ||
            "unknown",
          category: log.actionDetails?.category,
          location: log.actionDetails?.location,
          total_slots: log.actionDetails?.totalSlots,
          suggested_price: log.actionDetails?.suggestedPrice,
          processing_time: log.actionDetails?.processing_time || 0,
          success: log.success,
          created_at: log.createdAt,
        })),
        metadata: {
          total_logs_analyzed: recentLogs.length,
          has_processing_times: logsWithTime.length,
          unique_event_types: eventTypeStats.length,
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Planning agent stats error:", error);
    sendError(res, new Error("Failed to get planning agent statistics"), 500, {
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

// ==================== AI NEGOTIATIONS ====================
export const createNegotiation = asyncHandler(async (req, res) => {
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

  sendSuccess(res, { data: negotiation }, 201);
});

export const updateNegotiation = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const negotiation = await AI_NegotiationLog.findByIdAndUpdate(id, req.body, {
    new: true,
    runValidators: true,
  });

  if (!negotiation) {
    return sendError(res, new Error("Negotiation not found"), 404);
  }

  sendSuccess(res, { data: negotiation });
});

// ==================== ORGANIZER DASHBOARD ASSISTANT ====================
export const getOrganizerDashboardMetrics = asyncHandler(async (req, res) => {
  const { organizerId } = req.params;
  const { dateRange, startDate, endDate, status } = req.query;

  // Validate organizer exists and has organizer role
  const organizer = await User.findById(organizerId).populate("role");
  if (!organizer) {
    return sendError(res, new Error("Organizer not found"), 404);
  }

  if (organizer.role?.role_Name !== "Organizer") {
    return sendError(res, new Error("User is not an organizer"), 403);
  }

  // Build date filter
  const dateFilter = buildDateFilter({ dateRange, startDate, endDate });

  try {
    // Run all queries in parallel
    const [
      eventMetrics,
      revenueMetrics,
      bookingMetrics,
      ratingMetrics,
      sentimentMetrics,
      trendsMetrics,
    ] = await Promise.all([
      getEventMetrics(organizerId, dateFilter, status),
      getRevenueMetrics(organizerId, dateFilter),
      getBookingMetrics(organizerId, dateFilter),
      getRatingMetrics(organizerId, dateFilter),
      getSentimentMetrics(organizerId, dateFilter),
      getTrendsMetrics(organizerId, dateFilter),
    ]);

    const dashboardData = {
      organizerId,
      dateRange: dateRange || "all_time",
      generatedAt: new Date().toISOString(),
      events: eventMetrics,
      revenue: revenueMetrics,
      bookings: bookingMetrics,
      ratings: ratingMetrics,
      sentiment: sentimentMetrics,
      trends: trendsMetrics,
    };

    // Log dashboard access
    const dashboardAgent = await AI_Agent.findOne({
      agent_type: "organizer",
      role: "assistant",
      status: "active",
    });

    if (dashboardAgent) {
      await AI_ActionLog.create({
        agentId: dashboardAgent._id,
        userId: organizerId,
        logType: "dashboard_query",
        actionDetails: {
          dateRange: dateRange || "all_time",
          metricsRequested: Object.keys(dashboardData),
        },
        success: true,
      });
    }

    sendSuccess(res, {
      data: dashboardData,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Dashboard metrics error:", error);
    sendError(res, new Error("Failed to generate dashboard metrics"), 500, {
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

export const getOrganizerEventMetrics = asyncHandler(async (req, res) => {
  const { organizerId } = req.params;
  const { dateRange, startDate, endDate, status } = req.query;

  const dateFilter = buildDateFilter({ dateRange, startDate, endDate });
  const eventMetrics = await getEventMetrics(organizerId, dateFilter, status);

  sendSuccess(res, {
    data: eventMetrics,
    timestamp: new Date().toISOString(),
  });
});

export const getOrganizerRevenueMetrics = asyncHandler(async (req, res) => {
  const { organizerId } = req.params;
  const { dateRange, startDate, endDate } = req.query;

  const dateFilter = buildDateFilter({ dateRange, startDate, endDate });
  const revenueMetrics = await getRevenueMetrics(organizerId, dateFilter);

  sendSuccess(res, {
    data: revenueMetrics,
    timestamp: new Date().toISOString(),
  });
});

export const getOrganizerBookingMetrics = asyncHandler(async (req, res) => {
  const { organizerId } = req.params;
  const { dateRange, startDate, endDate } = req.query;

  const dateFilter = buildDateFilter({ dateRange, startDate, endDate });
  const bookingMetrics = await getBookingMetrics(organizerId, dateFilter);

  sendSuccess(res, {
    data: bookingMetrics,
    timestamp: new Date().toISOString(),
  });
});

export const getOrganizerRatingMetrics = asyncHandler(async (req, res) => {
  const { organizerId } = req.params;
  const { dateRange, startDate, endDate } = req.query;

  const dateFilter = buildDateFilter({ dateRange, startDate, endDate });
  const ratingMetrics = await getRatingMetrics(organizerId, dateFilter);

  sendSuccess(res, {
    data: ratingMetrics,
    timestamp: new Date().toISOString(),
  });
});

export const getOrganizerSentimentMetrics = asyncHandler(async (req, res) => {
  const { organizerId } = req.params;
  const { dateRange, startDate, endDate } = req.query;

  const dateFilter = buildDateFilter({ dateRange, startDate, endDate });
  const sentimentMetrics = await getSentimentMetrics(organizerId, dateFilter);

  sendSuccess(res, {
    data: sentimentMetrics,
    timestamp: new Date().toISOString(),
  });
});

export const getOrganizerTrendsMetrics = asyncHandler(async (req, res) => {
  const { organizerId } = req.params;
  const { dateRange, startDate, endDate } = req.query;

  const dateFilter = buildDateFilter({ dateRange, startDate, endDate });
  const trendsMetrics = await getTrendsMetrics(organizerId, dateFilter);

  sendSuccess(res, {
    data: trendsMetrics,
    timestamp: new Date().toISOString(),
  });
});

// ==================== AI FRAUD CHECK ====================
export const performFraudCheck = asyncHandler(async (req, res) => {
  const { bookingId } = req.params;
  const booking = await Booking.findById(bookingId);

  if (!booking) {
    return sendError(res, new Error("Booking not found"), 404);
  }

  const fraudAgent = await AI_Agent.findOne({
    agent_type: "admin",
    role: "moderator",
    status: "active",
  });
  if (!fraudAgent) {
    return sendError(
      res,
      new Error("No active fraud detection agent found"),
      404
    );
  }

  const riskScore = calculateRiskScore(booking);
  const fraudCheck = await AI_FraudCheck.create({
    agentId: fraudAgent._id,
    bookingId,
    riskScore,
    fraudStatus:
      riskScore > 0.9 ? "fraudulent" : riskScore > 0.7 ? "suspicious" : "clean",
    checkVersion: "1.0",
  });

  await AI_ActionLog.create({
    agentId: fraudAgent._id,
    userId: booking.userId,
    logType: "fraud_check",
    actionDetails: { bookingId, riskScore, status: fraudCheck.fraudStatus },
  });

  sendSuccess(res, { data: fraudCheck }, 201);
});

// ==================== AI SENTIMENT ANALYSIS ====================
export const analyzeReviewSentiment = asyncHandler(async (req, res) => {
  const { reviewId } = req.params;
  const review = await Review.findById(reviewId)
    .populate("userId", "fullname")
    .populate("eventId", "event_name");

  if (!review) {
    return sendError(res, new Error("Review not found"), 404);
  }

  const sentimentAgent = await AI_Agent.findOne({
    agent_type: "admin",
    role: "analyst",
    status: "active",
  });
  if (!sentimentAgent) {
    return sendError(
      res,
      new Error("No active sentiment analysis agent found"),
      404
    );
  }

  const sentimentScore = analyzeSentiment(review.comment);
  const detectedIssues = detectIssues(review.comment);

  const sentimentAnalysis = await AI_FeedbackSentiment.create({
    review_id: reviewId,
    agent_id: sentimentAgent._id,
    sentiment_score: sentimentScore,
    detected_issues: detectedIssues,
  });

  await AI_ActionLog.create({
    agentId: sentimentAgent._id,
    userId: review.userId,
    logType: "sentiment_analysis",
    actionDetails: { reviewId, sentimentScore, issues: detectedIssues },
  });

  sendSuccess(res, { data: sentimentAnalysis }, 201);
});

// ==================== AI DASHBOARD ====================
export const getAIDashboard = asyncHandler(async (req, res) => {
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

  const recentActivities = await AI_ActionLog.find()
    .populate("agentId", "name role")
    .populate("userId", "fullname")
    .sort({ createdAt: -1 })
    .limit(10);

  sendSuccess(res, {
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
});

// ==================== HEALTH CHECK ====================
export const checkAIHealth = asyncHandler(async (req, res) => {
  const aiHealth = await AIService.checkAIHealth();
  const [activeAgents, recentRecommendations] = await Promise.all([
    AI_Agent.countDocuments({ status: "active" }),
    AI_Recommendation.countDocuments({
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    }),
  ]);

  sendSuccess(res, {
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
});

// ==================== HELPER FUNCTIONS FOR DASHBOARD ====================

function buildDateFilter(filters) {
  const dateFilter = {};

  if (filters.dateRange) {
    const now = new Date();
    let startDate;

    switch (filters.dateRange) {
      case "today":
        startDate = new Date(now.setHours(0, 0, 0, 0));
        break;
      case "week":
        startDate = new Date(now.setDate(now.getDate() - 7));
        break;
      case "month":
        startDate = new Date(now.setMonth(now.getMonth() - 1));
        break;
      case "quarter":
        startDate = new Date(now.setMonth(now.getMonth() - 3));
        break;
      case "year":
        startDate = new Date(now.setFullYear(now.getFullYear() - 1));
        break;
      default:
        startDate = null;
    }

    if (startDate) {
      dateFilter.createdAt = { $gte: startDate };
    }
  }

  if (filters.startDate && filters.endDate) {
    dateFilter.createdAt = {
      $gte: new Date(filters.startDate),
      $lte: new Date(filters.endDate),
    };
  }

  return dateFilter;
}

async function getEventMetrics(organizerId, dateFilter, statusFilter) {
  const mongoose = (await import("mongoose")).default;
  const query = {
    org_ID: new mongoose.Types.ObjectId(organizerId),
    ...dateFilter,
  };

  if (statusFilter) {
    query.status = statusFilter;
  }

  const totalEvents = await Event.countDocuments(query);

  const eventsByStatus = await Event.aggregate([
    { $match: query },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
      },
    },
  ]);

  const eventsByCategory = await Event.aggregate([
    { $match: query },
    {
      $lookup: {
        from: "categories",
        localField: "category",
        foreignField: "_id",
        as: "categoryInfo",
      },
    },
    { $unwind: { path: "$categoryInfo", preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: "$categoryInfo.categoryName",
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
  ]);

  const attendanceData = await Event.aggregate([
    { $match: query },
    {
      $project: {
        event_name: 1,
        totalSlots: 1,
        attendeeCount: { $size: { $ifNull: ["$attendees", []] } },
        attendanceRate: {
          $cond: {
            if: { $gt: ["$totalSlots", 0] },
            then: {
              $divide: [
                { $size: { $ifNull: ["$attendees", []] } },
                "$totalSlots",
              ],
            },
            else: 0,
          },
        },
      },
    },
  ]);

  const avgAttendanceRate =
    attendanceData.length > 0
      ? attendanceData.reduce((sum, e) => sum + e.attendanceRate, 0) /
        attendanceData.length
      : 0;

  return {
    total: totalEvents,
    byStatus: eventsByStatus.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {}),
    byCategory: eventsByCategory,
    averageAttendanceRate: avgAttendanceRate,
    attendanceDetails: attendanceData,
  };
}

async function getRevenueMetrics(organizerId, dateFilter) {
  const mongoose = (await import("mongoose")).default;

  const events = await Event.find({
    org_ID: new mongoose.Types.ObjectId(organizerId),
  }).select("_id");

  const eventIds = events.map((e) => e._id);

  const bookingQuery = {
    eventId: { $in: eventIds },
    "payment.status": "completed",
    ...dateFilter,
  };

  const revenueData = await Booking.aggregate([
    { $match: bookingQuery },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: "$totalAmount" },
        totalBookings: { $sum: 1 },
        averageBookingValue: { $avg: "$totalAmount" },
      },
    },
  ]);

  const revenueByMonth = await Booking.aggregate([
    { $match: bookingQuery },
    {
      $group: {
        _id: {
          year: { $year: "$createdAt" },
          month: { $month: "$createdAt" },
        },
        revenue: { $sum: "$totalAmount" },
        bookings: { $sum: 1 },
      },
    },
    { $sort: { "_id.year": 1, "_id.month": 1 } },
  ]);

  const revenueByEvent = await Booking.aggregate([
    { $match: bookingQuery },
    {
      $group: {
        _id: "$eventId",
        revenue: { $sum: "$totalAmount" },
        bookings: { $sum: 1 },
      },
    },
    {
      $lookup: {
        from: "events",
        localField: "_id",
        foreignField: "_id",
        as: "eventInfo",
      },
    },
    { $unwind: "$eventInfo" },
    {
      $project: {
        eventName: "$eventInfo.event_name",
        revenue: 1,
        bookings: 1,
      },
    },
    { $sort: { revenue: -1 } },
  ]);

  const result = revenueData[0] || {
    totalRevenue: 0,
    totalBookings: 0,
    averageBookingValue: 0,
  };

  return {
    total: result.totalRevenue,
    totalBookings: result.totalBookings,
    averageBookingValue: result.averageBookingValue,
    byMonth: revenueByMonth,
    byEvent: revenueByEvent,
  };
}

async function getBookingMetrics(organizerId, dateFilter) {
  const mongoose = (await import("mongoose")).default;

  const events = await Event.find({
    org_ID: new mongoose.Types.ObjectId(organizerId),
  }).select("_id totalSlots");

  const eventIds = events.map((e) => e._id);
  const totalSlots = events.reduce((sum, e) => sum + (e.totalSlots || 0), 0);

  const bookingQuery = {
    eventId: { $in: eventIds },
    ...dateFilter,
  };

  const bookings = await Booking.aggregate([
    { $match: bookingQuery },
    {
      $group: {
        _id: "$payment.status",
        count: { $sum: 1 },
        totalSeats: { $sum: "$numberOfSeats" },
      },
    },
  ]);

  const totalBookings = bookings.reduce((sum, b) => sum + b.count, 0);
  const completedBookings =
    bookings.find((b) => b._id === "completed")?.count || 0;
  const totalBookedSeats = bookings.reduce((sum, b) => sum + b.totalSeats, 0);

  const conversionRate = totalSlots > 0 ? totalBookedSeats / totalSlots : 0;

  const bookingsByPaymentMethod = await Booking.aggregate([
    { $match: { ...bookingQuery, "payment.status": "completed" } },
    {
      $group: {
        _id: "$payment.method",
        count: { $sum: 1 },
      },
    },
  ]);

  return {
    total: totalBookings,
    completed: completedBookings,
    byStatus: bookings.reduce((acc, b) => {
      acc[b._id] = b.count;
      return acc;
    }, {}),
    totalSeatsBooked: totalBookedSeats,
    totalAvailableSlots: totalSlots,
    conversionRate: conversionRate,
    byPaymentMethod: bookingsByPaymentMethod,
  };
}

async function getRatingMetrics(organizerId, dateFilter) {
  const mongoose = (await import("mongoose")).default;

  const events = await Event.find({
    org_ID: new mongoose.Types.ObjectId(organizerId),
  }).select("_id");

  const eventIds = events.map((e) => e._id);

  const reviewQuery = {
    eventId: { $in: eventIds },
    ...dateFilter,
  };

  const ratingData = await Review.aggregate([
    { $match: reviewQuery },
    {
      $group: {
        _id: null,
        averageRating: { $avg: "$rating" },
        totalReviews: { $sum: 1 },
        maxRating: { $max: "$rating" },
        minRating: { $min: "$rating" },
      },
    },
  ]);

  const ratingDistribution = await Review.aggregate([
    { $match: reviewQuery },
    {
      $group: {
        _id: "$rating",
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const ratingsByEvent = await Review.aggregate([
    { $match: reviewQuery },
    {
      $group: {
        _id: "$eventId",
        averageRating: { $avg: "$rating" },
        reviewCount: { $sum: 1 },
      },
    },
    {
      $lookup: {
        from: "events",
        localField: "_id",
        foreignField: "_id",
        as: "eventInfo",
      },
    },
    { $unwind: "$eventInfo" },
    {
      $project: {
        eventName: "$eventInfo.event_name",
        averageRating: 1,
        reviewCount: 1,
      },
    },
    { $sort: { averageRating: -1 } },
  ]);

  const result = ratingData[0] || {
    averageRating: 0,
    totalReviews: 0,
    maxRating: 0,
    minRating: 0,
  };

  return {
    average: result.averageRating,
    total: result.totalReviews,
    max: result.maxRating,
    min: result.minRating,
    distribution: ratingDistribution.reduce((acc, r) => {
      acc[`${r._id}_star`] = r.count;
      return acc;
    }, {}),
    byEvent: ratingsByEvent,
  };
}

async function getSentimentMetrics(organizerId, dateFilter) {
  const mongoose = (await import("mongoose")).default;

  const events = await Event.find({
    org_ID: new mongoose.Types.ObjectId(organizerId),
  }).select("_id");

  const eventIds = events.map((e) => e._id);

  const reviews = await Review.find({
    eventId: { $in: eventIds },
    ...dateFilter,
  }).select("_id");

  const reviewIds = reviews.map((r) => r._id);

  const sentimentQuery = {
    review_id: { $in: reviewIds },
  };

  const sentimentData = await AI_FeedbackSentiment.aggregate([
    { $match: sentimentQuery },
    {
      $group: {
        _id: null,
        averageScore: { $avg: "$sentiment_score" },
        totalAnalyzed: { $sum: 1 },
        positiveCount: {
          $sum: { $cond: [{ $gt: ["$sentiment_score", 0.3] }, 1, 0] },
        },
        neutralCount: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $gte: ["$sentiment_score", -0.3] },
                  { $lte: ["$sentiment_score", 0.3] },
                ],
              },
              1,
              0,
            ],
          },
        },
        negativeCount: {
          $sum: { $cond: [{ $lt: ["$sentiment_score", -0.3] }, 1, 0] },
        },
      },
    },
  ]);

  const commonIssues = await AI_FeedbackSentiment.aggregate([
    { $match: sentimentQuery },
    { $unwind: "$detected_issues" },
    {
      $group: {
        _id: "$detected_issues",
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]);

  const sentimentOverTime = await AI_FeedbackSentiment.aggregate([
    { $match: sentimentQuery },
    {
      $group: {
        _id: {
          year: { $year: "$createdAt" },
          month: { $month: "$createdAt" },
        },
        averageScore: { $avg: "$sentiment_score" },
        count: { $sum: 1 },
      },
    },
    { $sort: { "_id.year": 1, "_id.month": 1 } },
  ]);

  const result = sentimentData[0] || {
    averageScore: 0,
    totalAnalyzed: 0,
    positiveCount: 0,
    neutralCount: 0,
    negativeCount: 0,
  };

  return {
    averageScore: result.averageScore,
    totalAnalyzed: result.totalAnalyzed,
    distribution: {
      positive: result.positiveCount,
      neutral: result.neutralCount,
      negative: result.negativeCount,
    },
    commonIssues: commonIssues,
    overTime: sentimentOverTime,
  };
}

async function getTrendsMetrics(organizerId, dateFilter) {
  const mongoose = (await import("mongoose")).default;

  const events = await Event.find({
    org_ID: new mongoose.Types.ObjectId(organizerId),
  }).select("_id");

  const eventIds = events.map((e) => e._id);

  const peakTimes = await Booking.aggregate([
    {
      $match: {
        eventId: { $in: eventIds },
        "payment.status": "completed",
        ...dateFilter,
      },
    },
    {
      $group: {
        _id: {
          dayOfWeek: { $dayOfWeek: "$createdAt" },
          hour: { $hour: "$createdAt" },
        },
        bookings: { $sum: 1 },
      },
    },
    { $sort: { bookings: -1 } },
    { $limit: 10 },
  ]);

  const userDemographics = await Booking.aggregate([
    {
      $match: {
        eventId: { $in: eventIds },
        "payment.status": "completed",
      },
    },
    {
      $group: {
        _id: "$userId",
        bookingCount: { $sum: 1 },
      },
    },
    {
      $group: {
        _id: null,
        uniqueUsers: { $sum: 1 },
        repeatCustomers: {
          $sum: { $cond: [{ $gt: ["$bookingCount", 1] }, 1, 0] },
        },
      },
    },
  ]);

  const popularCategories = await Event.aggregate([
    {
      $match: {
        org_ID: new mongoose.Types.ObjectId(organizerId),
        ...dateFilter,
      },
    },
    {
      $lookup: {
        from: "bookings",
        localField: "_id",
        foreignField: "eventId",
        as: "bookings",
      },
    },
    {
      $lookup: {
        from: "categories",
        localField: "category",
        foreignField: "_id",
        as: "categoryInfo",
      },
    },
    { $unwind: { path: "$categoryInfo", preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: "$categoryInfo.categoryName",
        eventCount: { $sum: 1 },
        totalBookings: { $sum: { $size: "$bookings" } },
      },
    },
    { $sort: { totalBookings: -1 } },
  ]);

  return {
    peakBookingTimes: peakTimes,
    userDemographics: userDemographics[0] || {
      uniqueUsers: 0,
      repeatCustomers: 0,
    },
    popularCategories: popularCategories,
  };
}

export default {
  createAgent,
  getAgents,
  getUserRecommendations,
  createRecommendation,
  getMyRecommendations,
  planEvent,
  getEventPlanningSuggestions,
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
  getOrganizerDashboardMetrics,
  getOrganizerEventMetrics,
  getOrganizerRevenueMetrics,
  getOrganizerBookingMetrics,
  getOrganizerRatingMetrics,
  getOrganizerSentimentMetrics,
  getOrganizerTrendsMetrics,
};
