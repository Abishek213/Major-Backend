import EventRequest from '../model/eventrequest.schema.js';
import Notification from '../model/notification.schema.js';
import Role from '../model/role.schema.js';
import { wsManager } from '../webSocket.js';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import axios from 'axios';

const createResponse = (success, message, data = null, error = null) => ({
  success,
  message,
  data,
  error
});

// ========== AI SERVICE CONFIGURATION ==========
// FIX: AI routes live on the SAME backend (port 4001), not a separate service.
// The /api/ai/process-event-request route is defined in ai.routes.js
// which is mounted at /api/v1/ai (or /api/ai — match your server.js mount point).
const AI_AGENT_URL = process.env.AI_AGENT_URL || 'http://localhost:4001';
const AI_ENABLED = process.env.AI_ENABLED === 'true';

/**
 * Call AI Service for event request enhancement.
 * Hits POST /api/v1/ai/process-event-request (defined in ai.routes.js)
 */
const callAIAgent = async (requestData, userId, naturalLanguage = null) => {
  if (!AI_ENABLED) {
    return { aiEnabled: false, message: 'AI service is disabled' };
  }

  try {
    console.log('🔍 Calling AI Agent service...');

    const aiRequest = {
      userId: userId.toString(),
      naturalLanguage: naturalLanguage || requestData.description,
    };

    console.log('🔍 Sending natural language to AI:', 
      aiRequest.naturalLanguage.substring(0, 100) + '...');   

    // FIX 1: Use the correct endpoint (the one that works)
    const baseUrl = AI_AGENT_URL.endsWith('/api') 
      ? AI_AGENT_URL.slice(0, -4)  // Remove trailing /api if present
      : AI_AGENT_URL;
    
    const url = `${baseUrl}/process-event-request`;
    console.log('🔍 DEBUG - URL:', url);

    // Calls ai.routes.js → processEventRequest() in ai.controller.js
    const response = await axios.post(
      url,
      aiRequest,
      {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 120000
      }
    );

    console.log('✅ AI response received');

    // FIX 2: Format the response properly
    const formattedResponse = {
      aiEnabled: true,
      success: true,
      data: {
        extractedEntities: response.data.extractedEntities || {},
        matchedOrganizers: response.data.matchedOrganizers || [],
        budgetAnalysis: response.data.budgetAnalysis || {},
        aiSuggestions: response.data.aiSuggestions || {}
      },
      processingTime: new Date().toISOString()
    };

    console.log('✅ Formatted AI insights:', {
      hasExtractedEntities: !!formattedResponse.data.extractedEntities,
      matchedCount: formattedResponse.data.matchedOrganizers.length,
      hasBudgetAnalysis: !!formattedResponse.data.budgetAnalysis
    });

    return formattedResponse;
  } catch (error) {
    console.error('AI Agent Service Error:', error.message);
    console.error('   - Status:', error.response?.status);
    console.error('   - URL attempted:', error.config?.url);
    
    return {
      aiEnabled: true,
      success: false,
      error: error.message,
      fallback: true
    };
  }
};

/**
 * Fetch AI-suggested organizers.
 * Hits GET /api/v1/ai/event-suggestions (defined in ai.routes.js)
 */
