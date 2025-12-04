/**
 * State Machine for conversation flow
 */

import type { ConversationState, Session } from '../engine/types.js';

/**
 * Configuration for each state
 */
export interface StateConfig {
  /** The identifier for this state */
  state: ConversationState;

  /** What the bot should accomplish in this state */
  objective: string;
  
  /** Detailed description for LLM context */
  description: string;
  
  /** Signals that indicate this state's objective is complete */
  completionSignals: string[];
  
  /** KB categories to prioritize for RAG */
  ragCategories: string[];
  
  /** Allowed transitions from this state */
  allowedTransitions: ConversationState[];
  
  /** Description of when to transition to each allowed state (for LLM) */
  transitionGuidance: Record<string, string>;
  
  /** Max messages before suggesting transition (soft limit for LLM) */
  maxMessages?: number;
}

/**
 * State transition event
 */
export interface StateTransition {
  from: ConversationState;
  to: ConversationState;
  reason: string;
  timestamp: Date;
}

/**
 * State configurations for the sales conversation flow
 * Based on ux_refactor.md design document
 * 
 * Flows:
 * - Entry: initial
 * - Flow A (12x): pitching_12x
 * - Flow B (Downsell): pitching_copy_trading, pitching_academy
 * - Flow C (Closing): closing, post_registration
 * - Flow D (Support): returning_customer, support_general
 * - Terminal: completed, escalated, follow_up
 */
