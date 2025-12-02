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
 * Based on conversational_ux.md design document
 * 
 * State Categories:
 * - Entry: initial, returning_customer, promotion_inquiry
 * - Qualification: qualifying, diagnosing
 * - Sales Flow: pitching, handling_objection, closing, post_registration
 * - Education Flow: education_redirect
 * - Support Flow: technical_support, deposit_support, platform_support, withdrawal_support
 * - Terminal: completed, escalated, follow_up, disqualified
 */
export const STATE_CONFIGS: Record<ConversationState, StateConfig> = {
  // ===========================================================================
  // ENTRY STATES
  // ===========================================================================
  
  initial: {
    state: 'initial',
    objective: 'Greet user and detect intent/segment',
    description: 'First contact. Warm greeting, detect if new prospect, returning customer, or specific inquiry (promotions, support). Route to appropriate flow based on intent.',
    completionSignals: [
      'User responds with identifiable intent',
      'User asks about product information',
      'User mentions existing account',
      'User asks about promotions or bonuses',
      'User reports an issue',
    ],
    ragCategories: ['Preguntas Frecuentes'],
    allowedTransitions: ['qualifying', 'returning_customer', 'promotion_inquiry', 'technical_support', 'escalated'],
    transitionGuidance: {
      qualifying: 'User shows interest in product info or wants to learn about leveraged accounts.',
      returning_customer: 'User indicates they already have an account ("ya tengo cuenta", "soy cliente").',
      promotion_inquiry: 'User mentions bonus, free account, promo, or Instagram ad.',
      technical_support: 'User reports an issue immediately (login, platform, etc.).',
      escalated: 'User explicitly requests human agent.',
    },
    maxMessages: 2,
  },
  
  returning_customer: {
    state: 'returning_customer',
    objective: 'Identify existing customer needs and route appropriately',
    description: 'User has indicated they already have an account. Determine if they need support, want to add funds, or have questions.',
    completionSignals: [
      'User specifies their need',
      'User asks about withdrawals',
      'User asks about deposits',
      'User reports a platform issue',
    ],
    ragCategories: ['Manejo de la Cuenta', 'Depósitos y Retiros'],
    allowedTransitions: ['withdrawal_support', 'deposit_support', 'platform_support', 'technical_support', 'pitching', 'escalated'],
    transitionGuidance: {
      withdrawal_support: 'User asks about withdrawals or has pending withdrawal.',
      deposit_support: 'User asks about deposits or adding funds.',
      platform_support: 'User has MT5 or trading issues.',
      technical_support: 'User has login or account access issues.',
      pitching: 'User wants to open an additional account.',
      escalated: 'Complex issue or user requests human.',
    },
    maxMessages: 2,
  },
  
  promotion_inquiry: {
    state: 'promotion_inquiry',
    objective: 'Clarify promotion terms and convert interest to registration',
    description: 'User saw an ad about free account/bonus. Clarify that bonus requires purchasing a real account. Convert interest to understanding the value proposition.',
    completionSignals: [
      'User understands the promotion terms',
      'User wants to learn more about the product',
      'User is not interested after clarification',
    ],
    ragCategories: ['Promociones', '12x Cuentas Amplificadas'],
    allowedTransitions: ['qualifying', 'pitching', 'disqualified', 'escalated'],
    transitionGuidance: {
      qualifying: 'User wants to learn more about the product after promotion clarification.',
      pitching: 'User understands promotion and wants to proceed with purchase.',
      disqualified: 'User only wanted free account, not interested in paying.',
      escalated: 'User frustrated or confused after explanation.',
    },
    maxMessages: 3,
  },
  
  // ===========================================================================
  // QUALIFICATION STATES
  // ===========================================================================
  
  qualifying: {
    state: 'qualifying',
    objective: 'Assess trading experience and understand needs',
    description: 'Determine user\'s trading background. This is the key branching point between sales flow and education flow. Ask about experience level to tailor the conversation.',
    completionSignals: [
      'User indicates experience level (beginner/experienced)',
      'User says they have been trading for X time',
      'User asks for signals or help trading (beginner signal)',
      'User asks specific product questions (ready for pitch)',
    ],
    ragCategories: ['Preguntas Frecuentes', 'Conceptos generales de Trading'],
    allowedTransitions: ['pitching', 'diagnosing', 'education_redirect', 'escalated'],
    transitionGuidance: {
      pitching: 'User has trading experience (1+ year) or directly asks about the product.',
      diagnosing: 'User has some experience but needs more context before pitching.',
      education_redirect: 'User is complete beginner, asks for signals, or says they have no experience.',
      escalated: 'User requests human help.',
    },
    maxMessages: 4,
  },
  
  diagnosing: {
    state: 'diagnosing',
    objective: 'Understand specific needs and pain points',
    description: 'For users who need more context before pitching. Understand their goals, current challenges, and what they are looking for in a broker.',
    completionSignals: [
      'User shares their goals or concerns',
      'User asks about specific features',
      'User seems ready to hear the offer',
      'User reveals they need education first',
    ],
    ragCategories: ['Tipos de Cuentas', 'Condiciones De Trading'],
    allowedTransitions: ['pitching', 'education_redirect', 'escalated'],
    transitionGuidance: {
      pitching: 'User ready to hear the offer after sharing their needs.',
      education_redirect: 'User reveals they need education first.',
      escalated: 'User requests human help or conversation going nowhere.',
    },
    maxMessages: 3,
  },
  
  // ===========================================================================
  // EDUCATION FLOW
  // ===========================================================================
  
  education_redirect: {
    state: 'education_redirect',
    objective: 'Redirect beginner to appropriate educational resources',
    description: 'User is not ready for leveraged accounts. Redirect to TAG Academy or educational content. Maintain relationship for future conversion.',
    completionSignals: [
      'User accepts education path',
      'User declines education',
      'User insists on leveraged account despite warning',
    ],
    ragCategories: ['Academia', 'Conceptos generales de Trading'],
    allowedTransitions: ['completed', 'pitching', 'disqualified', 'escalated'],
    transitionGuidance: {
      completed: 'User accepts education redirect.',
      pitching: 'User insists they want leveraged account despite beginner warning.',
      disqualified: 'User not interested in education.',
      escalated: 'User requests human help.',
    },
    maxMessages: 3,
  },
  
  // ===========================================================================
  // SALES FLOW
  // ===========================================================================
  
  pitching: {
    state: 'pitching',
    objective: 'Present TAG Markets x12 offering tailored to user needs',
    description: 'Core sales pitch. Explain the 12x leverage, key benefits (100% profits, no exam, day-1 withdrawals), and differentiation. Adapt based on qualification insights.',
    completionSignals: [
      'User shows buying intent (asks how to register)',
      'User raises objection or concern',
      'User asks about pricing/minimum deposit',
      'User says they want to start',
    ],
    ragCategories: ['12x Cuentas Amplificadas', 'Tipos de Cuentas', 'Condiciones De Trading'],
    allowedTransitions: ['closing', 'handling_objection', 'escalated'],
    transitionGuidance: {
      closing: 'User shows buying signals: asks about registration, pricing, or says they want to start.',
      handling_objection: 'User raises concerns, doubts, or objections (safety, legitimacy, pricing).',
      escalated: 'User requests human help.',
    },
    maxMessages: 5,
  },
  
  handling_objection: {
    state: 'handling_objection',
    objective: 'Address concerns with empathy and facts',
    description: 'User has raised a concern or objection. Listen, acknowledge, and address with facts. Common objections: legitimacy/scam, pricing, complexity, drawdown rule.',
    completionSignals: [
      'User accepts the explanation',
      'User asks a new question (objection resolved)',
      'User wants to proceed',
    ],
    ragCategories: ['Preguntas Frecuentes', 'Regulación', 'Condiciones De Trading'],
    allowedTransitions: ['pitching', 'closing', 'escalated'],
    transitionGuidance: {
      pitching: 'Objection resolved, user wants more info.',
      closing: 'Objection resolved, user ready to proceed.',
      escalated: 'User remains unconvinced or requests human.',
    },
    maxMessages: 4,
  },
  
  closing: {
    state: 'closing',
    objective: 'Guide user to registration with clear next steps',
    description: 'User is ready to sign up. Provide registration link, explain the process (Register → KYC → Deposit → Amplify → MT5), capture attribution.',
    completionSignals: [
      'User confirms they registered',
      'User asks about next steps after registration',
      'User has last-minute hesitation',
    ],
    ragCategories: ['Manejo de la Cuenta', 'Guías & Tutoriales'],
    allowedTransitions: ['post_registration', 'handling_objection', 'escalated'],
    transitionGuidance: {
      post_registration: 'User confirms registration or asks about next steps.',
      handling_objection: 'User raises last-minute concerns.',
      escalated: 'User requests human help.',
    },
    maxMessages: 3,
  },
  
  post_registration: {
    state: 'post_registration',
    objective: 'Confirm registration and guide to first deposit',
    description: 'User has registered. Congratulate, verify KYC status, and guide to deposit. Explain deposit methods and next steps.',
    completionSignals: [
      'User confirms deposit made',
      'User has deposit questions',
      'User asks about MT5 setup',
    ],
    ragCategories: ['Depósitos y Retiros', 'Guías & Tutoriales'],
    allowedTransitions: ['deposit_support', 'platform_support', 'completed', 'escalated'],
    transitionGuidance: {
      deposit_support: 'User has questions or issues with deposit.',
      platform_support: 'User asks about MT5 setup.',
      completed: 'User confirms successful deposit.',
      escalated: 'User has persistent issues or requests human.',
    },
    maxMessages: 4,
  },
  
  // ===========================================================================
  // SUPPORT FLOW
  // ===========================================================================
  
  technical_support: {
    state: 'technical_support',
    objective: 'Resolve login, registration, or account access issues',
    description: 'User cannot log in, register, or access their account. Common issues: password reset, KYC verification, email not recognized.',
    completionSignals: [
      'Issue resolved',
      'User can access their account',
      'Issue requires backend intervention',
    ],
    ragCategories: ['Manejo de la Cuenta', 'Guías & Tutoriales'],
    allowedTransitions: ['post_registration', 'completed', 'escalated'],
    transitionGuidance: {
      post_registration: 'Login issue resolved, user can proceed with onboarding.',
      completed: 'Issue resolved.',
      escalated: 'Technical issue requires backend intervention.',
    },
    maxMessages: 5,
  },
  
  deposit_support: {
    state: 'deposit_support',
    objective: 'Help with deposit process and troubleshoot issues',
    description: 'User needs help making a deposit or has a failed deposit. Explain methods (Crypto, Card, PSE), troubleshoot rejections, guide crypto deposits.',
    completionSignals: [
      'Deposit successful',
      'Issue identified and explained',
      'User needs MT5 help after deposit',
    ],
    ragCategories: ['Depósitos y Retiros', 'Guías & Tutoriales'],
    allowedTransitions: ['platform_support', 'completed', 'escalated'],
    transitionGuidance: {
      platform_support: 'Deposit done, user needs MT5 help.',
      completed: 'Deposit confirmed successful.',
      escalated: 'Deposit stuck, needs manual review.',
    },
    maxMessages: 5,
  },
  
  platform_support: {
    state: 'platform_support',
    objective: 'Help with MT5 setup and trading issues',
    description: 'User has MT5 or trading platform issues. Common: server not found, trade disabled, wrong symbols. Key fix: use .f suffix on symbols.',
    completionSignals: [
      'User can trade successfully',
      'Issue resolved',
      'Persistent platform issue',
    ],
    ragCategories: ['Plataformas De Trading', 'Guías & Tutoriales'],
    allowedTransitions: ['completed', 'escalated'],
    transitionGuidance: {
      completed: 'User confirms they can trade.',
      escalated: 'Persistent platform issue.',
    },
    maxMessages: 5,
  },
  
  withdrawal_support: {
    state: 'withdrawal_support',
    objective: 'Guide withdrawal process and handle delays',
    description: 'User wants to withdraw or has a pending withdrawal. Explain process (MT5 → Amplify → Wallet), check status, reassure on timing.',
    completionSignals: [
      'User understands process',
      'Withdrawal confirmed',
      'Withdrawal delayed needs investigation',
    ],
    ragCategories: ['Depósitos y Retiros', 'Guías & Tutoriales'],
    allowedTransitions: ['completed', 'escalated'],
    transitionGuidance: {
      completed: 'Withdrawal confirmed or user satisfied.',
      escalated: 'Withdrawal delayed >24h, needs investigation.',
    },
    maxMessages: 4,
  },
  
  // ===========================================================================
  // TERMINAL STATES
  // ===========================================================================
  
  follow_up: {
    state: 'follow_up',
    objective: 'Re-engage dormant conversation',
    description: 'Scheduled follow-up for users who went quiet. Gentle reminder of value proposition. Not pushy.',
    completionSignals: [
      'User re-engages with interest',
      'User explicitly declines',
      'User asks to stop messages',
    ],
    ragCategories: ['12x Cuentas Amplificadas', 'Tipos de Cuentas'],
    allowedTransitions: ['qualifying', 'pitching', 'completed', 'escalated'],
    transitionGuidance: {
      qualifying: 'User re-engages but needs more information.',
      pitching: 'User re-engages with interest.',
      completed: 'User explicitly declines or asks to stop.',
      escalated: 'User requests human help.',
    },
  },
  
  escalated: {
    state: 'escalated',
    objective: 'Human agent has taken over',
    description: 'Conversation handed off to human agent. Bot should not send automatic responses. Triggered by: explicit request, persistent issues, frustration.',
    completionSignals: [],
    ragCategories: [],
    allowedTransitions: ['qualifying', 'completed'],
    transitionGuidance: {
      qualifying: 'Human agent returns conversation to bot.',
      completed: 'Human agent closes the conversation.',
    },
  },
  
  completed: {
    state: 'completed',
    objective: 'Conversation successfully concluded',
    description: 'Positive conclusion. User converted, issue resolved, or gracefully ended.',
    completionSignals: [],
    ragCategories: [],
    allowedTransitions: ['follow_up'],
    transitionGuidance: {
      follow_up: 'For scheduled follow-up messages after time has passed.',
    },
  },
  
  disqualified: {
    state: 'disqualified',
    objective: 'Gracefully end non-viable conversation',
    description: 'User is not a fit (only wanted free stuff, wrong number, spam). End politely without burning bridge.',
    completionSignals: [],
    ragCategories: [],
    allowedTransitions: ['follow_up'],
    transitionGuidance: {
      follow_up: 'For potential re-engagement after cooling off period.',
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
   * @deprecated Use LLM-driven transitions via buildTransitionContext() instead
   * Kept for backward compatibility
   */
  suggestTransition(_messageContent: string): ConversationState | null {
    // Auto-transition from initial to qualifying on any user message
    if (this.currentState === 'initial') {
      return 'qualifying';
    }
    return null;
  }
  
  /**
   * Create from session
   */
  static fromSession(session: Session): StateMachine {
    const machine = new StateMachine(session.currentState);
    return machine;
  }
}
