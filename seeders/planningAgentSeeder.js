import Event from "../model/event.schema.js";
import Category from "../model/categories.schema.js";
import User from "../model/user.schema.js";

const LOCATIONS = [
  "Kathmandu",
  "Pokhara",
  "Lalitpur",
  "Bhaktapur",
  "Chitwan",
  "Biratnagar",
  "Birgunj",
  "Dharan",
];

const EVENT_TEMPLATES = [
  {
    categoryName: "Conference",
    events: [
      {
        event_name: "Nepal Tech Summit",
        price: 2500,
        totalSlots: 300,
        tags: ["tech", "innovation", "networking"],
      },
      {
        event_name: "Startup Nepal Connect",
        price: 1500,
        totalSlots: 200,
        tags: ["startup", "business", "pitch"],
      },
      {
        event_name: "AI & ML Workshop Nepal",
        price: 3000,
        totalSlots: 80,
        tags: ["ai", "machinelearning", "workshop"],
      },
      {
        event_name: "DevOps Nepal",
        price: 2000,
        totalSlots: 150,
        tags: ["devops", "cloud", "tech"],
      },
      {
        event_name: "Nepal Cloud Expo",
        price: 1800,
        totalSlots: 250,
        tags: ["cloud", "saas", "tech"],
      },
    ],
  },
  {
    categoryName: "Workshop",
    events: [
      {
        event_name: "React.js Bootcamp",
        price: 4500,
        totalSlots: 30,
        tags: ["react", "javascript", "frontend"],
      },
      {
        event_name: "Photography Masterclass",
        price: 3500,
        totalSlots: 25,
        tags: ["photography", "art", "creative"],
      },
      {
        event_name: "Digital Marketing Workshop",
        price: 2500,
        totalSlots: 50,
        tags: ["marketing", "digital", "seo"],
      },
      {
        event_name: "Python for Data Science",
        price: 5000,
        totalSlots: 40,
        tags: ["python", "data", "analytics"],
      },
      {
        event_name: "UI/UX Design Sprint",
        price: 4000,
        totalSlots: 20,
        tags: ["design", "ux", "figma"],
      },
    ],
  },
  {
    categoryName: "Networking",
    events: [
      {
        event_name: "Entrepreneurs Meetup",
        price: 500,
        totalSlots: 100,
        tags: ["business", "networking", "entrepreneur"],
      },
      {
        event_name: "Young Professionals Nepal",
        price: 300,
        totalSlots: 150,
        tags: ["professional", "career", "networking"],
      },
      {
        event_name: "Women in Tech Nepal",
        price: 0,
        totalSlots: 80,
        tags: ["women", "tech", "diversity"],
      },
      {
        event_name: "Fintech Nepal Meetup",
        price: 800,
        totalSlots: 120,
        tags: ["fintech", "banking", "startup"],
      },
      {
        event_name: "Creative Industry Night",
        price: 600,
        totalSlots: 90,
        tags: ["creative", "design", "art"],
      },
    ],
  },
  {
    categoryName: "Sports",
    events: [
      {
        event_name: "Nepal Marathon",
        price: 1500,
        totalSlots: 500,
        tags: ["marathon", "running", "fitness"],
      },
      {
        event_name: "Nepal Football Tournament",
        price: 200,
        totalSlots: 800,
        tags: ["football", "tournament", "sports"],
      },
      {
        event_name: "Cycling Challenge",
        price: 800,
        totalSlots: 200,
        tags: ["cycling", "outdoor", "adventure"],
      },
      {
        event_name: "Yoga Festival Nepal",
        price: 1200,
        totalSlots: 150,
        tags: ["yoga", "wellness", "mindfulness"],
      },
      {
        event_name: "Nepal Basketball League",
        price: 300,
        totalSlots: 600,
        tags: ["basketball", "sports", "league"],
      },
    ],
  },
  {
    categoryName: "Concert",
    events: [
      {
        event_name: "Nepal Music Festival",
        price: 2000,
        totalSlots: 1000,
        tags: ["music", "festival", "live"],
      },
      {
        event_name: "Jazz Night",
        price: 1500,
        totalSlots: 200,
        tags: ["jazz", "music", "nightlife"],
      },
      {
        event_name: "Classical Music Evening",
        price: 800,
        totalSlots: 150,
        tags: ["classical", "music", "culture"],
      },
      {
        event_name: "Rock Concert",
        price: 1800,
        totalSlots: 500,
        tags: ["rock", "band", "live-music"],
      },
      {
        event_name: "Folk Music of Nepal Showcase",
        price: 500,
        totalSlots: 300,
        tags: ["folk", "traditional", "culture"],
      },
    ],
  },
  {
    categoryName: "Seminar",
    events: [
      {
        event_name: "Career Development Summit",
        price: 1000,
        totalSlots: 200,
        tags: ["career", "professional", "growth"],
      },
      {
        event_name: "Mental Health Awareness Talk",
        price: 0,
        totalSlots: 100,
        tags: ["health", "wellness", "awareness"],
      },
      {
        event_name: "Financial Planning Workshop",
        price: 1500,
        totalSlots: 80,
        tags: ["finance", "investment", "planning"],
      },
      {
        event_name: "Leadership Excellence Program",
        price: 3000,
        totalSlots: 50,
        tags: ["leadership", "management", "corporate"],
      },
      {
        event_name: "Entrepreneurship 101",
        price: 800,
        totalSlots: 120,
        tags: ["entrepreneur", "business", "startup"],
      },
    ],
  },
];

