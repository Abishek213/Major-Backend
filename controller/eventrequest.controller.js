import EventRequest from '../model/eventrequest.schema.js';
import Notification from '../model/notification.schema.js';
import Role from '../model/role.schema.js';
import { wsManager } from '../webSocket.js';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';

const createResponse = (success, message, data = null, error = null) => ({
  success,
  message,
  data,
  error
});

// Create Event Request
export const createEventRequest = async (req, res) => {
  try {
    // 1. Create Event Request
    const eventRequest = await new EventRequest({
      ...req.body,
      userId: req.user._id,
      status: 'open'
    }).save();

    // 2. Create Notification
    const organizerRole = await Role.findOne({ role_Name: 'Organizer' }).lean();
    
    const notification = await Notification.create({
      message: `New ${req.body.eventType} request`,
      type: 'new_event_request',
      eventRequestId: eventRequest._id,
      forRole: organizerRole._id,
      status: 'unread',
      metadata: {
        eventRequest: {
          type: req.body.eventType,
          venue: req.body.venue,
          date: req.body.date,
          budget: req.body.budget
        }
      }
    });

    // 3. Broadcast to Organizers
    wsManager.broadcastToRole('Organizer', {
      type: 'notification',
      action: 'new_event_request',
      payload: {
        notification: notification.toObject(),
        eventRequest: eventRequest.toObject()
      }
    });

    res.status(201).json(createResponse(
      true,
      'Event request created successfully',
      { eventRequest, notification }
    ));

  } catch (error) {
    console.error('Error creating event request:', error);
    res.status(500).json(createResponse(
      false,
      'Error creating event request',
      null,
      error.message
    ));
  }
};

// Get All Open Event Requests for Organizers
export const getEventRequestsForOrganizer = async (req, res) => {
  try {
    const { eventType } = req.query; // Get eventType from query params
    const filter = eventType ? { eventType } : {}; // Apply filter only if eventType is provided

    const requests = await EventRequest.find({ 
      'interestedOrganizers.organizerId': { $ne: req.user.id },
      ...filter, // Add the eventType filter here
    })
    .populate('userId', 'fullname email') // Fetch the name and email from the User model
    .exec();

    res.status(200).json(requests);
  } catch (error) {
    console.error('Error fetching event requests:', error);
    res.status(500).json({ message: 'Error fetching event requests', error });
  }
};

// Organizer Expresses Interest in Event Request
export const respondToEventRequest = async (req, res) => {
  const { message, status, proposedBudget } = req.body;
  const eventrequestId = req.params.id;

  try {
    const request = await EventRequest.findById(eventrequestId);
    if (!request) {
      return res.status(404).json({ message: 'Request not found' });
    }

    // Find the organizer's existing response (if any)
    const existingOrganizerResponse = request.interestedOrganizers.find(
      (organizer) => organizer.organizerId.toString() === req.user._id.toString()
    );

    // If the organizer has already responded, update their response
    if (existingOrganizerResponse) {
      // If the organizer is editing the budget, update it
      existingOrganizerResponse.proposedBudget = proposedBudget ? proposedBudget : existingOrganizerResponse.proposedBudget;
      existingOrganizerResponse.message = message; // Optionally update the message
      existingOrganizerResponse.status = status; // Optionally update the status
      existingOrganizerResponse.responseDate = new Date(); // Update the response date

      await request.save();
      return res.status(200).json({ message: 'Organizer response updated successfully!' });
    }

    // If the organizer has not responded yet, add a new response
    request.interestedOrganizers.push({
      organizerId: req.user.id,
      message,
      status,
      responseDate: new Date(),
      proposedBudget: proposedBudget || null, // If no proposed budget is provided, it will be null
    });

    await request.save();
    res.status(200).json({ message: 'Organizer response recorded successfully!' });

  } catch (error) {
    console.error('Error details:', error);
    res.status(500).json({ message: 'Error responding to event request', error: error.message });
  }
};

