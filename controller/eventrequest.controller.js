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
const AI_AGENT_URL = process.env.AI_AGENT_URL || 'http://localhost:3002/api/agents';
const AI_ENABLED = process.env.AI_ENABLED === 'true';

/**
 * Call AI Service for event request enhancement
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

    const aiRequest = {
      userId: userId.toString(),
      naturalLanguage: naturalLanguage || requestData.description,
    };

    console.log('🔍 Sending natural language to AI:',
      aiRequest.naturalLanguage.substring(0, 100) + '...');

    const url = `${AI_AGENT_URL}/user/event-request`;
    console.log('🔍 DEBUG - URL:', url);

    const response = await axios.post(url, aiRequest, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 120000
    });

    console.log('✅ AI response received');

    const formattedResponse = {
      aiEnabled: true,
      success: true,
      data: {
        extractedEntities: response.data.extractedEntities || {},
        matchedOrganizers: response.data.matchedOrganizers || [],
        budgetAnalysis:    response.data.budgetAnalysis    || {},
        aiSuggestions:     response.data.aiSuggestions     || {}
      },
      processingTime: new Date().toISOString()
    };

    console.log('✅ Formatted AI insights:', {
      hasExtractedEntities: !!formattedResponse.data.extractedEntities,
      matchedCount:         formattedResponse.data.matchedOrganizers.length,
      hasBudgetAnalysis:    !!formattedResponse.data.budgetAnalysis
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

const fetchAISuggestedOrganizers = async (eventData) => {
  if (!AI_ENABLED) return [];

  try {
    const response = await axios.get(`${AI_AGENT_URL}/event-suggestions`, {
      params: {
        eventType: eventData.eventType,
        budget:    eventData.budget,
        location:  eventData.venue,
        date:      eventData.date
      }
    });
    return response.data.matchedOrganizers || [];
  } catch (error) {
    console.error('Failed to get AI suggestions:', error.message);
    return [];
  }
};

// ========== CREATE EVENT REQUEST ==========

export const createEventRequest = async (req, res) => {
  try {
    const { useAI = false, naturalLanguage = null } = req.body;

    console.log('Creating event request with useAI:', useAI);

    const eventRequest = new EventRequest({
      ...req.body,
      userId: req.user._id,
      status: 'open'
    });

    await eventRequest.save();
    console.log('✅ Event request saved with ID:', eventRequest._id);

    let aiInsightsResult = null;
    if (useAI && AI_ENABLED) {
      aiInsightsResult = await callAIAgent(req.body, req.user._id, naturalLanguage);

      if (aiInsightsResult.success) {
        const extracted = aiInsightsResult.data?.extractedEntities || {};

        const updatedEventRequest = await EventRequest.findByIdAndUpdate(
          eventRequest._id,
          {
            $set: {
              eventType: extracted.eventType || eventRequest.eventType,
              venue:     extracted.locations?.[0] || eventRequest.venue,
              budget:    extracted.budget || eventRequest.budget,
              aiInsights: {
                processed:         true,
                matchedOrganizers: aiInsightsResult.data?.matchedOrganizers?.slice(0, 5) || [],
                budgetAnalysis:    aiInsightsResult.data?.budgetAnalysis || {},
                suggestions:       aiInsightsResult.data?.aiSuggestions || {},
                processingTime:    aiInsightsResult.processingTime,
                extractedEntities: aiInsightsResult.data?.extractedEntities || {}
              }
            }
          },
          { new: true }
        );

        console.log('✅ AI insights saved to database');
        eventRequest.aiInsights = updatedEventRequest.aiInsights;
      } else {
        console.log('⚠️ AI processing failed:', aiInsightsResult.error);
      }
    }

    const organizerRole = await Role.findOne({ role_Name: 'Organizer' }).lean();

    const finalEventType =
      aiInsightsResult?.data?.extractedEntities?.eventType || req.body.eventType;

    const notification = await Notification.create({
      message:        `New ${finalEventType} request`,
      type:           'new_event_request',
      forRole:        organizerRole._id,
      eventRequestId: eventRequest._id,
      status:         'unread',
      metadata: {
        eventRequest: {
          type:   req.body.eventType,
          venue:  req.body.venue,
          date:   req.body.date,
          budget: req.body.budget
        },
        aiInsights: aiInsightsResult?.success ? {
          budgetFeasibility: aiInsightsResult.data?.budgetAnalysis?.feasibility,
          organizerMatches:  aiInsightsResult.data?.matchedOrganizers?.length || 0
        } : undefined
      }
    });

    wsManager.broadcastToRole('Organizer', {
      type:   'notification',
      action: 'new_event_request',
      payload: {
        notification: notification.toObject(),
        eventRequest: eventRequest.toObject(),
        aiEnhanced:   aiInsightsResult?.success || false
      }
    });

    const finalEventRequest = await EventRequest.findById(eventRequest._id);

    res.status(201).json(createResponse(
      true,
      'Event request created successfully',
      {
        eventRequest: finalEventRequest,
        notification,
        aiInsights: aiInsightsResult?.success ? {
          enabled:           true,
          matchedOrganizers: aiInsightsResult.data?.matchedOrganizers?.slice(0, 5),
          budgetAnalysis:    aiInsightsResult.data?.budgetAnalysis,
          suggestions:       aiInsightsResult.data?.aiSuggestions,
          extractedEntities: aiInsightsResult.data?.extractedEntities
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

// ========== GET EVENT REQUEST WITH AI INSIGHTS ==========

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
        processed:         false,
        matchedOrganizers: organizers.slice(0, 5),
        timestamp:         new Date().toISOString()
      };
      eventRequest.aiInsights = aiSuggestions;
      await eventRequest.save();
    }

    const response = {
      eventRequest: {
        id:          eventRequest._id,
        eventType:   eventRequest.eventType,
        venue:       eventRequest.venue,
        budget:      eventRequest.budget,
        date:        eventRequest.date,
        description: eventRequest.description,
        status:      eventRequest.status,
        createdAt:   eventRequest.createdAt,
        user:        eventRequest.userId
      },
      interestedOrganizers: eventRequest.interestedOrganizers.map(org => ({
        organizer:      org.organizerId,
        message:        org.message,
        status:         org.status,
        responseDate:   org.responseDate,
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

// ========== GET AI SUGGESTED ORGANIZERS ==========

export const getAISuggestedOrganizers = async (req, res) => {
  try {
    const { id } = req.params;

    const eventRequest = await EventRequest.findById(id);
    if (!eventRequest) {
      return res.status(404).json(createResponse(false, 'Event request not found'));
    }

    if (!AI_ENABLED) {
      return res.status(200).json(createResponse(
        true,
        'AI service is disabled',
        { aiEnabled: false, suggestions: [] }
      ));
    }

    const aiResponse = await fetchAISuggestedOrganizers(eventRequest);

    const existingOrganizerIds = eventRequest.interestedOrganizers
      .map(org => org.organizerId?.toString())
      .filter(Boolean);

    const filteredSuggestions = aiResponse.filter(suggestion =>
      !existingOrganizerIds.includes(suggestion.id)
    );

    res.status(200).json(createResponse(
      true,
      'AI suggestions retrieved',
      {
        aiEnabled:           true,
        totalSuggestions:    aiResponse.length,
        filteredSuggestions: filteredSuggestions.slice(0, 10),
        existingOrganizers:  existingOrganizerIds.length,
        eventDetails: {
          eventType: eventRequest.eventType,
          budget:    eventRequest.budget,
          location:  eventRequest.venue
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

// ========== REPROCESS WITH AI ==========

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
      eventType:   eventRequest.eventType,
      venue:       eventRequest.venue,
      budget:      eventRequest.budget,
      date:        eventRequest.date,
      description: eventRequest.description
    };

    const aiInsights = await callAIAgent(eventData, eventRequest.userId, naturalLanguage);

    if (aiInsights.success) {
      eventRequest.aiInsights = {
        processed:         true,
        reprocessed:       true,
        matchedOrganizers: aiInsights.data?.matchedOrganizers?.slice(0, 5) || [],
        budgetAnalysis:    aiInsights.data?.budgetAnalysis || {},
        suggestions:       aiInsights.data?.aiSuggestions || {},
        processingTime:    new Date().toISOString(),
        previousInsights:  eventRequest.aiInsights
      };

      await eventRequest.save();

      res.status(200).json(createResponse(
        true,
        'Event request reprocessed with AI',
        {
          eventRequestId: eventRequest._id,
          aiInsights:     eventRequest.aiInsights,
          timestamp:      new Date().toISOString()
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

// ========== SEARCH ORGANIZERS FOR AI SERVICE ==========

export const searchOrganizersForAI = async (req, res) => {
  try {
    const { eventType, location, budget } = req.query;

    console.log('🔍 AI Service searching organizers:', { eventType, location, budget });

    const Role = mongoose.model('Role');
    const User = mongoose.model('User');

    const organizerRole = await Role.findOne({ role_Name: 'Organizer' }).lean();

    if (!organizerRole) {
      console.log('❌ No organizer role found');
      return res.status(200).json({
        success: true,
        data:    [],
        count:   0,
        message: 'No organizer role found'
      });
    }

    console.log('✅ Organizer role ID:', organizerRole._id);

    const organizers = await User.find({ role: organizerRole._id })
      .select('fullname email contactNo profileImage organizerDetails')
      .limit(20)
      .lean();

    console.log(`📊 Found ${organizers.length} total organizers`);

    if (organizers.length === 0) {
      return res.status(200).json({
        success: true,
        data:    [],
        count:   0,
        message: 'No organizers found in database'
      });
    }

    console.log('📝 Sample organizer:', {
      name:         organizers[0].fullname,
      hasDetails:   !!organizers[0].organizerDetails,
      expertise:    organizers[0].organizerDetails?.expertise,
      serviceAreas: organizers[0].organizerDetails?.serviceAreas
    });

    const formattedOrganizers = organizers.map(org => {
      const details      = org.organizerDetails || {};
      const serviceAreas = details.serviceAreas  || [];
      const priceRange   = details.priceRange    || { min: 10000, max: 500000 };

      return {
        _id:               org._id,
        id:                org._id.toString(),
        fullname:          org.fullname   || '',
        email:             org.email      || '',
        contactNo:         org.contactNo  || '',
        profileImage:      org.profileImage || null,
        expertise:         Array.isArray(details.expertise) ? details.expertise : [],
        location:          serviceAreas[0]?.city || 'Nepal',
        rating:            typeof details.rating === 'number' ? details.rating : 4.0,
        priceRange:        [priceRange.min || 10000, priceRange.max || 500000],
        totalEvents:       details.totalEvents       || 0,
        responseTime:      details.responseTime      || '24h',
        isVerified:        details.isVerified        || false,
        businessName:      details.businessName      || org.fullname,
        yearsOfExperience: details.yearsOfExperience || 0,
        serviceAreas
      };
    });

    let filteredOrganizers = formattedOrganizers;

    if (location) {
      const locationLower = location.toLowerCase();
      filteredOrganizers = formattedOrganizers.filter(org =>
        org.serviceAreas.some(area =>
          area.city && area.city.toLowerCase().includes(locationLower)
        )
      );
      console.log(`📍 After location filter: ${filteredOrganizers.length} organizers`);
    }

    if (eventType && filteredOrganizers.length > 0) {
      const eventTypeLower = eventType.toLowerCase();
      filteredOrganizers = filteredOrganizers.filter(org =>
        org.expertise.some(exp =>
          exp.toLowerCase().includes(eventTypeLower) ||
          eventTypeLower.includes(exp.toLowerCase())
        )
      );
      console.log(`🎯 After expertise filter: ${filteredOrganizers.length} organizers`);
    }

    if (budget && filteredOrganizers.length > 0) {
      const budgetNum = parseInt(budget);
      filteredOrganizers = filteredOrganizers.filter(org => {
        const [min] = org.priceRange;
        return budgetNum >= min * 0.7;
      });
      console.log(`💰 After budget filter: ${filteredOrganizers.length} organizers`);
    }

    console.log(`✅ Returning ${filteredOrganizers.length} organizers to AI service`);

    return res.status(200).json({
      success: true,
      data:    filteredOrganizers,
      count:   filteredOrganizers.length,
      debug: {
        totalFound:    organizers.length,
        filteredCount: filteredOrganizers.length,
        filters:       { eventType, location, budget }
      }
    });

  } catch (error) {
    console.error('❌ Error in searchOrganizersForAI:', error);
    return res.status(500).json({
      success: false,
      error:   error.message,
      data:    [],
      count:   0
    });
  }
};

// ========== GET EVENT REQUESTS FOR ORGANIZER (SIMPLIFIED, ROBUST VERSION) ==========

export const getEventRequestsForOrganizer = async (req, res) => {
  try {
    const { eventType } = req.query;
    const organizerId = req.user?._id || req.user?.id;
    if (!organizerId) {
      return res.status(401).json({ message: 'Organizer ID not found' });
    }
    const eventTypeFilter = eventType ? { eventType } : {};

    // Fetch all open events (regardless of organizer)
    const openRequests = await EventRequest.find({
      status: 'open',
      ...eventTypeFilter,
    })
      .populate('userId', 'fullname email contact')
      .populate('interestedOrganizers.organizerId', 'fullname email')
      .lean();

    // Fetch all deal_done events
    const dealDoneRequests = await EventRequest.find({
      status: 'deal_done',
      ...eventTypeFilter,
    })
      .populate('userId', 'fullname email contact')
      .populate('interestedOrganizers.organizerId', 'fullname email')
      .lean();

    // Filter deal_done events to only those where this organizer is accepted
    const filteredDealDone = dealDoneRequests.filter(request => {
      return request.interestedOrganizers.some(org => {
        const orgId = org.organizerId?._id?.toString() || org.organizerId?.toString();
        return orgId === organizerId.toString() && org.status === 'accepted';
      });
    });

    // Combine and sort by createdAt descending
    const allRequests = [...openRequests, ...filteredDealDone];
    allRequests.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Enhance with myResponse etc.
    const enhancedRequests = allRequests.map((request) => {
      const myResponse = request.interestedOrganizers.find((org) => {
        const orgId = org.organizerId?._id?.toString() || org.organizerId?.toString();
        return orgId === organizerId.toString();
      });

      const myNegotiationId = myResponse?.negotiationId
        ? myResponse.negotiationId.toString()
        : null;

      return {
        ...request,
        myResponse: myResponse || null,
        myStatus: myResponse?.status || 'not_responded',
        myProposedBudget: myResponse?.proposedBudget ?? null,
        myMessage: myResponse?.message ?? null,
        myNegotiationId,
        hasResponded: !!myResponse,
        hasUserCounter: myResponse?.status === 'countered',
        isDealWon: request.status === 'deal_done' && myResponse?.status === 'accepted',
      };
    });

    res.status(200).json(enhancedRequests);
  } catch (error) {
    console.error('Error fetching event requests:', error);
    res.status(500).json({ message: 'Error fetching event requests', error });
  }
};

// ========== ORGANIZER RESPONDS TO A REQUEST ==========

export const respondToEventRequest = async (req, res) => {
  const { message, status, proposedBudget } = req.body;
  const eventrequestId = req.params.id;
  const organizerId = req.user?._id || req.user?.id;

  if (!organizerId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const request = await EventRequest.findById(eventrequestId);
    if (!request) {
      return res.status(404).json({ message: 'Request not found' });
    }

    const existingOrganizerResponse = request.interestedOrganizers.find(
      (organizer) => organizer.organizerId.toString() === organizerId.toString()
    );

    if (existingOrganizerResponse) {
      existingOrganizerResponse.proposedBudget =
        proposedBudget ? proposedBudget : existingOrganizerResponse.proposedBudget;
      existingOrganizerResponse.message      = message;
      existingOrganizerResponse.status       = status;
      existingOrganizerResponse.responseDate = new Date();

      await request.save();
      return res.status(200).json({ message: 'Organizer response updated successfully!' });
    }

    // Convert organizerId to ObjectId to ensure consistent type
    const organizerObjectId = new mongoose.Types.ObjectId(organizerId);
    request.interestedOrganizers.push({
      organizerId:    organizerObjectId,
      message,
      status,
      responseDate:   new Date(),
      proposedBudget: proposedBudget || null,
    });

    await request.save();
    res.status(200).json({ message: 'Organizer response recorded successfully!' });

  } catch (error) {
    console.error('Error details:', error);
    res.status(500).json({ message: 'Error responding to event request', error: error.message });
  }
};

// ========== GET EVENT REQUESTS FOR USER ==========

export const getEventRequestsForUser = async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Unauthorized. Token missing.' });
  }

  try {
    const decodedToken = jwt.decode(token);
    const userId = decodedToken.id || decodedToken.user?.id;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }

    const eventRequests = await EventRequest.find({ userId }).populate({
      path:   'interestedOrganizers.organizerId',
      select: 'fullname contact',
      model:  'User'
    });

    if (!eventRequests || eventRequests.length === 0) {
      return res.status(404).json({ message: 'No event requests found for this user' });
    }

    const detailedEventRequests = eventRequests.map((event) => ({
      _id:         event._id,
      eventType:   event.eventType,
      venue:       event.venue,
      budget:      event.budget,
      date:        event.date,
      description: event.description,
      status:      event.status,
      organizers:  event.interestedOrganizers.map((org) => ({
        organizerId:    org.organizerId?._id,
        fullname:       org.organizerId?.fullname,
        contact:        org.organizerId?.contact,
        message:        org.message,
        status:         org.status,
        responseDate:   org.responseDate,
        proposedBudget: org.proposedBudget,
        negotiationId:  org.negotiationId || null,
      })),
    }));

    res.json({ eventRequests: detailedEventRequests });
  } catch (error) {
    console.error('Error in getEventRequestsForUser:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

// ========== GET ACCEPTED ORGANIZERS ==========

export const getAcceptedOrganizers = async (req, res) => {
  try {
    let userId;

    if (req.user?._id || req.user?.id) {
      userId = (req.user._id || req.user.id).toString();
    } else {
      const token = req.headers.authorization?.split(' ')[1];
      if (!token) return res.status(401).json({ message: 'Unauthorized. Token missing.' });
      const decodedToken = jwt.decode(token);
      userId = decodedToken?.id || decodedToken?.user?.id;
    }

    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }

    console.log('Getting accepted organizers for user:', userId);

    const eventRequests = await EventRequest.find({
      userId:  new mongoose.Types.ObjectId(userId),
      status:  'deal_done'
    }).populate({
      path:   'interestedOrganizers.organizerId',
      select: 'fullname contact email'
    });

    if (!eventRequests || eventRequests.length === 0) {
      return res.json({ acceptedOrganizersByEvent: [] });
    }

    const acceptedOrganizersByEvent = eventRequests.map((event) => {
      const acceptedOrganizers = event.interestedOrganizers
        .filter((org) => org.status === 'accepted' && org.organizerId)
        .map((org) => {
          const orgDoc = org.organizerId;
          return {
            organizerId:    orgDoc?._id  || org.organizerId,
            fullname:       orgDoc?.fullname  || 'Unknown Organizer',
            contact:        orgDoc?.contact   || null,
            email:          orgDoc?.email     || null,
            message:        org.message,
            status:         org.status,
            responseDate:   org.responseDate,
            proposedBudget: org.proposedBudget,
            negotiationId:  org.negotiationId || null
          };
        });

      return {
        eventType:   event.eventType,
        eventId:     event._id,
        venue:       event.venue,
        date:        event.date,
        budget:      event.budget,
        eventStatus: event.status,
        acceptedOrganizers,
      };
    });

    const filteredResults = acceptedOrganizersByEvent.filter(
      (event) => event.acceptedOrganizers.length > 0
    );

    console.log(`✅ Found ${filteredResults.length} accepted deals for user ${userId}`);
    res.json({ acceptedOrganizersByEvent: filteredResults });

  } catch (error) {
    console.error('Error in getAcceptedOrganizers:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

// ========== ORGANIZER ACCEPTS A REQUEST (direct, no negotiation) ==========

export const acceptEventRequest = async (req, res) => {
  const { eventId } = req.params;
  const { proposedBudget } = req.body;
  const organizerId = req.user?._id || req.user?.id;

  if (!organizerId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const eventRequest = await EventRequest.findById(eventId);

    if (!eventRequest) {
      return res.status(404).json({ message: 'Event request not found' });
    }

    let organizerIndex = eventRequest.interestedOrganizers.findIndex(
      (org) => org.organizerId.toString() === organizerId.toString()
    );

    const organizerObjectId = new mongoose.Types.ObjectId(organizerId);

    if (organizerIndex === -1) {
      eventRequest.interestedOrganizers.push({
        organizerId:    organizerObjectId,
        status:         'accepted',
        message:        'I am interested to organize this event',
        proposedBudget: proposedBudget || null,
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

// ========== ORGANIZER REJECTS A REQUEST ==========

export const rejectEventRequest = async (req, res) => {
  const { eventId } = req.params;
  const organizerId = req.user?._id || req.user?.id;

  if (!organizerId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const eventRequest = await EventRequest.findById(eventId);

    if (!eventRequest) {
      return res.status(404).json({ message: 'Event request not found' });
    }

    let organizerIndex = eventRequest.interestedOrganizers.findIndex(
      (org) => org.organizerId.toString() === organizerId.toString()
    );

    const organizerObjectId = new mongoose.Types.ObjectId(organizerId);

    if (organizerIndex === -1) {
      eventRequest.interestedOrganizers.push({
        organizerId: organizerObjectId,
        status: 'rejected',
      });
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

// ========== USER SELECTS AN ORGANIZER ==========

// ========== USER SELECTS AN ORGANIZER ==========
// ========== USER SELECTS AN ORGANIZER (DEBUG VERSION) ==========
export const selectOrganizer = async (req, res) => {
  const { eventId, organizerId } = req.body;
  
  console.log('='.repeat(50));
  console.log('🔍 SELECT ORGANIZER CALLED');
  console.log('📦 Request body:', { eventId, organizerId });
  console.log('👤 User from auth:', req.user ? { id: req.user._id || req.user.id } : 'No user');
  
  try {
    // Validate inputs
    if (!eventId || !organizerId) {
      console.log('❌ Missing eventId or organizerId');
      return res.status(400).json({ message: 'eventId and organizerId are required' });
    }
    
    console.log('🔎 Looking for event with ID:', eventId);
    const eventRequest = await EventRequest.findById(eventId);
    
    if (!eventRequest) {
      console.log('❌ Event not found in database');
      return res.status(404).json({ message: 'Event request not found' });
    }
    
    console.log('📋 EVENT FOUND:', {
      id: eventRequest._id.toString(),
      userId: eventRequest.userId?.toString(),
      status: eventRequest.status,
      eventType: eventRequest.eventType,
      interestedOrganizersCount: eventRequest.interestedOrganizers?.length || 0
    });
    
    // Log all interested organizers for debugging
    console.log('👥 INTERESTED ORGANIZERS:');
    eventRequest.interestedOrganizers.forEach((org, index) => {
      const orgId = org.organizerId?._id?.toString() || org.organizerId?.toString();
      console.log(`  [${index}] ID: ${orgId}, Status: ${org.status}, Budget: ${org.proposedBudget}`);
    });
    
    // Find the selected organizer
    const organizerObjectId = new mongoose.Types.ObjectId(organizerId);
    const organizerIdStr = organizerObjectId.toString();
    
    console.log('🎯 Looking for organizer with ID:', organizerIdStr);
    
    const organizerIndex = eventRequest.interestedOrganizers.findIndex((org) => {
      const orgId = org.organizerId?._id?.toString() || org.organizerId?.toString();
      const matches = orgId === organizerIdStr;
      if (matches) console.log('✅ Found match at index', organizerIndex);
      return matches;
    });
    
    if (organizerIndex === -1) {
      console.log('❌ Organizer not found in interestedOrganizers array');
      return res.status(404).json({ message: 'Organizer not found in interested organizers' });
    }
    
    const selectedOrganizer = eventRequest.interestedOrganizers[organizerIndex];
    console.log('✅ Selected organizer found:', {
      index: organizerIndex,
      status: selectedOrganizer.status,
      proposedBudget: selectedOrganizer.proposedBudget,
      negotiationId: selectedOrganizer.negotiationId
    });
    
    // CRITICAL: Update the event
    console.log('🔄 Updating event status from', eventRequest.status, 'to', 'deal_done');
    eventRequest.status = 'deal_done';
    
    console.log('🔄 Updating organizer statuses:');
    eventRequest.interestedOrganizers.forEach((org, index) => {
      const oldStatus = org.status;
      org.status = index === organizerIndex ? 'accepted' : 'rejected';
      console.log(`  Organizer ${index}: ${oldStatus} → ${org.status}`);
    });
    
    // Save with explicit error handling
    console.log('💾 Attempting to save to database...');
    try {
      await eventRequest.save();
      console.log('✅ Save successful!');
    } catch (saveError) {
      console.log('❌ Save failed:', saveError.message);
      console.log('❌ Save error details:', saveError);
      throw saveError;
    }
    
    // Verify the save worked by fetching again
    const verifyEvent = await EventRequest.findById(eventId);
    console.log('🔍 VERIFICATION AFTER SAVE:', {
      id: verifyEvent._id.toString(),
      status: verifyEvent.status,
      interestedOrganizers: verifyEvent.interestedOrganizers.map(o => ({
        id: o.organizerId?.toString(),
        status: o.status
      }))
    });
    
    // Update negotiation log if exists
    if (selectedOrganizer.negotiationId) {
      try {
        console.log('🔄 Updating negotiation log:', selectedOrganizer.negotiationId);
        const NegLog = mongoose.models.AI_NegotiationLog || mongoose.model('AI_NegotiationLog');
        await NegLog.findByIdAndUpdate(
          selectedOrganizer.negotiationId,
          {
            status: 'accepted',
            final_offer: selectedOrganizer.proposedBudget
          }
        );
        console.log('✅ Negotiation log updated');
      } catch (negErr) {
        console.warn('⚠️ Could not update negotiation log:', negErr.message);
      }
    }
    
    // Send notifications (non-critical, don't block response)
    try {
      console.log('🔔 Sending notifications...');
      const OrganizerRole = mongoose.model('Role');
      const organizerRole = await OrganizerRole.findOne({ role_Name: 'Organizer' });
      
      if (organizerRole) {
        await Notification.create({
          userId: organizerObjectId,
          forRole: organizerRole._id,
          type: 'event_request_accepted',
          eventRequestId: eventRequest._id,
          message: `Congratulations! You have been selected for the ${eventRequest.eventType} event`,
          status: 'unread',
          metadata: {
            finalAmount: selectedOrganizer.proposedBudget,
            negotiationId: selectedOrganizer.negotiationId
          }
        });
        console.log('✅ Notification created');
      }
      
      if (wsManager && typeof wsManager.sendToUser === 'function') {
        wsManager.sendToUser(organizerId, {
          type: 'notification',
          action: 'organizer_selected',
          payload: {
            eventRequestId: eventRequest._id,
            message: 'You have been selected for the event!'
          }
        });
        console.log('✅ WebSocket notification sent');
      }
    } catch (notifError) {
      console.warn('⚠️ Notification error (non-critical):', notifError.message);
    }
    
    console.log('🎉 SUCCESS! Returning response');
    console.log('='.repeat(50));
    
    res.status(200).json({
      success: true,
      message: 'Organizer selected successfully',
      data: {
        eventRequestId: eventRequest._id,
        status: eventRequest.status,
        selectedOrganizer: organizerId
      }
    });
    
  } catch (error) {
    console.log('💥 CATASTROPHIC ERROR:');
    console.log('Error name:', error.name);
    console.log('Error message:', error.message);
    console.log('Error stack:', error.stack);
    console.log('='.repeat(50));
    
    res.status(500).json({
      success: false,
      message: 'Error selecting organizer',
      error: error.message
    });
  }
};