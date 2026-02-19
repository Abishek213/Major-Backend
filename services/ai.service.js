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
 */

class AIService {
  constructor() {
    this.aiAgentUrl = process.env.AI_AGENT_SERVICE_URL || "http://localhost:3002"

    // ── Built-in FAQ knowledge base ─────────────────────────────────────────
    // Used as fallback when the external AI agent is unreachable.
    // Add / edit entries freely — each entry has keywords and a response.
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
        select: "event_name category tags price location event_date attendees totalSlots",
        populate: { path: "category", select: "category_Name" },
      })
      .select("eventId")
      .lean();

    const bookedEvents = bookings.map((b) => b.eventId).filter(Boolean);

    const reviews = await Review.find({ userId })
      .populate({
        path: "eventId",
        select: "event_name category tags price location event_date attendees totalSlots",
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

      return response.data.success ? response.data.recommendations : [];
    } catch (error) {
      console.error("AI Agent call failed:", error.message);
      return [];
    }
  }

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
   * Checks whether an error means the AI agent server is simply unreachable
   * (not running, wrong port, network issue, timeout).
   *
   * FIX: Added ECONNABORTED — this is the code axios sets when its own
   * `timeout` option fires (different from the OS-level ETIMEDOUT).
   * Without it, axios timeouts were falling through to the rethrow branch,
   * causing the controller to return a 500 instead of the FAQ fallback.
   */
  _isAgentUnavailable(error) {
    if (!error) return false;
    const code = error.code || "";
    const msg = (error.message || "").toLowerCase();
    return (
      code === "ECONNREFUSED"  ||  // nothing running on that port
      code === "ENOTFOUND"     ||  // DNS failure / bad hostname
      code === "ECONNRESET"    ||  // connection dropped mid-flight
      code === "ETIMEDOUT"     ||  // OS / TCP-level timeout
      code === "ECONNABORTED"  ||  // ← axios-level timeout (timeout: N ms)
      msg.includes("timeout")  ||  // catch-all for timeout phrasing
      msg.includes("network error")
    );
  }

  /**
   * Simple keyword-based FAQ matcher.
   * Scans the message against the built-in FAQ knowledge base and
   * returns the best matching response, or a generic fallback.
   */
  _buildFallbackResponse(message) {
    const lower = (message || "").toLowerCase();

    for (const entry of this._faqEntries) {
      if (entry.keywords.some((kw) => lower.includes(kw))) {
        return {
          success: true,
          response: entry.response,
          suggestions: [
            "How do I book an event?",
            "What is the refund policy?",
            "How do I contact support?",
            "Where can I find my ticket?",
          ],
          confidence: 0.75,
          source: "built_in_faq",
          timestamp: new Date().toISOString(),
        };
      }
    }

    // Generic fallback when no keywords match
    return {
      success: true,
      response:
        "Thank you for reaching out! I can help you with bookings, refunds, ticket transfers, payments, and account issues. " +
        "Could you please describe your question in a bit more detail? " +
        "You can also reach our support team at support@eventa.com.",
      suggestions: [
        "How do I book an event?",
        "What is the refund policy?",
        "How do I transfer my ticket?",
        "How do I contact support?",
      ],
      confidence: 0.5,
      source: "built_in_faq",
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Chat with booking support agent.
   *
   * Strategy:
   *   1. Try the external AI agent (30 s timeout — enough for LLM generation).
   *   2. If the agent is unreachable / down → answer from built-in FAQ.
   *   3. Any other unexpected error → rethrow so the controller returns 500.
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
          // 30s timeout — LLM responses can take 10-25s for complex queries.
          // ECONNABORTED was firing at 8s, cutting off valid AI responses.
          timeout: 60000,
          headers: { "Content-Type": "application/json" },
        }
      );

      console.log(`✅ AI Agent responded successfully`);
      return response.data;

    } catch (error) {
      if (this._isAgentUnavailable(error)) {
        // AI agent server is simply not running — use built-in FAQ
        console.warn(
          `⚠️  AI Agent unreachable (${error.code || error.message}). ` +
          `Serving built-in FAQ response.`
        );
        return this._buildFallbackResponse(data.message);
      }

      // Unexpected error (bad request, 500 from agent, etc.) — log and rethrow
      console.error("Booking support chat error:", error.message);
      throw new Error(
        error.response?.data?.message ||
          error.message ||
          "Failed to communicate with booking support agent"
      );
    }
  }

  /**
   * Clear conversation history.
   * Gracefully handles the case where the agent server is down.
   */
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
      if (this._isAgentUnavailable(error)) {
        console.warn("⚠️  AI Agent unreachable — skipping remote history clear.");
        return {
          success: true,
          message: "Conversation history cleared (local session reset).",
        };
      }

      console.error("Clear history error:", error.message);
      throw new Error(
        error.response?.data?.message || "Failed to clear conversation history"
      );
    }
  }

  /**
   * Check booking support agent health.
   * Never throws — always returns a health object the controller can forward.
   */
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

  /**
   * Get booking support agent statistics.
   */
  async getBookingSupportStats() {
    try {
      const response = await axios.get(
        `${this.aiAgentUrl}/api/agents/user/booking-support/stats`,
        { timeout: 5000 }
      );
      return response.data;
    } catch (error) {
      if (this._isAgentUnavailable(error)) {
        return {
          success: false,
          status: "agent_offline",
          message: "AI Agent server is not running. Stats unavailable.",
          fallback_active: true,
        };
      }
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