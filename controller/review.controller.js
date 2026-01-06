import Review from "../model/review.schema.js";
import AI_FeedbackSentiment from "../model/ai_feedbackSentiment.schema.js";
import AI_Agent from "../model/ai_agent.schema.js";
import Event from "../model/event.schema.js";

export const createReview = async (req, res) => {
  try {
    const { eventId, rating, comment } = req.body;
    const userId = req.user._id;

    // Check if user already reviewed this event
    const existingReview = await Review.findOne({ userId, eventId });
    if (existingReview) {
      return res.status(400).json({
        success: false,
        message: "You have already reviewed this event",
      });
    }

    const review = await Review.create({
      userId,
      eventId,
      rating,
      comment,
    });

    // AI Integration: Trigger sentiment analysis
    await triggerSentimentAnalysis(review._id);

    // Update event rating average
    await updateEventRating(eventId);

    res.status(201).json({
      success: true,
      data: review,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

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

    // Get sentiment analysis for each review
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
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getUserReviews = async (req, res) => {
  try {
    const userId = req.user._id;

    const reviews = await Review.find({ userId })
      .populate("eventId", "event_name image")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: reviews.length,
      data: reviews,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Helper functions
async function triggerSentimentAnalysis(reviewId) {
  try {
    const sentimentAgent = await AI_Agent.findOne({
      agent_type: "admin",
      role: "analyst",
      status: "active",
    });

    if (sentimentAgent) {
      await AI_FeedbackSentiment.create({
        review_id: reviewId,
        agent_id: sentimentAgent._id,
        sentiment_score: 0, // Will be updated by AI service
        detected_issues: [],
      });
    }
  } catch (error) {
    console.error("Error triggering sentiment analysis:", error);
  }
}

async function updateEventRating(eventId) {
  try {
    const reviews = await Review.find({ eventId });
    if (reviews.length > 0) {
      const averageRating =
        reviews.reduce((sum, review) => sum + review.rating, 0) /
        reviews.length;

      await Event.findByIdAndUpdate(eventId, {
        $set: { averageRating: averageRating.toFixed(1) },
      });
    }
  } catch (error) {
    console.error("Error updating event rating:", error);
  }
}
