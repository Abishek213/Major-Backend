import Event from '../model/event.schema.js';
import Booking from '../model/booking.schema.js';
import PaymentService from '../services/payment.service.js';

export const initiateBooking = async (req, res) => {
  try {
    console.log('Booking request received:', {
      ...req.body,
      user: { id: req.user._id, email: req.user.email }
    });

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized. Please log in again.'
      });
    }

    const { eventId, numberOfSeats, paymentMethod } = req.body;
    
    // Validate the payment method
    if (!['khalti', 'esewa'].includes(paymentMethod.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment method'
      });
    }

    // Rest of your existing code...
    const event = await validateBookingRequest(eventId, numberOfSeats);
    const totalAmount = event.price * numberOfSeats;

    const booking = await Booking.create({
      userId: req.user._id,
      eventId,
      numberOfSeats,
      totalAmount,
      payment: {
        method: paymentMethod,
        status: 'pending',
        currency: 'NPR'
      }
    });

    const paymentResponse = await PaymentService.initiatePayment(paymentMethod, {
      bookingId: booking._id.toString(),
      eventName: event.event_name,
      totalAmount,
      customerInfo: {
        name: req.user.fullname || 'User',
        email: req.user.email || '',
        phone: req.user.phone || ''
      }
    });

    // Update booking with both transaction ID and PIDX
    booking.payment.transactionId = paymentResponse.transactionId;
    booking.payment.pidx = paymentResponse.pidx;
    await booking.save();

    return res.json({
      success: true,
      bookingId: booking._id,
      paymentUrl: paymentResponse.payment_url || paymentResponse.paymentUrl
    });

  } catch (error) {
    console.error('Booking Creation Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Payment initiation failed',
      error: error.message
    });
  }
};

async function validateBookingRequest(eventId, numberOfSeats) {
  if (!eventId || !numberOfSeats || numberOfSeats <= 0) {
    throw new Error('Invalid input');
  }

  const event = await Event.findById(eventId);
  if (!event) {
    throw new Error('Event not found');
  }

  const availableSeats = event.totalSlots - (event.attendees?.length || 0);
  if (numberOfSeats > availableSeats) {
    throw new Error('Not enough seats available');
  }

  if (!event.price || event.price <= 0) {
    throw new Error('Invalid event price');
  }

  return event;
}

export const getBookingDetails = async (req, res) => {
  try {
    const { pidx } = req.params;

    const booking = await Booking.findOne({ 'payment.transactionId': pidx })
      .populate('userId', 'fullname email')
      .populate('eventId', 'event_name');

    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    res.json({
      success: true,
      eventName: booking.eventId.event_name,
      seatsBooked: booking.numberOfSeats,
      totalAmount: booking.totalAmount,
      userName: booking.userId.fullname,
      userId: booking.userId._id,
      email: booking.userId.email,
      paymentStatus: booking.payment.status,
      paymentMethod: booking.payment.method
    });
  } catch (error) {
    console.error('Error fetching booking details:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch booking details' });
  }
};

export const updateBookingPaymentStatus = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const { paymentStatus = 'completed', pidx } = req.body;

    // Find booking by either transaction ID or PIDX
    const booking = await Booking.findOne({
      $or: [
        { 'payment.transactionId': transactionId },
        { 'payment.pidx': pidx }
      ]
    });

    if (!booking) {
      return res.status(404).json({ 
        success: false, 
        message: 'Booking not found' 
      });
    }

    // Update payment status
    booking.payment.status = paymentStatus;
    booking.payment.processedAt = new Date();

    // Update transaction ID or PIDX if provided
    if (transactionId) booking.payment.transactionId = transactionId;
    if (pidx) booking.payment.pidx = pidx;

    await booking.save();

    return res.json({
      success: true,
      message: 'Payment status updated successfully',
      bookingId: booking._id
    });

  } catch (error) {
    console.error('Error updating booking status:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update booking status',
      error: error.message
    });
  }
};

export const getUserBookedEvents = async (req, res) => {
  try {
    const userId = req.user._id;

    const bookings = await Booking.find({ 
      userId: userId,
      'payment.status': 'completed' 
    })
    .populate({
      path: 'eventId',
      populate: [
        { path: 'org_ID', select: 'fullname email' },
        { path: 'category', select: 'categoryName' }
      ]
    })
    .sort({ createdAt: -1 });

    const bookedEvents = bookings.map(booking => ({
      bookingId: booking._id,
      event: booking.eventId,
      numberOfSeats: booking.numberOfSeats,
      totalAmount: booking.totalAmount,
      paymentMethod: booking.payment.method,
      bookingDate: booking.createdAt
    }));

    res.status(200).json({
      success: true,
      totalBookedEvents: bookedEvents.length,
      bookedEvents
    });
  } catch (error) {
    console.error('Error fetching user booked events:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to retrieve booked events',
      error: error.message 
    });
  }
};