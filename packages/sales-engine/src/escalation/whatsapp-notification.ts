/**
 * WhatsApp Notification Service
 */
import type { NotificationService } from './types.js';

export class WhatsAppNotificationService implements NotificationService {
  private phoneNumberId: string;
  private accessToken: string;
  private templateName: string;

  constructor(config: { phoneNumberId: string; accessToken: string; templateName: string }) {
    this.phoneNumberId = config.phoneNumberId;
    this.accessToken = config.accessToken;
    this.templateName = config.templateName;
  }

  async sendEscalationAlert(
    to: string,
    context: {
      reason: string;
      userName: string;
      userPhone: string;
      summary: string;
    }
  ): Promise<void> {
    const url = `https://graph.facebook.com/v24.0/${this.phoneNumberId}/messages`;
    
    const body = {
      messaging_product: 'whatsapp',
      to: to,
      type: 'template',
      template: {
        name: this.templateName,
        language: { code: 'es' },
        components: [
          {
            type: 'body',
            parameters: [
              // These must match the template variables {{1}}, {{2}}, etc.
              // Assuming: Alert: User {{1}} ({{2}}) needs help. Reason: {{3}}. Summary: {{4}}
              { type: 'text', text: context.userName },
              { type: 'text', text: context.userPhone },
              { type: 'text', text: context.reason },
              { type: 'text', text: context.summary },
            ],
          },
        ],
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to send WhatsApp notification: ${error}`);
    }
  }
}
