/**
 * LLM Usage Logger
 * 
 * Interface and utilities for logging LLM calls for cost tracking.
 * The actual persistence is handled by adapters (e.g., Supabase adapter).
 */

import { calculateCost, calculateTranscriptionCost } from './pricing.js';

/**
 * Log entry for an LLM call
 */
export interface LLMLogEntry {
  // Client context
  clientId: string;
  sessionId?: string;
  
  // Request type
  requestType: 'chat' | 'embedding' | 'vision' | 'transcription';
  
  // Provider info
  provider: string;
  model: string;
  
  // Token usage
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  
  // Cost (calculated)
  costUsd: number;
  
  // Content previews (truncated)
  inputPreview?: string;
  outputPreview?: string;
  inputHash?: string;
  
  // Performance
  latencyMs?: number;
  finishReason?: 'stop' | 'length' | 'content_filter' | 'error';
  
  // Error tracking
  isError?: boolean;
  errorMessage?: string;
}

/**
 * Interface for LLM logging persistence
 * Implemented by adapters (e.g., SupabaseLLMLogger)
 */
export interface LLMLogger {
  log(entry: LLMLogEntry): Promise<void>;
}

/**
 * No-op logger for testing or when logging is disabled
 */
export const noopLogger: LLMLogger = {
  async log(_entry: LLMLogEntry): Promise<void> {
    // Do nothing
  },
};

/**
 * Console logger for development
 */
export const consoleLogger: LLMLogger = {
  async log(entry: LLMLogEntry): Promise<void> {
    console.log('[LLM Log]', {
      client: entry.clientId,
      type: entry.requestType,
      provider: entry.provider,
      model: entry.model,
      tokens: entry.totalTokens,
      cost: `$${entry.costUsd.toFixed(6)}`,
      latency: entry.latencyMs ? `${entry.latencyMs}ms` : undefined,
      error: entry.isError ? entry.errorMessage : undefined,
    });
  },
};

/**
 * Truncate text to a maximum length for preview storage
 */
export function truncateForPreview(text: string, maxLength: number = 500): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

/**
 * Generate SHA256 hash of input for deduplication analysis
 */
export async function hashInput(input: string): Promise<string> {
  // Use Web Crypto API (available in both Node.js and Deno)
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Helper to create a log entry for a chat completion
 */
export function createChatLogEntry(params: {
  clientId: string;
  sessionId?: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  input: string;
  output: string;
  latencyMs?: number;
  finishReason?: LLMLogEntry['finishReason'];
  isError?: boolean;
  errorMessage?: string;
}): Omit<LLMLogEntry, 'inputHash'> {
  return {
    clientId: params.clientId,
    sessionId: params.sessionId,
    requestType: 'chat',
    provider: params.provider,
    model: params.model,
    promptTokens: params.promptTokens,
    completionTokens: params.completionTokens,
    totalTokens: params.promptTokens + params.completionTokens,
    costUsd: calculateCost(params.model, params.promptTokens, params.completionTokens),
    inputPreview: truncateForPreview(params.input),
    outputPreview: truncateForPreview(params.output),
    latencyMs: params.latencyMs,
    finishReason: params.finishReason,
    isError: params.isError,
    errorMessage: params.errorMessage,
  };
}

/**
 * Helper to create a log entry for an embedding request
 */
export function createEmbeddingLogEntry(params: {
  clientId: string;
  sessionId?: string;
  provider: string;
  model: string;
  promptTokens: number;
  input: string;
  latencyMs?: number;
  isError?: boolean;
  errorMessage?: string;
}): Omit<LLMLogEntry, 'inputHash'> {
  return {
    clientId: params.clientId,
    sessionId: params.sessionId,
    requestType: 'embedding',
    provider: params.provider,
    model: params.model,
    promptTokens: params.promptTokens,
    completionTokens: 0,
    totalTokens: params.promptTokens,
    costUsd: calculateCost(params.model, params.promptTokens, 0),
    inputPreview: truncateForPreview(params.input),
    latencyMs: params.latencyMs,
    isError: params.isError,
    errorMessage: params.errorMessage,
  };
}

/**
 * Helper to create a log entry for a vision request
 */
export function createVisionLogEntry(params: {
  clientId: string;
  sessionId?: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  input: string;
  output: string;
  latencyMs?: number;
  finishReason?: LLMLogEntry['finishReason'];
  isError?: boolean;
  errorMessage?: string;
}): Omit<LLMLogEntry, 'inputHash'> {
  return {
    clientId: params.clientId,
    sessionId: params.sessionId,
    requestType: 'vision',
    provider: params.provider,
    model: params.model,
    promptTokens: params.promptTokens,
    completionTokens: params.completionTokens,
    totalTokens: params.promptTokens + params.completionTokens,
    costUsd: calculateCost(params.model, params.promptTokens, params.completionTokens),
    inputPreview: truncateForPreview(params.input),
    outputPreview: truncateForPreview(params.output),
    latencyMs: params.latencyMs,
    finishReason: params.finishReason,
    isError: params.isError,
    errorMessage: params.errorMessage,
  };
}

/**
 * Helper to create a log entry for a transcription request
 */
export function createTranscriptionLogEntry(params: {
  clientId: string;
  sessionId?: string;
  provider: string;
  model: string;
  durationSeconds: number;
  output: string;
  latencyMs?: number;
  isError?: boolean;
  errorMessage?: string;
}): Omit<LLMLogEntry, 'inputHash'> {
  return {
    clientId: params.clientId,
    sessionId: params.sessionId,
    requestType: 'transcription',
    provider: params.provider,
    model: params.model,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    costUsd: calculateTranscriptionCost(params.durationSeconds),
    inputPreview: `[Audio: ${params.durationSeconds}s]`,
    outputPreview: truncateForPreview(params.output),
    latencyMs: params.latencyMs,
    isError: params.isError,
    errorMessage: params.errorMessage,
  };
}
