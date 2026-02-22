import express from "express";
import {
  signup,
  login,
  googleAuth,
  sendEmailOTP,
  verifyEmailOTP,
  sendMobileOTP,
  verifyMobileOTP,
  toggleEmailSubscription,
} from "../controller/user.controller.js";
import { authenticateUser } from "../middleware/authMiddleware.js";

const router = express.Router();

// Public routes
router.post("/signup", signup);
router.post("/login", login);

router.post("/google", googleAuth);
router.post("/send-email-otp", sendEmailOTP);
router.post("/verify-email-otp", verifyEmailOTP);
router.post("/send-mobile-otp", sendMobileOTP);
router.post("/verify-mobile-otp", verifyMobileOTP);

// Protected routes
router.put("/subscription", authenticateUser, toggleEmailSubscription);

export default router;
