import dotenv from 'dotenv';
import express from 'express';
import mongoose from 'mongoose';
import http from 'http';
import { wsManager } from './webSocket.js';
import cors from 'cors';
import fileUpload from 'express-fileupload';
import path from 'path';
import crypto from 'crypto';

import seedRoles from './seeders/roleSeeder.js';
import seedPermissions from './seeders/PermissionSeeder.js';
import seedUsers from './seeders/userSeeder.js';
import seedEvents from './seeders/eventSeeder.js';
import seedCategories from './seeders/categorieSeeder.js';
import seedRolePermissions from './seeders/rolePermissionSeeder.js';

import eventRoutes from './routes/Event.routes.js';
import userRoute from './routes/user.route.js';
import bookingRoutes from './routes/booking.routes.js';
import roleRoute from './routes/role.route.js';
import adminRoutes from './routes/admin.routes.js';
import categoriesRoutes from './routes/categories.routes.js';
import notificationRoutes from './routes/notification.routes.js';
import eventRequestRoutes from './routes/eventrequest.routes.js';


dotenv.config();
const app = express();
const server = http.createServer(app);
wsManager.initialize(server);

const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'Accept', 'X-Requested-With'],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204,
  maxAge: 3600
};

// Validate environment variables
if (!process.env.MongoDB_URI) {
  console.error("ERROR: MongoDB URI is not defined. Please check your .env file.");
  process.exit(1);
}

const PORT = process.env.PORT || 5000;
const URI = process.env.MongoDB_URI;

app.use(express.json());
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(URI);
    console.log("Connected to MongoDB");
    console.log("Starting database seeding...");
    console.log("1. Seeding roles...");
    await seedRoles();
    console.log("2. Seeding permissions...");
    await seedPermissions();
    console.log("3. Seeding users...");
    await seedUsers();
    console.log("4. Seeding Categories ...");
    await seedCategories();
    console.log("5. Seeding events...");
    await seedEvents();
    console.log("6. Seeding role permissions...");
    await seedRolePermissions();
  } catch (error) {
    console.error("Error connecting to MongoDB:", error.message);
    process.exit(1);
  }
};

// Updated graceful shutdown handler
async function gracefulShutdown(signal) {
  console.log(`\nReceived ${signal}. Shutting down gracefully...`);
  
  try {
    // Close WebSocket connections if any
    if (wsManager) {
      console.log('Closing WebSocket connections...');
      await wsManager.shutdown();
    }

    // Close HTTP server
    await new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
        } else {
          console.log('HTTP server closed.');
          resolve();
        }
      });
    });

    // Close MongoDB connection
    await mongoose.connection.close();
    console.log('MongoDB connection closed.');

    // Exit process
    console.log('Shutdown completed.');
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
}

// Register shutdown handlers
['SIGTERM', 'SIGINT', 'SIGUSR2'].forEach(signal => {
  process.on(signal, () => gracefulShutdown(signal));
});

// Handle nodemon restarts
process.once('SIGUSR2', async () => {
  await gracefulShutdown('SIGUSR2');
  process.kill(process.pid, 'SIGUSR2');
});

// Handle uncaught exceptions
process.on('uncaughtException', async (error) => {
  console.error('Uncaught Exception:', error);
  await gracefulShutdown('uncaughtException');
});

// Handle unhandled rejections
process.on('unhandledRejection', async (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  await gracefulShutdown('unhandledRejection');
});

// Initialize database connection
connectDB();

app.use(fileUpload({
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  createParentPath: true,
  abortOnLimit: true,
  responseOnLimit: 'File size too large'
}));

// API routes
app.use('/api/v1/events', eventRoutes);
app.use('/api/v1/users', userRoute);
app.use('/api/v1/bookings', bookingRoutes);
app.use('/api/v1/roles', roleRoute);
app.use("/api/v1/categories", categoriesRoutes);
app.use("/api/v1/notifications", notificationRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/eventrequest', eventRequestRoutes);

// Global error handler with improved CORS error handling
app.use((err, req, res, next) => {
  console.error('Error:', err);
  
  if (err.message.includes('CORS')) {
    return res.status(500).json({
      success: false,
      message: 'CORS error occurred',
      error: process.env.NODE_ENV === 'development' ? err.message : 'Access denied'
    });
  }
  
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// Health check
app.get('/', (req, res) => {
  res.send('API is running...');
});

// Start the server using the HTTP server instance
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});