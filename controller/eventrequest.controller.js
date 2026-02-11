import EventRequest from '../model/eventrequest.schema.js';
import Notification from '../model/notification.schema.js';
import Role from '../model/role.schema.js';
import { wsManager } from '../webSocket.js';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import axios from 'axios'; // NEW: For AI service communication
// In eventrequest.controller.js - You're using AIEventRequestService but not importing it
// ADD THIS at the top:
// import AIEventRequestService from '../services/ai-event-request.service.js';

const createResponse = (success, message, data = null, error = null) => ({
  success,
  message,
  data,
  error
});


// ========== AI SERVICE CONFIGURATION ========== // NEW SECTION
const AI_AGENT_URL = process.env.AI_AGENT_URL || 'http://localhost:3001/api';
const AI_ENABLED = process.env.AI_ENABLED === 'true';


/**
 * Call AI Service for event request enhancement
 * @param {Object} requestData - Event request data
 * @param {string} userId - User ID
 * @returns {Object} AI enhanced response
 */
const callAIAgent = async (requestData, userId, naturalLanguage = null) => {
  if (!AI_ENABLED) {
    return {
      aiEnabled: false,
      message: 'AI service is disabled'
    };
  }

  try {
    console.log('🔍 Calling AI Agent service...');

    // Use requestText instead of naturalLanguage to match AI Agent expectations
    const aiRequest = {
      userId: userId.toString(),
       naturalLanguage: naturalLanguage || requestData.description,  // Changed from naturalLanguage to requestText
      // structuredData: {
      //   eventType: requestData.eventType,
      //   venue: requestData.venue,
      //   budget: requestData.budget,
      //   date: requestData.date,
      //   guests: requestData.guests,
      //   description: requestData.description
      // }
    };

console.log('🔍 Sending natural language to AI:', 
      aiRequest.naturalLanguage.substring(0, 100) + '...');   

    console.log('🔍 DEBUG - URL:', `${AI_AGENT_URL}/api/ai/process-event-request`);

    const response = await axios.post(
      `${AI_AGENT_URL}/api/ai/process-event-request`,
        aiRequest,
      {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 30000


      }
    );

    console.log('✅ AI extracted entities:', 
      response.data.extractedEntities?.eventType, 
      'in', 
      response.data.extractedEntities?.locations?.[0]);

    console.log('✅ DEBUG - AI Agent response successful:', response.status);

    return {
      aiEnabled: true,
      success: true,
      data: response.data,
      processingTime: new Date().toISOString()
    };
  } catch (error) {
    console.error('AI Agent Service Error:', error.message);
    console.error('   - Message:', error.message);
    console.error('   - Status:', error.response?.status);
    console.error('   - Status Text:', error.response?.statusText);
    console.error('   - Response Data:', error.response?.data)
    return {
      aiEnabled: true,
      success: false,
      error: error.message,
      fallback: true
    };
  }
};

// Update fetchAISuggestedOrganizers:
const fetchAISuggestedOrganizers = async (eventData) => {
  if (!AI_ENABLED) return [];

  try {
    const response = await axios.get(
      `${AI_AGENT_URL}/api/ai/event-suggestions`,
      {
        params: {
          eventType: eventData.eventType,
          budget: eventData.budget,
          location: eventData.venue,
          date: eventData.date
        }
      }
    );

    return response.data.matchedOrganizers || [];
  } catch (error) {
    console.error('Failed to get AI suggestions:', error.message);
    return [];
  }
};
// ========== EXISTING FUNCTIONS (NO CHANGES) ========== //
// All your existing functions remain exactly the same





