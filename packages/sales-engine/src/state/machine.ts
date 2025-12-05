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
 * State Machine class
 */
export class StateMachine {
  private currentState: ConversationState;
  private transitions: StateTransition[] = [];
  private config: Record<ConversationState, StateConfig>;
  
  constructor(initialState: ConversationState = 'initial', config: Record<ConversationState, StateConfig>) {
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
    
    const transitionOptions = config.allowedTransitions
      .filter(state => state !== 'escalated') // Escalation handled separately
      .map(state => {
        const guidance = config.transitionGuidance[state] || '';
        const targetConfig = this.config[state];
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
  static fromSession(session: Session, config: Record<ConversationState, StateConfig>): StateMachine {
    const machine = new StateMachine(session.currentState, config);
    return machine;
  }
}
