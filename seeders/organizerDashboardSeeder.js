// Backend/seeders/organizerDashboard.seeder.js
import mongoose from "mongoose";
import bcryptjs from "bcryptjs";
import User from "../model/user.schema.js";
import Role from "../model/role.schema.js";
import Category from "../model/categories.schema.js";
import Event from "../model/event.schema.js";
import Booking from "../model/booking.schema.js";
import Review from "../model/review.schema.js";
import AI_Agent from "../model/ai_agent.schema.js";
import AI_FeedbackSentiment from "../model/ai_feedbackSentiment.schema.js";

// ─── Utility helpers ──────────────────────────────────────────────────────────

const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randFloat = (min, max) =>
  parseFloat((Math.random() * (max - min) + min).toFixed(4));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => [...arr].sort(() => Math.random() - 0.5);

/** Returns a Date offset by `days` from today (negative = past) */
const daysFrom = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
};

/** Generates a unique-ish transaction ID */
let txCounter = 0;
const uniqueTxId = () =>
  `TXN_SEED_${Date.now()}_${++txCounter}_${randInt(1000, 9999)}`;
const uniquePidx = () =>
  `PIDX_SEED_${Date.now()}_${++txCounter}_${randInt(1000, 9999)}`;

// ─── Static seed data ─────────────────────────────────────────────────────────

const CATEGORY_NAMES = [
  "Technology",
  "Music",
  "Sports",
  "Business",
  "Arts & Culture",
  "Food & Drink",
  "Health & Wellness",
  "Education",
];

const AGENTS_SEED = [
  {
    name: "organizer-dashboard-assistant",
    role: "assistant",
    agent_type: "organizer",
    status: "active",
    capabilities: {
      dashboard_metrics: true,
      sentiment_summary: true,
      trend_analysis: true,
    },
  },
  {
    name: "sentiment-analyst",
    role: "analyst",
    agent_type: "admin",
    status: "active",
    capabilities: {
      sentiment_scoring: true,
      issue_detection: true,
      keyword_extraction: true,
    },
  },
  {
    name: "planning-agent",
    role: "planner",
    agent_type: "organizer",
    status: "active",
    capabilities: {
      price_optimization: true,
      tag_recommendation: true,
      slot_suggestion: true,
      datetime_optimization: true,
      deadline_validation: true,
    },
  },
];

/** 10 test attendee users */
const ATTENDEE_EMAILS = Array.from({ length: 10 }, (_, i) => ({
  fullname: `Test Attendee ${i + 1}`,
  email: `attendee${i + 1}@seed.com`,
  password: "attendee123",
  contactNo: `980000000${i + 1}`,
}));

/**
 * Event templates.
 * past: true  → event_date in the past, status: 'completed'
 * past: false → event_date in the future, varied status
 */
