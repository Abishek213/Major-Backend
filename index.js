import dotenv from "dotenv";
import express from "express";
import mongoose from "mongoose";
import http from "http";
import { wsManager } from "./webSocket.js";
import fileUpload from "express-fileupload";
import path from "path";

import seedRoles from "./seeders/roleSeeder.js";
import seedPermissions from "./seeders/permissionSeeder.js";
import seedUsers from "./seeders/userSeeder.js";
import seedEvents from "./seeders/eventSeeder.js";
import seedCategories from "./seeders/categorieSeeder.js";
import seedRolePermissions from "./seeders/rolePermissionSeeder.js";
import seedAIAgents from "./seeders/aiSeeder.js";
import seedOrganizerDashboard from "./seeders/organizerDashboardSeeder.js";
import seedplannerAgents from "./seeders/planningAgentSeeder.js";
// import seedAIPlanner from "./seeders/aiplannerSeeder.js";

import authRoute from "./routes/auth.routes.js";
import eventRoutes from "./routes/Event.routes.js";
import userRoute from "./routes/user.route.js";
import bookingRoutes from "./routes/booking.routes.js";
import roleRoute from "./routes/role.route.js";
import adminRoutes from "./routes/admin.routes.js";
import categoriesRoutes from "./routes/categories.routes.js";
import notificationRoutes from "./routes/notification.routes.js";
import eventRequestRoutes from "./routes/eventrequest.routes.js";
import aiRoutes from "./routes/ai.routes.js";
import negotiationRoutes from "./routes/negotiation.routes.js";
dotenv.config();

const app = express();
const server = http.createServer(app);

// Attach websocket manager
wsManager.initialize(server);

// CORS MIDDLEWARE
const allowedOrigins = [
  "https://eventa-puce.vercel.app",
  "http://localhost:5173",
  "https://e-venta-qv4a.vercel.app",
  "http://52.70.70.109:3000",
];

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  }

  res.header("Access-Control-Allow-Credentials", "true");
  res.header(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,PATCH,DELETE,OPTIONS"
  );
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With, Accept, Origin"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();
});

// Express setup
app.use(express.json());
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// MongoDB Connection
if (!process.env.MongoDB_URI) {
  console.error("ERROR: MongoDB URI missing in .env");
  process.exit(1);
}

const URI = process.env.MongoDB_URI;
const PORT = process.env.PORT || 4001;

const connectDB = async () => {
  try {
    await mongoose.connect(URI);
    console.log("Connected to MongoDB");

    // Seed only in development
    if (process.env.NODE_ENV !== "production") {
      console.log("Database seeding started...");

      await seedRoles();
      await seedPermissions();
      await seedUsers();
      await seedCategories();
      await seedEvents();
      await seedRolePermissions();
      await seedAIAgents();
      await seedOrganizerDashboard();
      await seedplannerAgents();
      // await seedAIPlanner();

      console.log("Database seeding completed.");
    } else {
      console.log("Skipping seeding in production");
    }
  } catch (error) {
    console.error("MongoDB connection error:", error.message);
    process.exit(1);
  }
};

connectDB();

// File Upload
app.use(
  fileUpload({
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
    createParentPath: true,
    abortOnLimit: true,
    responseOnLimit: "File size too large",
  })
);

// API Routes
app.use("/api/v1/auth", authRoute);
app.use("/api/v1/events", eventRoutes);
app.use("/api/v1/users", userRoute);
app.use("/api/v1/bookings", bookingRoutes);
app.use("/api/v1/roles", roleRoute);
app.use("/api/v1/categories", categoriesRoutes);
app.use("/api/v1/notifications", notificationRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/eventrequest", eventRequestRoutes);
app.use("/api/v1/ai", aiRoutes);
app.use("/api/negotiation", negotiationRoutes);

// Global Error Handler
app.use((err, req, res, next) => {
  console.error("Error:", err);

  if (err.message.includes("CORS")) {
    return res.status(500).json({
      success: false,
      message: "CORS error occurred",
    });
  }

  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal server error",
  });
});

// Health Check
app.get("/", (req, res) => {
  res.send("API is running...");
});

// Graceful Shutdown
async function gracefulShutdown(signal) {
  console.log(`\nReceived ${signal}. Shutting down gracefully...`);

  try {
    if (wsManager) {
      console.log("Closing WebSocket connections...");
      await wsManager.shutdown();
    }

    await new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    await mongoose.connection.close();
    console.log("MongoDB connection closed.");

    console.log("Shutdown completed.");
    process.exit(0);
  } catch (error) {
    console.error("Shutdown error:", error);
    process.exit(1);
  }
}

["SIGTERM", "SIGINT", "SIGUSR2"].forEach((signal) => {
  process.on(signal, () => gracefulShutdown(signal));
});

// Start Server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});