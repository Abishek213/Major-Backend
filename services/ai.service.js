import axios from "axios";
import AI_Recommendation from "../model/ai_recommendation.schema.js";
import AI_Agent from "../model/ai_agent.schema.js";
import Event from "../model/event.schema.js";
import Booking from "../model/booking.schema.js";
import Review from "../model/review.schema.js";

class AIService {
  constructor() {
    this.aiAgentUrl = process.env.AI_AGENT_URL || "http://localhost:3002";
  }

  async _request(method, path, data = null, options = {}) {
    try {
      const response = await axios({
        method,
        url: `${this.aiAgentUrl}${path}`,
        data,
        timeout: options.timeout || 10000,
        headers: { "Content-Type": "application/json", ...options.headers },
      });
      return response.data;
    } catch (error) {
      console.error(
        `AI Agent request failed: ${method} ${path}`,
        error.message
      );
      throw new Error(
        error.response?.data?.message ||
          error.message ||
          "AI Agent request failed"
      );
    }
  }

  async _buildUserContext(userId) {
    const { default: User } = await import("../model/user.schema.js");
    const user = await User.findById(userId)
      .populate({
        path: "wishlist",
        populate: { path: "category", select: "category_Name" },
      })
      .select("wishlist")
      .lean();

    const wishlistEvents = user?.wishlist || [];

    const bookings = await Booking.find({ userId })
      .populate({
        path: "eventId",
        select:
          "event_name category tags price location event_date attendees totalSlots",
        populate: { path: "category", select: "category_Name" },
      })
      .select("eventId")
      .lean();

    const bookedEvents = bookings.map((b) => b.eventId).filter(Boolean);

    const reviews = await Review.find({ userId })
      .populate({
        path: "eventId",
        select:
          "event_name category tags price location event_date attendees totalSlots",
        populate: { path: "category", select: "category_Name" },
      })
      .select("eventId rating")
      .lean();

    const reviewedEvents = reviews
      .map((r) => ({ event: r.eventId, rating: r.rating }))
      .filter((r) => r.event);

    return { wishlistEvents, bookedEvents, reviewedEvents };
  }

  async _fetchCandidateEvents() {
    return Event.find({
      status: { $in: ["upcoming", "approved"] },
      registrationDeadline: { $gt: new Date() },
      isPublic: true,
      $expr: { $lt: [{ $size: "$attendees" }, "$totalSlots"] },
    })
      .populate("category", "category_Name")
      .select(
        "event_name description category tags price location event_date time attendees totalSlots"
      )
      .lean();
  }

  async getAIRecommendations(userId, limit = 10) {
    try {
      const userContext = await this._buildUserContext(userId);
      const candidateEvents = await this._fetchCandidateEvents();

      console.log(
        `📡 Calling AI Agent | candidates: ${candidateEvents.length} | wishlist: ${userContext.wishlistEvents.length} | booked: ${userContext.bookedEvents.length}`
      );

      const response = await this._request(
        "post",
        "/api/agents/user/recommendations",
        {
          userId,
          limit,
          userContext,
          candidateEvents,
        },
        { timeout: 8000 }
      );

      return response.success ? response.recommendations : [];
    } catch (error) {
      console.error("AI Agent call failed:", error.message);
      return [];
    }
  }

  async getRecommendationAgent() {
    let agent = await AI_Agent.findOne({
      name: "Event Recommendation Agent",
      agent_type: "admin",
    });
    if (!agent) {
      agent = await AI_Agent.create({
        name: "Event Recommendation Agent",
        role: "assistant",
        agent_type: "admin",
        capabilities: ["event_recommendation", "user_behavior_analysis"],
        status: "active",
      });
      console.log("🤖 Created recommendation agent:", agent._id);
    }
    return agent;
  }

