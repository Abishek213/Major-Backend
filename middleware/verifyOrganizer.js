import User from "../model/user.schema.js";
import Event from "../model/event.schema.js";
import Category from "../model/categories.schema.js";
// import Notification from "../model/notification.schema.js";

export const verifyOrganizer = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).populate("role");

    if (user.role.role_Name !== "Organizer") {
      return res
        .status(403)
        .json({ message: "Access denied: Not an organizer" });
    }

    if (!user.isApproved) {
      const eventDetails = req.body;

      const isLegacyFormat = !eventDetails.event_name && eventDetails.eventType;

      let categoryId;

      if (isLegacyFormat) {
        console.log(
          `⚠️ Legacy format detected in verifyOrganizer for eventType: ${eventDetails.eventType}`
        );

        const categoryDoc = await Category.findOne({
          categoryName: {
            $regex: new RegExp(`^${eventDetails.eventType}$`, "i"),
          },
        });

        if (categoryDoc) {
          categoryId = categoryDoc._id;
        } else {
          const newCategory = await Category.create({
            categoryName:
              eventDetails.eventType.charAt(0).toUpperCase() +
              eventDetails.eventType.slice(1),
            isActive: true,
          });
          categoryId = newCategory._id;
          console.log(`✅ Created new category: ${newCategory.categoryName}`);
        }
      } else {
        if (!eventDetails.category) {
          return res
            .status(400)
            .json({ message: "Category is required for new format" });
        }

        const validCategory = await Category.findById(eventDetails.category);
        if (!validCategory) {
          return res.status(400).json({ message: "Invalid category selected" });
        }
        categoryId = validCategory._id;
      }

      let eventData;

      if (isLegacyFormat) {
        const { eventType, budget, attendees, location, eventDate } =
          eventDetails;

        eventData = {
          event_name: `${eventType} in ${location}`,
          description: `A ${eventType} event organized in ${location}.`,
          category: categoryId,
          location,
          totalSlots: parseInt(attendees),
          event_date: eventDate,
          time: "10:00",
          price: budget || 0,
          tags: [],
          org_ID: req.user.id,
          status: "pending",
          isPublic: false,
          attendees: [],
        };
      } else {
        eventData = {
          ...eventDetails,
          org_ID: req.user.id,
          category: categoryId,
          status: "pending",
          isPublic:
            eventDetails.isPublic !== undefined ? eventDetails.isPublic : false,
          attendees: [],
        };
      }

      const pendingEvent = new Event(eventData);

      try {
        const savedEvent = await pendingEvent.save();
        await savedEvent.populate([
          { path: "org_ID", select: "fullname email" },
          { path: "category", select: "categoryName" },
        ]);

        // Create notification for admin
        // await Notification.create({
        //     recipient: 'admin',
        //     type: 'event_request',
        //     message: `New event "${savedEvent.event_name}" created by ${user.fullname}, awaiting approval.`,
        //     eventId: savedEvent._id,
        //     organizerId: req.user.id,
        //     status: 'unread'
        // });

        console.log(
          `Pending event created: ${savedEvent.event_name} (requires approval)`
        );

        return res.status(201).json({
          event: savedEvent,
          requiresApproval: true,
          message: "Event created and pending admin approval",
        });
      } catch (validationError) {
        return res.status(400).json({
          message: "Validation error",
          error: validationError.message,
        });
      }
    }

    next();
  } catch (error) {
    console.error("verifyOrganizer error:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};
