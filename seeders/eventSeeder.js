import Event from "../model/event.schema.js";
import User from "../model/user.schema.js";
import Category from "../model/categories.schema.js";

const futureEvents = [
  {
    event_name: "Summer Music Festival",
    description:
      "A day filled with live music performances from local and international artists",
    event_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    registrationDeadline: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
    time: "12:00 PM",
    location: "Central Park",
    price: 49.99,
    categoryName: "Festival",
    image: "festival.jpg",
    totalSlots: 1000,
    isPublic: true,
    status: "upcoming",
  },
  {
    event_name: "Tech Conference 2024",
    description:
      "Annual technology conference featuring industry leaders and innovative showcases",
    event_date: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000),
    registrationDeadline: new Date(Date.now() + 35 * 24 * 60 * 60 * 1000),
    time: "9:00 AM",
    location: "Convention Center",
    price: 299.99,
    categoryName: "Education",
    image: "tech-conf.jpg",
    totalSlots: 500,
    isPublic: true,
    status: "upcoming",
  },
  {
    event_name: "Yoga Workshop",
    description: "Beginner-friendly yoga workshop with certified instructors",
    event_date: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
    registrationDeadline: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    time: "8:00 AM",
    location: "Wellness Center",
    price: 25.0,
    categoryName: "Indoor Sports",
    image: "yoga.jpg",
    totalSlots: 30,
    isPublic: true,
    status: "upcoming",
  },
  {
    event_name: "Basketball Tournament",
    description: "Local basketball tournament with teams from across the city",
    event_date: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000),
    registrationDeadline: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
    time: "2:00 PM",
    location: "Sports Complex",
    price: 100.0,
    categoryName: "Indoor Sports",
    image: "basketball.jpg",
    totalSlots: 120,
    isPublic: true,
    status: "upcoming",
  },
  {
    event_name: "City Marathon 2024",
    description: "Annual city marathon with 5K, 10K, and full marathon options",
    event_date: new Date(Date.now() + 35 * 24 * 60 * 60 * 1000),
    registrationDeadline: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000),
    time: "6:00 AM",
    location: "City Streets",
    price: 50.0,
    categoryName: "Outdoor Sports",
    image: "marathon.jpg",
    totalSlots: 2000,
    isPublic: true,
    status: "upcoming",
  },
  {
    event_name: "Cooking Masterclass",
    description: "A hands-on cooking session with a renowned celebrity chef",
    event_date: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
    registrationDeadline: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    time: "3:00 PM",
    location: "Culinary Institute",
    price: 75.0,
    categoryName: "Restaurant",
    image: "masterclass.jpg",
    totalSlots: 50,
    isPublic: false,
    status: "pending",
  },
  {
    event_name: "Street Food Festival",
    description: "Experience the best street food vendors from around the city",
    event_date: new Date(Date.now() + 28 * 24 * 60 * 60 * 1000),
    registrationDeadline: new Date(Date.now() + 18 * 24 * 60 * 60 * 1000),
    time: "4:00 PM",
    location: "Downtown Streets",
    price: 15.0,
    categoryName: "Street Food",
    image: "street-food.jpg",
    totalSlots: 1000,
    isPublic: true,
    status: "upcoming",
  },
  {
    event_name: "Classical Night",
    description:
      "An evening of classical music featuring the city symphony orchestra",
    event_date: new Date(Date.now() + 55 * 24 * 60 * 60 * 1000),
    registrationDeadline: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000),
    time: "7:00 PM",
    location: "Concert Hall",
    price: 85.0,
    categoryName: "Concert",
    image: "classical.jpg",
    totalSlots: 400,
    isPublic: true,
    status: "upcoming",
  },
  {
    event_name: "ESports Tournament",
    description:
      "Competitive gaming tournament featuring popular console games",
    event_date: new Date(Date.now() + 42 * 24 * 60 * 60 * 1000),
    registrationDeadline: new Date(Date.now() + 32 * 24 * 60 * 60 * 1000),
    time: "1:00 PM",
    location: "Gaming Arena",
    price: 25.0,
    categoryName: "Console Gaming",
    image: "esports.jpg",
    totalSlots: 128,
    isPublic: true,
    status: "upcoming",
  },
  {
    event_name: "PC Gaming Championship",
    description: "Major PC gaming tournament with multiple game categories",
    event_date: new Date(Date.now() + 38 * 24 * 60 * 60 * 1000),
    registrationDeadline: new Date(Date.now() + 28 * 24 * 60 * 60 * 1000),
    time: "12:00 PM",
    location: "Cyber Arena",
    price: 40.0,
    categoryName: "PC Gaming",
    image: "pc-gaming.jpg",
    totalSlots: 256,
    isPublic: true,
    status: "upcoming",
  },
  {
    event_name: "Art Expo 2025",
    description:
      "An exhibition showcasing contemporary art pieces and sculptures from global artists.",
    event_date: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    registrationDeadline: new Date(Date.now() + 50 * 24 * 60 * 60 * 1000),
    time: "10:00 AM",
    location: "Downtown Art Gallery",
    price: 20.0,
    categoryName: "Festival",
    image: "art-expo.jpg",
    totalSlots: 200,
    isPublic: false,
    status: "pending",
  },
  {
    event_name: "Book Fair 2025",
    description:
      "A gathering of book enthusiasts with author signings, workshops, and discounts.",
    event_date: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    registrationDeadline: new Date(Date.now() + 80 * 24 * 60 * 60 * 1000),
    time: "11:00 AM",
    location: "City Library",
    price: 10.0,
    categoryName: "Education",
    image: "book-fair.jpg",
    totalSlots: 300,
    isPublic: false,
    status: "pending",
  },
];

