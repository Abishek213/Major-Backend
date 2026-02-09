import axios from "axios";
import AI_Recommendation from "../model/ai_recommendation.schema.js";
import AI_Agent from "../model/ai_agent.schema.js";
import Event from "../model/event.schema.js";
import Booking from "../model/booking.schema.js";
import Review from "../model/review.schema.js";

/**
 * ============================================================================
 * AI SERVICE - BACKEND INTEGRATION LAYER
 * ============================================================================
 *
 * This service acts as the integration layer between Backend and AI Agent Service
 *
 * RESPONSIBILITIES:
 * - Build user context from database
 * - Fetch candidate events
 * - Call AI Agent Service endpoints
 * - Cache recommendations
 * - Provide fallback data
 * - Health monitoring
 *
 * ============================================================================
 */

class AIService {
  constructor() {
    this.aiAgentUrl = process.env.AI_AGENT_URL || "http://localhost:3002";
  }

  // ============================================================================
  // EVENT RECOMMENDATION METHODS
  // ============================================================================

  /**
   * Assembles the full user context from DB before sending to AI Agent.
   * The AI Agent has no DB access — it can only score what we give it.
   */
  async _buildUserContext(userId) {
    // 1. Fetch user's wishlist events (populate full event docs)
    // We import User dynamically to avoid circular dependency issues
    const { default: User } = await import("../model/user.schema.js");
    const user = await User.findById(userId)
      .populate({
        path: "wishlist",
        populate: {
          path: "category",
          select: "category_Name",
        },
      })
      .select("wishlist")
      .lean();

    const wishlistEvents = user?.wishlist || [];

    // 2. Fetch events the user has actually booked (strongest signal)
    const bookings = await Booking.find({ userId })
      .populate({
        path: "eventId",
        select:
          "event_name category tags price location event_date attendees totalSlots",
        populate: {
          path: "category",
          select: "category_Name",
        },
      })
      .select("eventId")
      .lean();

    const bookedEvents = bookings.map((b) => b.eventId).filter(Boolean);

    // 3. Fetch events the user has reviewed (confirms engagement)
    const reviews = await Review.find({ userId })
      .populate({
        path: "eventId",
        select:
          "event_name category tags price location event_date attendees totalSlots",
        populate: {
          path: "category",
          select: "category_Name",
        },
      })
      .select("eventId rating")
      .lean();

    const reviewedEvents = reviews
      .map((r) => ({ event: r.eventId, rating: r.rating }))
      .filter((r) => r.event);

    return { wishlistEvents, bookedEvents, reviewedEvents };
  }

  /**
   * Fetches eligible candidate events the AI can score against.
   * Filters out events that are not bookable.
   */
  async _fetchCandidateEvents() {
    return Event.find({
      status: { $in: ["upcoming", "approved"] },
      registrationDeadline: { $gt: new Date() },
      isPublic: true,
      $expr: { $lt: [{ $size: "$attendees" }, "$totalSlots"] }, // not full
    })
      .populate("category", "category_Name")
      .select(
        "event_name description category tags price location event_date time attendees totalSlots"
      )
      .lean();
  }

  /**
   * Calls the AI Agent with assembled context + candidate events.
   * AI Agent returns scored & ranked recommendations.
   */
  async getAIRecommendations(userId, limit = 10) {
    try {
      // Build what the AI Agent needs — it cannot query our DB
      const userContext = await this._buildUserContext(userId);
      const candidateEvents = await this._fetchCandidateEvents();

      console.log(
        `📡 Calling AI Agent | candidates: ${candidateEvents.length} | wishlist: ${userContext.wishlistEvents.length} | booked: ${userContext.bookedEvents.length}`
      );

      // ✅ FIXED: Changed from /api/recommendations to /api/agents/user/recommendations
      const response = await axios.post(
        `${this.aiAgentUrl}/api/agents/user/recommendations`,
        {
          userId,
          limit,
          userContext,
          candidateEvents,
        },
        { timeout: 8000 }
      );

      return response.data.success ? response.data.recommendations : [];
    } catch (error) {
      console.error("AI Agent call failed:", error.message);
      return [];
    }
  }

  /**
   * Finds or creates the shared recommendation agent.
   */
  async getRecommendationAgent() {
    try {
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
    } catch (error) {
      console.error("Agent error:", error.message);
      throw error;
    }
  }

  /**
   * Persists recommendations returned by the AI Agent.
   */
  async storeRecommendations(userId, recommendations, agentId) {
    try {
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
    } catch (error) {
      console.error("Storage error:", error.message);
      return [];
    }
  }

  /**
   * Returns cached recommendations from the last 24 hours.
   */
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

  /**
   * Fallback: returns popular upcoming events when the AI Agent
   * is down or returns empty.
   */
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

  /**
   * Health check against the AI Agent microservice.
   */
  async checkAIHealth() {
    try {
      const response = await axios.get(`${this.aiAgentUrl}/api/health`, {
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

  // ============================================================================
  // BOOKING SUPPORT AGENT METHODS
  // ============================================================================

  /**
   * Chat with booking support agent
   * Forwards chat request to AI Agent Service
   *
   * @param {Object} data - { message, userId, sessionId }
   * @returns {Promise<Object>} AI response with message and metadata
   */
  async chatBookingSupport(data) {
    try {
      console.log(
        `💬 Forwarding chat to AI Agent: ${data.message?.substring(0, 50)}...`
      );

      const response = await axios.post(
        `${this.aiAgentUrl}/api/agents/user/booking-support/chat`,
        data,
        {
          timeout: 30000, // 30 second timeout (AI processing can take time)
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      console.log(`✅ AI Agent responded successfully`);
      return response.data;
    } catch (error) {
      console.error("Booking support chat error:", error.message);

      // Return error in expected format
      throw new Error(
        error.response?.data?.message ||
          error.message ||
          "Failed to communicate with booking support agent"
      );
    }
  }

  /**
   * Clear conversation history for a user
   *
   * @param {Object} data - { userId, sessionId }
   * @returns {Promise<Object>} Success response
   */
  async clearBookingSupportHistory(data) {
    try {
      console.log(`🗑️ Clearing history for: ${data.userId || data.sessionId}`);

      const response = await axios.post(
        `${this.aiAgentUrl}/api/agents/user/booking-support/clear-history`,
        data,
        {
          timeout: 5000,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      console.log(`✅ History cleared successfully`);
      return response.data;
    } catch (error) {
      console.error("Clear history error:", error.message);
      throw new Error(
        error.response?.data?.message || "Failed to clear conversation history"
      );
    }
  }

  /**
   * Check booking support agent health
   *
   * @returns {Promise<Object>} Health status with component details
   */
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

  /**
   * Get booking support agent statistics
   * Useful for monitoring dashboards
   *
   * @returns {Promise<Object>} Agent stats including sessions, performance, etc.
   */
  async getBookingSupportStats() {
    try {
      const response = await axios.get(
        `${this.aiAgentUrl}/api/agents/user/booking-support/stats`,
        { timeout: 5000 }
      );

      return response.data;
    } catch (error) {
      console.error("Booking support stats error:", error.message);
      throw new Error(
        error.response?.data?.message ||
          "Failed to get booking support statistics"
      );
    }
  }
}

const aiService = new AIService();
export default aiService;
