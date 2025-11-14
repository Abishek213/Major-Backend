import Notification from '../model/notification.schema.js';
import Event from '../model/event.schema.js';
import { wsManager } from '../webSocket.js';
import Role from "../model/role.schema.js"; 

const createResponse = (success, message, data = null, error = null) => ({
  success,
  message,
  data,
  error
});

export const getUserNotifications = async (req, res) => {
  try {
    const { _id: userId, role: roleId } = req.user;
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const filter = req.query.filter || 'all';
    
    const skip = (page - 1) * limit;
    
    let query = {
      $and: [
        {
          $or: [
            { userId },
            { forRole: roleId }
          ]
        },
        { 
          $or: [
            { 'metadata.requesterId': { $ne: userId } },
            { 'metadata.requesterId': { $exists: false } }
          ]
        }
      ]
    };
    
    // Apply filters using switch with proper type checking
    switch(filter.toLowerCase()) {
      case 'unread':
        query.status = 'unread';
        break;
      case 'event':
        query.type = { $in: ['event_request', 'event_response', 'event_update'] };
        break;
      case 'system':
        query.type = 'system_notification';
        break;
      case 'profile':
        query.type = 'profile_update';
        break;
    }
    
    const [notifications, total] = await Promise.all([
      Notification.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('eventId', 'event_name event_date')
        .populate('eventRequestId')
        .lean(),
      Notification.countDocuments(query)
    ]);
    
    const responseData = {
      notifications,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalNotifications: total,
        limit
      }
    };

    res.status(200).json(createResponse(true, 'Notifications retrieved successfully', responseData));
  } catch (error) {
    console.error('Error in getUserNotifications:', error);
    res.status(500).json(createResponse(false, 'Error fetching notifications', null, error.message));
  }
};

export const requestEventNotification = async (req, res) => {
  try {
    const { eventId, message } = req.body;
    const event = await Event.findById(eventId).populate('org_ID', 'fullname').lean();
    const adminRole = await Role.findOne({ role_Name: 'Admin' }).lean();

    const notification = await Notification.create({
      message: message || `New event requires approval`,
      type: 'event_request',
      forRole: adminRole._id,
      eventId,
      status: 'unread',
      metadata: { event: { id: event._id, name: event.event_name } }
    });

    wsManager.broadcastToRole('Admin', {
      type: 'notification',
      action: 'event_request',
      payload: { notification }
    });

    res.status(201).json(createResponse(true, 'Notification sent', notification));
  } catch (error) {
    res.status(500).json(createResponse(false, 'Error sending notification', null, error.message));
  }
};

export const markAsRead = async (req, res) => {
  try {
    const notification = await Notification.findByIdAndUpdate(
      req.params.id,
      { status: 'read' },
      { new: true }
    );
    
    wsManager.broadcastToUser(req.user._id, {
      type: 'notificationRead',
      payload: { notificationId: req.params.id }
    });
    
    res.status(200).json(createResponse(true, 'Notification read', { notification }));
  } catch (error) {
    res.status(500).json(createResponse(false, 'Error marking read', null, error.message));
  }
};

export const markAllAsRead = async (req, res) => {
  try {
    const result = await Notification.markAllAsRead(req.user._id, req.user.role);
    
    wsManager.broadcastToUser(req.user._id, {
      type: 'allNotificationsRead',
      payload: { modifiedCount: result.modifiedCount }
    });
    
    res.status(200).json(createResponse(true, 'All marked read', result));
  } catch (error) {
    res.status(500).json(createResponse(false, 'Error marking all read', null, error.message));
  }
};

export const approveEventNotification = async (req, res) => {
  try {
    const event = await Event.findByIdAndUpdate(
      req.params.eventId,
      { status: req.body.status.toLowerCase() },
      { new: true }
    ).populate('org_ID');

    const notification = await Notification.create({
      message: `Event "${event.event_name}" ${event.status}`,
      type: 'event_response',
      forRole: event.org_ID.role,
      userId: event.org_ID._id,
      eventId: event._id,
      status: 'unread',
      metadata: { event: { id: event._id, status: event.status } }
    });

    wsManager.broadcastToUser(event.org_ID._id.toString(), {
      type: 'notification',
      action: 'event_response',
      payload: { notification }
    });

    res.status(200).json(createResponse(true, `Event ${event.status}`, { notification }));
  } catch (error) {
    res.status(500).json(createResponse(false, 'Error processing event', null, error.message));
  }
};

export const deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;
    const notification = await Notification.findOneAndDelete({
      _id: id,
      $or: [
        { userId: req.user._id },
        { forRole: req.user.role }
      ]
    });

    if (!notification) {
      return res.status(404).json(createResponse(false, 'Notification not found or unauthorized'));
    }

    wsManager.broadcastToUser(req.user._id, {
      type: 'notification_deleted',
      payload: { 
        notificationId: id 
      }
    });

    res.status(200).json(createResponse(true, 'Notification deleted successfully', { 
      deletedNotification: notification 
    }));
  } catch (error) {
    res.status(500).json(createResponse(false, 'Error deleting notification', null, error.message));
  }
};

export const getAdminNotifications = async (req, res) => {
  try {
    const adminRole = await Role.findOne({ role_Name: 'Admin' });
    if (!adminRole) {
      throw new Error('Admin role not found');
    }

    const notifications = await Notification.find({ 
      forRole: adminRole._id, // Using the dynamically retrieved admin role ID
      type: 'event_request' 
    })
    .sort({ createdAt: -1 })
    .lean();

    // Send initial data through HTTP
    res.status(200).json(createResponse(
      true, 
      notifications.length ? 'Admin notifications retrieved' : 'No notifications found',
      { notifications }
    ));

    // Set up WebSocket subscription for real-time updates
    if (req.user.role === adminRole._id.toString()) {
      wsManager.broadcastToUser(req.user._id, {
        type: 'admin_notifications_subscription',
        notifications
      });
    }
  } catch (error) {
    res.status(500).json(createResponse(false, 'Error fetching admin notifications', null, error.message));
  }
};

export const getUnreadCount = async (req, res) => {
  try {
    // Update query to use status field for more precise counting
    const count = await Notification.countDocuments({
      $or: [
        { userId: req.user._id },
        { forRole: req.user.role }
      ],
      status: 'unread'
    });

    // Include additional metadata about notifications
    const summary = await Notification.aggregate([
      {
        $match: {
          $or: [
            { userId: req.user._id },
            { forRole: req.user.role }
          ]
        }
      },
      {
        $group: {
          _id: '$type',
          count: { $sum: { $cond: [{ $eq: ['$status', 'unread'] }, 1, 0] } }
        }
      }
    ]);

    const response = {
      totalUnread: count,
      byType: summary.reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
      }, {})
    };

    // Send comprehensive response through HTTP
    res.status(200).json(createResponse(true, 'Unread count retrieved', response));

    // Enhanced WebSocket subscription with detailed counts
    wsManager.broadcastToUser(req.user._id, {
      type: 'unread_count_subscription',
      ...response,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json(createResponse(false, 'Error getting unread count', null, error.message));
  }
};
