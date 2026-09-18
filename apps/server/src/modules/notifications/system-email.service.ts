import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

export type SystemEmailOutcomeCertainty = 'FAILED_CONFIRMED' | 'OUTCOME_UNKNOWN';

export class SystemEmailSendError extends Error {
  constructor(
    message: string,
    readonly outcomeCertainty: SystemEmailOutcomeCertainty,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'SystemEmailSendError';
  }
}

/**
 * System-level transactional email sender.
 */
@Injectable()
export class SystemEmailService {
  private readonly logger = new Logger(SystemEmailService.name);
  private resend: Resend | null = null;
  private warned = false;

  isConfigured(): boolean {
    return Boolean(this.getApiKey() && this.getFromAddress());
  }

  describeMissingConfig(): string | null {
    const missing: string[] = [];
    if (!this.getApiKey()) missing.push('RESEND_API_KEY');
    if (!this.getFromAddress()) missing.push('EMAIL_FROM_ADDRESS');
    return missing.length ? missing.join(', ') : null;
  }

  private getApiKey(): string | null {
    const v = process.env.RESEND_API_KEY?.trim();
    return v && v.length > 0 ? v : null;
  }

  private getFromAddress(): string | null {
    const v = process.env.EMAIL_FROM_ADDRESS?.trim();
    return v && v.length > 0 ? v : null;
  }

  private getFromName(): string {
    const v = process.env.EMAIL_FROM_NAME?.trim();
    return v && v.length > 0 ? v : 'Keyflow';
  }

  private formatFrom(): string {
    const addr = this.getFromAddress();
    if (!addr) return '';
    const name = this.getFromName().replace(/"/g, '');
    return `${name} <${addr}>`;
  }

  getSenderIdentity(): string | null {
    const from = this.formatFrom();
    return from || null;
  }

  private getClient(): Resend | null {
    const key = this.getApiKey();
    if (!key) {
      if (!this.warned) {
        this.warned = true;
        this.logger.warn(
          'RESEND_API_KEY is not set — system transactional emails (signup verification, etc.) will be skipped.',
        );
      }
      return null;
    }
    if (!this.resend) {
      this.resend = new Resend(key);
    }
    return this.resend;
  }

  async sendTransactional(args: {
    to: string;
    from?: string;
    subject: string;
    html: string;
    text?: string;
    replyTo?: string;
    idempotencyKey?: string;
    attachments?: Array<{ filename: string; content: Buffer | string; contentType?: string }>;
  }): Promise<{ id: string }> {
    if (!args.to || !args.subject || !args.html) {
      throw new SystemEmailSendError(
        'sendTransactional requires to, subject and html',
        'FAILED_CONFIRMED',
      );
    }

    const client = this.getClient();
    const from = args.from ?? this.formatFrom();
    if (!client || !from) {
      throw new SystemEmailSendError(
        'System email sender is not configured. Set RESEND_API_KEY and EMAIL_FROM_ADDRESS.',
        'FAILED_CONFIRMED',
      );
    }

    const email = {
      from,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
      replyTo: args.replyTo,
      attachments: args.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    };

    try {
      const result = args.idempotencyKey
        ? await client.emails.send(email, { idempotencyKey: args.idempotencyKey })
        : await client.emails.send(email);

      if (result.error) {
        throw new SystemEmailSendError(
          result.error.message || 'Resend send failed',
          'FAILED_CONFIRMED',
          { cause: result.error },
        );
      }

      const id = result.data?.id ?? '';
      this.logger.log(`Sent transactional email to ${args.to} (id=${id})`);
      return { id };
    } catch (err: unknown) {
      if (err instanceof SystemEmailSendError) {
        this.logger.error(`Resend send failed for ${args.to}: ${err.message}`);
        throw err;
      }

      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Resend send outcome unknown for ${args.to}: ${message}`);
      throw new SystemEmailSendError(
        `Failed to send email: ${message}`,
        'OUTCOME_UNKNOWN',
        { cause: err },
      );
    }
  }
}
