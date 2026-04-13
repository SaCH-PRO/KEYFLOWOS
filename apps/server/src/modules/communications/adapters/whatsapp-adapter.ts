import {
  ChannelAdapter,
  PublishPayload,
  PublishResponse,
  AdapterCapabilities,
  NormalizedError,
} from './channel-adapter.interface';

interface WhatsAppApiError {
  error?: { message?: string; code?: number; error_subcode?: number };
}

interface WhatsAppApiSuccess {
  messages?: Array<{ id?: string }>;
  contacts?: Array<{ input?: string; wa_id?: string }>;
}

interface ChannelConnection {
  token?: string;
  [key: string]: unknown;
}

interface ChannelDestination {
  platformId?: string;
  [key: string]: unknown;
}

export class WhatsAppAdapter implements ChannelAdapter {
  readonly provider = 'WHATSAPP';

  async publish(connection: ChannelConnection, destination: ChannelDestination, payload: PublishPayload): Promise<PublishResponse> {
    const accessToken = connection.token;
    const phoneNumberId = destination.platformId;

    if (!accessToken || !phoneNumberId) {
      return { success: false, errorCode: 'MISSING_CREDENTIALS', errorMessage: 'Missing WhatsApp access token or phone number ID', isTransient: false };
    }

    if (!payload.recipientEmail && !payload.meta?.recipientPhone) {
      return { success: false, errorCode: 'MISSING_RECIPIENT', errorMessage: 'Recipient phone number is required for WhatsApp delivery', isTransient: false };
    }

    const recipientPhone = String(payload.meta?.recipientPhone || '');

    try {
      const templateName = payload.meta?.templateName ? String(payload.meta.templateName) : undefined;
      const templateLanguage = String(payload.meta?.templateLanguage || 'en');

      let messagePayload: Record<string, unknown>;

      if (templateName) {
        const templateComponents: Record<string, unknown>[] = [];
        if (payload.meta?.templateParameters && Array.isArray(payload.meta.templateParameters)) {
          const params = Array.isArray(payload.meta.templateParameters) ? payload.meta.templateParameters : [];
          templateComponents.push({
            type: 'body',
            parameters: params.map((p: unknown) => ({
              type: 'text',
              text: String(p),
            })),
          });
        }

        messagePayload = {
          messaging_product: 'whatsapp',
          to: recipientPhone,
          type: 'template',
          template: {
            name: templateName,
            language: { code: templateLanguage },
            ...(templateComponents.length > 0 ? { components: templateComponents } : {}),
          },
        };
      } else {
        const body = payload.textBody || '';
        if (body.length > 4096) {
          return { success: false, errorCode: 'MESSAGE_TOO_LONG', errorMessage: `Message exceeds WhatsApp limit (${body.length}/4096 chars)`, isTransient: false };
        }

        if (payload.mediaUrls && payload.mediaUrls.length > 0) {
          const mediaUrl = payload.mediaUrls[0];
          const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(mediaUrl);
          const isVideo = /\.(mp4|3gp)$/i.test(mediaUrl);
          const isDocument = !isImage && !isVideo;

          const mediaType = isImage ? 'image' : isVideo ? 'video' : 'document';

          messagePayload = {
            messaging_product: 'whatsapp',
            to: recipientPhone,
            type: mediaType,
            [mediaType]: {
              link: mediaUrl,
              caption: body || undefined,
            },
          };
        } else {
          messagePayload = {
            messaging_product: 'whatsapp',
            to: recipientPhone,
            type: 'text',
            text: { body, preview_url: true },
          };
        }
      }

      const response = await fetch(
        `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(messagePayload),
        },
      );

      if (!response.ok) {
        const errorData: WhatsAppApiError = await response.json() as WhatsAppApiError;
        const errorMsg = errorData?.error?.message || `WhatsApp API error: ${response.status}`;
        return {
          success: false,
          errorCode: 'WHATSAPP_API_ERROR',
          errorMessage: errorMsg,
          isTransient: response.status >= 500 || response.status === 429,
        };
      }

      const result: WhatsAppApiSuccess = await response.json() as WhatsAppApiSuccess;
      const messageId = result?.messages?.[0]?.id;

      return {
        success: true,
        externalPostId: messageId,
        raw: result,
      };
    } catch (err) {
      const normalized = this.normalizeError(err);
      return { success: false, errorCode: normalized.code, errorMessage: normalized.message, isTransient: normalized.isTransient };
    }
  }

  normalizeError(error: unknown): NormalizedError {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      const isTransient = msg.includes('timeout') || msg.includes('econnreset') || msg.includes('rate limit') || msg.includes('429');
      return { code: isTransient ? 'TRANSIENT' : 'WHATSAPP_ERROR', message: error.message, isTransient };
    }
    return { code: 'UNKNOWN', message: String(error), isTransient: false };
  }

  async validateConnection(connection: ChannelConnection): Promise<{ valid: boolean; error?: string }> {
    const accessToken = connection.token;
    if (!accessToken) return { valid: false, error: 'Missing access token' };

    try {
      const response = await fetch(
        'https://graph.facebook.com/v19.0/me?fields=id,name',
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!response.ok) {
        const errorData: WhatsAppApiError = await response.json() as WhatsAppApiError;
        return { valid: false, error: errorData?.error?.message || `API error: ${response.status}` };
      }
      return { valid: true };
    } catch (err) {
      return { valid: false, error: (err instanceof Error) ? err.message : String(err) };
    }
  }

  async listPhoneNumbers(accessToken: string, waBusinessAccountId: string): Promise<Array<{ id: string; displayPhoneNumber: string; verifiedName: string }>> {
    try {
      const response = await fetch(
        `https://graph.facebook.com/v19.0/${waBusinessAccountId}/phone_numbers?fields=id,display_phone_number,verified_name`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!response.ok) return [];
      const data = await response.json() as { data?: Array<{ id?: string; display_phone_number?: string; verified_name?: string }> };
      return (data?.data ?? []).map(p => ({
        id: p.id ?? '',
        displayPhoneNumber: p.display_phone_number ?? '',
        verifiedName: p.verified_name ?? '',
      }));
    } catch {
      return [];
    }
  }

  getCapabilities(_platform: string): AdapterCapabilities {
    return {
      supports_text_post: false,
      supports_image_post: false,
      supports_video_post: false,
      supports_scheduled_post: false,
      supports_campaign_email: false,
      supports_template_message: true,
    };
  }
}
