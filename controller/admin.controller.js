// admin.controller.js
import Event from '../model/event.schema.js';
import User from '../model/user.schema.js';
import Permission from '../model/permission.schema.js';
import RolePermission from '../model/rolePermission.schema.js';
import Category from '../model/categories.schema.js';
import EventRequest from '../model/eventrequest.schema.js';

export const getDashboardStats = async (req, res) => {
    try {
        const currentDate = new Date();
        const lastMonth = new Date(currentDate.setMonth(currentDate.getMonth() - 1));
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

        // Get combined growth data for users, events, and requests
        const [userGrowthData, eventGrowthData, requestGrowthData] = await Promise.all([
            User.aggregate([
                {
                    $match: {
                        createdAt: { $gte: sixMonthsAgo }
                    }
                },
                {
                    $group: {
                        _id: {
                            year: { $year: "$createdAt" },
                            month: { $month: "$createdAt" }
                        },
                        count: { $sum: 1 }
                    }
                },
                {
                    $sort: { "_id.year": 1, "_id.month": 1 }
                }
            ]),
            Event.aggregate([
                {
                    $match: {
                        createdAt: { $gte: sixMonthsAgo }
                    }
                },
                {
                    $group: {
                        _id: {
                            year: { $year: "$createdAt" },
                            month: { $month: "$createdAt" }
                        },
                        count: { $sum: 1 },
                        pendingCount: {
                            $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] }
                        },
                        approvedCount: {
                            $sum: { $cond: [{ $eq: ["$status", "approved"] }, 1, 0] }
                        },
                        upcomingCount: {
                            $sum: { $cond: [{ $eq: ["$status", "upcoming"] }, 1, 0] }
                        },
                        ongoingCount: {
                            $sum: { $cond: [{ $eq: ["$status", "ongoing"] }, 1, 0] }
                        },
                        completedCount: {
                            $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] }
                        },
                        cancelledCount: {
                            $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] }
                        },
                        rejectedCount: {
                            $sum: { $cond: [{ $eq: ["$status", "rejected"] }, 1, 0] }
                        }
                    }
                },
                {
                    $sort: { "_id.year": 1, "_id.month": 1 }
                }
            ]),
            EventRequest.aggregate([
                {
                    $match: {
                        createdAt: { $gte: sixMonthsAgo }
                    }
                },
                {
                    $group: {
                        _id: {
                            year: { $year: "$createdAt" },
                            month: { $month: "$createdAt" }
                        },
                        count: { $sum: 1 },
                        openCount: {
                            $sum: { $cond: [{ $eq: ["$status", "open"] }, 1, 0] }
                        },
                        dealDoneCount: {
                            $sum: { $cond: [{ $eq: ["$status", "deal_done"] }, 1, 0] }
                        }
                    }
                },
                {
                    $sort: { "_id.year": 1, "_id.month": 1 }
                }
            ])
        ]);

        // Get current counts and stats
        const [
            totalUsers,
            totalEvents,
            pendingEvents,
            approvedEvents,
            totalPermissions,
            activeCategories,
            totalRequests,
            openRequests,
            userRoleDistribution,
            rolePermissions,
            roleBasedEventStats
        ] = await Promise.all([
            User.countDocuments(),
            Event.countDocuments(),
            Event.countDocuments({ status: 'pending' }),
            Event.countDocuments({ status: 'approved' }),
            Permission.countDocuments(),
            Category.countDocuments({ isActive: true }),
            EventRequest.countDocuments(),
            EventRequest.countDocuments({ status: 'open' }),
            // Enhanced user role distribution
            User.aggregate([
                {
                    $lookup: {
                        from: 'roles',
                        localField: 'role',
                        foreignField: '_id',
                        as: 'roleInfo'
                    }
                },
                {
                    $unwind: '$roleInfo'
                },
                {
                    $group: {
                        _id: '$roleInfo.role_Name',
                        count: { $sum: 1 },
                        users: {
                            $push: {
                                userId: '$_id',
                                email: '$email',
                                fullname: '$fullname',
                                isApproved: '$isApproved'
                            }
                        }
                    }
                },
                {
                    $project: {
                        roleName: '$_id',
                        count: 1,
                        recentUsers: { $slice: ['$users', 5] }
                    }
                }
            ]),
            // Role permissions mapping
            RolePermission.aggregate([
                {
                    $lookup: {
                        from: 'roles',
                        localField: 'role',
                        foreignField: '_id',
                        as: 'roleInfo'
                    }
                },
                {
                    $lookup: {
                        from: 'permissions',
                        localField: 'permission',
                        foreignField: '_id',
                        as: 'permissionInfo'
                    }
                },
                {
                    $unwind: '$roleInfo'
                },
                {
                    $unwind: '$permissionInfo'
                },
                {
                    $group: {
                        _id: '$roleInfo.role_Name',
                        permissions: { $push: '$permissionInfo.permissionName' }
                    }
                }
            ]),
            // Event statistics by role
            Event.aggregate([
                {
                    $lookup: {
                        from: 'users',
                        localField: 'org_ID',
                        foreignField: '_id',
                        as: 'organizer'
                    }
                },
                {
                    $unwind: '$organizer'
                },
                {
                    $lookup: {
                        from: 'roles',
                        localField: 'organizer.role',
                        foreignField: '_id',
                        as: 'roleInfo'
                    }
                },
                {
                    $unwind: '$roleInfo'
                },
                {
                    $group: {
                        _id: '$roleInfo.role_Name',
                        totalEvents: { $sum: 1 },
                        pendingEvents: {
                            $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] }
                        },
                        approvedEvents: {
                            $sum: { $cond: [{ $eq: ["$status", "approved"] }, 1, 0] }
                        }
                    }
                }
            ])
        ]);

        // Get detailed event status breakdown
        const eventStatusBreakdown = await Event.aggregate([
            {
                $group: {
                    _id: "$status",
                    count: { $sum: 1 }
                }
            }
        ]);

        // Calculate monthly analytics data
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const analyticsData = Array.from({ length: 6 }, (_, i) => {
            const date = new Date();
            date.setMonth(date.getMonth() - i);
            
            const monthUserData = userGrowthData.find(data => 
                data._id.year === date.getFullYear() && 
                data._id.month === (date.getMonth() + 1)
            );

            const monthEventData = eventGrowthData.find(data => 
                data._id.year === date.getFullYear() && 
                data._id.month === (date.getMonth() + 1)
            );

            const monthRequestData = requestGrowthData.find(data => 
                data._id.year === date.getFullYear() && 
                data._id.month === (date.getMonth() + 1)
            );

            return {
                name: monthNames[date.getMonth()],
                users: monthUserData?.count || 0,
                events: monthEventData?.count || 0,
                pending: monthEventData?.pendingCount || 0,
                requests: monthRequestData?.count || 0
            };
        }).reverse();

        // Calculate growth percentages
        const calculateGrowth = (current, previous) => {
            if (!previous) return '+0%';
            const growth = ((current - previous) / previous * 100).toFixed(1);
            return `${growth > 0 ? '+' : ''}${growth}%`;
        };

        // Format stats data for the dashboard
        const statsData = [
            {
                title: 'Total Users',
                value: totalUsers.toString(),
                change: calculateGrowth(totalUsers, totalUsers - (userGrowthData[0]?.count || 0)),
                icon: 'Users',
                color: 'indigo'
            },
            {
                title: 'Total Events',
                value: totalEvents.toString(),
                change: `${pendingEvents} pending`,
                icon: 'Calendar',
                color: 'green'
            },
            {
                title: 'Approved Events',
                value: approvedEvents.toString(),
                change: calculateGrowth(approvedEvents, approvedEvents - (eventGrowthData[0]?.approvedCount || 0)),
                icon: 'CheckCircle',
                color: 'purple'
            },
            {
                title: 'Active Categories',
                value: activeCategories.toString(),
                change: 'Categories in use',
                icon: 'Tag',
                color: 'blue'
            },
            {
                title: 'Event Requests',
                value: totalRequests.toString(),
                change: `${openRequests} open`,
                icon: 'FileText',
                color: 'pink'
            },
            {
                title: 'Upcoming Events',
                value: (eventStatusBreakdown.find(status => status._id === 'upcoming')?.count || 0).toString(),
                change: 'Scheduled',
                icon: 'Clock',
                color: 'yellow'
            }
        ];

        res.status(200).json({
            success: true,
            data: {
                statsData,
                analyticsData,
                usersByRole: userRoleDistribution.reduce((acc, { roleName, count, recentUsers }) => {
                    acc[roleName] = { count, recentUsers };
                    return acc;
                }, {}),
                eventStats: eventStatusBreakdown.reduce((acc, { _id, count }) => {
                    acc[_id] = count;
                    return acc;
                }, {}),
                requestStats: {
                    total: totalRequests,
                    open: openRequests,
                    dealDone: totalRequests - openRequests
                },
                categoryStats: {
                    total: activeCategories
                },
                roleStats: {
                    distribution: userRoleDistribution.reduce((acc, { roleName, count, recentUsers }) => {
                        acc[roleName] = { count, recentUsers };
                        return acc;
                    }, {}),
                    permissions: rolePermissions.reduce((acc, { _id, permissions }) => {
                        acc[_id] = permissions;
                        return acc;
                    }, {}),
                    eventStats: roleBasedEventStats.reduce((acc, { _id, totalEvents, pendingEvents, approvedEvents }) => {
                        acc[_id] = { totalEvents, pendingEvents, approvedEvents };
                        return acc;
                    }, {})
                }
            }
        });
    } catch (error) {
        console.error('getDashboardStats error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching dashboard stats',
            error: error.message
        });
    }
};

