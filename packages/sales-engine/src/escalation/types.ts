/**
 * Escalation Types
 */

export interface NotificationService {
  sendEscalationAlert(
    to: string,
    context: {
      reason: string;
      userName: string;
      userPhone: string;
      summary: string;
      link?: string;
    }
  ): Promise<void>;
}
