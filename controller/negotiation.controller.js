import EventRequest from '../model/eventrequest.schema.js';
import AI_NegotiationLog from '../model/ai_negotiationLog.schema.js';
import AI_Agent from '../model/ai_agent.schema.js';
import Notification from '../model/notification.schema.js';
import { wsManager } from '../webSocket.js';
import axios from 'axios';
import mongoose from 'mongoose';

const AI_AGENT_URL = process.env.AI_AGENT_URL || 'http://localhost:3002/api';
const AI_ENABLED = process.env.AI_ENABLED === 'true';

const createResponse = (success, message, data = null, error = null) => ({
  success,
  message,
  data,
  error
});

class NegotiationController {

  // ============ START NEGOTIATION ============
  // ============ START NEGOTIATION ============
  async startNegotiation(req, res) {
    try {
      const { eventRequestId } = req.params;
      const { proposedBudget, message } = req.body;
      const organizerId = req.user._id;

      console.log('📝 Starting negotiation for:', { eventRequestId, proposedBudget });

      // Validate event request
      const eventRequest = await EventRequest.findById(eventRequestId);
      if (!eventRequest) {
        return res.status(404).json(createResponse(false, 'Event request not found'));
      }

      if (eventRequest.status !== 'open') {
        return res.status(400).json(createResponse(false, 'This request is no longer accepting offers'));
      }

      // Check if organizer already responded
      const existingResponse = eventRequest.interestedOrganizers.find(
        org => org.organizerId.toString() === organizerId.toString()
      );

      if (existingResponse) {
        return res.status(400).json(createResponse(false, 'You have already responded to this request'));
      }

      // Add organizer to interestedOrganizers
      eventRequest.interestedOrganizers.push({
        organizerId,
        message: message || 'I am interested in organizing your event',
        status: 'pending',
        proposedBudget: proposedBudget || null,
        responseDate: new Date()
      });

      await eventRequest.save();

      // ============ FIXED: AI Agent Creation with proper values ============
      let aiAgent;

      // Try to find an existing agent first
      aiAgent = await AI_Agent.findOne({
        role: 'negotiator',
        status: 'active'
      });

      // If no negotiator agent exists, try to find any organizer agent
      if (!aiAgent) {
        aiAgent = await AI_Agent.findOne({
          agent_type: 'organizer',
          status: 'active'
        });
      }

      // If still no agent, create a new one with ALL required fields
      if (!aiAgent) {
        try {
          aiAgent = await AI_Agent.create({
            name: 'Event Request Negotiation Agent',           // ✅ Required
            role: 'negotiator',                                 // ✅ Must be one of: assistant, analyst, moderator, negotiator
            agent_type: 'organizer',                            // ✅ Must be one of: user, organizer, admin
            capabilities: {
              functions: ['price_negotiation', 'counter_offer', 'market_analysis'],
              description: 'Handles event request price negotiations',
              version: '1.0.0'
            },
            status: 'active'                                    // ✅ Must be one of: active, inactive, training, error
          });
          console.log('✅ Created new AI Negotiation Agent with ID:', aiAgent._id);
        } catch (createError) {
          console.error('❌ Failed to create AI agent:', createError.message);

          // Last resort: Use a dummy agent ID (temporary workaround)
          // You'll need to create this agent manually in your database first
          const dummyAgent = await AI_Agent.findOne({});
          if (dummyAgent) {
            aiAgent = dummyAgent;
          } else {
            throw new Error('No AI agent available in database. Please create one manually.');
          }
        }
      }

      // Create negotiation log
      const negotiationLog = await AI_NegotiationLog.create({
        eventRequest_id: eventRequestId,
        agent_id: aiAgent._id,
        negotiation_type: 'event_request',
        initial_offer: proposedBudget || 0,
        status: 'pending',
        negotiation_round: 1,
        negotiation_history: [{
          round: 1,
          offer: proposedBudget || 0,
          party: 'organizer',
          message: message || 'Initial offer',
          timestamp: new Date()
        }],
        metadata: {
          eventType: eventRequest.eventType,
          location: eventRequest.venue,
          userBudget: eventRequest.budget,
          organizerId: organizerId.toString(),
          userId: eventRequest.userId.toString()
        }
      });

      console.log('✅ Negotiation log created with ID:', negotiationLog._id);

      // Notify AI service to start negotiation tracking
      if (process.env.AI_ENABLED === 'true') {
        try {
          await axios.post(`${process.env.AI_AGENT_URL || 'http://localhost:3002'}/api/negotiation/event-request/start`, {
            eventRequestId,
            organizerId,
            organizerOffer: proposedBudget,
            organizerMessage: message,
            negotiationLogId: negotiationLog._id,
            eventDetails: {
              eventType: eventRequest.eventType,
              location: eventRequest.venue,
              budget: eventRequest.budget,
              date: eventRequest.date
            }
          }).catch(err => console.log('AI service notification failed (non-critical):', err.message));
        } catch (aiError) {
          console.error('Failed to notify AI service:', aiError.message);
          // Don't fail the whole request if AI service is down
        }
      }

      // Create notification for user
      await Notification.create({
        userId: eventRequest.userId,
        forRole: userRole._id,  // Required field!
        type: 'event_request',   // ✅ Valid enum value from your schema
        eventId: eventRequest.eventId || null, // Add this if event exists
        eventRequestId: eventRequest._id,
        message: `An organizer has shown interest in your ${eventRequest.eventType} event with an offer of NPR ${proposedBudget?.toLocaleString() || 'to be discussed'}`,
        status: 'unread',
        metadata: {
          organizerId: organizerId.toString(),
          proposedBudget,
          message: message,
          negotiationId: negotiationLog._id
        }
      });

      // Broadcast via WebSocket
      if (global.wsManager) {
        global.wsManager.sendToUser(eventRequest.userId.toString(), {
          type: 'negotiation',
          action: 'offer_received',
          payload: {
            eventRequestId: eventRequest._id,
            organizerId,
            proposedBudget,
            message,
            negotiationId: negotiationLog._id
          }
        });
      }

      res.status(201).json(createResponse(true, 'Offer submitted successfully', {
        eventRequest: {
          id: eventRequest._id,
          status: eventRequest.status
        },
        offer: eventRequest.interestedOrganizers[eventRequest.interestedOrganizers.length - 1],
        negotiation: {
          id: negotiationLog._id,
          status: negotiationLog.status,
          round: negotiationLog.negotiation_round
        }
      }));

    } catch (error) {
      console.error('❌ Start negotiation error:', error);
      res.status(500).json(createResponse(false, 'Failed to start negotiation', null, error.message));
    }
  }

