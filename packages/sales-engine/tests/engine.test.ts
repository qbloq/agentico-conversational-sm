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

const mockKnowledgeEntry: KnowledgeEntry = {
  id: 'kb-1',
  title: '¿Cuáles son los primeros pasos para comenzar?',
  answer: 'Para comenzar con el trading, sigue estos pasos...',
  category: 'Manejo de la Cuenta',
  semanticTags: ['Primeros pasos', 'Registro'],
  summary: 'Pasos para empezar a operar con TAG Markets.',
};

const mockStateConfig = {
  initial: {
    state: 'initial',
    objective: 'Greet the user and qualify their interest',
    description: 'Initial greeting state',
    completionSignals: ['user shows interest'],
    ragCategories: ['general'],
    allowedTransitions: ['pitching_12x', 'closing', 'escalated'],
    transitionGuidance: { pitching_12x: 'When user shows interest', escalated: 'When escalation needed' },
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
      delete: vi.fn().mockResolvedValue(undefined),
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
    stateMachineStore: {
      findByName: vi.fn().mockResolvedValue({ states: mockStateConfig, initialState: 'initial' }),
      findActive: vi.fn().mockResolvedValue({ states: mockStateConfig, initialState: 'initial' }),
      getStateMachineId: vi.fn().mockResolvedValue('sm-1'),
      getFollowupConfig: vi.fn().mockResolvedValue(null),
      getStateEntryMessages: vi.fn().mockResolvedValue(null),
    },
    escalationStore: {
      create: vi.fn().mockResolvedValue({ id: 'esc-1' }),
      hasActive: vi.fn().mockResolvedValue(false),
    },
    followupStore: {
      scheduleNext: vi.fn().mockResolvedValue(undefined),
      cancelPending: vi.fn().mockResolvedValue(undefined),
    },
    llmProvider: {
      name: 'mock',
      generateResponse: vi.fn().mockResolvedValue({
        content: '```json\n{"responses": ["¡Hola! Bienvenido a TAG Markets.", "¿Tienes experiencia en trading?"], "transition": {"to": "initial", "reason": "greeting", "confidence": 0.9}}\n```',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        finishReason: 'stop',
      }),
      generateContent: vi.fn().mockResolvedValue({
        content: '',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        finishReason: 'stop',
      }),
      generateContentWithFileSearch: vi.fn().mockResolvedValue({
        content: '',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        finishReason: 'stop',
      }),
      generateResponseWithFileSearch: vi.fn().mockResolvedValue({
        content: '',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
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
    mediaService: {
      download: vi.fn(),
      upload: vi.fn(),
      transcribe: vi.fn().mockResolvedValue({
        text: 'This is a transcribed audio message',
        confidence: 0.98,
        duration: 5,
      }),
      analyzeImage: vi.fn().mockResolvedValue({
        description: 'A receipt for $500 USD from Chase Bank',
        confidence: 0.95,
      }),
    },
    notificationService: {
      sendEscalationAlert: vi.fn().mockResolvedValue(undefined),
    },
    clientConfig: {
      clientId: 'tag_markets',
      schemaName: 'client_tag_markets',
      storageBucket: 'media-tag-markets',
      stateMachineName: 'tag_markets_v1',
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
    
    expect(result.responses).toHaveLength(2);
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
    
    (deps.llmProvider.generateResponse as any).mockResolvedValue({
      content: '```json\n{"responses": ["¡Hola! Te conecto con un humano."], "escalation": {"shouldEscalate": true, "reason": "explicit_request", "confidence": 0.9, "summary": "User wants to talk to a person"}}\n```',
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      finishReason: 'stop',
    });

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
    
    // Mock an escalated session RECENTLY (so it doesn't resume)
    const escalatedSession = { 
      ...mockSession, 
      isEscalated: true, 
      lastMessageAt: new Date() 
    };
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

  it('should transcribe audio messages automatically', async () => {
    const engine = createConversationEngine();
    const deps = createMockDeps();
    
    const message: NormalizedMessage = {
      id: 'msg-audio',
      timestamp: new Date(),
      type: 'audio',
      mediaUrl: 'https://example.com/audio.ogg',
    };
    
    const result = await engine.processMessage({
      sessionKey: { channelType: 'whatsapp', channelId: '1', channelUserId: '1' },
      message,
      deps,
    });
    
    expect(deps.mediaService.transcribe).toHaveBeenCalledWith('https://example.com/audio.ogg');
    // The engine should modify the message object in place or pass the transcribed text
    // to LLM. Check if LLM received the text.
    expect(deps.llmProvider.generateResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'user', content: expect.stringContaining('This is a transcribed audio message') })
        ])
      })
    );
  });

  it('should resume escalated session after 1 hour of silence', async () => {
    const engine = createConversationEngine();
    const deps = createMockDeps();
    
    // Session escalated 2 hours ago
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const escalatedSession = { 
      ...mockSession, 
      isEscalated: true,
      lastMessageAt: twoHoursAgo 
    };
    (deps.sessionStore.findByKey as ReturnType<typeof vi.fn>).mockResolvedValue(escalatedSession);
    
    const message: NormalizedMessage = {
      id: 'msg-resume',
      timestamp: new Date(),
      type: 'text',
      content: 'Hola, ya regresé',
    };
    
    const result = await engine.processMessage({
      sessionKey: { channelType: 'whatsapp', channelId: '1', channelUserId: '1' },
      message,
      deps,
    });
    
    // Should NOT return empty responses (should process)
    expect(result.responses).not.toHaveLength(0);
    expect(result.sessionUpdates?.isEscalated).toBe(false);
    expect(result.sessionUpdates?.status).toBe('active');
  });

  it('should send notification on escalation', async () => {
    const engine = createConversationEngine();
    const deps = createMockDeps();
    
    const message: NormalizedMessage = {
      id: 'msg-esc',
      timestamp: new Date(),
      type: 'text',
      content: 'Quiero hablar con un humano urgentemente',
    };
    
    (deps.llmProvider.generateResponse as any).mockResolvedValue({
      content: '```json\n{"responses": ["¡Hola! Te conecto con un humano."], "escalation": {"shouldEscalate": true, "reason": "explicit_request", "confidence": 0.9, "summary": "User wants to talk to a person"}}\n```',
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      finishReason: 'stop',
    });

    await engine.processMessage({
      sessionKey: { channelType: 'whatsapp', channelId: '1', channelUserId: '1' },
      message,
      deps,
    });
    
    expect(deps.notificationService.sendEscalationAlert).toHaveBeenCalled();
  });

  it('should set status to paused and cancel follow-ups on escalation', async () => {
    const engine = createConversationEngine();
    const deps = createMockDeps();
    
    const message: NormalizedMessage = {
      id: 'msg-esc-paused',
      timestamp: new Date(),
      type: 'text',
      content: 'Necesito hablar con alguien real',
    };
    
    (deps.llmProvider.generateResponse as any).mockResolvedValue({
      content: '```json\n{"responses": ["Te conecto con un asesor."], "escalation": {"shouldEscalate": true, "reason": "explicit_request", "confidence": 0.95, "summary": "User wants human"}}\n```',
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      finishReason: 'stop',
    });

    const result = await engine.processMessage({
      sessionKey: { channelType: 'whatsapp', channelId: '1', channelUserId: '1' },
      message,
      deps,
    });
    
    // Verify session is paused
    expect(result.sessionUpdates?.status).toBe('paused');
    expect(result.sessionUpdates?.isEscalated).toBe(true);
    
    // Verify follow-ups were cancelled
    expect(deps.followupStore!.cancelPending).toHaveBeenCalledWith('session-1');
    
    // Verify escalation record was created
    expect(deps.escalationStore!.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        reason: 'explicit_request',
      })
    );
  });

  it('should auto-escalate when isUncertain is true without explicit escalation', async () => {
    const engine = createConversationEngine();
    const deps = createMockDeps();
    
    const message: NormalizedMessage = {
      id: 'msg-uncertain',
      timestamp: new Date(),
      type: 'text',
      content: 'What is your refund policy for leveraged accounts?',
    };
    
    // LLM returns isUncertain=true but NO escalation block
    (deps.llmProvider.generateResponse as any).mockResolvedValue({
      content: '```json\n{"responses": ["Hmm, no estoy seguro sobre eso.", "Déjame conectarte con alguien que pueda ayudarte."], "isUncertain": true}\n```',
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      finishReason: 'stop',
    });

    const result = await engine.processMessage({
      sessionKey: { channelType: 'whatsapp', channelId: '1', channelUserId: '1' },
      message,
      deps,
    });
    
    // Should trigger safety-net escalation
    expect(result.escalation).toBeDefined();
    expect(result.escalation?.shouldEscalate).toBe(true);
    expect(result.escalation?.reason).toBe('ai_uncertainty');
    expect(result.sessionUpdates?.isEscalated).toBe(true);
    expect(result.sessionUpdates?.status).toBe('paused');
    
    // Should cancel follow-ups
    expect(deps.followupStore!.cancelPending).toHaveBeenCalledWith('session-1');
    
    // Should create escalation record with medium priority
    expect(deps.escalationStore!.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        reason: 'ai_uncertainty',
        priority: 'medium',
      })
    );
    
    // Should send notification
    expect(deps.notificationService.sendEscalationAlert).toHaveBeenCalledWith(
      '+1234567890',
      expect.objectContaining({
        reason: 'ai_uncertainty',
      })
    );
  });

  it('should NOT auto-escalate when isUncertain is false', async () => {
    const engine = createConversationEngine();
    const deps = createMockDeps();
    
    const message: NormalizedMessage = {
      id: 'msg-certain',
      timestamp: new Date(),
      type: 'text',
      content: 'Hola, quiero información',
    };
    
    // LLM returns isUncertain=false (default) — normal response
    (deps.llmProvider.generateResponse as any).mockResolvedValue({
      content: '```json\n{"responses": ["¡Hola!", "¿En qué puedo ayudarte?"], "isUncertain": false}\n```',
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      finishReason: 'stop',
    });

    const result = await engine.processMessage({
      sessionKey: { channelType: 'whatsapp', channelId: '1', channelUserId: '1' },
      message,
      deps,
    });
    
    expect(result.escalation).toBeUndefined();
    expect(result.sessionUpdates?.isEscalated).toBeUndefined();
  });

  it('should NOT resume escalated session when agent is still active', async () => {
    const engine = createConversationEngine();
    const deps = createMockDeps();
    
    // Session escalated 2 hours ago (would normally resume)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const escalatedSession = { 
      ...mockSession, 
      isEscalated: true,
      lastMessageAt: twoHoursAgo 
    };
    (deps.sessionStore.findByKey as ReturnType<typeof vi.fn>).mockResolvedValue(escalatedSession);
    
    // But agent is still actively working the escalation
    (deps.escalationStore!.hasActive as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    
    const message: NormalizedMessage = {
      id: 'msg-blocked-resume',
      timestamp: new Date(),
      type: 'text',
      content: 'Hola, siguen ahí?',
    };
    
    const result = await engine.processMessage({
      sessionKey: { channelType: 'whatsapp', channelId: '1', channelUserId: '1' },
      message,
      deps,
    });
    
    // Should NOT resume — agent is still working
    expect(result.responses).toHaveLength(0);
    expect(deps.llmProvider.generateResponse).not.toHaveBeenCalled();
  });

  it('should resume escalated session when agent is NOT active and 1h passed', async () => {
    const engine = createConversationEngine();
    const deps = createMockDeps();
    
    // Session escalated 2 hours ago
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const escalatedSession = { 
      ...mockSession, 
      isEscalated: true,
      lastMessageAt: twoHoursAgo 
    };
    (deps.sessionStore.findByKey as ReturnType<typeof vi.fn>).mockResolvedValue(escalatedSession);
    
    // Agent has resolved/no active escalation
    (deps.escalationStore!.hasActive as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    
    const message: NormalizedMessage = {
      id: 'msg-resume-ok',
      timestamp: new Date(),
      type: 'text',
      content: 'Hola, ya regresé',
    };
    
    const result = await engine.processMessage({
      sessionKey: { channelType: 'whatsapp', channelId: '1', channelUserId: '1' },
      message,
      deps,
    });
    
    // Should resume — no active agent and 1h passed
    expect(result.responses).not.toHaveLength(0);
    expect(result.sessionUpdates?.isEscalated).toBe(false);
    expect(result.sessionUpdates?.status).toBe('active');
  });
});
