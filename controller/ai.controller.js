import AI_Agent from "../model/ai_agent.schema.js";
import AI_Recommendation from "../model/ai_recommendation.schema.js";
import AI_NegotiationLog from "../model/ai_negotiationLog.schema.js";
import AI_FeedbackSentiment from "../model/ai_feedbackSentiment.schema.js";
import AI_FraudCheck from "../model/ai_fraudCheck.schema.js";
import AI_ActionLog from "../model/ai_actionLog.schema.js";
import Review from "../model/review.schema.js";
import Booking from "../model/booking.schema.js";

// AI Agent endpoints
export const createAgent = async (req, res) => {
  try {
    const agent = await AI_Agent.create(req.body);

    res.status(201).json({
      success: true,
      data: agent,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
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

    res.status(200).json({
      success: true,
      count: agents.length,
      data: agents,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// AI Recommendations
export const getUserRecommendations = async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 10 } = req.query;

    const recommendations = await AI_Recommendation.find({ user_id: userId })
      .populate("event_id", "event_name description location price image")
      .populate("agent_id", "name role")
      .sort({ confidence_score: -1, createdAt: -1 })
      .limit(parseInt(limit));

    res.status(200).json({
      success: true,
      count: recommendations.length,
      data: recommendations,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const createRecommendation = async (req, res) => {
  try {
    const recommendation = await AI_Recommendation.create(req.body);

    // Log the action
    await AI_ActionLog.create({
      agentId: req.body.agent_id,
      userId: req.body.user_id,
      logType: "recommendation",
      actionDetails: {
        eventId: req.body.event_id,
        confidenceScore: req.body.confidence_score,
      },
    });

    res.status(201).json({
      success: true,
      data: recommendation,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// AI Negotiations
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

    res.status(201).json({
      success: true,
      data: negotiation,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const updateNegotiation = async (req, res) => {
  try {
    const { id } = req.params;
    const negotiation = await AI_NegotiationLog.findByIdAndUpdate(
      id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!negotiation) {
      return res.status(404).json({
        success: false,
        message: "Negotiation not found",
      });
    }

    res.status(200).json({
      success: true,
      data: negotiation,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// Fraud Check
export const performFraudCheck = async (req, res) => {
  try {
    const { bookingId } = req.params;

    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    // Get active fraud detection agent
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

    // Calculate risk score
    const riskScore = calculateRiskScore(booking);

    const fraudCheck = await AI_FraudCheck.create({
      agentId: fraudAgent._id,
      bookingId: bookingId,
      riskScore: riskScore,
      fraudStatus:
        riskScore > 0.7
          ? "suspicious"
          : riskScore > 0.9
          ? "fraudulent"
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

    res.status(201).json({
      success: true,
      data: fraudCheck,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Sentiment Analysis
export const analyzeReviewSentiment = async (req, res) => {
  try {
    const { reviewId } = req.params;

    const review = await Review.findById(reviewId)
      .populate("userId", "fullname")
      .populate("eventId", "event_name");

    if (!review) {
      return res.status(404).json({
        success: false,
        message: "Review not found",
      });
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

    // Analyze sentiment
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

    res.status(201).json({
      success: true,
      data: sentimentAnalysis,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// AI Dashboard Stats
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

    res.status(200).json({
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
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Helper functions (temporary - will integrate with actual AI service)
function calculateRiskScore(booking) {
  let risk = 0.1;

  if (booking.totalAmount > 1000) risk += 0.3;
  if (booking.totalAmount > 5000) risk += 0.3;

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