  // ============ SUBMIT COUNTER OFFER ============
  async submitCounterOffer(req, res) {
    try {
      const { negotiationId } = req.params;
      const { counterOffer, message } = req.body;
      const userId = req.user._id;

      console.log('📝 Submitting counter for negotiation:', negotiationId);
      console.log('Counter offer:', counterOffer);

      // Get negotiation log
      const negotiation = await AI_NegotiationLog.findById(negotiationId);
      if (!negotiation) {
        return res.status(404).json(createResponse(false, 'Negotiation not found'));
      }

      console.log('Negotiation found:', {
        id: negotiation._id,
        eventRequestId: negotiation.eventRequest_id,
        initial_offer: negotiation.initial_offer,
        status: negotiation.status
      });

      // Get event request
      const eventRequest = await EventRequest.findById(negotiation.eventRequest_id);
      if (!eventRequest) {
        return res.status(404).json(createResponse(false, 'Event request not found'));
      }

      // Verify user owns this request
      if (eventRequest.userId.toString() !== userId.toString()) {
        return res.status(403).json(createResponse(false, 'Unauthorized'));
      }

      // Since negotiation doesn't have organizerId, we need to find it from eventRequest
      // The organizer who made the initial offer should be in interestedOrganizers
      console.log('Looking for organizer offer with initial amount:', negotiation.initial_offer);

      // Find the organizer who made the initial offer of 450,000
      const organizerOffer = eventRequest.interestedOrganizers.find(
        org => org.proposedBudget === negotiation.initial_offer
      );

      if (!organizerOffer) {
        console.log('Available organizer offers:',
          eventRequest.interestedOrganizers.map(o => ({
            organizerId: o.organizerId,
            proposedBudget: o.proposedBudget,
            status: o.status
          }))
        );

        return res.status(404).json(createResponse(false,
          'Organizer offer not found. The initial offer amount does not match any organizer.'));
      }

      const organizerId = organizerOffer.organizerId;
      console.log('Found organizer:', { organizerId, proposedBudget: organizerOffer.proposedBudget });

      // Update negotiation log
      const currentRound = negotiation.negotiation_round + 1;

      negotiation.negotiation_history.push({
        round: currentRound,
        offer: counterOffer,
        party: 'user',
        message: message || 'Counter offer',
        timestamp: new Date()
      });

      negotiation.negotiation_round = currentRound;
      negotiation.status = 'countered';
      await negotiation.save();

      // Update organizer's proposed budget
      organizerOffer.proposedBudget = counterOffer;
      organizerOffer.message = message || organizerOffer.message;
      await eventRequest.save();

      // Call AI service for counter-offer recommendation
      let aiResponse = null;
      if (process.env.AI_ENABLED === 'true') {
        try {
          const response = await axios.post(`${process.env.AI_AGENT_URL || 'http://localhost:3002'}/api/negotiation/counter`, {
            eventRequestId: eventRequest._id,
            userOffer: counterOffer,
            organizerOffer: organizerOffer.proposedBudget,
            eventType: eventRequest.eventType,
            location: eventRequest.venue || eventRequest.location || 'kathmandu',
            currentRound
          }, { timeout: 3000 });

          aiResponse = response.data;
          console.log('AI response received:', aiResponse);
        } catch (aiError) {
          console.error('Failed to get AI counter:', aiError.message);

          // Simple fallback calculation
          const midPoint = Math.round((counterOffer + organizerOffer.proposedBudget) / 2);
          aiResponse = {
            success: true,
            data: {
              aiOffer: midPoint,
              message: 'Based on both offers, here\'s a balanced counter-proposal.',
              accepted: false,
              finalOffer: Math.abs(counterOffer - organizerOffer.proposedBudget) < 10000
            }
          };
        }
      }

      // Create notification for organizer
      try {
        await Notification.create({
          userId: organizerId,
          type: 'event_response', // Make sure this matches your enum
          eventRequestId: eventRequest._id,
          message: `User has sent a counter offer of NPR ${counterOffer.toLocaleString()}`,
          status: 'unread',
          metadata: {
            negotiationId: negotiation._id,
            counterOffer,
            message,
            aiRecommendation: aiResponse?.data
          }
        });
      } catch (notifError) {
        console.error('Failed to create notification:', notifError.message);
        // Don't fail the request if notification fails
      }

      // Broadcast via WebSocket
      if (global.wsManager) {
        global.wsManager.sendToUser(organizerId.toString(), {
          type: 'negotiation',
          action: 'counter_received',
          payload: {
            eventRequestId: eventRequest._id,
            negotiationId: negotiation._id,
            counterOffer,
            message,
            round: currentRound,
            aiRecommendation: aiResponse?.data
          }
        });
      }

      res.json(createResponse(true, 'Counter offer submitted successfully', {
        negotiation: {
          id: negotiation._id,
          round: negotiation.negotiation_round,
          status: negotiation.status
        },
        aiResponse: aiResponse?.data || null
      }));

    } catch (error) {
      console.error('❌ Counter offer error:', error);
      res.status(500).json(createResponse(false, 'Failed to submit counter offer', null, error.message));
    }
  }

