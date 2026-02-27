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

// ─────────────────────────────────────────────────────────────────────────────
// Per-user AI generation coalescing map (Bug B fix)
//
// Problem: React StrictMode (dev) and concurrent renders cause 3 simultaneous
// GET /ai/recommendations/me requests. All 3 find an empty cache, call the AI
// agent 3×, and call storeRecommendations 3×. Without the compound unique index
// physically present in MongoDB, this inserts 60 rows (3 × 20) for 20 unique
// events. The read-side dedup catches it, but the AI agent is wastefully called
// 3 times and the DB accumulates stale duplicate rows on every cold start.
//
// Fix: store the in-flight AI generation Promise per userId. Concurrent requests
// for the same user wait on the SAME promise rather than starting their own.
// All waiters then read from cache once the first completes.
// Map is module-level (singleton per Node.js process) — correct for a single
// instance; for multi-instance deployments replace with Redis-based distributed lock.
// ─────────────────────────────────────────────────────────────────────────────
const _inFlightGeneration = new Map(); // userId → Promise<void>

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

          await AIService.storeRecommendations(
            userId,
            recommendations,
            agent._id
          );

          await AI_ActionLog.create({
            agentId: agent._id,
            userId: userId,
            logType: "recommendation",
            actionDetails: { count: recommendations.length, source: "ai_agent" },
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

/**
 * GET /api/ai/recommendations/me
 *
 * Called by the frontend RecommendationService → recommendationService.js
 * Returns DB-stored recommendations for the authenticated user, with the full
 * event and category fields populated so the frontend normalizer works correctly.
 *
 * FIXES APPLIED:
 *
 * Bug 2 — This function previously only read from the DB and never triggered AI
 * generation. If the DB was empty (first-time user, expired cache) it returned [].
 * Now it falls through: DB cache → AI Agent → fallback events, matching the same
 * resilience pattern used in getUserRecommendations.
 *
 * Bug 3 — event_id was populated with a single `.populate("event_id")` call,
 * which left the nested `category` field as a raw ObjectId. The frontend
 * normalizer reads `ev.category?.category_Name`, so every card showed "General".
 * Fixed with a nested populate that also resolves `category` inside `event_id`.
 *
 * Bug 5 — A manual for-loop re-fetched the event document when `event_id` was
 * a plain string. After `.populate("event_id").lean()`, event_id is already an
 * object, so the condition `typeof rec.event_id === "string"` was always false
 * and the loop never ran. The loop was dead code and has been removed.
 */
export const getMyRecommendations = async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 10, refresh = "false" } = req.query;
    const parsedLimit = parseInt(limit);

    let recommendations = [];
    let source = "cache";

    // ── Step 1: Try DB cache first (skip when ?refresh=true) ───────────────
    if (refresh !== "true") {
      const raw = await AI_Recommendation.find({ user_id: userId })
        .populate({
          path: "event_id",
          populate: { path: "category", select: "category_Name" },
        })
        .populate("agent_id", "name role agent_type")
        .sort({ confidence_score: -1, createdAt: -1 })
        // Fetch more than limit before dedup so we still return parsedLimit unique events
        .limit(parsedLimit * 3)
        .lean();

      // FIX (Duplicate React key): The DB may still contain stale duplicate
      // rows for the same (user_id, event_id) pair inserted before the bulkWrite
      // upsert fix was deployed. The unique compound index on the schema prevents
      // future duplicates but does not clean up existing ones.
      // Dedup by event_id string so the frontend never receives two records for
      // the same event — which caused React duplicate key warnings and the same
      // card appearing twice in the recommendations grid.
      const seen = new Set();
      recommendations = raw
        .filter((rec) => {
          const evId =
            rec.event_id?._id?.toString() || rec.event_id?.toString();
          if (!evId || seen.has(evId)) return false;
          seen.add(evId);
          return true;
        })
        .slice(0, parsedLimit);

      if (recommendations.length > 0) {
        source = "cache";
      }
    }

    // ── Step 2: Generate via AI Agent if cache miss or refresh requested ────
    if (recommendations.length === 0 || refresh === "true") {
      // FIX (Bug B): Request coalescing — prevent concurrent requests for the
      // same user each triggering their own AI generation + store cycle.
      //
      // If an AI generation for this userId is already in progress (e.g. from
      // React StrictMode double-mount or two browser tabs), wait for the
      // existing promise to resolve rather than starting a new one.
      // All waiters then re-read from cache in Step 1's query above.
      const existingPromise = _inFlightGeneration.get(userId);

      if (existingPromise) {
        // Another request is already generating — wait for it, then read cache.
        try {
          await existingPromise;
        } catch {
          // If the leader failed, we'll fall through to Step 3 fallback below.
        }

        // Re-read from cache now that the leader has stored recommendations.
        if (refresh !== "true") {
          const rawAfterWait = await AI_Recommendation.find({ user_id: userId })
            .populate({
              path: "event_id",
              populate: { path: "category", select: "category_Name" },
            })
            .populate("agent_id", "name role agent_type")
            .sort({ confidence_score: -1, createdAt: -1 })
            .limit(parsedLimit * 3)
            .lean();

          const seenWait = new Set();
          recommendations = rawAfterWait
            .filter((rec) => {
              const evId =
                rec.event_id?._id?.toString() || rec.event_id?.toString();
              if (!evId || seenWait.has(evId)) return false;
              seenWait.add(evId);
              return true;
            })
            .slice(0, parsedLimit);

          if (recommendations.length > 0) source = "cache";
        }
      } else {
        // This request is the leader — run AI generation and coalesce waiters.
        const generationPromise = (async () => {
          const agent = await AIService.getRecommendationAgent();
          const aiRecommendations = await AIService.getAIRecommendations(
            userId,
            parsedLimit
          );

          if (aiRecommendations.length > 0) {
            await AIService.storeRecommendations(
              userId,
              aiRecommendations,
              agent._id
            );

            await AI_ActionLog.create({
              agentId: agent._id,
              userId,
              logType: "recommendation",
              actionDetails: {
                count: aiRecommendations.length,
                source: "ai_agent",
              },
            });
          }

          return aiRecommendations.length;
        })();

        _inFlightGeneration.set(userId, generationPromise);

        try {
          await generationPromise;

          // Re-fetch from DB with full population so the response has the same
          // shape the frontend normalizer expects.
          const rawAI = await AI_Recommendation.find({ user_id: userId })
            .populate({
              path: "event_id",
              populate: { path: "category", select: "category_Name" },
            })
            .populate("agent_id", "name role agent_type")
            .sort({ confidence_score: -1, createdAt: -1 })
            .limit(parsedLimit * 3)
            .lean();

          const seenAI = new Set();
          recommendations = rawAI
            .filter((rec) => {
              const evId =
                rec.event_id?._id?.toString() || rec.event_id?.toString();
              if (!evId || seenAI.has(evId)) return false;
              seenAI.add(evId);
              return true;
            })
            .slice(0, parsedLimit);

          if (recommendations.length > 0) source = "ai_agent";
        } catch (aiError) {
          console.warn("AI Agent unavailable:", aiError.message);
        } finally {
          // Always release the lock so future requests don't wait indefinitely.
          _inFlightGeneration.delete(userId);
        }
      }
    }

    // ── Step 3: Fallback to popular events if DB + AI both returned nothing ─
    if (recommendations.length === 0) {
      const fallbackRaw = await AIService.getFallbackRecommendations(
        userId,
        parsedLimit
      );

      // Shape the fallback data to match the DB-populated structure that
      // the frontend normalizeRecommendation() function expects, where
      // rec.event_id is a full event object (not a raw ID).
      recommendations = fallbackRaw.map((rec) => ({
        _id: rec.event_id,
        event_id: {
          _id: rec.event_id,
          event_name: rec.event_name,
          description: rec.description,
          price: rec.price,
          location: rec.location,
          event_date: rec.event_date,
          time: rec.time,
          category: rec.category,
          tags: rec.tags || [],
          image: rec.image || null,
          attendees: rec.attendees || [],
          totalSlots: rec.totalSlots || 0,
        },
        confidence_score: rec.confidence_score,
        recommendation_reason: rec.recommendation_reason,
        source: rec.source,
        agent_id: null,
      }));

      source = "fallback";
    }

    res.json({
      success: true,
      count: recommendations.length,
      source,
      data: recommendations,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== BOOKING SUPPORT CHAT ====================

export const chatBookingSupport = async (req, res) => {
  try {
    const {
      message,
      language = "en",
      agent = "assistant",
      agentType,
    } = req.body;
    const resolvedAgent =
      agent !== "assistant" ? agent : agentType ?? "assistant";
    const userId = req.user?.id || req.body.userId;
    const sessionId = req.body.sessionId;

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
      `💬 Booking support chat from ${userId || sessionId || "anonymous"} ` +
        `[lang=${language}, agent=${resolvedAgent}]`
    );

    const response = await AIService.chatBookingSupport({
      message,
      language,
      agentType: resolvedAgent,
      userId: userId || sessionId,
      sessionId,
    });

    res.json(response);
  } catch (error) {
    console.error("Booking support chat error:", error);
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
      return res
        .status(400)
        .json({ success: false, message: "userId or sessionId is required" });
    }

    console.log(`🗑️ Clearing history for ${userId || sessionId}`);

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

export const clearBookingSupportHistoryAnonymous = async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res
        .status(400)
        .json({ success: false, message: "sessionId is required" });
    }

    console.log(`🗑️ Clearing anonymous history for session: ${sessionId}`);

    const response = await AIService.clearBookingSupportHistory({
      userId: null,
      sessionId,
    });

    res.json(response);
  } catch (error) {
    console.error("Anonymous clear history error:", error);
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

// ============================================================================
// EVENT REQUEST AI PROCESSING
// These endpoints are called internally by eventrequest.controller.js
// via AI_AGENT_URL — they use the existing AIService / booking-support
// infrastructure to extract entities and match organizers from natural language.
// ============================================================================

export const processEventRequest = async (req, res) => {
  try {
    const { naturalLanguage, userId } = req.body;

    if (!naturalLanguage || typeof naturalLanguage !== "string") {
      return res.status(400).json({
        success: false,
        message: "naturalLanguage is required and must be a string",
      });
    }

    console.log(
      `🎯 Processing event request from user: ${userId || "anonymous"}`
    );
    console.log(`📝 Natural language: ${naturalLanguage.substring(0, 100)}...`);

    let extractedEntities = extractEntitiesLocally(naturalLanguage);

    try {
      const chatResponse = await AIService.chatBookingSupport({
        message: `Extract event details from: "${naturalLanguage}". 
          Reply ONLY with JSON: { "eventType": "", "locations": [], "date": "", "budget": "", "attendees": "" }`,
        agentType: "assistant",
        userId: userId || "system",
        sessionId: `extract_${Date.now()}`,
      });

      const aiText =
        chatResponse?.data?.response ||
        chatResponse?.response ||
        chatResponse?.message ||
        "";

      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        extractedEntities = {
          eventType: parsed.eventType || extractedEntities.eventType,
          locations: parsed.locations?.length
            ? parsed.locations
            : extractedEntities.locations,
          date: parsed.date || extractedEntities.date,
          budget: parsed.budget || extractedEntities.budget,
          attendees: parsed.attendees || extractedEntities.attendees,
        };
      }
    } catch (aiErr) {
      // AI extraction failed — local extraction is already set, continue
      console.warn(
        "AI entity extraction failed, using local fallback:",
        aiErr.message
      );
    }

    const matchedOrganizers = await findMatchingOrganizers(extractedEntities);

    // ── Step 3: Build budget analysis ─────────────────────────────────────
    const budgetAnalysis = analyzeBudget(
      extractedEntities.budget,
      extractedEntities.attendees
    );

    // ── Step 4: Build AI suggestions ──────────────────────────────────────
    const aiSuggestions = buildSuggestions(extractedEntities);

    try {
      let agent = await AI_Agent.findOne({ name: "event-request-agent" });
      if (!agent) {
        agent = await AI_Agent.create({
          name: "event-request-agent",
          role: "assistant",
          agent_type: "user",
          status: "active",
          capabilities: {
            event_request_processing: true,
            entity_extraction: true,
          },
        });
      }

      await AI_ActionLog.create({
        agentId: agent._id,
        userId: userId || null,
        logType: "event_request",
        actionDetails: {
          naturalLanguage: naturalLanguage.substring(0, 200),
          extractedEntities,
          matchCount: matchedOrganizers.length,
        },
      });
    } catch (logErr) {
      console.warn("Action log failed (non-critical):", logErr.message);
    }

    res.status(200).json({
      success: true,
      extractedEntities,
      matchedOrganizers,
      budgetAnalysis,
      aiSuggestions,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Event request processing error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to process event request",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const getEventSuggestions = async (req, res) => {
  try {
    const { eventType, budget, location, date } = req.query;

    console.log(
      `🔍 Fetching organizer suggestions for: ${eventType} in ${location}`
    );

    const extractedEntities = {
      eventType: eventType || "General",
      locations: location ? [location] : [],
      date: date || "",
      budget: budget || "",
      attendees: "",
    };

    const matchedOrganizers = await findMatchingOrganizers(extractedEntities);

    res.status(200).json({
      success: true,
      matchedOrganizers,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Event suggestions error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get event suggestions",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// ── Private helpers ───────────────────────────────────────────────────────────

function extractEntitiesLocally(text) {
  const lower = text.toLowerCase();

  const eventTypeMap = {
    conference: ["conference", "summit", "convention"],
    workshop: ["workshop", "training", "seminar", "class"],
    wedding: ["wedding", "marriage", "bridal"],
    birthday: ["birthday", "bday", "birth day"],
    concert: ["concert", "gig", "performance", "show"],
    festival: ["festival", "fest", "fair", "expo"],
    corporate: ["corporate", "business", "company", "office"],
    music: ["music", "band", "dj"],
    sports: ["sports", "game", "match", "tournament"],
    technology: [
      "tech",
      "technology",
      "it",
      "software",
      "developer",
      "coding",
    ],
  };

  let eventType = "General";
  for (const [type, keywords] of Object.entries(eventTypeMap)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      eventType = type.charAt(0).toUpperCase() + type.slice(1);
      break;
    }
  }

  const locationKeywords = [
    "kathmandu",
    "pokhara",
    "lalitpur",
    "bhaktapur",
    "biratnagar",
    "birgunj",
    "dharan",
    "butwal",
    "chitwan",
    "online",
    "virtual",
  ];
  const locations = locationKeywords.filter((loc) => lower.includes(loc));
  if (locations.length === 0 && lower.includes("nepal"))
    locations.push("Nepal");

  let date = "";
  if (lower.includes("next month")) date = "Next Month";
  else if (lower.includes("next week")) date = "Next Week";
  else if (lower.includes("this weekend") || lower.includes("weekend"))
    date = "This Weekend";
  else if (lower.includes("tomorrow")) date = "Tomorrow";
  else if (lower.includes("today")) date = "Today";

  let budget = "";
  const budgetMatch = lower.match(
    /\$[\d,]+|rs\.?\s*[\d,]+|npr\.?\s*[\d,]+|[\d,]+\s*(?:budget|npr|rs)/i
  );
  if (budgetMatch) budget = budgetMatch[0];
  else if (lower.includes("free")) budget = "Free";
  else if (lower.includes("low budget")) budget = "Low Budget";

  let attendees = "";
  const attendeeMatch = lower.match(
    /(\d+)\s*(?:people|persons|attendees|guests|participants)/i
  );
  if (attendeeMatch) attendees = attendeeMatch[1];
  else if (lower.includes("small")) attendees = "< 50";
  else if (lower.includes("large")) attendees = "> 200";

  return { eventType, locations, date, budget, attendees };
}

async function findMatchingOrganizers(entities) {
  try {
    const Role = (await import("../model/role.schema.js")).default;
    const User = (await import("../model/user.schema.js")).default;

    const organizerRole = await Role.findOne({ role_Name: "Organizer" });
    if (!organizerRole) return buildFallbackOrganizers(entities);

    const organizers = await User.find({ role: organizerRole._id })
      .select("fullname email contactNo profileImage")
      .limit(10)
      .lean();

    if (!organizers.length) return buildFallbackOrganizers(entities);

    return organizers.map((org, idx) => ({
      id: org._id,
      name: org.fullname,
      email: org.email,
      matchScore: Math.max(95 - idx * 7, 60),
      specialization: entities.eventType || "General Events",
      rating: (4.5 - idx * 0.1).toFixed(1),
      responseTime:
        idx === 0 ? "< 1 hour" : idx === 1 ? "< 3 hours" : "< 24 hours",
      completedEvents: Math.max(50 - idx * 5, 10),
      successRate: `${Math.max(98 - idx * 2, 85)}%`,
    }));
  } catch (err) {
    console.warn("DB organizer lookup failed, using fallback:", err.message);
    return buildFallbackOrganizers(entities);
  }
}

function buildFallbackOrganizers(entities) {
  const type = entities.eventType || "General";
  return [
    {
      id: "fallback_1",
      name: `${type} Events Co.`,
      matchScore: 90,
      specialization: `${type} Events`,
      rating: "4.8",
      responseTime: "< 1 hour",
      completedEvents: 45,
      successRate: "97%",
    },
    {
      id: "fallback_2",
      name: "Kathmandu Event Planners",
      matchScore: 82,
      specialization: "Local Events",
      rating: "4.5",
      responseTime: "< 3 hours",
      completedEvents: 28,
      successRate: "95%",
    },
    {
      id: "fallback_3",
      name: "Nepal Pro Organizers",
      matchScore: 75,
      specialization: "All Event Types",
      rating: "4.3",
      responseTime: "< 24 hours",
      completedEvents: 60,
      successRate: "92%",
    },
  ];
}

function analyzeBudget(budget, attendees) {
  if (!budget) return { feasibility: "unknown", note: "No budget specified" };

  const lower = budget.toLowerCase();
  if (lower === "free")
    return { feasibility: "high", note: "Free events are easy to organize" };

  const numMatch = budget.match(/[\d,]+/);
  if (numMatch) {
    const amount = parseInt(numMatch[0].replace(/,/g, ""));
    if (amount < 10000)
      return {
        feasibility: "low",
        note: "Budget may be tight for a quality event",
      };
    if (amount < 50000)
      return {
        feasibility: "moderate",
        note: "Budget is workable for a mid-size event",
      };
    return {
      feasibility: "high",
      note: "Budget looks comfortable for this event size",
    };
  }

  return {
    feasibility: "moderate",
    note: "Budget noted — organizer will confirm feasibility",
  };
}

function buildSuggestions(entities) {
  const tips = [];
  if (!entities.date)
    tips.push(
      "Consider specifying a date — organizers can confirm availability faster"
    );
  if (!entities.budget)
    tips.push("Sharing a budget range helps organizers give accurate proposals");
  if (!entities.attendees)
    tips.push("Mentioning expected attendance helps plan venue and catering");
  if (entities.locations.length === 0)
    tips.push("Specifying a location helps match local organizers");

  return {
    tip:
      tips[0] ||
      "Book at least 4 weeks in advance for best organizer availability",
    allTips: tips,
  };
}

// ======================================================
// ===================== Org Ai Agent ===================
// ======================================================

// ==================== EVENT PLANNING ====================
export const planEvent = async (req, res) => {
  const startTime = Date.now();

  try {
    const {
      eventType,
      category,
      budget,
      attendees,
      location,
      eventDate,
      description,
      // Accept both camelCase and snake_case from the frontend
      event_type,
      event_date,
      event_name,
      eventName,
      totalSlots,
      total_slots,
      time,
    } = req.body;

    // ── Resolve eventType ────────────────────────────────────────────────────
    const isObjectId = (val) =>
      typeof val === "string" && /^[a-f\d]{24}$/i.test(val);

    const resolvedEventType =
      eventType ||
      event_type ||
      (isObjectId(category) ? "general" : category) ||
      "general";

    const resolvedLocation   = location   || "TBD";
    const resolvedEventDate  = eventDate  || event_date;
    const resolvedEventName  = eventName  || event_name || "Untitled Event";
    const resolvedTotalSlots = parseInt(totalSlots || total_slots) || 100;
    const organizerId        = req.user?.id;

    // ── Validation ──────────────────────────────────────────────────────────
    if (!resolvedEventType || !resolvedLocation || !resolvedEventDate) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: eventType (or category), location, eventDate",
      });
    }

    const validEventTypes = [
      "conference",
      "workshop",
      "wedding",
      "birthday",
      "concert",
      "festival",
    ];

    if (!validEventTypes.includes(resolvedEventType.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: `Invalid event type. Must be one of: ${validEventTypes.join(
          ", "
        )}`,
      });
    }

    if (budget && Number(budget) <= 0) {
      return res
        .status(400)
        .json({ success: false, message: "Budget must be a positive number" });
    }

    if (attendees && Number(attendees) <= 0) {
      return res.status(400).json({
        success: false,
        message: "Attendees must be a positive number",
      });
    }

    const eventDateObj = new Date(resolvedEventDate);
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

    // ── Ensure planning agent exists in DB ──────────────────────────────────
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

    // ── Call AI service ─────────────────────────────────────────────────────
    // Pass ALL field name variants so the AI agent handles either convention.
    const planningResult = await AIService.planEvent({
      // camelCase
      eventName:   resolvedEventName,
      eventType:   resolvedEventType.toLowerCase(),
      eventDate:   resolvedEventDate,
      totalSlots:  resolvedTotalSlots,
      // snake_case
      event_name:  resolvedEventName,
      event_type:  resolvedEventType.toLowerCase(),
      event_date:  resolvedEventDate,
      total_slots: resolvedTotalSlots,
      // shared
      location:    resolvedLocation,
      category:    resolvedEventType.toLowerCase(),
      budget:      parseFloat(budget) || 0,
      attendees:   parseInt(attendees) || 50,
      description: description || "",
      time:        time || "10:00",
      organizerId,
    });

    const processingTime = Date.now() - startTime;

    // ── Log failure ─────────────────────────────────────────────────────────
    if (!planningResult.success) {
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

    // ── Log success ─────────────────────────────────────────────────────────
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

    // ── Respond ─────────────────────────────────────────────────────────────
    // Shape the frontend reads:
    //   response.data.data.fullSuggestions.suggestions
    res.status(200).json({
      success: true,
      message: "Event plan generated successfully",
      data: {
        fullSuggestions: {
          suggestions: planningResult.suggestions,
        },
        processing_time: processingTime,
        agent_info: {
          agent_id:    planningAgent._id,
          agent_name:  planningAgent.name,
          llm_enhanced: planningResult.metadata?.llm_enhanced || false,
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error("❌ Event planning error:", error);

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

export const getPlanningAgentStats = async (req, res) => {
  try {
    const organizerId = req.user?.id;
    const { timeRange = "30d" } = req.query;

    const daysBack =
      timeRange === "7d" ? 7 : timeRange === "90d" ? 90 : 30;
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - daysBack);

    const agent = await AI_Agent.findOne({ name: "planning-agent" });

    if (!agent) {
      return res
        .status(404)
        .json({ success: false, message: "Planning agent not found" });
    }

    const filter = {
      agentId: agent._id,
      logType: "event_planning",
      createdAt: { $gte: dateFrom },
    };
    if (organizerId) filter.userId = organizerId;

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

    const eventTypeStats = await AI_ActionLog.aggregate([
      { $match: { ...filter, success: true } },
      { $group: { _id: "$actionDetails.eventType", count: { $sum: 1 } } },
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

    const riskScore = calculateRiskScore(booking);

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

    await AI_ActionLog.create({
      agentId: fraudAgent._id,
      userId: booking.userId,
      logType: "fraud_check",
      actionDetails: { bookingId, riskScore, status: fraudCheck.fraudStatus },
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

    res.status(201).json({ success: true, data: sentimentAnalysis });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== AI DASHBOARD (Admin) ====================
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

// ======================================================
// =========== Organizer Dashboard Functions ============
// ======================================================

// Helper: parse dateRange query param (e.g. "month:1", "month:3", "week:1")
function parseDateRange(dateRange = "month:1") {
  const [unit, amount] = dateRange.split(":");
  const num = parseInt(amount) || 1;
  const dateFrom = new Date();
  if (unit === "week") dateFrom.setDate(dateFrom.getDate() - num * 7);
  else if (unit === "year") dateFrom.setFullYear(dateFrom.getFullYear() - num);
  else dateFrom.setMonth(dateFrom.getMonth() - num);
  return dateFrom;
}

// GET /api/v1/ai/dashboard/metrics/:id
export const getOrganizerMetrics = async (req, res) => {
  try {
    const { id: organizerId } = req.params;
    const { dateRange = "month:1" } = req.query;
    const dateFrom = parseDateRange(dateRange);

    const events = await Event.find({ organizer: organizerId }).select(
      "_id totalSlots"
    );
    const eventIds = events.map((e) => e._id);

    if (!eventIds.length) {
      return res.json({
        success: true,
        data: {
          revenue: { total: 0 },
          bookings: { total: 0, conversionRate: 0 },
          events: { total: 0 },
          ratings: { total: 0, average: 0 },
        },
      });
    }

    const [bookings, reviews, totalEvents] = await Promise.all([
      Booking.find({
        event: { $in: eventIds },
        createdAt: { $gte: dateFrom },
        status: { $in: ["confirmed", "completed"] },
      }).select("totalPrice event createdAt"),
      Review.find({ eventId: { $in: eventIds } }).select("rating"),
      Event.countDocuments({ organizer: organizerId }),
    ]);

    const totalRevenue = bookings.reduce(
      (sum, b) => sum + (b.totalPrice || 0),
      0
    );
    const totalBookings = bookings.length;
    const totalSlots = events.reduce((sum, e) => sum + (e.totalSlots || 0), 0);
    const conversionRate = totalSlots > 0 ? totalBookings / totalSlots : 0;
    const avgRating =
      reviews.length > 0
        ? reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / reviews.length
        : 0;

    res.json({
      success: true,
      data: {
        revenue: { total: totalRevenue },
        bookings: { total: totalBookings, conversionRate },
        events: { total: totalEvents },
        ratings: { total: reviews.length, average: avgRating },
      },
    });
  } catch (error) {
    console.error("getOrganizerMetrics error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/ai/dashboard/revenue/:id
export const getOrganizerRevenue = async (req, res) => {
  try {
    const { id: organizerId } = req.params;
    const { dateRange = "month:1" } = req.query;
    const dateFrom = parseDateRange(dateRange);

    const events = await Event.find({ organizer: organizerId }).select(
      "_id event_name"
    );
    const eventIds = events.map((e) => e._id);

    if (!eventIds.length) {
      return res.json({
        success: true,
        data: { total: 0, byEvent: [], byMonth: [] },
      });
    }

    const bookings = await Booking.find({
      event: { $in: eventIds },
      createdAt: { $gte: dateFrom },
      status: { $in: ["confirmed", "completed"] },
    }).select("totalPrice event createdAt");

    const revenueMap = {};
    bookings.forEach((b) => {
      const key = String(b.event);
      if (!revenueMap[key]) revenueMap[key] = { revenue: 0, bookings: 0 };
      revenueMap[key].revenue += b.totalPrice || 0;
      revenueMap[key].bookings += 1;
    });

    const byEvent = events
      .filter((e) => revenueMap[String(e._id)])
      .map((e) => ({
        _id: e._id,
        eventName: e.event_name,
        revenue: revenueMap[String(e._id)]?.revenue || 0,
        bookings: revenueMap[String(e._id)]?.bookings || 0,
      }));

    const monthMap = {};
    bookings.forEach((b) => {
      const key = `${b.createdAt.getFullYear()}-${b.createdAt.getMonth() + 1}`;
      if (!monthMap[key])
        monthMap[key] = {
          year: b.createdAt.getFullYear(),
          month: b.createdAt.getMonth() + 1,
          revenue: 0,
        };
      monthMap[key].revenue += b.totalPrice || 0;
    });

    const byMonth = Object.values(monthMap).sort(
      (a, b) => a.year - b.year || a.month - b.month
    );
    const total = bookings.reduce((sum, b) => sum + (b.totalPrice || 0), 0);

    res.json({ success: true, data: { total, byEvent, byMonth } });
  } catch (error) {
    console.error("getOrganizerRevenue error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/ai/dashboard/bookings/:id
export const getOrganizerBookings = async (req, res) => {
  try {
    const { id: organizerId } = req.params;
    const { dateRange = "month:1" } = req.query;
    const dateFrom = parseDateRange(dateRange);

    const events = await Event.find({ organizer: organizerId }).select(
      "_id event_name totalSlots"
    );
    const eventIds = events.map((e) => e._id);

    if (!eventIds.length) {
      return res.json({
        success: true,
        data: {
          total: 0,
          confirmed: 0,
          cancelled: 0,
          pending: 0,
          conversionRate: 0,
        },
      });
    }

    const [confirmed, cancelled, pending] = await Promise.all([
      Booking.countDocuments({
        event: { $in: eventIds },
        createdAt: { $gte: dateFrom },
        status: { $in: ["confirmed", "completed"] },
      }),
      Booking.countDocuments({
        event: { $in: eventIds },
        createdAt: { $gte: dateFrom },
        status: "cancelled",
      }),
      Booking.countDocuments({
        event: { $in: eventIds },
        createdAt: { $gte: dateFrom },
        status: "pending",
      }),
    ]);

    const total = confirmed + cancelled + pending;
    const totalSlots = events.reduce((sum, e) => sum + (e.totalSlots || 0), 0);
    const conversionRate = totalSlots > 0 ? confirmed / totalSlots : 0;

    res.json({
      success: true,
      data: { total, confirmed, cancelled, pending, conversionRate },
    });
  } catch (error) {
    console.error("getOrganizerBookings error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/ai/dashboard/trends/:id
export const getOrganizerTrends = async (req, res) => {
  try {
    const { id: organizerId } = req.params;
    const { dateRange = "month:1" } = req.query;
    const dateFrom = parseDateRange(dateRange);

    const events = await Event.find({ organizer: organizerId }).select("_id");
    const eventIds = events.map((e) => e._id);

    if (!eventIds.length) {
      return res.json({
        success: true,
        data: { bookingTrends: [], revenueTrends: [] },
      });
    }

    const bookings = await Booking.find({
      event: { $in: eventIds },
      createdAt: { $gte: dateFrom },
    }).select("totalPrice status createdAt");

    const dayMap = {};
    bookings.forEach((b) => {
      const key = b.createdAt.toISOString().split("T")[0];
      if (!dayMap[key]) dayMap[key] = { date: key, bookings: 0, revenue: 0 };
      dayMap[key].bookings += 1;
      if (["confirmed", "completed"].includes(b.status)) {
        dayMap[key].revenue += b.totalPrice || 0;
      }
    });

    const trends = Object.values(dayMap).sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    res.json({
      success: true,
      data: {
        bookingTrends: trends.map((t) => ({ date: t.date, count: t.bookings })),
        revenueTrends: trends.map((t) => ({
          date: t.date,
          revenue: t.revenue,
        })),
      },
    });
  } catch (error) {
    console.error("getOrganizerTrends error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/ai/dashboard/sentiment/:id
export const getOrganizerSentiment = async (req, res) => {
  try {
    const { id: organizerId } = req.params;

    const events = await Event.find({ organizer: organizerId }).select("_id");
    const eventIds = events.map((e) => e._id);

    if (!eventIds.length) {
      return res.json({
        success: true,
        data: {
          averageScore: 0,
          totalAnalyzed: 0,
          distribution: { positive: 0, neutral: 0, negative: 0 },
          commonIssues: [],
          overTime: [],
        },
      });
    }

    const reviews = await Review.find({
      eventId: { $in: eventIds },
    }).select("comment rating createdAt");

    let positive = 0,
      neutral = 0,
      negative = 0;
    let totalScore = 0;
    const issueCount = {};

    reviews.forEach((r) => {
      const score = analyzeSentiment(r.comment);
      totalScore += score;
      if (score > 0.1) positive++;
      else if (score < -0.1) negative++;
      else neutral++;

      const issues = detectIssues(r.comment);
      issues.forEach((issue) => {
        issueCount[issue] = (issueCount[issue] || 0) + 1;
      });
    });

    const avgScore = reviews.length > 0 ? totalScore / reviews.length : 0;
    const commonIssues = Object.entries(issueCount)
      .map(([_id, count]) => ({ _id, count }))
      .sort((a, b) => b.count - a.count);

    const monthMap = {};
    reviews.forEach((r) => {
      const score = analyzeSentiment(r.comment);
      const key = `${r.createdAt.getFullYear()}-${r.createdAt.getMonth() + 1}`;
      if (!monthMap[key])
        monthMap[key] = {
          _id: {
            year: r.createdAt.getFullYear(),
            month: r.createdAt.getMonth() + 1,
          },
          scores: [],
        };
      monthMap[key].scores.push(score);
    });

    const overTime = Object.values(monthMap).map((m) => ({
      _id: m._id,
      averageScore:
        m.scores.reduce((a, b) => a + b, 0) / m.scores.length,
    }));

    res.json({
      success: true,
      data: {
        averageScore: avgScore,
        totalAnalyzed: reviews.length,
        distribution: { positive, neutral, negative },
        commonIssues,
        overTime,
      },
    });
  } catch (error) {
    console.error("getOrganizerSentiment error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/ai/dashboard/ratings/:id
export const getOrganizerRatings = async (req, res) => {
  try {
    const { id: organizerId } = req.params;
    const { dateRange = "month:1" } = req.query;
    const dateFrom = parseDateRange(dateRange);

    const events = await Event.find({ organizer: organizerId }).select(
      "_id event_name"
    );
    const eventIds = events.map((e) => e._id);

    if (!eventIds.length) {
      return res.json({
        success: true,
        data: { average: 0, total: 0, byEvent: [], distribution: {} },
      });
    }

    const reviews = await Review.find({
      eventId: { $in: eventIds },
      createdAt: { $gte: dateFrom },
    }).select("rating eventId");

    const total = reviews.length;
    const average =
      total > 0
        ? reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / total
        : 0;

    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    reviews.forEach((r) => {
      const star = Math.round(r.rating);
      if (distribution[star] !== undefined) distribution[star]++;
    });

    const eventRatingMap = {};
    reviews.forEach((r) => {
      const key = String(r.eventId);
      if (!eventRatingMap[key]) eventRatingMap[key] = { scores: [] };
      eventRatingMap[key].scores.push(r.rating || 0);
    });

    const byEvent = events
      .filter((e) => eventRatingMap[String(e._id)])
      .map((e) => {
        const scores = eventRatingMap[String(e._id)]?.scores || [];
        return {
          _id: e._id,
          eventName: e.event_name,
          averageRating:
            scores.length > 0
              ? scores.reduce((a, b) => a + b, 0) / scores.length
              : 0,
          totalReviews: scores.length,
        };
      });

    res.json({
      success: true,
      data: { average, total, distribution, byEvent },
    });
  } catch (error) {
    console.error("getOrganizerRatings error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/ai/dashboard/events/:id
export const getOrganizerEvents = async (req, res) => {
  try {
    const { id: organizerId } = req.params;
    const { dateRange = "month:1" } = req.query;
    const dateFrom = parseDateRange(dateRange);

    const events = await Event.find({
      organizer: organizerId,
      createdAt: { $gte: dateFrom },
    }).select(
      "_id event_name totalSlots event_date location category createdAt"
    );

    if (!events.length) {
      return res.json({
        success: true,
        data: { total: 0, attendanceDetails: [] },
      });
    }

    const eventIds = events.map((e) => e._id);

    const bookings = await Booking.find({
      event: { $in: eventIds },
      status: { $in: ["confirmed", "completed"] },
    }).select("event");

    const attendeeMap = {};
    bookings.forEach((b) => {
      const key = String(b.event);
      attendeeMap[key] = (attendeeMap[key] || 0) + 1;
    });

    const attendanceDetails = events.map((e) => {
      const attendeeCount = attendeeMap[String(e._id)] || 0;
      const totalSlots = e.totalSlots || 1;
      return {
        _id: e._id,
        event_name: e.event_name,
        event_date: e.event_date,
        location: e.location,
        totalSlots,
        attendeeCount,
        attendanceRate: attendeeCount / totalSlots,
      };
    });

    res.json({
      success: true,
      data: { total: events.length, attendanceDetails },
    });
  } catch (error) {
    console.error("getOrganizerEvents error:", error);
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
    if (
      issueKeywords[issue].some((keyword) => lowerComment.includes(keyword))
    ) {
      issues.push(issue);
    }
  });

  return issues;
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
  getOrganizerMetrics,
  getOrganizerRevenue,
  getOrganizerBookings,
  getOrganizerTrends,
  getOrganizerSentiment,
  getOrganizerRatings,
  getOrganizerEvents,
  checkAIHealth,
  chatBookingSupport,
  clearBookingSupportHistory,
  clearBookingSupportHistoryAnonymous,
  checkBookingSupportHealth,
  getBookingSupportStats,
  processEventRequest,
  getEventSuggestions,
};