const fetchAISuggestedOrganizers = async (eventData) => {
  if (!AI_ENABLED) return [];

  try {
    const response = await axios.get(
      `${AI_AGENT_URL}/api/v1/ai/event-suggestions`,
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

// ========== EXPORTED CONTROLLER FUNCTIONS ==========

export const createEventRequest = async (req, res) => {
  try {
    const { useAI = false, naturalLanguage = null } = req.body;

    console.log('Creating event request with useAI:', useAI);

    // 1. Create Event Request - SAVE IT FIRST
    const eventRequest = new EventRequest({
      ...req.body,
      userId: req.user._id,
      status: 'open'
    });
    
    // Save the initial event request
    await eventRequest.save();
    console.log('✅ Event request saved with ID:', eventRequest._id);

    // 2. Call AI Service if requested
    let aiInsightsResult = null;
    if (useAI && AI_ENABLED) {
      aiInsightsResult = await callAIAgent(req.body, req.user._id, naturalLanguage);

      // Store AI insights in event request metadata
      if (aiInsightsResult.success) {
        // Update the event request with AI insights
        const updatedEventRequest = await EventRequest.findByIdAndUpdate(
          eventRequest._id,
          {
            $set: {
              aiInsights: {
                processed: true,
                matchedOrganizers: aiInsightsResult.data?.matchedOrganizers?.slice(0, 5) || [],
                budgetAnalysis: aiInsightsResult.data?.budgetAnalysis || {},
                suggestions: aiInsightsResult.data?.aiSuggestions || {},
                processingTime: aiInsightsResult.processingTime,
                extractedEntities: aiInsightsResult.data?.extractedEntities || {}
              }
            }
          },
          { new: true } // Return the updated document
        );
        
        console.log('✅ AI insights saved to database');
        
        // Use the updated version
        eventRequest.aiInsights = updatedEventRequest.aiInsights;
      } else {
        console.log('⚠️ AI processing failed:', aiInsightsResult.error);
      }
    }

    // 3. Create Notification
    const organizerRole = await Role.findOne({ role_Name: 'Organizer' }).lean();

    const notification = await Notification.create({
      message: `New ${req.body.eventType} request`,
      type: 'new_event_request',
      forRole: organizerRole._id,
      eventRequestId: eventRequest._id,
      status: 'unread',
      metadata: {
        eventRequest: {
          type: req.body.eventType,
          venue: req.body.venue,
          date: req.body.date,
          budget: req.body.budget
        },
        aiInsights: aiInsightsResult?.success ? {
          budgetFeasibility: aiInsightsResult.data?.budgetAnalysis?.feasibility,
          organizerMatches: aiInsightsResult.data?.matchedOrganizers?.length || 0
        } : undefined
      }
    });

    // 4. Broadcast to organizers via WebSocket
    wsManager.broadcastToRole('Organizer', {
      type: 'notification',
      action: 'new_event_request',
      payload: {
        notification: notification.toObject(),
        eventRequest: eventRequest.toObject(),
        aiEnhanced: aiInsightsResult?.success || false
      }
    });

    // Fetch the final event request to ensure we have the latest data
    const finalEventRequest = await EventRequest.findById(eventRequest._id);

    res.status(201).json(createResponse(
      true,
      'Event request created successfully',
      {
        eventRequest: finalEventRequest,
        notification,
        aiInsights: aiInsightsResult?.success ? {
          enabled: true,
          matchedOrganizers: aiInsightsResult.data?.matchedOrganizers?.slice(0, 5),
          budgetAnalysis: aiInsightsResult.data?.budgetAnalysis,
          suggestions: aiInsightsResult.data?.aiSuggestions,
          extractedEntities: aiInsightsResult.data?.extractedEntities
        } : {
          enabled: false,
          message: 'AI processing not requested or failed'
        }
      }
    ));

  } catch (error) {
    console.error('Error creating event request:', error);
    res.status(500).json(
      createResponse(false, 'Error creating event request', null, error.message)
    );
  }
};

export const getEventRequestWithAIInsights = async (req, res) => {
  try {
    const { id } = req.params;

    const eventRequest = await EventRequest.findById(id)
      .populate('userId', 'fullname email')
      .populate('interestedOrganizers.organizerId', 'fullname email contact');

    if (!eventRequest) {
      return res.status(404).json(createResponse(false, 'Event request not found'));
    }

    let aiSuggestions = eventRequest.aiInsights;
    if (!aiSuggestions && AI_ENABLED) {
      const organizers = await fetchAISuggestedOrganizers(eventRequest);
      aiSuggestions = {
        processed: false,
        matchedOrganizers: organizers.slice(0, 5),
        timestamp: new Date().toISOString()
      };
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
      interestedOrganizers: eventRequest.interestedOrganizers.map((org) => ({
        organizer: org.organizerId,
        message: org.message,
        status: org.status,
        responseDate: org.responseDate,
        proposedBudget: org.proposedBudget
      })),
      aiInsights: aiSuggestions || { enabled: false, message: 'AI service not available' }
    };

    res.status(200).json(
      createResponse(true, 'Event request retrieved with AI insights', response)
    );
  } catch (error) {
    console.error('Error fetching event request with AI insights:', error);
    res.status(500).json(
      createResponse(false, 'Error fetching event request', null, error.message)
    );
  }
};

export const getAISuggestedOrganizers = async (req, res) => {
  try {
    const { id } = req.params;

    const eventRequest = await EventRequest.findById(id);
    if (!eventRequest) {
      return res.status(404).json(createResponse(false, 'Event request not found'));
    }

    if (!AI_ENABLED) {
      return res.status(200).json(
        createResponse(true, 'AI service is disabled', { aiEnabled: false, suggestions: [] })
      );
    }

    const aiResponse = await fetchAISuggestedOrganizers(eventRequest);

    const existingOrganizerIds = eventRequest.interestedOrganizers
      .map((org) => org.organizerId?.toString())
      .filter(Boolean);

    const filteredSuggestions = aiResponse.filter(
      (suggestion) => !existingOrganizerIds.includes(suggestion.id?.toString())
    );

    res.status(200).json(
      createResponse(true, 'AI suggestions retrieved', {
        aiEnabled: true,
        totalSuggestions: aiResponse.length,
        filteredSuggestions: filteredSuggestions.slice(0, 10),
        existingOrganizers: existingOrganizerIds.length,
        eventDetails: {
          eventType: eventRequest.eventType,
          budget: eventRequest.budget,
          location: eventRequest.venue
        }
      })
    );
  } catch (error) {
    console.error('Error getting AI suggestions:', error);
    res.status(500).json(
      createResponse(false, 'Failed to get AI suggestions', null, error.message)
    );
  }
};

export const reprocessWithAI = async (req, res) => {
  try {
    const { id } = req.params;
    const { naturalLanguage = null } = req.body;

    const eventRequest = await EventRequest.findById(id);
    if (!eventRequest) {
      return res.status(404).json(createResponse(false, 'Event request not found'));
    }

    if (!AI_ENABLED) {
      return res.status(400).json(createResponse(false, 'AI service is disabled'));
    }

    const eventData = {
      eventType: eventRequest.eventType,
      venue: eventRequest.venue,
      budget: eventRequest.budget,
      date: eventRequest.date,
      description: eventRequest.description
    };

    const aiInsights = await callAIAgent(eventData, eventRequest.userId, naturalLanguage);

    if (aiInsights.success) {
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

      res.status(200).json(
        createResponse(true, 'Event request reprocessed with AI', {
          eventRequestId: eventRequest._id,
          aiInsights: eventRequest.aiInsights,
          timestamp: new Date().toISOString()
        })
      );
    } else {
      res.status(500).json(
        createResponse(false, 'AI processing failed', null, aiInsights.error)
      );
    }
  } catch (error) {
    console.error('Error reprocessing with AI:', error);
    res.status(500).json(
      createResponse(false, 'Failed to reprocess with AI', null, error.message)
    );
  }
};

export const getEventRequestsForOrganizer = async (req, res) => {
  try {
    const { eventType } = req.query;
    const filter = eventType ? { eventType } : {};

    const requests = await EventRequest.find({
      'interestedOrganizers.organizerId': { $ne: req.user.id },
      ...filter
    })
      .populate('userId', 'fullname email')
      .exec();

    res.status(200).json(requests);
  } catch (error) {
    console.error('Error fetching event requests:', error);
    res.status(500).json({ message: 'Error fetching event requests', error });
  }
};

export const respondToEventRequest = async (req, res) => {
  const { message, status, proposedBudget } = req.body;
  const eventrequestId = req.params.id;

  try {
    const request = await EventRequest.findById(eventrequestId);
    if (!request) {
      return res.status(404).json({ message: 'Request not found' });
    }

    const existingOrganizerResponse = request.interestedOrganizers.find(
      (organizer) => organizer.organizerId.toString() === req.user._id.toString()
    );

    if (existingOrganizerResponse) {
      existingOrganizerResponse.proposedBudget = proposedBudget
        ? proposedBudget
        : existingOrganizerResponse.proposedBudget;
      existingOrganizerResponse.message = message;
      existingOrganizerResponse.status = status;
      existingOrganizerResponse.responseDate = new Date();

      await request.save();
      return res.status(200).json({ message: 'Organizer response updated successfully!' });
    }

    request.interestedOrganizers.push({
      organizerId: req.user.id,
      message,
      status,
      responseDate: new Date(),
      proposedBudget: proposedBudget || null
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
    return res.status(401).json({ message: 'Unauthorized. Token missing.' });
  }

  try {
    const decodedToken = jwt.decode(token);
    const userId = decodedToken.userId || decodedToken.user?.id;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }

    const eventRequests = await EventRequest.find({ userId }).populate({
      path: 'interestedOrganizers.organizerId',
      select: 'fullname contact',
      model: 'User'
    });

    if (!eventRequests || eventRequests.length === 0) {
      return res.status(404).json({ message: 'No event requests found for this user' });
    }

    const detailedEventRequests = eventRequests.map((event) => ({
      eventId: event._id,
      eventType: event.eventType,
      venue: event.venue,
      budget: event.budget,
      date: event.date,
      description: event.description,
      status: event.status,
      organizers: event.interestedOrganizers.map((org) => ({
        organizerId: org.organizerId?._id,
        fullname: org.organizerId?.fullname,
        contact: org.organizerId?.contact,
        message: org.message,
        status: org.status,
        responseDate: org.responseDate,
        proposedBudget: org.proposedBudget
      }))
    }));

    res.json({ eventRequests: detailedEventRequests });
  } catch (error) {
    console.error('Error in getEventRequestsForUser:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

export const getAcceptedOrganizers = async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Unauthorized. Token missing.' });
  }

  try {
    const decodedToken = jwt.decode(token);
    console.log('Decoded token:', decodedToken);
    // FIX: support both token shapes (userId flat OR user.id nested)
    const userId = decodedToken.userId || decodedToken.user?.id;
    console.log('User ID from token:', userId);

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }

    const eventRequests = await EventRequest.find({
      userId: new mongoose.Types.ObjectId(userId)
    }).populate('interestedOrganizers.organizerId', 'fullname contact message');

    if (!eventRequests || eventRequests.length === 0) {
      return res.status(404).json({ message: 'No event requests found for this user' });
    }

    const acceptedOrganizersByEvent = eventRequests.map((event) => {
      const acceptedOrganizers = event.interestedOrganizers
        .filter((org) => org.status === 'accepted')
        .map((org) => ({
          organizerId: org.organizerId._id,
          fullname: org.organizerId.fullname,
          contact: org.organizerId?.contact,
          message: org.message,
          status: org.status,
          responseDate: org.responseDate,
          proposedBudget: org.proposedBudget
        }));

      return { eventType: event.eventType, eventId: event._id, acceptedOrganizers };
    });

    const filteredResults = acceptedOrganizersByEvent.filter(
      (event) => event.acceptedOrganizers.length > 0
    );

    res.json({ acceptedOrganizersByEvent: filteredResults });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const acceptEventRequest = async (req, res) => {
  const { eventId } = req.params;
  const { proposedBudget } = req.body;
  const organizerId = req.user.id;

  try {
    const eventRequest = await EventRequest.findById(eventId);

    if (!eventRequest) {
      return res.status(404).json({ message: 'Event request not found' });
    }

    let organizerIndex = eventRequest.interestedOrganizers.findIndex(
      (org) => org.organizerId.toString() === organizerId.toString()
    );

    if (organizerIndex === -1) {
      eventRequest.interestedOrganizers.push({
        organizerId,
        status: 'accepted',
        message: 'I am interested to organize this event',
        proposedBudget: proposedBudget || null
      });
    } else {
      eventRequest.interestedOrganizers[organizerIndex].status = 'accepted';
      if (proposedBudget) {
        eventRequest.interestedOrganizers[organizerIndex].proposedBudget = proposedBudget;
      }
    }

    await eventRequest.save();
    res.status(200).json({ message: 'Event request accepted successfully' });
  } catch (error) {
    console.error('Error in acceptEventRequest:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

export const rejectEventRequest = async (req, res) => {
  const { eventId } = req.params;
  const organizerId = req.user.id;

  try {
    const eventRequest = await EventRequest.findById(eventId);

    if (!eventRequest) {
      return res.status(404).json({ message: 'Event request not found' });
    }

    let organizerIndex = eventRequest.interestedOrganizers.findIndex(
      (org) => org.organizerId.toString() === organizerId.toString()
    );

    if (organizerIndex === -1) {
      eventRequest.interestedOrganizers.push({ organizerId, status: 'rejected' });
    } else {
      eventRequest.interestedOrganizers[organizerIndex].status = 'rejected';
    }

    const allRejected = eventRequest.interestedOrganizers.every(
      (org) => org.status === 'rejected'
    );
    if (allRejected) {
      eventRequest.status = 'open';
    }

    await eventRequest.save();
    res.status(200).json({ message: 'Event request rejected successfully' });
  } catch (error) {
    console.error('Error in rejectEventRequest:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

export const selectOrganizer = async (req, res) => {
  const { eventId, organizerId } = req.body;

  try {
    const eventRequest = await EventRequest.findById(eventId);

    if (!eventRequest) {
      return res.status(404).json({ message: 'Event request not found' });
    }

    const organizerExists = eventRequest.interestedOrganizers.some(
      (org) => org.organizerId.toString() === organizerId
    );

    if (!organizerExists) {
      return res.status(404).json({ message: 'Organizer not found in interested organizers' });
    }

    eventRequest.status = 'deal_done';
    await eventRequest.save();

    res.status(200).json({ message: 'Organizer selected and status updated to deal_done' });
  } catch (error) {
    console.error('Error updating event status:', error);
    res.status(500).json({ message: 'Error updating event status', error });
  }
};