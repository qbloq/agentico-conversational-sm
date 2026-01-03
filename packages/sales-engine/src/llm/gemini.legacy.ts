/**
 * Google Gemini LLM Provider
 * 
 * Primary LLM provider for the sales engine.
 * Uses @google/generative-ai SDK.
 */

import { GoogleGenAI } from "@google/genai";
import type { LLMProvider, LLMProviderConfig, LLMRequest, LLMResponse } from './types.js';

/**
 * Create a Gemini LLM provider
 */
export function createGeminiProvider(config: LLMProviderConfig): LLMProvider {
  // Lazy load the SDK to make it optional
  let GoogleGenerativeAI: typeof import('@google/generative-ai').GoogleGenerativeAI;
  
  return {
    name: 'gemini',
    
    async generateResponse(request: LLMRequest): Promise<LLMResponse> {
      // Dynamic import for optional dependency
      let HarmCategory, HarmBlockThreshold;
      
      if (!GoogleGenerativeAI) {
        try {
          const module = await import('@google/generative-ai');
          GoogleGenerativeAI = module.GoogleGenerativeAI;
          HarmCategory = module.HarmCategory;
          HarmBlockThreshold = module.HarmBlockThreshold;
        } catch {
          throw new Error(
            'Gemini provider requires @google/generative-ai package. ' +
            'Install it with: pnpm add @google/generative-ai'
          );
        }
      } else {
         // Re-import to get enums if already loaded (or store them on module scope previously, but this is safer for now)
          const module = await import('@google/generative-ai');
          HarmCategory = module.HarmCategory;
          HarmBlockThreshold = module.HarmBlockThreshold;
      }
      
      const genAI = new GoogleGenerativeAI(config.apiKey);
      const model = genAI.getGenerativeModel({ 
        model: config.model || 'gemini-2.5-flash',
      });
      
      // Build conversation history for Gemini format
      const fullHistory = request.messages
        .filter(m => m.role !== 'system')
        .map(m => ({
          role: m.role === 'user' ? 'user' as const : 'model' as const,
          parts: [{ text: m.content }],
        }));
      
      // Get the last user message
      const lastUserMessage = request.messages
        .filter(m => m.role === 'user')
        .pop();
      
      if (!lastUserMessage) {
        throw new Error('No user message found in request');
      }
      
      // Prepare history for startChat (exclude last message)
      let chatHistory = fullHistory.slice(0, -1);
      
      // Gemini requires history to start with 'user' role
      // If history starts with 'model', remove it
      while (chatHistory.length > 0 && chatHistory[0].role === 'model') {
        chatHistory.shift();
      }
      
      // Start chat with system instruction
      const chat = model.startChat({
        history: chatHistory,
        generationConfig: {
          temperature: request.temperature ?? 0.7,
          maxOutputTokens: request.maxTokens ?? 1024,
        },
        safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        ],
        systemInstruction: {
          role: 'system',
          parts: [{ text: request.systemPrompt }]
        },
      });
      
      // Send message and get response
      const result = await chat.sendMessage(lastUserMessage.content);
      const response = result.response;
      const text = response.text();
      
      // Extract usage metadata
      const usageMetadata = response.usageMetadata;
      
      return {
        content: text,
        usage: {
          promptTokens: usageMetadata?.promptTokenCount ?? 0,
          completionTokens: usageMetadata?.candidatesTokenCount ?? 0,
          totalTokens: usageMetadata?.totalTokenCount ?? 0,
        },
        finishReason: mapFinishReason(response.candidates?.[0]?.finishReason),
      };
    },

    /**
     * General content generation for a single prompt
     */
    async generateContent(prompt: string, options?: { temperature?: number; maxTokens?: number }): Promise<LLMResponse> {
      if (!GoogleGenerativeAI) {
        try {
          const module = await import('@google/generative-ai');
          GoogleGenerativeAI = module.GoogleGenerativeAI;
        } catch {
          throw new Error(
            'Gemini provider requires @google/generative-ai package. ' +
            'Install it with: pnpm add @google/generative-ai'
          );
        }
      }
      
      const genAI = new GoogleGenerativeAI(config.apiKey);
      const model = genAI.getGenerativeModel({ 
        model: config.model || 'gemini-2.5-flash',
      });

      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: options?.temperature ?? 0.7,
          maxOutputTokens: options?.maxTokens ?? 1024,
        },
      });

      const response = result.response;
      const text = response.text();
      
      return {
        content: text,
        usage: {
          promptTokens: response.usageMetadata?.promptTokenCount ?? 0,
          completionTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
          totalTokens: response.usageMetadata?.totalTokenCount ?? 0,
        },
        finishReason: mapFinishReason(response.candidates?.[0]?.finishReason),
      };
    },

    async generateContentWithFileSearch(): Promise<LLMResponse> {
      throw new Error('File Search not implemented for Legacy Gemini provider');
    },

    async generateResponseWithFileSearch(): Promise<LLMResponse> {
      throw new Error('File Search not implemented for Legacy Gemini provider');
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
      const genAI = new GoogleGenAI({ apiKey: config.apiKey });
      const result = await genAI.models.embedContent({ 
        model: 'gemini-embedding-001',
        contents: text,
        config: { outputDimensionality: 768, taskType: options?.taskType },
      });
      
      return result.embeddings?.[0].values || [];
    },
  };
}
