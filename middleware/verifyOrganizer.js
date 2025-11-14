import User from "../model/user.schema.js";
import Event from "../model/event.schema.js";
import Category from "../model/categories.schema.js";
// import Notification from "../model/notification.schema.js";

export const verifyOrganizer = async (req, res, next) => {
    try {
        const user = await User.findById(req.user.id).populate("role");
        
        // Check if user is an organizer
        if (user.role.role_Name !== "Organizer") {
            return res.status(403).json({ message: "Access denied: Not an organizer" });
        }

        // If organizer is not approved, create pending event
        if (!user.isApproved) {
            const eventDetails = req.body;
            
            // Validate category
            const validCategory = await Category.findById(eventDetails.category);
            if (!validCategory) {
                return res.status(400).json({ message: "Invalid category selected" });
            }

            // Create the pending event
            const pendingEvent = new Event({
                ...eventDetails,
                org_ID: req.user.id,
                category: validCategory._id,
                status: "pending",
                isPublic: eventDetails.isPublic !== undefined ? eventDetails.isPublic : false,
                attendees: []
            });

            // Validate and save the pending event
            try {
                const savedEvent = await pendingEvent.save();
                await savedEvent.populate([
                    { path: "org_ID", select: "username email" },
                    { path: "category", select: "categoryName" }
                ]);

                // Create notification for admin
                // await Notification.create({
                //     recipient: 'admin',
                //     type: 'event_request',
                //     message: `New event "${savedEvent.event_name}" created by ${user.username}, awaiting approval.`,
                //     eventId: savedEvent._id,
                //     organizerId: req.user.id,
                //     status: 'unread'
                // });

                return res.status(201).json({
                    event: savedEvent,
                    requiresApproval: true
                });
            } catch (validationError) {
                return res.status(400).json({
                    message: "Validation error",
                    error: validationError.message
                });
            }
        }

        // If organizer is approved, proceed to controller
        next();
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Server error", error: error.message });
    }
};