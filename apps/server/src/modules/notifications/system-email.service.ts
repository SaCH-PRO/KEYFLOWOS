import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

/**
 * System-level transactional email sender.
 *
 * Distinct from the per-business `TransactionalEmailService`/`GmailService`
 * (which sends business-flavored notifications using each business's own
 * Gmail integration). This service sends platform-level transactional mail
 * (signup verification, password reset, system alerts) from Keyflow's own
 * "from" address via Resend, completely separately from any tenant's mailbox.
 *
 * Reads:
 *   - RESEND_API_KEY        (required to actually send)
 *   - EMAIL_FROM_ADDRESS    (e.g. "no-reply@keyflow.os")
 *   - EMAIL_FROM_NAME       (defaults to "Keyflow")
 */
@Injectable()
export class SystemEmailService {
  private readonly logger = new Logger(SystemEmailService.name);
  private resend: Resend | null = null;
  private warned = false;

  isConfigured(): boolean {
    return Boolean(this.getApiKey() && this.getFromAddress());
  }

  /**
   * Returns a human-readable description of which env vars are missing,
   * or `null` when fully configured. Used by the bootstrap guardrail.
   */
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

  /**
   * Send a single transactional email from Keyflow's own from-address.
   * Returns the provider message id on success or throws on failure.
   */
  async sendTransactional(args: {
    to: string;
    subject: string;
    html: string;
    text?: string;
    replyTo?: string;
    attachments?: Array<{ filename: string; content: Buffer | string; contentType?: string }>;
  }): Promise<{ id: string }> {
    if (!args.to || !args.subject || !args.html) {
      throw new Error('sendTransactional requires to, subject and html');
    }
    const client = this.getClient();
    const from = this.formatFrom();
    if (!client || !from) {
      throw new Error(
        'System email sender is not configured. Set RESEND_API_KEY and EMAIL_FROM_ADDRESS.',
      );
    }
    try {
      const result = await client.emails.send({
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
      });
      if (result.error) {
        throw new Error(result.error.message || 'Resend send failed');
      }
      const id = result.data?.id ?? '';
      this.logger.log(`Sent transactional email to ${args.to} (id=${id})`);
      return { id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Resend send failed for ${args.to}: ${message}`);
      throw new Error(`Failed to send email: ${message}`);
    }
  }
}