  async storeRecommendations(userId, recommendations, agentId) {
    if (!recommendations.length) return [];
    const docs = recommendations.map((rec) => ({
      user_id: userId,
      event_id: rec.event_id,
      agent_id: agentId,
      confidence_score: rec.confidence_score,
      recommendation_reason: rec.recommendation_reason,
    }));
    const saved = await AI_Recommendation.insertMany(docs);
    console.log(`💾 Stored ${saved.length} recommendations`);
    return saved;
  }

  async getCachedRecommendations(userId, limit) {
    try {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const cached = await AI_Recommendation.find({
        user_id: userId,
        createdAt: { $gte: oneDayAgo },
      })
        .populate("event_id")
        .sort({ confidence_score: -1, createdAt: -1 })
        .limit(limit);

      return cached.map((rec) => ({
        event_id: rec.event_id?._id || rec.event_id,
        event_name: rec.event_id?.event_name || "Unknown Event",
        description: rec.event_id?.description || "",
        confidence_score: rec.confidence_score,
        recommendation_reason: rec.recommendation_reason,
        price: rec.event_id?.price || 0,
        location: rec.event_id?.location || "Unknown",
        event_date: rec.event_id?.event_date || null,
        category: rec.event_id?.category || null,
        source: "database_cache",
      }));
    } catch (error) {
      console.error("Cache error:", error.message);
      return [];
    }
  }

  async getFallbackRecommendations(userId, limit = 10) {
    try {
      const events = await Event.find({
        status: { $in: ["upcoming", "approved"] },
        registrationDeadline: { $gt: new Date() },
        isPublic: true,
        $expr: { $lt: [{ $size: "$attendees" }, "$totalSlots"] },
      })
        .populate("category", "category_Name")
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();

      return events.map((event) => ({
        event_id: event._id,
        event_name: event.event_name,
        description: event.description,
        confidence_score: 0.3,
        recommendation_reason: "Popular event (fallback recommendation)",
        price: event.price,
        location: event.location,
        event_date: event.event_date,
        time: event.time,
        category: event.category,
        tags: event.tags || [],
        source: "fallback",
      }));
    } catch (error) {
      console.error("Fallback error:", error.message);
      return [];
    }
  }

  async checkAIHealth() {
    try {
      const response = await axios.get(`${this.aiAgentUrl}/api/agents/health`, {
        timeout: 3000,
      });
      return {
        status: "healthy",
        url: this.aiAgentUrl,
        response_time: response.headers["x-response-time"] || "unknown",
        version: response.data.version || "1.0.0",
      };
    } catch (error) {
      return {
        status: "unhealthy",
        url: this.aiAgentUrl,
        error: error.message,
      };
    }
  }

  async chatBookingSupport(data) {
    console.log(
      `💬 Forwarding chat to AI Agent: ${data.message?.substring(0, 50)}...`
    );
    const response = await this._request(
      "post",
      "/api/agents/user/booking-support/chat",
      data,
      { timeout: 30000 }
    );
    console.log(`✅ AI Agent responded successfully`);
    return response;
  }

  async clearBookingSupportHistory(data) {
    console.log(`🗑️ Clearing history for: ${data.userId || data.sessionId}`);
    const response = await this._request(
      "post",
      "/api/agents/user/booking-support/clear-history",
      data,
      { timeout: 5000 }
    );
    console.log(`✅ History cleared successfully`);
    return response;
  }

  async checkBookingSupportHealth() {
    try {
      const response = await axios.get(
        `${this.aiAgentUrl}/api/agents/user/booking-support/health`,
        { timeout: 5000 }
      );
      return response.data;
    } catch (error) {
      console.error("Booking support health check error:", error.message);
      return {
        success: false,
        status: "unhealthy",
        error: error.message,
        url: this.aiAgentUrl,
        timestamp: new Date().toISOString(),
      };
    }
  }

  async getBookingSupportStats() {
    const response = await this._request(
      "get",
      "/api/agents/user/booking-support/stats",
      null,
      { timeout: 5000 }
    );
    return response;
  }

