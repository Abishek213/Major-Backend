import mongoose from "mongoose";
import Event from "../model/event.schema.js";
import User from "../model/user.schema.js";
import Category from "../model/categories.schema.js";
import path from "path";
import fs from "fs";
import AI_Recommendation from "../model/ai_recommendation.schema.js";
import AI_Agent from "../model/ai_agent.schema.js";
import Review from "../model/review.schema.js";
import AI_FeedbackSentiment from "../model/ai_feedbackSentiment.schema.js";

export const createEvent = async (req, res) => {
  try {
    const { org_ID, category } = req.body;

    // Fetch and validate organizer
    const organizer = await User.findById(org_ID);
    if (!organizer) {
      return res.status(404).json({ message: "Organizer not found" });
    }

    // Validate category exists in the Category collection
    const validCategory = await Category.findById(category);
    if (!validCategory) {
      return res.status(400).json({ message: "Invalid category selected" });
    }

    // Validate registration deadline against event date
    if (
      new Date(req.body.registrationDeadline) >= new Date(req.body.event_date)
    ) {
      return res.status(400).json({
        message: "Registration deadline must be before event date",
      });
    }

    // Validate event date is in the future
    if (new Date(req.body.event_date) <= new Date()) {
      return res.status(400).json({
        message: "Event date must be in the future",
      });
    }

    const newEvent = new Event({
      event_name: req.body.event_name.trim(),
      description: req.body.description.trim(),
      event_date: req.body.event_date,
      registrationDeadline: req.body.registrationDeadline,
      time: req.body.time,
      location: req.body.location.trim(),
      price: req.body.price,
      category: validCategory._id,
      tags: req.body.tags ? req.body.tags.map((tag) => tag.trim()) : [],
      image: req.body.image,
      org_ID,
      totalSlots: req.body.totalSlots,
      isPublic: req.body.isPublic !== undefined ? req.body.isPublic : false,
      status: organizer.isApproved ? "active" : "pending",
      attendees: [],
    });

    const savedEvent = await newEvent.save();
    await savedEvent.populate([
      { path: "org_ID", select: "fullname email" },
      { path: "category", select: "categoryName" },
    ]);

    res.status(201).json({
      event: savedEvent,
      requiresApproval: !organizer.isApproved,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Error creating event",
      error: error.message,
    });
  }
};

// Image upload route
export const uploadEventImage = async (req, res) => {
  try {
    const image = req.files?.image;
    const eventId = req.body.eventId;

    // Validate inputs
    if (!image) {
      return res.status(400).json({ message: "No image uploaded" });
    }

    if (!eventId) {
      return res.status(400).json({ message: "Event ID is required" });
    }

    // Find the event to ensure it exists
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    // Generate unique filename
    const filename = `event-${eventId}-${Date.now()}.${image.name
      .split(".")
      .pop()}`;
    const uploadDir = path.join(process.cwd(), "uploads", "events");

    // Ensure directory exists
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const uploadPath = path.join(uploadDir, filename);

    // Save file
    await image.mv(uploadPath);

    // Update event with image URL
    const imageUrl = `/uploads/events/${filename}`;
    event.image = imageUrl;
    await event.save();

    res.status(200).json({
      success: true,
      message: "Image uploaded successfully",
      imageUrl,
    });
  } catch (error) {
    console.error("Image upload error:", error);
    res.status(500).json({
      success: false,
      message: "Image upload failed",
      error: error.message,
    });
  }
};

export const getEventsByUserId = async (req, res) => {
  try {
    const { userId } = req.params;

    // Validate userId format
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        message: "Invalid user ID format",
        details: "The provided user ID is not in the correct format",
      });
    }

    const events = await Event.find({ org_ID: userId })
      .populate("org_ID", "fullname email")
      .populate("category")
      .populate("attendees", "fullname email")
      .sort({ event_date: 1 });

    // Send empty array instead of 404 if no events found
    res.status(200).json(events);
  } catch (error) {
    console.error("Error in getEventsByUserId:", error);
    res.status(500).json({
      message: "Error fetching user events",
      error: error.message,
    });
  }
};

