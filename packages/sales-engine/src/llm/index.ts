/**
 * LLM Providers
 * 
 * This module exports all LLM provider factories.
 * Import from '@parallelo/sales-engine/llm'
 */

// Types
export type {
  LLMProvider,
  LLMProviderConfig,
  LLMRequest,
  LLMMessage,
  LLMResponse,
  EmbeddingProvider,
  EmbeddingProviderConfig,
} from './types.js';

// Gemini (Primary)
export { createGeminiProvider, createGeminiEmbeddingProvider } from './gemini.js';

// Anthropic (Secondary)
export { createAnthropicProvider } from './anthropic.js';

// OpenAI (Tertiary + Embeddings)
export { createOpenAIProvider, createOpenAIEmbeddingProvider } from './openai.js';

// Factory
export { createLLMProvider, createEmbeddingProvider } from './factory.js';
