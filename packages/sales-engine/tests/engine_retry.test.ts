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
  stateMachineId: 'sm-1',
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

const mockStateConfig = {
  initial: {
    state: 'initial',
    objective: 'Greet the user',
    description: 'Initial greeting state',
    completionSignals: ['user shows interest'],
    ragCategories: ['general'],
    allowedTransitions: ['escalated'],
    transitionGuidance: { escalated: 'When escalation needed' },
  },
  escalated: {
    state: 'escalated',
    objective: 'Session handed to human agent',
    description: 'Escalated to human',
    completionSignals: [],
    ragCategories: [],
    allowedTransitions: ['initial'],
    transitionGuidance: { initial: 'When agent resolves' },
  },
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
    stateMachineStore: {
      findByName: vi.fn().mockResolvedValue({ states: mockStateConfig, initialState: 'initial' }),
      findActive: vi.fn().mockResolvedValue({ states: mockStateConfig, initialState: 'initial' }),
      getStateMachineId: vi.fn().mockResolvedValue('sm-1'),
      getFollowupConfig: vi.fn().mockResolvedValue(null),
      getStateEntryMessages: vi.fn().mockResolvedValue(null),
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
      stateMachineName: 'tag_markets_v1',
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
    vi.useFakeTimers();
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
        content: '```json\n{"responses": ["Valid JSON response", "Second message"], "transition": {"to": "initial", "reason": "test", "confidence": 0.9}}\n```',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        finishReason: 'stop',
      });
    
    const resultPromise = engine.processMessage({
      sessionKey,
      message,
      deps,
    });

    // Advance timers to skip retry delays
    await vi.advanceTimersByTimeAsync(30000);
    
    const result = await resultPromise;
    
    expect(deps.llmProvider.generateResponse).toHaveBeenCalledTimes(2);
    expect(result.responses[0].content).toBe('Valid JSON response');
    vi.useRealTimers();
  });

  it('should fail after 5 attempts if LLM consistently returns malformed JSON', async () => {
    vi.useFakeTimers();
    const engine = createConversationEngine();
    const deps = createMockDeps();
    
    (deps.llmProvider.generateResponse as any).mockResolvedValue({
      content: 'Still not JSON',
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      finishReason: 'stop',
    });
    
    const resultPromise = engine.processMessage({
      sessionKey,
      message,
      deps,
    });

    // Advance timers to skip retry delays
    await vi.advanceTimersByTimeAsync(30000);
    
    const result = await resultPromise;
    
    // With the fix, generateResponse is called on every retry attempt
    expect(deps.llmProvider.generateResponse).toHaveBeenCalledTimes(5);
    expect(result.responses[0].content).toBe('Dame un momento por favor ...');
    vi.useRealTimers();
  });
});