export const getEventById = async (req, res) => {
  try {
    // Validate ID format
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid event ID format" });
    }

    const event = await Event.findById(req.params.id)
      .populate("org_ID", "fullname email")
      .populate("category")
      .populate("attendees", "fullame email");

    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    // NEW: Get AI insights for this event (reviews sentiment, recommendations)
    const [reviews, recommendations] = await Promise.all([
      Review.find({ eventId: event._id })
        .populate("userId", "fullname")
        .sort({ createdAt: -1 })
        .limit(5),
      AI_Recommendation.find({ event_id: event._id })
        .sort({ confidence_score: -1 })
        .limit(3),
    ]);

    // NEW: Get sentiment analysis for reviews
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

    const eventWithAI = {
      ...event.toObject(),
      aiInsights: {
        totalReviews: reviews.length,
        recentReviews: reviewsWithSentiment,
        totalRecommendations: recommendations.length,
        averageConfidenceScore:
          recommendations.length > 0
            ? (
                recommendations.reduce(
                  (sum, rec) => sum + rec.confidence_score,
                  0
                ) / recommendations.length
              ).toFixed(2)
            : 0,
      },
    };

    res.status(200).json(eventWithAI);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Error fetching event",
      error: error.message,
    });
  }
};

// Update an event
export const updateEvent = async (req, res) => {
  try {
    const updateData = { ...req.body };

    const updatedEvent = await Event.findByIdAndUpdate(
      req.params.id,
      updateData,
      {
        new: true,
        runValidators: true,
      }
    ).populate([
      { path: "org_ID", select: "fullname email" },
      { path: "category", select: "categoryName" },
    ]);

    if (!updatedEvent) {
      return res.status(404).json({ message: "Event not found" });
    }

    res.status(200).json(updatedEvent);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Error updating event",
      error: error.message,
    });
  }
};

export const deleteEvent = async (req, res) => {
  try {
    const deletedEvent = await Event.findByIdAndDelete(req.params.id);

    if (!deletedEvent) {
      return res.status(404).json({ message: "Event not found" });
    }

    res.status(200).json({
      message: "Event deleted successfully",
      deletedEvent,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Error deleting event",
      error: error.message,
    });
  }
};

//eventdetails
export const registerForEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id; // From auth middleware

    const event = await Event.findById(id);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    // Check if registration is still open
    if (new Date(event.registrationDeadline) < new Date()) {
      return res
        .status(400)
        .json({ message: "Registration deadline has passed" });
    }

    // Check if event is full
    if (event.attendees.length >= event.totalSlots) {
      return res.status(400).json({ message: "Event is full" });
    }

    // Check if user is already registered
    if (event.attendees.includes(userId)) {
      return res
        .status(400)
        .json({ message: "Already registered for this event" });
    }

    // Add user to attendees
    event.attendees.push(userId);
    await event.save();

    res.status(200).json({
      message: "Successfully registered for event",
      event: await event.populate([
        { path: "org_ID", select: "fullname email" },
        { path: "category" },
        { path: "attendees", select: "fullname email" },
      ]),
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({
      message: "Error registering for event",
      error: error.message,
    });
  }
};

export const cancelRegistration = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id; // From auth middleware

    const event = await Event.findById(id);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    // Remove user from attendees
    const attendeeIndex = event.attendees.indexOf(userId);
    if (attendeeIndex === -1) {
      return res.status(400).json({ message: "Not registered for this event" });
    }

    event.attendees.splice(attendeeIndex, 1);
    await event.save();

    res.status(200).json({
      message: "Successfully cancelled registration",
      event: await event.populate([
        { path: "org_ID", select: "fullname email" },
        { path: "category" },
        { path: "attendees", select: "fullname email" },
      ]),
    });
  } catch (error) {
    console.error("Cancellation error:", error);
    res.status(500).json({
      message: "Error cancelling registration",
      error: error.message,
    });
  }
};