// Past completed events — used for reviews & AI recommendations
export const pastEvents = [
  {
    event_name: "Indie Music Night",
    description:
      "An intimate evening of indie and alternative music by local bands.",
    event_date: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
    registrationDeadline: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    time: "7:00 PM",
    location: "The Underground Club",
    price: 30.0,
    categoryName: "Concert",
    image: "indie-music.jpg",
    totalSlots: 200,
    isPublic: true,
    status: "completed",
  },
  {
    event_name: "Data Science Bootcamp",
    description:
      "Intensive one-day bootcamp covering ML fundamentals and hands-on projects.",
    event_date: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000),
    registrationDeadline: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000),
    time: "9:00 AM",
    location: "Tech Hub Auditorium",
    price: 199.0,
    categoryName: "Education",
    image: "ds-bootcamp.jpg",
    totalSlots: 100,
    isPublic: true,
    status: "completed",
  },
  {
    event_name: "Trail Running Challenge",
    description:
      "Scenic trail run through the national park with 10K and 21K categories.",
    event_date: new Date(Date.now() - 50 * 24 * 60 * 60 * 1000),
    registrationDeadline: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
    time: "6:30 AM",
    location: "Shivapuri National Park",
    price: 45.0,
    categoryName: "Outdoor Sports",
    image: "trail-run.jpg",
    totalSlots: 500,
    isPublic: true,
    status: "completed",
  },
  {
    event_name: "Street Photography Walk",
    description:
      "Guided photography walk through heritage streets with a professional photographer.",
    event_date: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
    registrationDeadline: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000),
    time: "5:30 AM",
    location: "Asan Bazaar",
    price: 20.0,
    categoryName: "Festival",
    image: "photo-walk.jpg",
    totalSlots: 40,
    isPublic: true,
    status: "completed",
  },
  {
    event_name: "Retro Gaming Expo",
    description:
      "A nostalgia-packed expo featuring classic console games and retro arcade machines.",
    event_date: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
    registrationDeadline: new Date(Date.now() - 70 * 24 * 60 * 60 * 1000),
    time: "11:00 AM",
    location: "City Expo Center",
    price: 35.0,
    categoryName: "Console Gaming",
    image: "retro-gaming.jpg",
    totalSlots: 300,
    isPublic: true,
    status: "completed",
  },
];

const seedEvents = async () => {
  try {
    const organizer = await User.findOne({ email: "organizer@gmail.com" });
    if (!organizer) {
      console.log("⚠  Organizer user not found. Run user seeder first.");
      return;
    }

    // Find regular user to add as attendee
    const regularUser = await User.findOne({ email: "user@gmail.com" });
    if (!regularUser) {
      console.log(
        "⚠  user@gmail.com not found. Run user seeder first, then re-run this seeder."
      );
      return;
    }

    const categories = await Category.find({});
    if (categories.length === 0) {
      console.log("⚠  Categories not found. Run category seeder first.");
      return;
    }

    const attachRefs = (list) =>
      list.map((event) => {
        const categoryDoc = categories.find(
          (c) => c.categoryName === event.categoryName
        );
        if (!categoryDoc)
          throw new Error(`Category not found: ${event.categoryName}`);
        const { categoryName, ...rest } = event;
        return { ...rest, org_ID: organizer._id, category: categoryDoc._id };
      });

    // ---- Future events (insert normally) ----
    const futureRefs = attachRefs(futureEvents);
    for (const ev of futureRefs) {
      const exists = await Event.findOne({ event_name: ev.event_name });
      if (!exists) {
        await Event.create(ev);
      }
    }

    // ---- Past events: ensure each exists and has user@gmail.com as attendee ----
    const pastRefs = attachRefs(pastEvents);
    for (const ev of pastRefs) {
      let event = await Event.findOne({ event_name: ev.event_name });

      if (!event) {
        // Create with user in attendees
        ev.attendees = [regularUser._id];
        await Event.collection.insertOne({
          ...ev,
          _id: new mongoose.Types.ObjectId(),
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        console.log(
          `Created past event: ${ev.event_name} with user as attendee`
        );
      } else {
        // Ensure user is in attendees
        if (
          !event.attendees.some(
            (id) => id.toString() === regularUser._id.toString()
          )
        ) {
          event.attendees.push(regularUser._id);
          await event.save({ validateBeforeSave: false });
          console.log(`Updated ${ev.event_name}: added user to attendees`);
        }
      }
    }

    console.log(
      `✔  Events seeded: future events processed, ${pastEvents.length} past events ensured with user as attendee`
    );
  } catch (error) {
    console.error("✗  Error seeding events:", error.message);
  }
};

export default seedEvents;