export const STATE_CONFIGS: Record<ConversationState, StateConfig> = {
  // ===========================================================================
  // ENTRY STATES
  // ===========================================================================
  
  initial: {
    state: 'initial',
    objective: 'Detect intent and route to appropriate flow',
    description: 'First contact. Determine if user is interested in 12x accounts, is a returning customer, or has another intent. IMPORTANT: If user shows ANY interest in 12x accounts, leverage, or funding, transition IMMEDIATELY to "pitching_12x". Do NOT use "qualifying" state.',
    completionSignals: [
      'User asks about 12x/leverage',
      'User identifies as existing customer',
      'User greets or asks general questions',
    ],
    ragCategories: ['Preguntas Frecuentes'],
    allowedTransitions: [
      'pitching_12x', 'returning_customer', 'pitching_copy_trading', 'pitching_academy', 'support_general', 'escalated'
    ],
    transitionGuidance: {
      pitching_12x: 'User explicitly asks about 12x accounts, leverage, or funding. GO HERE IMMEDIATELY.',
      returning_customer: 'User indicates they already have an account.',
      pitching_copy_trading: 'User specifically asks about Copy Trading.',
      pitching_academy: 'User specifically asks about education/academy.',
      support_general: 'User has a specific support question not related to sales.',
      escalated: 'User requests human agent.',
    },
    maxMessages: 2,
  },
  
  // ===========================================================================
  // FLOW A: 12x LEVERAGED ACCOUNTS
  // ===========================================================================
  
  pitching_12x: {
    state: 'pitching_12x',
    objective: 'Explain 12x Leveraged Accounts and handle Q&A',
    description: 'User is interested in 12x accounts. Deliver the value proposition (Concept, Considerations, Drawdown). Answer questions. If not interested, downsell to Copy Trading.',
    completionSignals: [
      'User wants to register',
      'User is not interested',
      'User asks about Copy Trading',
    ],
    ragCategories: ['12x Cuentas Amplificadas', 'Tipos de Cuentas', 'Condiciones De Trading'],
    allowedTransitions: ['closing', 'pitching_copy_trading', 'escalated'],
    transitionGuidance: {
      closing: 'User wants to register or asks for link.',
      pitching_copy_trading: 'User is NOT interested in 12x accounts (Downsell).',
      escalated: 'User requests human help.',
    },
    maxMessages: 6,
  },
  
  // ===========================================================================
  // FLOW B: DOWNSELL PATH (Flexible)
  // ===========================================================================
  
  pitching_copy_trading: {
    state: 'pitching_copy_trading',
    objective: 'Offer Copy Trading as alternative',
    description: 'User declined 12x accounts. Offer Copy Trading. If user indicates interest in Education instead, skip to Academy.',
    completionSignals: [
      'User wants to register for Copy Trading',
      'User is not interested',
      'User asks about Academy/Education',
    ],
    ragCategories: ['Copy Trading', 'Tipos de Cuentas'],
    allowedTransitions: ['closing', 'pitching_academy', 'escalated'],
    transitionGuidance: {
      closing: 'User wants to register for Copy Trading.',
      pitching_academy: 'User is NOT interested in Copy Trading OR explicitly asks for Education.',
      escalated: 'User requests human help.',
    },
    maxMessages: 4,
  },
  
  pitching_academy: {
    state: 'pitching_academy',
    objective: 'Offer Academy/Education',
    description: 'User declined Copy Trading. Offer Academy. If not interested, offer general support.',
    completionSignals: [
      'User wants to join Academy',
      'User is not interested',
    ],
    ragCategories: ['Academia', 'Conceptos generales de Trading'],
    allowedTransitions: ['closing', 'support_general', 'escalated'],
    transitionGuidance: {
      closing: 'User wants to join Academy.',
      support_general: 'User is NOT interested in Academy.',
      escalated: 'User requests human help.',
    },
    maxMessages: 3,
  },
  
  // ===========================================================================
  // FLOW C: CLOSING & REGISTRATION
  // ===========================================================================
  
  closing: {
    state: 'closing',
    objective: 'Send registration link and guide user to a successful registration',
    description: 'User wants to proceed with a product. Send registration link and guide process.',
    completionSignals: [
      'User confirms registration',
    ],
    ragCategories: ['Guías & Tutoriales', 'Manejo de la Cuenta'],
    allowedTransitions: ['post_registration', 'escalated'],
    transitionGuidance: {
      post_registration: 'User confirms they have registered.',
      escalated: 'User has issues registering that require human.',
    },
    maxMessages: 5,
  },
  
  post_registration: {
    state: 'post_registration',
    objective: 'Confirm registration and schedule follow-ups',
    description: 'User has registered. Confirm email. Schedule follow-ups.',
    completionSignals: [
      'Details captured',
      'User is done',
    ],
    ragCategories: ['Depósitos y Retiros'],
    allowedTransitions: ['completed', 'returning_customer', 'escalated'],
    transitionGuidance: {
      completed: 'Registration confirmed and details captured.',
      returning_customer: 'User has immediate support questions after registering.',
      escalated: 'User requests human help.',
    },
    maxMessages: 4,
  },
  
  // ===========================================================================
  // FLOW D: RETURNING CUSTOMER / SUPPORT
  // ===========================================================================
  
  returning_customer: {
    state: 'returning_customer',
    objective: 'Support existing customer',
    description: 'Handle support questions for existing users. Use KB and Conversation Examples for human-like tone.',
    completionSignals: [
      'Issue resolved',
      'User satisfied',
    ],
    ragCategories: ['Manejo de la Cuenta', 'Depósitos y Retiros', 'Plataformas De Trading'],
    allowedTransitions: ['completed', 'escalated', 'pitching_12x'],
    transitionGuidance: {
      completed: 'Issue resolved.',
      escalated: 'Complex issue requiring human.',
      pitching_12x: 'User asks about opening a new 12x account.',
    },
    maxMessages: 10,
  },
  
  support_general: {
    state: 'support_general',
    objective: 'General support for non-customers',
    description: 'User reached end of sales flow or has general questions. Be helpful but try to route back to value if possible.',
    completionSignals: [
      'Question answered',
    ],
    ragCategories: ['Preguntas Frecuentes'],
    allowedTransitions: ['completed', 'escalated', 'pitching_12x'],
    transitionGuidance: {
      completed: 'Question answered.',
      escalated: 'User requests human.',
      pitching_12x: 'User shows renewed interest in products.',
    },
    maxMessages: 5,
  },
  
  // ===========================================================================
  // TERMINAL STATES
  // ===========================================================================
  
  follow_up: {
    state: 'follow_up',
    objective: 'Re-engage user',
    description: 'Scheduled follow-up. Check if user registered or needs help.',
    completionSignals: [
      'User responds',
    ],
    ragCategories: [],
    allowedTransitions: ['pitching_12x', 'closing', 'completed', 'escalated'],
    transitionGuidance: {
      pitching_12x: 'User wants to know more.',
      closing: 'User is ready to register.',
      completed: 'User declines.',
      escalated: 'User requests human.',
    },
  },
  
  escalated: {
    state: 'escalated',
    objective: 'Human agent handover',
    description: 'Conversation handed off to human.',
    completionSignals: [],
    ragCategories: [],
    allowedTransitions: ['completed'],
    transitionGuidance: {
      completed: 'Human closes conversation.',
    },
  },
  
  completed: {
    state: 'completed',
    objective: 'Conversation ended',
    description: 'Conversation concluded successfully.',
    completionSignals: [],
    ragCategories: [],
    allowedTransitions: ['follow_up'],
    transitionGuidance: {
      follow_up: 'Scheduled re-engagement.',
    },
  },
};

