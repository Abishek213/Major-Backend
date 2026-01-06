import AI_Agent from "../model/ai_agent.schema.js";

const aiAgents = [
  {
    name: "Eventa-Recommendation-Assistant",
    role: "assistant",
    agent_type: "user",
    capabilities: {
      recommendation: true,
      personalization: true,
      user_preferences: true,
    },
    status: "active",
  },
  {
    name: "Eventa-Fraud-Detector",
    role: "moderator",
    agent_type: "admin",
    capabilities: {
      fraud_detection: true,
      risk_assessment: true,
      pattern_recognition: true,
    },
    status: "active",
  },
  {
    name: "Eventa-Sentiment-Analyzer",
    role: "analyst",
    agent_type: "admin",
    capabilities: {
      sentiment_analysis: true,
      text_processing: true,
      issue_detection: true,
    },
    status: "active",
  },
  {
    name: "Eventa-Negotiation-Assistant",
    role: "negotiator",
    agent_type: "organizer",
    capabilities: {
      price_negotiation: true,
      date_negotiation: true,
      terms_negotiation: true,
    },
    status: "active",
  },
];

async function seedAIAgents() {
  try {
    // Clear existing agents
    await AI_Agent.deleteMany({});

    // Create new agents
    const createdAgents = await AI_Agent.insertMany(aiAgents);

    console.log(`Seeded ${createdAgents.length} AI agents`);
    return createdAgents;
  } catch (error) {
    console.error("Error seeding AI agents:", error);
  }
}

// Add to your existing seeders
export default seedAIAgents;
