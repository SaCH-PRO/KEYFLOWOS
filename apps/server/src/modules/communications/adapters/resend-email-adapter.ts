import {
  ChannelAdapter,
  PublishPayload,
  PublishResponse,
  AdapterCapabilities,
  NormalizedError,
  ProviderEffectContext,
} from './channel-adapter.interface';
import {
  SystemEmailSendError,
  SystemEmailService,
} from '../../notifications/system-email.service';
import {
  parseResendEffectSnapshot,
  renderResendHtml,
} from './resend-effect';

/**
 * Send campaign and sequence email without a connected Gmail account.
 */
export class ResendEmailAdapter implements ChannelAdapter {
  readonly provider = 'RESEND';

  constructor(private readonly systemEmail = new SystemEmailService()) {}

  static isEnabled(): boolean {
    const flag = process.env.MARKETING_ESP_FALLBACK?.trim().toLowerCase();
    return flag !== 'off' && flag !== 'false' && flag !== '0';
  }

  async publish(
    _connection: unknown,
    destination: { platformId?: string | null },
    payload: PublishPayload,
    effectContext?: ProviderEffectContext,
  ): Promise<PublishResponse> {
    if (!ResendEmailAdapter.isEnabled()) {
      return {
        success: false,
        errorCode: 'ESP_FALLBACK_DISABLED',
        errorMessage: 'MARKETING_ESP_FALLBACK is off and no email account is connected.',
        isTransient: false,
        outcomeCertainty: 'FAILED_CONFIRMED',
      };
    }

    let to = payload.recipientEmail ?? destination?.platformId ?? '';
    let subject = payload.subject ?? '(no subject)';
    let html = renderResendHtml(payload);
    let text = payload.textBody;
    let from: string | undefined;

    if (effectContext?.providerPayloadSnapshot) {
      try {
        const snapshot = parseResendEffectSnapshot(effectContext.providerPayloadSnapshot);
        to = snapshot.to;
        from = snapshot.from;
        subject = snapshot.subject;
        html = snapshot.html;
        text = snapshot.text;
      } catch (err) {
        return {
          success: false,
          errorCode: 'INVALID_EFFECT_SNAPSHOT',
          errorMessage: err instanceof Error ? err.message : String(err),
          isTransient: false,
          outcomeCertainty: 'FAILED_CONFIRMED',
        };
      }
    }

    if (!to) {
      return {
        success: false,
        errorCode: 'MISSING_RECIPIENT',
        errorMessage: 'No recipient address on the delivery',
        isTransient: false,
        outcomeCertainty: 'FAILED_CONFIRMED',
      };
    }

    try {
      const { id } = await this.systemEmail.sendTransactional({
        to,
        subject,
        html,
        text,
        ...(from ? { from } : {}),
        ...(effectContext?.providerIdempotencyKey
          ? { idempotencyKey: effectContext.providerIdempotencyKey }
          : {}),
      });
      if (!id) {
        return {
          success: false,
          errorCode: 'MISSING_PROVIDER_ID',
          errorMessage: 'Resend returned no provider message id; outcome cannot be proven.',
          isTransient: true,
          outcomeCertainty: 'OUTCOME_UNKNOWN',
        };
      }
      return { success: true, externalPostId: id };
    } catch (err) {
      const normalized = this.normalizeError(err);
      const outcomeCertainty =
        err instanceof SystemEmailSendError ? err.outcome : 'FAILED_CONFIRMED';
      return {
        success: false,
        errorCode: normalized.code,
        errorMessage: normalized.message,
        isTransient: normalized.isTransient,
        outcomeCertainty,
      };
    }
  }

  normalizeError(error: unknown): NormalizedError {
    if (error instanceof SystemEmailSendError) {
      const msg = error.message.toLowerCase();
      const providerCode = error.providerCode?.toLowerCase() ?? '';
      const isTransient =
        error.outcome === 'OUTCOME_UNKNOWN' ||
        providerCode.includes('concurrent_idempotent_requests') ||
        msg.includes('rate limit') ||
        msg.includes('429') ||
        msg.includes('timeout') ||
        msg.includes('econnreset');
      return {
        code: error.providerCode ?? (isTransient ? 'TRANSIENT' : 'EMAIL_ERROR'),
        message: error.message,
        isTransient,
      };
    }

    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
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