const EVENT_TEMPLATES = [
  // ── COMPLETED PAST EVENTS (rich data source for bookings + reviews) ──
  {
    event_name: "Kathmandu Tech Summit 2024",
    description:
      "The biggest technology conference in Nepal featuring keynotes on AI, cloud, and blockchain. Industry leaders share cutting-edge insights and future trends.",
    daysOffset: -90,
    time: "09:00",
    location: "Hyatt Regency, Kathmandu",
    price: 2500,
    categoryName: "Technology",
    tags: ["tech", "AI", "cloud", "blockchain", "keynote"],
    totalSlots: 300,
    status: "completed",
    past: true,
    fillPercent: 0.88, // 88% filled
  },
  {
    event_name: "Himalayan Music Festival",
    description:
      "Three days of live performances spanning folk, jazz, and contemporary Nepali music. International and local artists on three stages with food stalls and craft markets.",
    daysOffset: -60,
    time: "14:00",
    location: "Tundikhel Grounds, Kathmandu",
    price: 1500,
    categoryName: "Music",
    tags: ["music", "festival", "live", "folk", "jazz"],
    totalSlots: 500,
    status: "completed",
    past: true,
    fillPercent: 0.94,
  },
  {
    event_name: "Startup Founders Bootcamp",
    description:
      "Intensive 2-day bootcamp for early-stage founders covering fundraising, product-market fit, and go-to-market strategy. Mentors from top VC firms attending.",
    daysOffset: -45,
    time: "08:30",
    location: "Thamel Hub, Kathmandu",
    price: 5000,
    categoryName: "Business",
    tags: ["startup", "founders", "venture", "fundraising", "mentorship"],
    totalSlots: 80,
    status: "completed",
    past: true,
    fillPercent: 0.75,
  },
  {
    event_name: "Yoga & Wellness Retreat",
    description:
      "A full-day wellness immersion combining yoga, meditation, breathwork, and nutritional workshops led by certified practitioners in a serene natural setting.",
    daysOffset: -30,
    time: "06:00",
    location: "Nagarkot Eco Resort",
    price: 3500,
    categoryName: "Health & Wellness",
    tags: ["yoga", "wellness", "meditation", "retreat", "mindfulness"],
    totalSlots: 60,
    status: "completed",
    past: true,
    fillPercent: 0.83,
  },
  {
    event_name: "Digital Art Exhibition",
    description:
      "Showcasing 40+ Nepali digital artists exploring themes of identity, urbanisation, and nature. Interactive installations, NFT drops, and live art sessions.",
    daysOffset: -15,
    time: "10:00",
    location: "Siddhartha Art Gallery, Baber Mahal",
    price: 800,
    categoryName: "Arts & Culture",
    tags: ["art", "digital", "exhibition", "NFT", "interactive"],
    totalSlots: 150,
    status: "completed",
    past: true,
    fillPercent: 0.6, // intentionally low for warning insight
  },

  // ── UPCOMING EVENTS (high fill — success insights) ──
  {
    event_name: "AI & Machine Learning Workshop",
    description:
      "Hands-on workshop covering practical ML with Python, TensorFlow, and real datasets. Suitable for developers with basic Python knowledge. Laptops required.",
    daysOffset: 14,
    time: "10:00",
    location: "Millenium IT Park, Chakupat",
    price: 3000,
    categoryName: "Technology",
    tags: ["AI", "machine-learning", "python", "tensorflow", "hands-on"],
    totalSlots: 50,
    status: "approved",
    past: false,
    fillPercent: 0.86,
  },
  {
    event_name: "Nepali Culinary Masterclass",
    description:
      "Learn authentic Newari and Thakali cooking techniques from award-winning chefs. Includes market tour, cooking session, and sit-down dinner with wine pairing.",
    daysOffset: 21,
    time: "11:00",
    location: "Patan Dhoka Heritage Kitchen",
    price: 4500,
    categoryName: "Food & Drink",
    tags: ["cooking", "culinary", "newari", "masterclass", "food"],
    totalSlots: 30,
    status: "approved",
    past: false,
    fillPercent: 0.9,
  },
  {
    event_name: "Mountain Trail Marathon",
    description:
      "Scenic 21km and 42km trail runs through Shivapuri National Park. Chip timing, aid stations every 5km, medical support, and finisher medals for all participants.",
    daysOffset: 30,
    time: "05:30",
    location: "Shivapuri National Park Gate",
    price: 2000,
    categoryName: "Sports",
    tags: ["marathon", "trail", "running", "fitness", "outdoors"],
    totalSlots: 200,
    status: "approved",
    past: false,
    fillPercent: 0.78,
  },

  // ── UPCOMING EVENTS (low fill — warning insights) ──
  {
    event_name: "Classical Music Evening",
    description:
      "An intimate evening of Western classical piano and violin performances by conservatory graduates. Programme includes Chopin, Bach, and original Nepali compositions.",
    daysOffset: 45,
    time: "18:30",
    location: "British Council, Lazimpat",
    price: 1200,
    categoryName: "Music",
    tags: ["classical", "piano", "violin", "concert", "intimate"],
    totalSlots: 120,
    status: "upcoming",
    past: false,
    fillPercent: 0.22, // low — triggers warning
  },
  {
    event_name: "EdTech & Future of Learning Summit",
    description:
      "Exploring how technology is reshaping education in South Asia. Panel discussions, product demos, and networking for educators, edtech founders, and policymakers.",
    daysOffset: 60,
    time: "09:00",
    location: "Tribhuvan University Conference Hall",
    price: 500,
    categoryName: "Education",
    tags: ["education", "edtech", "learning", "innovation", "summit"],
    totalSlots: 250,
    status: "pending",
    past: false,
    fillPercent: 0.18, // very low
  },
];

// Review comment banks by sentiment tier
const POSITIVE_COMMENTS = [
  "Absolutely phenomenal event! The organisation was flawless and every speaker delivered real value.",
  "Best event I have attended in Kathmandu. Will definitely be back next year.",
  "Exceeded all my expectations. The venue, content, and networking were all top-notch.",
  "Incredibly well run. Registration was smooth, sessions started on time, great food.",
  "Loved every minute. The speakers were world-class and very approachable.",
  "Outstanding production quality. Felt like an international conference right here in Nepal.",
  "Highly recommend this to everyone. Life-changing experience and amazing people.",
  "Perfect event from start to finish. The team clearly put enormous effort into this.",
];

