/**
 * Format conversation examples for injection into LLM prompts
 */

import type { ConversationExample } from './types.js';

/**
 * Minimal interface for formatting - allows both engine and examples types
 */
export interface FormattableExample {
  scenario: string;
  primaryState: string | null;
  outcome: string;
  messages: Array<{
    role: 'customer' | 'agent';
    content: string;
    state?: string;
  }>;
}

/**
 * Interface for examples with full metadata (for summarize)
 */
interface SummarizableExample extends FormattableExample {
  exampleId: string;
  category: string;
  stateFlow: string[];
}

/**
 * Options for formatting examples
 */
export interface FormatOptions {
  /** Include state annotations in output */
  includeStates?: boolean;
  /** Include scenario description */
  includeScenario?: boolean;
  /** Maximum messages to include per example */
  maxMessages?: number;
  /** Prefix for customer messages */
  customerPrefix?: string;
  /** Prefix for agent messages */
  agentPrefix?: string;
}

const DEFAULT_OPTIONS: Required<FormatOptions> = {
  includeStates: false,
  includeScenario: true,
  maxMessages: 20,
  customerPrefix: '[CLIENTE]',
  agentPrefix: '[AGENTE]',
};

/**
 * Format a single message
 */
function formatMessage(
  msg: FormattableExample['messages'][0],
  options: Required<FormatOptions>
): string {
  const prefix = msg.role === 'customer' ? options.customerPrefix : options.agentPrefix;
  const stateTag = options.includeStates && msg.state ? ` (${msg.state})` : '';
  return `${prefix}${stateTag}: ${msg.content}`;
}

/**
 * Format a single conversation example for prompt injection
 */
export function formatExample(
  example: FormattableExample,
  options: FormatOptions = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const lines: string[] = [];

  // Header
  if (opts.includeScenario) {
    lines.push(`### ${example.scenario}`);
    lines.push(`*Estado principal: ${example.primaryState || 'N/A'} | Resultado: ${example.outcome}*`);
    lines.push('');
  }

  // Messages
  const messages = example.messages.slice(0, opts.maxMessages);
  for (const msg of messages) {
    lines.push(formatMessage(msg, opts));
  }

  // Truncation notice
  if (example.messages.length > opts.maxMessages) {
    lines.push(`... (${example.messages.length - opts.maxMessages} mensajes más)`);
  }

  return lines.join('\n');
}

/**
 * Format multiple examples for prompt injection
 */
export function formatExamples(
  examples: FormattableExample[],
  options: FormatOptions = {}
): string {
  if (examples.length === 0) {
    return '';
  }

  const header = `## Ejemplos de Referencia

Los siguientes ejemplos muestran cómo agentes expertos manejan situaciones similares.
Usa estos como guía para tu estilo y enfoque, pero adapta tu respuesta al contexto actual.

`;

  const formatted = examples
    .map((ex, i) => `**Ejemplo ${i + 1}**\n${formatExample(ex, options)}`)
    .join('\n\n---\n\n');

  return header + formatted;
}

/**
 * Extract just the agent responses from an example
 * Useful for showing response patterns without full context
 */
export function extractAgentResponses(
  example: FormattableExample,
  options: { maxResponses?: number; forState?: string } = {}
): string[] {
  const { maxResponses = 5, forState } = options;

  let messages = example.messages.filter((m: FormattableExample['messages'][0]) => m.role === 'agent');

  if (forState) {
    messages = messages.filter((m: FormattableExample['messages'][0]) => m.state === forState);
  }

  return messages.slice(0, maxResponses).map((m: FormattableExample['messages'][0]) => m.content);
}

/**
 * Get a compact summary of an example for logging/debugging
 */
export function summarizeExample(example: SummarizableExample | ConversationExample): string {
  const flow = example.stateFlow.join(' → ');
  const msgCount = example.messages.length;
  return `[${example.exampleId}] ${example.category}/${example.outcome}: ${flow} (${msgCount} msgs)`;
}
