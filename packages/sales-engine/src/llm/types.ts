/**
 * LLM Provider Types
 */

export interface LLMProviderConfig {
  apiKey: string;
  model: string;
  maxRetries?: number;
  timeout?: number;
}

export interface LLMRequest {
  systemPrompt: string;
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface LLMResponse {
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason: 'stop' | 'length' | 'content_filter' | 'error';
}

/**
 * Structured response from LLM including state transition evaluation
 * Used for conversation engine to get both response and transition decision
 */
export interface StructuredLLMResponse extends LLMResponse {
  /** The conversational response to send to the user (backwards compat) */
  response: string;
  
  /** Array of 2-4 short messages to send sequentially */
  responses?: string[];
  
  /** State transition evaluation */
  transition?: {
    /** Target state to transition to */
    to: string;
    /** Why the LLM recommends this transition */
    reason: string;
    /** Confidence level 0-1 */
    confidence: number;
  };
  
  /** Extracted user data from the conversation */
  extractedData?: {
    /** User's name if mentioned */
    userName?: string;
    /** User's email if provided */
    email?: string;
    /** Whether user has trading experience */
    hasExperience?: boolean;
    /** Detected interest level */
    interestLevel?: 'high' | 'medium' | 'low';
    /** Any specific concerns or objections */
    concerns?: string[];
  };
  
  /** Whether the LLM is uncertain and might need escalation */
  isUncertain?: boolean;
}

export interface LLMProvider {
  readonly name: string;
  generateResponse(request: LLMRequest): Promise<LLMResponse>;
}

export interface EmbeddingOptions {
  taskType?: string;
}

export interface EmbeddingProvider {
  generateEmbedding(text: string, options?: EmbeddingOptions): Promise<number[]>;
  readonly dimensions: number;
}

export interface EmbeddingProviderConfig {
  apiKey: string;
  model?: string;
}
