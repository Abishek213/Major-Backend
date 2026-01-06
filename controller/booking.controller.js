import Event from "../model/event.schema.js";
import Booking from "../model/booking.schema.js";
import PaymentService from "../services/payment.service.js";
import AI_FraudCheck from "../model/ai_fraudCheck.schema.js";
import AI_NegotiationLog from "../model/ai_negotiationLog.schema.js";
import AI_Agent from "../model/ai_agent.schema.js";
import AI_ActionLog from "../model/ai_actionLog.schema.js";

export const initiateBooking = async (req, res) => {
  try {
    console.log("Booking request received:", {
      ...req.body,
      user: { id: req.user._id, email: req.user.email },
    });

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized. Please log in again.",
      });
    }

    const { eventId, numberOfSeats, paymentMethod } = req.body;

    // Validate the payment method
    if (!["khalti", "esewa"].includes(paymentMethod.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment method",
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
        status: "pending",
        currency: "NPR",
      },
    });

    const paymentResponse = await PaymentService.initiatePayment(
      paymentMethod,
      {
        bookingId: booking._id.toString(),
        eventName: event.event_name,
        totalAmount,
        customerInfo: {
          name: req.user.fullname || "User",
          email: req.user.email || "",
          phone: req.user.phone || "",
        },
      }
    );

    // Update booking with both transaction ID and PIDX
    booking.payment.transactionId = paymentResponse.transactionId;
    booking.payment.pidx = paymentResponse.pidx;
    await booking.save();

    // NEW AI INTEGRATION: Trigger fraud check (non-blocking)
    triggerFraudCheckAsync(booking._id, totalAmount).catch(console.error);

    // NEW AI INTEGRATION: Create negotiation opportunity for high-value bookings
    if (totalAmount > 1000) {
      createNegotiationOpportunityAsync(booking._id, totalAmount).catch(
        console.error
      );
    }

    return res.json({
      success: true,
      bookingId: booking._id,
      paymentUrl: paymentResponse.payment_url || paymentResponse.paymentUrl,
    });
  } catch (error) {
    console.error("Booking Creation Error:", error);
    return res.status(500).json({
      success: false,
      message: "Payment initiation failed",
      error: error.message,
    });
  }
};

async function validateBookingRequest(eventId, numberOfSeats) {
  if (!eventId || !numberOfSeats || numberOfSeats <= 0) {
    throw new Error("Invalid input");
  }

  const event = await Event.findById(eventId);
  if (!event) {
    throw new Error("Event not found");
  }

  const availableSeats = event.totalSlots - (event.attendees?.length || 0);
  if (numberOfSeats > availableSeats) {
    throw new Error("Not enough seats available");
  }

  if (!event.price || event.price <= 0) {
    throw new Error("Invalid event price");
  }

  return event;
}

export const getBookingDetails = async (req, res) => {
  try {
    const { pidx } = req.params;

    const booking = await Booking.findOne({ "payment.transactionId": pidx })
      .populate("userId", "fullname email")
      .populate("eventId", "event_name");

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
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
      paymentMethod: booking.payment.method,
    });
  } catch (error) {
    console.error("Error fetching booking details:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch booking details" });
  }
};

export const updateBookingPaymentStatus = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const { paymentStatus = "completed", pidx } = req.body;

    // Find booking by either transaction ID or PIDX
    const booking = await Booking.findOne({
      $or: [
        { "payment.transactionId": transactionId },
        { "payment.pidx": pidx },
      ],
    });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    // Update payment status
    booking.payment.status = paymentStatus;
    booking.payment.processedAt = new Date();

    // Update transaction ID or PIDX if provided
    if (transactionId) booking.payment.transactionId = transactionId;
    if (pidx) booking.payment.pidx = pidx;

    await booking.save();

    // NEW AI INTEGRATION: If payment is completed, update fraud check status
    if (paymentStatus === "completed") {
      updateFraudCheckStatusAsync(booking._id).catch(console.error);
    }

    return res.json({
      success: true,
      message: "Payment status updated successfully",
      bookingId: booking._id,
    });
  } catch (error) {
    console.error("Error updating booking status:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update booking status",
      error: error.message,
    });
  }
};

export const getUserBookedEvents = async (req, res) => {
  try {
    const userId = req.user._id;

    const bookings = await Booking.find({
      userId: userId,
      "payment.status": "completed",
    })
      .populate({
        path: "eventId",
        populate: [
          { path: "org_ID", select: "fullname email" },
          { path: "category", select: "categoryName" },
        ],
      })
      .sort({ createdAt: -1 });

    const bookedEvents = bookings.map((booking) => ({
      bookingId: booking._id,
      event: booking.eventId,
      numberOfSeats: booking.numberOfSeats,
      totalAmount: booking.totalAmount,
      paymentMethod: booking.payment.method,
      bookingDate: booking.createdAt,
    }));

    res.status(200).json({
      success: true,
      totalBookedEvents: bookedEvents.length,
      bookedEvents,
    });
  } catch (error) {
    console.error("Error fetching user booked events:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve booked events",
      error: error.message,
    });
  }
};

