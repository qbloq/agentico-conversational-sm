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

export interface LLMProvider {
  readonly name: string;
  generateResponse(request: LLMRequest): Promise<LLMResponse>;
}

export interface EmbeddingProvider {
  generateEmbedding(text: string): Promise<number[]>;
  readonly dimensions: number;
}

export interface EmbeddingProviderConfig {
  apiKey: string;
  model?: string;
}
