/**
 * Supabase LLM Logger Adapter
 * 
 * Implements the LLMLogger interface to persist LLM usage logs to Supabase.
 * Logs are stored in public.llm_logs for cross-client analytics.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * LLM Log Entry (matches domain library type)
 */
export interface LLMLogEntry {
  clientId: string;
  sessionId?: string;
  requestType: 'chat' | 'embedding' | 'vision' | 'transcription';
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  inputPreview?: string;
  outputPreview?: string;
  inputHash?: string;
  latencyMs?: number;
  finishReason?: 'stop' | 'length' | 'content_filter' | 'error';
  isError?: boolean;
  errorMessage?: string;
}

/**
 * LLM Logger interface
 */
export interface LLMLogger {
  log(entry: LLMLogEntry): Promise<void>;
}

/**
 * Create a Supabase-backed LLM logger
 */
export function createSupabaseLLMLogger(supabase: SupabaseClient): LLMLogger {
  return {
    async log(entry: LLMLogEntry): Promise<void> {
      try {
        const { error } = await supabase
          .from('llm_logs')
          .insert({
            client_id: entry.clientId,
            session_id: entry.sessionId,
            request_type: entry.requestType,
            provider: entry.provider,
            model: entry.model,
            prompt_tokens: entry.promptTokens,
            completion_tokens: entry.completionTokens,
            total_tokens: entry.totalTokens,
            cost_usd: entry.costUsd,
            input_preview: entry.inputPreview,
            output_preview: entry.outputPreview,
            input_hash: entry.inputHash,
            latency_ms: entry.latencyMs,
            finish_reason: entry.finishReason,
            is_error: entry.isError ?? false,
            error_message: entry.errorMessage,
          });

        if (error) {
          // Log error but don't throw - logging should not break the main flow
          console.error('[LLM Logger] Failed to log entry:', error.message);
        }
      } catch (err) {
        // Catch any unexpected errors - logging should never break the main flow
        console.error('[LLM Logger] Unexpected error:', err);
      }
    },
  };
}

/**
 * Batch logger for high-throughput scenarios
 * Buffers entries and flushes periodically or when buffer is full
 */
export function createBatchLLMLogger(
  supabase: SupabaseClient,
  options: {
    batchSize?: number;
    flushIntervalMs?: number;
  } = {}
): LLMLogger & { flush: () => Promise<void> } {
  const batchSize = options.batchSize ?? 10;
  const flushIntervalMs = options.flushIntervalMs ?? 5000;
  
  let buffer: LLMLogEntry[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const flush = async (): Promise<void> => {
    if (buffer.length === 0) return;
    
    const entries = buffer;
    buffer = [];
    
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }

    try {
      const { error } = await supabase
        .from('llm_logs')
        .insert(entries.map(entry => ({
          client_id: entry.clientId,
          session_id: entry.sessionId,
          request_type: entry.requestType,
          provider: entry.provider,
          model: entry.model,
          prompt_tokens: entry.promptTokens,
          completion_tokens: entry.completionTokens,
          total_tokens: entry.totalTokens,
          cost_usd: entry.costUsd,
          input_preview: entry.inputPreview,
          output_preview: entry.outputPreview,
          input_hash: entry.inputHash,
          latency_ms: entry.latencyMs,
          finish_reason: entry.finishReason,
          is_error: entry.isError ?? false,
          error_message: entry.errorMessage,
        })));

      if (error) {
        console.error('[LLM Logger] Batch insert failed:', error.message);
      }
    } catch (err) {
      console.error('[LLM Logger] Batch insert error:', err);
    }
  };

  const scheduleFlush = (): void => {
    if (!flushTimer) {
      flushTimer = setTimeout(flush, flushIntervalMs);
    }
  };

  return {
    async log(entry: LLMLogEntry): Promise<void> {
      buffer.push(entry);
      
      if (buffer.length >= batchSize) {
        await flush();
      } else {
        scheduleFlush();
      }
    },
    flush,
  };
}