export const getPendingEvents = async (req, res) => {
    try {
        const pendingEvents = await Event.find({ status: 'pending' })
            .populate("org_ID", "fullname email")
            .populate("category", "categoryName");

        const formattedEvents = pendingEvents.map(event => ({
            ...event._doc,
            organizer: {
                name: event.org_ID.fullname,
                email: event.org_ID.email
            }
        }));

        res.status(200).json({
            success: true,
            data: formattedEvents || []
        });
    } catch (error) {
        console.error('getPendingEvents error:', error);
        res.status(500).json({
            success: false,
            message: "Error fetching pending events",
            error: error.message
        });
    }
};

export const approveRejectEvent = async (req, res) => {
    const { eventId } = req.params;
    const { status } = req.body;

    try {
        if (!eventId) {
            return res.status(400).json({
                success: false,
                message: "Event ID is required"
            });
        }

        if (status !== 'approved' && status !== 'rejected') {
            return res.status(400).json({
                success: false,
                message: "Invalid status, must be 'approved' or 'rejected'"
            });
        }

        const event = await Event.findById(eventId).populate('org_ID', 'fullname email'); 

        if (!event) {
            return res.status(404).json({
                success: false,
                message: "Event not found"
            });
        }

        event.status = status === 'approved' ? 'approved' : 'rejected';
        event.isPublic = status === 'approved';
        
        await event.save();

        const user = await User.findById(event.org_ID);
        if (user) {
            if (status === 'approved') {
                user.isApproved = true;
                await user.save();
            }
        }
        res.status(200).json({
            success: true,
            message: `Event ${status} successfully`,
            data: event
        });
    } catch (error) {
        console.error('approveRejectEvent error:', error);
        res.status(500).json({
            success: false,
            message: "Error updating event status",
            error: error.message
        });
    }
};