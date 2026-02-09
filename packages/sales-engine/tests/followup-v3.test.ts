/**
 * Follow-up V3 System Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseIntervalToMinutes, calculateScheduledTime } from '../src/engine/followup-utils.js';
import { createConversationEngine } from '../src/engine/conversation.js';
import type { 
  EngineDependencies, 
  Session, 
  Contact, 
  ClientConfig 
} from '../src/engine/types.js';

describe('Follow-up V3 Utilities', () => {
  describe('parseIntervalToMinutes', () => {
    it('should parse minutes correctly', () => {
      expect(parseIntervalToMinutes('15m')).toBe(15);
      expect(parseIntervalToMinutes('15min')).toBe(15);
      expect(parseIntervalToMinutes('15 minutes')).toBe(15);
    });

    it('should parse hours correctly', () => {
      expect(parseIntervalToMinutes('2h')).toBe(120);
      expect(parseIntervalToMinutes('2 hours')).toBe(120);
    });

    it('should parse days correctly', () => {
      expect(parseIntervalToMinutes('1d')).toBe(1440);
      expect(parseIntervalToMinutes('3 days')).toBe(4320);
    });

    it('should parse weeks correctly', () => {
      expect(parseIntervalToMinutes('1w')).toBe(10080);
    });

    it('should return 0 for invalid inputs', () => {
      expect(parseIntervalToMinutes('')).toBe(0);
      expect(parseIntervalToMinutes('invalid')).toBe(0);
      expect(parseIntervalToMinutes('15 unknown')).toBe(0);
    });
  });

  describe('calculateScheduledTime', () => {
    it('should calculate future date correctly', () => {
      const now = new Date('2024-01-01T12:00:00Z');
      const scheduled = calculateScheduledTime('1h', now);
      expect(scheduled.toISOString()).toBe('2024-01-01T13:00:00.000Z');
    });

    it('should handle day rollover', () => {
      const now = new Date('2024-01-01T23:30:00Z');
      const scheduled = calculateScheduledTime('1h', now);
      expect(scheduled.toISOString()).toBe('2024-01-02T00:30:00.000Z');
    });
  });
});

describe('Follow-up Variable Resolution', () => {
  const mockContact: Contact = {
    id: 'c1',
    firstName: 'Juan',
    lastName: 'Perez',
    language: 'es',
    hasRegistered: false,
    depositConfirmed: false,
    lifetimeValue: 100,
    metadata: { city: 'Madrid' },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockSession: Session = {
    id: 's1',
    contactId: 'c1',
    stateMachineId: 'sm1',
    channelType: 'whatsapp',
    channelId: 'ch1',
    channelUserId: 'u1',
    currentState: 'initial',
    context: { last_product: 'Trading Account' },
    status: 'active',
    isEscalated: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockConfig: ClientConfig = {
    clientId: 'test',
    schemaName: 'test_schema',
    storageBucket: 'test_bucket',
    stateMachineName: 'main',
    channels: {},
    llm: { provider: 'openai', model: 'gpt-4' },
    escalation: { enabled: false },
    business: {
      name: 'Test Business',
      description: 'Test Description',
      language: 'es',
      timezone: 'UTC'
    }
  };

  it('should generate LLM variables correctly', async () => {
    const engine = createConversationEngine();
    const mockLLM = {
      generateResponse: vi.fn().mockResolvedValue({ content: 'Resolved Value' }),
      name: 'mock'
    };

    const deps: any = {
      sessionStore: { findById: vi.fn().mockResolvedValue(mockSession) },
      messageStore: { getRecent: vi.fn().mockResolvedValue([]) },
      llmProvider: mockLLM,
      clientConfig: mockConfig
    };

    const value = await engine.generateFollowupVariable('s1', 'Resolvé esto', deps);
    expect(value).toBe('Resolved Value');
    expect(mockLLM.generateResponse).toHaveBeenCalled();
  });
});
