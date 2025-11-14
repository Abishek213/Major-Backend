import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import Notification from './model/notification.schema.js';
import User from './model/user.schema.js';
import mongoose from 'mongoose';

class WebSocketManager {
  constructor() {
    this.wss = null;
    this.clients = new Map();
    this.pingIntervals = new Map();
  }

  initialize(server) {
    this.wss = new WebSocketServer({ server });

    this.wss.on('connection', async (ws, req) => {
      const connectionId = uuidv4();
      console.log(`New connection attempt: ${connectionId}`);

      try {
        const client = await this.authenticateConnection(ws, req, connectionId);
        if (!client) return; 

        this.setupClientConnection(ws, client, connectionId);
      } catch (error) {
        console.error(`Connection error for ${connectionId}:`, error);
        ws.close(4002, 'Connection error');
      }
    });

    return this.wss;
  }

  async authenticateConnection(ws, req, connectionId) {
    const url = new URL(req.url, `ws://${req.headers.host}`);
    const token = url.searchParams.get('token');
  
    if (!token) {
      console.error(`No token provided for connection ${connectionId}`);
      ws.close(4001, 'Authentication required');
      return null;
    }
  
    try {
      console.log(`Verifying token for connection ${connectionId}`);
      
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      const userId = decoded.user?.id || decoded.userId || decoded.sub;
      
      if (!userId) {
        console.error(`No user ID in token for connection ${connectionId}`);
        ws.close(4004, 'User ID missing from token');
        return null;
      }

      if (!mongoose.Types.ObjectId.isValid(userId)) {
        console.error(`Invalid ObjectId format for connection ${connectionId}: ${userId}`);
        ws.close(4004, 'Invalid user ID format');
        return null;
      }

      const userObjectId = new mongoose.Types.ObjectId(userId);

      console.log(`Finding user for ID: ${userObjectId}`);
      const user = await User.findById(userObjectId)
        .populate({
          path: 'role',
          select: '_id role_Name'
        })
        .select('_id role')
        .lean();
      
      if (!user) {
        console.error(`User not found for ID: ${userObjectId} (connection ${connectionId})`);
        ws.close(4005, 'User not found');
        return null;
      }

      if (!user.role) {
        console.error(`Role not found for user: ${userObjectId} (connection ${connectionId})`);
        ws.close(4005, 'User role not found');
        return null;
      }

      console.log(`Authentication successful for user ${userObjectId} (connection ${connectionId})`);
      
      return {
        userId: user._id.toString(),
        roleId: user.role._id.toString(),
        roleName: user.role.role_Name
      };

    } catch (error) {
      console.error(`Authentication error for connection ${connectionId}:`, error);
      
      if (error.name === 'TokenExpiredError') {
        ws.close(4003, 'Token expired');
      } else if (error.name === 'JsonWebTokenError') {
        ws.close(4004, 'Invalid token');
      } else {
        ws.close(4002, 'Authentication failed');
      }
      
      return null;
    }
  }


