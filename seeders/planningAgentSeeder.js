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

// More varied location descriptors to make names unique
const LOCATION_VARIATIONS = {
  Kathmandu: ["Valley", "City", "Center", "Hub"],
  Pokhara: ["Lakeside", "City", "Valley"],
  Lalitpur: ["Patan", "City"],
  Bhaktapur: ["Durbar Square", "City"],
  Chitwan: ["Sauraha", "City"],
  Biratnagar: ["Metro", "City"],
  Birgunj: ["Ganj", "City"],
  Dharan: ["Town", "City"],
};

const EVENT_TEMPLATES = [
  {
    categoryName: "Conference",
    events: [
      {
        baseName: "Nepal Tech Summit",
        price: 2500,
        totalSlots: 300,
        tags: ["tech", "innovation", "networking"],
      },
      {
        baseName: "Startup Nepal Connect",
        price: 1500,
        totalSlots: 200,
        tags: ["startup", "business", "pitch"],
      },
      {
        baseName: "AI & ML Workshop Nepal",
        price: 3000,
        totalSlots: 80,
        tags: ["ai", "machinelearning", "workshop"],
      },
      {
        baseName: "DevOps Nepal",
        price: 2000,
        totalSlots: 150,
        tags: ["devops", "cloud", "tech"],
      },
      {
        baseName: "Nepal Cloud Expo",
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
        baseName: "React.js Bootcamp",
        price: 4500,
        totalSlots: 30,
        tags: ["react", "javascript", "frontend"],
      },
      {
        baseName: "Photography Masterclass",
        price: 3500,
        totalSlots: 25,
        tags: ["photography", "art", "creative"],
      },
      {
        baseName: "Digital Marketing Workshop",
        price: 2500,
        totalSlots: 50,
        tags: ["marketing", "digital", "seo"],
      },
      {
        baseName: "Python for Data Science",
        price: 5000,
        totalSlots: 40,
        tags: ["python", "data", "analytics"],
      },
      {
        baseName: "UI/UX Design Sprint",
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
        baseName: "Entrepreneurs Meetup",
        price: 500,
        totalSlots: 100,
        tags: ["business", "networking", "entrepreneur"],
      },
      {
        baseName: "Young Professionals Nepal",
        price: 300,
        totalSlots: 150,
        tags: ["professional", "career", "networking"],
      },
      {
        baseName: "Women in Tech Nepal",
        price: 0,
        totalSlots: 80,
        tags: ["women", "tech", "diversity"],
      },
      {
        baseName: "Fintech Nepal Meetup",
        price: 800,
        totalSlots: 120,
        tags: ["fintech", "banking", "startup"],
      },
      {
        baseName: "Creative Industry Night",
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
        baseName: "Nepal Marathon",
        price: 1500,
        totalSlots: 500,
        tags: ["marathon", "running", "fitness"],
      },
      {
        baseName: "Nepal Football Tournament",
        price: 200,
        totalSlots: 800,
        tags: ["football", "tournament", "sports"],
      },
      {
        baseName: "Cycling Challenge",
        price: 800,
        totalSlots: 200,
        tags: ["cycling", "outdoor", "adventure"],
      },
      {
        baseName: "Yoga Festival Nepal",
        price: 1200,
        totalSlots: 150,
        tags: ["yoga", "wellness", "mindfulness"],
      },
      {
        baseName: "Nepal Basketball League",
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
        baseName: "Nepal Music Festival",
        price: 2000,
        totalSlots: 1000,
        tags: ["music", "festival", "live"],
      },
      {
        baseName: "Jazz Night",
        price: 1500,
        totalSlots: 200,
        tags: ["jazz", "music", "nightlife"],
      },
      {
        baseName: "Classical Music Evening",
        price: 800,
        totalSlots: 150,
        tags: ["classical", "music", "culture"],
      },
      {
        baseName: "Rock Concert",
        price: 1800,
        totalSlots: 500,
        tags: ["rock", "band", "live-music"],
      },
      {
        baseName: "Folk Music of Nepal Showcase",
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
        baseName: "Career Development Summit",
        price: 1000,
        totalSlots: 200,
        tags: ["career", "professional", "growth"],
      },
      {
        baseName: "Mental Health Awareness Talk",
        price: 0,
        totalSlots: 100,
        tags: ["health", "wellness", "awareness"],
      },
      {
        baseName: "Financial Planning Workshop",
        price: 1500,
        totalSlots: 80,
        tags: ["finance", "investment", "planning"],
      },
      {
        baseName: "Leadership Excellence Program",
        price: 3000,
        totalSlots: 50,
        tags: ["leadership", "management", "corporate"],
      },
      {
        baseName: "Entrepreneurship 101",
        price: 800,
        totalSlots: 120,
        tags: ["entrepreneur", "business", "startup"],
      },
    ],
  },
];

