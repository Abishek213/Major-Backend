import EventRequest from '../model/eventrequest.schema.js';
import AI_NegotiationLog from '../model/ai_negotiationLog.schema.js';
import AI_Agent from '../model/ai_agent.schema.js';
import Notification from '../model/notification.schema.js';
import { wsManager } from '../webSocket.js';
import axios from 'axios';
import mongoose from 'mongoose';

const AI_AGENT_URL = process.env.AI_AGENT_URL || 'http://localhost:3002/api';
const AI_ENABLED   = process.env.AI_ENABLED === 'true';

const createResponse = (success, message, data = null, error = null) => ({
  success,
  message,
  data,
  error
});

class NegotiationController {

  // ============ START NEGOTIATION ============
  async startNegotiation(req, res) {
    try {
      const { eventRequestId } = req.params;
      const { proposedBudget, message } = req.body;
      const organizerId = req.user._id;

      console.log('📝 Starting negotiation for:', { eventRequestId, proposedBudget });

      const eventRequest = await EventRequest.findById(eventRequestId);
      if (!eventRequest) {
        return res.status(404).json(createResponse(false, 'Event request not found'));
      }

      if (eventRequest.status !== 'open') {
        return res.status(400).json(createResponse(false, 'This request is no longer accepting offers'));
      }

      // If organizer already responded, treat as a counter-offer update
      const existingResponse = eventRequest.interestedOrganizers.find(
        org => org.organizerId.toString() === organizerId.toString()
      );

      if (existingResponse) {
        const negotiation = await AI_NegotiationLog.findOne({
          eventRequest_id: eventRequestId,
          'metadata.organizerId': organizerId.toString()
        });

        if (!negotiation) {
          return res.status(404).json(createResponse(false, 'Negotiation not found'));
        }

        const currentRound = negotiation.negotiation_round + 1;

        negotiation.negotiation_history.push({
          round:     currentRound,
          offer:     proposedBudget,
          party:     'organizer',
          message:   message || 'Counter offer',
          timestamp: new Date()
        });

        negotiation.negotiation_round = currentRound;
        negotiation.status = 'pending';
        await negotiation.save();

        existingResponse.proposedBudget = proposedBudget;
        existingResponse.message        = message || existingResponse.message;
        existingResponse.status         = 'pending';
        await eventRequest.save();

        return res.json(createResponse(true, 'Counter offer submitted successfully', {
          negotiation: {
            id:     negotiation._id,
            round:  negotiation.negotiation_round,
            status: negotiation.status
          }
        }));
      }

      // ── First-time offer ──────────────────────────────────────────────────

      eventRequest.interestedOrganizers.push({
        organizerId,
        message:        message || 'I am interested in organizing your event',
        status:         'pending',
        proposedBudget: proposedBudget || null,
        responseDate:   new Date()
      });

      await eventRequest.save();

      // Resolve / create an AI agent
      let aiAgent = await AI_Agent.findOne({ role: 'negotiator', status: 'active' });

      if (!aiAgent) {
        aiAgent = await AI_Agent.findOne({ agent_type: 'organizer', status: 'active' });
      }

      if (!aiAgent) {
        try {
          aiAgent = await AI_Agent.create({
            name:         'Event Request Negotiation Agent',
            role:         'negotiator',
            agent_type:   'organizer',
            capabilities: {
              functions:   ['price_negotiation', 'counter_offer', 'market_analysis'],
              description: 'Handles event request price negotiations',
              version:     '1.0.0'
            },
            status: 'active'
          });
          console.log('✅ Created new AI Negotiation Agent with ID:', aiAgent._id);
        } catch (createError) {
          console.error('❌ Failed to create AI agent:', createError.message);
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
        eventRequest_id:     eventRequestId,
        agent_id:            aiAgent._id,
        negotiation_type:    'event_request',
        initial_offer:       proposedBudget || 0,
        status:              'pending',
        negotiation_round:   1,
        negotiation_history: [{
          round:     1,
          offer:     proposedBudget || 0,
          party:     'organizer',
          message:   message || 'Initial offer',
          timestamp: new Date()
        }],
        metadata: {
          eventType:   eventRequest.eventType,
          location:    eventRequest.venue,
          userBudget:  eventRequest.budget,
          organizerId: organizerId.toString(),
          userId:      eventRequest.userId.toString()
        }
      });

      // Attach negotiation ID to the organizer's interestedOrganizers entry
      const organizerEntry = eventRequest.interestedOrganizers.find(
        org => org.organizerId.toString() === organizerId.toString()
      );

      if (organizerEntry) {
        organizerEntry.negotiationId = negotiationLog._id;
        await eventRequest.save();
      }

      console.log('✅ Negotiation log created with ID:', negotiationLog._id);

      // Notify the AI service (non-critical)
      if (process.env.AI_ENABLED === 'true') {
        try {
          await axios.post(
            `${process.env.AI_AGENT_URL || 'http://localhost:3002'}/api/negotiation/event-request/start`,
            {
              eventRequestId,
              organizerId,
              organizerOffer:   proposedBudget,
              organizerMessage: message,
              negotiationLogId: negotiationLog._id,
              eventDetails: {
                eventType: eventRequest.eventType,
                location:  eventRequest.venue,
                budget:    eventRequest.budget,
                date:      eventRequest.date
              }
            }
          ).catch(err => console.log('AI service notification failed (non-critical):', err.message));
        } catch (aiError) {
          console.error('Failed to notify AI service:', aiError.message);
        }
      }

      // Notify user
      let userRoleId = null;
      try {
        const Role    = mongoose.model('Role');
        const userRole = await Role.findOne({ role_Name: 'User' });
        userRoleId = userRole?._id;
      } catch {
        console.log('Could not find User role, using fallback');
      }

      await Notification.create({
        userId:         eventRequest.userId,
        forRole:        userRoleId,
        type:           'new_event_request',
        eventRequestId: eventRequest._id,
        message:        `An organizer has shown interest in your ${eventRequest.eventType} event with an offer of NPR ${proposedBudget?.toLocaleString() || 'to be discussed'}`,
        status:         'unread',
        metadata: {
          organizerId:   organizerId.toString(),
          proposedBudget,
          message,
          negotiationId: negotiationLog._id
        }
      });

      // WebSocket notification to user
      if (global.wsManager) {
        global.wsManager.sendToUser(eventRequest.userId.toString(), {
          type:   'negotiation',
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
          id:     eventRequest._id,
          status: eventRequest.status
        },
        offer:       eventRequest.interestedOrganizers[eventRequest.interestedOrganizers.length - 1],
        negotiation: {
          id:     negotiationLog._id,
          status: negotiationLog.status,
          round:  negotiationLog.negotiation_round
        }
      }));

    } catch (error) {
      console.error('❌ Start negotiation error:', error);
      res.status(500).json(createResponse(false, 'Failed to start negotiation', null, error.message));
    }
  }

  // ============ SUBMIT COUNTER OFFER (user → organizer) ============
  async submitCounterOffer(req, res) {
    try {
      const { negotiationId } = req.params;
      const { counterOffer, message } = req.body;
      const userId = req.user._id;

      console.log('📝 Submitting counter for negotiation:', negotiationId);
      console.log('Counter offer:', counterOffer);

      const negotiation = await AI_NegotiationLog.findById(negotiationId);
      if (!negotiation) {
        return res.status(404).json(createResponse(false, 'Negotiation not found'));
      }

      console.log('Negotiation found:', {
        id:             negotiation._id,
        eventRequestId: negotiation.eventRequest_id,
        initial_offer:  negotiation.initial_offer,
        status:         negotiation.status
      });

      const eventRequest = await EventRequest.findById(negotiation.eventRequest_id);
      if (!eventRequest) {
        return res.status(404).json(createResponse(false, 'Event request not found'));
      }

      if (eventRequest.userId.toString() !== userId.toString()) {
        return res.status(403).json(createResponse(false, 'Unauthorized'));
      }

      const organizerId = negotiation.metadata?.organizerId;
      if (!organizerId) {
        return res.status(404).json(createResponse(false, 'Organizer ID not found in negotiation'));
      }

      const organizerOffer = eventRequest.interestedOrganizers.find(
        org => org.organizerId.toString() === organizerId.toString()
      );

      if (!organizerOffer) {
        console.log('Available organizer offers:',
          eventRequest.interestedOrganizers.map(o => ({
            organizerId:    o.organizerId,
            proposedBudget: o.proposedBudget,
            status:         o.status
          }))
        );
        return res.status(404).json(createResponse(false,
          'Organizer not found. The organizer who started this negotiation is no longer in the list.'));
      }

      console.log('Found organizer:', { organizerId, proposedBudget: organizerOffer.proposedBudget });

      const currentRound = negotiation.negotiation_round + 1;

      negotiation.negotiation_history.push({
        round:     currentRound,
        offer:     counterOffer,
        party:     'user',
        message:   message || 'Counter offer',
        timestamp: new Date()
      });

      negotiation.negotiation_round = currentRound;
      negotiation.status = 'countered';
      await negotiation.save();

      // Update the organizer's subdocument to reflect the counter
      organizerOffer.proposedBudget = counterOffer;
      organizerOffer.message        = message || organizerOffer.message;
      organizerOffer.status         = 'countered';

      await eventRequest.save();

      // AI recommendation (non-critical)
      let aiResponse = null;
      if (process.env.AI_ENABLED === 'true') {
        try {
          const response = await axios.post(
            `${process.env.AI_AGENT_URL || 'http://localhost:3002'}/api/negotiation/counter`,
            {
              eventRequestId:  eventRequest._id,
              userOffer:       counterOffer,
              organizerOffer:  organizerOffer.proposedBudget,
              eventType:       eventRequest.eventType,
              location:        eventRequest.venue || eventRequest.location || 'kathmandu',
              currentRound
            },
            { timeout: 3000 }
          );
          aiResponse = response.data;
          console.log('AI response received:', aiResponse);
        } catch (aiError) {
          console.error('Failed to get AI counter:', aiError.message);
          const midPoint = Math.round((counterOffer + organizerOffer.proposedBudget) / 2);
          aiResponse = {
            success: true,
            data: {
              aiOffer:    midPoint,
              message:    "Based on both offers, here's a balanced counter-proposal.",
              accepted:   false,
              finalOffer: Math.abs(counterOffer - organizerOffer.proposedBudget) < 10000
            }
          };
        }
      }

      // Notify organizer
      try {
        await Notification.create({
          userId:         organizerId,
          type:           'event_response',
          eventRequestId: eventRequest._id,
          message:        `User has sent a counter offer of NPR ${counterOffer.toLocaleString()}`,
          status:         'unread',
          metadata: {
            negotiationId:    negotiation._id,
            counterOffer,
            message,
            aiRecommendation: aiResponse?.data
          }
        });
      } catch (notifError) {
        console.error('Failed to create notification:', notifError.message);
      }

      // WebSocket
      if (global.wsManager) {
        global.wsManager.sendToUser(organizerId.toString(), {
          type:   'negotiation',
          action: 'counter_received',
          payload: {
            eventRequestId:  eventRequest._id,
            negotiationId:   negotiation._id,
            counterOffer,
            message,
            round:           currentRound,
            aiRecommendation: aiResponse?.data
          }
        });
      }

      res.json(createResponse(true, 'Counter offer submitted successfully', {
        negotiation: {
          id:     negotiation._id,
          round:  negotiation.negotiation_round,
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

      const isUser      = eventRequest.userId.toString() === userId.toString();
      const isOrganizer = negotiation.metadata.organizerId === userId.toString();

      if (!isUser && !isOrganizer) {
        return res.status(403).json(createResponse(false, 'Unauthorized'));
      }

      // The last history entry is the offer being accepted
      const lastOffer = negotiation.negotiation_history[negotiation.negotiation_history.length - 1];

      // Mark negotiation as accepted
      negotiation.status      = 'accepted';
      negotiation.final_offer = lastOffer.offer;
      await negotiation.save();

      // Get role IDs for notifications
      const Role          = mongoose.model('Role');
      const organizerRole = await Role.findOne({ role_Name: 'Organizer' }).lean();
      const userRole      = await Role.findOne({ role_Name: 'User' }).lean();

      // ── Helper: normalize an organizerId to a plain string ──────────────
      // org.organizerId can be either a populated User object OR a raw ObjectId
      // after a plain findById (no populate). Both cases must compare correctly
      // against negotiation.metadata.organizerId which is always a string.
      const toStr = (v) =>
        v?._id ? v._id.toString() : v ? v.toString() : '';

      const winnerOrgId = (negotiation.metadata.organizerId || '').toString();

      if (isUser) {
        // ── USER accepts the organizer's offer ─────────────────────────────

        // Mark the winner as accepted, all others rejected
        eventRequest.interestedOrganizers.forEach(org => {
          org.status = toStr(org.organizerId) === winnerOrgId ? 'accepted' : 'rejected';
        });

        // CRITICAL: mark event as deal_done so the organizer's "Won" query matches
        eventRequest.status = 'deal_done';

        await eventRequest.save();

        await Notification.create({
          userId:         winnerOrgId,
          forRole:        organizerRole?._id,
          type:           'new_event_request',
          eventRequestId: eventRequest._id,
          message:        `🎉 Your Offer Has Been Accepted! User accepted your offer of NPR ${lastOffer.offer.toLocaleString()}`,
          status:         'unread',
          metadata: {
            negotiationId: negotiation._id,
            finalAmount:   lastOffer.offer,
            acceptedBy:    'user'
          }
        });

      } else {
        // ── ORGANIZER accepts the user's counter-offer ─────────────────────

        // Mark the winner as accepted, all others rejected
        eventRequest.interestedOrganizers.forEach(org => {
          org.status = toStr(org.organizerId) === winnerOrgId ? 'accepted' : 'rejected';
        });

        // CRITICAL: mark event as deal_done — previously missing in organizer branch
        eventRequest.status = 'deal_done';

        await eventRequest.save();

        await Notification.create({
          userId:         eventRequest.userId,
          forRole:        userRole?._id,
          type:           'new_event_request',
          eventRequestId: eventRequest._id,
          message:        `🎉 Organizer Accepted Your Counter Offer! Your offer of NPR ${lastOffer.offer.toLocaleString()} was accepted`,
          status:         'unread',
          metadata: {
            negotiationId: negotiation._id,
            finalAmount:   lastOffer.offer,
            acceptedBy:    'organizer'
          }
        });
      }

      // WebSocket — notify both parties
      if (global.wsManager) {
        global.wsManager.sendToUser(eventRequest.userId.toString(), {
          type:   'negotiation',
          action: 'offer_accepted',
          payload: {
            eventRequestId: eventRequest._id,
            negotiationId:  negotiation._id,
            finalAmount:    lastOffer.offer,
            acceptedBy:     isUser ? 'user' : 'organizer'
          }
        });

        global.wsManager.sendToUser(negotiation.metadata.organizerId, {
          type:   'negotiation',
          action: 'offer_accepted',
          payload: {
            eventRequestId: eventRequest._id,
            negotiationId:  negotiation._id,
            finalAmount:    lastOffer.offer,
            acceptedBy:     isUser ? 'user' : 'organizer'
          }
        });
      }

      res.json(createResponse(true, 'Offer accepted successfully', {
        negotiation,
        eventRequest: {
          id:     eventRequest._id,
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

      const isUser      = eventRequest.userId.toString() === userId.toString();
      const isOrganizer = negotiation.metadata.organizerId === userId.toString();

      if (!isUser && !isOrganizer) {
        return res.status(403).json(createResponse(false, 'Unauthorized'));
      }

      const Role          = mongoose.model('Role');
      const organizerRole = await Role.findOne({ role_Name: 'Organizer' }).lean();
      const userRole      = await Role.findOne({ role_Name: 'User' }).lean();

      const lastOffer = negotiation.negotiation_history[negotiation.negotiation_history.length - 1];

      negotiation.status = 'rejected';
      await negotiation.save();

      if (isUser) {
        // User rejected the organizer's offer — notify organizer
        await Notification.create({
          userId:         negotiation.metadata.organizerId,
          forRole:        organizerRole._id,
          type:           'offer_rejected',
          eventRequestId: eventRequest._id,
          message:        `❌ Your offer of NPR ${lastOffer.offer.toLocaleString()} was rejected by the user`,
          status:         'unread',
          metadata: {
            negotiationId:  negotiation._id,
            rejectedAmount: lastOffer.offer,
            rejectedBy:     'user',
            reason:         req.body.reason || 'User rejected the offer'
          }
        });

        // Also notify user (for their records)
        await Notification.create({
          userId:         eventRequest.userId,
          forRole:        userRole._id,
          type:           'offer_rejected',
          eventRequestId: eventRequest._id,
          message:        `❌ You rejected the organizer's offer of NPR ${lastOffer.offer.toLocaleString()}`,
          status:         'unread',
          metadata: {
            negotiationId:  negotiation._id,
            rejectedAmount: lastOffer.offer,
            rejectedBy:     'user'
          }
        });

      } else {
        // Organizer rejected the user's counter — notify user
        await Notification.create({
          userId:         eventRequest.userId,
          forRole:        userRole._id,
          type:           'offer_rejected',
          eventRequestId: eventRequest._id,
          message:        `❌ Your counter offer of NPR ${lastOffer.offer.toLocaleString()} was rejected by the organizer`,
          status:         'unread',
          metadata: {
            negotiationId:  negotiation._id,
            rejectedAmount: lastOffer.offer,
            rejectedBy:     'organizer',
            reason:         req.body.reason || 'Organizer rejected the counter offer'
          }
        });

        // Also notify organizer (for their records)
        await Notification.create({
          userId:         negotiation.metadata.organizerId,
          forRole:        organizerRole._id,
          type:           'offer_rejected',
          eventRequestId: eventRequest._id,
          message:        `❌ You rejected the user's counter offer of NPR ${lastOffer.offer.toLocaleString()}`,
          status:         'unread',
          metadata: {
            negotiationId:  negotiation._id,
            rejectedAmount: lastOffer.offer,
            rejectedBy:     'organizer'
          }
        });
      }

      // WebSocket — notify both parties
      if (global.wsManager) {
        global.wsManager.sendToUser(eventRequest.userId.toString(), {
          type:   'negotiation',
          action: 'offer_rejected',
          payload: {
            eventRequestId: eventRequest._id,
            negotiationId:  negotiation._id,
            rejectedAmount: lastOffer.offer,
            rejectedBy:     isUser ? 'user' : 'organizer',
            message:        isUser ? 'You rejected the offer' : 'Your counter offer was rejected'
          }
        });

        global.wsManager.sendToUser(negotiation.metadata.organizerId, {
          type:   'negotiation',
          action: 'offer_rejected',
          payload: {
            eventRequestId: eventRequest._id,
            negotiationId:  negotiation._id,
            rejectedAmount: lastOffer.offer,
            rejectedBy:     isUser ? 'user' : 'organizer',
            message:        isUser ? 'Your offer was rejected' : 'You rejected the counter offer'
          }
        });
      }

      res.json(createResponse(true, 'Offer rejected successfully', {
        negotiation,
        eventRequest: {
          id:     eventRequest._id,
          status: eventRequest.status
        },
        rejectedAmount: lastOffer.offer
      }));

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

      const isAuthorized =
        eventRequest.userId._id.toString() === userId.toString() ||
        negotiation.metadata.organizerId   === userId.toString();

      if (!isAuthorized) {
        return res.status(403).json(createResponse(false, 'Unauthorized'));
      }

      res.json(createResponse(true, 'Negotiation retrieved', {
        negotiation,
        eventRequest: {
          id:        eventRequest._id,
          eventType: eventRequest.eventType,
          venue:     eventRequest.venue,
          budget:    eventRequest.budget,
          date:      eventRequest.date,
          status:    eventRequest.status,
          user:      eventRequest.userId
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

      const isUser      = eventRequest.userId.toString() === userId.toString();
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
        return res.status(400).json(createResponse(
          false,
          'Event type, location, and budget are required'
        ));
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

      // Fallback if AI unavailable
      if (!analysis) {
        const basePrices = {
          wedding:    500000,
          birthday:    75000,
          corporate:  200000,
          conference: 150000,
          party:       50000,
          workshop:    80000,
          seminar:    100000,
          festival:   300000,
          engagement: 300000
        };

        const locationMultipliers = {
          kathmandu:  1.3,
          lalitpur:   1.2,
          bhaktapur:  1.2,
          pokhara:    1.1,
          chitwan:    1.0,
          biratnagar: 0.9
        };

        const basePrice      = basePrices[eventType.toLowerCase()] || 100000;
        const multiplier     = locationMultipliers[location.toLowerCase()] || 1.0;
        const estimatedPrice = Math.round(basePrice * multiplier);
        const minReasonable  = Math.round(estimatedPrice * 0.7);
        const maxReasonable  = Math.round(estimatedPrice * 1.5);
        const isReasonable   = budget >= minReasonable && budget <= maxReasonable;

        analysis = {
          success: true,
          data: {
            userBudget:           parseFloat(budget),
            estimatedMarketPrice: estimatedPrice,
            isReasonable,
            minReasonable,
            maxReasonable,
            suggestion: isReasonable
              ? 'Budget is within market range'
              : budget < minReasonable
                ? `Consider increasing budget to at least NPR ${minReasonable.toLocaleString()}`
                : 'Budget is above market average, you can negotiate'
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

      const negotiation = await AI_NegotiationLog.findOne({
        eventRequest_id: eventRequestId,
        status: 'pending'
      }).sort({ createdAt: -1 });

      if (negotiation) {
        negotiation.metadata = {
          ...negotiation.metadata,
          aiResponse:    response,
          aiRespondedAt: new Date()
        };
        await negotiation.save();
      }

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