  setupClientConnection(ws, client, connectionId) {
    this.clients.set(ws, { ...client, ws });
    console.log(`WebSocket connected - ConnectionID: ${connectionId}, UserID: ${client.userId}, Role: ${client.roleName}`);

    const pingInterval = setInterval(() => {
      if (ws.readyState !== ws.OPEN) {
        this.cleanupClient(ws, connectionId);
        return;
      }

      let pongReceived = false;
      ws.ping(() => { pongReceived = true; });

      setTimeout(() => {
        if (!pongReceived && ws.readyState === ws.OPEN) {
          console.log(`No pong received for ${connectionId}, closing connection`);
          this.cleanupClient(ws, connectionId);
        }
      }, 5000); 
    }, 30000);

    this.pingIntervals.set(ws, pingInterval);

    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message);
        await this.handleMessage(ws, data);
      } catch (error) {
        this.sendToClient(ws, {
          type: 'error',
          message: 'Invalid message format'
        });
      }
    });

    ws.on('close', () => this.cleanupClient(ws, connectionId));
    ws.on('error', () => this.cleanupClient(ws, connectionId));
    ws.on('pong', () => {
      console.log(`Client responded to ping - ConnectionID: ${connectionId}`);
    });
  }

  cleanupClient(ws, connectionId) {
    const interval = this.pingIntervals.get(ws);
    if (interval) {
      clearInterval(interval);
      this.pingIntervals.delete(ws);
    }
    this.clients.delete(ws);
    console.log(`Connection closed: ${connectionId}`);
  }

  async handleMessage(ws, message) {
    const client = this.clients.get(ws);
    if (!client) {
      this.sendToClient(ws, {
        type: 'error',
        message: 'Client not authenticated'
      });
      return;
    }

    try {
      switch (message.type) {
        case 'markAsRead':
          await this.handleReadNotification(client, message.payload.notificationId);
          break;
        case 'markAllAsRead':
          await this.handleReadAllNotifications(client);
          break;
        case 'deleteNotification':
          await this.handleDeleteNotification(client, message.payload.notificationId);
          break;
        case 'subscribeAdminNotifications':
          if (client.roleName === 'Admin') {
            await this.handleAdminNotificationSubscription(client);
          }
          break;
        case 'subscribeUnreadCount':
          await this.handleUnreadCountSubscription(client);
          break;
        case 'notification':
          await this.handleNotification(client, message);
          break;
        case 'ping':
          this.sendToClient(ws, { type: 'pong' });
          break;
        default:
          console.log('Unknown message type:', message.type);
          this.sendToClient(ws, {
            type: 'error',
            message: 'Unknown message type'
          });
      }
    } catch (error) {
      console.error('Error handling message:', error);
      this.sendToClient(ws, {
        type: 'error',
        message: 'Internal server error'
      });
    }
  }

  async handleReadNotification(client, notificationId) {
    try {
      const notification = await Notification.findOneAndUpdate(
        {
          _id: notificationId,
          $or: [
            { userId: client.userId },
            { forRole: client.roleId }
          ]
        },
        { status: 'read' },
        { new: true }
      );
  
      if (notification) {
        this.broadcastToUser(client.userId, {
          type: 'notificationRead',
          payload: { notificationId }
        });
      }
    } catch (error) {
      console.error('Error handling read notification:', error);
      throw error;
    }
  }

  async handleReadAllNotifications(client) {
    try {
      const result = await Notification.updateMany(
        {
          $or: [
            { userId: client.userId },
            { forRole: client.roleId }
          ],
          status: 'unread'
        },
        { status: 'read' }
      );
  
      this.broadcastToUser(client.userId, {
        type: 'allNotificationsRead',
        payload: { 
          modifiedCount: result.modifiedCount 
        }
      });
    } catch (error) {
      console.error('Error handling read all notifications:', error);
      throw error;
    }
  }

  async handleDeleteNotification(client, notificationId) {
    try {
      const notification = await Notification.findOneAndDelete({
        _id: notificationId,
        $or: [
          { userId: client.userId },
          { forRole: client.roleId }
        ]
      });
  
      if (notification) {
        this.broadcastToUser(client.userId, {
          type: 'notificationDeleted',
          payload: { 
            notificationId 
          }
        });
      }
    } catch (error) {
      console.error('Error deleting notification:', error);
      this.sendToClient(ws, {
        type: 'error',
        message: 'Error deleting notification'
      });
    }
  }

  async handleAdminNotificationSubscription(client) {
    try {
      const notifications = await Notification.find({
        forRole: client.roleId,
        type: 'event_request'
      })
        .sort({ createdAt: -1 })
        .lean();

      this.broadcastToUser(client.userId, {
        type: 'adminNotificationsUpdate',
        notifications
      });
    } catch (error) {
      console.error('Error handling admin notification subscription:', error);
      throw error;
    }
  }

  async handleUnreadCountSubscription(client) {
    try {
      const count = await Notification.countDocuments({
        $or: [
          { userId: client.userId },
          { forRole: client.roleId }
        ],
        status: 'unread'
      });

      this.broadcastToUser(client.userId, {
        type: 'unreadCountUpdate',
        count
      });
    } catch (error) {
      console.error('Error handling unread count subscription:', error);
      throw error;
    }
  }

  async handleNotification(client, message) {
    try {
      const { action, payload } = message;
      
      if (!payload || !payload.notification) {
        throw new Error('Invalid notification payload');
      }
  
      const notificationData = {
        type: 'notification',
        action,
        payload: {
          ...payload,
          timestamp: new Date().toISOString(),
          correlationId: uuidv4()
        }
      };

      switch (action) {
        case 'event_request':
          if (payload.notification.forRole === 'Admin') {
            await this.broadcastToRole('Admin', notificationData);
          }
          break;

        case 'event_response':
          if (payload.notification.userId) {
            await this.broadcastToUser(payload.notification.userId, notificationData);
          }
          break;

        case 'new_event_request':
          if (payload.notification.forRole) {
            await this.broadcastToRole(payload.notification.forRole, notificationData);
          }
          break;

        case 'event_request_update':
          if (payload.notification.userId) {
            await this.broadcastToUser(payload.notification.userId, notificationData);
          }
          break;

        case 'event_request_accepted':
        if (payload.notification.userId) {
          await this.broadcastToUser(payload.notification.userId, notificationData);
        }
        break;

        default:
          this.broadcastToUser(client.userId, {
            type: 'notification',
            action: action || 'received',
            payload
          });
      }
    } catch (error) {
      console.error('Error handling notification:', error);
      throw error;
    }
  }

  sendToClient(ws, data) {
    if (ws.readyState === ws.OPEN) {
      try {
        ws.send(JSON.stringify(data));
      } catch (error) {
        console.error('Failed to send message to client:', error);
      }
    }
  }

  broadcastToUser(userId, data) {
    const disconnectedClients = [];
    const standardizedData = this.createStandardizedMessage(data);

    this.clients.forEach((client, ws) => {
      if (client.userId === userId.toString()) {
        if (ws.readyState === ws.OPEN) {
          this.sendToClient(ws, standardizedData);
        } else {
          disconnectedClients.push(ws);
        }
      }
    });
    disconnectedClients.forEach(ws => this.cleanupClient(ws));
  }

  broadcastToRole(roleIdentifier, data) {
    const disconnectedClients = [];
    const standardizedData = this.createStandardizedMessage(data);

    this.clients.forEach((client, ws) => {
      const matchesRole = typeof roleIdentifier === 'string' 
        ? client.roleName === roleIdentifier
        : client.roleId === roleIdentifier.toString();

      if (matchesRole) {
        if (ws.readyState === ws.OPEN) {
          this.sendToClient(ws, standardizedData);
        } else {
          disconnectedClients.push(ws);
        }
      }
    });
    disconnectedClients.forEach(ws => this.cleanupClient(ws));
  }

  createStandardizedMessage(data) {
    return {
      type: data.type,
      action: data.action || null,
      payload: {
        ...data.payload,
        timestamp: new Date().toISOString(),
        correlationId: uuidv4()
      }
    };
  }

  async shutdown() {
    if (this.wss) {
      console.log('Initiating WebSocket server shutdown...');
      
      // Close all client connections first
      const closePromises = Array.from(this.clients.keys()).map(ws => {
        return new Promise(resolve => {
          ws.close(1001, 'Server shutting down');
          this.cleanupClient(ws);
          resolve();
        });
      });

      await Promise.all(closePromises);

      // Close the WebSocket server
      await new Promise(resolve => this.wss.close(resolve));
      console.log('WebSocket server shutdown complete');
    }
  }
}

export const wsManager = new WebSocketManager();