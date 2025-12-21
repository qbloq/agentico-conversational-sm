/**
 * Conversation Engine Retry Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { createConversationEngine } from '../src/engine/conversation.js';
import type {
  SessionKey,
  NormalizedMessage,
  EngineDependencies,
  Contact,
  Session,
  Message,
} from '../src/engine/types.js';

// Mock implementations
const mockContact: Contact = {
  id: 'contact-1',
  firstName: 'Juan',
  lastName: 'García',
  language: 'es',
  hasRegistered: false,
  depositConfirmed: false,
  lifetimeValue: 0,
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockSession: Session = {
  id: 'session-1',
  contactId: 'contact-1',
  channelType: 'whatsapp',
  channelId: 'phone-123',
  channelUserId: 'wa-user-456',
  currentState: 'initial',
  context: {},
  status: 'active',
  isEscalated: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function createMockDeps(): EngineDependencies {
  return {
    contactStore: {
      findOrCreateByChannelUser: vi.fn().mockResolvedValue(mockContact),
      findById: vi.fn().mockResolvedValue(mockContact),
      update: vi.fn().mockResolvedValue(mockContact),
    } as any,
    sessionStore: {
      findByKey: vi.fn().mockResolvedValue(mockSession),
      findById: vi.fn().mockResolvedValue(mockSession),
      create: vi.fn().mockResolvedValue(mockSession),
      update: vi.fn().mockResolvedValue(mockSession),
    } as any,
    messageStore: {
      getRecent: vi.fn().mockResolvedValue([]),
      save: vi.fn().mockResolvedValue({} as Message),
    } as any,
    llmProvider: {
      name: 'mock',
      generateResponse: vi.fn(),
    } as any,
    embeddingProvider: {
      generateEmbedding: vi.fn().mockResolvedValue(new Array(1536).fill(0)),
      dimensions: 1536,
    } as any,
    knowledgeStore: {
      findSimilar: vi.fn().mockResolvedValue([]),
      findByCategory: vi.fn().mockResolvedValue([]),
    } as any,
    mediaService: {
      transcribe: vi.fn(),
      analyzeImage: vi.fn(),
    } as any,
    notificationService: {
      sendEscalationAlert: vi.fn().mockResolvedValue(undefined),
    } as any,
    clientConfig: {
      clientId: 'tag_markets',
      llm: {
        provider: 'gemini',
        model: 'gemini-2.0-flash',
      },
      escalation: {
        enabled: true,
      },
      business: {
        name: 'TAG Markets',
        description: 'Broker de trading',
        language: 'es',
        timezone: 'America/Mexico_City',
      },
    } as any,
  };
}

describe('ConversationEngine Retry Logic', () => {
  const sessionKey: SessionKey = {
    channelType: 'whatsapp',
    channelId: 'phone-123',
    channelUserId: 'wa-user-456',
  };
  
  const message: NormalizedMessage = {
    id: 'msg-1',
    timestamp: new Date(),
    type: 'text',
    content: 'Hola',
  };

  it('should retry when LLM returns malformed JSON and succeed on second attempt', async () => {
    const engine = createConversationEngine();
    const deps = createMockDeps();
    
    // First call: Malformed JSON
    // Second call: Valid JSON
    (deps.llmProvider.generateResponse as any)
      .mockResolvedValueOnce({
        content: 'Not a JSON block',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        finishReason: 'stop',
      })
      .mockResolvedValueOnce({
        content: '```json\n{"response": "Valid JSON response", "transition": {"to": "initial", "reason": "test", "confidence": 0.9}}\n```',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        finishReason: 'stop',
      });
    
    const result = await engine.processMessage({
      sessionKey,
      message,
      deps,
    });
    
    expect(deps.llmProvider.generateResponse).toHaveBeenCalledTimes(2);
    expect(result.responses[0].content).toBe('Valid JSON response');
  });

  it('should fail after 3 attempts if LLM consistently returns malformed JSON', async () => {
    const engine = createConversationEngine();
    const deps = createMockDeps();
    
    (deps.llmProvider.generateResponse as any).mockResolvedValue({
      content: 'Still not JSON',
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      finishReason: 'stop',
    });
    
    const result = await engine.processMessage({
      sessionKey,
      message,
      deps,
    });
    
    expect(deps.llmProvider.generateResponse).toHaveBeenCalledTimes(3);
    expect(result.responses[0].content).toContain('dificultades técnicas');
  });
});
