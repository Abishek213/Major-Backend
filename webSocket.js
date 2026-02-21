import { WebSocketServer } from "ws";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import Notification from "./model/notification.schema.js";
import User from "./model/user.schema.js";
import mongoose from "mongoose";

// ─── Logger ───────────────────────────────────────────────────────────────────
// Colour codes only apply when running in a terminal (TTY).
const IS_TTY = process.stdout.isTTY;
const c = {
  reset: IS_TTY ? "\x1b[0m" : "",
  bold: IS_TTY ? "\x1b[1m" : "",
  dim: IS_TTY ? "\x1b[2m" : "",
  green: IS_TTY ? "\x1b[32m" : "",
  yellow: IS_TTY ? "\x1b[33m" : "",
  red: IS_TTY ? "\x1b[31m" : "",
  cyan: IS_TTY ? "\x1b[36m" : "",
  blue: IS_TTY ? "\x1b[34m" : "",
  magenta: IS_TTY ? "\x1b[35m" : "",
};

const timestamp = () => new Date().toISOString();

const log = {
  info: (tag, msg, meta = "") =>
    console.log(
      `${c.dim}${timestamp()}${c.reset} ${c.cyan}${c.bold}[WS]${c.reset} ${
        c.bold
      }${tag.padEnd(18)}${c.reset} ${msg} ${c.dim}${meta}${c.reset}`
    ),
  success: (tag, msg, meta = "") =>
    console.log(
      `${c.dim}${timestamp()}${c.reset} ${c.green}${c.bold}[WS]${c.reset} ${
        c.bold
      }${tag.padEnd(18)}${c.reset} ${msg} ${c.dim}${meta}${c.reset}`
    ),
  warn: (tag, msg, meta = "") =>
    console.warn(
      `${c.dim}${timestamp()}${c.reset} ${c.yellow}${c.bold}[WS]${c.reset} ${
        c.bold
      }${tag.padEnd(18)}${c.reset} ${msg} ${c.dim}${meta}${c.reset}`
    ),
  error: (tag, msg, meta = "") =>
    console.error(
      `${c.dim}${timestamp()}${c.reset} ${c.red}${c.bold}[WS]${c.reset} ${
        c.bold
      }${tag.padEnd(18)}${c.reset} ${msg} ${c.dim}${meta}${c.reset}`
    ),
  divider: (label = "") =>
    console.log(
      `${c.dim}────────────────────────────── ${label} ──────────────────────────────${c.reset}`
    ),
};

// ─── Close code descriptions ──────────────────────────────────────────────────
const CLOSE_REASONS = {
  1000: "Normal closure",
  1001: "Server going away",
  1005: "No status received",
  1006: "Abnormal closure (no close frame)",
  1011: "Internal server error",
  4001: "Auth required (no token)",
  4002: "Connection / auth error",
  4003: "Token expired",
  4004: "Invalid token / bad user ID",
  4005: "User or role not found",
};

const closeReason = (code) => CLOSE_REASONS[code] || `Unknown (${code})`;

// ─── WebSocketManager ─────────────────────────────────────────────────────────
class WebSocketManager {
  constructor() {
    this.wss = null;
    this.clients = new Map(); // ws → { userId, roleId, roleName, connectionId, connectedAt }
    this.pingIntervals = new Map(); // ws → intervalId
    this.statusInterval = null;
  }

  // ── Initialize ──────────────────────────────────────────────────────────────
  initialize(server) {
    this.wss = new WebSocketServer({ server });

    log.divider("WebSocket Server Starting");
    log.success(
      "INIT",
      "WebSocket server is ready and listening for connections"
    );

    // Periodic status summary every 60 s
    this.statusInterval = setInterval(() => this._logStatusSummary(), 60_000);

    this.wss.on("connection", async (ws, req) => {
      const connectionId = uuidv4().slice(0, 8); // short ID for readability
      const ip =
        req.headers["x-forwarded-for"] ||
        req.socket?.remoteAddress ||
        "unknown";

      log.divider("Incoming Connection");
      log.info(
        "CONNECT↑",
        `New connection attempt`,
        `id=${connectionId}  ip=${ip}`
      );

      try {
        const client = await this.authenticateConnection(ws, req, connectionId);
        if (!client) return;
        this.setupClientConnection(ws, client, connectionId);
      } catch (error) {
        log.error(
          "CONNECT↑",
          `Unhandled connection error`,
          `id=${connectionId}  err=${error.message}`
        );
        ws.close(4002, "Connection error");
      }
    });

    return this.wss;
  }

