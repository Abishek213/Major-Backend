import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema(
  {
    message: { 
      type: String, 
      required: true 
    },
    type: { 
      type: String, 
      required: true,
      enum: ['event_request', 'event_response', 'event_update', 
             'system_notification', 'profile_update', 'new_event_request', 'event_request_accepted']
    },
    forRole: { 
      type: mongoose.Schema.Types.ObjectId,  
      ref: 'Role',                          
      required: true
    },
    userId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User',
      required: function() {
        return ['event_response', 'profile_update'].includes(this.type);
      }
    },
    eventRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'EventRequest',
      required: function() {
        return this.type === 'new_event_request';
      }
    },
    eventId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Event',
      required: function() {
        return ['event_request', 'event_response', 'event_update'].includes(this.type);
      }
    },
    status: {                               
      type: String,
      enum: ['read', 'unread', 'archived'],
      default: 'unread'
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  { 
    timestamps: true,
    indexes: [
      { userId: 1, status: 1 },
      { forRole: 1, type: 1 },
      { createdAt: -1 },
      { status: 1 }                         // Added index for status
    ]
  }
);

notificationSchema.statics.markAllAsRead = async function(userId, roleId) {
  return this.updateMany(
    {
      $or: [
        { userId: userId },
        { forRole: roleId }
      ],
      status: 'unread'
    },
    { 
      status: 'read'
    }
  );
};

// Delete all notifications for a specific user or role
notificationSchema.statics.deleteAllNotifications = async function(userId, roleId) {
  return this.deleteMany({
    $or: [
      { userId: userId },
      { forRole: roleId }
    ]
  });
};

// Delete notifications by type for a specific user or role
notificationSchema.statics.deleteNotificationsByType = async function(userId, roleId, type) {
  return this.deleteMany({
    $or: [
      { userId: userId },
      { forRole: roleId }
    ],
    type: type
  });
};

// Archive all notifications for a specific user or role
notificationSchema.statics.archiveAllNotifications = async function(userId, roleId) {
  return this.updateMany(
    {
      $or: [
        { userId: userId },
        { forRole: roleId }
      ],
      status: { $ne: 'archived' }
    },
    { 
      status: 'archived'
    }
  );
};

// Get notification summary by type and status
notificationSchema.statics.getNotificationSummary = async function(userId, roleId) {
  return this.aggregate([
    {
      $match: {
        $or: [
          { userId: userId },
          { forRole: roleId }
        ]
      }
    },
    {
      $group: {
        _id: { type: '$type', status: '$status' },
        count: { $sum: 1 }
      }
    },
    {
      $group: {
        _id: '$_id.type',
        statuses: {
          $push: {
            status: '$_id.status', 
            count: '$count'
          }
        }
      }
    }
  ]);
};

export const Notification = mongoose.model('Notification', notificationSchema);
export default Notification;