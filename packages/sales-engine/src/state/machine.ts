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

  /** 
   * Follow-up sequence intervals (e.g., ['15m', '30m', '2h', '1d', '1w']) 
   * If user doesn't respond, we send a follow-up at each interval.
   */
  followupSequence?: string[];
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
    objective: 'Detect intent and route to appropriate flow based on trading experience',
    description: 'First contact. Ask about trading experience to route appropriately. If user has experience AND shows interest in 12x accounts, transition to "pitching_12x". If user has NO experience, offer Premium Academy first. IMPORTANT: Capture trading experience before routing.',
    completionSignals: [
      'User asks about 12x/leverage and has experience',
      'User has no experience (route to Academy)',
      'User identifies as existing customer',
    ],
    ragCategories: ['Preguntas Frecuentes'],
    allowedTransitions: [
      'pitching_12x', 'pitching_academy', 'returning_customer', 'pitching_copy_trading', 'support_general', 'prospect', 'escalated'
    ],
    transitionGuidance: {
      pitching_12x: 'User has trading experience AND shows interest in 12x accounts, leverage, or funding.',
      pitching_academy: 'User has NO trading experience. Offer Academy first.',
      returning_customer: 'User indicates they already have an account.',
      pitching_copy_trading: 'User specifically asks about Copy Trading.',
      support_general: 'User has a specific support question not related to sales.',
      prospect: 'User shows no clear interest in any product.',
      escalated: 'User requests human agent.',
    },
    maxMessages: 2,
    followupSequence: ['30m', '4h', '24h'],
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
    followupSequence: ['15m', '1h', '4h', '24h'],
  },
  
  // ===========================================================================
  // FLOW B: DOWNSELL PATH (Flexible)
  // ===========================================================================
  
  pitching_copy_trading: {
    state: 'pitching_copy_trading',
    objective: 'Offer Copy Trading as alternative',
    description: 'User declined previous offer. Offer Copy Trading. If user indicates interest in Education instead, skip to Academy. If user rejects all, move to prospect state.',
    completionSignals: [
      'User wants to register for Copy Trading',
      'User is not interested',
      'User asks about Academy/Education',
    ],
    ragCategories: ['Copy Trading', 'Tipos de Cuentas'],
    allowedTransitions: ['closing', 'pitching_academy', 'prospect', 'escalated'],
    transitionGuidance: {
      closing: 'User wants to register for Copy Trading.',
      pitching_academy: 'User is NOT interested in Copy Trading BUT explicitly asks for Education.',
      prospect: 'User is NOT interested in Copy Trading and has rejected other offers.',
      escalated: 'User requests human help.',
    },
    maxMessages: 4,
  },
  
  pitching_academy: {
    state: 'pitching_academy',
    objective: 'Offer Academy/Education to inexperienced traders',
    description: 'User has no trading experience. Offer Premium Academy. If not interested, downsell to Copy Trading.',
    completionSignals: [
      'User wants to join Academy',
      'User is not interested',
    ],
    ragCategories: ['Academia', 'Conceptos generales de Trading'],
    allowedTransitions: ['closing', 'pitching_copy_trading', 'prospect', 'escalated'],
    transitionGuidance: {
      closing: 'User wants to join Academy.',
      pitching_copy_trading: 'User is NOT interested in Academy (Downsell to Copy Trading).',
      prospect: 'User explicitly rejects Academy without interest in alternatives.',
      escalated: 'User requests human help.',
    },
    maxMessages: 3,
  },
  
  prospect: {
    state: 'prospect',
    objective: 'Re-engage user who rejected all offers',
    description: 'User declined all product offers (Academy, Copy Trading, 12x). Try to understand their needs better and route back to appropriate product flow if they show renewed interest.',
    completionSignals: [
      'User shows renewed interest in a product',
      'User asks questions about products',
      'User wants to end conversation',
    ],
    ragCategories: ['Preguntas Frecuentes'],
    allowedTransitions: ['pitching_12x', 'pitching_academy', 'pitching_copy_trading', 'support_general', 'completed', 'escalated'],
    transitionGuidance: {
      pitching_12x: 'User shows interest in 12x accounts or has trading experience.',
      pitching_academy: 'User asks about education or training.',
      pitching_copy_trading: 'User asks about Copy Trading.',
      support_general: 'User has general questions.',
      completed: 'User wants to end conversation.',
      escalated: 'User requests human help.',
    },
    maxMessages: 5,
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
    followupSequence: ['15m', '1h', '4h', '24h'],
  },
  
  post_registration: {
    state: 'post_registration',
    objective: 'Capture customer email and confirm registration',
    description: 'User has registered. Ask for and capture their email to verify registration. Once email is provided, transition to returning_customer for ongoing support.',
    completionSignals: [
      'User provides email address',
      'Email captured and verified',
    ],
    ragCategories: ['Depósitos y Retiros'],
    allowedTransitions: ['completed', 'returning_customer', 'escalated'],
    transitionGuidance: {
      completed: 'User declines to provide email or wants to end conversation.',
      returning_customer: 'User provides their email address - transition to provide ongoing customer support.',
      escalated: 'User requests human help.',
    },
    maxMessages: 3,
    followupSequence: ['30m', '1h', '4h', '24h'],
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
  private config: Record<ConversationState, StateConfig>;
  
  constructor(initialState: ConversationState = 'initial', config: Record<ConversationState, StateConfig> = STATE_CONFIGS) {
    this.currentState = initialState;
    this.config = config;
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
    return this.config[this.currentState];
  }
  
  /**
   * Check if transition to target state is allowed
   */
  canTransitionTo(targetState: ConversationState): boolean {
    const config = this.config[this.currentState];
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
    const config = this.config[this.currentState];
    console.log('>>>>>>>this.currentState', this.currentState);
    console.log('>>>>>>>config', config);
    console.log('>>>>>>>config.objective', config.objective);
    const transitionOptions = config.allowedTransitions
      .filter(state => state !== 'escalated') // Escalation handled separately
      .map(state => {
        const guidance = config.transitionGuidance[state] || '';
        const targetConfig = this.config[state];
        console.log('targetConfig.objective', targetConfig.objective);
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
  static fromSession(session: Session, config: Record<ConversationState, StateConfig> = STATE_CONFIGS): StateMachine {
    const machine = new StateMachine(session.currentState, config);
    return machine;
  }
}
