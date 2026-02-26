import Review from "../model/review.schema.js";
import Booking from "../model/booking.schema.js";
import AI_FeedbackSentiment from "../model/ai_feedbackSentiment.schema.js";
import AI_Agent from "../model/ai_agent.schema.js";
import Event from "../model/event.schema.js";

export const createReview = async (req, res) => {
  try {
    const { eventId, rating, comment } = req.body;
    const userId = req.user._id;

    // 1. Basic field validation
    if (!eventId || !rating) {
      return res.status(400).json({
        success: false,
        message: "eventId and rating are required.",
      });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: "Rating must be between 1 and 5.",
      });
    }

    // 2. Verify the event exists and is in the past
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Event not found.",
      });
    }

    if (new Date(event.event_date) > new Date()) {
      return res.status(400).json({
        success: false,
        message: "You can only review events that have already taken place.",
      });
    }

    // 3. Verify the user actually attended — must have a completed booking
    const confirmedBooking = await Booking.findOne({
      userId,
      eventId,
      "payment.status": "completed",
    });

    if (!confirmedBooking) {
      return res.status(403).json({
        success: false,
        message:
          "You can only review events you have attended with a confirmed booking.",
      });
    }

    // 4. Prevent duplicate reviews (schema index also enforces this, but give a clean message)
    const existingReview = await Review.findOne({ userId, eventId });
    if (existingReview) {
      return res.status(400).json({
        success: false,
        message: "You have already reviewed this event.",
      });
    }

    // 5. Create the review
    const review = await Review.create({
      userId,
      eventId,
      rating,
      comment: comment?.trim() || "",
    });

    // 6. Trigger AI sentiment analysis (non-blocking — failure doesn't affect response)
    triggerSentimentAnalysis(review._id).catch((err) =>
      console.error("Sentiment analysis trigger failed:", err)
    );

    // 7. Recalculate and persist the event's average rating
    await updateEventRating(eventId);

    res.status(201).json({
      success: true,
      message: "Review submitted successfully.",
      data: review,
    });
  } catch (error) {
    // Mongoose duplicate key (unique index hit)
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "You have already reviewed this event.",
      });
    }

    console.error("createReview error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to submit review.",
    });
  }
};

// ─── GET /api/v1/reviews/event/:eventId ──────────────────────────────────────
export const getEventReviews = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const skip = (page - 1) * limit;

    const reviews = await Review.find({ eventId })
      .populate("userId", "fullname")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Attach AI sentiment data to each review
    const reviewsWithSentiment = await Promise.all(
      reviews.map(async (review) => {
        const sentiment = await AI_FeedbackSentiment.findOne({
          review_id: review._id,
        });
        return {
          ...review.toObject(),
          sentiment: sentiment || null,
        };
      })
    );

    const total = await Review.countDocuments({ eventId });

    res.status(200).json({
      success: true,
      data: reviewsWithSentiment,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("getEventReviews error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ─── GET /api/v1/reviews/user ─────────────────────────────────────────────────
export const getUserReviews = async (req, res) => {
  try {
    const userId = req.user._id;

    const reviews = await Review.find({ userId })
      .populate("eventId", "event_name image event_date")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: reviews.length,
      data: reviews,
    });
  } catch (error) {
    console.error("getUserReviews error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ─── GET /api/v1/reviews/check/:eventId ──────────────────────────────────────
// Lightweight endpoint the frontend calls on load to know which completed
// events the logged-in user has already reviewed.
export const checkUserReview = async (req, res) => {
  try {
    const userId = req.user._id;
    const { eventId } = req.params;

    const review = await Review.findOne({ userId, eventId }).select(
      "rating comment createdAt"
    );

    res.status(200).json({
      success: true,
      hasReviewed: !!review,
      data: review || null,
    });
  } catch (error) {
    console.error("checkUserReview error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function triggerSentimentAnalysis(reviewId) {
  const sentimentAgent = await AI_Agent.findOne({
    agent_type: "admin",
    role: "analyst",
    status: "active",
  });

  if (sentimentAgent) {
    await AI_FeedbackSentiment.create({
      review_id: reviewId,
      agent_id: sentimentAgent._id,
      sentiment_score: 0, // Updated later by the AI service
      detected_issues: [],
    });
  }
}

async function updateEventRating(eventId) {
  const reviews = await Review.find({ eventId });
  if (reviews.length === 0) return;

  const avg = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;

  await Event.findByIdAndUpdate(eventId, {
    $set: { averageRating: parseFloat(avg.toFixed(1)) },
  });
}