// Create Event Request  - ENHANCED with AI
export const createEventRequest = async (req, res) => {
  try {

    const { useAI = false, naturalLanguage = null } = req.body;
    // 1. Create Event Request
    const eventRequest = await new EventRequest({
      ...req.body,
      userId: req.user._id,
      status: 'open'
    }).save();


    // 2. Call AI Service if requested
    let aiInsights = null;
    if (useAI && AI_ENABLED) {
      aiInsights = await callAIAgent(req.body, req.user._id, naturalLanguage);

      // Store AI insights in event request metadata
      if (aiInsights.success) {
        eventRequest.aiInsights = {
          processed: true,
          matchedOrganizers: aiInsights.data?.matchedOrganizers?.slice(0, 5) || [],
          budgetAnalysis: aiInsights.data?.budgetAnalysis || {},
          suggestions: aiInsights.data?.aiSuggestions || {},
          processingTime: aiInsights.processingTime
        };
        await eventRequest.save();
      }
    }



    // 3. Create Notification
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
        },
        aiInsights: aiInsights?.success ? {
          budgetFeasibility: aiInsights.data?.budgetAnalysis?.feasibility,
          organizerMatches: aiInsights.data?.matchedOrganizers?.length || 0
        } : undefined
      }
    });

    // 4. Broadcast to Organizers
    wsManager.broadcastToRole('Organizer', {
      type: 'notification',
      action: 'new_event_request',
      payload: {
        notification: notification.toObject(),
        eventRequest: eventRequest.toObject(),
        aiEnhanced: aiInsights?.success || false
      }
    });

    res.status(201).json(createResponse(
      true,
      'Event request created successfully',
      {
        eventRequest,
        notification,
        aiInsights: aiInsights?.success ? {
          enabled: true,
          matchedOrganizers: aiInsights.data?.matchedOrganizers?.slice(0, 5),
          budgetAnalysis: aiInsights.data?.budgetAnalysis,
          suggestions: aiInsights.data?.aiSuggestions
        } : {
          enabled: false,
          message: 'AI processing not requested or failed'
        }

      }
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



// ========== NEW AI-ENHANCED FUNCTIONS ========== //

/**
 * Get event request with AI insights
 */
export const getEventRequestWithAIInsights = async (req, res) => {
  try {
    const { id } = req.params;

    const eventRequest = await EventRequest.findById(id)
      .populate('userId', 'fullname email')
      .populate('interestedOrganizers.organizerId', 'fullname email contact');

    if (!eventRequest) {
      return res.status(404).json(createResponse(
        false,
        'Event request not found'
      ));
    }

    // Get AI suggestions if not already processed
    let aiSuggestions = eventRequest.aiInsights;
    if (!aiSuggestions && AI_ENABLED) {
      const organizers = await fetchAISuggestedOrganizers(eventRequest); // UPDATED FUNCTION CALL
      aiSuggestions = {
        processed: false,
        matchedOrganizers: organizers.slice(0, 5),
        timestamp: new Date().toISOString()
      };

      // Save for future reference
      eventRequest.aiInsights = aiSuggestions;
      await eventRequest.save();
    }

    const response = {
      eventRequest: {
        id: eventRequest._id,
        eventType: eventRequest.eventType,
        venue: eventRequest.venue,
        budget: eventRequest.budget,
        date: eventRequest.date,
        description: eventRequest.description,
        status: eventRequest.status,
        createdAt: eventRequest.createdAt,
        user: eventRequest.userId
      },
      interestedOrganizers: eventRequest.interestedOrganizers.map(org => ({
        organizer: org.organizerId,
        message: org.message,
        status: org.status,
        responseDate: org.responseDate,
        proposedBudget: org.proposedBudget
      })),
      aiInsights: aiSuggestions || { enabled: false, message: 'AI service not available' }
    };

    res.status(200).json(createResponse(
      true,
      'Event request retrieved with AI insights',
      response
    ));

  } catch (error) {
    console.error('Error fetching event request with AI insights:', error);
    res.status(500).json(createResponse(
      false,
      'Error fetching event request',
      null,
      error.message
    ));
  }
};


/**
 * Get AI-suggested organizers for an event request
 */
export const getAISuggestedOrganizers = async (req, res) => { // THIS IS THE EXPORTED FUNCTION
  try {
    const { id } = req.params;

    const eventRequest = await EventRequest.findById(id);
    if (!eventRequest) {
      return res.status(404).json(createResponse(
        false,
        'Event request not found'
      ));
    }

    if (!AI_ENABLED) {
      return res.status(200).json(createResponse(
        true,
        'AI service is disabled',
        { aiEnabled: false, suggestions: [] }
      ));
    }

    // Call AI service for organizer suggestions
    const aiResponse = await fetchAISuggestedOrganizers(eventRequest); // UPDATED FUNCTION CALL

    // Filter out organizers who have already responded
    const existingOrganizerIds = eventRequest.interestedOrganizers
      .map(org => org.organizerId?.toString())
      .filter(id => id); // Filter out undefined/null values

    const filteredSuggestions = aiResponse.filter(suggestion =>
      !existingOrganizerIds.includes(suggestion.id)
    );

    res.status(200).json(createResponse(
      true,
      'AI suggestions retrieved',
      {
        aiEnabled: true,
        totalSuggestions: aiResponse.length,
        filteredSuggestions: filteredSuggestions.slice(0, 10),
        existingOrganizers: existingOrganizerIds.length,
        eventDetails: {
          eventType: eventRequest.eventType,
          budget: eventRequest.budget,
          location: eventRequest.venue
        }
      }
    ));

  } catch (error) {
    console.error('Error getting AI suggestions:', error);
    res.status(500).json(createResponse(
      false,
      'Failed to get AI suggestions',
      null,
      error.message
    ));
  }
};

/**
 * Reprocess event request with AI
 */
export const reprocessWithAI = async (req, res) => {
  try {
    const { id } = req.params;
    const { naturalLanguage = null } = req.body;

    const eventRequest = await EventRequest.findById(id);
    if (!eventRequest) {
      return res.status(404).json(createResponse(
        false,
        'Event request not found'
      ));
    }

    if (!AI_ENABLED) {
      return res.status(400).json(createResponse(
        false,
        'AI service is disabled'
      ));
    }

    const eventData = {
      eventType: eventRequest.eventType,
      venue: eventRequest.venue,
      budget: eventRequest.budget,
      date: eventRequest.date,
      description: eventRequest.description
    };

    const aiInsights = await callAIService(eventData, eventRequest.userId, naturalLanguage);

    if (aiInsights.success) {
      // Update event request with new AI insights
      eventRequest.aiInsights = {
        processed: true,
        reprocessed: true,
        matchedOrganizers: aiInsights.data?.matchedOrganizers?.slice(0, 5) || [],
        budgetAnalysis: aiInsights.data?.budgetAnalysis || {},
        suggestions: aiInsights.data?.aiSuggestions || {},
        processingTime: new Date().toISOString(),
        previousInsights: eventRequest.aiInsights
      };

      await eventRequest.save();

      res.status(200).json(createResponse(
        true,
        'Event request reprocessed with AI',
        {
          eventRequestId: eventRequest._id,
          aiInsights: eventRequest.aiInsights,
          timestamp: new Date().toISOString()
        }
      ));
    } else {
      res.status(500).json(createResponse(
        false,
        'AI processing failed',
        null,
        aiInsights.error
      ));
    }

  } catch (error) {
    console.error('Error reprocessing with AI:', error);
    res.status(500).json(createResponse(
      false,
      'Failed to reprocess with AI',
      null,
      error.message
    ));
  }
};



// old one

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
    const eventRequests = await EventRequest.find({ userId: new mongoose.Types.ObjectId(userId) })
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

