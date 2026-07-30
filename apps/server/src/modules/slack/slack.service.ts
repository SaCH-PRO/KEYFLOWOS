import { Injectable, Logger } from '@nestjs/common';

export interface SlackMessageBlock {
  type: 'section' | 'divider' | 'header' | 'context';
  text?: { type: 'mrkdwn' | 'plain_text'; text: string };
  fields?: Array<{ type: 'mrkdwn'; text: string }>;
}

export interface SlackMessagePayload {
  text: string;
  blocks?: SlackMessageBlock[];
  username?: string;
  icon_emoji?: string;
}

@Injectable()
export class SlackService {
  private readonly logger = new Logger(SlackService.name);

  async sendWebhook(webhookUrl: string, payload: SlackMessagePayload): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Slack webhook returned ${response.status}: ${text}`);
      }

      this.logger.log(`Slack message sent to ${webhookUrl.slice(0, 40)}...`);
      return { success: true };
    } catch (err: any) {
      const message = (err as Error).message;
      this.logger.error(`Slack webhook failed: ${message}`);
      return { success: false, error: message };
    }
  }

  formatEscalationMessage(params: {
    businessName: string;
    type: string;
    planId?: string;
    stepId?: string;
    toolName?: string;
    error?: string;
    message?: string;
    recentFailures?: number;
  }): SlackMessagePayload {
    const blocks: SlackMessageBlock[] = [
      {
        type: 'header',
        text: { type: 'plain_text', text: `🚨 KeyFlow AI Alert: ${params.type}` },
      },
      { type: 'divider' },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*Business:* ${params.businessName}` },
      },
    ];

    if (params.planId) {
      blocks.push({
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Plan:*\n${params.planId}` },
          { type: 'mrkdwn', text: `*Step:*\n${params.stepId ?? 'N/A'}` },
        ],
      });
    }

    if (params.toolName) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*Tool:* \`${params.toolName}\`` },
      });
    }

    if (params.error) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*Error:*\n\`\`\`${params.error.slice(0, 500)}\`\`\`` },
      });
    }

    if (params.message) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*Message:*\n${params.message}` },
      });
    }

    if (params.recentFailures) {
      blocks.push({
        type: 'context',
        text: { type: 'mrkdwn', text: `Recent failures (1h): *${params.recentFailures}*` },
      });
    }

    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `<https://keyflow.os/app/operations|View Operations Feed>` },
    });

    return {
      text: `KeyFlow AI Alert: ${params.type} for ${params.businessName}`,
      blocks,
      username: 'KeyFlow AI',
      icon_emoji: ':robot_face:',
    };
  }

  formatNotificationMessage(params: {
    businessName: string;
    title: string;
    description: string;
    actionUrl?: string;
    priority: 'low' | 'normal' | 'high' | 'critical';
  }): SlackMessagePayload {
    const emoji = { low: ':information_source:', normal: ':white_check_mark:', high: ':warning:', critical: ':fire:' };

    const blocks: SlackMessageBlock[] = [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `${emoji[params.priority]} *${params.title}*` },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: params.description },
      },
    ];

    if (params.actionUrl) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `<${params.actionUrl}|Take Action>` },
      });
    }

    return {
      text: `${params.title} — ${params.businessName}`,
      blocks,
      username: 'KeyFlow AI',
      icon_emoji: ':robot_face:',
    };
  }
}