  // ── Authentication ──────────────────────────────────────────────────────────
  async authenticateConnection(ws, req, connectionId) {
    const url = new URL(req.url, `ws://${req.headers.host}`);
    const token = url.searchParams.get("token");

    if (!token) {
      log.warn("AUTH✗", `No token provided — closing`, `id=${connectionId}`);
      ws.close(4001, "Authentication required");
      return null;
    }

    log.info("AUTH…", `Verifying JWT`, `id=${connectionId}`);

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const userId =
        decoded.user?.id || decoded.userId || decoded.sub || decoded.id;

      if (!userId) {
        log.warn(
          "AUTH✗",
          `Token valid but contains no user ID`,
          `id=${connectionId}`
        );
        ws.close(4004, "User ID missing from token");
        return null;
      }

      if (!mongoose.Types.ObjectId.isValid(userId)) {
        log.warn(
          "AUTH✗",
          `Invalid ObjectId format`,
          `id=${connectionId}  userId=${userId}`
        );
        ws.close(4004, "Invalid user ID format");
        return null;
      }

      log.info(
        "AUTH…",
        `Looking up user in DB`,
        `id=${connectionId}  userId=${userId}`
      );

      const user = await User.findById(userId)
        .populate({ path: "role", select: "_id role_Name" })
        .select("_id role")
        .lean();

      if (!user) {
        log.warn(
          "AUTH✗",
          `User not found in DB`,
          `id=${connectionId}  userId=${userId}`
        );
        ws.close(4005, "User not found");
        return null;
      }

      if (!user.role) {
        log.warn(
          "AUTH✗",
          `User has no role assigned`,
          `id=${connectionId}  userId=${userId}`
        );
        ws.close(4005, "User role not found");
        return null;
      }

      log.success(
        "AUTH✓",
        `${c.green}Authentication successful${c.reset}`,
        `id=${connectionId}  userId=${userId}  role=${user.role.role_Name}`
      );

      return {
        userId: user._id.toString(),
        roleId: user.role._id.toString(),
        roleName: user.role.role_Name,
        connectionId,
        connectedAt: new Date(),
      };
    } catch (error) {
      if (error.name === "TokenExpiredError") {
        log.warn("AUTH✗", `Token expired`, `id=${connectionId}`);
        ws.close(4003, "Token expired");
      } else if (error.name === "JsonWebTokenError") {
        log.warn(
          "AUTH✗",
          `Invalid token`,
          `id=${connectionId}  err=${error.message}`
        );
        ws.close(4004, "Invalid token");
      } else {
        log.error(
          "AUTH✗",
          `Unexpected auth error`,
          `id=${connectionId}  err=${error.message}`
        );
        ws.close(4002, "Authentication failed");
      }
      return null;
    }
  }

  // ── Client lifecycle ─────────────────────────────────────────────────────────
  setupClientConnection(ws, client, connectionId) {
    let isAlive = true;

    ws.on("pong", () => {
      isAlive = true;
      log.info(
        "PING/PONG",
        `Pong received ✓`,
        `id=${connectionId}  userId=${client.userId}`
      );
    });

    this.clients.set(ws, { ...client, ws });

    const totalNow = this.clients.size;
    log.divider("Client Connected");
    log.success(
      "CONNECTED✓",
      `${c.green}${c.bold}Client is now ONLINE${c.reset}`,
      `id=${connectionId}  userId=${client.userId}  role=${client.roleName}`
    );
    log.info("CLIENTS", `Active connections: ${c.bold}${totalNow}${c.reset}`);
    this._logActiveClients();

    // Ping every 30 s — drop unresponsive clients
    const pingInterval = setInterval(() => {
      if (ws.readyState !== ws.OPEN) {
        log.warn(
          "PING",
          `Socket no longer OPEN — cleaning up`,
          `id=${connectionId}`
        );
        this.cleanupClient(ws, connectionId);
        return;
      }
      if (!isAlive) {
        log.warn(
          "PING",
          `No pong received — dropping unresponsive client`,
          `id=${connectionId}  userId=${client.userId}`
        );
        this.cleanupClient(ws, connectionId);
        return;
      }
      isAlive = false;
      log.info(
        "PING",
        `Sending ping`,
        `id=${connectionId}  userId=${client.userId}`
      );
      ws.ping();
    }, 30_000);

    this.pingIntervals.set(ws, pingInterval);

    ws.on("message", async (message) => {
      try {
        const data = JSON.parse(message);
        log.info(
          "MSG↓",
          `Received message type: ${c.bold}${data.type}${c.reset}`,
          `id=${connectionId}  userId=${client.userId}`
        );
        await this.handleMessage(ws, data);
      } catch (error) {
        log.error(
          "MSG↓",
          `Failed to parse message`,
          `id=${connectionId}  err=${error.message}`
        );
        this.sendToClient(ws, {
          type: "error",
          message: "Invalid message format",
        });
      }
    });

    ws.on("close", (code, reason) => {
      const reasonStr = reason?.toString() || closeReason(code);
      log.divider("Client Disconnected");
      log.warn(
        "DISCONNECTED✗",
        `${c.yellow}${c.bold}Client went OFFLINE${c.reset}`,
        `id=${connectionId}  userId=${client.userId}  code=${code}  reason="${reasonStr}"`
      );
      this.cleanupClient(ws, connectionId);
      log.info(
        "CLIENTS",
        `Active connections: ${c.bold}${this.clients.size}${c.reset}`
      );
      this._logActiveClients();
    });

    ws.on("error", (err) => {
      log.error(
        "SOCKET ERR",
        `Socket error`,
        `id=${connectionId}  userId=${client.userId}  err=${err.message}`
      );
      this.cleanupClient(ws, connectionId);
    });
  }

  cleanupClient(ws, connectionId) {
    const interval = this.pingIntervals.get(ws);
    if (interval) {
      clearInterval(interval);
      this.pingIntervals.delete(ws);
    }
    this.clients.delete(ws);
    log.info("CLEANUP", `Client resources released`, `id=${connectionId}`);
  }

  // ── Message handling ─────────────────────────────────────────────────────────
  async handleMessage(ws, message) {
    const client = this.clients.get(ws);
    if (!client) {
      this.sendToClient(ws, {
        type: "error",
        message: "Client not authenticated",
      });
      return;
    }

    try {
      switch (message.type) {
        case "markAsRead":
          log.info(
            "ACTION",
            `Mark notification as read`,
            `userId=${client.userId}  notifId=${message.payload?.notificationId}`
          );
          await this.handleReadNotification(
            client,
            message.payload.notificationId
          );
          break;

        case "markAllAsRead":
          log.info(
            "ACTION",
            `Mark all notifications as read`,
            `userId=${client.userId}`
          );
          await this.handleReadAllNotifications(client);
          break;

        case "deleteNotification":
          log.info(
            "ACTION",
            `Delete notification`,
            `userId=${client.userId}  notifId=${message.payload?.notificationId}`
          );
          await this.handleDeleteNotification(
            ws,
            client,
            message.payload.notificationId
          );
          break;

        case "subscribeAdminNotifications":
          if (client.roleName === "Admin") {
            log.info(
              "SUB",
              `Admin notification subscription`,
              `userId=${client.userId}`
            );
            await this.handleAdminNotificationSubscription(client);
          } else {
            log.warn(
              "SUB",
              `Non-admin tried to subscribe to admin notifications`,
              `userId=${client.userId}  role=${client.roleName}`
            );
          }
          break;

        case "subscribeUnreadCount":
          log.info(
            "SUB",
            `Unread count subscription`,
            `userId=${client.userId}`
          );
          await this.handleUnreadCountSubscription(client);
          break;

        case "subscribe":
          log.info(
            "SUB",
            `Subscribe to channel: ${c.bold}${message.channel}${c.reset}`,
            `userId=${client.userId}`
          );
          await this.handleSubscribe(client, message.channel);
          break;

        case "unsubscribe":
          log.info(
            "UNSUB",
            `Unsubscribe from channel: ${message.channel}`,
            `userId=${client.userId}`
          );
          break;

        case "ping":
          log.info(
            "PING",
            `App-level ping from client`,
            `userId=${client.userId}`
          );
          this.sendToClient(ws, { type: "pong" });
          break;

        default:
          log.warn(
            "MSG↓",
            `Unknown message type: ${message.type}`,
            `userId=${client.userId}`
          );
          this.sendToClient(ws, {
            type: "error",
            message: "Unknown message type",
          });
      }
    } catch (error) {
      log.error(
        "MSG↓",
        `Error handling message type: ${message.type}`,
        `userId=${client.userId}  err=${error.message}`
      );
      this.sendToClient(ws, {
        type: "error",
        message: "Internal server error",
      });
    }
  }

  // ── Subscription handlers ────────────────────────────────────────────────────
  async handleSubscribe(client, channel) {
    switch (channel) {
      case "notifications":
        await this.handleUnreadCountSubscription(client);
        if (client.roleName === "Admin") {
          await this.handleAdminNotificationSubscription(client);
        }
        break;
      case "unread_count":
        await this.handleUnreadCountSubscription(client);
        break;
      default:
        log.warn(
          "SUB",
          `Unknown channel requested: ${channel}`,
          `userId=${client.userId}`
        );
    }
  }

  async handleReadNotification(client, notificationId) {
    const notification = await Notification.findOneAndUpdate(
      {
        _id: notificationId,
        $or: [{ userId: client.userId }, { forRole: client.roleId }],
      },
      { status: "read" },
      { new: true }
    );
    if (notification) {
      log.success(
        "NOTIF",
        `Notification marked as read`,
        `userId=${client.userId}  notifId=${notificationId}`
      );
      this.broadcastToUser(client.userId, {
        type: "notificationRead",
        payload: { notificationId },
      });
    } else {
      log.warn(
        "NOTIF",
        `Notification not found or not owned by user`,
        `userId=${client.userId}  notifId=${notificationId}`
      );
    }
  }

  async handleReadAllNotifications(client) {
    const result = await Notification.updateMany(
      {
        $or: [{ userId: client.userId }, { forRole: client.roleId }],
        status: "unread",
      },
      { status: "read" }
    );
    log.success(
      "NOTIF",
      `All notifications marked as read`,
      `userId=${client.userId}  modified=${result.modifiedCount}`
    );
    this.broadcastToUser(client.userId, {
      type: "allNotificationsRead",
      payload: { modifiedCount: result.modifiedCount },
    });
  }

  async handleDeleteNotification(ws, client, notificationId) {
    const notification = await Notification.findOneAndDelete({
      _id: notificationId,
      $or: [{ userId: client.userId }, { forRole: client.roleId }],
    });
    if (notification) {
      log.success(
        "NOTIF",
        `Notification deleted`,
        `userId=${client.userId}  notifId=${notificationId}`
      );
      this.broadcastToUser(client.userId, {
        type: "notificationDeleted",
        payload: { notificationId },
      });
    } else {
      log.warn(
        "NOTIF",
        `Notification not found for deletion`,
        `userId=${client.userId}  notifId=${notificationId}`
      );
      this.sendToClient(ws, {
        type: "error",
        message: "Error deleting notification",
      });
    }
  }

  async handleAdminNotificationSubscription(client) {
    const notifications = await Notification.find({
      forRole: client.roleId,
      type: "event_request",
    })
      .sort({ createdAt: -1 })
      .lean();
    log.success(
      "NOTIF",
      `Sent ${notifications.length} admin notifications`,
      `userId=${client.userId}`
    );
    this.broadcastToUser(client.userId, {
      type: "adminNotificationsUpdate",
      payload: { notifications },
    });
  }

  async handleUnreadCountSubscription(client) {
    const count = await Notification.countDocuments({
      $or: [{ userId: client.userId }, { forRole: client.roleId }],
      status: "unread",
    });
    log.success(
      "NOTIF",
      `Unread count: ${c.bold}${count}${c.reset}`,
      `userId=${client.userId}`
    );
    this.broadcastToUser(client.userId, {
      type: "unreadCountUpdate",
      payload: { count },
    });
  }

  // ── Send helpers ─────────────────────────────────────────────────────────────
  sendToClient(ws, data) {
    if (ws.readyState === ws.OPEN) {
      try {
        ws.send(JSON.stringify(data));
      } catch (error) {
        log.error(
          "SEND",
          `Failed to send message to client`,
          `type=${data.type}  err=${error.message}`
        );
      }
    }
  }

  broadcastToUser(userId, data) {
    const disconnectedClients = [];
    const standardizedData = this.createStandardizedMessage(data);
    let sent = 0;

    this.clients.forEach((client, ws) => {
      if (client.userId === userId.toString()) {
        if (ws.readyState === ws.OPEN) {
          this.sendToClient(ws, standardizedData);
          sent++;
        } else {
          disconnectedClients.push(ws);
        }
      }
    });

    if (sent > 0) {
      log.info(
        "BROADCAST",
        `Sent '${data.type}' to user`,
        `userId=${userId}  sockets=${sent}`
      );
    }
    disconnectedClients.forEach((ws) => this.cleanupClient(ws));
  }

  broadcastToRole(roleIdentifier, data) {
    const disconnectedClients = [];
    const standardizedData = this.createStandardizedMessage(data);
    let sent = 0;

    this.clients.forEach((client, ws) => {
      const matchesRole =
        typeof roleIdentifier === "string"
          ? client.roleName === roleIdentifier
          : client.roleId === roleIdentifier.toString();

      if (matchesRole) {
        if (ws.readyState === ws.OPEN) {
          this.sendToClient(ws, standardizedData);
          sent++;
        } else {
          disconnectedClients.push(ws);
        }
      }
    });

    log.info(
      "BROADCAST",
      `Sent '${data.type}' to role '${roleIdentifier}'`,
      `sockets=${sent}`
    );
    disconnectedClients.forEach((ws) => this.cleanupClient(ws));
  }

  createStandardizedMessage(data) {
    return {
      type: data.type,
      action: data.action || null,
      payload: {
        ...(data.payload || {}),
        timestamp: new Date().toISOString(),
        correlationId: uuidv4(),
      },
    };
  }

  // ── Status summary ───────────────────────────────────────────────────────────
  _logActiveClients() {
    if (this.clients.size === 0) {
      log.info("CLIENTS", `No active connections`);
      return;
    }
    const rows = [];
    this.clients.forEach((client) => {
      const uptime = Math.round(
        (Date.now() - new Date(client.connectedAt)) / 1000
      );
      rows.push(
        `  • userId=${client.userId}  role=${client.roleName}  id=${client.connectionId}  uptime=${uptime}s`
      );
    });
    console.log(rows.join("\n"));
  }

  _logStatusSummary() {
    log.divider("Status Summary");
    log.info(
      "STATUS",
      `Total active connections: ${c.bold}${this.clients.size}${c.reset}`
    );
    this._logActiveClients();

    // Role breakdown
    const roleCounts = {};
    this.clients.forEach(({ roleName }) => {
      roleCounts[roleName] = (roleCounts[roleName] || 0) + 1;
    });
    if (Object.keys(roleCounts).length > 0) {
      const breakdown = Object.entries(roleCounts)
        .map(([role, count]) => `${role}=${count}`)
        .join("  ");
      log.info("STATUS", `By role: ${breakdown}`);
    }
  }

  // ── Shutdown ─────────────────────────────────────────────────────────────────
  async shutdown() {
    if (!this.wss) return;

    log.divider("Shutdown");
    log.warn(
      "SHUTDOWN",
      `Initiating graceful WebSocket shutdown...`,
      `clients=${this.clients.size}`
    );

    if (this.statusInterval) {
      clearInterval(this.statusInterval);
      this.statusInterval = null;
    }

    const closePromises = Array.from(this.clients.keys()).map(
      (ws) =>
        new Promise((resolve) => {
          ws.close(1001, "Server shutting down");
          this.cleanupClient(ws);
          resolve();
        })
    );

    await Promise.all(closePromises);
    await new Promise((resolve) => this.wss.close(resolve));
    log.success("SHUTDOWN", `WebSocket server shutdown complete`);
  }
}

export const wsManager = new WebSocketManager();
