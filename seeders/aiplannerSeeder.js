// import Category from "../model/categories.schema.js";
// import Event from "../model/event.schema.js";
// import User from "../model/user.schema.js";
// import Role from "../model/role.schema.js";
// import AiAgent from "../model/ai_agent.schema.js";
// import bcryptjs from "bcryptjs";

// const seedAIPlanner = async () => {
//   try {
//     console.log("🔍 Checking if AI Planner already seeded...");

//     const existingAgent = await AiAgent.findOne({ name: "planning-agent" });

//     if (existingAgent) {
//       console.log("⚠ AI Planner already seeded. Skipping...");
//       return;
//     }

//     console.log("🚀 Seeding AI Planner Data...");

//     const categories = [
//       "conference",
//       "workshop",
//       "wedding",
//       "birthday",
//       "concert",
//       "festival",
//       "seminar",
//       "training",
//     ];

//     const categoryMap = {};

//     for (const name of categories) {
//       const category = await Category.create({
//         categoryName: name,
//         parentCategory: null,
//         isActive: true,
//       });

//       categoryMap[name] = category._id;
//     }

//     console.log("✅ Categories created");

//     // ======================================================
//     // 2️⃣ ROLE + ORGANIZER
//     // ======================================================
//     let organizerRole = await Role.findOne({ role_Name: "Organizer" });

//     if (!organizerRole) {
//       organizerRole = await Role.create({ role_Name: "Organizer" });
//     }

//     const hashedPassword = await bcryptjs.hash("password123", 10);

//     const organizer = await User.create({
//       fullname: "Test Organizer",
//       email: "organizer@test.com",
//       password: hashedPassword,
//       contactNo: "9841234567",
//       role: organizerRole._id,
//     });

//     console.log("✅ Organizer created");

//     // ======================================================
//     // 3️⃣ EVENTS
//     // ======================================================
//     for (let i = 1; i <= 10; i++) {
//       await Event.create({
//         event_name: `Tech Conference ${i}`,
//         description: "Technology conference about AI & Cloud",
//         event_date: new Date(2024, 8, 10 + i),
//         registrationDeadline: new Date(2024, 8, 5 + i),
//         time: "10:00",
//         location: "Kathmandu",
//         price: 2000 + Math.floor(Math.random() * 1000),
//         category: categoryMap["conference"],
//         tags: ["tech", "conference", "networking"],
//         org_ID: organizer._id,
//         totalSlots: 100 + i * 10,
//         attendees: [],
//         isPublic: true,
//         status: "completed",
//       });
//     }

//     console.log("✅ Events created");

//     // ======================================================
//     // 4️⃣ AI AGENT (MARKER)
//     // ======================================================
//     await AiAgent.create({
//       name: "planning-agent",
//       role: "planner",
//       capabilities: {
//         price_optimization: true,
//         tag_recommendation: true,
//         slot_suggestion: true,
//         datetime_optimization: true,
//         deadline_validation: true,
//       },
//       status: "active",
//       agent_type: "organizer",
//       user_id: null,
//     });

//     console.log("🤖 AI Agent created");
//     console.log("===================================");
//     console.log("✅ AI Planner Seed Completed (ONE TIME)");
//     console.log("===================================");
//   } catch (error) {
//     console.error("❌ Seeder Error:", error.message);
//   }
// };

// export default seedAIPlanner;
