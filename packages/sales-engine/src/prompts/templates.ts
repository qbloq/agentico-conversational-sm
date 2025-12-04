/**
 * Prompt templates for the Sales Engine
 */

import type { ClientConfig, KnowledgeEntry, ConversationExample } from '../engine/types.js';
import { formatExamples } from '../examples/formatter.js';

export interface SystemPromptParams {
  config: ClientConfig;
  transitionContext: string;
  knowledge: KnowledgeEntry[];
  examples: ConversationExample[];
}

export function buildSystemPrompt({
  config,
  transitionContext,
  knowledge,
  examples
}: SystemPromptParams): string {
  const knowledgeContext = knowledge
    .map(k => `Q: ${k.title}\nA: ${k.summary || k.answer.slice(0, 300)}`)
    .join('\n\n');
  
  const examplesContext = examples.length > 0 
    ? formatExamples(examples, { maxMessages: 6, includeScenario: true })
    : '';
  return `# Role
You are a sales representative for ${config.business.name}. ${config.business.description}

# Language
Always respond in ${config.business.language}. Be friendly, professional, and helpful.

${transitionContext}

# Relevant Knowledge
${knowledgeContext || 'No specific knowledge retrieved for this query.'}

${examplesContext}

# Response Format
You MUST respond with a JSON object in a code block. The format is:
\`\`\`json
{
  "response": "Your conversational response to the user in ${config.business.language}",
  "transition": {
    "to": "state_name",
    "reason": "Brief explanation of why transitioning",
    "confidence": 0.8
  },
  "extractedData": {
    "userName": "if user mentioned their name",
    "email": "if user provided email",
    "hasExperience": true,
    "interestLevel": "high",
    "concerns": ["any concerns they raised"]
  },
  "isUncertain": false
}
\`\`\`

Rules for the JSON response:
- "response" is REQUIRED - this is what gets sent to the user
- "transition" is OPTIONAL - only include if you detect completion signals and recommend moving to a new state
- "extractedData" is OPTIONAL - only include fields where you extracted new information
- "isUncertain" should be true if you're not confident in your response and a human might help better
`;
}