// ─── helpers ─────────────────────────────────────────────────────────────

// Future date between minDays and maxDays from now (ensures validation passes)
const futureDateBetween = (minDays, maxDays) => {
  const date = new Date();
  const days = Math.floor(minDays + Math.random() * (maxDays - minDays));
  date.setDate(date.getDate() + days);
  return date;
};

// Randomise price ±30% rounded to nearest 50
const priceVariant = (base) =>
  Math.round((base * (0.7 + Math.random() * 0.6)) / 50) * 50;

// Randomise slots ±40% of base
const slotVariant = (base) => Math.round(base * (0.6 + Math.random() * 0.8));

// Generate a more varied event name: base + year/season + location + variation
const generateEventName = (baseName, location) => {
  const year = new Date().getFullYear() + Math.floor(Math.random() * 2); // this year or next
  const seasons = ["Spring", "Summer", "Autumn", "Winter"];
  const season = seasons[Math.floor(Math.random() * seasons.length)];

  // 50% chance to include season, otherwise just year
  const timeModifier = Math.random() > 0.5 ? ` ${season} ${year}` : ` ${year}`;

  // Get a location variation (e.g., "Valley", "City") – default to empty
  const variations = LOCATION_VARIATIONS[location] || [""];
  const variation = variations[Math.floor(Math.random() * variations.length)];
  const locationPart = variation ? `${location} ${variation}` : location;

  return `${baseName}${timeModifier} – ${locationPart}`;
};

// Generate a location‑specific description
const generateDescription = (baseName, location, tags) => {
  const intro = [
    `Join us for ${baseName} in ${location}.`,
    `Experience the best of ${baseName} at ${location}.`,
    `${baseName} is coming to ${location}!`,
  ];
  const middle = [
    "Network with industry leaders and enthusiasts.",
    "Enjoy insightful sessions and hands-on workshops.",
    "Don't miss this opportunity to learn and connect.",
  ];
  const closing = [
    "Limited seats available – register now!",
    "Be part of this exciting event.",
    "Get your tickets today!",
  ];
  return `${intro[Math.floor(Math.random() * intro.length)]} ${
    middle[Math.floor(Math.random() * middle.length)]
  } ${closing[Math.floor(Math.random() * closing.length)]}`;
};

// ─── seeder ───────────────────────────────────────────────────────────────

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
        const eventName = generateEventName(tmpl.baseName, location);

        const exists = await Event.findOne({ event_name: eventName });
        if (exists) {
          skipped++;
          continue;
        }

        // Event date: 7–365 days from now
        const eventDate = futureDateBetween(7, 365);

        // Registration deadline: 3–10 days before event (still future relative to now)
        const regDeadline = new Date(eventDate);
        regDeadline.setDate(
          eventDate.getDate() - Math.floor(3 + Math.random() * 7)
        );

        const totalSlots = slotVariant(tmpl.totalSlots);
        const attendees = Math.floor(totalSlots * (0.3 + Math.random() * 0.5));

        const newEvent = new Event({
          event_name: eventName,
          description: generateDescription(tmpl.baseName, location, tmpl.tags),
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
          status: "upcoming",
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