const NEUTRAL_COMMENTS = [
  "Good event overall but the venue was a bit cramped for the number of attendees.",
  "Decent programme. Some sessions were excellent, others felt rushed.",
  "Okay experience. A few technical glitches with the AV but organisers handled it.",
  "Met some interesting people but the schedule ran 30 minutes behind most of the day.",
  "Content was solid but the catering could have been better for the price.",
  "Worth attending but not quite as described in the marketing materials.",
  "Average experience. Nothing particularly memorable but nothing terrible either.",
  "Good concept but execution needs improvement. Would give it another chance.",
];

const NEGATIVE_COMMENTS = [
  "Very disappointed. The event started two hours late with no communication to attendees.",
  "Poor sound quality in the main hall made it impossible to hear speakers clearly.",
  "Overcrowded and disorganised. Staff seemed unprepared and gave conflicting information.",
  "Not worth the ticket price. Most content was available for free on YouTube.",
  "Venue was too small for the crowd. Many people standing throughout.",
  "Registration was chaotic and the queue system broke down completely.",
  "Several advertised speakers cancelled last minute with no substitutes arranged.",
];

// Detected issues mapped to sentiment tier
const ISSUE_POOL = {
  negative: [
    "long queues",
    "poor sound quality",
    "venue too small",
    "late start",
    "poor catering",
    "unclear schedule",
    "missing speakers",
    "technical difficulties",
  ],
  neutral: [
    "minor delays",
    "crowded venue",
    "average catering",
    "session overrun",
  ],
  positive: [],
};

// ─── Main seeder function ─────────────────────────────────────────────────────

