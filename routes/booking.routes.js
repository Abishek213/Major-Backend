import express from 'express';
import { authenticateUser } from '../middleware/authMiddleware.js';
import {
  initiateBooking,
  getBookingDetails,
  updateBookingPaymentStatus,
  getUserBookedEvents  
} from '../controller/booking.controller.js';

const bookingRouter = express.Router();

bookingRouter.post('/', authenticateUser, initiateBooking); 
bookingRouter.get('/booking-details/:transactionId', authenticateUser, getBookingDetails); 
bookingRouter.patch('/update-status/:transactionId', authenticateUser, updateBookingPaymentStatus);
bookingRouter.get('/MyEvents', authenticateUser, getUserBookedEvents);

export default bookingRouter;