  async getPlanningSuggestions(eventData) {
    console.log(
      `📡 Calling AI Agent Planning Agent for event: ${eventData.event_name}`
    );
    const response = await this._request(
      "post",
      "/api/agents/organizer/planning/suggest",
      eventData,
      { timeout: 10000 }
    );
    console.log(`✅ AI Agent planning suggestions received`);
    return response;
  }

  async checkPlanningAgentHealth() {
    try {
      const response = await axios.get(`${this.aiAgentUrl}/api/agents/health`, {
        timeout: 5000,
      });

      const healthData = response.data;

      const planningStatus =
        healthData.components?.planning ||
        healthData.agents?.find((a) => a.name === "planning-agent")?.status ||
        "unknown";

      return {
        success: true,
        status: planningStatus === "ready" ? "active" : "inactive",
        agentStatus: planningStatus,
        name: "planning-agent",
        type: "organizer",
        capabilities: [
          "price_optimization",
          "tag_recommendation",
          "slot_suggestion",
          "datetime_optimization",
          "deadline_validation",
        ],
        llmProvider: process.env.LLM_PROVIDER || "ollama",
        llmStatus: planningStatus === "ready" ? "ready" : "initializing",
        fullHealthCheck: healthData,
      };
    } catch (error) {
      console.error("Planning agent health check error:", error.message);
      return {
        success: false,
        status: "inactive",
        error: error.message,
        url: this.aiAgentUrl,
        timestamp: new Date().toISOString(),
      };
    }
  }

  async getDashboardInsights(organizerId, metricsData) {
    try {
      console.log(
        `📊 Requesting dashboard insights for organizer: ${organizerId}`
      );

      const response = await this._request(
        "post",
        "/api/agents/organizer/dashboard/insights",
        {
          organizerId,
          metrics: metricsData,
        },
        { timeout: 15000 }
      );

      console.log(`✅ Dashboard insights generated successfully`);
      return response;
    } catch (error) {
      console.error("Dashboard insights error:", error.message);
      return {
        success: false,
        error: error.message,
        fallback: true,
        insights: {
          summary: "Unable to generate AI insights at this time",
          highlights: [],
          concerns: [],
          recommendations: [],
        },
      };
    }
  }

  async answerDashboardQuery(organizerId, query, context = {}) {
    try {
      console.log(
        `❓ Processing dashboard query for ${organizerId}: ${query.substring(
          0,
          50
        )}...`
      );

      const response = await this._request(
        "post",
        "/api/agents/organizer/dashboard/query",
        {
          organizerId,
          query,
          context,
        },
        { timeout: 20000 }
      );

      console.log(`✅ Dashboard query answered successfully`);
      return response;
    } catch (error) {
      console.error("Dashboard query error:", error.message);
      return {
        success: false,
        error: error.message,
        answer:
          "I apologize, but I encountered an error processing your question. Please try rephrasing or contact support.",
      };
    }
  }

  async getDashboardRecommendations(organizerId, metricsData) {
    try {
      console.log(
        `💡 Generating recommendations for organizer: ${organizerId}`
      );

      const response = await this._request(
        "post",
        "/api/agents/organizer/dashboard/recommendations",
        {
          organizerId,
          metrics: metricsData,
        },
        { timeout: 15000 }
      );

      console.log(`✅ Recommendations generated successfully`);
      return response;
    } catch (error) {
      console.error("Dashboard recommendations error:", error.message);
      return {
        success: false,
        error: error.message,
        recommendations: [],
      };
    }
  }

  async initializeDashboardAgent(organizerId) {
    try {
      console.log(
        `🚀 Initializing dashboard agent for organizer: ${organizerId}`
      );

      const response = await this._request(
        "post",
        "/api/agents/organizer/dashboard/initialize",
        { organizerId },
        { timeout: 10000 }
      );

      console.log(`✅ Dashboard agent initialized successfully`);
      return response;
    } catch (error) {
      console.error("Dashboard agent initialization error:", error.message);
      return {
        success: false,
        error: error.message,
        message: "Failed to initialize dashboard agent",
      };
    }
  }

