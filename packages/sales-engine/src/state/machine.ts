/**
 * State Machine for conversation flow
 */

import type { ConversationState, Session } from '../engine/types.js';

/**
 * Configuration for each state
 */
export interface StateConfig {
  /** What the bot should accomplish in this state */
  objective: string;
  
  /** KB categories to prioritize for RAG */
  ragCategories: string[];
  
  /** Allowed transitions from this state */
  allowedTransitions: ConversationState[];
  
  /** Keywords/patterns that suggest moving to this state */
  entryPatterns?: string[];
  
  /** Max messages before auto-transition (optional) */
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
    objective: 'Greet the user warmly and identify if they have trading experience',
    ragCategories: ['Preguntas Frecuentes', 'Manejo de la Cuenta'],
    allowedTransitions: ['qualifying', 'escalated'],
    entryPatterns: ['hola', 'buenos días', 'buenas tardes', 'hi', 'hello'],
  },
  
  qualifying: {
    objective: 'Assess trading experience level and understand their needs',
    ragCategories: ['Preguntas Frecuentes', 'Conceptos generales de Trading'],
    allowedTransitions: ['diagnosing', 'pitching', 'escalated'],
    maxMessages: 5,
  },
  
  diagnosing: {
    objective: 'Understand specific pain points and what they are looking for',
    ragCategories: ['Tipos de Cuentas', 'Condiciones De Trading'],
    allowedTransitions: ['pitching', 'escalated'],
    maxMessages: 4,
  },
  
  pitching: {
    objective: 'Present TAG Markets offering tailored to their needs',
    ragCategories: ['Tipos de Cuentas', '12x Cuentas Amplificadas', 'Condiciones De Trading'],
    allowedTransitions: ['handling_objection', 'closing', 'escalated'],
    maxMessages: 6,
  },
  
  handling_objection: {
    objective: 'Address concerns and objections with empathy and facts',
    ragCategories: ['Preguntas Frecuentes', 'Depósitos y Retiros', 'Plataformas De Trading'],
    allowedTransitions: ['pitching', 'closing', 'escalated'],
    entryPatterns: ['no sé', 'no estoy seguro', 'es seguro', 'estafa', 'scam', 'caro'],
    maxMessages: 5,
  },
  
  closing: {
    objective: 'Guide user to registration with clear next steps',
    ragCategories: ['Manejo de la Cuenta', 'Guías & Tutoriales'],
    allowedTransitions: ['post_registration', 'handling_objection', 'escalated'],
    entryPatterns: ['registrar', 'crear cuenta', 'empezar', 'comenzar'],
  },
  
  post_registration: {
    objective: 'Confirm registration and guide to first deposit',
    ragCategories: ['Depósitos y Retiros', 'Guías & Tutoriales'],
    allowedTransitions: ['deposit_support', 'completed', 'escalated'],
  },
  
  deposit_support: {
    objective: 'Help with deposit process and troubleshoot issues',
    ragCategories: ['Depósitos y Retiros', 'Plataformas De Trading'],
    allowedTransitions: ['completed', 'escalated'],
    entryPatterns: ['depositar', 'pago', 'transferencia', 'cripto'],
  },
  
  follow_up: {
    objective: 'Re-engage user who went quiet with value reminder',
    ragCategories: ['Tipos de Cuentas', '12x Cuentas Amplificadas'],
    allowedTransitions: ['qualifying', 'pitching', 'completed', 'escalated'],
  },
  
  escalated: {
    objective: 'Human agent has taken over - bot should not respond',
    ragCategories: [],
    allowedTransitions: ['qualifying', 'completed'], // Only human can transition out
  },
  
  completed: {
    objective: 'Conversation successfully concluded',
    ragCategories: [],
    allowedTransitions: ['follow_up'], // Can re-open for follow-up
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
   * Suggest next state based on message content
   */
  suggestTransition(messageContent: string): ConversationState | null {
    const lowerContent = messageContent.toLowerCase();
    const config = STATE_CONFIGS[this.currentState];
    
    // Check each allowed transition for entry patterns
    for (const targetState of config.allowedTransitions) {
      const targetConfig = STATE_CONFIGS[targetState];
      if (targetConfig.entryPatterns) {
        for (const pattern of targetConfig.entryPatterns) {
          if (lowerContent.includes(pattern)) {
            return targetState;
          }
        }
      }
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
