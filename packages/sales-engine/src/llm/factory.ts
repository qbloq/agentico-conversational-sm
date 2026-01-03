/**
 * LLM Provider Factory
 * 
 * Creates LLM providers based on configuration.
 * Supports fallback providers for reliability.
 */

import type { LLMProvider, LLMProviderConfig, EmbeddingProvider, EmbeddingProviderConfig } from './types.js';
import { createGeminiProvider, createGeminiEmbeddingProvider } from './gemini.js';
import { createAnthropicProvider } from './anthropic.js';
import { createOpenAIProvider, createOpenAIEmbeddingProvider } from './openai.js';

export type ProviderType = 'gemini' | 'anthropic' | 'openai';

export interface LLMFactoryConfig {
  provider: ProviderType;
  apiKey: string;
  model?: string;
  fallbackProvider?: ProviderType;
  fallbackApiKey?: string;
  fallbackModel?: string;
}

/**
 * Create an LLM provider based on configuration
 */
export function createLLMProvider(config: LLMFactoryConfig): LLMProvider {
  const providerConfig: LLMProviderConfig = {
    apiKey: config.apiKey,
    model: config.model || getDefaultModel(config.provider),
  };
  
  const primaryProvider = createProviderByType(config.provider, providerConfig);
  
  // If no fallback configured, return primary
  if (!config.fallbackProvider || !config.fallbackApiKey) {
    return primaryProvider;
  }
  
  // Create fallback provider
  const fallbackConfig: LLMProviderConfig = {
    apiKey: config.fallbackApiKey,
    model: config.fallbackModel || getDefaultModel(config.fallbackProvider),
  };
  const fallbackProvider = createProviderByType(config.fallbackProvider, fallbackConfig);
  
  // Return provider with fallback logic
  return createProviderWithFallback(primaryProvider, fallbackProvider);
}

/**
 * Create an embedding provider based on type
 */
export function createEmbeddingProvider(
  type: 'openai' | 'gemini',
  config: EmbeddingProviderConfig
): EmbeddingProvider {
  switch (type) {
    case 'openai':
      return createOpenAIEmbeddingProvider(config);
    case 'gemini':
      return createGeminiEmbeddingProvider(config);
    default:
      throw new Error(`Unknown embedding provider type: ${type}`);
  }
}

function createProviderByType(type: ProviderType, config: LLMProviderConfig): LLMProvider {
  switch (type) {
    case 'gemini':
      return createGeminiProvider(config);
    case 'anthropic':
      return createAnthropicProvider(config);
    case 'openai':
      return createOpenAIProvider(config);
    default:
      throw new Error(`Unknown LLM provider type: ${type}`);
  }
}

function getDefaultModel(type: ProviderType): string {
  switch (type) {
    case 'gemini':
      return 'gemini-2.5-flash';
    case 'anthropic':
      return 'claude-sonnet-4-20250514';
    case 'openai':
      return 'gpt-4o';
    default:
      return 'gemini-2.0-flash';
  }
}

function createProviderWithFallback(
  primary: LLMProvider,
  fallback: LLMProvider
): LLMProvider {
  return {
    name: `${primary.name}+${fallback.name}`,
    
    async generateResponse(request) {
      try {
        return await primary.generateResponse(request);
      } catch (error) {
        console.warn(`Primary provider (${primary.name}) failed, falling back to ${fallback.name}:`, error);
        return await fallback.generateResponse(request);
      }
    },

    async generateContent(prompt, options) {
      try {
        return await primary.generateContent(prompt, options);
      } catch (error) {
        console.warn(`Primary provider (${primary.name}) failed, falling back to ${fallback.name}:`, error);
        return await fallback.generateContent(prompt, options);
      }
    },

    async generateContentWithFileSearch(request) {
      try {
        return await primary.generateContentWithFileSearch(request);
      } catch (error) {
        console.warn(`Primary provider (${primary.name}) failed, falling back to ${fallback.name}:`, error);
        return await fallback.generateContentWithFileSearch(request);
      }
    },

    async generateResponseWithFileSearch(request) {
      try {
        return await primary.generateResponseWithFileSearch(request);
      } catch (error) {
        console.warn(`Primary provider (${primary.name}) failed, falling back to ${fallback.name}:`, error);
        return await fallback.generateResponseWithFileSearch(request);
      }
    },
  };
}
