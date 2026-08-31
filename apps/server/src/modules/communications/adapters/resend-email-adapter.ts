import {
  ChannelAdapter,
  PublishPayload,
  PublishResponse,
  AdapterCapabilities,
  NormalizedError,
} from './channel-adapter.interface';
import { SystemEmailService } from '../../notifications/system-email.service';

/**
 * Send campaign and sequence email without a connected Gmail account.
 *
 * EmailAdapter is Gmail — `provider = 'GOOGLE'`, and it needs
 * `connection.token` (an OAuth access token) and a sender address from the
 * destination. The registry maps EMAIL straight onto it. So a business that
 * never connected Gmail had no way to send marketing or sequence email at all:
 * campaigns had nothing to dispatch through, and the CRM sequence dispatch
 * added earlier today correctly refused every step with "no active email
 * channel is connected".
 *
 * Resend is already in the stack and already sends this product's
 * transactional mail (signup verification and the rest) through
 * SystemEmailService. Nothing new is being introduced; it just was not
 * reachable from the outbound queue.
 *
 * WHAT THE TRADE IS, SO NOBODY DISCOVERS IT LATER. Mail sent this way leaves
 * the platform's own domain, not the merchant's. That is materially worse for
 * deliverability than sending from their own Gmail — SPF and DKIM belong to
 * us, replies land wherever EMAIL_FROM_ADDRESS points, and recipients see our
 * sending domain. It is a fallback for people who have not connected an
 * account, not a replacement for connecting one, and
 * MARKETING_ESP_FALLBACK=off turns it off entirely for anyone who would rather
 * send nothing than send from a shared domain.
 */
export class ResendEmailAdapter implements ChannelAdapter {
  readonly provider = 'RESEND';

  constructor(private readonly systemEmail = new SystemEmailService()) {}

  /** Off only when explicitly disabled; unset means on. */
  static isEnabled(): boolean {
    const flag = process.env.MARKETING_ESP_FALLBACK?.trim().toLowerCase();
    return flag !== 'off' && flag !== 'false' && flag !== '0';
  }

  async publish(
    _connection: unknown,
    destination: { platformId?: string | null },
    payload: PublishPayload,
  ): Promise<PublishResponse> {
    if (!ResendEmailAdapter.isEnabled()) {
      return {
        success: false,
        errorCode: 'ESP_FALLBACK_DISABLED',
        errorMessage: 'MARKETING_ESP_FALLBACK is off and no email account is connected.',
        isTransient: false,
      };
    }

    const to = payload.recipientEmail ?? destination?.platformId ?? '';
    if (!to) {
      return {
        success: false,
        errorCode: 'MISSING_RECIPIENT',
        errorMessage: 'No recipient address on the delivery',
        isTransient: false,
      };
    }

    // The queue stores a text body; a campaign may also carry html. Sending
    // text as html would render markup as literal characters, so it is wrapped
    // only when there is no html to use.
    const html = payload.htmlBody ?? `<pre style="font:inherit;white-space:pre-wrap">${escapeHtml(payload.textBody ?? '')}</pre>`;

    try {
      const { id } = await this.systemEmail.sendTransactional({
        to,
        subject: payload.subject ?? '(no subject)',
        html,
        text: payload.textBody,
      });
      return { success: true, externalPostId: id };
    } catch (err) {
      const normalized = this.normalizeError(err);
      return {
        success: false,
        errorCode: normalized.code,
        errorMessage: normalized.message,
        isTransient: normalized.isTransient,
      };
    }
  }

  normalizeError(error: unknown): NormalizedError {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      // "not configured" is a deployment state, not a transient fault — retrying
      // it would burn the delivery's retries against something only a human can
      // change.
      if (msg.includes('not configured')) {
        return { code: 'ESP_NOT_CONFIGURED', message: error.message, isTransient: false };
      }
      const isTransient =
        msg.includes('timeout') ||
        msg.includes('econnreset') ||
        msg.includes('rate limit') ||
        msg.includes('429');
      return { code: isTransient ? 'TRANSIENT' : 'EMAIL_ERROR', message: error.message, isTransient };
    }
    return { code: 'UNKNOWN', message: String(error), isTransient: false };
  }

  getCapabilities(_platform: string): AdapterCapabilities {
    return {
      supports_text_post: false,
      supports_image_post: false,
      supports_video_post: false,
      supports_scheduled_post: false,
      supports_campaign_email: true,
      supports_template_message: false,
    };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
