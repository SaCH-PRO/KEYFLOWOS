import {
  ChannelAdapter,
  PublishPayload,
  PublishResponse,
  AdapterCapabilities,
  NormalizedError,
} from './channel-adapter.interface';

export class EmailAdapter implements ChannelAdapter {
  readonly provider = 'GOOGLE';

  async publish(connection: any, destination: any, payload: PublishPayload): Promise<PublishResponse> {
    const accessToken = connection.token;
    const senderEmail = destination.platformId;

    if (!accessToken || !senderEmail) {
      return { success: false, errorCode: 'MISSING_CREDENTIALS', errorMessage: 'Missing Gmail access token or sender email', isTransient: false };
    }

    if (!payload.recipientEmail) {
      return { success: false, errorCode: 'MISSING_RECIPIENT', errorMessage: 'Recipient email is required for email delivery', isTransient: false };
    }

    try {
      const senderName = (payload.meta?.senderName as string) || destination.displayName;
      const from = senderName ? `${senderName} <${senderEmail}>` : senderEmail;
      const boundary = 'boundary_' + Date.now();
      const previewText = payload.meta?.previewText as string | undefined;
      let htmlBody = payload.htmlBody || payload.textBody || '';

      if (previewText) {
        const previewHtml = `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${previewText}</div>`;
        htmlBody = previewHtml + htmlBody;
      }

      const message = [
        `From: ${from}`,
        `To: ${payload.recipientEmail}`,
        `Subject: ${payload.subject ?? '(No Subject)'}`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/html; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        Buffer.from(htmlBody).toString('base64'),
        '',
        `--${boundary}--`,
      ].join('\r\n');

      const raw = Buffer.from(message)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, errorCode: 'GMAIL_SEND_ERROR', errorMessage: `Gmail API error: ${response.status} - ${errorText}`, isTransient: response.status >= 500 || response.status === 429 };
      }

      const result = (await response.json()) as any;
      return { success: true, externalPostId: result.id, raw: result };
    } catch (err) {
      const normalized = this.normalizeError(err);
      return { success: false, errorCode: normalized.code, errorMessage: normalized.message, isTransient: normalized.isTransient };
    }
  }

  normalizeError(error: unknown): NormalizedError {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      const isTransient = msg.includes('timeout') || msg.includes('econnreset') || msg.includes('rate limit') || msg.includes('429');
      return { code: isTransient ? 'TRANSIENT' : 'EMAIL_ERROR', message: error.message, isTransient };
    }
    return { code: 'UNKNOWN', message: String(error), isTransient: false };
  }

  getCapabilities(_platform: string): AdapterCapabilities {
    return { supports_text_post: false, supports_image_post: false, supports_video_post: false, supports_scheduled_post: false, supports_campaign_email: true, supports_template_message: true };
  }
}
