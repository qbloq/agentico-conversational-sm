/**
 * Google Gemini LLM Provider
 * 
 * Primary LLM provider for the sales engine.
 * Uses @google/genai SDK.
 */

import { GoogleGenAI } from "@google/genai";
import type { LLMProvider, LLMProviderConfig, LLMRequest, LLMResponse } from './types.js';

/**
 * Create a Gemini LLM provider
 */
export function createGeminiProvider(config: LLMProviderConfig): LLMProvider {
  const client = new GoogleGenAI({ apiKey: config.apiKey });
  const modelId = config.model || 'gemini-2.5-flash';

  return {
    name: 'gemini',
    
    /**
     * Chat-based response generation
     */
    async generateResponse(request: LLMRequest): Promise<LLMResponse> {
      // Build conversation content for Gemini format
      // Note: @google/genai uses 'contents' array with 'role' and 'parts'
      const contents = request.messages
        .filter(m => m.role !== 'system')
        .map(m => ({
          role: m.role === 'user' ? 'user' : 'model',
          parts: [{ text: m.content }],
        }));

      const response = await client.models.generateContent({
        model: modelId,
        contents,
        config: {
          systemInstruction: request.systemPrompt,
          temperature: request.temperature ?? 0.7,
          maxOutputTokens: request.maxTokens ?? 1024,
        }
      });

      return {
        content: response.text || '',
        usage: {
          promptTokens: response.usageMetadata?.promptTokenCount ?? 0,
          completionTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
          totalTokens: response.usageMetadata?.totalTokenCount ?? 0,
        },
        finishReason: mapFinishReason(response.candidates?.[0]?.finishReason),
      };
    },

    /**
     * General content generation for a single prompt
     */
    async generateContent(prompt: string, options?: { temperature?: number; maxTokens?: number }): Promise<LLMResponse> {
      const response = await client.models.generateContent({
        model: modelId,
        contents: prompt,
        config: {
          temperature: options?.temperature ?? 0.7,
          maxOutputTokens: options?.maxTokens ?? 1024,
        }
      });

      return {
        content: response.text || '',
        usage: {
          promptTokens: response.usageMetadata?.promptTokenCount ?? 0,
          completionTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
          totalTokens: response.usageMetadata?.totalTokenCount ?? 0,
        },
        finishReason: mapFinishReason(response.candidates?.[0]?.finishReason),
      };
    }
  };
}

/**
 * Map Gemini finish reason to our standard format
 */
function mapFinishReason(reason?: string): LLMResponse['finishReason'] {
  switch (reason) {
    case 'STOP':
      return 'stop';
    case 'MAX_TOKENS':
      return 'length';
    case 'SAFETY':
    case 'RECITATION':
      return 'content_filter';
    default:
      return 'stop';
  }
}

/**
 * Gemini embedding provider
 */
export function createGeminiEmbeddingProvider(config: { apiKey: string }): {
  generateEmbedding: (text: string, options?: { taskType?: string }) => Promise<number[]>;
  dimensions: number;
} {
  return {
    dimensions: 1536, // Gemini embedding dimension
    
    async generateEmbedding(text: string, options?: { taskType?: string }): Promise<number[]> {
      const client = new GoogleGenAI({ apiKey: config.apiKey });
      const result = await client.models.embedContent({ 
        model: 'gemini-embedding-001',
        contents: text,
        config: { outputDimensionality: 1536, taskType: options?.taskType },
      });
      
      return result.embeddings?.[0].values || [];
    },
  };
}
