import { GoogleGenAI } from "@google/genai";
import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMMessage,
  LLMProviderConfig
} from "./types.js";

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
          maxOutputTokens: request.maxTokens ?? 65000,
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
    },

    /**
     * Content generation with File Search and Structured Output support
     */
    async generateContentWithFileSearch(request: {
      systemPrompt?: string;
      prompt: string;
      fileSearch: { fileSearchStoreNames: string[] };
      structuredOutput?: { responseMimeType: string; responseJsonSchema?: any };
      temperature?: number;
      maxTokens?: number;
    }): Promise<LLMResponse> {
      const response = await client.models.generateContent({
        model: modelId,
        contents: request.prompt,
        config: {
          systemInstruction: request.systemPrompt,
          temperature: request.temperature ?? 0.7,
          maxOutputTokens: request.maxTokens ?? 1500,
          tools: [
            {
              fileSearch: {
                fileSearchStoreNames: request.fileSearch.fileSearchStoreNames,
              },
            },
          ],
          responseMimeType: request.structuredOutput?.responseMimeType as any,
          responseJsonSchema: request.structuredOutput?.responseJsonSchema,
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
     * Response generation with File Search and Structured Output support for conversations
     */
    async generateResponseWithFileSearch(request: {
      systemPrompt?: string;
      messages: LLMMessage[];
      fileSearch: { fileSearchStoreNames: string[] };
      structuredOutput?: { responseMimeType: string; responseJsonSchema?: any };
      temperature?: number;
      maxTokens?: number;
    }): Promise<LLMResponse> {
      // Build conversation history for Gemini format
      const contents = request.messages
        .filter(m => m.role !== 'system')
        .map(m => ({
          role: m.role === 'user' ? 'user' : 'model',
          parts: [{ text: m.content }],
        }));

      console.log('>>>>>>>>>>>>>contents', modelId, contents);
      const response = await client.models.generateContent({
        model: modelId,
        contents,
        config: {
          systemInstruction: request.systemPrompt,
          temperature: request.temperature ?? 0.7,
          maxOutputTokens: request.maxTokens ?? 1500,
          tools: [
            {
              fileSearch: {
                fileSearchStoreNames: request.fileSearch.fileSearchStoreNames,
              },
            },
          ],
          responseMimeType: request.structuredOutput?.responseMimeType as any,
          responseJsonSchema: request.structuredOutput?.responseJsonSchema,
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