const seedOrganizerDashboard = async () => {
  console.log("Starting Organizer Dashboard Seeder...");
  const stats = {
    categories: { created: 0, skipped: 0 },
    agents: { created: 0, skipped: 0 },
    attendees: { created: 0, skipped: 0 },
    events: { created: 0, skipped: 0, failed: 0 },
    bookings: { created: 0, skipped: 0 },
    reviews: { created: 0, skipped: 0 },
    sentiment: { created: 0, skipped: 0 },
  };

  // ── 1. Find organizer user ───────────────────────────────────────────────
  const organizer = await User.findOne({ email: "organizer@gmail.com" });
  if (!organizer) {
    console.error(
      "❌ organizer@gmail.com not found. Run the user seeder first."
    );
    return;
  }
  console.log(`Found organizer: ${organizer.fullname} (${organizer._id})`);

  // ── 2. Find User role for attendees ─────────────────────────────────────
  const userRole = await Role.findOne({ role_Name: "User" });
  if (!userRole) {
    console.error("❌ User role not found. Run the role seeder first.");
    return;
  }

  // ── 3. Seed categories ───────────────────────────────────────────────────
  const categoryMap = {}; // name → ObjectId

  for (const name of CATEGORY_NAMES) {
    let cat = await Category.findOne({ categoryName: name });
    if (cat) {
      categoryMap[name] = cat._id;
      stats.categories.skipped++;
    } else {
      cat = await Category.create({ categoryName: name, isActive: true });
      categoryMap[name] = cat._id;
      stats.categories.created++;
    }
  }

  // ── 4. Seed AI agents ────────────────────────────────────────────────────
  const agentMap = {}; // name → ObjectId

  for (const agentData of AGENTS_SEED) {
    let agent = await AI_Agent.findOne({ name: agentData.name });
    if (agent) {
      agentMap[agentData.name] = agent._id;
      stats.agents.skipped++;
    } else {
      agent = await AI_Agent.create(agentData);
      agentMap[agentData.name] = agent._id;
      stats.agents.created++;
    }
  }

  const sentimentAgentId = agentMap["sentiment-analyst"];

  // ── 5. Seed attendee users ───────────────────────────────────────────────
  const attendeeIds = [];

  for (const att of ATTENDEE_EMAILS) {
    let user = await User.findOne({ email: att.email });
    if (user) {
      attendeeIds.push(user._id);
      stats.attendees.skipped++;
    } else {
      const hashed = await bcryptjs.hash(att.password, 10);
      user = await User.create({
        fullname: att.fullname,
        email: att.email,
        password: hashed,
        contactNo: att.contactNo,
        role: userRole._id,
      });
      attendeeIds.push(user._id);
      stats.attendees.created++;
    }
  }

  // ── 6. Seed events ───────────────────────────────────────────────────────
  const seededEvents = []; // { event, template }

  for (const tmpl of EVENT_TEMPLATES) {
    const existing = await Event.findOne({
      event_name: tmpl.event_name,
      org_ID: organizer._id,
    });

    if (existing) {
      seededEvents.push({ event: existing, template: tmpl });
      stats.events.skipped++;
      continue;
    }

    try {
      const eventDate = daysFrom(tmpl.daysOffset);
      const regDeadline = new Date(eventDate);
      regDeadline.setDate(regDeadline.getDate() - 3);

      const bookedSlots = Math.floor(tmpl.totalSlots * tmpl.fillPercent);
      // Pick attendees (repeat if needed for large events)
      const selectedAttendees = Array.from(
        { length: Math.min(bookedSlots, attendeeIds.length) },
        (_, i) => attendeeIds[i % attendeeIds.length]
      );

      // Use collection.insertOne to bypass the future-date validator for past events
      const eventDoc = {
        _id: new mongoose.Types.ObjectId(),
        event_name: tmpl.event_name,
        description: tmpl.description,
        event_date: eventDate,
        registrationDeadline: tmpl.past
          ? new Date(eventDate.getTime() - 3 * 86400000)
          : regDeadline,
        time: tmpl.time,
        location: tmpl.location,
        price: tmpl.price,
        category: categoryMap[tmpl.categoryName],
        tags: tmpl.tags,
        totalSlots: tmpl.totalSlots,
        attendees: selectedAttendees,
        org_ID: organizer._id,
        isPublic: true,
        status: tmpl.status,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Bypass schema validators for past events via raw collection insert
      await Event.collection.insertOne(eventDoc);
      const event = await Event.findById(eventDoc._id);
      seededEvents.push({ event, template: tmpl });
      stats.events.created++;
    } catch (err) {
      console.error(
        `   ✗ Failed to create event "${tmpl.event_name}":`,
        err.message
      );
      stats.events.failed++;
    }
  }

  // ── 7. Seed bookings ─────────────────────────────────────────────────────
  for (const { event, template } of seededEvents) {
    const bookedSlots = Math.floor(template.totalSlots * template.fillPercent);
    const bookingCount = Math.min(bookedSlots, attendeeIds.length * 2);

    for (let i = 0; i < bookingCount; i++) {
      const userId = attendeeIds[i % attendeeIds.length];
      const seats = pick([1, 1, 1, 2, 2, 3]); // weighted towards 1-2 seats
      const isPast = template.past;

      const existing = await Booking.findOne({ userId, eventId: event._id });
      if (existing) {
        stats.bookings.skipped++;
        continue;
      }

      // Past events: mostly completed; upcoming: mix of pending/completed
      const paymentStatus = isPast
        ? pick(["completed", "completed", "completed", "completed", "refunded"])
        : pick(["completed", "completed", "pending"]);

      const paymentMethod = pick(["Khalti", "eSewa"]);

      const bookingDate = isPast
        ? daysFrom(template.daysOffset - randInt(5, 30)) // booked before event
        : daysFrom(-randInt(1, 10)); // recently booked

      await Booking.collection.insertOne({
        _id: new mongoose.Types.ObjectId(),
        userId,
        eventId: event._id,
        numberOfSeats: seats,
        totalAmount: event.price * seats,
        payment: {
          status: paymentStatus,
          method: paymentMethod,
          transactionId: uniqueTxId(),
          pidx: uniquePidx(),
          currency: "NPR",
          processedAt: paymentStatus === "completed" ? bookingDate : null,
          gatewayResponse: { code: "000", message: "Success" },
          refund:
            paymentStatus === "refunded"
              ? {
                  amount: event.price * seats,
                  date: bookingDate,
                  reason: "Attendee cancellation",
                  status: "processed",
                }
              : null,
        },
        createdAt: bookingDate,
        updatedAt: bookingDate,
      });
      stats.bookings.created++;
    }
  }

  // ── 8. Seed reviews (past/completed events only) ─────────────────────────
  // Sentiment distribution per event (drives realistic score spread)
  const SENTIMENT_PROFILES = [
    { positive: 0.75, neutral: 0.18, negative: 0.07 }, // very positive event
    { positive: 0.8, neutral: 0.15, negative: 0.05 }, // excellent
    { positive: 0.55, neutral: 0.3, negative: 0.15 }, // decent
    { positive: 0.6, neutral: 0.25, negative: 0.15 }, // mixed
    { positive: 0.4, neutral: 0.3, negative: 0.3 }, // poor — low fill event
  ];

  const pastEvents = seededEvents.filter(({ template }) => template.past);
  const seededReviews = []; // { review, sentimentTier }

  for (let ei = 0; ei < pastEvents.length; ei++) {
    const { event, template } = pastEvents[ei];
    const profile = SENTIMENT_PROFILES[ei % SENTIMENT_PROFILES.length];
    const reviewCount = Math.floor(event.attendees.length * 0.4); // ~40% of attendees leave reviews

    const shuffledAttendees = shuffle(attendeeIds);

    for (
      let ri = 0;
      ri < Math.min(reviewCount, shuffledAttendees.length);
      ri++
    ) {
      const userId = shuffledAttendees[ri];

      const existing = await Review.findOne({ userId, eventId: event._id });
      if (existing) {
        seededReviews.push({ review: existing, sentimentTier: "neutral" });
        stats.reviews.skipped++;
        continue;
      }

      // Determine sentiment tier
      const roll = Math.random();
      let tier, rating, comment;

      if (roll < profile.positive) {
        tier = "positive";
        rating = pick([4, 4, 5, 5, 5]);
        comment = pick(POSITIVE_COMMENTS);
      } else if (roll < profile.positive + profile.neutral) {
        tier = "neutral";
        rating = pick([3, 3, 4]);
        comment = pick(NEUTRAL_COMMENTS);
      } else {
        tier = "negative";
        rating = pick([1, 2, 2, 3]);
        comment = pick(NEGATIVE_COMMENTS);
      }

      const reviewDate = daysFrom(
        template?.daysOffset
          ? template.daysOffset + randInt(1, 7)
          : -randInt(1, 20)
      );

      const review = await Review.collection.insertOne({
        _id: new mongoose.Types.ObjectId(),
        userId,
        eventId: event._id,
        rating,
        comment,
        createdAt: reviewDate,
        updatedAt: reviewDate,
      });

      seededReviews.push({
        review: { _id: review.insertedId },
        sentimentTier: tier,
      });
      stats.reviews.created++;
    }
  }

  // ── 9. Seed AI sentiment analysis ────────────────────────────────────────
  for (const { review, sentimentTier } of seededReviews) {
    const existing = await AI_FeedbackSentiment.findOne({
      review_id: review._id,
    });
    if (existing) {
      stats.sentiment.skipped++;
      continue;
    }

    // Score ranges:
    //   positive → 0.35 to 1.0
    //   neutral  → -0.30 to 0.34
    //   negative → -1.0 to -0.31
    let sentiment_score;
    const issues = [];

    if (sentimentTier === "positive") {
      sentiment_score = randFloat(0.35, 1.0);
    } else if (sentimentTier === "neutral") {
      sentiment_score = randFloat(-0.3, 0.34);
      const pool = ISSUE_POOL.neutral;
      const count = randInt(0, 2);
      for (let i = 0; i < count; i++) issues.push(pick(pool));
    } else {
      sentiment_score = randFloat(-1.0, -0.31);
      const pool = ISSUE_POOL.negative;
      const count = randInt(1, 3);
      const picked = new Set();
      while (picked.size < count) picked.add(pick(pool));
      issues.push(...picked);
    }

    await AI_FeedbackSentiment.create({
      review_id: review._id,
      agent_id: sentimentAgentId,
      sentiment_score,
      detected_issues: issues,
    });
    stats.sentiment.created++;
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log("─────────────────────────────────────────────");
  console.log("📊 Seeder Summary");
  console.log("─────────────────────────────────────────────");
  console.log(
    `   Categories  : ${stats.categories.created} created, ${stats.categories.skipped} existing`
  );
  console.log(
    `   AI Agents   : ${stats.agents.created} created, ${stats.agents.skipped} existing`
  );
  console.log(
    `   Attendees   : ${stats.attendees.created} created, ${stats.attendees.skipped} existing`
  );
  console.log(
    `   Events      : ${stats.events.created} created, ${stats.events.skipped} existing, ${stats.events.failed} failed`
  );
  console.log(
    `   Bookings    : ${stats.bookings.created} created, ${stats.bookings.skipped} existing`
  );
  console.log(
    `   Reviews     : ${stats.reviews.created} created, ${stats.reviews.skipped} existing`
  );
  console.log(
    `   Sentiment   : ${stats.sentiment.created} created, ${stats.sentiment.skipped} existing`
  );
  console.log("─────────────────────────────────────────────");
  console.log("Organizer dashboard seeder complete!");
};

export default seedOrganizerDashboard;