export const getEventRequestsForUser = async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: "Unauthorized. Token missing." });
  }

  try {
    const decodedToken = jwt.decode(token);
    // Fix 1: Ensure correct path to user ID in the token
    const userId = decodedToken.id || decodedToken.user?.id; // Adjust based on your token structure

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: "Invalid userId" });
    }

    // Fix 2: Correct population syntax and field names
    const eventRequests = await EventRequest.find({ userId })
      .populate({
        path: "interestedOrganizers.organizerId",
        select: "fullname contact", // Ensure these fields exist in the User model
        model: "User" // Explicitly reference the model if needed
      });

    if (!eventRequests || eventRequests.length === 0) {
      return res.status(404).json({ message: "No event requests found for this user" });
    }

    // Fix 3: Correct data mapping
    const detailedEventRequests = eventRequests.map((event) => ({
      eventId: event._id,
      eventType: event.eventType,
      venue: event.venue,
      budget: event.budget,
      date: event.date,
      description: event.description,
      status: event.status,
      organizers: event.interestedOrganizers.map((org) => ({
        organizerId: org.organizerId?._id, // Access populated organizer
        fullname: org.organizerId?.fullname,
        contact: org.organizerId?.contact,
        message: org.message, // From EventRequest subdocument
        status: org.status,
        responseDate: org.responseDate,
        proposedBudget: org.proposedBudget,
      })),
    }));

    res.json({ eventRequests: detailedEventRequests });
  } catch (error) {
    console.error("Error in getEventRequestsForUser:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

export const getAcceptedOrganizers = async (req, res) => {
  // Get the token from the Authorization header
  const token = req.headers.authorization?.split(' ')[1];  // "Bearer <token>"

  if (!token) {
    return res.status(401).json({ message: "Unauthorized. Token missing." });
  }

  try {
    // Decode the JWT token to get the userId
    const decodedToken = jwt.decode(token);
    console.log("Decoded token:", decodedToken);
    const userId = decodedToken.user.id;  // Assuming your token contains the userId
    console.log("User ID from token:", userId);

    // Validate the userId
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: "Invalid userId" });
    }

    // Fetch all event requests for the logged-in user
    const eventRequests = await EventRequest.find({ userId:  new mongoose.Types.ObjectId(userId)})
      .populate("interestedOrganizers.organizerId", "fullname contact message ");  // Populate organizer details
  
    if (!eventRequests || eventRequests.length === 0) {
      return res.status(404).json({ message: "No event requests found for this user" });
    }

    // Process event requests and filter accepted organizers
    const acceptedOrganizersByEvent = eventRequests.map((event) => {
      const acceptedOrganizers = event.interestedOrganizers
        .filter((org) => org.status === "accepted") // Only include accepted organizers
        .map((org) => ({
          organizerId: org.organizerId._id,
          fullname: org.organizerId.fullname,
          contact: org.organizerId?.contact,
          message: org.message,
          status: org.status,
          responseDate: org.responseDate,
          proposedBudget: org.proposedBudget,
        }));

      return {
        eventType: event.eventType, // Include event type from the event request
        eventId: event._id,
        acceptedOrganizers,
      };
    });

    // Filter events that have accepted organizers
    const filteredResults = acceptedOrganizersByEvent.filter((event) => event.acceptedOrganizers.length > 0);

    res.json({ acceptedOrganizersByEvent: filteredResults });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const acceptEventRequest = async (req, res) => {
  const { eventId } = req.params;
  const { proposedBudget } = req.body; // Event ID from the request URL
  const organizerId = req.user.id; // Organizer ID from the authenticated user

  try {
    // Fetch the event request from the database
    const eventRequest = await EventRequest.findById(eventId);

    // Check if the event request exists
    if (!eventRequest) {
      return res.status(404).json({ message: 'Event request not found' });
    }

    // Check if the organizer is already in the interestedOrganizers array
    let organizerIndex = eventRequest.interestedOrganizers.findIndex(
      (org) => org.organizerId.toString() === organizerId.toString()
    );

    // If the organizer is not already in the array, add them
    if (organizerIndex === -1) {
      eventRequest.interestedOrganizers.push({

        organizerId, // Add organizer ID
        status: 'accepted', // Set status to accepted
        message: 'I am interested to organize this event', // Optional message
        proposedBudget: proposedBudget || null, // Save the proposed budget, if provided
      });
    } else {
      // If the organizer is already in the array, update their status
      eventRequest.interestedOrganizers[organizerIndex].status = 'accepted';
      if (proposedBudget) {
        eventRequest.interestedOrganizers[organizerIndex].proposedBudget = proposedBudget;
      }
    }

    // Update the status of the event request to 'deal_done'
    // eventRequest.status = 'open';

    // Save the updated event request to the database
    await eventRequest.save();

    res.status(200).json({ message: 'Event request accepted successfully' });
  } catch (error) {
    console.error('Error in acceptEventRequest:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

export const rejectEventRequest = async (req, res) => {
  const { eventId } = req.params; // Event ID from the request URL
  const organizerId = req.user.id; // Organizer ID from the authenticated user

  try {
    // Fetch the event request from the database
    const eventRequest = await EventRequest.findById(eventId);

    // Check if the event request exists
    if (!eventRequest) {
      return res.status(404).json({ message: 'Event request not found' });
    }

    // Check if the organizer is already in the interestedOrganizers array
    let organizerIndex = eventRequest.interestedOrganizers.findIndex(
      (org) => org.organizerId.toString() === organizerId.toString()
    );

    // If the organizer is not in the array, add them with a 'rejected' status
    if (organizerIndex === -1) {
      eventRequest.interestedOrganizers.push({
        organizerId, // Add organizer ID
        status: 'rejected', // Set status to rejected
      });
    } else {
      // If the organizer is already in the array, update their status
      eventRequest.interestedOrganizers[organizerIndex].status = 'rejected';
    }

    // If all organizers have rejected, set the event request status back to 'open'
    const allRejected = eventRequest.interestedOrganizers.every(
      (org) => org.status === 'rejected'
    );
    if (allRejected) {
      eventRequest.status = 'open';
    }

    // Save the updated event request to the database
    await eventRequest.save();

    res.status(200).json({ message: 'Event request rejected successfully' });
  } catch (error) {
    console.error('Error in rejectEventRequest:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

export const selectOrganizer = async (req, res) => {
  const { eventId, organizerId } = req.body; // Extracting eventId and organizerId from the request body

  try {
    // Find the event request
    const eventRequest = await EventRequest.findById(eventId);

    if (!eventRequest) {
      return res.status(404).json({ message: 'Event request not found' });
    }

    // Check if the organizer exists in the interestedOrganizers array
    const organizerExists = eventRequest.interestedOrganizers.some(
      (org) => org.organizerId.toString() === organizerId
    );

    if (!organizerExists) {
      return res.status(404).json({ message: 'Organizer not found in interested organizers' });
    }

    // Update the event request status to `deal_done`
    eventRequest.status = 'deal_done';

    // Save the updated event request
    await eventRequest.save();

    res.status(200).json({ message: 'Organizer selected and status updated to deal_done' });
  } catch (error) {
    console.error('Error updating event status:', error);
    res.status(500).json({ message: 'Error updating event status', error });
  }
};