// ─── helpers ──────────────────────────────────────────────────────────────────

// All dates strictly in the future (min 3 days, max 12 months ahead)
// This avoids the schema validator: "Event date must be in the future"
const futureDateBetween = (minDays, maxDays) => {
  const date = new Date();
  const days = Math.floor(minDays + Math.random() * (maxDays - minDays));
  date.setDate(date.getDate() + days);
  return date;
};

const priceVariant = (base) =>
  Math.round((base * (0.7 + Math.random() * 0.6)) / 50) * 50;
const slotVariant = (base) => Math.round(base * (0.6 + Math.random() * 0.8));

// ─── seeder ───────────────────────────────────────────────────────────────────

const seedPlanningAgentEvents = async () => {
  let created = 0;
  let skipped = 0;
  let failed = 0;

  const organizer = await User.findOne({ email: "organizer@gmail.com" });
  if (!organizer) {
    console.log(
      "Events (planning agent): 0 created — organizer@gmail.com not found, run user seeder first"
    );
    return;
  }

  const allCategories = await Category.find({ isActive: true });
  if (allCategories.length === 0) {
    console.log(
      "Events (planning agent): 0 created — no active categories found, run category seeder first"
    );
    return;
  }

  for (const template of EVENT_TEMPLATES) {
    const category = allCategories.find(
      (c) =>
        c.categoryName
          .toLowerCase()
          .includes(template.categoryName.toLowerCase()) ||
        template.categoryName
          .toLowerCase()
          .includes(c.categoryName.toLowerCase())
    );

    if (!category) {
      failed += template.events.length * LOCATIONS.length;
      continue;
    }

    for (const tmpl of template.events) {
      for (const location of LOCATIONS) {
        const name = `${tmpl.event_name} – ${location}`;

        const exists = await Event.findOne({ event_name: name });
        if (exists) {
          skipped++;
          continue;
        }

        // event_date: 7–365 days from now (all future, passes schema validation)
        const eventDate = futureDateBetween(7, 365);

        // registrationDeadline: 3–10 days before the event date (also future)
        const regDeadline = new Date(eventDate);
        regDeadline.setDate(
          eventDate.getDate() - Math.floor(3 + Math.random() * 7)
        );

        const totalSlots = slotVariant(tmpl.totalSlots);
        const attendees = Math.floor(totalSlots * (0.3 + Math.random() * 0.5));

        const newEvent = new Event({
          event_name: name,
          description: `${tmpl.event_name} happening in ${location}. Join us for an unforgettable experience with industry experts and networking opportunities.`,
          event_date: eventDate,
          registrationDeadline: regDeadline,
          time: `${9 + Math.floor(Math.random() * 8)}:00`,
          location,
          price: priceVariant(tmpl.price),
          category: category._id,
          totalSlots,
          org_ID: organizer._id,
          tags: tmpl.tags,
          isPublic: true,
          status: "approved",
          attendees: Array(attendees).fill(organizer._id),
        });

        await newEvent.save();
        created++;
      }
    }
  }

  console.log(
    `Events (planning agent): ${created} created, ${skipped} existing, ${failed} failed`
  );
};

export default seedPlanningAgentEvents;