  // ============ ACCEPT OFFER ============
  async acceptOffer(req, res) {
    try {
      const { negotiationId } = req.params;
      const userId = req.user._id;

      const negotiation = await AI_NegotiationLog.findById(negotiationId);
      if (!negotiation) {
        return res.status(404).json(createResponse(false, 'Negotiation not found'));
      }

      const eventRequest = await EventRequest.findById(negotiation.eventRequest_id);
      if (!eventRequest) {
        return res.status(404).json(createResponse(false, 'Event request not found'));
      }

      // Verify authorization
      const isUser = eventRequest.userId.toString() === userId.toString();
      const isOrganizer = negotiation.metadata.organizerId === userId.toString();

      if (!isUser && !isOrganizer) {
        return res.status(403).json(createResponse(false, 'Unauthorized'));
      }

      // Get the last offer
      const lastOffer = negotiation.negotiation_history[negotiation.negotiation_history.length - 1];

      // Update negotiation
      negotiation.status = 'accepted';
      negotiation.final_offer = lastOffer.offer;
      await negotiation.save();

      // Update event request
      if (isUser) {
        // User is accepting - mark as deal_done
        eventRequest.status = 'deal_done';

        // Update the accepted organizer's status
        const organizerResponse = eventRequest.interestedOrganizers.find(
          org => org.organizerId.toString() === negotiation.metadata.organizerId
        );
        if (organizerResponse) {
          organizerResponse.status = 'accepted';
        }

        // Reject all other organizers
        eventRequest.interestedOrganizers.forEach(org => {
          if (org.organizerId.toString() !== negotiation.metadata.organizerId) {
            org.status = 'rejected';
          }
        });

        await eventRequest.save();

        // Notify organizer
        await Notification.create({
          userId: negotiation.metadata.organizerId,
          type: 'offer_accepted',
          title: '🎉 Your Offer Has Been Accepted!',
          message: `User accepted your offer of NPR ${lastOffer.offer.toLocaleString()}`,
          eventRequestId: eventRequest._id,
          status: 'unread',
          metadata: {
            negotiationId: negotiation._id,
            finalAmount: lastOffer.offer
          }
        });

      } else {
        // Organizer is accepting user's counter
        await Notification.create({
          userId: eventRequest.userId,
          type: 'offer_accepted',
          title: '🎉 Organizer Accepted Your Counter Offer!',
          message: `Organizer accepted your offer of NPR ${lastOffer.offer.toLocaleString()}`,
          eventRequestId: eventRequest._id,
          status: 'unread',
          metadata: {
            negotiationId: negotiation._id,
            finalAmount: lastOffer.offer
          }
        });
      }

      // Broadcast via WebSocket
      wsManager.sendToUser(eventRequest.userId.toString(), {
        type: 'negotiation',
        action: 'offer_accepted',
        payload: {
          eventRequestId: eventRequest._id,
          negotiationId: negotiation._id,
          finalAmount: lastOffer.offer,
          acceptedBy: isUser ? 'user' : 'organizer'
        }
      });

      wsManager.sendToUser(negotiation.metadata.organizerId, {
        type: 'negotiation',
        action: 'offer_accepted',
        payload: {
          eventRequestId: eventRequest._id,
          negotiationId: negotiation._id,
          finalAmount: lastOffer.offer,
          acceptedBy: isUser ? 'user' : 'organizer'
        }
      });

      res.json(createResponse(true, 'Offer accepted successfully', {
        negotiation,
        eventRequest: {
          id: eventRequest._id,
          status: eventRequest.status
        },
        finalAmount: lastOffer.offer
      }));

    } catch (error) {
      console.error('Accept offer error:', error);
      res.status(500).json(createResponse(false, 'Failed to accept offer', null, error.message));
    }
  }

