/**
 * OpenAI LLM Provider
 * 
 * Tertiary LLM provider and primary embedding provider.
 * Uses openai SDK.
 */

import type { LLMProvider, LLMProviderConfig, LLMRequest, LLMResponse, EmbeddingProvider, EmbeddingProviderConfig } from './types.js';

/**
 * Create an OpenAI provider
 */
export function createOpenAIProvider(config: LLMProviderConfig): LLMProvider {
  let OpenAI: typeof import('openai').default;
  
  return {
    name: 'openai',
    
    async generateResponse(request: LLMRequest): Promise<LLMResponse> {
      if (!OpenAI) {
        try {
          const module = await import('openai');
          OpenAI = module.default;
        } catch {
          throw new Error(
            'OpenAI provider requires openai package. Install it with: pnpm add openai'
          );
        }
      }
      
      const client = new OpenAI({ apiKey: config.apiKey });
      
      const messages = [
        { role: 'system' as const, content: request.systemPrompt },
        ...request.messages.map(m => ({
          role: m.role as 'user' | 'assistant' | 'system',
          content: m.content,
        })),
      ];
      
      const response = await client.chat.completions.create({
        model: config.model || 'gpt-4o',
        messages,
        temperature: request.temperature ?? 0.7,
        max_tokens: request.maxTokens ?? 1024,
      });
      
      const choice = response.choices[0];
      
      return {
        content: choice.message.content || '',
        usage: {
          promptTokens: response.usage?.prompt_tokens ?? 0,
          completionTokens: response.usage?.completion_tokens ?? 0,
          totalTokens: response.usage?.total_tokens ?? 0,
        },
        finishReason: mapFinishReason(choice.finish_reason),
      };
    },

    async generateContent(prompt: string, options?: { temperature?: number; maxTokens?: number }): Promise<LLMResponse> {
      if (!OpenAI) {
        const module = await import('openai');
        OpenAI = module.default;
      }
      const client = new OpenAI({ apiKey: config.apiKey });
      const response = await client.chat.completions.create({
        model: config.model || 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 1024,
      });
      const choice = response.choices[0];
      return {
        content: choice.message.content || '',
        usage: {
          promptTokens: response.usage?.prompt_tokens ?? 0,
          completionTokens: response.usage?.completion_tokens ?? 0,
          totalTokens: response.usage?.total_tokens ?? 0,
        },
        finishReason: mapFinishReason(choice.finish_reason),
      };
    }
  };
}


function mapFinishReason(reason: string | null): LLMResponse['finishReason'] {
  switch (reason) {
    case 'stop': return 'stop';
    case 'length': return 'length';
    case 'content_filter': return 'content_filter';
    default: return 'stop';
  }
}

/**
 * Create an OpenAI embedding provider (recommended for production)
 */
export function createOpenAIEmbeddingProvider(config: EmbeddingProviderConfig): EmbeddingProvider {
  let OpenAI: typeof import('openai').default;
  
  return {
    dimensions: 1536,
    
    async generateEmbedding(text: string): Promise<number[]> {
      if (!OpenAI) {
        try {
          const module = await import('openai');
          OpenAI = module.default;
        } catch {
          throw new Error(
            'OpenAI embedding provider requires openai package. Install it with: pnpm add openai'
          );
        }
      }
      
      const client = new OpenAI({ apiKey: config.apiKey });
      
      const response = await client.embeddings.create({
        model: config.model || 'text-embedding-3-small',
        input: text,
      });
      
      return response.data[0].embedding;
    },
  };
}
