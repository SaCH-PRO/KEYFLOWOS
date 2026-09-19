import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

export type SystemEmailProviderOutcome = 'FAILED_CONFIRMED' | 'OUTCOME_UNKNOWN';

export class SystemEmailSendError extends Error {
  constructor(
    message: string,
    readonly outcome: SystemEmailProviderOutcome,
    readonly providerCode?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'SystemEmailSendError';
  }
}

export function resolveSystemEmailFrom(env: NodeJS.ProcessEnv = process.env): string | null {
  const addr = env.EMAIL_FROM_ADDRESS?.trim();
  if (!addr) return null;
  const rawName = env.EMAIL_FROM_NAME?.trim();
  const name = (rawName && rawName.length > 0 ? rawName : 'Keyflow').replace(/"/g, '');
  return `${name} <${addr}>`;
}

/**
 * System-level transactional email sender.
 *
 * Distinct from the per-business `TransactionalEmailService`/`GmailService`
 * (which sends business-flavored notifications using each business's own
 * Gmail integration). This service sends platform-level transactional mail
 * (signup verification, password reset, system alerts) from Keyflow's own
 * "from" address via Resend, completely separately from any tenant's mailbox.
 */
@Injectable()
export class SystemEmailService {
  private readonly logger = new Logger(SystemEmailService.name);
  private resend: Resend | null = null;
  private warned = false;

  isConfigured(): boolean {
    return Boolean(this.getApiKey() && resolveSystemEmailFrom());
  }

  describeMissingConfig(): string | null {
    const missing: string[] = [];
    if (!this.getApiKey()) missing.push('RESEND_API_KEY');
    if (!process.env.EMAIL_FROM_ADDRESS?.trim()) missing.push('EMAIL_FROM_ADDRESS');
    return missing.length ? missing.join(', ') : null;
  }

  private getApiKey(): string | null {
    const v = process.env.RESEND_API_KEY?.trim();
    return v && v.length > 0 ? v : null;
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
    if (!this.resend) this.resend = new Resend(key);
    return this.resend;
  }

  /**
   * Send one email through Resend.
   *
   * `from` and `idempotencyKey` are optional so all historical system-email
   * callers remain unchanged. EXTFX-001 supplies them only for a bound
   * OutboundDelivery effect, where exact payload replay is required.
   */
  async sendTransactional(args: {
    to: string;
    subject: string;
    html: string;
    text?: string;
    replyTo?: string;
    attachments?: Array<{ filename: string; content: Buffer | string; contentType?: string }>;
    from?: string;
    idempotencyKey?: string;
  }): Promise<{ id: string }> {
    if (!args.to || !args.subject || !args.html) {
      throw new Error('sendTransactional requires to, subject and html');
    }

    const client = this.getClient();
    const from = args.from ?? resolveSystemEmailFrom();
    if (!client || !from) {
      throw new Error(
        'System email sender is not configured. Set RESEND_API_KEY and EMAIL_FROM_ADDRESS.',
      );
    }

    const payload = {
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
        ? await client.emails.send(payload, { idempotencyKey: args.idempotencyKey })
        : await client.emails.send(payload);

      if (result.error) {
        const providerCode = String((result.error as { name?: string }).name ?? 'RESEND_REJECTED');
        throw new SystemEmailSendError(
          result.error.message || 'Resend send failed',
          'FAILED_CONFIRMED',
          providerCode,
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
        undefined,
        { cause: err },
      );
    }
  }
}
