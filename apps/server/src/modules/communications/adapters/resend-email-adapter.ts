import {
  ChannelAdapter,
  PublishPayload,
  PublishResponse,
  AdapterCapabilities,
  NormalizedError,
  ProviderEffectContext,
  ProviderEffectMaterial,
} from './channel-adapter.interface';
import {
  SystemEmailSendError,
  SystemEmailService,
} from '../../notifications/system-email.service';

/**
 * Send campaign and sequence email without a connected Gmail account.
 *
 * Resend is the platform fallback when no usable Gmail connection exists.
 * Effect certainty is supplied by DeliveryQueueService through the optional
 * ProviderEffectContext; legacy/system callers remain backward compatible.
 */
export class ResendEmailAdapter implements ChannelAdapter {
  readonly provider = 'RESEND';

  constructor(private readonly systemEmail = new SystemEmailService()) {}

  /** Off only when explicitly disabled; unset means on. */
  static isEnabled(): boolean {
    const flag = process.env.MARKETING_ESP_FALLBACK?.trim().toLowerCase();
    return flag !== 'off' && flag !== 'false' && flag !== '0';
  }

  prepareEffectMaterial(
    _connection: unknown,
    destination: { platformId?: string | null },
    payload: PublishPayload,
  ): ProviderEffectMaterial {
    const to = payload.recipientEmail ?? destination?.platformId ?? '';
    if (!to) {
      throw new SystemEmailSendError('No recipient address on the delivery', 'FAILED_CONFIRMED');
    }

    const sender = this.systemEmail.getSenderIdentity();
    if (!sender) {
      throw new SystemEmailSendError(
        'System email sender is not configured. Set RESEND_API_KEY and EMAIL_FROM_ADDRESS.',
        'FAILED_CONFIRMED',
      );
    }

    const html = payload.htmlBody
      ?? `<pre style="font:inherit;white-space:pre-wrap">${escapeHtml(payload.textBody ?? '')}</pre>`;

    return {
      provider: this.provider,
      recipient: to,
      sender,
      subject: payload.subject ?? '(no subject)',
      html,
      text: payload.textBody,
    };
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

    let material: ProviderEffectMaterial;
    try {
      material = effectContext?.material ?? this.prepareEffectMaterial(_connection, destination, payload);
    } catch (err) {
      const normalized = this.normalizeError(err);
      return {
        success: false,
        errorCode: normalized.code,
        errorMessage: normalized.message,
        isTransient: normalized.isTransient,
        outcomeCertainty: normalized.outcomeCertainty,
      };
    }

    try {
      const { id } = await this.systemEmail.sendTransactional({
        to: material.recipient,
        from: material.sender,
        subject: material.subject,
        html: material.html,
        text: material.text,
        idempotencyKey: effectContext?.providerIdempotencyKey,
      });
      return { success: true, externalPostId: id };
    } catch (err) {
      const normalized = this.normalizeError(err);
      return {
        success: false,
        errorCode: normalized.code,
        errorMessage: normalized.message,
        isTransient: normalized.isTransient,
        outcomeCertainty: normalized.outcomeCertainty,
      };
    }
  }

  normalizeError(error: unknown): NormalizedError {
    if (error instanceof SystemEmailSendError) {
      const msg = error.message.toLowerCase();
      const isTransient =
        error.outcomeCertainty === 'OUTCOME_UNKNOWN'
        || msg.includes('rate limit')
        || msg.includes('429');
      return {
        code: error.outcomeCertainty === 'OUTCOME_UNKNOWN' ? 'OUTCOME_UNKNOWN' : 'EMAIL_ERROR',
        message: error.message,
        isTransient,
        outcomeCertainty: error.outcomeCertainty,
      };
    }

    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('not configured')) {
        return {
          code: 'ESP_NOT_CONFIGURED',
          message: error.message,
          isTransient: false,
          outcomeCertainty: 'FAILED_CONFIRMED',
        };
      }
      const ambiguous =
        msg.includes('timeout')
        || msg.includes('econnreset')
        || msg.includes('socket hang up')
        || msg.includes('fetch failed');
      const transient = ambiguous || msg.includes('rate limit') || msg.includes('429');
      return {
        code: ambiguous ? 'OUTCOME_UNKNOWN' : transient ? 'TRANSIENT' : 'EMAIL_ERROR',
        message: error.message,
        isTransient: transient,
        outcomeCertainty: ambiguous ? 'OUTCOME_UNKNOWN' : 'FAILED_CONFIRMED',
      };
    }

    return {
      code: 'UNKNOWN',
      message: String(error),
      isTransient: false,
      outcomeCertainty: 'FAILED_CONFIRMED',
    };
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