  // ============ REJECT OFFER ============
  async rejectOffer(req, res) {
    try {
      const { negotiationId } = req.params;
      const userId = req.user._id;

      const negotiation = await AI_NegotiationLog.findById(negotiationId);
      if (!negotiation) {
        return res.status(404).json(createResponse(false, 'Negotiation not found'));
      }

      const eventRequest = await EventRequest.findById(negotiation.eventRequest_id);
      if (!eventRequest) {
        return res.status(404).json(createResponse(false, 'Event request not found'));
      }

      // Verify authorization
      const isUser = eventRequest.userId.toString() === userId.toString();
      const isOrganizer = negotiation.metadata.organizerId === userId.toString();

      if (!isUser && !isOrganizer) {
        return res.status(403).json(createResponse(false, 'Unauthorized'));
      }

      // Update negotiation
      negotiation.status = 'rejected';
      await negotiation.save();

      // Update organizer status if user rejected
      if (isUser) {
        const organizerResponse = eventRequest.interestedOrganizers.find(
          org => org.organizerId.toString() === negotiation.metadata.organizerId
        );
        if (organizerResponse) {
          organizerResponse.status = 'rejected';
          await eventRequest.save();
        }
      }

      // Notify the other party
      const notifyUserId = isUser ? negotiation.metadata.organizerId : eventRequest.userId;

      await Notification.create({
        userId: notifyUserId,
        type: 'offer_rejected',
        title: 'Offer Rejected',
        message: `Your offer has been rejected`,
        eventRequestId: eventRequest._id,
        status: 'unread',
        metadata: {
          negotiationId: negotiation._id,
          rejectedBy: isUser ? 'user' : 'organizer'
        }
      });

      res.json(createResponse(true, 'Offer rejected successfully'));

    } catch (error) {
      console.error('Reject offer error:', error);
      res.status(500).json(createResponse(false, 'Failed to reject offer', null, error.message));
    }
  }

