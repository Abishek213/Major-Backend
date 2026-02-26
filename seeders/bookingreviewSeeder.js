import Booking from "../model/booking.schema.js";
import Review from "../model/review.schema.js";
import Event from "../model/event.schema.js";
import User from "../model/user.schema.js";

// ── Helpers ────────────────────────────────────────────────────────────────
const generateTxnId = (prefix, index) =>
  `${prefix}-TXN-${Date.now()}-${index}-${Math.random()
    .toString(36)
    .substring(2, 7)
    .toUpperCase()}`;

const generatePidx = (prefix, index) =>
  `${prefix}-PIDX-${Date.now()}-${index}-${Math.random()
    .toString(36)
    .substring(2, 9)
    .toUpperCase()}`;

const reviewComments = {
  5: [
    "Absolutely amazing experience! Would attend again.",
    "Exceeded all my expectations. Highly recommended!",
    "Best event I have attended this year.",
  ],
  4: [
    "Really enjoyable. A few minor hiccups but overall great.",
    "Well organised and fun. Would come back.",
    "Good value for money. Had a great time.",
  ],
  3: [
    "Decent event but could use some improvements.",
    "Average experience. Nothing stood out.",
    "Okay for the price. Expected a bit more.",
  ],
  2: [
    "Disappointing. Organisation was poor.",
    "Not worth the price. Felt rushed.",
  ],
  1: [
    "Very poor experience. Would not recommend.",
    "Terrible organisation. Left early.",
  ],
};

const pickComment = (rating) => {
  const pool = reviewComments[rating];
  return pool[Math.floor(Math.random() * pool.length)];
};

// ── Booking plan ───────────────────────────────────────────────────────────
//
// PAST events  → completed bookings + reviews  (status:'completed' events)
// FUTURE events → completed bookings, NO review yet (event hasn't happened)
//
// The AI recommendation agent will use the past-event reviews to infer the
// user's preferences (music, tech/education, outdoor sports, gaming, etc.)
// and suggest relevant upcoming events accordingly.

const bookingPlan = [
  // ════════════════════════════════════════════════════════════════════════
  // user@gmail.com — PAST events (reviewed ✔)
  // ════════════════════════════════════════════════════════════════════════
  {
    userEmail: "user@gmail.com",
    eventName: "Indie Music Night", // Concert — past & completed
    seats: 2,
    rating: 5,
    isPastEvent: true,
  },
  {
    userEmail: "user@gmail.com",
    eventName: "Data Science Bootcamp", // Education — past & completed
    seats: 1,
    rating: 4,
    isPastEvent: true,
  },
  {
    userEmail: "user@gmail.com",
    eventName: "Trail Running Challenge", // Outdoor Sports — past & completed
    seats: 1,
    rating: 5,
    isPastEvent: true,
  },
  {
    userEmail: "user@gmail.com",
    eventName: "Street Photography Walk", // Festival — past & completed
    seats: 1,
    rating: 3,
    isPastEvent: true,
  },
  {
    userEmail: "user@gmail.com",
    eventName: "Retro Gaming Expo", // Console Gaming — past & completed
    seats: 2,
    rating: 4,
    isPastEvent: true,
  },

  // ════════════════════════════════════════════════════════════════════════
  // user@gmail.com — FUTURE events (booked, no review yet)
  // The AI agent can cross-reference these with the user's review history
  // to surface better suggestions for remaining upcoming events.
  // ════════════════════════════════════════════════════════════════════════
  {
    userEmail: "user@gmail.com",
    eventName: "Classical Night", // Concert — upcoming
    seats: 1,
    rating: null,
    isPastEvent: false,
  },
  {
    userEmail: "user@gmail.com",
    eventName: "City Marathon 2024", // Outdoor Sports — upcoming
    seats: 1,
    rating: null,
    isPastEvent: false,
  },
  {
    userEmail: "user@gmail.com",
    eventName: "PC Gaming Championship", // PC Gaming — upcoming
    seats: 1,
    rating: null,
    isPastEvent: false,
  },

  // ════════════════════════════════════════════════════════════════════════
  // organizer@gmail.com — mixed (sparse)
  // ════════════════════════════════════════════════════════════════════════
  {
    userEmail: "organizer@gmail.com",
    eventName: "Data Science Bootcamp",
    seats: 1,
    rating: 5,
    isPastEvent: true,
  },
  {
    userEmail: "organizer@gmail.com",
    eventName: "Retro Gaming Expo",
    seats: 1,
    rating: 4,
    isPastEvent: true,
  },
  {
    userEmail: "organizer@gmail.com",
    eventName: "Tech Conference 2024",
    seats: 1,
    rating: null,
    isPastEvent: false,
  },
  {
    userEmail: "organizer@gmail.com",
    eventName: "ESports Tournament",
    seats: 2,
    rating: null,
    isPastEvent: false,
  },
];

