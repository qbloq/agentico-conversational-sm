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
 * Based on the sales_bot.spec.md decision tree
 */
export const STATE_CONFIGS: Record<ConversationState, StateConfig> = {
  initial: {
    state: 'initial',
    objective: 'Greet the user warmly and validate their interest',
    description: 'First contact with the user. Acknowledge their message, introduce yourself briefly, and confirm they are interested in learning about leveraged trading accounts.',
    completionSignals: [
      'User confirms interest in leveraged accounts',
      'User asks a question about the product',
      'User responds to greeting',
    ],
    ragCategories: ['Preguntas Frecuentes', 'Manejo de la Cuenta'],
    allowedTransitions: ['qualifying', 'escalated'],
    transitionGuidance: {
      qualifying: 'Move here after user responds to greeting or shows any interest. This is the natural next step for any engaged user.',
      escalated: 'Only if user explicitly asks for human help or shows immediate frustration.',
    },
  },
  
  qualifying: {
    state: 'qualifying',
    objective: 'Assess trading experience level and understand their needs',
    description: 'Determine if the user has trading experience and what they are looking for. Ask about their background with trading/investing. This helps tailor the pitch.',
    completionSignals: [
      'User indicates experience level (beginner/experienced)',
      'User explains what they are looking for',
      'User asks specific product questions (ready for pitch)',
    ],
    ragCategories: ['Preguntas Frecuentes', 'Conceptos generales de Trading'],
    allowedTransitions: ['diagnosing', 'pitching', 'escalated'],
    transitionGuidance: {
      diagnosing: 'If user is new to trading or seems confused, dig deeper into their needs and pain points.',
      pitching: 'If user has experience or directly asks about the product/pricing, move to presenting the offer.',
      escalated: 'If user requests human help or shows frustration.',
    },
    maxMessages: 5,
  },
  
  diagnosing: {
    state: 'diagnosing',
    objective: 'Understand specific pain points and what they are looking for',
    description: 'For users who need more guidance. Understand their goals, concerns about trading, and what would make them feel confident to start.',
    completionSignals: [
      'User shares their goals or concerns',
      'User asks how TAG can help them',
      'User seems ready to hear the offer',
    ],
    ragCategories: ['Tipos de Cuentas', 'Condiciones De Trading'],
    allowedTransitions: ['pitching', 'escalated'],
    transitionGuidance: {
      pitching: 'Once you understand their needs, present the TAG offering tailored to what they shared.',
      escalated: 'If user requests human help or the conversation is going nowhere.',
    },
    maxMessages: 4,
  },
  
  pitching: {
    state: 'pitching',
    objective: 'Present TAG Markets offering tailored to their needs',
    description: 'Explain the 12x leveraged accounts, key benefits (100% profits, instant withdrawals, no exam). Adapt the pitch based on their experience level and stated needs.',
    completionSignals: [
      'User expresses interest in signing up',
      'User asks how to register',
      'User raises objection or concern',
      'User says they understand and want to proceed',
    ],
    ragCategories: ['Tipos de Cuentas', '12x Cuentas Amplificadas', 'Condiciones De Trading'],
    allowedTransitions: ['handling_objection', 'closing', 'escalated'],
    transitionGuidance: {
      handling_objection: 'If user raises concerns, doubts, or objections (safety, legitimacy, pricing, etc.).',
      closing: 'If user shows buying signals: asks about registration, pricing, or says they want to start.',
      escalated: 'If user requests human help or shows frustration.',
    },
    maxMessages: 6,
  },
  
  handling_objection: {
    state: 'handling_objection',
    objective: 'Address concerns and objections with empathy and facts',
    description: 'User has raised a concern or objection. Listen, acknowledge their concern, and address it with facts from the knowledge base. Common objections: safety/scam concerns, pricing, platform questions.',
    completionSignals: [
      'User accepts the explanation',
      'User asks a new question (objection resolved)',
      'User wants to proceed despite initial concern',
    ],
    ragCategories: ['Preguntas Frecuentes', 'Depósitos y Retiros', 'Plataformas De Trading'],
    allowedTransitions: ['pitching', 'closing', 'escalated'],
    transitionGuidance: {
      pitching: 'If objection is resolved and user wants to hear more about the product.',
      closing: 'If objection is resolved and user is ready to sign up.',
      escalated: 'If user remains unconvinced after multiple attempts or requests human help.',
    },
    maxMessages: 5,
  },
  
  closing: {
    state: 'closing',
    objective: 'Guide user to registration with clear next steps',
    description: 'User is ready to sign up. Provide registration link, explain the process (Register → KYC → Deposit), and capture their email for attribution.',
    completionSignals: [
      'User confirms they registered',
      'User provides email',
      'User asks about deposit methods',
    ],
    ragCategories: ['Manejo de la Cuenta', 'Guías & Tutoriales'],
    allowedTransitions: ['post_registration', 'handling_objection', 'escalated'],
    transitionGuidance: {
      post_registration: 'Once user confirms they have registered or asks about next steps after registration.',
      handling_objection: 'If user raises last-minute concerns or hesitation.',
      escalated: 'If user requests human help.',
    },
  },
  
  post_registration: {
    state: 'post_registration',
    objective: 'Confirm registration and guide to first deposit',
    description: 'User has registered. Congratulate them, explain KYC process if needed, and guide them to make their first deposit.',
    completionSignals: [
      'User confirms deposit made',
      'User asks about deposit issues',
      'User says they will deposit later',
    ],
    ragCategories: ['Depósitos y Retiros', 'Guías & Tutoriales'],
    allowedTransitions: ['deposit_support', 'completed', 'escalated'],
    transitionGuidance: {
      deposit_support: 'If user has questions or issues with the deposit process.',
      completed: 'If user confirms successful deposit or explicitly ends the conversation positively.',
      escalated: 'If user has persistent issues or requests human help.',
    },
  },
  
  deposit_support: {
    state: 'deposit_support',
    objective: 'Help with deposit process and troubleshoot issues',
    description: 'User needs help with deposits. Explain available methods (Crypto, Card, PSE), troubleshoot issues, analyze payment receipts if shared.',
    completionSignals: [
      'User confirms deposit successful',
      'Issue resolved',
      'User needs human intervention for complex issue',
    ],
    ragCategories: ['Depósitos y Retiros', 'Plataformas De Trading'],
    allowedTransitions: ['completed', 'escalated'],
    transitionGuidance: {
      completed: 'If deposit is confirmed successful or issue is resolved.',
      escalated: 'If technical issue persists and requires human intervention.',
    },
  },
  
  follow_up: {
    state: 'follow_up',
    objective: 'Re-engage user who went quiet with value reminder',
    description: 'User has not responded for a while. Send a friendly follow-up reminding them of the value proposition. Do not be pushy.',
    completionSignals: [
      'User re-engages with interest',
      'User explicitly declines',
      'User asks to stop messages',
    ],
    ragCategories: ['Tipos de Cuentas', '12x Cuentas Amplificadas'],
    allowedTransitions: ['qualifying', 'pitching', 'completed', 'escalated'],
    transitionGuidance: {
      qualifying: 'If user re-engages but seems to need more information.',
      pitching: 'If user re-engages with interest in the product.',
      completed: 'If user explicitly declines or asks to stop.',
      escalated: 'If user requests human help.',
    },
  },
  
  escalated: {
    state: 'escalated',
    objective: 'Human agent has taken over - bot should not respond',
    description: 'Conversation has been handed off to a human agent. Bot should not send automatic responses.',
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
    description: 'Conversation has ended successfully. User has either converted or explicitly ended the conversation.',
    completionSignals: [],
    ragCategories: [],
    allowedTransitions: ['follow_up'],
    transitionGuidance: {
      follow_up: 'For scheduled follow-up messages after some time has passed.',
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