  async getDashboardAgent(organizerId = null) {
    try {
      // Look for existing dashboard agent
      let agent = await AI_Agent.findOne({
        name: "Organizer Dashboard Assistant",
        agent_type: "organizer",
        role: "assistant",
      });

      // Create if doesn't exist
      if (!agent) {
        agent = await AI_Agent.create({
          name: "Organizer Dashboard Assistant",
          role: "assistant",
          agent_type: "organizer",
          user_id: organizerId || null,
          capabilities: {
            metrics_aggregation: true,
            revenue_analysis: true,
            sentiment_analysis: true,
            trend_prediction: true,
            natural_language_query: true,
            recommendation_generation: true,
          },
          status: "active",
        });
        console.log("🤖 Created dashboard assistant agent:", agent._id);
      }

      return agent;
    } catch (error) {
      console.error("Get dashboard agent error:", error.message);
      throw error;
    }
  }

  async checkDashboardAgentHealth() {
    try {
      const response = await axios.get(
        `${this.aiAgentUrl}/api/agents/organizer/dashboard/health`,
        { timeout: 5000 }
      );

      return {
        success: true,
        status: response.data.status || "unknown",
        ...response.data,
      };
    } catch (error) {
      console.error("Dashboard agent health check error:", error.message);
      return {
        success: false,
        status: "unhealthy",
        error: error.message,
        url: this.aiAgentUrl,
        timestamp: new Date().toISOString(),
      };
    }
  }

  async getDashboardAgentStats(organizerId, timeRange = "30d") {
    try {
      const daysBack = timeRange === "7d" ? 7 : timeRange === "90d" ? 90 : 30;
      const dateFrom = new Date();
      dateFrom.setDate(dateFrom.getDate() - daysBack);

      const agent = await this.getDashboardAgent(organizerId);

      const { default: AI_ActionLog } = await import(
        "../model/ai_actionLog.schema.js"
      );

      const filter = {
        agentId: agent._id,
        logType: {
          $in: [
            "dashboard_query",
            "dashboard_insights",
            "dashboard_recommendations",
          ],
        },
        createdAt: { $gte: dateFrom },
      };

      if (organizerId) {
        filter.userId = organizerId;
      }

      const [totalQueries, successfulQueries, failedQueries, recentLogs] =
        await Promise.all([
          AI_ActionLog.countDocuments(filter),
          AI_ActionLog.countDocuments({ ...filter, success: true }),
          AI_ActionLog.countDocuments({ ...filter, success: false }),
          AI_ActionLog.find(filter)
            .sort({ createdAt: -1 })
            .limit(20)
            .select("logType actionDetails success createdAt"),
        ]);

      const queryTypes = await AI_ActionLog.aggregate([
        { $match: filter },
        { $group: { _id: "$logType", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]);

      return {
        success: true,
        agent: {
          id: agent._id,
          name: agent.name,
          status: agent.status,
          type: agent.agent_type,
        },
        summary: {
          total_queries: totalQueries,
          successful: successfulQueries,
          failed: failedQueries,
          success_rate:
            totalQueries > 0
              ? ((successfulQueries / totalQueries) * 100).toFixed(1)
              : "0.0",
          time_range: timeRange,
          period_start: dateFrom.toISOString(),
          period_end: new Date().toISOString(),
        },
        query_types: queryTypes.map((qt) => ({
          type: qt._id,
          count: qt.count,
        })),
        recent_activity: recentLogs.map((log) => ({
          type: log.logType,
          details: log.actionDetails,
          success: log.success,
          timestamp: log.createdAt,
        })),
      };
    } catch (error) {
      console.error("Dashboard agent stats error:", error.message);
      throw error;
    }
  }
}

const aiService = new AIService();
export default aiService;
