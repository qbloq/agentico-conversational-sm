import { z } from 'zod';

/**
 * Zod schema for the structured response from the LLM.
 * Matches the StructuredLLMResponse interface and the requirements in buildSystemPrompt.
 */
export const ConversationResponseSchema = z.object({
  responses: z.array(z.string())
    .min(2, "Minimum 2 messages required")
    .max(4, "Maximum 4 messages allowed")
    .describe("An array of 2-4 short messages that will be sent sequentially to the user."),
  
  transition: z.object({
    to: z.string().describe("Target state name to transition to."),
    reason: z.string().describe("Brief explanation of why transitioning."),
    confidence: z.number().min(0).max(1).describe("Confidence level for the transition.")
  }).optional().describe("Include if recommending a state transition."),
  
  escalation: z.object({
    shouldEscalate: z.boolean().describe("Set to true if user should be transferred to a human agent."),
    reason: z.enum([
      "explicit_request", 
      "frustration", 
      "ai_uncertainty", 
      "complex_issue", 
      "legal_regulatory"
    ]).describe("The reason for escalation."),
    confidence: z.number().min(0).max(1).describe("Confidence score of the escalation decision."),
    summary: z.string().optional().describe("Brief context for the human agent.")
  }).optional().describe("Include when escalation is needed."),
  
  extractedData: z.object({
    userName: z.string().optional().describe("User's name if mentioned."),
    email: z.string().email().optional().describe("User's email if provided."),
    hasExperience: z.boolean().optional().describe("Whether user has trading experience."),
    interestLevel: z.enum(["high", "medium", "low"]).optional().describe("Detected interest level."),
    userInterest: z.string().optional().describe("What the user is interested in (e.g., copy trading, academy, specific product)."),
    concerns: z.array(z.string()).optional().describe("Any concerns or objections raised."),
    hasRegistered: z.boolean().optional().describe("If user confirms they already registered."),
    deposit: z.boolean().optional().describe("If user confirms they made a deposit."),
    depositAmount: z.number().optional().describe("The amount of the deposit if mentioned.")
  }).optional().describe("Information extracted from the user's message."),
  
  isUncertain: z.boolean().default(false).describe("Set to true if unsure about the answer and a human might help better.")
});

export type ConversationResponse = z.infer<typeof ConversationResponseSchema>;