export const getRegistrationStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id; // From auth middleware

    const event = await Event.findById(id);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    const isRegistered = event.attendees.includes(userId);

    res.status(200).json({
      isRegistered,
      isPastDeadline: new Date(event.registrationDeadline) < new Date(),
      isEventFull: event.attendees.length >= event.totalSlots,
    });
  } catch (error) {
    console.error("Status check error:", error);
    res.status(500).json({
      message: "Error checking registration status",
      error: error.message,
    });
  }
};

export const getSimilarEvents = async (req, res) => {
  try {
    const { id } = req.params;

    const event = await Event.findById(id).populate("category");

    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    // Find events in the same category, excluding the current event
    const similarEvents = await Event.find({
      _id: { $ne: id },
      category: event.category._id,
      event_date: { $gte: new Date() },
      status: "upcoming",
    })
      .populate("org_ID", "fullname email")
      .populate("category")
      .limit(4)
      .sort({ event_date: 1 });

    res.status(200).json(similarEvents);
  } catch (error) {
    console.error("Similar events error:", error);
    res.status(500).json({
      message: "Error fetching similar events",
      error: error.message,
    });
  }
};

export const getEvents = async (req, res) => {
  const {
    search,
    location,
    category,
    priceRange,
    date,
    status,
    parentCategory,
  } = req.query;

  try {
    const query = { status: "approved" };

    if (search) {
      query.$or = [
        { event_name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }

    if (location) {
      query.location = { $regex: location, $options: "i" };
    }

    // Handle parent category filtering
    if (parentCategory && mongoose.Types.ObjectId.isValid(parentCategory)) {
      // First, find all child categories of the parent
      const childCategories = await Category.find({
        parentCategory: new mongoose.Types.ObjectId(parentCategory),
      });

      // Create an array of category IDs including parent and all children
      const categoryIds = [
        new mongoose.Types.ObjectId(parentCategory),
        ...childCategories.map((cat) => cat._id),
      ];

      // Update query to match any of these categories
      query.category = { $in: categoryIds };
    }
    // Handle specific category filtering (existing logic)
    else if (category && mongoose.Types.ObjectId.isValid(category)) {
      query.category = new mongoose.Types.ObjectId(category);
    }

    if (
      status &&
      ["upcoming", "ongoing", "completed", "cancelled"].includes(status)
    ) {
      query.status = status;
    }

    if (priceRange) {
      const [min, max] = priceRange.split("-").map(Number);
      query.price = { $gte: min || 0 };
      if (max) query.price.$lte = max;
    }

    if (date) {
      const searchDate = new Date(date);
      query.event_date = {
        $gte: searchDate,
        $lt: new Date(searchDate.setDate(searchDate.getDate() + 1)),
      };
    }

    const events = await Event.find(query)
      .populate("org_ID", "fullname email")
      .populate({
        path: "category",
        populate: {
          path: "parentCategory",
          select: "categoryName",
        },
      })
      .populate("attendees", "fullname email")
      .sort({ event_date: 1 });

    // Add category hierarchy information to the response
    const eventsWithCategoryInfo = events.map((event) => {
      const eventObj = event.toObject();
      if (eventObj.category && eventObj.category.parentCategory) {
        eventObj.categoryHierarchy = {
          parent: eventObj.category.parentCategory.categoryName,
          child: eventObj.category.categoryName,
        };
      }
      return eventObj;
    });

    res.status(200).json(eventsWithCategoryInfo);
  } catch (error) {
    console.error("Error in getEvents:", error);
    res.status(500).json({
      message: "Error fetching events",
      error: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
};

// New function to get events by parent category
export const getEventsByParentCategory = async (req, res) => {
  try {
    const { parentCategoryId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(parentCategoryId)) {
      return res.status(400).json({
        message: "Invalid parent category ID format",
      });
    }

    // Find the parent category and all its child categories
    const [parentCategory, childCategories] = await Promise.all([
      Category.findById(parentCategoryId),
      Category.find({ parentCategory: parentCategoryId }),
    ]);

    if (!parentCategory) {
      return res.status(404).json({
        message: "Parent category not found",
      });
    }

    // Get all category IDs (parent and children)
    const categoryIds = [
      parentCategory._id,
      ...childCategories.map((cat) => cat._id),
    ];

    // Find all events in these categories
    const events = await Event.find({
      category: { $in: categoryIds },
    })
      .populate("org_ID", "fullname email")
      .populate({
        path: "category",
        populate: {
          path: "parentCategory",
          select: "categoryName",
        },
      })
      .populate("attendees", "fullname email")
      .sort({ event_date: 1 });

    res.status(200).json({
      parentCategory: parentCategory.categoryName,
      childCategories: childCategories.map((cat) => ({
        id: cat._id,
        name: cat.categoryName,
      })),
      totalEvents: events.length,
      events,
    });
  } catch (error) {
    console.error("Error in getEventsByParentCategory:", error);
    res.status(500).json({
      message: "Error fetching events by parent category",
      error: error.message,
    });
  }
};

// ========================
// NEW AI FUNCTIONS
// ========================

// NEW FUNCTION: Get AI recommended events for current user
export const getAIRecommendedEvents = async (req, res) => {
  try {
    const userId = req.user._id;
    const { limit = 10 } = req.query;

    // Check if user has any AI recommendations
    const hasRecommendations = await AI_Recommendation.findOne({
      user_id: userId,
    });

    if (!hasRecommendations) {
      // If no recommendations, return popular events
      const popularEvents = await Event.find({
        status: "approved",
        event_date: { $gte: new Date() },
      })
        .populate("org_ID", "fullname email")
        .populate("category")
        .sort({ attendees: -1 })
        .limit(parseInt(limit));

      return res.status(200).json({
        success: true,
        message: "No personalized recommendations yet. Showing popular events.",
        type: "popular",
        count: popularEvents.length,
        data: popularEvents,
      });
    }

    // Get AI recommendations for user
    const recommendations = await AI_Recommendation.find({ user_id: userId })
      .populate({
        path: "event_id",
        match: {
          status: "approved",
          event_date: { $gte: new Date() },
        },
        populate: [
          { path: "org_ID", select: "fullname email" },
          { path: "category" },
        ],
      })
      .sort({ confidence_score: -1 })
      .limit(parseInt(limit));

    // Filter out events that might be null (if event was deleted or not matching criteria)
    const validRecommendations = recommendations.filter((rec) => rec.event_id);

    res.status(200).json({
      success: true,
      type: "ai_recommended",
      count: validRecommendations.length,
      data: validRecommendations.map((rec) => ({
        recommendation: {
          confidence_score: rec.confidence_score,
          reason: rec.recommendation_reason,
          createdAt: rec.createdAt,
        },
        event: rec.event_id,
      })),
    });
  } catch (error) {
    console.error("Error fetching AI recommendations:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching recommendations",
      error: error.message,
    });
  }
};

// NEW FUNCTION: Generate AI recommendations (for AI service to call)
export const generateEventRecommendations = async (req, res) => {
  try {
    const { userId, events } = req.body;

    if (!userId || !events || !Array.isArray(events)) {
      return res.status(400).json({
        success: false,
        message: "Invalid request. userId and events array are required.",
      });
    }

    // Get recommendation agent
    const agent = await AI_Agent.findOne({
      agent_type: "user",
      role: "assistant",
      status: "active",
    });

    if (!agent) {
      return res.status(404).json({
        success: false,
        message: "No recommendation agent available",
      });
    }

    const recommendations = [];
    const errors = [];

    // Process each event recommendation
    for (const eventData of events) {
      try {
        const {
          eventId,
          confidenceScore = 0.5,
          reason = "AI-generated recommendation",
        } = eventData;

        // Validate event exists
        const event = await Event.findById(eventId);
        if (!event) {
          errors.push(`Event ${eventId} not found`);
          continue;
        }

        // Check if recommendation already exists
        const existing = await AI_Recommendation.findOne({
          user_id: userId,
          event_id: eventId,
        });

        if (existing) {
          // Update existing recommendation
          existing.confidence_score = confidenceScore;
          existing.recommendation_reason = reason;
          await existing.save();
          recommendations.push(existing);
        } else {
          // Create new recommendation
          const recommendation = await AI_Recommendation.create({
            user_id: userId,
            event_id: eventId,
            agent_id: agent._id,
            confidence_score: confidenceScore,
            recommendation_reason: reason,
          });
          recommendations.push(recommendation);
        }
      } catch (err) {
        errors.push(
          `Failed to process event ${eventData.eventId}: ${err.message}`
        );
      }
    }

    res.status(201).json({
      success: true,
      message: `Generated ${recommendations.length} recommendations`,
      data: {
        generated: recommendations.length,
        errors: errors.length,
        recommendations: recommendations.map((rec) => rec._id),
        details: errors.length > 0 ? errors : undefined,
      },
    });
  } catch (error) {
    console.error("Error generating recommendations:", error);
    res.status(500).json({
      success: false,
      message: "Error generating recommendations",
      error: error.message,
    });
  }
};

// NEW FUNCTION: Get event sentiment analysis
export const getEventSentimentAnalysis = async (req, res) => {
  try {
    const { id } = req.params;

    // Validate event exists
    const event = await Event.findById(id);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Event not found",
      });
    }

    // Get all reviews for this event
    const reviews = await Review.find({ eventId: id }).populate(
      "userId",
      "fullname email"
    );

    if (reviews.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No reviews available for sentiment analysis",
        data: {
          eventId: id,
          eventName: event.event_name,
          totalReviews: 0,
          sentimentScore: 0,
          detectedIssues: [],
          reviews: [],
        },
      });
    }

    // Get sentiment analysis for each review
    const reviewsWithSentiment = await Promise.all(
      reviews.map(async (review) => {
        const sentiment = await AI_FeedbackSentiment.findOne({
          review_id: review._id,
        }).populate("agent_id", "name");
        return {
          ...review.toObject(),
          sentiment: sentiment || null,
        };
      })
    );

    // Calculate average sentiment
    const validSentiments = reviewsWithSentiment
      .filter((item) => item.sentiment)
      .map((item) => item.sentiment.sentiment_score);

    const averageSentiment =
      validSentiments.length > 0
        ? validSentiments.reduce((a, b) => a + b, 0) / validSentiments.length
        : 0;

    // Aggregate detected issues
    const allIssues = reviewsWithSentiment
      .filter((item) => item.sentiment && item.sentiment.detected_issues)
      .flatMap((item) => item.sentiment.detected_issues);

    const issueCounts = allIssues.reduce((acc, issue) => {
      acc[issue] = (acc[issue] || 0) + 1;
      return acc;
    }, {});

    res.status(200).json({
      success: true,
      data: {
        eventId: id,
        eventName: event.event_name,
        totalReviews: reviews.length,
        reviewsWithSentiment: reviewsWithSentiment.length,
        sentimentAnalysis: {
          averageScore: averageSentiment.toFixed(2),
          sentiment:
            averageSentiment > 0.3
              ? "Positive"
              : averageSentiment < -0.3
              ? "Negative"
              : "Neutral",
          issueDistribution: issueCounts,
          topIssues: Object.entries(issueCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([issue, count]) => ({ issue, count })),
        },
        recentReviews: reviewsWithSentiment.slice(0, 5),
      },
    });
  } catch (error) {
    console.error("Error in sentiment analysis:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching sentiment analysis",
      error: error.message,
    });
  }
};
