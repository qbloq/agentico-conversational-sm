/**
 * Anthropic Claude LLM Provider
 * 
 * Secondary LLM provider for the sales engine.
 * Uses @anthropic-ai/sdk.
 */

import type { LLMProvider, LLMProviderConfig, LLMRequest, LLMResponse } from './types.js';

/**
 * Create an Anthropic Claude provider
 */
export function createAnthropicProvider(config: LLMProviderConfig): LLMProvider {
  let Anthropic: typeof import('@anthropic-ai/sdk').default;
  
  return {
    name: 'anthropic',
    
    async generateResponse(request: LLMRequest): Promise<LLMResponse> {
      // Dynamic import for optional dependency
      if (!Anthropic) {
        try {
          const module = await import('@anthropic-ai/sdk');
          Anthropic = module.default;
        } catch {
          throw new Error(
            'Anthropic provider requires @anthropic-ai/sdk package. ' +
            'Install it with: pnpm add @anthropic-ai/sdk'
          );
        }
      }
      
      const client = new Anthropic({ apiKey: config.apiKey });
      
      // Convert messages to Anthropic format
      const messages = request.messages
        .filter(m => m.role !== 'system')
        .map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));
      
      const response = await client.messages.create({
        model: config.model || 'claude-sonnet-4-20250514',
        max_tokens: request.maxTokens ?? 1024,
        system: request.systemPrompt,
        messages,
      });
      
      // Extract text content
      const textContent = response.content.find(c => c.type === 'text');
      const text = textContent?.type === 'text' ? textContent.text : '';
      
      return {
        content: text,
        usage: {
          promptTokens: response.usage.input_tokens,
          completionTokens: response.usage.output_tokens,
          totalTokens: response.usage.input_tokens + response.usage.output_tokens,
        },
        finishReason: mapFinishReason(response.stop_reason),
      };
    },

    async generateContent(prompt: string, options?: { temperature?: number; maxTokens?: number }): Promise<LLMResponse> {
      if (!Anthropic) {
        const module = await import('@anthropic-ai/sdk');
        Anthropic = module.default;
      }
      const client = new Anthropic({ apiKey: config.apiKey });
      const response = await client.messages.create({
        model: config.model || 'claude-sonnet-4-20250514',
        max_tokens: options?.maxTokens ?? 1024,
        messages: [{ role: 'user', content: prompt }],
      });
      const textContent = response.content.find(c => c.type === 'text');
      const text = textContent?.type === 'text' ? textContent.text : '';
      return {
        content: text,
        usage: {
          promptTokens: response.usage.input_tokens,
          completionTokens: response.usage.output_tokens,
          totalTokens: response.usage.input_tokens + response.usage.output_tokens,
        },
        finishReason: mapFinishReason(response.stop_reason),
      };
    }
  };
}


/**
 * Map Anthropic stop reason to our standard format
 */
function mapFinishReason(reason: string | null): LLMResponse['finishReason'] {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'max_tokens':
      return 'length';
    default:
      return 'stop';
  }
}
