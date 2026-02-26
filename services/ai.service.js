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
    this.aiAgentUrl =
      process.env.AI_AGENT_SERVICE_URL || "http://localhost:3002";

    // ── Built-in FAQ knowledge base ─────────────────────────────────────────
    this._faqEntries = [
      {
        keywords: ["refund", "money back", "cancel", "cancellation"],
        response:
          "Our refund policy allows full refunds up to 48 hours before the event. " +
          "Cancellations within 48 hours may be eligible for a 50% refund. " +
          "To request a refund, go to My Bookings → select the booking → click 'Request Refund'. " +
          "Refunds are processed within 5–7 business days.",
      },
      {
        keywords: ["transfer", "ticket", "give", "friend", "someone else"],
        response:
          "You can transfer your ticket to another person up to 24 hours before the event. " +
          "Go to My Bookings → select the booking → click 'Transfer Ticket' and enter the recipient's email. " +
          "They will receive a confirmation email with the new ticket.",
      },
      {
        keywords: ["book", "how to book", "register", "sign up", "reserve"],
        response:
          "To book an event: (1) Browse events on the homepage or use Search. " +
          "(2) Click on the event you want. " +
          "(3) Click 'Book Now' and select the number of tickets. " +
          "(4) Complete payment. You'll receive a confirmation email with your ticket.",
      },
      {
        keywords: ["payment", "pay", "price", "cost", "fee", "charge"],
        response:
          "We accept credit/debit cards, PayPal, and eSewa. " +
          "Payment is processed securely at checkout. " +
          "You will receive a receipt via email after successful payment. " +
          "If a payment failed, please check your bank and try again — you will not be charged twice.",
      },
      {
        keywords: ["contact", "support", "help", "human", "agent", "speak"],
        response:
          "You can reach our support team at support@eventa.com or call +977-01-1234567 (Mon–Fri, 9AM–6PM). " +
          "For urgent issues during an event, use the emergency contact provided in your confirmation email.",
      },
      {
        keywords: ["reschedule", "postpone", "date change", "new date"],
        response:
          "If an event is rescheduled by the organizer, you will be notified via email and given the option to keep your booking or request a full refund. " +
          "If you need to change your attendance date for a multi-day event, contact the organizer directly through the event page.",
      },
      {
        keywords: ["ticket", "where", "find", "download", "qr", "code"],
        response:
          "Your ticket is available in My Bookings. You can download it as a PDF or show the QR code directly from the app at the venue. " +
          "A copy is also sent to your registered email address after booking.",
      },
      {
        keywords: ["account", "login", "password", "forgot", "reset"],
        response:
          "To reset your password, click 'Forgot Password' on the login page and enter your email. " +
          "You will receive a reset link within a few minutes. " +
          "If you don't see it, check your spam folder or contact support@eventa.com.",
      },
      {
        keywords: ["organizer", "create event", "host", "list event", "publish"],
        response:
          "To create an event, register or log in as an organizer. " +
          "Go to Dashboard → Create Event and fill in the details (name, date, venue, tickets, pricing). " +
          "Events are reviewed and approved within 24 hours. " +
          "For organizer onboarding help, email organizers@eventa.com.",
      },
    ];
  }

  // ============================================================================
  // INTERNAL HELPERS
  // ============================================================================

  /** Detect whether an axios error means the AI agent server is not running. */
  _isAgentUnavailable(error) {
    return (
      error.code === "ECONNREFUSED" ||
      error.code === "ENOTFOUND" ||
      error.code === "ETIMEDOUT" ||
      error.code === "ECONNRESET" ||
      error.message?.includes("connect ECONNREFUSED") ||
      error.message?.includes("timeout")
    );
  }

  /** Generic axios wrapper with consistent error handling. */
  async _request(method, path, data = null, options = {}) {
    try {
      const config = {
        method,
        url: `${this.aiAgentUrl}${path}`,
        headers: { "Content-Type": "application/json" },
        ...options,
      };
      if (data) config.data = data;
      const response = await axios(config);
      return response.data;
    } catch (error) {
      console.error(
        `AI _request [${method.toUpperCase()} ${path}] failed:`,
        error.message
      );
      throw error;
    }
  }

  // ============================================================================
  // PLANNING FALLBACK SUGGESTIONS
  // ============================================================================

  /**
   * Generate rule-based fallback suggestions when the AI agent is unavailable.
   * Returns the same shape the frontend expects under
   *   response.data.data.fullSuggestions.suggestions
   */
  _generateFallbackSuggestions(eventData) {
    const eventType = (
      eventData.eventType ||
      eventData.event_type ||
      "general"
    ).toLowerCase();

    const location = eventData.location || "your area";
    const totalSlots = parseInt(eventData.totalSlots || eventData.total_slots) || 100;

    // ── Price look-up table ───────────────────────────────────────────────
    const pricingMap = {
      conference: { base: 150, min: 100, max: 250 },
      workshop:   { base: 80,  min: 50,  max: 120 },
      wedding:    { base: 200, min: 150, max: 350 },
      birthday:   { base: 50,  min: 30,  max: 80  },
      concert:    { base: 120, min: 80,  max: 200 },
      festival:   { base: 60,  min: 40,  max: 100 },
      general:    { base: 75,  min: 50,  max: 120 },
    };
    const pricing = pricingMap[eventType] || pricingMap.general;

    // ── Slot look-up table ────────────────────────────────────────────────
    const slotMap = {
      conference: { suggested: 200, min: 100, max: 500 },
      workshop:   { suggested: 30,  min: 15,  max: 50  },
      wedding:    { suggested: 150, min: 50,  max: 300 },
      birthday:   { suggested: 50,  min: 20,  max: 100 },
      concert:    { suggested: 500, min: 200, max: 2000 },
      festival:   { suggested: 300, min: 100, max: 1000 },
      general:    { suggested: 100, min: 50,  max: 200 },
    };
    const slots = slotMap[eventType] || slotMap.general;

    // ── Tag look-up table ─────────────────────────────────────────────────
    const tagMap = {
      conference: ["conference", "networking", "keynote", "business", "innovation", "professional"],
      workshop:   ["workshop", "hands-on", "learning", "skills", "interactive", "training"],
      wedding:    ["wedding", "celebration", "ceremony", "reception", "love", "special"],
      birthday:   ["birthday", "party", "celebration", "fun", "milestone", "friends"],
      concert:    ["concert", "live-music", "performance", "entertainment", "band", "music"],
      festival:   ["festival", "community", "outdoor", "entertainment", "culture", "fun"],
      general:    ["event", "community", "special", "gathering", "local", "featured"],
    };
    const tags = tagMap[eventType] || tagMap.general;

    // ── Date suggestions: next 3 weekends ────────────────────────────────
    const today = new Date();
    const suggestedDates = [];
    let daysAhead = 0;
    while (suggestedDates.length < 3) {
      daysAhead++;
      const d = new Date(today);
      d.setDate(today.getDate() + daysAhead);
      const dow = d.getDay(); // 0=Sun, 6=Sat
      if (dow === 6 || dow === 0) {
        suggestedDates.push({
          date: d.toISOString().split("T")[0],
          confidence: 75 - suggestedDates.length * 5,
          reason:
            suggestedDates.length === 0
              ? "Optimal weekend attendance"
              : suggestedDates.length === 1
              ? "Good for industry calendar"
              : "Avoids major holidays",
        });
      }
    }

    return {
      price: {
        suggestedPrice: pricing.base,
        priceRange:     { min: pricing.min, max: pricing.max },
        marketAverage:  Math.round(pricing.base * 0.95),
        demandScore:    0.65,
        confidence:     70,
        reasoning:      `Based on typical ${eventType} events in similar locations`,
      },
      tags: {
        suggestedTags: tags.map((name, i) => ({
          name,
          popularity: Math.max(85 - i * 5, 40),
          relevance:  Math.max(90 - i * 3, 50),
        })),
        recommended: tags.slice(0, 3),
      },
      totalSlots: {
        suggestedSlots: slots.suggested,
        minSlots:       slots.min,
        maxSlots:       slots.max,
        reason:         `Recommended capacity for a ${eventType} event in ${location}`,
        confidence:     70,
      },
      dateTime: {
        suggestedDates,
        suggestedDayOfWeek: "Saturday",
        suggestedTime:      "10:00",
        seasonalFactor:     0.75,
      },
      timeline: {
        phases: [
          { phase: "Planning",    duration: "4 weeks",  tasks: ["Venue booking", "Vendor selection", "Marketing launch"] },
          { phase: "Preparation", duration: "2 weeks",  tasks: ["Final confirmations", "Logistics setup", "Attendee communication"] },
          { phase: "Execution",   duration: "Event day", tasks: ["Setup", "Registration", "Event delivery"] },
          { phase: "Follow-up",   duration: "1 week",   tasks: ["Feedback collection", "Thank-you messages", "Review analysis"] },
        ],
      },
      marketing: {
        channels:  ["Social Media", "Email Campaign", "Local Listings"],
        tips: [
          `Announce the event 4–6 weeks in advance for best reach`,
          `Use early-bird pricing to drive initial ticket sales`,
          `Share behind-the-scenes content to build excitement`,
        ],
      },
      _fallback: true,
      _fallbackReason: "AI agent unavailable — rule-based suggestions used",
    };
  }

  // ============================================================================
  // EVENT RECOMMENDATION METHODS
  // ============================================================================

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

      const response = await axios.post(
        `${this.aiAgentUrl}/api/agents/user/recommendations`,
        { userId, limit, userContext, candidateEvents },
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

  // ============================================================================
  // BOOKING SUPPORT AGENT METHODS
  // ============================================================================

  async chatBookingSupport(data) {
    try {
      console.log(
        `💬 Forwarding chat to AI Agent: ${data.message?.substring(0, 50)}...`
      );
      const response = await axios.post(
        `${this.aiAgentUrl}/api/agents/user/booking-support/chat`,
        data,
        { timeout: 30000, headers: { "Content-Type": "application/json" } }
      );
      console.log(`✅ AI Agent responded successfully`);
      return response.data;
    } catch (error) {
      console.error("Booking support chat error:", error.message);
      throw new Error(
        error.response?.data?.message ||
          error.message ||
          "Failed to communicate with booking support agent"
      );
    }
  }

  async clearBookingSupportHistory(data) {
    try {
      console.log(`🗑️ Clearing history for: ${data.userId || data.sessionId}`);
      const response = await axios.post(
        `${this.aiAgentUrl}/api/agents/user/booking-support/clear-history`,
        data,
        { timeout: 5000, headers: { "Content-Type": "application/json" } }
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

  async checkBookingSupportHealth() {
    try {
      const response = await axios.get(
        `${this.aiAgentUrl}/api/agents/user/booking-support/health`,
        { timeout: 5000 }
      );
      return response.data;
    } catch (error) {
      const unavailable = this._isAgentUnavailable(error);
      return {
        success: false,
        status: unavailable ? "agent_offline" : "unhealthy",
        message: unavailable
          ? `AI Agent server not reachable at ${this.aiAgentUrl}. Built-in FAQ fallback is active.`
          : error.message,
        fallback_active: unavailable,
        url: this.aiAgentUrl,
        timestamp: new Date().toISOString(),
      };
    }
  }

  async getBookingSupportStats() {
    return this._request("get", "/api/agents/user/booking-support/stats", null, {
      timeout: 5000,
    });
  }

  // ============================================================================
  // AI ORGANIZER / PLANNING AGENT METHODS
  // ============================================================================

  /**
   * planEvent — called by the planEvent controller.
   *
   * Tries the AI agent first. If the agent is unavailable (timeout / connection
   * refused) it falls back to rule-based suggestions so the controller always
   * receives a successful response — no more 500 errors when the agent is down.
   *
   * Returns:
   *   { success: true, suggestions: Object, metadata: Object }
   *
   * The controller wraps this into:
   *   response.data.data.fullSuggestions.suggestions
   *
   * @param {Object} eventData
   * @returns {Promise<{ success: boolean, suggestions: Object, metadata: Object }>}
   */
  async planEvent(eventData) {
    console.log(
      `📡 planEvent → AI Agent for: ${eventData.eventName || eventData.event_name || eventData.eventType}`
    );

    try {
      const response = await axios.post(
        `${this.aiAgentUrl}/api/agents/organizer/planning/suggest`,
        eventData,
        { timeout: 10000 }
      );

      const agentData = response.data;

      // Normalise — handle any shape the agent might return
      const suggestions =
        agentData?.data?.fullSuggestions?.suggestions ?? // already wrapped
        agentData?.data?.suggestions ??
        agentData?.suggestions ??
        agentData?.data ??
        agentData;

      const metadata = agentData?.metadata ?? agentData?.data?.metadata ?? {};

      console.log(`✅ planEvent AI Agent responded`);

      return {
        success: true,
        suggestions,
        metadata,
      };
    } catch (error) {
      // ── Agent unavailable or timed out — use rule-based fallback ──────────
      const isUnavailable = this._isAgentUnavailable(error);
      const isTimeout =
        error.code === "ECONNABORTED" ||
        (error.message && error.message.includes("timeout"));

      if (isUnavailable || isTimeout) {
        console.warn(
          `⚠️ planEvent: AI agent ${isTimeout ? "timed out" : "unavailable"} — using rule-based fallback suggestions`
        );

        const fallbackSuggestions = this._generateFallbackSuggestions(eventData);

        return {
          success: true,
          suggestions: fallbackSuggestions,
          metadata: {
            llm_enhanced: false,
            source: "fallback",
            reason: isTimeout ? "agent_timeout" : "agent_offline",
          },
        };
      }

      // ── Any other error (bad request, 4xx, etc.) — still fallback gracefully
      console.error("planEvent AI agent call failed:", error.message);
      console.warn("⚠️ planEvent: falling back to rule-based suggestions due to unexpected error");

      const fallbackSuggestions = this._generateFallbackSuggestions(eventData);

      return {
        success: true,
        suggestions: fallbackSuggestions,
        metadata: {
          llm_enhanced: false,
          source: "fallback",
          reason: "agent_error",
          error: error.response?.data?.message || error.message,
        },
      };
    }
  }

  /**
   * getPlanningSuggestions — legacy alias kept for backwards compatibility.
   */
  async getPlanningSuggestions(eventData) {
    console.log(
      `📡 getPlanningSuggestions → AI Agent for: ${eventData.event_name}`
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

  // ============================================================================
  // ORGANIZER DASHBOARD AGENT METHODS
  // ============================================================================

  async getDashboardInsights(organizerId, metricsData) {
    try {
      console.log(
        `📊 Requesting dashboard insights for organizer: ${organizerId}`
      );
      const response = await this._request(
        "post",
        "/api/agents/organizer/dashboard/insights",
        { organizerId, metrics: metricsData },
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
        `❓ Processing dashboard query for ${organizerId}: ${query.substring(0, 50)}...`
      );
      const response = await this._request(
        "post",
        "/api/agents/organizer/dashboard/query",
        { organizerId, query, context },
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
        { organizerId, metrics: metricsData },
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
      let agent = await AI_Agent.findOne({
        name: "Organizer Dashboard Assistant",
        agent_type: "organizer",
        role: "assistant",
      });

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
      return response.data;
    } catch (error) {
      console.error("Dashboard agent health check error:", error.message);
      throw new Error(
        error.response?.data?.message ||
          "Failed to get dashboard agent health status"
      );
    }
  }
}

const aiService = new AIService();
export default aiService;