  // ============ GET NEGOTIATION DETAILS ============
  async getNegotiation(req, res) {
    try {
      const { negotiationId } = req.params;
      const userId = req.user._id;

      const negotiation = await AI_NegotiationLog.findById(negotiationId);
      if (!negotiation) {
        return res.status(404).json(createResponse(false, 'Negotiation not found'));
      }

      const eventRequest = await EventRequest.findById(negotiation.eventRequest_id)
        .populate('userId', 'fullname email')
        .populate('interestedOrganizers.organizerId', 'fullname email');

      // Check authorization
      const isAuthorized =
        eventRequest.userId._id.toString() === userId.toString() ||
        negotiation.metadata.organizerId === userId.toString();

      if (!isAuthorized) {
        return res.status(403).json(createResponse(false, 'Unauthorized'));
      }

      res.json(createResponse(true, 'Negotiation retrieved', {
        negotiation,
        eventRequest: {
          id: eventRequest._id,
          eventType: eventRequest.eventType,
          venue: eventRequest.venue,
          budget: eventRequest.budget,
          date: eventRequest.date,
          status: eventRequest.status,
          user: eventRequest.userId
        },
        organizer: eventRequest.interestedOrganizers.find(
          org => org.organizerId._id.toString() === negotiation.metadata.organizerId
        )
      }));

    } catch (error) {
      console.error('Get negotiation error:', error);
      res.status(500).json(createResponse(false, 'Failed to get negotiation', null, error.message));
    }
  }

