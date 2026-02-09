/**
 * Follow-up Sequence Engine Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { createConversationEngine } from '../src/engine/conversation.js';
import type {
  EngineDependencies,
  Contact,
  Session,
  Message,
  ClientConfig,
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
  currentState: 'pitching_12x',
  context: {},
  status: 'active',
  isEscalated: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockConfig: ClientConfig = {
  clientId: 'tag_markets',
  schemaName: 'client_tag_markets',
  storageBucket: 'media-tag-markets',
  stateMachineName: 'main',
  channels: {
    whatsapp: {
      phoneNumberId: 'phone-123',
      accessToken: 'secret:whatsapp_token',
      appSecret: 'secret:whatsapp_secret',
    },
  },
  llm: {
    provider: 'gemini',
    model: 'gemini-2.0-flash',
  },
  escalation: {
    enabled: true,
    notifyWhatsApp: '+1234567890',
  },
  business: {
    name: 'TAG Markets',
    description: 'Broker de trading con cuentas amplificadas',
    language: 'es',
    timezone: 'America/Mexico_City',
  },
};

function createMockDeps(): EngineDependencies {
  return {
    contactStore: {
      findById: vi.fn().mockResolvedValue(mockContact),
      findOrCreateByChannelUser: vi.fn().mockResolvedValue(mockContact),
      update: vi.fn(),
      delete: vi.fn(),
    },
    sessionStore: {
      findById: vi.fn().mockResolvedValue(mockSession),
      findByKey: vi.fn().mockResolvedValue(mockSession),
      create: vi.fn(),
      update: vi.fn(),
    },
    messageStore: {
      getRecent: vi.fn().mockResolvedValue([
        { id: 'm1', direction: 'outbound', type: 'text', content: '¿Qué te pareció la información?', createdAt: new Date() }
      ]),
      save: vi.fn().mockResolvedValue({} as Message),
    },
    llmProvider: {
      name: 'mock',
      generateResponse: vi.fn().mockResolvedValue({
        content: '```json\n{"responses": ["¡Hola! Solo quería saber si pudiste revisar la info."], "transition": {"to": "pitching_12x", "reason": "followup", "confidence": 1.0}}\n```',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        finishReason: 'stop',
      }),
      generateContent: vi.fn(),
      generateContentWithFileSearch: vi.fn(),
      generateResponseWithFileSearch: vi.fn(),
    } as any,
    embeddingProvider: {
      generateEmbedding: vi.fn().mockResolvedValue(new Array(1536).fill(0)),
      dimensions: 1536,
    },
    knowledgeStore: {
      findSimilar: vi.fn().mockResolvedValue([]),
      findByCategory: vi.fn().mockResolvedValue([]),
      findByTags: vi.fn().mockResolvedValue([]),
    },
    mediaService: {
      download: vi.fn(),
      upload: vi.fn(),
      transcribe: vi.fn(),
      analyzeImage: vi.fn(),
    },
    notificationService: {
      sendEscalationAlert: vi.fn(),
    },
    stateMachineStore: {
      findActive: vi.fn().mockResolvedValue({
        id: 'sm-1',
        name: 'main',
        states: {
          pitching_12x: {
            name: 'pitching_12x',
            allowedTransitions: [],
            transitionGuidance: {},
            completionSignals: [],
            systemInstructions: 'Test instructions'
          }
        },
        initialState: 'pitching_12x',
        version: '1.0.0',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      getFollowupConfigs: vi.fn().mockResolvedValue([]),
    } as any,
    clientConfig: mockConfig,
  };
}

describe('Follow-up Logic', () => {
  it('should generate a follow-up message correctly', async () => {
    const engine = createConversationEngine();
    const deps = createMockDeps();
    
    const result = await engine.generateFollowup('session-1', deps);
    
    expect(result.responses).toHaveLength(1);
    expect(result.responses[0].content).toContain('revisar la info');
    expect(deps.llmProvider.generateResponse).toHaveBeenCalled();
  });

  it('should include session history in follow-up prompt', async () => {
    const engine = createConversationEngine();
    const deps = createMockDeps();
    
    await engine.generateFollowup('session-1', deps);
    
    const callArgs = (deps.llmProvider.generateResponse as any).mock.calls[0][0];
    const systemPrompt = callArgs.systemPrompt;
    
    expect(systemPrompt).toContain('# Role');
    expect(systemPrompt).toContain('TAG Markets');
    
    const historyMessage = callArgs.messages.find((m: any) => m.role === 'assistant');
    expect(historyMessage.content).toContain('¿Qué te pareció la información?');
  });
});