/**
 * State Machine class
 */
export class StateMachine {
  private currentState: ConversationState;
  private transitions: StateTransition[] = [];
  
  constructor(initialState: ConversationState = 'initial') {
    this.currentState = initialState;
  }
  
  /**
   * Get current state
   */
  getState(): ConversationState {
    return this.currentState;
  }
  
  /**
   * Get configuration for current state
   */
  getConfig(): StateConfig {
    return STATE_CONFIGS[this.currentState];
  }
  
  /**
   * Check if transition to target state is allowed
   */
  canTransitionTo(targetState: ConversationState): boolean {
    const config = STATE_CONFIGS[this.currentState];
    return config.allowedTransitions.includes(targetState);
  }
  
  /**
   * Transition to a new state
   */
  transitionTo(targetState: ConversationState, reason: string): boolean {
    if (!this.canTransitionTo(targetState)) {
      return false;
    }
    
    const transition: StateTransition = {
      from: this.currentState,
      to: targetState,
      reason,
      timestamp: new Date(),
    };
    
    this.transitions.push(transition);
    this.currentState = targetState;
    
    return true;
  }
  
  /**
   * Get transition history
   */
  getTransitions(): StateTransition[] {
    return [...this.transitions];
  }
  
  /**
   * Build context for LLM to evaluate state transitions
   * This is injected into the system prompt
   */
  buildTransitionContext(): string {
    const config = STATE_CONFIGS[this.currentState];
    
    const transitionOptions = config.allowedTransitions
      .filter(state => state !== 'escalated') // Escalation handled separately
      .map(state => {
        const guidance = config.transitionGuidance[state] || '';
        const targetConfig = STATE_CONFIGS[state];
        return `- **${state}**: ${guidance}\n  Next objective: ${targetConfig.objective}`;
      })
      .join('\n');
    
    return `## Current State: ${this.currentState}
**Objective**: ${config.objective}
**Description**: ${config.description}

## Completion Signals
Look for these signals that indicate the current objective is complete:
${config.completionSignals.map(s => `- ${s}`).join('\n')}

## Available Transitions
When you detect completion signals, recommend transitioning to one of these states:
${transitionOptions}

${config.maxMessages ? `Note: This state typically completes within ${config.maxMessages} exchanges.` : ''}`;
  }
  
  /**
   * Create from session
   */
  static fromSession(session: Session): StateMachine {
    const machine = new StateMachine(session.currentState);
    return machine;
  }
}