  // ============ GET ALL NEGOTIATIONS FOR EVENT REQUEST ============
  async getEventRequestNegotiations(req, res) {
    try {
      const { eventRequestId } = req.params;
      const userId = req.user._id;

      const eventRequest = await EventRequest.findById(eventRequestId);
      if (!eventRequest) {
        return res.status(404).json(createResponse(false, 'Event request not found'));
      }

      // Check authorization
      const isUser = eventRequest.userId.toString() === userId.toString();
      const isOrganizer = eventRequest.interestedOrganizers.some(
        org => org.organizerId.toString() === userId.toString()
      );

      if (!isUser && !isOrganizer) {
        return res.status(403).json(createResponse(false, 'Unauthorized'));
      }

      const negotiations = await AI_NegotiationLog.find({
        eventRequest_id: eventRequestId
      }).sort({ createdAt: -1 });

      res.json(createResponse(true, 'Negotiations retrieved', negotiations));

    } catch (error) {
      console.error('Get negotiations error:', error);
      res.status(500).json(createResponse(false, 'Failed to get negotiations', null, error.message));
    }
  }

  // ============ GET PRICE ANALYSIS ============
  async getPriceAnalysis(req, res) {
    try {
      const { eventType, location, budget } = req.query;

      if (!eventType || !location || !budget) {
        return res.status(400).json(createResponse(false, 'Event type, location, and budget are required'));
      }

      let analysis = null;
      if (AI_ENABLED) {
        try {
          const response = await axios.get(`${AI_AGENT_URL}/api/negotiation/price-analysis`, {
            params: { eventType, location, budget }
          });
          analysis = response.data;
        } catch (aiError) {
          console.error('Failed to get price analysis from AI:', aiError.message);
        }
      }

      // Fallback analysis if AI fails
      if (!analysis) {
        const basePrices = {
          'wedding': 500000,
          'birthday': 75000,
          'corporate': 200000,
          'conference': 150000,
          'party': 50000,
          'workshop': 80000,
          'seminar': 100000,
          'festival': 300000,
          'engagement': 300000
        };

        const locationMultipliers = {
          'kathmandu': 1.3,
          'lalitpur': 1.2,
          'bhaktapur': 1.2,
          'pokhara': 1.1,
          'chitwan': 1.0,
          'biratnagar': 0.9
        };

        const basePrice = basePrices[eventType] || 100000;
        const multiplier = locationMultipliers[location.toLowerCase()] || 1.0;
        const estimatedPrice = Math.round(basePrice * multiplier);
        const minReasonable = Math.round(estimatedPrice * 0.7);
        const maxReasonable = Math.round(estimatedPrice * 1.5);
        const isReasonable = budget >= minReasonable && budget <= maxReasonable;

        analysis = {
          success: true,
          data: {
            userBudget: parseFloat(budget),
            estimatedMarketPrice: estimatedPrice,
            isReasonable,
            minReasonable,
            maxReasonable,
            suggestion: isReasonable ?
              'Budget is within market range' :
              budget < minReasonable ?
                `Consider increasing budget to at least NPR ${minReasonable.toLocaleString()}` :
                `Budget is above market average, you can negotiate`
          }
        };
      }

      res.json(createResponse(true, 'Price analysis complete', analysis.data || analysis));

    } catch (error) {
      console.error('Price analysis error:', error);
      res.status(500).json(createResponse(false, 'Failed to analyze price', null, error.message));
    }
  }

  // ============ RECEIVE AI RESPONSE ============
  async receiveAIResponse(req, res) {
    try {
      const { eventRequestId, response, correlationId } = req.body;

      console.log(`📨 Received AI response for ${eventRequestId}:`, response);

      // Find the negotiation
      const negotiation = await AI_NegotiationLog.findOne({
        eventRequest_id: eventRequestId,
        status: 'pending'
      }).sort({ createdAt: -1 });

      if (negotiation) {
        // Store AI response in negotiation metadata
        negotiation.metadata = {
          ...negotiation.metadata,
          aiResponse: response,
          aiRespondedAt: new Date()
        };
        await negotiation.save();
      }

      // Notify via WebSocket if needed
      if (global.wsManager) {
        global.wsManager.sendToEvent(eventRequestId, {
          type: 'ai_response',
          data: response
        });
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Error receiving AI response:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }



}


export default new NegotiationController();