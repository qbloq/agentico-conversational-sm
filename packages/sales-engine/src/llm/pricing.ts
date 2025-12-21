/**
 * LLM Pricing Configuration
 * 
 * Prices are in USD per 1M tokens (as of Nov 2024).
 * Update these when provider pricing changes.
 */

export interface ModelPricing {
  promptPer1M: number;      // Cost per 1M input tokens
  completionPer1M: number;  // Cost per 1M output tokens
}

/**
 * Pricing table for all supported models
 * Source: Official provider pricing pages
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Google Gemini
  'gemini-2.0-flash': { promptPer1M: 0.10, completionPer1M: 0.40 },
  'gemini-2.0-flash-lite': { promptPer1M: 0.075, completionPer1M: 0.30 },
  'gemini-2.5-flash': { promptPer1M: 0.30, completionPer1M: 2.50 },
  'gemini-2.5-flash-lite': { promptPer1M: 0.10, completionPer1M: 0.40 },
  'gemini-3-pro-preview': { promptPer1M: 2, completionPer1M: 12 },
    
  // Embeddings (completion tokens = 0 for embeddings)
  'gemini-embedding-001': { promptPer1M: 0.15, completionPer1M: 0.15 }
};

/**
 * Calculate cost for a given model and token usage
 */
export function calculateCost(
  model: string,
  promptTokens: number,
  completionTokens: number
): number {
  const pricing = MODEL_PRICING[model];
  
  if (!pricing) {
    // Unknown model - log warning and return 0
    console.warn(`[LLM Pricing] Unknown model: ${model}, cannot calculate cost`);
    return 0;
  }
  
  const promptCost = (promptTokens / 1_000_000) * pricing.promptPer1M;
  const completionCost = (completionTokens / 1_000_000) * pricing.completionPer1M;
  
  return promptCost + completionCost;
}

/**
 * AssemblyAI pricing (per minute of audio)
 */
export const ASSEMBLYAI_PRICING = {
  transcriptionPerMinute: 0.01,  // $0.01/min for async transcription
};

/**
 * Calculate transcription cost
 */
export function calculateTranscriptionCost(durationSeconds: number): number {
  const minutes = durationSeconds / 60;
  return minutes * ASSEMBLYAI_PRICING.transcriptionPerMinute;
}
