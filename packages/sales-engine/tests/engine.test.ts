/**
 * Conversation Engine Tests
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
  KnowledgeEntry,
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

const mockKnowledgeEntry: KnowledgeEntry = {
  id: 'kb-1',
  title: '¿Cuáles son los primeros pasos para comenzar?',
  answer: 'Para comenzar con el trading, sigue estos pasos...',
  category: 'Manejo de la Cuenta',
  semanticTags: ['Primeros pasos', 'Registro'],
  summary: 'Pasos para empezar a operar con TAG Markets.',
};

function createMockDeps(): EngineDependencies {
  return {
    contactStore: {
      findOrCreateByChannelUser: vi.fn().mockResolvedValue(mockContact),
      findById: vi.fn().mockResolvedValue(mockContact),
      update: vi.fn().mockResolvedValue(mockContact),
    },
    sessionStore: {
      findByKey: vi.fn().mockResolvedValue(mockSession),
      findById: vi.fn().mockResolvedValue(mockSession),
      create: vi.fn().mockResolvedValue(mockSession),
      update: vi.fn().mockResolvedValue(mockSession),
    },
    messageStore: {
      getRecent: vi.fn().mockResolvedValue([]),
      save: vi.fn().mockResolvedValue({} as Message),
    },
    llmProvider: {
      name: 'mock',
      generateResponse: vi.fn().mockResolvedValue({
        content: '¡Hola! Bienvenido a TAG Markets. ¿Tienes experiencia en trading?',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        finishReason: 'stop',
      }),
    },
    embeddingProvider: {
      generateEmbedding: vi.fn().mockResolvedValue(new Array(1536).fill(0)),
      dimensions: 1536,
    },
    knowledgeStore: {
      findSimilar: vi.fn().mockResolvedValue([mockKnowledgeEntry]),
      findByCategory: vi.fn().mockResolvedValue([mockKnowledgeEntry]),
      findByTags: vi.fn().mockResolvedValue([mockKnowledgeEntry]),
    },
    clientConfig: {
      clientId: 'tag_markets',
      schemaName: 'client_tag_markets',
      storageBucket: 'media-tag-markets',
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
    },
  };
}

describe('ConversationEngine', () => {
  it('should create an engine instance', () => {
    const engine = createConversationEngine();
    expect(engine).toBeDefined();
    expect(engine.processMessage).toBeDefined();
  });

  it('should process a simple text message', async () => {
    const engine = createConversationEngine();
    const deps = createMockDeps();
    
    const sessionKey: SessionKey = {
      channelType: 'whatsapp',
      channelId: 'phone-123',
      channelUserId: 'wa-user-456',
    };
    
    const message: NormalizedMessage = {
      id: 'msg-1',
      timestamp: new Date(),
      type: 'text',
      content: 'Hola, quiero información sobre trading',
    };
    
    const result = await engine.processMessage({
      sessionKey,
      message,
      deps,
    });
    
    expect(result.responses).toHaveLength(1);
    expect(result.responses[0].type).toBe('text');
    expect(result.responses[0].content).toContain('TAG Markets');
  });

  it('should escalate when user explicitly requests human', async () => {
    const engine = createConversationEngine();
    const deps = createMockDeps();
    
    const sessionKey: SessionKey = {
      channelType: 'whatsapp',
      channelId: 'phone-123',
      channelUserId: 'wa-user-456',
    };
    
    const message: NormalizedMessage = {
      id: 'msg-2',
      timestamp: new Date(),
      type: 'text',
      content: 'Quiero hablar con un agente humano',
    };
    
    const result = await engine.processMessage({
      sessionKey,
      message,
      deps,
    });
    
    expect(result.escalation).toBeDefined();
    expect(result.escalation?.shouldEscalate).toBe(true);
    expect(result.escalation?.reason).toBe('explicit_request');
    expect(result.sessionUpdates?.isEscalated).toBe(true);
  });

  it('should not process messages for escalated sessions', async () => {
    const engine = createConversationEngine();
    const deps = createMockDeps();
    
    // Mock an escalated session
    const escalatedSession = { ...mockSession, isEscalated: true };
    (deps.sessionStore.findByKey as ReturnType<typeof vi.fn>).mockResolvedValue(escalatedSession);
    
    const sessionKey: SessionKey = {
      channelType: 'whatsapp',
      channelId: 'phone-123',
      channelUserId: 'wa-user-456',
    };
    
    const message: NormalizedMessage = {
      id: 'msg-3',
      timestamp: new Date(),
      type: 'text',
      content: 'Hola de nuevo',
    };
    
    const result = await engine.processMessage({
      sessionKey,
      message,
      deps,
    });
    
    // Should return empty responses for escalated sessions
    expect(result.responses).toHaveLength(0);
    expect(deps.llmProvider.generateResponse).not.toHaveBeenCalled();
  });
});