// ========================
// NEW AI FUNCTIONS
// ========================

// NEW FUNCTION: Get booking with AI insights
export const getBookingWithAIInsights = async (req, res) => {
  try {
    const { id } = req.params;

    const booking = await Booking.findById(id)
      .populate("userId", "fullname email")
      .populate("eventId", "event_name location price image");

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    // Get AI-related data (non-blocking for performance)
    const [fraudCheck, negotiations] = await Promise.all([
      AI_FraudCheck.findOne({ bookingId: id }),
      AI_NegotiationLog.find({ booking_id: id })
        .sort({ createdAt: -1 })
        .limit(5),
    ]);

    res.status(200).json({
      success: true,
      data: {
        booking,
        aiInsights: {
          fraudCheck,
          negotiations,
          hasAIInsights: !!(fraudCheck || negotiations.length > 0),
        },
      },
    });
  } catch (error) {
    console.error("Error fetching booking with AI insights:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch booking insights",
      error: error.message,
    });
  }
};

// NEW FUNCTION: Get booking fraud risk assessment
export const getBookingFraudRisk = async (req, res) => {
  try {
    const { id } = req.params;

    const fraudCheck = await AI_FraudCheck.findOne({ bookingId: id }).populate(
      "agentId",
      "name role"
    );

    if (!fraudCheck) {
      return res.status(404).json({
        success: false,
        message: "No fraud check data found for this booking",
      });
    }

    res.status(200).json({
      success: true,
      data: fraudCheck,
    });
  } catch (error) {
    console.error("Error fetching fraud risk:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch fraud risk assessment",
      error: error.message,
    });
  }
};

// ========================
// HELPER FUNCTIONS (Async)
// ========================

// NEW HELPER: Trigger fraud check (async, non-blocking)
async function triggerFraudCheckAsync(bookingId, amount) {
  try {
    const fraudAgent = await AI_Agent.findOne({
      agent_type: "admin",
      role: "moderator",
      status: "active",
    });

    if (!fraudAgent) {
      console.warn("No active fraud detection agent found");
      return;
    }

    // Calculate basic risk score
    let riskScore = 0.3; // Base risk
    if (amount > 5000) riskScore += 0.3;
    if (amount > 10000) riskScore += 0.3;

    const fraudCheck = await AI_FraudCheck.create({
      agentId: fraudAgent._id,
      bookingId: bookingId,
      riskScore: Math.min(riskScore, 0.95),
      fraudStatus: riskScore > 0.6 ? "suspicious" : "clean",
      checkVersion: "1.0",
    });

    // Log the action
    await AI_ActionLog.create({
      agentId: fraudAgent._id,
      logType: "fraud_check",
      actionDetails: {
        bookingId,
        riskScore: fraudCheck.riskScore,
        status: fraudCheck.fraudStatus,
        amount,
      },
    });

    console.log(
      `Fraud check created for booking ${bookingId}: ${fraudCheck.fraudStatus}`
    );
  } catch (error) {
    console.error("Error in fraud check:", error);
  }
}

// NEW HELPER: Create negotiation opportunity (async, non-blocking)
async function createNegotiationOpportunityAsync(bookingId, amount) {
  try {
    const negotiationAgent = await AI_Agent.findOne({
      agent_type: "organizer",
      role: "negotiator",
      status: "active",
    });

    if (!negotiationAgent) {
      console.warn("No active negotiation agent found");
      return;
    }

    // Determine negotiation type based on amount
    const negotiationType = amount > 5000 ? "price" : "terms";
    const discountRate = amount > 5000 ? 0.15 : 0.1; // 15% or 10% discount

    await AI_NegotiationLog.create({
      booking_id: bookingId,
      agent_id: negotiationAgent._id,
      negotiation_type: negotiationType,
      initial_offer: amount,
      final_offer: amount * (1 - discountRate),
      status: "pending",
    });

    console.log(`Negotiation opportunity created for booking ${bookingId}`);
  } catch (error) {
    console.error("Error creating negotiation opportunity:", error);
  }
}

// NEW HELPER: Update fraud check status (async, non-blocking)
async function updateFraudCheckStatusAsync(bookingId) {
  try {
    const fraudCheck = await AI_FraudCheck.findOne({ bookingId });
    if (fraudCheck && fraudCheck.fraudStatus === "pending") {
      fraudCheck.fraudStatus = "clean";
      fraudCheck.riskScore = Math.max(0.1, fraudCheck.riskScore - 0.2); // Reduce risk on payment
      await fraudCheck.save();
      console.log(`Updated fraud check for booking ${bookingId} to clean`);
    }
  } catch (error) {
    console.error("Error updating fraud check:", error);
  }
}
