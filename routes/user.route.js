import express from 'express';
import { signup, login, getUserByEmail, getAllUsers, addToWishlist, removeFromWishlist, getWishlist, getUserProfile, updateProfile, uploadProfileImage } from "../controller/user.controller.js";
import { authenticateUser } from '../middleware/authMiddleware.js';

const router = express.Router();

// Public routes
router.post('/signup', signup);
router.post('/login', login);

// Protected routes - using the existing protect middleware
router.get('/email/:email', authenticateUser, getUserByEmail);
router.get('/all', authenticateUser, getAllUsers);

// Wishlist routes - all protected
router.post('/wishlist', authenticateUser, addToWishlist);
router.delete('/wishlist/:eventId', authenticateUser, removeFromWishlist);
router.get('/wishlist', authenticateUser, getWishlist);

router.get('/me', authenticateUser, getUserProfile);
router.put('/update', authenticateUser, updateProfile);
router.post('/upload-profile-image', authenticateUser, uploadProfileImage);

export default router;