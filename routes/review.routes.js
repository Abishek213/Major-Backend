import express from "express";
import {
  createReview,
  getEventReviews,
  getUserReviews,
  checkUserReview,
} from "../controller/review.controller.js";
import { authenticateUser } from "../middleware/authMiddleware.js";

const router = express.Router();

// POST /api/v1/reviews
// Create a review — auth required, booking guard enforced inside controller
router.post("/", authenticateUser, createReview);

// GET /api/v1/reviews/event/:eventId
// Public — fetch paginated reviews for an event
router.get("/event/:eventId", getEventReviews);

// GET /api/v1/reviews/user
// Auth required — fetch all reviews submitted by the logged-in user
router.get("/user", authenticateUser, getUserReviews);

// GET /api/v1/reviews/check/:eventId
// Auth required — check if the logged-in user has already reviewed a specific event
router.get("/check/:eventId", authenticateUser, checkUserReview);

export default router;