// ── Seeder ─────────────────────────────────────────────────────────────────
const seedBookingsAndReviews = async () => {
  let bookingCreated = 0;
  let bookingSkipped = 0;
  let reviewCreated = 0;
  let reviewSkipped = 0;
  let failed = 0;

  for (let i = 0; i < bookingPlan.length; i++) {
    const plan = bookingPlan[i];

    try {
      // ── Resolve user ────────────────────────────────────────────────────
      const user = await User.findOne({ email: plan.userEmail });
      if (!user) {
        console.warn(`  ⚠  User not found: ${plan.userEmail}`);
        failed++;
        continue;
      }

      // ── Resolve event ───────────────────────────────────────────────────
      const event = await Event.findOne({ event_name: plan.eventName });
      if (!event) {
        console.warn(`  ⚠  Event not found: "${plan.eventName}"`);
        failed++;
        continue;
      }

      // ── Guard: only create reviews for completed events ─────────────────
      if (plan.rating !== null && event.status !== "completed") {
        console.warn(
          `  ⚠  Skipping review for "${plan.eventName}" — event is not completed (status: ${event.status})`
        );
      }

      // ── Create booking if not already present ───────────────────────────
      const existingBooking = await Booking.findOne({
        userId: user._id,
        eventId: event._id,
      });

      if (existingBooking) {
        bookingSkipped++;
      } else {
        const totalAmount = parseFloat((event.price * plan.seats).toFixed(2));
        const paymentMethod = i % 2 === 0 ? "Khalti" : "eSewa";

        // Past bookings get a processedAt in the past; future bookings recent
        const processedAt = plan.isPastEvent
          ? new Date(event.event_date.getTime() - 5 * 24 * 60 * 60 * 1000) // 5 days before event
          : new Date(
              Date.now() - Math.floor(Math.random() * 3 * 24 * 60 * 60 * 1000)
            );

        const booking = new Booking({
          userId: user._id,
          eventId: event._id,
          numberOfSeats: plan.seats,
          totalAmount,
          payment: {
            status: "completed",
            method: paymentMethod,
            transactionId: generateTxnId(paymentMethod.toUpperCase(), i),
            pidx: generatePidx(paymentMethod.toUpperCase(), i),
            currency: "NPR",
            processedAt,
          },
        });

        await booking.save();
        bookingCreated++;

        // Add user to event attendees
        if (!event.attendees.includes(user._id)) {
          event.attendees.push(user._id);
          await event.save({ validateBeforeSave: false });
        }
      }

      // ── Create review — only for past/completed events ──────────────────
      if (plan.rating !== null && event.status === "completed") {
        const existingReview = await Review.findOne({
          userId: user._id,
          eventId: event._id,
        });

        if (existingReview) {
          reviewSkipped++;
        } else {
          const review = new Review({
            userId: user._id,
            eventId: event._id,
            rating: plan.rating,
            comment: pickComment(plan.rating),
          });

          await review.save();
          reviewCreated++;
        }
      }
    } catch (err) {
      console.error(
        `  ✗  Failed [${plan.userEmail} → ${plan.eventName}]: ${err.message}`
      );
      failed++;
    }
  }

  console.log("\n── Booking & Review Seeder Summary ─────────────────────");
  console.log(
    `  Bookings : ${bookingCreated} created, ${bookingSkipped} skipped`
  );
  console.log(
    `  Reviews  : ${reviewCreated} created, ${reviewSkipped} skipped`
  );
  console.log(`  Failures : ${failed}`);
  console.log("────────────────────────────────────────────────────────\n");
};

export default seedBookingsAndReviews;
